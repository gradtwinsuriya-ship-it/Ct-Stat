import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ClipboardCopy,
  Clock,
  Compass,
  FileCode2,
  FileDown,
  Loader2,
  RotateCw,
  Send,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import type {
  AbcVolumeData,
  AnticoagulantType,
  CTCase,
  ClinicianSignOff,
  ConsultMessage,
  HemorrhageSubtypeId,
  TriageLevel,
} from '../types/ct';
import { exportDiagnosticPdf } from '../utils/exportDiagnosticPdf';
import {
  buildFhirDiagnosticReport,
  buildNeurosurgerySbar,
  getReversalProtocol,
} from '../utils/fhirExport';
import { TactileButton, TiltCard3D } from './ui/Tactile3D';

export type TriagePanelTab = 'triage' | 'calculators' | 'consult';

interface TriagePanelProps {
  activeCase: CTCase;
  activeSliceImageUrl: string;
  activeTab: TriagePanelTab;
  onTabChange: (tab: TriagePanelTab) => void;
  pendingConsultPrompt: string | null;
  onClearPendingConsultPrompt: () => void;
  errorMessage: string | null;
  onRunLiveAnalysis: () => void;
  isAnalyzing: boolean;
  focusedSubtype?: HemorrhageSubtypeId | null;
  onFocusSubtype?: (subtype: HemorrhageSubtypeId | null) => void;
  onSaveAbcVolume: (vol: AbcVolumeData) => void;
  onChangeAnticoagulant: (anticoag: AnticoagulantType) => void;
  onSaveSignOff: (signOff: ClinicianSignOff) => void;
}

const SUBTYPE_LABELS: { id: HemorrhageSubtypeId; name: string; code: string }[] = [
  { id: 'epidural', name: 'Epidural', code: 'EDH' },
  { id: 'subdural', name: 'Subdural', code: 'SDH' },
  { id: 'subarachnoid', name: 'Subarachnoid', code: 'SAH' },
  { id: 'intraventricular', name: 'Intraventricular', code: 'IVH' },
  { id: 'intraparenchymal', name: 'Intraparenchymal', code: 'IPH' },
];

function getTriageDisplay(level: TriageLevel, isValidHeadCT: boolean) {
  if (!isValidHeadCT) {
    return {
      label: 'NON-DIAGNOSTIC INPUT',
      bannerClass: 'bg-[#FEF3C7] border-amber-300 text-[#78350F]',
      icon: <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />,
      textAccent: 'text-amber-700',
    };
  }
  switch (level) {
    case 'STAT_SURGICAL':
      return {
        label: 'STAT SURGICAL TRIAGE',
        bannerClass: 'bg-gradient-to-r from-[#FFE4E6] to-[#FECDD3] border-rose-300 text-[#881337]',
        icon: <ShieldAlert className="w-4 h-4 text-rose-700 shrink-0" />,
        textAccent: 'text-rose-700',
      };
    case 'URGENT_NEURO':
      return {
        label: 'URGENT NEUROLOGY / NEUROSURGERY',
        bannerClass: 'bg-gradient-to-r from-[#FFEDD5] to-[#FED7AA] border-amber-300 text-[#7C2D12]',
        icon: <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />,
        textAccent: 'text-amber-700',
      };
    case 'PRIORITY_REVIEW':
      return {
        label: 'PRIORITY RADIOLOGY REVIEW',
        bannerClass: 'bg-gradient-to-r from-[#EDE9FE] to-[#DDD6FE] border-violet-300 text-[#3730A3]',
        icon: <Clock className="w-4 h-4 text-indigo-700 shrink-0" />,
        textAccent: 'text-indigo-700',
      };
    case 'ROUTINE_NEGATIVE':
    default:
      return {
        label: 'NEGATIVE — NO ACUTE BLEED',
        bannerClass: 'bg-gradient-to-r from-[#D1FAE5] to-[#A7F3D0] border-emerald-300 text-[#064E3B]',
        icon: <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />,
        textAccent: 'text-emerald-700',
      };
  }
}

async function imageUrlToBase64(url: string): Promise<{ base64: string; mimeType: string }> {
  if (url.startsWith('data:')) {
    const [hdr, data] = url.split(',');
    const m = hdr.match(/data:([^;]+);base64/);
    return { base64: data || '', mimeType: m?.[1] || 'image/png' };
  }
  const resp = await fetch(url);
  const blob = await resp.blob();
  const base64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(((reader.result as string) || '').split(',')[1] || '');
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
  return { base64, mimeType: blob.type || 'image/jpeg' };
}

export const TriagePanel: React.FC<TriagePanelProps> = ({
  activeCase,
  activeSliceImageUrl,
  activeTab,
  onTabChange,
  pendingConsultPrompt,
  onClearPendingConsultPrompt,
  errorMessage,
  onRunLiveAnalysis,
  isAnalyzing,
  focusedSubtype = null,
  onFocusSubtype,
  onSaveAbcVolume,
  onChangeAnticoagulant,
  onSaveSignOff,
}) => {
  const analysis = activeCase.analysis;
  const [exportStatus, setExportStatus] = useState<'idle' | 'exporting' | 'done'>('idle');
  const [exportError, setExportError] = useState<string | null>(null);
  const [sbarCopied, setSbarCopied] = useState<boolean>(false);
  const [isCardFlipped, setIsCardFlipped] = useState<boolean>(false);

  const [aCm, setACm] = useState<number>(activeCase.abcVolume?.aCm ?? 3.8);
  const [bCm, setBCm] = useState<number>(activeCase.abcVolume?.bCm ?? 2.4);
  const [slicesCount, setSlicesCount] = useState<number>(activeCase.abcVolume?.slicesCount ?? 6);
  const [thicknessCm, setThicknessCm] = useState<number>(
    activeCase.abcVolume?.sliceThicknessCm ?? 0.5
  );

  const [clinicianName, setClinicianName] = useState<string>(
    activeCase.signOff?.clinicianName ?? 'Dr. M. Chen, MD (Neuroradiology)'
  );
  const [signMode, setSignMode] = useState<'confirmed' | 'overridden'>(
    activeCase.signOff?.status ?? 'confirmed'
  );
  const [overrideSubtype, setOverrideSubtype] = useState<HemorrhageSubtypeId | 'none'>(
    activeCase.signOff?.finalSubtype ?? analysis?.dominantSubtype ?? 'none'
  );
  const [signNotes, setSignNotes] = useState<string>(activeCase.signOff?.notes ?? '');

  const [consultHistoryByCase, setConsultHistoryByCase] = useState<Record<string, ConsultMessage[]>>({});
  const [consultInput, setConsultInput] = useState<string>('');
  const [isConsulting, setIsConsulting] = useState<boolean>(false);
  const [consultError, setConsultError] = useState<string | null>(null);

  useEffect(() => {
    setACm(activeCase.abcVolume?.aCm ?? 3.8);
    setBCm(activeCase.abcVolume?.bCm ?? 2.4);
    setSlicesCount(activeCase.abcVolume?.slicesCount ?? 6);
    setThicknessCm(activeCase.abcVolume?.sliceThicknessCm ?? 0.5);
    setSignMode(activeCase.signOff?.status ?? 'confirmed');
    setOverrideSubtype(activeCase.signOff?.finalSubtype ?? analysis?.dominantSubtype ?? 'none');
    setSignNotes(activeCase.signOff?.notes ?? '');
  }, [activeCase.id, activeCase.abcVolume, activeCase.signOff, analysis?.dominantSubtype]);

  const computedAbcMl = Math.round(((aCm * bCm * (slicesCount * thicknessCm)) / 2) * 10) / 10;

  const sendConsultQuestion = async (questionText: string) => {
    if (!questionText.trim()) return;
    setIsConsulting(true);
    setConsultError(null);

    const caseId = activeCase.id;
    const prevMessages = consultHistoryByCase[caseId] || [];
    const userMsg: ConsultMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      content: questionText.trim(),
      timestamp: new Date().toISOString(),
    };

    setConsultHistoryByCase((prev) => ({
      ...prev,
      [caseId]: [...prevMessages, userMsg],
    }));
    setConsultInput('');

    try {
      const { base64, mimeType } = await imageUrlToBase64(activeSliceImageUrl);
      const reversal = getReversalProtocol(activeCase.clinicalContext.anticoagulant);
      const caseSummary = [
        `Accession: ${activeCase.accessionNumber} | Patient: ${activeCase.clinicalContext.age}Y ${activeCase.clinicalContext.sex} | GCS ${activeCase.clinicalContext.gcs}/15`,
        `Symptoms: ${activeCase.clinicalContext.symptoms}`,
        `Anticoagulation: ${reversal.label}`,
        analysis
          ? `AI Triage: ${analysis.triageLevel} | Dominant Subtype: ${analysis.dominantSubtype} (${analysis.overallProbability.toFixed(
              1
            )}%) | Region: ${analysis.localization.anatomicalRegion} (${analysis.localization.hemisphere})`
          : 'AI Triage: Pending',
        typeof activeCase.measuredMidlineShiftMm === 'number'
          ? `Caliper Midline Shift: ${activeCase.measuredMidlineShiftMm.toFixed(1)} mm`
          : analysis?.secondaryFindings.midlineShiftPresent
          ? `Estimated Midline Shift: ${analysis.secondaryFindings.midlineShiftMmEstimate.toFixed(1)} mm`
          : 'Midline Shift: None',
        activeCase.abcVolume
          ? `ABC/2 Hematoma Volume: ${activeCase.abcVolume.volumeMl.toFixed(1)} mL`
          : '',
      ]
        .filter(Boolean)
        .join('\n');

      const resp = await fetch('/api/clinical-consult', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: questionText.trim(),
          imageBase64: base64,
          mimeType,
          caseSummary,
          history: prevMessages.map((m) => ({ role: m.role, content: m.content })),
        }),
      });

      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data.error || `Consult failed (${resp.status})`);
      }

      const assistantMsg: ConsultMessage = {
        id: `a-${Date.now()}`,
        role: 'assistant',
        content: data.answer,
        timestamp: new Date().toISOString(),
      };

      setConsultHistoryByCase((prev) => ({
        ...prev,
        [caseId]: [...(prev[caseId] || []), assistantMsg],
      }));
    } catch (err: unknown) {
      setConsultError(err instanceof Error ? err.message : 'Unable to complete consult.');
    } finally {
      setIsConsulting(false);
    }
  };

  useEffect(() => {
    if (pendingConsultPrompt && activeTab === 'consult') {
      const q = pendingConsultPrompt;
      onClearPendingConsultPrompt();
      void sendConsultQuestion(q);
    }
  }, [pendingConsultPrompt, activeTab]);

  const handleExportPdf = async () => {
    setExportStatus('exporting');
    setExportError(null);
    try {
      await exportDiagnosticPdf(activeCase);
      setExportStatus('done');
      window.setTimeout(() => setExportStatus('idle'), 2200);
    } catch (err: unknown) {
      setExportError(err instanceof Error ? err.message : 'PDF generation failed.');
      setExportStatus('idle');
    }
  };

  const handleCopySbar = async () => {
    try {
      const sbar = buildNeurosurgerySbar(activeCase);
      await navigator.clipboard.writeText(sbar);
      setSbarCopied(true);
      window.setTimeout(() => setSbarCopied(false), 2000);
    } catch {
      setExportError('Clipboard access denied by browser.');
    }
  };

  const handleDownloadFhir = () => {
    const bundle = buildFhirDiagnosticReport(activeCase);
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `FHIR-DiagnosticReport-${activeCase.accessionNumber}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (errorMessage) {
    return (
      <aside className="relative z-10 surface-3d border border-[#E3DCF5] rounded-xl p-5 flex flex-col gap-4">
        <div className="border border-rose-300 bg-rose-50 rounded-lg p-4">
          <div className="flex items-center gap-2 text-rose-800 text-sm font-semibold">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            Analysis Request Failed
          </div>
          <p className="text-xs text-rose-700 mt-2 leading-relaxed">{errorMessage}</p>
        </div>
        <TactileButton
          variant="primary"
          onClick={onRunLiveAnalysis}
          disabled={isAnalyzing}
          className="px-4 py-2 text-xs font-semibold rounded cursor-pointer"
        >
          Retry CT Analysis
        </TactileButton>
      </aside>
    );
  }

  if (!analysis) {
    return (
      <aside className="relative z-10 surface-3d border border-[#E3DCF5] rounded-xl p-6 flex flex-col items-center justify-center text-center gap-3 min-h-[420px]">
        <Sparkles className="w-7 h-7 text-indigo-600" />
        <h3 className="text-sm font-semibold text-[#1E1B3A]">Ready for Acute CT Triage</h3>
        <p className="text-xs text-[#565278] max-w-xs leading-relaxed">
          Run HemaSTAT 3-window inference to screen this slice across all 5 intracranial hemorrhage
          subtypes and estimate surgical urgency.
        </p>
        <TactileButton
          variant="primary"
          magnetic
          onClick={onRunLiveAnalysis}
          disabled={isAnalyzing}
          className="mt-2 px-4 py-2 text-xs font-semibold rounded cursor-pointer"
        >
          {isAnalyzing ? 'Analyzing Slice...' : 'Analyze Head CT'}
        </TactileButton>
      </aside>
    );
  }

  const triageDisplay = getTriageDisplay(analysis.triageLevel, analysis.isValidHeadCT);
  const reversal = getReversalProtocol(activeCase.clinicalContext.anticoagulant);
  const consultMessages = consultHistoryByCase[activeCase.id] || [];
  const sbarPreviewText = buildNeurosurgerySbar(activeCase);
  const vesselFillPct = Math.min(100, Math.max(4, (computedAbcMl / 50) * 100));

  return (
    <aside className="relative z-10 perspective-stage h-full min-h-[560px]">
      <div
        style={{
          transform: isCardFlipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
          transition: 'transform 560ms cubic-bezier(0.16, 1, 0.3, 1)',
        }}
        className="relative w-full h-full preserve-3d"
      >
        {/* FRONT FACE: CLINICAL TRIAGE PANEL */}
        <div className="backface-hidden surface-3d border border-[#E3DCF5] rounded-xl overflow-hidden flex flex-col h-full">
          {/* Triage Banner Status Card (3D Macro Pop-Out) */}
          <motion.div
            whileHover={{ scale: 1.02, y: -1.5, z: 16 }}
            transition={{ type: 'spring', stiffness: 400, damping: 24 }}
            style={{ transformPerspective: 950, transformStyle: 'preserve-3d' }}
            className={`px-4 py-3 border-b shadow-sm hover:shadow-md hover:z-20 relative ${triageDisplay.bannerClass}`}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                {triageDisplay.icon}
                <span className="text-xs font-semibold tracking-wide truncate">
                  {triageDisplay.label}
                </span>
              </div>
              <span className="text-xs font-mono tabular-nums opacity-85 whitespace-nowrap shrink-0">
                {activeCase.inferenceMs ? `${activeCase.inferenceMs} ms` : 'Validated'}
              </span>
            </div>
            <p className="text-xs mt-1 opacity-90 leading-snug">{analysis.surgicalUrgencyWindow}</p>
          </motion.div>

          {/* Segmented Porcelain Panel Sub-Tabs */}
          <div className="grid grid-cols-3 gap-1.5 p-1.5 bg-[#F3F0FA] border-b border-[#E3DCF5] shrink-0">
            {(
              [
                ['triage', 'Triage'],
                ['calculators', 'Calc & Sign-Off'],
                ['consult', 'Consult'],
              ] as [TriagePanelTab, string][]
            ).map(([tabId, label]) => (
              <TactileButton
                key={tabId}
                variant={activeTab === tabId ? 'active' : 'ghost'}
                onClick={() => onTabChange(tabId)}
                className="py-1.5 text-xs font-medium rounded whitespace-nowrap cursor-pointer"
              >
                {label}
              </TactileButton>
            ))}
          </div>

      {/* TAB 1: TRIAGE */}
      {activeTab === 'triage' && (
        <div className="p-4 space-y-4 overflow-y-auto flex-1 preserve-3d">
          {activeCase.signOff && (
            <TiltCard3D
              maxTiltDeg={6}
              popScale={1.03}
              glowColor="rgba(52, 211, 153, 0.25)"
              className="!bg-[#D1FAE5]/85 !border-emerald-300 px-3 py-2 text-xs"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-emerald-800 font-medium truncate">
                  <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                  <span>
                    {activeCase.signOff.status === 'confirmed' ? 'Confirmed' : 'Overridden'}:{' '}
                    {activeCase.signOff.finalSubtype.toUpperCase()}
                  </span>
                </div>
                <span className="text-[11px] font-mono text-emerald-700 truncate">
                  {activeCase.signOff.clinicianName}
                </span>
              </div>
            </TiltCard3D>
          )}

          {/* Primary 2x2 Tactile 3D Clinical Matrix */}
          {(() => {
            const shiftVal =
              typeof activeCase.measuredMidlineShiftMm === 'number'
                ? activeCase.measuredMidlineShiftMm
                : analysis.secondaryFindings.midlineShiftPresent
                ? analysis.secondaryFindings.midlineShiftMmEstimate
                : 0;
            const criticalShift =
              shiftVal >= 5 || analysis.secondaryFindings.midlineShiftPresent;
            return (
              <div className="grid grid-cols-2 gap-2.5 preserve-3d">
                <TiltCard3D
                  maxTiltDeg={8}
                  popScale={1.04}
                  glowColor={
                    analysis.anyHemorrhage
                      ? 'rgba(251, 113, 133, 0.28)'
                      : 'rgba(52, 211, 153, 0.26)'
                  }
                  className="p-3"
                >
                  <div className="text-[11px] font-medium text-[#565278]">Any Bleed Prob.</div>
                  <div
                    className={`text-xl font-mono font-semibold tabular-nums mt-0.5 ${triageDisplay.textAccent}`}
                  >
                    {analysis.overallProbability.toFixed(1)}%
                  </div>
                  <div className="text-[10px] font-mono text-[#6B668E] mt-0.5 truncate">
                    {activeCase.isLiveInference ? '3-Win Live AI' : 'RSNA Baseline'}
                  </div>
                </TiltCard3D>

                <TiltCard3D maxTiltDeg={8} popScale={1.04} className="p-3">
                  <div className="text-[11px] font-medium text-[#565278]">Primary Subtype</div>
                  <div className="text-xl font-mono font-semibold text-[#1E1B3A] mt-0.5 uppercase truncate">
                    {analysis.anyHemorrhage ? analysis.dominantSubtype : 'NONE'}
                  </div>
                  <div className="text-[10px] font-mono text-[#6B668E] mt-0.5 truncate">
                    {analysis.localization.hemisphere}
                  </div>
                </TiltCard3D>

                <TiltCard3D
                  maxTiltDeg={8}
                  popScale={1.04}
                  glowColor={criticalShift ? 'rgba(251, 113, 133, 0.28)' : undefined}
                  className="p-3"
                >
                  <div className="text-[11px] font-medium text-[#565278]">Midline Shift</div>
                  <div
                    className={`text-base font-mono font-semibold tabular-nums mt-0.5 ${
                      criticalShift ? 'text-rose-700' : 'text-[#1E1B3A]'
                    }`}
                  >
                    {typeof activeCase.measuredMidlineShiftMm === 'number' ||
                    analysis.secondaryFindings.midlineShiftPresent
                      ? `${shiftVal.toFixed(1)} mm`
                      : 'Absent'}
                  </div>
                  <div className="text-[10px] font-mono text-[#6B668E] mt-0.5">
                    {shiftVal >= 5 ? 'Surgical >=5mm' : 'Septum alignment'}
                  </div>
                </TiltCard3D>

                <TiltCard3D maxTiltDeg={8} popScale={1.04} className="p-3">
                  <div className="text-[11px] font-medium text-[#565278]">ABC/2 Volume</div>
                  <div className="text-base font-mono font-semibold tabular-nums text-[#1E1B3A] mt-0.5">
                    {activeCase.abcVolume
                      ? `${activeCase.abcVolume.volumeMl.toFixed(1)} mL`
                      : 'Not calc.'}
                  </div>
                  <div className="text-[10px] font-mono text-[#6B668E] mt-0.5 truncate">
                    Skull Fx:{' '}
                    {analysis.secondaryFindings.skullFractureSuspicion ? 'Suspect' : 'None'}
                  </div>
                </TiltCard3D>
              </div>
            );
          })()}

          {/* Interactive 3D 5-Subtype Breakdown (Click to Focus 3D Brain Compartment) */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-semibold text-[#1E1B3A]">
                5-Subtype Hemorrhage Classification
              </h3>
              <span className="text-[11px] font-mono text-[#6B668E]">
                {focusedSubtype ? '3D Linked' : 'Click to focus 3D'}
              </span>
            </div>

            <div className="space-y-2">
              {SUBTYPE_LABELS.map(({ id, name, code }) => {
                const pred = analysis.subtypes[id];
                const isPrimary = analysis.dominantSubtype === id && analysis.anyHemorrhage;
                const isFocused = focusedSubtype === id;
                const barColor = pred.detected
                  ? isPrimary
                    ? 'bg-gradient-to-r from-[#FB7185] via-[#F43F5E] to-[#FDA4AF] shadow-[0_2px_10px_rgba(244,63,94,0.32)] scan-sweep-sheen'
                    : 'bg-gradient-to-r from-[#FB923C] via-[#FDBA74] to-[#FCD34D] shadow-[0_2px_8px_rgba(251,146,60,0.28)]'
                  : 'bg-gradient-to-r from-[#DDD6FE] to-[#C4B5FD]';

                return (
                  <TiltCard3D
                    key={id}
                    maxTiltDeg={6}
                    popScale={1.03}
                    active={pred.detected || isFocused}
                    onClick={
                      onFocusSubtype ? () => onFocusSubtype(isFocused ? null : id) : undefined
                    }
                    glowColor={
                      pred.detected ? 'rgba(251, 113, 133, 0.26)' : 'rgba(139, 124, 246, 0.2)'
                    }
                    className={`p-2.5 space-y-1.5 ${
                      pred.detected ? '!bg-[#FFF5F7] !border-rose-200' : ''
                    } ${isFocused ? 'ring-2 ring-indigo-500/70' : ''}`}
                  >
                    <div className="flex items-center justify-between text-xs gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span
                          className={`font-medium truncate ${
                            pred.detected ? 'text-[#1E1B3A] font-semibold' : 'text-[#4A4766]'
                          }`}
                        >
                          {name}
                        </span>
                        <span className="text-[11px] font-mono text-[#6B668E] shrink-0">
                          · {code}
                        </span>
                        {isFocused && (
                          <Compass className="w-3 h-3 text-indigo-600 shrink-0" />
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0 font-mono tabular-nums">
                        {pred.detected && (
                          <span className="text-[10px] font-semibold text-rose-700 uppercase">
                            Detected
                          </span>
                        )}
                        <span
                          className={
                            pred.detected ? 'text-[#1E1B3A] font-semibold' : 'text-[#565278]'
                          }
                        >
                          {pred.probability.toFixed(1)}%
                        </span>
                      </div>
                    </div>

                    <div className="h-2 w-full bg-[#F1EDF9] border border-[#DCD5F4] rounded-sm overflow-hidden shadow-inner">
                      <div
                        className={`relative h-full transition-all duration-300 ${barColor}`}
                        style={{ width: `${Math.max(3, Math.min(100, pred.probability))}%` }}
                      />
                    </div>

                    {pred.detected && (
                      <p className="text-[11px] text-[#4A4766] leading-relaxed pt-0.5">
                        {pred.rationale}
                      </p>
                    )}
                  </TiltCard3D>
                );
              })}
            </div>
          </div>

          {/* Aligned Localization & Secondary Summary Status Card (3D Pop-Out) */}
          <TiltCard3D maxTiltDeg={7} popScale={1.03} className="p-3 space-y-1.5 text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[#565278]">Anatomical Region</span>
              <span
                className="text-[#1E1B3A] font-medium text-right truncate max-w-[190px]"
                title={analysis.localization.anatomicalRegion}
              >
                {analysis.localization.anatomicalRegion}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[#565278]">Hydrocephalus Risk</span>
              <span className="text-[#1E1B3A] font-medium">
                {analysis.secondaryFindings.hydrocephalusRisk}
              </span>
            </div>
            {typeof analysis.windowAgreementPct === 'number' && (
              <div className="flex items-center justify-between gap-2">
                <span className="text-[#565278]">3-Window Agreement</span>
                <span className="font-mono tabular-nums text-indigo-700 font-semibold">
                  {analysis.windowAgreementPct.toFixed(0)}%
                </span>
              </div>
            )}
          </TiltCard3D>

          {/* Radiology Impression */}
          <div className="pt-3 border-t border-[#EDE8F8] space-y-1.5">
            <h3 className="text-xs font-semibold text-[#1E1B3A]">Radiology Impression</h3>
            <p className="text-xs text-[#3E3A5E] leading-relaxed">{analysis.radiologyImpression}</p>
            {analysis.differentialCheck && (
              <p className="text-[11px] text-indigo-700 font-medium leading-snug">
                Differential Check: {analysis.differentialCheck}
              </p>
            )}
          </div>

          {/* Emergency Action Plan */}
          {analysis.recommendedActions.length > 0 && (
            <div className="pt-3 border-t border-[#EDE8F8] space-y-2">
              <h3 className="text-xs font-semibold text-[#1E1B3A]">Emergency Action Plan</h3>
              <ul className="space-y-1.5">
                {analysis.recommendedActions.map((action, i) => (
                  <li key={i} className="text-xs text-[#3E3A5E] flex items-start gap-2.5 leading-snug">
                    <span className="inline-flex items-center justify-center w-5 h-5 rounded bg-[#EDE9FE] text-indigo-700 font-mono text-[10px] font-semibold shrink-0 mt-0.5">
                      0{i + 1}
                    </span>
                    <span>{action}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {activeCase.groundTruth && (
            <div className="pt-3 border-t border-[#EDE8F8] space-y-1">
              <div className="flex items-center justify-between text-[11px] font-mono text-[#6B668E]">
                <span>RSNA Radiologist Reference</span>
                <span>{activeCase.groundTruth.rsnaExamRef}</span>
              </div>
              <p className="text-xs text-[#4A4766] leading-relaxed">
                {activeCase.groundTruth.summary}
              </p>
            </div>
          )}
        </div>
      )}

      {/* TAB 2: CLINICAL CALCULATORS & ATTENDING SIGN-OFF */}
      {activeTab === 'calculators' && (
        <div className="p-4 space-y-5 overflow-y-auto flex-1">
          <div className="space-y-2.5 pb-4 border-b border-[#EDE8F8]">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold text-[#1E1B3A]">
                ABC/2 Hematoma Volume Calculator
              </h3>
              <span
                className={`text-sm font-mono font-semibold tabular-nums ${
                  computedAbcMl >= 30 ? 'text-rose-700' : 'text-indigo-700'
                }`}
              >
                {computedAbcMl.toFixed(1)} mL
              </span>
            </div>

            <div className="grid grid-cols-[1fr_76px] gap-3 items-stretch">
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <label className="block text-[11px] text-[#565278] mb-1">A — Length (cm)</label>
                  <input
                    type="number"
                    step={0.1}
                    min={0}
                    value={aCm}
                    onChange={(e) => setACm(Math.max(0, Number(e.target.value)))}
                    className="w-full px-2 py-1 font-mono bg-[#FAF8FF] border border-[#DCD5F4] rounded text-[#1E1B3A] focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-[#565278] mb-1">B — Width (cm)</label>
                  <input
                    type="number"
                    step={0.1}
                    min={0}
                    value={bCm}
                    onChange={(e) => setBCm(Math.max(0, Number(e.target.value)))}
                    className="w-full px-2 py-1 font-mono bg-[#FAF8FF] border border-[#DCD5F4] rounded text-[#1E1B3A] focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-[#565278] mb-1">Slices (#)</label>
                  <input
                    type="number"
                    step={1}
                    min={1}
                    value={slicesCount}
                    onChange={(e) => setSlicesCount(Math.max(1, Number(e.target.value)))}
                    className="w-full px-2 py-1 font-mono bg-[#FAF8FF] border border-[#DCD5F4] rounded text-[#1E1B3A] focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-[#565278] mb-1">Thick (cm)</label>
                  <input
                    type="number"
                    step={0.1}
                    min={0.1}
                    value={thicknessCm}
                    onChange={(e) => setThicknessCm(Math.max(0.1, Number(e.target.value)))}
                    className="w-full px-2 py-1 font-mono bg-[#FAF8FF] border border-[#DCD5F4] rounded text-[#1E1B3A] focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              {/* Liquid-Filled 3D ABC/2 Glass Volume Vessel */}
              <div
                aria-label={`Volume vessel ${computedAbcMl.toFixed(1)} mL`}
                className="relative rounded-2xl border border-[#C4B5FD] bg-gradient-to-b from-white via-[#F6F4FB] to-[#EDE9FE] shadow-[inset_0_4px_12px_rgba(124,111,246,0.14),0_8px_16px_-8px_rgba(91,75,138,0.28)] overflow-hidden flex flex-col justify-end"
              >
                {/* 30 mL Surgical Threshold Line (60% height on 0-50 mL scale) */}
                <div
                  style={{ bottom: '60%' }}
                  className="pointer-events-none absolute inset-x-0 border-t border-dashed border-rose-500/85 z-20 flex justify-end px-1"
                >
                  <span className="text-[9px] font-mono font-semibold text-rose-700 bg-white/80 px-1 rounded -translate-y-1/2">
                    30mL
                  </span>
                </div>

                {/* Animated Rising Pastel Meniscus */}
                <div
                  style={{ height: `${vesselFillPct}%` }}
                  className={`relative w-full transition-all duration-300 ease-out ${
                    computedAbcMl >= 30
                      ? 'bg-gradient-to-t from-rose-500 via-rose-400 to-pink-300'
                      : 'bg-gradient-to-t from-indigo-500 via-violet-400 to-cyan-300'
                  }`}
                >
                  <div className="absolute inset-x-0 top-0 h-1.5 bg-white/55 rounded-full" />
                </div>

                {/* Specular Glass Highlight */}
                <div className="pointer-events-none absolute inset-y-1.5 left-1.5 w-1.5 rounded-full bg-white/60 z-10" />
              </div>
            </div>

            <div className="flex items-center justify-between gap-2 pt-1">
              <span className="text-[11px] text-[#565278]">
                {computedAbcMl >= 30
                  ? 'Exceeds >=30 mL EDH / surgical evacuation threshold'
                  : 'Below 30 mL volumetric operative threshold'}
              </span>
              <TactileButton
                variant="active"
                soundVariant="confirm"
                onClick={() =>
                  onSaveAbcVolume({
                    aCm,
                    bCm,
                    slicesCount,
                    sliceThicknessCm: thicknessCm,
                    volumeMl: computedAbcMl,
                  })
                }
                className="px-3 py-1 text-[11px] font-medium rounded whitespace-nowrap shrink-0 cursor-pointer"
              >
                Save to Study
              </TactileButton>
            </div>
          </div>

          <div className="space-y-2.5 pb-4 border-b border-[#EDE8F8]">
            <h3 className="text-xs font-semibold text-[#1E1B3A]">
              Coagulopathy &amp; STAT Reversal Protocol
            </h3>
            <select
              value={activeCase.clinicalContext.anticoagulant || 'none'}
              onChange={(e) => onChangeAnticoagulant(e.target.value as AnticoagulantType)}
              className="w-full px-2.5 py-1.5 text-xs bg-[#FAF8FF] border border-[#DCD5F4] rounded text-[#1E1B3A] focus:outline-none focus:border-indigo-500"
            >
              <option value="none">No Active Anticoagulation</option>
              <option value="warfarin">Warfarin / VKA</option>
              <option value="xa_inhibitor">Factor Xa Inhibitor (Apixaban / Rivaroxaban)</option>
              <option value="dabigatran">Dabigatran (Direct Thrombin)</option>
              <option value="antiplatelet">Antiplatelet (Aspirin / Clopidogrel)</option>
            </select>

            <div className="text-[11px] text-amber-800 font-semibold">{reversal.urgency}</div>
            <ul className="space-y-1">
              {reversal.regimen.map((step, idx) => (
                <li key={idx} className="text-[11px] text-[#3E3A5E] leading-snug">
                  • {step}
                </li>
              ))}
            </ul>
          </div>

          <div className="space-y-2.5">
            <h3 className="text-xs font-semibold text-[#1E1B3A]">
              Attending Physician Sign-Off &amp; Audit
            </h3>

            <div className="grid grid-cols-2 gap-2">
              <TactileButton
                variant={signMode === 'confirmed' ? 'active' : 'secondary'}
                onClick={() => {
                  setSignMode('confirmed');
                  setOverrideSubtype(analysis.dominantSubtype);
                }}
                className="py-1.5 text-xs font-medium rounded cursor-pointer"
              >
                Confirm AI Read
              </TactileButton>
              <TactileButton
                variant={signMode === 'overridden' ? 'active' : 'secondary'}
                onClick={() => setSignMode('overridden')}
                className="py-1.5 text-xs font-medium rounded cursor-pointer"
              >
                Override / Amend
              </TactileButton>
            </div>

            {signMode === 'overridden' && (
              <div>
                <label className="block text-[11px] text-[#565278] mb-1">
                  Attending Final Diagnosis
                </label>
                <select
                  value={overrideSubtype}
                  onChange={(e) =>
                    setOverrideSubtype(e.target.value as HemorrhageSubtypeId | 'none')
                  }
                  className="w-full px-2.5 py-1.5 text-xs bg-[#FAF8FF] border border-[#DCD5F4] rounded text-[#1E1B3A]"
                >
                  <option value="none">Negative — No Acute Bleed</option>
                  <option value="epidural">Epidural (EDH)</option>
                  <option value="subdural">Subdural (SDH)</option>
                  <option value="subarachnoid">Subarachnoid (SAH)</option>
                  <option value="intraventricular">Intraventricular (IVH)</option>
                  <option value="intraparenchymal">Intraparenchymal (IPH)</option>
                </select>
              </div>
            )}

            <div>
              <label className="block text-[11px] text-[#565278] mb-1">Attending Physician</label>
              <input
                type="text"
                value={clinicianName}
                onChange={(e) => setClinicianName(e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs bg-[#FAF8FF] border border-[#DCD5F4] rounded text-[#1E1B3A]"
              />
            </div>

            <div>
              <label className="block text-[11px] text-[#565278] mb-1">Attestation / Addendum</label>
              <textarea
                rows={2}
                value={signNotes}
                onChange={(e) => setSignNotes(e.target.value)}
                placeholder="Clinical correlation or discrepancy note..."
                className="w-full px-2.5 py-1.5 text-xs bg-[#FAF8FF] border border-[#DCD5F4] rounded text-[#1E1B3A] resize-none"
              />
            </div>

            <TactileButton
              variant="primary"
              magnetic
              soundVariant="confirm"
              onClick={() =>
                onSaveSignOff({
                  status: signMode,
                  clinicianName: clinicianName.trim() || 'Attending Physician',
                  finalSubtype:
                    signMode === 'confirmed' ? analysis.dominantSubtype : overrideSubtype,
                  notes: signNotes.trim(),
                  signedAt: new Date().toISOString(),
                })
              }
              className="w-full py-2 text-xs font-semibold rounded cursor-pointer"
            >
              {activeCase.signOff ? 'Update Attending Sign-Off' : 'Sign & Attest Triage Read'}
            </TactileButton>
          </div>
        </div>
      )}

      {/* TAB 3: SCAN-GROUNDED CLINICAL CONSULT */}
      {activeTab === 'consult' && (
        <div className="flex flex-col flex-1 overflow-hidden">
          <div className="px-4 py-2.5 border-b border-[#EDE8F8] space-y-2 bg-[#FAF8FF]">
            <div className="text-[11px] text-[#565278]">
              Ask scan-specific questions grounded in this CT slice, ABC/2 volume, and guidelines:
            </div>
            <div className="flex flex-wrap gap-1.5">
              {[
                'Does this meet operative evacuation criteria?',
                'Draft a 30s Neurosurgery SBAR handoff',
                'Check for mimics or calcifications',
              ].map((prompt) => (
                <TactileButton
                  key={prompt}
                  variant="secondary"
                  disabled={isConsulting}
                  onClick={() => void sendConsultQuestion(prompt)}
                  className="px-2.5 py-1 text-[11px] text-indigo-700 font-medium rounded cursor-pointer"
                >
                  {prompt}
                </TactileButton>
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {consultMessages.length === 0 ? (
              <div className="text-xs text-[#6B668E] text-center py-8">
                Select a clinical prompt above, circle an ROI on the CT scan, or type a question
                below.
              </div>
            ) : (
              consultMessages.map((msg) => (
                <div
                  key={msg.id}
                  className={`rounded-lg p-3 text-xs leading-relaxed ${
                    msg.role === 'user'
                      ? 'bg-[#EDE9FE] text-[#1E1B3A] ml-6 border border-[#C4B5FD]'
                      : 'bg-white text-[#2D2952] mr-4 border border-[#DCD5F4] shadow-xs'
                  }`}
                >
                  <div className="text-[10px] font-mono text-[#6B668E] mb-1">
                    {msg.role === 'user' ? 'Clinician' : 'Neuroradiology Consult'}
                  </div>
                  <div className="whitespace-pre-wrap">{msg.content}</div>
                </div>
              ))
            )}
            {isConsulting && (
              <div className="flex items-center gap-2 text-xs text-indigo-700 font-medium">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Reviewing CT slice &amp; clinical parameters...
              </div>
            )}
            {consultError && (
              <div className="text-xs text-rose-800 bg-rose-50 border border-rose-200 rounded p-2.5">
                {consultError}
              </div>
            )}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void sendConsultQuestion(consultInput);
            }}
            className="p-3 border-t border-[#E3DCF5] flex items-center gap-2 bg-[#FAF8FF]"
          >
            <input
              type="text"
              value={consultInput}
              onChange={(e) => setConsultInput(e.target.value)}
              placeholder="Ask about herniation risk, reversal, or ROI..."
              className="flex-1 px-3 py-1.5 text-xs bg-white border border-[#DCD5F4] rounded text-[#1E1B3A] placeholder:text-[#78749A] focus:outline-none focus:border-indigo-500"
            />
            <TactileButton
              type="submit"
              variant="primary"
              disabled={isConsulting || !consultInput.trim()}
              className="p-2 disabled:opacity-50 rounded cursor-pointer"
              aria-label="Send consult question"
            >
              <Send className="w-3.5 h-3.5" />
            </TactileButton>
          </form>
        </div>
      )}

      {/* Footer Export Bar: SBAR + FHIR R4 + 3D Card Flip Preview + PDF */}
      <div className="px-3 py-2.5 bg-[#FAF8FF] border-t border-[#E3DCF5] space-y-1.5 no-print shrink-0">
        {exportError && <div className="text-[11px] text-rose-700">{exportError}</div>}
        <div className="flex items-center justify-between gap-1.5">
          <div className="flex items-center gap-1">
            <TactileButton
              variant="secondary"
              soundVariant="confirm"
              onClick={handleCopySbar}
              title="Copy Neurosurgery SBAR Handoff"
              className="h-8 px-2 text-[11px] font-medium text-[#2D2952] rounded whitespace-nowrap shrink-0 cursor-pointer"
            >
              {sbarCopied ? (
                <Check className="w-3 h-3 text-emerald-600" />
              ) : (
                <ClipboardCopy className="w-3 h-3 text-indigo-600" />
              )}
              {sbarCopied ? 'Copied' : 'SBAR'}
            </TactileButton>

            <TactileButton
              variant="secondary"
              soundVariant="confirm"
              onClick={handleDownloadFhir}
              title="Download HL7 FHIR R4 DiagnosticReport JSON"
              className="h-8 px-2 text-[11px] font-medium text-[#2D2952] rounded whitespace-nowrap shrink-0 cursor-pointer"
            >
              <FileCode2 className="w-3 h-3 text-indigo-600" />
              FHIR
            </TactileButton>

            <TactileButton
              variant="secondary"
              onClick={() => setIsCardFlipped(true)}
              title="Flip panel 180deg for 3D SBAR & Diagnostic Card preview"
              className="h-8 px-2 text-[11px] font-medium text-indigo-700 rounded whitespace-nowrap shrink-0 cursor-pointer"
            >
              <RotateCw className="w-3 h-3" />
              3D Preview
            </TactileButton>
          </div>

          <TactileButton
            variant="primary"
            magnetic
            soundVariant="confirm"
            onClick={handleExportPdf}
            disabled={exportStatus === 'exporting'}
            className="h-8 px-2.5 text-xs font-semibold disabled:opacity-60 rounded whitespace-nowrap shrink-0 cursor-pointer"
          >
            {exportStatus === 'exporting' ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                PDF...
              </>
            ) : exportStatus === 'done' ? (
              <>
                <Check className="w-3.5 h-3.5" />
                Saved
              </>
            ) : (
              <>
                <FileDown className="w-3.5 h-3.5" />
                Export PDF
              </>
            )}
          </TactileButton>
        </div>
      </div>
        </div>

        {/* BACK FACE (180deg 3D Diagnostic & SBAR Handoff Card Preview) */}
        <div className="backface-hidden rotate-y-180 absolute inset-0 surface-3d border border-[#A78BFA]/70 rounded-xl overflow-hidden flex flex-col h-full">
          <div className="px-4 py-3 border-b border-[#E3DCF5] bg-gradient-to-r from-[#EDE9FE] via-[#FAF8FF] to-[#E0F2FE] flex items-center justify-between gap-2">
            <div>
              <div className="text-[11px] font-mono font-semibold text-indigo-700">
                3D DIAGNOSTIC CARD · {activeCase.accessionNumber}
              </div>
              <div className="text-xs font-semibold text-[#1E1B3A] truncate">
                {activeCase.clinicalContext.patientId} · Neurosurgery SBAR Preview
              </div>
            </div>
            <TactileButton
              variant="secondary"
              onClick={() => setIsCardFlipped(false)}
              className="px-2.5 py-1 text-[11px] font-medium rounded shrink-0"
            >
              <RotateCw className="w-3 h-3 text-indigo-600" />
              Back
            </TactileButton>
          </div>

          <div className="p-4 flex-1 overflow-y-auto space-y-3 text-xs">
            <div className={`p-2.5 rounded-lg border ${triageDisplay.bannerClass}`}>
              <div className="font-semibold flex items-center gap-1.5">
                {triageDisplay.icon}
                <span>{triageDisplay.label}</span>
              </div>
              <div className="text-[11px] mt-1 font-mono tabular-nums">
                Prob {analysis.overallProbability.toFixed(1)}% · Subtype:{' '}
                {analysis.anyHemorrhage ? analysis.dominantSubtype.toUpperCase() : 'NONE'} · Vol:{' '}
                {activeCase.abcVolume ? `${activeCase.abcVolume.volumeMl.toFixed(1)} mL` : 'N/A'}
              </div>
            </div>

            <div className="rounded-lg border border-[#DCD5F4] bg-[#FAF8FF] p-3 font-mono text-[11px] text-[#2D2952] whitespace-pre-wrap leading-relaxed">
              {sbarPreviewText}
            </div>

            <div className="rounded-lg border border-amber-200 bg-amber-50/70 p-2.5 text-[11px] text-[#4A4766]">
              <div className="font-semibold text-amber-800">{reversal.label}</div>
              <div>{reversal.urgency}</div>
            </div>
          </div>

          <div className="px-3 py-2.5 bg-[#FAF8FF] border-t border-[#E3DCF5] flex items-center justify-between gap-2">
            <TactileButton
              variant="secondary"
              soundVariant="confirm"
              onClick={handleCopySbar}
              className="px-3 py-1.5 text-xs font-medium rounded"
            >
              <ClipboardCopy className="w-3.5 h-3.5 text-indigo-600" />
              {sbarCopied ? 'SBAR Copied' : 'Copy SBAR'}
            </TactileButton>
            <TactileButton
              variant="primary"
              magnetic
              soundVariant="confirm"
              onClick={handleExportPdf}
              className="px-3.5 py-1.5 text-xs font-semibold rounded"
            >
              <FileDown className="w-3.5 h-3.5" />
              Download PDF Report
            </TactileButton>
          </div>
        </div>
      </div>
    </aside>
  );
};
