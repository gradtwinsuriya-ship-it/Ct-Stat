import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  ShieldAlert,
  ShieldCheck,
  Upload,
} from 'lucide-react';
import { INITIAL_CT_CASES } from './data/rsnaCohort';
import type {
  AbcVolumeData,
  AnalysisResult,
  AnticoagulantType,
  CTCase,
  CTSeriesSlice,
  ClinicalContext,
  ClinicianSignOff,
  HemorrhageSubtypeId,
  TriageLevel,
} from './types/ct';
import { parseDicomBuffer } from './utils/dicomParser';
import { buildMultiWindowPayloads } from './utils/multiWindow';
import { CTViewport } from './components/CTViewport';
import { TriagePanel, type TriagePanelTab } from './components/TriagePanel';
import { TriageQueueView } from './components/TriageQueueView';
import { SubtypeAtlasView } from './components/SubtypeAtlasView';
import { ValidationView } from './components/ValidationView';
import { UploadModal } from './components/UploadModal';
import { AmbientNeuroBackdrop } from './components/three/AmbientNeuroBackdrop';
import { PageTransition3D } from './components/three/PageTransition3D';
import { MagneticCursor3D } from './components/three/MagneticCursor3D';
import { PopOutButton3D, TactileButton, TiltCard3D } from './components/ui/Tactile3D';
import { HolographicMiniBrain } from './components/ui/HolographicMiniBrain';
import { playTactileSound } from './utils/hapticSound';
import { prefersReducedMotion } from './utils/webglDetect';

type AppTab = 'workstation' | 'queue' | 'atlas' | 'validation';

const STORAGE_KEY = 'hemastat_case_state_v1';

interface PersistedCasePatch {
  abcVolume?: AbcVolumeData;
  measuredMidlineShiftMm?: number;
  signOff?: ClinicianSignOff;
  anticoagulant?: AnticoagulantType;
}

async function parseSingleUploadFile(file: File, index: number): Promise<CTSeriesSlice> {
  const isDicom =
    file.name.toLowerCase().endsWith('.dcm') || file.type === 'application/dicom';

  if (isDicom) {
    const buffer = await file.arrayBuffer();
    const parsed = parseDicomBuffer(buffer);
    return {
      id: `slice-${Date.now()}-${index}`,
      label: file.name,
      imageUrl: parsed.dataUrl,
      mimeType: 'image/png',
      instanceNumber: parsed.metadata.instanceNumber ?? index + 1,
      sliceLocationMm: parsed.metadata.sliceLocationMm,
      dicomMeta: parsed.metadata,
    };
  }

  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  return {
    id: `slice-${Date.now()}-${index}`,
    label: file.name,
    imageUrl: dataUrl,
    mimeType: file.type || 'image/jpeg',
    instanceNumber: index + 1,
  };
}

function getQueueStatusIcon(level?: TriageLevel) {
  switch (level) {
    case 'STAT_SURGICAL':
      return <ShieldAlert className="w-3.5 h-3.5 text-rose-600 shrink-0" />;
    case 'URGENT_NEURO':
      return <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />;
    case 'PRIORITY_REVIEW':
      return <Clock className="w-3.5 h-3.5 text-indigo-600 shrink-0" />;
    case 'ROUTINE_NEGATIVE':
    default:
      return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />;
  }
}

export default function App() {
  const [cases, setCases] = useState<CTCase[]>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return INITIAL_CT_CASES;
      const patches = JSON.parse(raw) as Record<string, PersistedCasePatch>;
      return INITIAL_CT_CASES.map((c) => {
        const p = patches[c.id];
        if (!p) return c;
        return {
          ...c,
          abcVolume: p.abcVolume ?? c.abcVolume,
          measuredMidlineShiftMm: p.measuredMidlineShiftMm ?? c.measuredMidlineShiftMm,
          signOff: p.signOff ?? c.signOff,
          clinicalContext: p.anticoagulant
            ? { ...c.clinicalContext, anticoagulant: p.anticoagulant }
            : c.clinicalContext,
        };
      });
    } catch {
      return INITIAL_CT_CASES;
    }
  });

  const [activeCaseId, setActiveCaseId] = useState<string>(INITIAL_CT_CASES[0].id);
  const [activeSliceIndex, setActiveSliceIndex] = useState<number>(0);
  const [activeTab, setActiveTab] = useState<AppTab>('workstation');
  const [triagePanelTab, setTriagePanelTab] = useState<TriagePanelTab>('triage');
  const [pendingConsultPrompt, setPendingConsultPrompt] = useState<string | null>(null);
  const [focusedSubtype, setFocusedSubtype] = useState<HemorrhageSubtypeId | null>(null);
  const [parallaxOffset, setParallaxOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [uploadModalOpen, setUploadModalOpen] = useState<boolean>(false);
  const [droppedFile, setDroppedFile] = useState<File | null>(null);
  const [queueFilter, setQueueFilter] = useState<'all' | 'positive' | 'negative'>('all');

  useEffect(() => {
    setFocusedSubtype(null);
  }, [activeCaseId]);

  useEffect(() => {
    if (prefersReducedMotion()) return;
    if (typeof window === 'undefined' || !window.matchMedia('(pointer: fine)').matches) return;
    let rafId = 0;
    let nextX = 0;
    let nextY = 0;

    const onMove = (e: PointerEvent) => {
      nextX = (e.clientX / Math.max(1, window.innerWidth) - 0.5) * 2;
      nextY = (e.clientY / Math.max(1, window.innerHeight) - 0.5) * 2;
      if (!rafId) {
        rafId = requestAnimationFrame(() => {
          rafId = 0;
          setParallaxOffset({ x: nextX, y: nextY });
        });
      }
    };

    window.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      window.removeEventListener('pointermove', onMove);
    };
  }, []);

  useEffect(() => {
    try {
      const patches: Record<string, PersistedCasePatch> = {};
      cases.forEach((c) => {
        if (
          c.abcVolume ||
          typeof c.measuredMidlineShiftMm === 'number' ||
          c.signOff ||
          c.clinicalContext.anticoagulant
        ) {
          patches[c.id] = {
            abcVolume: c.abcVolume,
            measuredMidlineShiftMm: c.measuredMidlineShiftMm,
            signOff: c.signOff,
            anticoagulant: c.clinicalContext.anticoagulant,
          };
        }
      });
      localStorage.setItem(STORAGE_KEY, JSON.stringify(patches));
    } catch {
      // Ignore storage quota issues
    }
  }, [cases]);

  const activeCase = useMemo(
    () => cases.find((c) => c.id === activeCaseId) ?? cases[0],
    [cases, activeCaseId]
  );

  const activeSliceImageUrl = useMemo(() => {
    if (activeCase.slices && activeCase.slices.length > 0) {
      return activeCase.slices[activeSliceIndex]?.imageUrl ?? activeCase.imageUrl;
    }
    return activeCase.imageUrl;
  }, [activeCase, activeSliceIndex]);

  const activeSliceDicomMeta = useMemo(() => {
    if (activeCase.slices && activeCase.slices.length > 0) {
      return activeCase.slices[activeSliceIndex]?.dicomMeta ?? activeCase.dicomMeta;
    }
    return activeCase.dicomMeta;
  }, [activeCase, activeSliceIndex]);

  const sidebarCases = useMemo(() => {
    return cases.filter((c) => {
      if (queueFilter === 'positive') return c.analysis?.anyHemorrhage;
      if (queueFilter === 'negative') return c.analysis && !c.analysis.anyHemorrhage;
      return true;
    });
  }, [cases, queueFilter]);

  const analyzeCaseWithMultiWindow = useCallback(
    async (
      imageUrl: string,
      clinicalContext: ClinicalContext,
      dicomMeta?: CTCase['dicomMeta']
    ): Promise<{ analysis: AnalysisResult; inferenceMs: number; analyzedAt: string }> => {
      const multiWindow = await buildMultiWindowPayloads(imageUrl, dicomMeta);
      const response = await fetch('/api/analyze-ct', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          multiWindow,
          clinicalContext,
        }),
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || `Server error (${response.status})`);
      }
      return payload;
    },
    []
  );

  const handleRunLiveAnalysis = useCallback(async () => {
    if (!activeCase) return;
    setIsAnalyzing(true);
    setAnalysisError(null);
    try {
      const result = await analyzeCaseWithMultiWindow(
        activeSliceImageUrl,
        activeCase.clinicalContext,
        activeSliceDicomMeta
      );
      setCases((prev) =>
        prev.map((c) =>
          c.id === activeCase.id
            ? {
                ...c,
                analysis: result.analysis,
                inferenceMs: result.inferenceMs,
                analyzedAt: result.analyzedAt,
                isLiveInference: true,
              }
            : c
        )
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unable to complete CT scan analysis.';
      setAnalysisError(msg);
    } finally {
      setIsAnalyzing(false);
    }
  }, [activeCase, activeSliceImageUrl, activeSliceDicomMeta, analyzeCaseWithMultiWindow]);

  const handleRunAuditCase = useCallback(
    async (targetCase: CTCase) => {
      const result = await analyzeCaseWithMultiWindow(
        targetCase.imageUrl,
        targetCase.clinicalContext,
        targetCase.dicomMeta
      );
      setCases((prev) =>
        prev.map((c) =>
          c.id === targetCase.id
            ? {
                ...c,
                analysis: result.analysis,
                inferenceMs: result.inferenceMs,
                analyzedAt: result.analyzedAt,
                isLiveInference: true,
              }
            : c
        )
      );
      return result;
    },
    [analyzeCaseWithMultiWindow]
  );

  const handleSubmitUpload = async (files: File[], context: ClinicalContext) => {
    setIsAnalyzing(true);
    setAnalysisError(null);
    try {
      const parsedSlices = await Promise.all(files.map((f, i) => parseSingleUploadFile(f, i)));
      parsedSlices.sort((a, b) => {
        if (typeof a.sliceLocationMm === 'number' && typeof b.sliceLocationMm === 'number') {
          return a.sliceLocationMm - b.sliceLocationMm;
        }
        return a.instanceNumber - b.instanceNumber;
      });

      const middleIdx = Math.floor(parsedSlices.length / 2);
      const primarySlice = parsedSlices[middleIdx];

      const mergedContext: ClinicalContext = {
        ...context,
        patientId: primarySlice.dicomMeta?.patientId || context.patientId,
      };

      const newId = `case-upload-${Date.now()}`;
      const pendingCase: CTCase = {
        id: newId,
        accessionNumber: `STAT-${String(Date.now()).slice(-5)}`,
        title:
          parsedSlices.length > 1
            ? `${primarySlice.dicomMeta?.studyDescription || 'Head CT Stack'} (${parsedSlices.length} slices)`
            : primarySlice.dicomMeta?.studyDescription || files[0].name,
        source: 'user_upload',
        imageUrl: primarySlice.imageUrl,
        mimeType: primarySlice.mimeType,
        slices: parsedSlices,
        clinicalContext: mergedContext,
        dicomMeta: primarySlice.dicomMeta,
        analysis: null,
      };

      setCases((prev) => [pendingCase, ...prev]);
      setActiveCaseId(newId);
      setActiveSliceIndex(middleIdx);
      setUploadModalOpen(false);
      setDroppedFile(null);
      setActiveTab('workstation');
      setTriagePanelTab('triage');

      const result = await analyzeCaseWithMultiWindow(
        primarySlice.imageUrl,
        mergedContext,
        primarySlice.dicomMeta
      );
      setCases((prev) =>
        prev.map((c) =>
          c.id === newId
            ? {
                ...c,
                analysis: result.analysis,
                inferenceMs: result.inferenceMs,
                analyzedAt: result.analyzedAt,
                isLiveInference: true,
              }
            : c
        )
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to parse or analyze uploaded CT.';
      setAnalysisError(msg);
      setUploadModalOpen(false);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleFileDroppedOnViewport = (files: File[]) => {
    if (files.length === 1) {
      setDroppedFile(files[0]);
      setUploadModalOpen(true);
    } else if (files.length > 1) {
      void handleSubmitUpload(files, {
        patientId: 'ANON-STACK',
        age: 'Unknown',
        sex: 'Other',
        gcs: 15,
        symptoms: 'Dropped multi-slice head CT stack',
        onsetHours: 'Unknown',
      });
    }
  };

  const handleInspectSubtypeCase = (subtype: HemorrhageSubtypeId) => {
    const match = cases.find((c) => c.groundTruth?.label === subtype);
    if (match) {
      setActiveCaseId(match.id);
      setActiveSliceIndex(0);
      setAnalysisError(null);
    }
    setActiveTab('workstation');
  };

  return (
    <div className="relative min-h-screen text-[#1E1B3A] flex flex-col">
      <AmbientNeuroBackdrop
        triageLevel={activeCase?.analysis?.triageLevel}
        isAnalyzing={isAnalyzing}
        activeTab={activeTab}
        activeCaseId={activeCase.id}
      />
      <PageTransition3D transitionKey={activeTab} subTransitionKey={activeCase.id} />
      <MagneticCursor3D triageLevel={activeCase?.analysis?.triageLevel} />

      {/* Top Bar Contract: 3 exact zones separated by gap-8 */}
      <header className="relative z-20 h-14 px-6 bg-white/90 border-b border-[#E3DCF5] flex items-center justify-between gap-8 shrink-0 no-print shadow-[0_8px_28px_-14px_rgba(91,75,138,0.22)]">
        <button
          type="button"
          onClick={() => {
            playTactileSound('click');
            setActiveTab('workstation');
          }}
          className="text-lg font-bold tracking-tight text-[#1E1B3A] whitespace-nowrap shrink-0 cursor-pointer hover:text-indigo-700 transition-colors"
        >
          HemaSTAT
        </button>

        <nav className="hidden md:flex items-center gap-7 text-sm font-medium">
          {(
            [
              ['workstation', 'Workstation'],
              ['queue', 'Triage Queue'],
              ['atlas', 'Subtype Atlas'],
              ['validation', 'Dataset & Validation'],
            ] as [AppTab, string][]
          ).map(([tab, label]) => {
            const isActive = activeTab === tab;
            return (
              <button
                key={tab}
                type="button"
                onClick={() => {
                  playTactileSound('click');
                  setActiveTab(tab);
                }}
                className={`relative py-4 transition-colors duration-150 whitespace-nowrap shrink-0 cursor-pointer ${
                  isActive
                    ? 'text-indigo-700 font-semibold'
                    : 'text-[#565278] hover:text-[#1E1B3A] hover:-translate-y-0.5'
                }`}
              >
                {label}
                {isActive && (
                  <motion.span
                    layoutId="nav-3d-underline"
                    transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                    className="absolute inset-x-0 bottom-0 h-[2.5px] bg-gradient-to-r from-[#818CF8] via-[#A78BFA] to-[#34D399] rounded-full"
                  />
                )}
              </button>
            );
          })}
        </nav>

        <div className="shrink-0">
          <TactileButton
            variant="primary"
            magnetic
            onClick={() => {
              setDroppedFile(null);
              setUploadModalOpen(true);
            }}
            className="px-4 py-2 text-xs font-semibold rounded whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Upload className="w-3.5 h-3.5" />
            Upload Head CT
          </TactileButton>
        </div>
      </header>

      {/* Mobile Nav */}
      <div className="md:hidden flex items-center gap-4 px-4 py-2 bg-white/95 border-b border-[#E3DCF5] overflow-x-auto no-print">
        {(
          [
            ['workstation', 'Workstation'],
            ['queue', 'Triage Queue'],
            ['atlas', 'Subtype Atlas'],
            ['validation', 'Validation'],
          ] as [AppTab, string][]
        ).map(([tab, label]) => (
          <button
            key={tab}
            type="button"
            onClick={() => {
              playTactileSound('click');
              setActiveTab(tab);
            }}
            className={`text-xs font-medium whitespace-nowrap shrink-0 py-1 ${
              activeTab === tab ? 'text-indigo-700 font-semibold' : 'text-[#565278]'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Main Content with Lusion-Inspired 3D Z-Dive Page Transitions */}
      <main className="relative z-10 flex-1 perspective-stage">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 22, rotateX: 5, scale: 0.92 }}
            animate={{ opacity: 1, y: 0, rotateX: 0, scale: 1 }}
            exit={{ opacity: 0, y: -16, rotateX: -4, scale: 1.06 }}
            transition={{ duration: 0.44, ease: [0.16, 1, 0.3, 1] }}
            className="w-full h-full preserve-3d"
          >
            {activeTab === 'workstation' && (
              <div className="max-w-[1680px] mx-auto px-4 py-4 grid grid-cols-1 lg:grid-cols-[256px_minmax(0,1fr)_390px] 2xl:grid-cols-[268px_minmax(0,1fr)_410px] gap-4 items-stretch min-h-[calc(100vh-3.5rem)] perspective-stage">
                {/* Left Column: Study Worklist (Multi-Plane Z-Parallax Layer -1) */}
                <aside
                  style={{
                    transform: `perspective(1800px) rotateY(${parallaxOffset.x * 0.75}deg) rotateX(${
                      -parallaxOffset.y * 0.5
                    }deg) translate3d(${parallaxOffset.x * -3}px, ${parallaxOffset.y * -2}px, -4px)`,
                    transition: 'transform 160ms ease-out',
                  }}
                  className="surface-3d border border-[#E3DCF5] rounded-xl flex flex-col overflow-hidden no-print"
                >
                  <div className="px-4 py-3 border-b border-[#E3DCF5] space-y-2.5 shrink-0">
                    <div className="flex items-center justify-between">
                      <h2 className="text-xs font-semibold text-[#1E1B3A]">Head CT Worklist</h2>
                      <span className="text-[11px] font-mono tabular-nums text-[#565278]">
                        {cases.length} studies
                      </span>
                    </div>

                    <div className="grid grid-cols-3 gap-1 p-1 bg-[#F3F0FA] rounded-lg border border-[#E3DCF5]">
                      {(
                        [
                          ['all', 'All'],
                          ['positive', 'Bleed +'],
                          ['negative', 'Clear'],
                        ] as ['all' | 'positive' | 'negative', string][]
                      ).map(([val, label]) => (
                        <TactileButton
                          key={val}
                          variant={queueFilter === val ? 'active' : 'ghost'}
                          onClick={() => setQueueFilter(val)}
                          className="py-1 text-[11px] font-medium rounded whitespace-nowrap cursor-pointer"
                        >
                          {label}
                        </TactileButton>
                      ))}
                    </div>
                  </div>

                  <div className="flex-1 overflow-y-auto p-2.5 space-y-2 preserve-3d">
                    {sidebarCases.map((item) => {
                      const selected = item.id === activeCase.id;
                      const a = item.analysis;
                      const itemGlow =
                        a?.triageLevel === 'STAT_SURGICAL'
                          ? 'rgba(244, 63, 94, 0.24)'
                          : a?.triageLevel === 'URGENT_NEURO'
                          ? 'rgba(245, 158, 11, 0.24)'
                          : a?.triageLevel === 'ROUTINE_NEGATIVE'
                          ? 'rgba(16, 185, 129, 0.22)'
                          : 'rgba(139, 124, 246, 0.26)';
                      return (
                        <PopOutButton3D
                          key={item.id}
                          selected={selected}
                          glowColor={itemGlow}
                          onClick={() => {
                            setActiveCaseId(item.id);
                            setActiveSliceIndex(0);
                            setAnalysisError(null);
                          }}
                          className={`group w-full text-left p-2.5 rounded-lg border cursor-pointer ${
                            selected
                              ? 'bg-gradient-to-r from-[#EDE9FE] to-[#F5F3FF] border-[#A78BFA] shadow-[0_10px_22px_-8px_rgba(124,111,246,0.48),inset_0_1px_0_rgba(255,255,255,0.9)]'
                              : 'bg-white/75 border-transparent hover:border-[#C4B5FD] hover:bg-[#FAF8FF] hover:shadow-[0_16px_30px_-12px_rgba(91,75,138,0.34)]'
                          }`}
                        >
                          <HolographicMiniBrain
                            triageLevel={a?.triageLevel}
                            dominantSubtype={a?.dominantSubtype}
                            xPercent={a?.localization.xPercent}
                            yPercent={a?.localization.yPercent}
                            selected={selected}
                          />
                          <div className="min-w-0 flex-1 space-y-0.5">
                            <div className="flex items-center justify-between gap-1.5">
                              <span className="text-xs font-mono font-semibold text-[#1E1B3A] truncate">
                                {item.accessionNumber}
                              </span>
                              <div className="flex items-center gap-1 shrink-0">
                                {item.signOff && (
                                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                                )}
                                {getQueueStatusIcon(a?.triageLevel)}
                              </div>
                            </div>
                            <div className="text-[11px] text-[#3E3A5E] truncate">{item.title}</div>
                            <div className="text-[11px] font-mono tabular-nums text-[#565278] flex items-center justify-between pt-0.5">
                              <span className={a?.anyHemorrhage ? 'text-rose-700 font-medium' : ''}>
                                {a?.anyHemorrhage
                                  ? a.dominantSubtype.toUpperCase()
                                  : a
                                  ? 'NEGATIVE'
                                  : 'PENDING'}
                              </span>
                              <span className="font-semibold text-[#1E1B3A]">
                                {a ? `${a.overallProbability.toFixed(0)}%` : '—'}
                              </span>
                            </div>
                          </div>
                        </PopOutButton3D>
                      );
                    })}
                  </div>

                  <div className="p-2.5 bg-[#FAF8FF] border-t border-[#E3DCF5] shrink-0">
                    <TiltCard3D maxTiltDeg={7} popScale={1.03} className="p-3 space-y-1.5">
                      <div className="flex items-center justify-between text-[11px] font-mono text-[#565278]">
                        <span>Clinical Presentation</span>
                        <span className="font-semibold text-[#1E1B3A]">
                          GCS {activeCase.clinicalContext.gcs}/15
                        </span>
                      </div>
                      <p className="text-xs text-[#2D2952] leading-relaxed line-clamp-3">
                        {activeCase.clinicalContext.symptoms}
                      </p>
                      <div className="text-[11px] font-mono text-[#6B668E]">
                        {activeCase.clinicalContext.age}Y {activeCase.clinicalContext.sex} ·{' '}
                        {activeCase.clinicalContext.onsetHours}
                      </div>
                    </TiltCard3D>
                  </div>
                </aside>

                {/* Center Stage: Interactive PACS Viewport */}
                <CTViewport
                  activeCase={activeCase}
                  activeSliceIndex={activeSliceIndex}
                  onChangeSliceIndex={setActiveSliceIndex}
                  isAnalyzing={isAnalyzing}
                  onRunLiveAnalysis={handleRunLiveAnalysis}
                  onFileDropped={handleFileDroppedOnViewport}
                  focusedSubtype={focusedSubtype}
                  onSync3dCaliperToAbc={(cmDistance) => {
                    const prevVol = activeCase.abcVolume;
                    const aCm = Math.max(0.5, cmDistance);
                    const bCm = prevVol?.bCm ?? Math.round(aCm * 0.65 * 10) / 10;
                    const slicesCount = prevVol?.slicesCount ?? 6;
                    const sliceThicknessCm = prevVol?.sliceThicknessCm ?? 0.5;
                    const volumeMl =
                      Math.round(((aCm * bCm * (slicesCount * sliceThicknessCm)) / 2) * 10) / 10;
                    setCases((prev) =>
                      prev.map((c) =>
                        c.id === activeCase.id
                          ? {
                              ...c,
                              abcVolume: { aCm, bCm, slicesCount, sliceThicknessCm, volumeMl },
                            }
                          : c
                      )
                    );
                    setTriagePanelTab('calculators');
                  }}
                  onMidlineShiftMeasured={(mm) => {
                    setCases((prev) =>
                      prev.map((c) =>
                        c.id === activeCase.id ? { ...c, measuredMidlineShiftMm: mm } : c
                      )
                    );
                  }}
                  onAskConsultAboutRoi={(roiPrompt) => {
                    setPendingConsultPrompt(roiPrompt);
                    setTriagePanelTab('consult');
                  }}
                />

                {/* Right Column: Triage, Calculators, Sign-Off & Consult (Multi-Plane Z-Parallax Layer +1) */}
                <div
                  style={{
                    transform: `perspective(1800px) rotateY(${parallaxOffset.x * 0.75}deg) rotateX(${
                      -parallaxOffset.y * 0.5
                    }deg) translate3d(${parallaxOffset.x * 3}px, ${parallaxOffset.y * -2}px, 4px)`,
                    transition: 'transform 160ms ease-out',
                  }}
                  className="h-full"
                >
                  <TriagePanel
                    activeCase={activeCase}
                    activeSliceImageUrl={activeSliceImageUrl}
                    activeTab={triagePanelTab}
                    onTabChange={setTriagePanelTab}
                    pendingConsultPrompt={pendingConsultPrompt}
                    onClearPendingConsultPrompt={() => setPendingConsultPrompt(null)}
                    errorMessage={analysisError}
                    onRunLiveAnalysis={handleRunLiveAnalysis}
                    isAnalyzing={isAnalyzing}
                    focusedSubtype={focusedSubtype}
                    onFocusSubtype={setFocusedSubtype}
                    onSaveAbcVolume={(vol) => {
                      setCases((prev) =>
                        prev.map((c) => (c.id === activeCase.id ? { ...c, abcVolume: vol } : c))
                      );
                      setTriagePanelTab('triage');
                    }}
                    onChangeAnticoagulant={(anticoag) => {
                      setCases((prev) =>
                        prev.map((c) =>
                          c.id === activeCase.id
                            ? {
                                ...c,
                                clinicalContext: { ...c.clinicalContext, anticoagulant: anticoag },
                              }
                            : c
                        )
                      );
                    }}
                    onSaveSignOff={(signOff) => {
                      setCases((prev) =>
                        prev.map((c) => (c.id === activeCase.id ? { ...c, signOff } : c))
                      );
                      setTriagePanelTab('triage');
                    }}
                  />
                </div>
              </div>
            )}

            {activeTab === 'queue' && (
              <TriageQueueView
                cases={cases}
                activeCaseId={activeCase.id}
                onSelectCase={(id) => {
                  setActiveCaseId(id);
                  setActiveSliceIndex(0);
                  setAnalysisError(null);
                  setActiveTab('workstation');
                }}
                onOpenUploadModal={() => {
                  setDroppedFile(null);
                  setUploadModalOpen(true);
                }}
              />
            )}

            {activeTab === 'atlas' && (
              <SubtypeAtlasView onInspectSubtypeCase={handleInspectSubtypeCase} />
            )}

            {activeTab === 'validation' && (
              <ValidationView
                cases={cases}
                onRunSingleAudit={handleRunAuditCase}
                onSelectCase={(id) => {
                  setActiveCaseId(id);
                  setActiveSliceIndex(0);
                  setAnalysisError(null);
                  setActiveTab('workstation');
                }}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </main>

      <UploadModal
        isOpen={uploadModalOpen}
        isSubmitting={isAnalyzing}
        initialFile={droppedFile}
        onClose={() => {
          setUploadModalOpen(false);
          setDroppedFile(null);
        }}
        onSubmitScan={handleSubmitUpload}
      />
    </div>
  );
}
