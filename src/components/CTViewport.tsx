import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Box,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  Columns2,
  Crosshair,
  Eye,
  EyeOff,
  Loader2,
  Maximize2,
  Move,
  RotateCcw,
  Ruler,
  ScanLine,
  Sparkles,
  Trash2,
  Upload,
  Volume2,
  VolumeX,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type {
  CTCase,
  HemorrhageSubtypeId,
  MeasurementLine,
  MidlineShiftOverlay,
  RoiEllipseMeasurement,
  WindowPreset,
} from '../types/ct';
import { WINDOW_PRESETS } from '../data/rsnaCohort';
import { Brain3DViewer } from './three/Brain3DViewer';
import { TactileButton } from './ui/Tactile3D';
import { isTactileAudioMuted, setTactileAudioMuted } from '../utils/hapticSound';

interface CTViewportProps {
  activeCase: CTCase;
  activeSliceIndex: number;
  onChangeSliceIndex: (idx: number) => void;
  isAnalyzing: boolean;
  onRunLiveAnalysis: () => void;
  onFileDropped: (files: File[]) => void;
  onMidlineShiftMeasured: (mm: number) => void;
  onAskConsultAboutRoi: (roiSummary: string) => void;
  focusedSubtype?: HemorrhageSubtypeId | null;
  onSync3dCaliperToAbc?: (cm: number) => void;
}

type ToolMode = 'probe' | 'measure' | 'roi' | 'midline';
type ViewMode = '2d' | '3d' | 'split3d';

function classifyHuTissue(meanHu: number): string {
  if (meanHu >= 150) return 'Bone / Calcification (>150 HU)';
  if (meanHu >= 52 && meanHu <= 95) return 'Acute Blood Range (55–85 HU)';
  if (meanHu >= 25 && meanHu < 52) return 'Brain Parenchyma / Subacute';
  if (meanHu >= 0 && meanHu < 25) return 'CSF / Edema / Chronic';
  return 'Air / Sinus';
}

function pointToLineDistance(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): number {
  const num = Math.abs((y2 - y1) * px - (x2 - x1) * py + x2 * y1 - y2 * x1);
  const den = Math.hypot(y2 - y1, x2 - x1);
  return den === 0 ? 0 : num / den;
}

export const CTViewport: React.FC<CTViewportProps> = ({
  activeCase,
  activeSliceIndex,
  onChangeSliceIndex,
  isAnalyzing,
  onRunLiveAnalysis,
  onFileDropped,
  onMidlineShiftMeasured,
  onAskConsultAboutRoi,
  focusedSubtype = null,
  onSync3dCaliperToAbc,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const basePixelsRef = useRef<Uint8ClampedArray | null>(null);
  const imgDimsRef = useRef<{ w: number; h: number }>({ w: 512, h: 512 });

  const [viewMode, setViewMode] = useState<ViewMode>('split3d');
  const [audioMuted, setAudioMuted] = useState<boolean>(() => isTactileAudioMuted());

  const [presetId, setPresetId] = useState<WindowPreset['id']>('brain');
  const [windowWidth, setWindowWidth] = useState<number>(80);
  const [windowLevel, setWindowLevel] = useState<number>(40);
  const [inverted, setInverted] = useState<boolean>(false);
  const [zoom, setZoom] = useState<number>(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [showOverlay, setShowOverlay] = useState<boolean>(true);
  const [overlayOpacity, setOverlayOpacity] = useState<number>(0.85);
  const [splitCurtain, setSplitCurtain] = useState<boolean>(false);
  const [splitPosPct, setSplitPosPct] = useState<number>(50);
  const [splitRightPreset, setSplitRightPreset] = useState<'subdural' | 'bone'>('subdural');

  const [toolMode, setToolMode] = useState<ToolMode>('probe');
  const [measurements, setMeasurements] = useState<MeasurementLine[]>([]);
  const [pendingPoint, setPendingPoint] = useState<{ x: number; y: number } | null>(null);
  const [roiEllipse, setRoiEllipse] = useState<RoiEllipseMeasurement | null>(null);
  const [roiDragOrigin, setRoiDragOrigin] = useState<{ x: number; y: number } | null>(null);
  const [midlineSteps, setMidlineSteps] = useState<Array<{ x: number; y: number }>>([]);
  const [midlineOverlay, setMidlineOverlay] = useState<MidlineShiftOverlay | null>(null);

  const [hoverInfo, setHoverInfo] = useState<{ x: number; y: number; hu: number } | null>(null);
  const [isDraggingPan, setIsDraggingPan] = useState<boolean>(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isFileDragOver, setIsFileDragOver] = useState<boolean>(false);
  const [imageLoaded, setImageLoaded] = useState<boolean>(false);
  const [imageError, setImageError] = useState<boolean>(false);

  const slices = activeCase.slices;
  const activeSlice = slices && slices.length > 0 ? slices[activeSliceIndex] ?? slices[0] : null;
  const activeImageUrl = activeSlice ? activeSlice.imageUrl : activeCase.imageUrl;
  const activeDicomMeta = activeSlice?.dicomMeta ?? activeCase.dicomMeta;

  const fovMm = activeDicomMeta?.pixelSpacingMm
    ? activeDicomMeta.pixelSpacingMm[0] * (activeDicomMeta.columns || 512)
    : 240;

  useEffect(() => {
    setMeasurements([]);
    setPendingPoint(null);
    setRoiEllipse(null);
    setRoiDragOrigin(null);
    setMidlineSteps([]);
    setMidlineOverlay(null);
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, [activeCase.id]);

  useEffect(() => {
    setImageLoaded(false);
    setImageError(false);
    if (activeDicomMeta?.windowWidth && activeDicomMeta?.windowCenter) {
      setWindowWidth(activeDicomMeta.windowWidth);
      setWindowLevel(activeDicomMeta.windowCenter);
    } else {
      setPresetId('brain');
      setWindowWidth(80);
      setWindowLevel(40);
    }
  }, [activeCase.id, activeImageUrl]);

  useEffect(() => {
    let cancelled = false;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (cancelled) return;
      const w = img.naturalWidth || 512;
      const h = img.naturalHeight || 512;
      imgDimsRef.current = { w, h };

      const off = document.createElement('canvas');
      off.width = w;
      off.height = h;
      const octx = off.getContext('2d');
      if (octx) {
        octx.drawImage(img, 0, 0, w, h);
        basePixelsRef.current = octx.getImageData(0, 0, w, h).data;
      }
      setImageLoaded(true);
    };
    img.onerror = () => {
      if (!cancelled) setImageError(true);
    };
    img.src = activeImageUrl;
    return () => {
      cancelled = true;
    };
  }, [activeImageUrl]);

  const computeByteForPixel = useCallback(
    (idx: number, ww: number, wl: number): number => {
      const huBuffer = activeDicomMeta?.huBuffer;
      if (huBuffer && idx < huBuffer.length) {
        const minHu = wl - ww / 2;
        const range = Math.max(1, ww);
        let norm = ((huBuffer[idx] - minHu) / range) * 255;
        if (norm < 0) norm = 0;
        if (norm > 255) norm = 255;
        if (inverted) norm = 255 - norm;
        return Math.round(norm);
      }
      const basePixels = basePixelsRef.current;
      if (!basePixels) return 0;
      const lum = basePixels[idx * 4] ?? 0;
      if (lum < 8) return inverted ? 255 : 0;
      const contrastGain = Math.min(2.8, Math.max(0.28, 80 / Math.max(20, ww)));
      const levelShift = (40 - wl) * 0.45;
      let mapped = (lum - 105 + levelShift) * contrastGain + 105;
      if (mapped < 0) mapped = 0;
      if (mapped > 255) mapped = 255;
      if (inverted) mapped = 255 - mapped;
      return Math.round(mapped);
    },
    [activeDicomMeta?.huBuffer, inverted]
  );

  const renderCanvas = useCallback(() => {
    if (viewMode === '3d') return;
    const canvas = canvasRef.current;
    if (!canvas || !imageLoaded) return;

    const w = activeDicomMeta?.columns || imgDimsRef.current.w;
    const h = activeDicomMeta?.rows || imgDimsRef.current.h;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const out = ctx.createImageData(w, h);
    const outData = out.data;

    const splitCol = splitCurtain ? Math.round((splitPosPct / 100) * w) : w;
    const rightWw = splitRightPreset === 'bone' ? 2500 : 200;
    const rightWl = splitRightPreset === 'bone' ? 480 : 75;

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const useRight = splitCurtain && x >= splitCol;
        const b = computeByteForPixel(i, useRight ? rightWw : windowWidth, useRight ? rightWl : windowLevel);
        const p = i * 4;
        outData[p] = b;
        outData[p + 1] = b;
        outData[p + 2] = b;
        outData[p + 3] = 255;
      }
    }

    ctx.putImageData(out, 0, 0);
  }, [
    activeDicomMeta?.columns,
    activeDicomMeta?.rows,
    computeByteForPixel,
    imageLoaded,
    splitCurtain,
    splitPosPct,
    splitRightPreset,
    viewMode,
    windowLevel,
    windowWidth,
  ]);

  useEffect(() => {
    renderCanvas();
  }, [renderCanvas]);

  const applyPreset = (preset: WindowPreset) => {
    setPresetId(preset.id);
    setWindowWidth(preset.width);
    setWindowLevel(preset.level);
  };

  const resetView = () => {
    setPresetId('brain');
    setWindowWidth(activeDicomMeta?.windowWidth ?? 80);
    setWindowLevel(activeDicomMeta?.windowCenter ?? 40);
    setInverted(false);
    setSplitCurtain(false);
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setPendingPoint(null);
    setMeasurements([]);
    setRoiEllipse(null);
    setRoiDragOrigin(null);
    setMidlineSteps([]);
    setMidlineOverlay(null);
  };

  const getNormalizedCoords = (e: React.MouseEvent<HTMLDivElement>) => {
    const stage = containerRef.current;
    if (!stage) return null;
    const rect = stage.getBoundingClientRect();
    const relX = ((e.clientX - rect.left) / rect.width) * 100;
    const relY = ((e.clientY - rect.top) / rect.height) * 100;
    return {
      x: Math.max(0, Math.min(100, relX)),
      y: Math.max(0, Math.min(100, relY)),
    };
  };

  const estimateHuAtPercent = (xPct: number, yPct: number): number => {
    const w = activeDicomMeta?.columns || imgDimsRef.current.w;
    const h = activeDicomMeta?.rows || imgDimsRef.current.h;
    const px = Math.min(w - 1, Math.max(0, Math.round((xPct / 100) * w)));
    const py = Math.min(h - 1, Math.max(0, Math.round((yPct / 100) * h)));
    const idx = py * w + px;

    if (activeDicomMeta?.huBuffer && idx < activeDicomMeta.huBuffer.length) {
      return Math.round(activeDicomMeta.huBuffer[idx]);
    }
    if (basePixelsRef.current) {
      const lum = basePixelsRef.current[idx * 4] ?? 0;
      if (lum < 12) return -1000;
      if (lum > 235) return 750;
      return Math.round(((lum - 20) / 215) * 105 - 10);
    }
    return 0;
  };

  const computeRoiStats = (cx: number, cy: number, rx: number, ry: number): RoiEllipseMeasurement => {
    const w = activeDicomMeta?.columns || imgDimsRef.current.w;
    const h = activeDicomMeta?.rows || imgDimsRef.current.h;
    const rxSafe = Math.max(2, rx);
    const rySafe = Math.max(2, ry);

    const minPxX = Math.max(0, Math.floor(((cx - rxSafe) / 100) * w));
    const maxPxX = Math.min(w - 1, Math.ceil(((cx + rxSafe) / 100) * w));
    const minPxY = Math.max(0, Math.floor(((cy - rySafe) / 100) * h));
    const maxPxY = Math.min(h - 1, Math.ceil(((cy + rySafe) / 100) * h));

    let sum = 0;
    let count = 0;
    let maxHu = -1500;
    let minHu = 3000;

    for (let py = minPxY; py <= maxPxY; py++) {
      for (let px = minPxX; px <= maxPxX; px++) {
        const xPct = (px / w) * 100;
        const yPct = (py / h) * 100;
        const normDist = ((xPct - cx) / rxSafe) ** 2 + ((yPct - cy) / rySafe) ** 2;
        if (normDist <= 1) {
          const hu = estimateHuAtPercent(xPct, yPct);
          sum += hu;
          count++;
          if (hu > maxHu) maxHu = hu;
          if (hu < minHu) minHu = hu;
        }
      }
    }

    const meanHu = count > 0 ? Math.round(sum / count) : 0;
    const rxMm = (rxSafe / 100) * fovMm;
    const ryMm = (rySafe / 100) * fovMm;
    const areaCm2 = Math.round(((Math.PI * rxMm * ryMm) / 100) * 100) / 100;

    return {
      cx,
      cy,
      rx: rxSafe,
      ry: rySafe,
      areaCm2,
      meanHu,
      maxHu: count > 0 ? maxHu : 0,
      minHu: count > 0 ? minHu : 0,
      tissueHint: classifyHuTissue(meanHu),
    };
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    const coords = getNormalizedCoords(e);
    if (!coords) return;

    if (toolMode === 'measure') {
      if (!pendingPoint) {
        setPendingPoint(coords);
      } else {
        const dxMm = ((coords.x - pendingPoint.x) / 100) * fovMm;
        const dyMm = ((coords.y - pendingPoint.y) / 100) * fovMm;
        const lengthMm = Math.sqrt(dxMm * dxMm + dyMm * dyMm);
        setMeasurements((prev) => [
          ...prev,
          {
            id: `m-${Date.now()}`,
            x1: pendingPoint.x,
            y1: pendingPoint.y,
            x2: coords.x,
            y2: coords.y,
            lengthMm: Math.round(lengthMm * 10) / 10,
          },
        ]);
        setPendingPoint(null);
      }
      return;
    }

    if (toolMode === 'roi') {
      setRoiDragOrigin(coords);
      setRoiEllipse(null);
      return;
    }

    if (toolMode === 'midline') {
      const next = [...midlineSteps, coords];
      if (next.length < 3) {
        setMidlineSteps(next);
      } else {
        const [f1, f2, septum] = next;
        const distPct = pointToLineDistance(septum.x, septum.y, f1.x, f1.y, f2.x, f2.y);
        const shiftMm = Math.round(((distPct / 100) * fovMm) * 10) / 10;
        setMidlineOverlay({
          falxX1: f1.x,
          falxY1: f1.y,
          falxX2: f2.x,
          falxY2: f2.y,
          septumX: septum.x,
          septumY: septum.y,
          shiftMm,
        });
        setMidlineSteps([]);
        onMidlineShiftMeasured(shiftMm);
      }
      return;
    }

    setIsDraggingPan(true);
    setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const coords = getNormalizedCoords(e);
    if (coords) {
      setHoverInfo({
        x: Math.round(coords.x),
        y: Math.round(coords.y),
        hu: estimateHuAtPercent(coords.x, coords.y),
      });
    }

    if (toolMode === 'roi' && roiDragOrigin && coords) {
      const cx = (roiDragOrigin.x + coords.x) / 2;
      const cy = (roiDragOrigin.y + coords.y) / 2;
      const rx = Math.abs(coords.x - roiDragOrigin.x) / 2;
      const ry = Math.abs(coords.y - roiDragOrigin.y) / 2;
      if (rx > 1 && ry > 1) {
        setRoiEllipse(computeRoiStats(cx, cy, rx, ry));
      }
      return;
    }

    if (isDraggingPan && toolMode === 'probe') {
      setPan({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y,
      });
    }
  };

  const handleMouseUp = () => {
    setIsDraggingPan(false);
    setRoiDragOrigin(null);
  };

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (slices && slices.length > 1 && !e.ctrlKey && !e.metaKey) {
      const step = e.deltaY > 0 ? 1 : -1;
      const next = Math.max(0, Math.min(slices.length - 1, activeSliceIndex + step));
      onChangeSliceIndex(next);
      return;
    }
    const delta = e.deltaY < 0 ? 0.15 : -0.15;
    setZoom((prev) => Math.min(3.5, Math.max(0.75, Math.round((prev + delta) * 100) / 100)));
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsFileDragOver(false);
    const list = e.dataTransfer.files ? Array.from(e.dataTransfer.files) : [];
    if (list.length > 0) {
      onFileDropped(list);
    }
  };

  const toggleSound = () => {
    const next = !audioMuted;
    setTactileAudioMuted(next);
    setAudioMuted(next);
  };

  const analysis = activeCase.analysis;
  const loc = analysis?.localization;
  const showRoi = showOverlay && analysis?.anyHemorrhage && loc && loc.radiusPercent > 0;

  return (
    <section
      className="relative z-10 flex flex-col surface-3d border border-[#E3DCF5] rounded-xl overflow-hidden h-full min-h-[560px]"
      onDragOver={(e) => {
        e.preventDefault();
        setIsFileDragOver(true);
      }}
      onDragLeave={() => setIsFileDragOver(false)}
      onDrop={handleDrop}
    >
      {/* Top Tactile Studio Header Bar (Row 1: Modes, Window Presets, Run AI CTA) */}
      <div className="bg-[#FAF8FF] border-b border-[#E3DCF5] shrink-0">
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 bg-[#F3F0FA] p-1 rounded-lg border border-[#E3DCF5]">
              {(
                [
                  ['split3d', '2D + 3D'],
                  ['3d', '3D Skull'],
                  ['2d', '2D PACS'],
                ] as [ViewMode, string][]
              ).map(([mode, label]) => (
                <TactileButton
                  key={mode}
                  variant={viewMode === mode ? 'active' : 'ghost'}
                  onClick={() => setViewMode(mode)}
                  className="px-2.5 py-1 text-[11px] font-semibold rounded whitespace-nowrap shrink-0"
                >
                  {mode !== '2d' && <Box className="w-3 h-3" />}
                  {label}
                </TactileButton>
              ))}
            </div>

            {viewMode !== '3d' && (
              <div className="flex items-center gap-1 bg-[#F3F0FA] p-1 rounded-lg border border-[#E3DCF5]">
                {WINDOW_PRESETS.map((preset) => (
                  <TactileButton
                    key={preset.id}
                    variant={presetId === preset.id ? 'active' : 'ghost'}
                    onClick={() => applyPreset(preset)}
                    title={preset.description}
                    className="px-2.5 py-1 text-[11px] font-medium rounded whitespace-nowrap shrink-0"
                  >
                    {preset.label.split(' ')[0]}
                  </TactileButton>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center gap-1.5">
            <TactileButton
              variant="secondary"
              onClick={toggleSound}
              title={audioMuted ? 'Enable tactile audio cues' : 'Mute tactile audio cues'}
              className="p-1.5 text-[#3E3A5E] rounded"
            >
              {audioMuted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5 text-indigo-600" />}
            </TactileButton>

            <TactileButton
              variant="primary"
              magnetic
              onClick={onRunLiveAnalysis}
              disabled={isAnalyzing}
              className="px-3.5 py-1.5 text-xs font-semibold rounded whitespace-nowrap shrink-0 cursor-pointer"
            >
              {isAnalyzing ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Analyzing 3-Win...
                </>
              ) : (
                <>
                  <Sparkles className="w-3.5 h-3.5" />
                  {activeCase.isLiveInference ? 'Re-Run 3-Win AI' : 'Run 3-Win Live AI'}
                </>
              )}
            </TactileButton>
          </div>
        </div>

        {/* Row 2: Precision PACS Tools & View Controls (only when 2D canvas is active) */}
        {viewMode !== '3d' && (
          <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5 bg-[#F4F0FC]/85 border-t border-[#EAE3FA]">
            <div className="flex flex-wrap items-center gap-1.5">
              <TactileButton
                variant={toolMode === 'probe' ? 'active' : 'secondary'}
                onClick={() => setToolMode('probe')}
                title="Pan & Pixel HU Probe"
                className="px-2.5 py-1 text-[11px] font-medium rounded whitespace-nowrap shrink-0"
              >
                <Move className="w-3 h-3" />
                Pan
              </TactileButton>

              <TactileButton
                variant={toolMode === 'measure' ? 'active' : 'secondary'}
                onClick={() => {
                  setToolMode(toolMode === 'measure' ? 'probe' : 'measure');
                  setPendingPoint(null);
                }}
                title="2-Point Millimeter Caliper"
                className="px-2.5 py-1 text-[11px] font-medium rounded whitespace-nowrap shrink-0"
              >
                <Ruler className="w-3 h-3" />
                Caliper
              </TactileButton>

              <TactileButton
                variant={toolMode === 'roi' ? 'active' : 'secondary'}
                onClick={() => setToolMode(toolMode === 'roi' ? 'probe' : 'roi')}
                title="ROI Ellipse HU Statistics"
                className="px-2.5 py-1 text-[11px] font-medium rounded whitespace-nowrap shrink-0"
              >
                <CircleDot className="w-3 h-3" />
                ROI HU
              </TactileButton>

              <TactileButton
                variant={toolMode === 'midline' ? 'active' : 'secondary'}
                onClick={() => {
                  setToolMode(toolMode === 'midline' ? 'probe' : 'midline');
                  setMidlineSteps([]);
                }}
                title="Midline Shift Tool (2 clicks on falx + 1 click on septum pellucidum)"
                className="px-2.5 py-1 text-[11px] font-medium rounded whitespace-nowrap shrink-0"
              >
                <ScanLine className="w-3 h-3" />
                Midline
              </TactileButton>

              <TactileButton
                variant={splitCurtain ? 'active' : 'secondary'}
                onClick={() => setSplitCurtain((v) => !v)}
                title="Dual-Window Curtain Comparison"
                className="px-2.5 py-1 text-[11px] font-medium rounded whitespace-nowrap shrink-0"
              >
                <Columns2 className="w-3 h-3" />
                Split
              </TactileButton>

              <TactileButton
                variant={inverted ? 'active' : 'secondary'}
                onClick={() => setInverted((v) => !v)}
                title="Invert Grayscale Polarity"
                className="px-2.5 py-1 text-[11px] font-medium rounded whitespace-nowrap shrink-0"
              >
                Invert
              </TactileButton>

              <TactileButton
                variant={showOverlay ? 'active' : 'secondary'}
                onClick={() => setShowOverlay((v) => !v)}
                title="Toggle AI Localization Overlay"
                className="px-2.5 py-1 text-[11px] font-medium rounded whitespace-nowrap shrink-0"
              >
                {showOverlay ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                AI ROI
              </TactileButton>
            </div>

            <div className="flex items-center gap-1.5">
              {(measurements.length > 0 || roiEllipse || midlineOverlay) && (
                <TactileButton
                  variant="secondary"
                  onClick={() => {
                    setMeasurements([]);
                    setRoiEllipse(null);
                    setMidlineOverlay(null);
                    setMidlineSteps([]);
                  }}
                  title="Clear annotations"
                  className="p-1.5 text-rose-600 rounded"
                >
                  <Trash2 className="w-3 h-3" />
                </TactileButton>
              )}

              <TactileButton
                variant="secondary"
                onClick={() => setZoom((z) => Math.min(3.5, Math.round((z + 0.25) * 100) / 100))}
                title="Zoom In"
                className="p-1.5 text-[#3E3A5E] rounded"
              >
                <ZoomIn className="w-3 h-3" />
              </TactileButton>
              <TactileButton
                variant="secondary"
                onClick={() => setZoom((z) => Math.max(0.75, Math.round((z - 0.25) * 100) / 100))}
                title="Zoom Out"
                className="p-1.5 text-[#3E3A5E] rounded"
              >
                <ZoomOut className="w-3 h-3" />
              </TactileButton>
              <TactileButton
                variant="secondary"
                onClick={resetView}
                title="Reset View"
                className="p-1.5 text-[#3E3A5E] rounded"
              >
                <RotateCcw className="w-3 h-3" />
              </TactileButton>
            </div>
          </div>
        )}
      </div>

      {/* Main Split / 2D / 3D Viewport Area (Stacks vertically below 2xl so neither 2D nor 3D gets squeezed) */}
      <div
        className={`relative flex-1 bg-[#EDE9F8] min-h-[450px] grid ${
          viewMode === 'split3d'
            ? 'grid-cols-1 2xl:grid-cols-2 divide-y 2xl:divide-y-0 2xl:divide-x divide-[#DCD5F4]'
            : 'grid-cols-1'
        }`}
      >
        {/* 2D PACS Canvas Panel (inner scan frame stays dark for medical HU grayscale legibility) */}
        {viewMode !== '3d' && (
          <div className="relative flex items-center justify-center overflow-hidden select-none min-h-[380px] 2xl:min-h-[440px] bg-[#07090F]">
            <span className="pointer-events-none absolute top-1.5 left-1/2 -translate-x-1/2 text-[10px] font-mono text-slate-400 z-10">
              A
            </span>
            <span className="pointer-events-none absolute bottom-1.5 left-1/2 -translate-x-1/2 text-[10px] font-mono text-slate-400 z-10">
              P
            </span>
            <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[10px] font-mono text-slate-400 z-10">
              R
            </span>
            <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-mono text-slate-400 z-10">
              L
            </span>

            <div className="pointer-events-none absolute top-2.5 left-3 z-10 text-[11px] font-mono tabular-nums text-slate-300 space-y-0.5 max-w-[56%]">
              <div className="text-white font-semibold truncate">{activeCase.accessionNumber}</div>
              <div className="text-slate-400 truncate">
                {activeCase.clinicalContext.patientId} · {activeCase.clinicalContext.age}Y{' '}
                {activeCase.clinicalContext.sex} · GCS {activeCase.clinicalContext.gcs}/15
              </div>
              {activeDicomMeta && (
                <div className="text-violet-300 truncate">
                  DICOM {activeDicomMeta.columns}×{activeDicomMeta.rows}
                  {activeDicomMeta.sliceThicknessMm ? ` · ${activeDicomMeta.sliceThicknessMm}mm` : ''}
                </div>
              )}
              {slices && slices.length > 1 && (
                <div className="text-emerald-300">
                  Slice {activeSliceIndex + 1} / {slices.length}
                </div>
              )}
            </div>

            <div className="pointer-events-none absolute top-2.5 right-3 z-10 text-right text-[11px] font-mono tabular-nums text-slate-400 space-y-0.5">
              <div>
                W {windowWidth} / L {windowLevel}
              </div>
              <div>
                Zoom {zoom.toFixed(2)}× · FOV {Math.round(fovMm)}mm
              </div>
            </div>

            {roiEllipse && (
              <div className="absolute top-14 right-3 z-20 bg-white/95 border border-[#A78BFA]/60 rounded-lg p-2.5 text-[11px] font-mono tabular-nums w-56 space-y-1.5 shadow-xl text-[#1E1B3A]">
                <div className="flex items-center justify-between text-indigo-700 font-semibold">
                  <span>ROI HU Inspector</span>
                  <span>{roiEllipse.areaCm2.toFixed(2)} cm²</span>
                </div>
                <div className="flex justify-between text-[#3E3A5E]">
                  <span>Mean: {roiEllipse.meanHu} HU</span>
                  <span>Max: {roiEllipse.maxHu} HU</span>
                </div>
                <div className="text-[#565278] text-[10px]">{roiEllipse.tissueHint}</div>
                <TactileButton
                  variant="active"
                  onClick={() =>
                    onAskConsultAboutRoi(
                      `Evaluate the region I circled (${roiEllipse.areaCm2.toFixed(
                        2
                      )} cm², Mean ${roiEllipse.meanHu} HU, Max ${roiEllipse.maxHu} HU, ${
                        roiEllipse.tissueHint
                      }). Is this acute hemorrhage, calcification, or normal structure?`
                    )
                  }
                  className="w-full py-1 px-2 text-[11px] font-sans font-medium rounded"
                >
                  Ask Consult About ROI
                </TactileButton>
              </div>
            )}

            {(toolMode === 'midline' || midlineOverlay) && (
              <div className="absolute top-20 left-3 z-20 bg-white/95 border border-[#DCD5F4] rounded-lg px-3 py-2 text-[11px] font-mono max-w-[230px] shadow-xl text-[#1E1B3A]">
                {midlineOverlay ? (
                  <div className="space-y-0.5">
                    <div className="text-[#565278]">Measured Midline Shift</div>
                    <div
                      className={`text-sm font-semibold tabular-nums ${
                        midlineOverlay.shiftMm >= 5 ? 'text-rose-600' : 'text-indigo-700'
                      }`}
                    >
                      {midlineOverlay.shiftMm.toFixed(1)} mm
                      {midlineOverlay.shiftMm >= 5 ? ' (Surgical >=5mm)' : ''}
                    </div>
                  </div>
                ) : (
                  <div className="text-indigo-700 font-medium">
                    {midlineSteps.length === 0
                      ? 'Step 1/3: Click anterior falx midline'
                      : midlineSteps.length === 1
                      ? 'Step 2/3: Click posterior falx midline'
                      : 'Step 3/3: Click displaced septum pellucidum'}
                  </div>
                )}
              </div>
            )}

            {splitCurtain && (
              <div className="absolute bottom-3 left-3 z-20 bg-white/95 border border-[#DCD5F4] rounded-lg px-3 py-1.5 flex items-center gap-3 text-[11px] text-[#1E1B3A] shadow-lg">
                <span className="font-mono text-[#4A4766]">Right:</span>
                <select
                  value={splitRightPreset}
                  onChange={(e) => setSplitRightPreset(e.target.value as 'subdural' | 'bone')}
                  className="bg-[#F3F0FA] border border-[#DCD5F4] rounded px-1.5 py-0.5 text-indigo-700 font-mono"
                >
                  <option value="subdural">Subdural (W200/L75)</option>
                  <option value="bone">Bone (W2500/L480)</option>
                </select>
                <input
                  type="range"
                  min={10}
                  max={90}
                  value={splitPosPct}
                  onChange={(e) => setSplitPosPct(Number(e.target.value))}
                  className="w-24 accent-indigo-500"
                  aria-label="Split curtain position"
                />
              </div>
            )}

            {/* Transformable CT Stage */}
            <div
              ref={containerRef}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={() => {
                setIsDraggingPan(false);
                setHoverInfo(null);
              }}
              onWheel={handleWheel}
              style={{
                transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})`,
              }}
              className={`relative aspect-square w-full max-w-[380px] max-h-[380px] 2xl:max-w-[420px] 2xl:max-h-[420px] transition-transform duration-75 ease-out ${
                toolMode !== 'probe'
                  ? 'cursor-crosshair'
                  : isDraggingPan
                  ? 'cursor-grabbing'
                  : 'cursor-grab'
              }`}
            >
              {imageError ? (
                <div className="w-full h-full flex flex-col items-center justify-center border border-slate-800 bg-slate-950 text-slate-400 p-6 text-center">
                  <Maximize2 className="w-8 h-8 mb-2 text-slate-600" />
                  <p className="text-sm font-medium text-slate-300">Unable to decode CT image frame</p>
                </div>
              ) : (
                <canvas ref={canvasRef} className="w-full h-full object-contain block" />
              )}

              <svg
                viewBox="0 0 100 100"
                className="pointer-events-none absolute inset-0 w-full h-full"
                preserveAspectRatio="none"
              >
                {splitCurtain && (
                  <line
                    x1={splitPosPct}
                    y1={0}
                    x2={splitPosPct}
                    y2={100}
                    stroke="#A78BFA"
                    strokeWidth="0.5"
                    strokeDasharray="2 1"
                  />
                )}

                {showRoi && loc && (
                  <g style={{ opacity: overlayOpacity }}>
                    <circle
                      cx={loc.xPercent}
                      cy={loc.yPercent}
                      r={Math.max(6, loc.radiusPercent)}
                      fill={
                        analysis?.triageLevel === 'STAT_SURGICAL'
                          ? 'rgba(244,63,94,0.16)'
                          : 'rgba(245,158,11,0.16)'
                      }
                      stroke={analysis?.triageLevel === 'STAT_SURGICAL' ? '#FB7185' : '#FBBF24'}
                      strokeWidth="0.6"
                      strokeDasharray="2 1.4"
                    />
                    <line
                      x1={loc.xPercent - 2.2}
                      y1={loc.yPercent}
                      x2={loc.xPercent + 2.2}
                      y2={loc.yPercent}
                      stroke="#A78BFA"
                      strokeWidth="0.4"
                    />
                    <line
                      x1={loc.xPercent}
                      y1={loc.yPercent - 2.2}
                      x2={loc.xPercent}
                      y2={loc.yPercent + 2.2}
                      stroke="#A78BFA"
                      strokeWidth="0.4"
                    />
                  </g>
                )}

                {roiEllipse && (
                  <ellipse
                    cx={roiEllipse.cx}
                    cy={roiEllipse.cy}
                    rx={roiEllipse.rx}
                    ry={roiEllipse.ry}
                    fill="rgba(167, 139, 250, 0.16)"
                    stroke="#C4B5FD"
                    strokeWidth="0.55"
                  />
                )}

                {midlineSteps.map((pt, idx) => (
                  <circle key={idx} cx={pt.x} cy={pt.y} r="1.1" fill="#FBBF24" />
                ))}
                {midlineSteps.length === 2 && (
                  <line
                    x1={midlineSteps[0].x}
                    y1={midlineSteps[0].y}
                    x2={midlineSteps[1].x}
                    y2={midlineSteps[1].y}
                    stroke="#FBBF24"
                    strokeWidth="0.45"
                    strokeDasharray="1.5 1"
                  />
                )}
                {midlineOverlay && (
                  <g>
                    <line
                      x1={midlineOverlay.falxX1}
                      y1={midlineOverlay.falxY1}
                      x2={midlineOverlay.falxX2}
                      y2={midlineOverlay.falxY2}
                      stroke="#FBBF24"
                      strokeWidth="0.5"
                      strokeDasharray="1.5 1"
                    />
                    <circle
                      cx={midlineOverlay.septumX}
                      cy={midlineOverlay.septumY}
                      r="1.2"
                      fill={midlineOverlay.shiftMm >= 5 ? '#FB7185' : '#6EE7B7'}
                    />
                  </g>
                )}

                {measurements.map((m) => {
                  const mx = (m.x1 + m.x2) / 2;
                  const my = (m.y1 + m.y2) / 2;
                  return (
                    <g key={m.id}>
                      <line x1={m.x1} y1={m.y1} x2={m.x2} y2={m.y2} stroke="#A78BFA" strokeWidth="0.6" />
                      <circle cx={m.x1} cy={m.y1} r="1" fill="#A78BFA" />
                      <circle cx={m.x2} cy={m.y2} r="1" fill="#A78BFA" />
                      <rect
                        x={mx - 8}
                        y={my - 5.2}
                        width="16"
                        height="4.2"
                        rx="0.8"
                        fill="rgba(255,255,255,0.92)"
                        stroke="#8B5CF6"
                        strokeWidth="0.25"
                      />
                      <text
                        x={mx}
                        y={my - 2.3}
                        textAnchor="middle"
                        fill="#1E1B3A"
                        fontSize="2.5"
                        fontFamily="IBM Plex Mono, monospace"
                      >
                        {m.lengthMm.toFixed(1)} mm
                      </text>
                    </g>
                  );
                })}

                {pendingPoint && hoverInfo && (
                  <line
                    x1={pendingPoint.x}
                    y1={pendingPoint.y}
                    x2={hoverInfo.x}
                    y2={hoverInfo.y}
                    stroke="#A78BFA"
                    strokeWidth="0.45"
                    strokeDasharray="1.5 1.5"
                  />
                )}
              </svg>
            </div>
          </div>
        )}

        {/* 3D Interactive Cranial Volumetric Reconstruction Panel */}
        {viewMode !== '2d' && (
          <div className="relative min-h-[420px] h-full">
            <Brain3DViewer
              activeCase={activeCase}
              activeImageUrl={activeImageUrl}
              activeSliceIndex={activeSliceIndex}
              totalSlices={slices?.length ?? 1}
              isAnalyzing={isAnalyzing}
              focusedSubtype={focusedSubtype}
              onSync3dCaliperToAbc={onSync3dCaliperToAbc}
              onAskConsultAboutPart={onAskConsultAboutRoi}
            />
          </div>
        )}

        {/* Multi-File Drop Overlay */}
        {isFileDragOver && (
          <div className="absolute inset-0 z-30 bg-[#F6F4FB]/94 border-2 border-dashed border-indigo-400 flex flex-col items-center justify-center gap-2 text-center p-6">
            <Upload className="w-8 h-8 text-indigo-600" />
            <p className="text-sm font-semibold text-[#1E1B3A]">
              Drop Single Slice or Multi-Slice CT Stack (.dcm, .png, .jpg)
            </p>
            <p className="text-xs text-[#565278]">
              Automatically strips DICOM PHI tags &amp; runs 3-window hemorrhage triage
            </p>
          </div>
        )}

        {/* Inference Loading Overlay */}
        {isAnalyzing && (
          <div className="absolute inset-0 z-25 bg-[#EDE9F8]/88 flex flex-col items-center justify-center gap-3">
            <Loader2 className="w-8 h-8 text-indigo-600 animate-spin" />
            <div className="text-center">
              <p className="text-sm font-semibold text-[#1E1B3A]">
                Running 3-Window Differential Triage
              </p>
              <p className="text-xs font-mono text-[#565278] mt-1">
                Brain W80/L40 · Subdural W200/L75 · Bone W2500/L480
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Z-Axis Multi-Slice Series Scrubber */}
      {slices && slices.length > 1 && (
        <div className="px-4 py-2 bg-[#FAF8FF] border-t border-[#E3DCF5] flex items-center gap-3 text-xs">
          <span className="font-mono text-[#4A4766] whitespace-nowrap">Z-Stack</span>
          <TactileButton
            variant="secondary"
            onClick={() => onChangeSliceIndex(Math.max(0, activeSliceIndex - 1))}
            disabled={activeSliceIndex === 0}
            className="p-1 text-[#3E3A5E] disabled:opacity-30 rounded"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </TactileButton>
          <input
            type="range"
            min={0}
            max={slices.length - 1}
            value={activeSliceIndex}
            onChange={(e) => onChangeSliceIndex(Number(e.target.value))}
            className="flex-1 accent-indigo-500 h-1.5 bg-[#E8E2F7] rounded cursor-pointer"
          />
          <TactileButton
            variant="secondary"
            onClick={() => onChangeSliceIndex(Math.min(slices.length - 1, activeSliceIndex + 1))}
            disabled={activeSliceIndex === slices.length - 1}
            className="p-1 text-[#3E3A5E] disabled:opacity-30 rounded"
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </TactileButton>
          <span className="font-mono tabular-nums text-indigo-700 font-medium whitespace-nowrap">
            {activeSliceIndex + 1}/{slices.length}
          </span>
        </div>
      )}

      {/* Bottom Window/Level Scrubbers + HU Probe Status Bar */}
      {viewMode !== '3d' && (
        <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-2 bg-[#FAF8FF] border-t border-[#E3DCF5] text-xs">
          <div className="flex items-center gap-2 flex-1 min-w-[130px]">
            <label className="text-[#4A4766] font-mono whitespace-nowrap" htmlFor="ww-slider">
              W
            </label>
            <input
              id="ww-slider"
              type="range"
              min={30}
              max={2500}
              step={10}
              value={windowWidth}
              onChange={(e) => setWindowWidth(Number(e.target.value))}
              className="w-full accent-indigo-500 h-1.5 bg-[#E8E2F7] rounded cursor-pointer"
            />
            <span className="font-mono tabular-nums text-[#1E1B3A] w-10 text-right">
              {windowWidth}
            </span>
          </div>

          <div className="flex items-center gap-2 flex-1 min-w-[130px]">
            <label className="text-[#4A4766] font-mono whitespace-nowrap" htmlFor="wl-slider">
              L
            </label>
            <input
              id="wl-slider"
              type="range"
              min={-100}
              max={600}
              step={5}
              value={windowLevel}
              onChange={(e) => setWindowLevel(Number(e.target.value))}
              className="w-full accent-indigo-500 h-1.5 bg-[#E8E2F7] rounded cursor-pointer"
            />
            <span className="font-mono tabular-nums text-[#1E1B3A] w-10 text-right">
              {windowLevel}
            </span>
          </div>

          {showOverlay && (
            <div className="flex items-center gap-2 min-w-[115px]">
              <span className="text-[#4A4766] font-mono whitespace-nowrap">ROI</span>
              <input
                type="range"
                min={0.15}
                max={1}
                step={0.05}
                value={overlayOpacity}
                onChange={(e) => setOverlayOpacity(Number(e.target.value))}
                className="w-20 accent-indigo-500 h-1.5 bg-[#E8E2F7] rounded cursor-pointer"
                aria-label="AI ROI overlay opacity"
              />
            </div>
          )}

          <div className="flex items-center gap-2 text-[#4A4766] font-mono text-[11px] tabular-nums whitespace-nowrap">
            <Crosshair className="w-3 h-3 text-indigo-600 shrink-0" />
            <span>
              {hoverInfo
                ? `(${hoverInfo.x}%, ${hoverInfo.y}%) · ${hoverInfo.hu} HU`
                : slices && slices.length > 1
                ? 'Wheel: Slice'
                : 'Hover slice for HU'}
            </span>
          </div>
        </div>
      )}
    </section>
  );
};
