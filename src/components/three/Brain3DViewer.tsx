import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  Activity,
  ChevronDown,
  ChevronUp,
  Compass,
  Crosshair,
  Eye,
  GitBranch,
  Layers,
  MapPin,
  Radio,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Timer,
  Zap,
} from 'lucide-react';
import type { CTCase, HemorrhageSubtypeId } from '../../types/ct';
import {
  detectSoftwareWebGL,
  prefersReducedMotion,
  scheduleAfterDraw,
} from '../../utils/webglDetect';
import {
  playAnatomicalChime,
  playTriagePulseBeat,
  type AnatomicalSoundRegion,
} from '../../utils/hapticSound';
import { TactileButton } from '../ui/Tactile3D';

interface Brain3DViewerProps {
  activeCase: CTCase;
  activeImageUrl: string;
  activeSliceIndex: number;
  totalSlices: number;
  isAnalyzing?: boolean;
  focusedSubtype?: HemorrhageSubtypeId | null;
  onSync3dCaliperToAbc?: (cmDistance: number) => void;
  onAskConsultAboutPart?: (prompt: string) => void;
}

type CameraPresetId = 'oblique' | 'axial' | 'lateral' | 'anterior' | 'inside';

interface CameraPreset {
  id: CameraPresetId;
  label: string;
  position: [number, number, number];
  target: [number, number, number];
}

const CAMERA_PRESETS: CameraPreset[] = [
  { id: 'oblique', label: 'Oblique', position: [3.6, 2.35, 3.85], target: [0, 0.25, 0] },
  { id: 'axial', label: 'Top', position: [0.01, 5.4, 0.25], target: [0, 0.2, 0] },
  { id: 'lateral', label: 'Side', position: [5.1, 0.85, 0.15], target: [0, 0.25, 0] },
  { id: 'anterior', label: 'Front', position: [0, 0.95, 5.1], target: [0, 0.25, 0] },
  { id: 'inside', label: 'Dive Inside', position: [0.16, 0.42, 1.32], target: [0, 0.22, -0.85] },
];

const SUBTYPE_FOCUS_CAMERA: Record<
  HemorrhageSubtypeId,
  { pos: [number, number, number]; target: [number, number, number]; label: string }
> = {
  epidural: { pos: [2.55, 1.35, 1.85], target: [0.65, 0.35, 0.1], label: 'EDH Biconvex Compartment' },
  subdural: { pos: [-2.65, 1.55, 2.05], target: [-0.55, 0.42, 0.15], label: 'SDH Convexity Space' },
  subarachnoid: { pos: [0.25, 1.05, 2.65], target: [0, 0.15, 0.15], label: 'SAH Basal Cisterns & Sulci' },
  intraventricular: { pos: [0.85, 1.65, 2.05], target: [0, 0.38, 0.05], label: 'IVH Lateral Ventricles' },
  intraparenchymal: { pos: [2.15, 1.25, 2.25], target: [0.35, 0.32, 0.15], label: 'IPH Deep Parenchyma' },
};

const SUBTYPE_COLORS: Record<HemorrhageSubtypeId | 'none', number> = {
  epidural: 0xf43f5e,
  subdural: 0xfb923c,
  subarachnoid: 0xf59e0b,
  intraventricular: 0xec4899,
  intraparenchymal: 0xe11d48,
  none: 0x10b981,
};

const _targetCamPos = new THREE.Vector3(3.6, 2.35, 3.85);
const _targetCtrlPos = new THREE.Vector3(0, 0.25, 0);
const _photonDummy = new THREE.Object3D();
const _vesselDummy = new THREE.Object3D();
const _targetPulseColor = new THREE.Color(0x8b5cf6);
const _targetLesionLocal = new THREE.Vector3(0.2, 0.25, 0.1);
const _hoverLocalTarget = new THREE.Vector3(0, 0.35, 0);
const _arcMidVec = new THREE.Vector3();

interface VolumetricMetrics {
  intensity: number;
  pulseHz: number;
  colorHex: number;
  lesionLocal: [number, number, number];
  label: string;
}

function computeVolumetricMetrics(ctCase: CTCase, isAnalyzing: boolean): VolumetricMetrics {
  const a = ctCase.analysis;
  if (isAnalyzing) {
    return {
      intensity: 0.94,
      pulseHz: 2.55,
      colorHex: 0x8b5cf6,
      lesionLocal: [0, 0.28, 0],
      label: 'Volumetric Scan Active',
    };
  }
  if (!a) {
    return {
      intensity: 0.26,
      pulseHz: 0.95,
      colorHex: 0x8b5cf6,
      lesionLocal: [0, 0.28, 0],
      label: 'Baseline Volume Ready',
    };
  }

  const xNorm = ((a.localization.xPercent ?? 50) - 50) / 50;
  const zNorm = ((a.localization.yPercent ?? 50) - 50) / 50;
  const probNorm = Math.max(0, Math.min(1, (a.overallProbability ?? 0) / 100));

  let triageBoost = 0.08;
  let colorHex = SUBTYPE_COLORS.none;
  let label = 'Low-Intensity Baseline';

  if (a.anyHemorrhage) {
    colorHex = SUBTYPE_COLORS[a.dominantSubtype] ?? 0xf43f5e;
    if (a.triageLevel === 'STAT_SURGICAL') {
      triageBoost = 0.36;
      label = 'Critical STAT Pulse';
    } else if (a.triageLevel === 'URGENT_NEURO') {
      triageBoost = 0.26;
      label = 'Urgent Bleed Pulse';
    } else {
      triageBoost = 0.16;
      label = 'Priority Focus Pulse';
    }
  }

  const intensity = Math.max(0.18, Math.min(1.0, probNorm * 0.68 + triageBoost));
  const pulseHz = Math.round((0.85 + intensity * 1.9) * 10) / 10;

  return {
    intensity,
    pulseHz,
    colorHex,
    lesionLocal: [xNorm * 0.82, 0.22, zNorm * 0.82],
    label,
  };
}

function createVolumetricParenchymaGeometry(pointCount = 460): THREE.BufferGeometry {
  const positions = new Float32Array(pointCount * 3);
  const seeds = new Float32Array(pointCount);
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));

  for (let i = 0; i < pointCount; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const t = (i + 0.5) / pointCount;
    const shellRadius = 0.24 + 0.66 * Math.cbrt((i * 1.6180339) % 1);
    const yUnit = 1 - 2 * t;
    const rPlane = Math.sqrt(Math.max(0, 1 - yUnit * yUnit));
    const theta = goldenAngle * i;

    let x = Math.cos(theta) * rPlane * shellRadius;
    let y = yUnit * shellRadius;
    let z = Math.sin(theta) * rPlane * shellRadius;

    if (side === 1 && x < 0) x = Math.abs(x) * 0.85 + 0.09;
    else if (side === -1 && x > 0) x = -Math.abs(x) * 0.85 - 0.09;
    else x += side * 0.12;

    z *= 1.18;
    y *= 0.84;
    if (y < -0.26) y = -0.26 + (y + 0.26) * 0.5;

    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;
    seeds[i] = (i * 0.381966) % 1;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
  return geo;
}

function createCorticalHemisphereGeometry(side: -1 | 1): THREE.BufferGeometry {
  const geo = new THREE.SphereGeometry(1.12, 40, 32);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();

  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);

    if (side === 1 && v.x < 0) v.x *= 0.14;
    if (side === -1 && v.x > 0) v.x *= 0.14;

    v.z *= 1.28;
    v.y *= 0.92;
    if (v.y < -0.3) {
      v.y = -0.3 + (v.y + 0.3) * 0.55;
    }

    const fold =
      Math.sin(v.x * 9.5 + v.z * 7.2) *
        Math.cos(v.y * 8.4 - v.z * 5.1) *
        0.036 +
      Math.sin(v.z * 14.0 + v.y * 11.0) * 0.016;

    const len = v.length();
    if (len > 0.001) {
      v.addScaledVector(v.clone().normalize(), fold);
    }

    v.x += side * 0.08;
    pos.setXYZ(i, v.x, v.y, v.z);
  }

  geo.computeVertexNormals();
  return geo;
}

function createVentricleHornGeometry(side: -1 | 1): THREE.TubeGeometry {
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(side * 0.16, 0.28, 0.52),
    new THREE.Vector3(side * 0.2, 0.42, 0.15),
    new THREE.Vector3(side * 0.22, 0.34, -0.32),
    new THREE.Vector3(side * 0.34, 0.05, -0.45),
    new THREE.Vector3(side * 0.38, -0.14, 0.05),
  ]);
  return new THREE.TubeGeometry(curve, 32, 0.085, 12, false);
}

function createSynapticTractCurves(): THREE.CatmullRomCurve3[] {
  return [
    new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.62, 0.18, 0.42),
      new THREE.Vector3(-0.24, 0.54, 0.25),
      new THREE.Vector3(0.0, 0.62, 0.12),
      new THREE.Vector3(0.24, 0.54, 0.25),
      new THREE.Vector3(0.62, 0.18, 0.42),
    ]),
    new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.56, 0.12, -0.58),
      new THREE.Vector3(-0.22, 0.48, -0.42),
      new THREE.Vector3(0.0, 0.54, -0.32),
      new THREE.Vector3(0.22, 0.48, -0.42),
      new THREE.Vector3(0.56, 0.12, -0.58),
    ]),
    new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.32, -0.18, 0.78),
      new THREE.Vector3(-0.46, 0.28, 0.25),
      new THREE.Vector3(-0.42, 0.42, -0.35),
      new THREE.Vector3(-0.28, 0.05, -0.82),
    ]),
    new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.32, -0.18, 0.78),
      new THREE.Vector3(0.46, 0.28, 0.25),
      new THREE.Vector3(0.42, 0.42, -0.35),
      new THREE.Vector3(0.28, 0.05, -0.82),
    ]),
    new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.0, -0.48, -0.08),
      new THREE.Vector3(0.18, 0.16, 0.45),
      new THREE.Vector3(0.0, 0.46, 0.05),
      new THREE.Vector3(-0.18, 0.16, -0.45),
      new THREE.Vector3(0.0, -0.48, -0.08),
    ]),
  ];
}

function createCerebralVasculatureCurves(): THREE.CatmullRomCurve3[] {
  return [
    // Circle of Willis & Basilar trunk
    new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, -0.35, -0.15),
      new THREE.Vector3(0, -0.12, 0.08),
      new THREE.Vector3(-0.14, -0.04, 0.22),
      new THREE.Vector3(0, 0.02, 0.34),
      new THREE.Vector3(0.14, -0.04, 0.22),
      new THREE.Vector3(0, -0.12, 0.08),
    ]),
    // Right Middle Cerebral Artery (MCA) & Cortical branches
    new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.14, -0.04, 0.22),
      new THREE.Vector3(-0.48, 0.05, 0.25),
      new THREE.Vector3(-0.82, 0.28, 0.18),
      new THREE.Vector3(-0.96, 0.58, -0.05),
      new THREE.Vector3(-0.76, 0.82, -0.25),
    ]),
    // Left Middle Cerebral Artery (MCA) & Cortical branches
    new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.14, -0.04, 0.22),
      new THREE.Vector3(0.48, 0.05, 0.25),
      new THREE.Vector3(0.82, 0.28, 0.18),
      new THREE.Vector3(0.96, 0.58, -0.05),
      new THREE.Vector3(0.76, 0.82, -0.25),
    ]),
    // Superior Sagittal Sinus & Bridging Veins
    new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0.35, 1.1),
      new THREE.Vector3(0, 0.88, 0.65),
      new THREE.Vector3(0, 1.02, 0.0),
      new THREE.Vector3(0, 0.85, -0.75),
      new THREE.Vector3(0, 0.28, -1.18),
    ]),
  ];
}

function createContactShadowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const grad = ctx.createRadialGradient(128, 128, 12, 128, 128, 124);
    grad.addColorStop(0, 'rgba(124, 111, 246, 0.24)');
    grad.addColorStop(0.55, 'rgba(196, 181, 253, 0.16)');
    grad.addColorStop(1, 'rgba(237, 233, 248, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 256, 256);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createPedestalGridTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#f8f6ff';
    ctx.fillRect(0, 0, 512, 512);
    ctx.strokeStyle = 'rgba(139, 92, 246, 0.22)';
    ctx.lineWidth = 1.5;

    for (let r = 48; r <= 240; r += 48) {
      ctx.beginPath();
      ctx.arc(256, 256, r, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.strokeStyle = 'rgba(109, 92, 231, 0.22)';
    ctx.beginPath();
    ctx.moveTo(256, 12);
    ctx.lineTo(256, 500);
    ctx.moveTo(12, 256);
    ctx.lineTo(500, 256);
    ctx.stroke();

    ctx.fillStyle = 'rgba(91, 69, 229, 0.85)';
    ctx.font = 'bold 16px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('A', 256, 28);
    ctx.fillText('P', 256, 496);
    ctx.fillText('R', 26, 262);
    ctx.fillText('L', 486, 262);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export const Brain3DViewer: React.FC<Brain3DViewerProps> = ({
  activeCase,
  activeImageUrl,
  activeSliceIndex,
  totalSlices,
  isAnalyzing = false,
  focusedSubtype = null,
  onSync3dCaliperToAbc,
  onAskConsultAboutPart,
}) => {
  const mountRef = useRef<HTMLDivElement | null>(null);

  const [explodeLevel, setExplodeLevel] = useState<number>(0.18);
  const [skullOpacity, setSkullOpacity] = useState<number>(0.22);
  const [slicePlaneHeight, setSlicePlaneHeight] = useState<number>(0.5);
  const [showSlicePlane, setShowSlicePlane] = useState<boolean>(true);
  const [showMprPlanes, setShowMprPlanes] = useState<boolean>(false);
  const [showPathways, setShowPathways] = useState<boolean>(true);
  const [showVessels, setShowVessels] = useState<boolean>(true);
  const [showVolumeCloud, setShowVolumeCloud] = useState<boolean>(true);
  const [autoRotate, setAutoRotate] = useState<boolean>(true);
  const [pinMode, setPinMode] = useState<boolean>(false);
  const [sonicPulse, setSonicPulse] = useState<boolean>(false);
  const [timelineHours, setTimelineHours] = useState<number>(0);
  const [reversalApplied, setReversalApplied] = useState<boolean>(false);
  const [dockCollapsed, setDockCollapsed] = useState<boolean>(false);
  const [activePreset, setActivePreset] = useState<CameraPresetId>('oblique');
  const [pinSpanCm, setPinSpanCm] = useState<number | null>(null);
  const [pinCount, setPinCount] = useState<number>(0);
  const [selectedPart, setSelectedPart] = useState<{
    name: string;
    detail: string;
    focusPos: [number, number, number];
  } | null>(null);
  const [webglUnavailable, setWebglUnavailable] = useState<boolean>(false);

  const volumetricMetrics = computeVolumetricMetrics(activeCase, isAnalyzing);

  // 4D Hematoma expansion factor: T+0h = 1.0x, T+24h untreated up to 1.44x; Reversal halts at 1.06x
  const hasHemorrhage = Boolean(activeCase.analysis?.anyHemorrhage);
  const expansionFactor =
    !hasHemorrhage || timelineHours === 0
      ? 1.0
      : reversalApplied
      ? 1.0 + Math.min(0.06, (timelineHours / 24) * 0.08)
      : 1.0 + (timelineHours / 24) * 0.44;
  const baseVolumeMl = activeCase.abcVolume?.volumeMl ?? (hasHemorrhage ? 22.4 : 0);
  const projectedVolumeMl = Math.round(baseVolumeMl * expansionFactor * 10) / 10;

  const controlsStateRef = useRef({
    explodeLevel,
    skullOpacity,
    slicePlaneHeight,
    showSlicePlane,
    showMprPlanes,
    showPathways,
    showVessels,
    showVolumeCloud,
    autoRotate,
    pinMode,
    expansionFactor,
    isAnalyzing,
    targetIntensity: volumetricMetrics.intensity,
    targetPulseHz: volumetricMetrics.pulseHz,
    targetColorHex: volumetricMetrics.colorHex,
    targetLesionLocal: volumetricMetrics.lesionLocal,
    insideMode: false,
    camTransitionActive: false,
  });

  useEffect(() => {
    controlsStateRef.current.explodeLevel = explodeLevel;
    controlsStateRef.current.skullOpacity = skullOpacity;
    controlsStateRef.current.slicePlaneHeight = slicePlaneHeight;
    controlsStateRef.current.showSlicePlane = showSlicePlane;
    controlsStateRef.current.showMprPlanes = showMprPlanes;
    controlsStateRef.current.showPathways = showPathways;
    controlsStateRef.current.showVessels = showVessels;
    controlsStateRef.current.showVolumeCloud = showVolumeCloud;
    controlsStateRef.current.autoRotate = autoRotate;
    controlsStateRef.current.pinMode = pinMode;
    controlsStateRef.current.expansionFactor = expansionFactor;
  }, [
    explodeLevel,
    skullOpacity,
    slicePlaneHeight,
    showSlicePlane,
    showMprPlanes,
    showPathways,
    showVessels,
    showVolumeCloud,
    autoRotate,
    pinMode,
    expansionFactor,
  ]);

  useEffect(() => {
    const m = computeVolumetricMetrics(activeCase, isAnalyzing);
    controlsStateRef.current.isAnalyzing = isAnalyzing;
    controlsStateRef.current.targetIntensity = m.intensity;
    controlsStateRef.current.targetPulseHz = m.pulseHz;
    controlsStateRef.current.targetColorHex = m.colorHex;
    controlsStateRef.current.targetLesionLocal = m.lesionLocal;
  }, [activeCase, isAnalyzing]);

  useEffect(() => {
    if (totalSlices > 1) {
      setSlicePlaneHeight(activeSliceIndex / Math.max(1, totalSlices - 1));
    } else {
      setSlicePlaneHeight(0.5);
    }
  }, [activeSliceIndex, totalSlices, activeCase.id]);

  // Reset 4D timeline & pins when switching cases
  useEffect(() => {
    setTimelineHours(0);
    setReversalApplied(false);
    clearPinsRef.current?.();
  }, [activeCase.id]);

  // Optional live cardiac/triage pulse sonification
  useEffect(() => {
    if (!sonicPulse) return;
    const periodMs = Math.max(420, Math.round(1000 / Math.max(0.7, volumetricMetrics.pulseHz)));
    playTriagePulseBeat(volumetricMetrics.intensity);
    const id = window.setInterval(() => {
      playTriagePulseBeat(volumetricMetrics.intensity);
    }, periodMs);
    return () => window.clearInterval(id);
  }, [sonicPulse, volumetricMetrics.pulseHz, volumetricMetrics.intensity]);

  // Cross-linked focus camera from TriagePanel subtype cards
  useEffect(() => {
    if (!focusedSubtype) return;
    const focus = SUBTYPE_FOCUS_CAMERA[focusedSubtype];
    if (!focus) return;
    _targetCamPos.set(...focus.pos);
    _targetCtrlPos.set(...focus.target);
    controlsStateRef.current.insideMode = focusedSubtype === 'intraventricular';
    controlsStateRef.current.camTransitionActive = true;
    playAnatomicalChime('lesion');
  }, [focusedSubtype]);

  const updateLesionRef = useRef<((ctCase: CTCase) => void) | null>(null);
  const updateSliceTexRef = useRef<((url: string) => void) | null>(null);
  const clearPinsRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    updateLesionRef.current?.(activeCase);
  }, [activeCase]);

  useEffect(() => {
    updateSliceTexRef.current?.(activeImageUrl);
  }, [activeImageUrl]);

  const triggerCameraPreset = (preset: CameraPreset) => {
    setActivePreset(preset.id);
    controlsStateRef.current.insideMode = preset.id === 'inside';
    if (preset.id === 'inside') {
      setExplodeLevel((prev) => Math.max(prev, 0.34));
      setSkullOpacity((prev) => Math.min(prev, 0.14));
      setShowPathways(true);
      setShowVessels(true);
    }
    _targetCamPos.set(...preset.position);
    _targetCtrlPos.set(...preset.target);
    controlsStateRef.current.camTransitionActive = true;
  };

  const flyToSelectedPart = (focusPos: [number, number, number]) => {
    const dir = new THREE.Vector3(focusPos[0], focusPos[1], focusPos[2]);
    if (dir.lengthSq() < 0.01) dir.set(0.5, 0.4, 1);
    dir.normalize();
    _targetCtrlPos.set(focusPos[0], focusPos[1], focusPos[2]);
    _targetCamPos.set(
      focusPos[0] + dir.x * 1.45,
      focusPos[1] + 0.55,
      focusPos[2] + dir.z * 1.45 + 0.5
    );
    controlsStateRef.current.insideMode = true;
    controlsStateRef.current.camTransitionActive = true;
  };

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const isSoftwareGl = detectSoftwareWebGL();
    const reduced = prefersReducedMotion();

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: !isSoftwareGl,
        powerPreference: 'high-performance',
      });
    } catch {
      setWebglUnavailable(true);
      return;
    }

    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.06;
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setSize(container.clientWidth || 640, container.clientHeight || 460);
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xede9f8);
    scene.fog = new THREE.FogExp2(0xede9f8, 0.04);

    const pmrem = new THREE.PMREMGenerator(renderer);
    const roomEnv = new RoomEnvironment();
    scene.environment = pmrem.fromScene(roomEnv, 0.04).texture;
    roomEnv.dispose();
    pmrem.dispose();

    const camera = new THREE.PerspectiveCamera(
      42,
      (container.clientWidth || 640) / Math.max(1, container.clientHeight || 460),
      0.08,
      60
    );
    camera.position.set(3.6, 2.35, 3.85);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.07;
    controls.minDistance = 0.55;
    controls.maxDistance = 8.5;
    controls.maxPolarAngle = Math.PI * 0.74;
    controls.target.set(0, 0.25, 0);

    controls.addEventListener('start', () => {
      controlsStateRef.current.camTransitionActive = false;
    });

    const hemiLight = new THREE.HemisphereLight(0xffffff, 0xc4b5fd, 1.15);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xfff5eb, 1.85);
    keyLight.position.set(4.5, 6.2, 4.2);
    keyLight.castShadow = !isSoftwareGl;
    keyLight.shadow.mapSize.set(1024, 1024);
    keyLight.shadow.camera.near = 1;
    keyLight.shadow.camera.far = 18;
    keyLight.shadow.camera.left = -3;
    keyLight.shadow.camera.right = 3;
    keyLight.shadow.camera.top = 3;
    keyLight.shadow.camera.bottom = -3;
    keyLight.shadow.bias = -0.0005;
    keyLight.shadow.normalBias = 0.02;
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0xa7f3d0, 1.25);
    rimLight.position.set(-4.5, 2.4, -4.2);
    scene.add(rimLight);

    // Porcelain Surgical Pedestal & Contact Shadow
    const pedestalGroup = new THREE.Group();
    pedestalGroup.position.set(0, -1.35, 0);
    scene.add(pedestalGroup);

    const shadowTex = createContactShadowTexture();
    const shadowPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(4.6, 4.6),
      new THREE.MeshBasicMaterial({
        map: shadowTex,
        transparent: true,
        depthWrite: false,
        opacity: 0.72,
      })
    );
    shadowPlane.rotation.x = -Math.PI / 2;
    shadowPlane.position.y = 0.02;
    pedestalGroup.add(shadowPlane);

    const gridTex = createPedestalGridTexture();
    gridTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    const gridDisc = new THREE.Mesh(
      new THREE.CircleGeometry(2.35, 64),
      new THREE.MeshStandardMaterial({
        map: gridTex,
        roughness: 0.35,
        metalness: 0.08,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      })
    );
    gridDisc.rotation.x = -Math.PI / 2;
    gridDisc.receiveShadow = true;
    pedestalGroup.add(gridDisc);

    const pedestalRing = new THREE.Mesh(
      new THREE.TorusGeometry(2.36, 0.032, 12, 80),
      new THREE.MeshStandardMaterial({
        color: 0xc4b5fd,
        metalness: 0.45,
        roughness: 0.25,
      })
    );
    pedestalRing.rotation.x = Math.PI / 2;
    pedestalGroup.add(pedestalRing);

    const cranialRoot = new THREE.Group();
    cranialRoot.position.set(0, 0.35, 0);
    scene.add(cranialRoot);

    const pickables: THREE.Object3D[] = [];
    const registerPickable = (
      obj: THREE.Object3D,
      name: string,
      detail: string,
      focusPos: [number, number, number] = [0, 0.35, 0],
      soundRegion: AnatomicalSoundRegion = 'cortex'
    ) => {
      obj.layers.enable(1);
      obj.userData.partName = name;
      obj.userData.partDetail = detail;
      obj.userData.focusPos = focusPos;
      obj.userData.soundRegion = soundRegion;
      obj.userData.touchBounce = 0;
      pickables.push(obj);
    };

    // Direct 3D Touch Shockwave Halo
    const shockwaveGeo = new THREE.TorusGeometry(0.18, 0.016, 10, 42);
    const shockwaveMat = new THREE.MeshBasicMaterial({
      color: 0x8b5cf6,
      transparent: true,
      opacity: 0,
    });
    const shockwaveMesh = new THREE.Mesh(shockwaveGeo, shockwaveMat);
    scene.add(shockwaveMesh);
    let shockwaveProgress = 1;

    // Part 1: Pearlescent Skull Vault
    const skullGroup = new THREE.Group();
    cranialRoot.add(skullGroup);

    const skullMat = new THREE.MeshPhysicalMaterial({
      color: 0xfff8fb,
      roughness: 0.28,
      metalness: 0.04,
      clearcoat: 0.78,
      transparent: true,
      opacity: controlsStateRef.current.skullOpacity,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    const domeGeo = new THREE.SphereGeometry(1.42, 42, 28, 0, Math.PI * 2, 0, Math.PI * 0.62);
    domeGeo.scale(0.92, 0.98, 1.15);
    const skullDome = new THREE.Mesh(domeGeo, skullMat);
    skullDome.renderOrder = 4;
    registerPickable(
      skullDome,
      'Cranial Vault (Calvarium)',
      'Cortical inner/outer table reference (>700 HU); separates extra-axial EDH/SDH spaces.',
      [0, 0.95, 0.2],
      'skull'
    );
    skullGroup.add(skullDome);

    const skullBaseGeo = new THREE.TorusGeometry(1.26, 0.045, 12, 64);
    skullBaseGeo.scale(0.92, 1.14, 1);
    const skullBaseMat = new THREE.MeshStandardMaterial({
      color: 0x9b95c9,
      roughness: 0.35,
      metalness: 0.32,
    });
    const skullBaseRing = new THREE.Mesh(skullBaseGeo, skullBaseMat);
    skullBaseRing.rotation.x = Math.PI / 2;
    skullBaseRing.position.y = -0.34;
    skullGroup.add(skullBaseRing);

    const sutureGeo = new THREE.TorusGeometry(1.42, 0.012, 8, 48, Math.PI * 0.92);
    sutureGeo.scale(1.15, 0.98, 1);
    const sutureMat = new THREE.MeshStandardMaterial({
      color: 0x8b5cf6,
      emissive: 0x6d5ce7,
      emissiveIntensity: 0.32,
      roughness: 0.28,
      metalness: 0.35,
    });
    const sagittalSuture = new THREE.Mesh(sutureGeo, sutureMat);
    sagittalSuture.rotation.y = Math.PI / 2;
    sagittalSuture.rotation.z = 0.14;
    skullGroup.add(sagittalSuture);

    // Volumetric Pulse Uniforms
    const volumetricUniforms = {
      uTime: { value: 0 },
      uIntensity: { value: controlsStateRef.current.targetIntensity },
      uPulseSpeed: { value: controlsStateRef.current.targetPulseHz * Math.PI * 2 },
      uPulseColor: { value: new THREE.Color(controlsStateRef.current.targetColorHex) },
      uLesionLocal: { value: new THREE.Vector3(...controlsStateRef.current.targetLesionLocal) },
      uHoverLocal: { value: new THREE.Vector3(0, 0.35, 0) },
      uHoverStrength: { value: 0 },
    };

    const applyVolumetricCortexShader = (mat: THREE.MeshPhysicalMaterial) => {
      mat.customProgramCacheKey = () => 'hemastat-volumetric-cortex-v2';
      mat.onBeforeCompile = (shader) => {
        shader.uniforms.uTime = volumetricUniforms.uTime;
        shader.uniforms.uIntensity = volumetricUniforms.uIntensity;
        shader.uniforms.uPulseSpeed = volumetricUniforms.uPulseSpeed;
        shader.uniforms.uPulseColor = volumetricUniforms.uPulseColor;
        shader.uniforms.uLesionLocal = volumetricUniforms.uLesionLocal;
        shader.uniforms.uHoverLocal = volumetricUniforms.uHoverLocal;
        shader.uniforms.uHoverStrength = volumetricUniforms.uHoverStrength;

        shader.vertexShader = shader.vertexShader
          .replace(
            '#include <common>',
            `#include <common>
            uniform float uTime;
            uniform float uIntensity;
            uniform float uPulseSpeed;
            uniform vec3 uLesionLocal;
            uniform vec3 uHoverLocal;
            uniform float uHoverStrength;
            varying vec3 vVolPos;`
          )
          .replace(
            '#include <begin_vertex>',
            `#include <begin_vertex>
            vVolPos = transformed;
            float vDistLesion = distance(transformed, uLesionLocal);
            float vVolWave = sin(uTime * uPulseSpeed - vDistLesion * 3.4);
            float vPulseAmp = 0.008 + uIntensity * 0.028;
            transformed += objectNormal * (vVolWave * vPulseAmp);
            float vDistHover = distance(transformed, uHoverLocal);
            transformed += objectNormal * (exp(-vDistHover * vDistHover * 2.8) * uHoverStrength * 0.045);`
          );

        shader.fragmentShader = shader.fragmentShader
          .replace(
            '#include <common>',
            `#include <common>
            uniform float uTime;
            uniform float uIntensity;
            uniform float uPulseSpeed;
            uniform vec3 uPulseColor;
            uniform vec3 uLesionLocal;
            uniform vec3 uHoverLocal;
            uniform float uHoverStrength;
            varying vec3 vVolPos;`
          )
          .replace(
            '#include <emissivemap_fragment>',
            `#include <emissivemap_fragment>
            float fDistLesion = distance(vVolPos, uLesionLocal);
            float fRadialPulse = 0.5 + 0.5 * sin(uTime * uPulseSpeed - fDistLesion * 3.8);
            float fFresnelRim = pow(1.0 - clamp(abs(dot(normalize(vNormal), normalize(vViewPosition))), 0.0, 1.0), 2.1);
            float fFocalGlow = exp(-fDistLesion * fDistLesion * 1.4) * uIntensity;
            float fHoverGlow = exp(-distance(vVolPos, uHoverLocal) * 2.2) * uHoverStrength * 0.6;
            totalEmissiveRadiance += uPulseColor * (fFresnelRim * (0.28 + uIntensity * 0.62) + fRadialPulse * fFocalGlow * 0.78 + fHoverGlow);`
          );
      };
    };

    // Part 2: Semi-Transparent Volumetric Cerebral Hemispheres
    const brainMatRight = new THREE.MeshPhysicalMaterial({
      color: 0xa7a0db,
      roughness: 0.28,
      metalness: 0.04,
      clearcoat: 0.85,
      clearcoatRoughness: 0.18,
      sheen: 0.65,
      sheenColor: new THREE.Color(0xd8b4fe),
      transparent: true,
      opacity: 0.44,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    applyVolumetricCortexShader(brainMatRight);
    const brainMatLeft = brainMatRight.clone();
    applyVolumetricCortexShader(brainMatLeft);

    const rightHemiGeo = createCorticalHemisphereGeometry(-1);
    const leftHemiGeo = createCorticalHemisphereGeometry(1);

    const rightHemi = new THREE.Mesh(rightHemiGeo, brainMatRight);
    rightHemi.renderOrder = 3;
    registerPickable(
      rightHemi,
      'Right Cerebral Hemisphere',
      'Patient Right cortex (radiological viewer left); evaluate gray-white differentiation & sulcal effacement.',
      [-0.55, 0.4, 0.1],
      'cortex'
    );

    const leftHemi = new THREE.Mesh(leftHemiGeo, brainMatLeft);
    leftHemi.renderOrder = 3;
    registerPickable(
      leftHemi,
      'Left Cerebral Hemisphere',
      'Patient Left cortex (radiological viewer right); evaluate sulcal symmetry & mass effect.',
      [0.55, 0.4, 0.1],
      'cortex'
    );

    cranialRoot.add(rightHemi, leftHemi);

    // Interior 3D Volumetric Parenchyma Point Cloud
    const volumeCloudGeo = createVolumetricParenchymaGeometry(460);
    const volumeCloudMat = new THREE.ShaderMaterial({
      uniforms: volumetricUniforms,
      vertexShader: `
        attribute float aSeed;
        uniform float uTime;
        uniform float uIntensity;
        uniform float uPulseSpeed;
        uniform vec3 uLesionLocal;
        uniform vec3 uHoverLocal;
        uniform float uHoverStrength;
        varying float vPulse;
        varying float vHover;
        void main() {
          vec3 p = position;
          float dLesion = distance(p, uLesionLocal);
          float wave = 0.5 + 0.5 * sin(uTime * uPulseSpeed - dLesion * 3.6 + aSeed * 1.4);
          vec3 dir = normalize(p + vec3(0.0001));
          p += dir * ((wave - 0.5) * (0.02 + uIntensity * 0.055));
          float dHover = distance(p, uHoverLocal);
          float hBoost = exp(-dHover * dHover * 2.4) * uHoverStrength;
          vec4 mvPos = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mvPos;
          gl_PointSize = clamp((10.0 + uIntensity * 12.0 + wave * 4.5 + hBoost * 8.0) * (3.2 / max(1.0, -mvPos.z)), 2.5, 22.0);
          float focal = exp(-dLesion * dLesion * 1.65) * uIntensity;
          vPulse = clamp(0.22 + wave * (0.25 + uIntensity * 0.5) + focal * 0.45, 0.12, 1.0);
          vHover = hBoost;
        }
      `,
      fragmentShader: `
        uniform vec3 uPulseColor;
        uniform float uIntensity;
        varying float vPulse;
        varying float vHover;
        void main() {
          vec2 uv = gl_PointCoord - 0.5;
          float r2 = dot(uv, uv);
          if (r2 > 0.25) discard;
          float soft = exp(-r2 * 11.0);
          vec3 baseCol = vec3(0.58, 0.53, 0.96);
          vec3 col = mix(baseCol, uPulseColor, clamp(vPulse * (0.42 + uIntensity * 0.58) + vHover * 0.5, 0.0, 1.0));
          gl_FragColor = vec4(col, soft * (0.35 + vPulse * 0.52 + vHover * 0.35));
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });
    const volumeCloud = new THREE.Points(volumeCloudGeo, volumeCloudMat);
    volumeCloud.renderOrder = 2;
    cranialRoot.add(volumeCloud);

    // Volumetric Axial Scan Sweep Ring
    const scanSweepGeo = new THREE.TorusGeometry(1.32, 0.022, 12, 64);
    const scanSweepMat = new THREE.MeshBasicMaterial({
      color: 0x8b5cf6,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    const scanSweepRing = new THREE.Mesh(scanSweepGeo, scanSweepMat);
    scanSweepRing.rotation.x = Math.PI / 2;
    cranialRoot.add(scanSweepRing);

    const falxGeo = new THREE.PlaneGeometry(2.5, 1.35);
    const falxMat = new THREE.MeshBasicMaterial({
      color: 0x8b5cf6,
      transparent: true,
      opacity: 0.14,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const falxMesh = new THREE.Mesh(falxGeo, falxMat);
    falxMesh.rotation.y = Math.PI / 2;
    falxMesh.position.y = 0.25;
    cranialRoot.add(falxMesh);

    // Part 3: Pastel Mint-Aqua Ventricular System
    const ventMat = new THREE.MeshPhysicalMaterial({
      color: 0x2dd4bf,
      emissive: 0x0d9488,
      emissiveIntensity: 0.25,
      roughness: 0.22,
      metalness: 0.08,
      transparent: true,
      opacity: 0.72,
    });
    const ventRightGeo = createVentricleHornGeometry(-1);
    const ventLeftGeo = createVentricleHornGeometry(1);
    const ventRight = new THREE.Mesh(ventRightGeo, ventMat);
    const ventLeft = new THREE.Mesh(ventLeftGeo, ventMat);
    ventRight.renderOrder = 1;
    ventLeft.renderOrder = 1;
    registerPickable(
      ventRight,
      'Lateral Ventricular System',
      'CSF spaces evaluated for Intraventricular Hemorrhage (IVH) layering and hydrocephalus compression.',
      [-0.22, 0.48, 0.1],
      'ventricle'
    );
    registerPickable(
      ventLeft,
      'Lateral Ventricular System',
      'CSF spaces evaluated for Intraventricular Hemorrhage (IVH) layering and hydrocephalus compression.',
      [0.22, 0.48, 0.1],
      'ventricle'
    );
    cranialRoot.add(ventRight, ventLeft);

    // Part 4: Synaptic Pathways & Traveling Light Photons
    const pathwaysGroup = new THREE.Group();
    cranialRoot.add(pathwaysGroup);

    const tractCurves = createSynapticTractCurves();
    const tractColors = [0x8b5cf6, 0x2dd4bf, 0xf472b6, 0x60a5fa, 0xa78bfa];
    tractCurves.forEach((curve, idx) => {
      const tubeGeo = new THREE.TubeGeometry(curve, 36, 0.016, 8, false);
      const tubeMat = new THREE.MeshBasicMaterial({
        color: tractColors[idx % tractColors.length],
        transparent: true,
        opacity: 0.56,
      });
      const tractMesh = new THREE.Mesh(tubeGeo, tubeMat);
      registerPickable(
        tractMesh,
        'White Matter & Synaptic Tracts',
        'Commissural & thalamocortical projection tracts visualized to assess mass-effect displacement.',
        [0, 0.5, 0.08],
        'tract'
      );
      pathwaysGroup.add(tractMesh);
    });

    const photonCount = 35;
    const photonGeo = new THREE.SphereGeometry(0.026, 8, 8);
    const photonMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.92,
    });
    const photonInstanced = new THREE.InstancedMesh(photonGeo, photonMat, photonCount);
    const photonPalette = [
      new THREE.Color(0x6ee7b7),
      new THREE.Color(0xc4b5fd),
      new THREE.Color(0xf9a8d4),
      new THREE.Color(0x93c5fd),
    ];
    for (let i = 0; i < photonCount; i++) {
      photonInstanced.setColorAt(i, photonPalette[i % photonPalette.length]);
    }
    if (photonInstanced.instanceColor) photonInstanced.instanceColor.needsUpdate = true;
    pathwaysGroup.add(photonInstanced);

    // Part 4B: 3D Pulsing Cerebral Vasculature (Circle of Willis & Bridging Veins)
    const vasculatureGroup = new THREE.Group();
    cranialRoot.add(vasculatureGroup);

    const vesselCurves = createCerebralVasculatureCurves();
    vesselCurves.forEach((curve, idx) => {
      const isVenous = idx === 3;
      const vGeo = new THREE.TubeGeometry(curve, 36, isVenous ? 0.022 : 0.018, 8, false);
      const vMat = new THREE.MeshPhysicalMaterial({
        color: isVenous ? 0x60a5fa : 0xfb7185,
        emissive: isVenous ? 0x2563eb : 0xe11d48,
        emissiveIntensity: 0.35,
        roughness: 0.28,
        transparent: true,
        opacity: 0.78,
      });
      const vMesh = new THREE.Mesh(vGeo, vMat);
      registerPickable(
        vMesh,
        isVenous ? 'Superior Sagittal Sinus & Bridging Veins' : 'Circle of Willis & MCA Vasculature',
        isVenous
          ? 'Dural venous sinus & cortical bridging veins vulnerable to tearing in Subdural Hemorrhage (SDH).'
          : 'Basal & Sylvian arterial branches evaluated for aneurysmal SAH or middle meningeal arterial origin.',
        [0, 0.25, 0.2],
        'lesion'
      );
      vasculatureGroup.add(vMesh);
    });

    const vesselParticleCount = 24;
    const vpGeo = new THREE.SphereGeometry(0.022, 8, 8);
    const vpMat = new THREE.MeshBasicMaterial({
      color: 0xfda4af,
      transparent: true,
      opacity: 0.94,
    });
    const vesselInstanced = new THREE.InstancedMesh(vpGeo, vpMat, vesselParticleCount);
    vasculatureGroup.add(vesselInstanced);

    // Part 5: Active Axial CT Slice Plane + Orthogonal Tri-Planar 3D MPR Slicer
    const slicePlaneGroup = new THREE.Group();
    cranialRoot.add(slicePlaneGroup);

    const sliceMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.88,
      side: THREE.DoubleSide,
    });
    const slicePlaneGeo = new THREE.PlaneGeometry(2.68, 2.68);
    const slicePlaneMesh = new THREE.Mesh(slicePlaneGeo, sliceMat);
    slicePlaneMesh.rotation.x = -Math.PI / 2;
    slicePlaneMesh.renderOrder = 1;
    registerPickable(
      slicePlaneMesh,
      'Active Axial NCCT Slice',
      'Live synchronized axial slice plane mapped directly inside the 3D cranial volume.',
      [0, 0.35, 0.25],
      'cortex'
    );
    slicePlaneGroup.add(slicePlaneMesh);

    const sliceFrameGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(2.7, 0.015, 2.7));
    const sliceFrameMat = new THREE.LineBasicMaterial({
      color: 0x7c3aed,
      transparent: true,
      opacity: 0.78,
    });
    const sliceFrame = new THREE.LineSegments(sliceFrameGeo, sliceFrameMat);
    slicePlaneGroup.add(sliceFrame);

    // Coronal & Sagittal Tri-Planar MPR Orthogonal Glass Planes
    const mprGroup = new THREE.Group();
    cranialRoot.add(mprGroup);

    const coronalGlassMat = new THREE.MeshBasicMaterial({
      color: 0x67e8f9,
      transparent: true,
      opacity: 0.14,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const coronalPlane = new THREE.Mesh(new THREE.PlaneGeometry(2.55, 2.05), coronalGlassMat);
    coronalPlane.position.set(0, 0.25, 0);
    const coronalFrame = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(2.55, 2.05, 0.01)),
      new THREE.LineBasicMaterial({ color: 0x06b6d4, transparent: true, opacity: 0.72 })
    );
    coronalFrame.position.copy(coronalPlane.position);
    mprGroup.add(coronalPlane, coronalFrame);

    const sagittalGlassMat = new THREE.MeshBasicMaterial({
      color: 0x6ee7b7,
      transparent: true,
      opacity: 0.14,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const sagittalPlane = new THREE.Mesh(new THREE.PlaneGeometry(2.7, 2.05), sagittalGlassMat);
    sagittalPlane.rotation.y = Math.PI / 2;
    sagittalPlane.position.set(0, 0.25, 0);
    const sagittalFrame = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(0.01, 2.05, 2.7)),
      new THREE.LineBasicMaterial({ color: 0x10b981, transparent: true, opacity: 0.72 })
    );
    sagittalFrame.position.copy(sagittalPlane.position);
    mprGroup.add(sagittalPlane, sagittalFrame);

    let activeSliceTex: THREE.Texture | null = null;
    updateSliceTexRef.current = (url: string) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const tex = new THREE.Texture(img);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
        tex.needsUpdate = true;
        if (activeSliceTex) activeSliceTex.dispose();
        activeSliceTex = tex;
        sliceMat.map = tex;
        sliceMat.needsUpdate = true;
      };
      img.src = url;
    };
    updateSliceTexRef.current(activeImageUrl);

    // Part 6: Dynamic Hemorrhage Volume Group & Midline Shift Vector
    const lesionGroup = new THREE.Group();
    cranialRoot.add(lesionGroup);

    const lesionMat = new THREE.MeshPhysicalMaterial({
      color: 0xf43f5e,
      emissive: 0xbe123c,
      emissiveIntensity: 0.35,
      roughness: 0.24,
      metalness: 0.06,
      clearcoat: 0.85,
      transparent: true,
      opacity: 0.92,
    });

    const edemaMat = new THREE.MeshBasicMaterial({
      color: 0xf59e0b,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
      wireframe: true,
    });

    const shiftVectorGroup = new THREE.Group();
    cranialRoot.add(shiftVectorGroup);

    const rebuildLesionForCase = (ctCase: CTCase) => {
      while (lesionGroup.children.length > 0) {
        const child = lesionGroup.children[0] as THREE.Mesh;
        child.geometry?.dispose();
        lesionGroup.remove(child);
      }
      while (shiftVectorGroup.children.length > 0) {
        const child = shiftVectorGroup.children[0] as THREE.Mesh;
        child.geometry?.dispose();
        shiftVectorGroup.remove(child);
      }

      const a = ctCase.analysis;
      if (!a || !a.anyHemorrhage) return;

      const sub = a.dominantSubtype;
      lesionMat.color.setHex(SUBTYPE_COLORS[sub] ?? 0xf43f5e);
      lesionMat.emissive.setHex(SUBTYPE_COLORS[sub] ?? 0xbe123c);

      const xNorm = ((a.localization.xPercent ?? 50) - 50) / 50;
      const zNorm = ((a.localization.yPercent ?? 50) - 50) / 50;
      const radFactor = Math.max(0.18, Math.min(0.48, (a.localization.radiusPercent || 18) / 48));

      if (sub === 'epidural') {
        const g = new THREE.SphereGeometry(0.45 * radFactor * 2.1, 28, 20);
        g.scale(0.55, 0.9, 1.55);
        const mesh = new THREE.Mesh(g, lesionMat);
        mesh.position.set(xNorm * 1.05, 0.24, zNorm * 0.9);
        mesh.rotation.y = xNorm > 0 ? -0.25 : 0.25;
        registerPickable(
          mesh,
          `Epidural Hematoma (EDH) — ${a.overallProbability.toFixed(0)}%`,
          `Biconvex arterial collection in ${a.localization.anatomicalRegion}. Bounded by cranial sutures.`,
          [mesh.position.x, 0.52, mesh.position.z],
          'lesion'
        );
        lesionGroup.add(mesh);
      } else if (sub === 'subdural') {
        const g = new THREE.SphereGeometry(0.85, 28, 22, 0, Math.PI * 0.65, 0.35, 1.6);
        g.scale(0.95, 0.95, 1.3);
        const mesh = new THREE.Mesh(g, lesionMat);
        mesh.position.set(xNorm * 0.3, 0.16, zNorm * 0.25);
        if (xNorm < 0) mesh.rotation.y = Math.PI;
        registerPickable(
          mesh,
          `Subdural Hematoma (SDH) — ${a.overallProbability.toFixed(0)}%`,
          `Crescentic extra-axial venous bleed crossing suture lines in ${a.localization.anatomicalRegion}.`,
          [xNorm * 0.7, 0.48, zNorm * 0.4],
          'lesion'
        );
        lesionGroup.add(mesh);
      } else if (sub === 'subarachnoid') {
        for (let b = 0; b < 4; b++) {
          const offset = (b - 1.5) * 0.18;
          const curve = new THREE.CatmullRomCurve3([
            new THREE.Vector3(xNorm * 0.25, 0.05 + b * 0.08, zNorm * 0.15),
            new THREE.Vector3(xNorm * 0.55 + offset * 0.3, 0.25, zNorm * 0.4 + offset),
            new THREE.Vector3(xNorm * 0.92, 0.42 - b * 0.06, zNorm * 0.72 + offset * 0.8),
          ]);
          const g = new THREE.TubeGeometry(curve, 20, 0.048, 8, false);
          const mesh = new THREE.Mesh(g, lesionMat);
          registerPickable(
            mesh,
            `Subarachnoid Hemorrhage (SAH) — ${a.overallProbability.toFixed(0)}%`,
            `Sulcal & cisternal blood distribution in ${a.localization.anatomicalRegion}. STAT CTA indicated.`,
            [xNorm * 0.5, 0.45, zNorm * 0.4],
            'lesion'
          );
          lesionGroup.add(mesh);
        }
      } else if (sub === 'intraventricular') {
        const castSide = xNorm <= 0 ? -1 : 1;
        const g = createVentricleHornGeometry(castSide);
        g.scale(1.06, 1.06, 1.06);
        const mesh = new THREE.Mesh(g, lesionMat);
        registerPickable(
          mesh,
          `Intraventricular Hemorrhage (IVH) — ${a.overallProbability.toFixed(0)}%`,
          `Ventricular blood cast risking acute obstructive hydrocephalus.`,
          [castSide * 0.22, 0.48, 0.1],
          'lesion'
        );
        lesionGroup.add(mesh);
      } else {
        const coreGeo = new THREE.IcosahedronGeometry(0.34 * (radFactor * 2.2), 2);
        coreGeo.scale(1.0, 0.88, 1.18);
        const core = new THREE.Mesh(coreGeo, lesionMat);
        core.position.set(xNorm * 0.78, 0.22, zNorm * 0.75);
        registerPickable(
          core,
          `Intraparenchymal Hematoma (IPH) — ${a.overallProbability.toFixed(0)}%`,
          `Parenchymal clot in ${a.localization.anatomicalRegion} with surrounding perilesional edema.`,
          [core.position.x, 0.48, core.position.z],
          'lesion'
        );
        lesionGroup.add(core);

        const haloGeo = new THREE.IcosahedronGeometry(0.44 * (radFactor * 2.2), 1);
        const halo = new THREE.Mesh(haloGeo, edemaMat);
        halo.position.copy(core.position);
        lesionGroup.add(halo);
      }

      const shiftMm =
        typeof ctCase.measuredMidlineShiftMm === 'number'
          ? ctCase.measuredMidlineShiftMm
          : a.secondaryFindings.midlineShiftPresent
          ? a.secondaryFindings.midlineShiftMmEstimate
          : 0;
      if (shiftMm > 0.5) {
        const shiftDir = xNorm < 0 ? 1 : -1;
        const mag = Math.min(0.45, shiftMm * 0.032);
        const arrowCurve = new THREE.LineCurve3(
          new THREE.Vector3(0, 0.34, 0),
          new THREE.Vector3(shiftDir * mag, 0.34, 0)
        );
        const arrowGeo = new THREE.TubeGeometry(arrowCurve, 8, 0.02, 8, false);
        const arrowMat = new THREE.MeshBasicMaterial({ color: shiftMm >= 5 ? 0xe11d48 : 0xd97706 });
        shiftVectorGroup.add(new THREE.Mesh(arrowGeo, arrowMat));
      }
    };

    updateLesionRef.current = rebuildLesionForCase;
    rebuildLesionForCase(activeCase);

    // Part 7: Direct 3D Spatial Caliper Pins & Laser Arc
    const pinsGroup = new THREE.Group();
    scene.add(pinsGroup);
    const pinPoints: THREE.Vector3[] = [];

    const clearAllPins = () => {
      pinPoints.length = 0;
      while (pinsGroup.children.length > 0) {
        const ch = pinsGroup.children[0] as THREE.Mesh;
        ch.geometry?.dispose();
        if (Array.isArray(ch.material)) ch.material.forEach((m) => m.dispose());
        else ch.material?.dispose();
        pinsGroup.remove(ch);
      }
      setPinSpanCm(null);
      setPinCount(0);
    };
    clearPinsRef.current = clearAllPins;

    const raycaster = new THREE.Raycaster();
    raycaster.layers.set(1);
    const pointerNdc = new THREE.Vector2();
    let hoveredMesh: THREE.Mesh | null = null;
    let lastHoverTime = 0;
    let hoverStrengthTarget = 0;

    const handlePointerMove = (e: PointerEvent) => {
      const now = performance.now();
      if (now - lastHoverTime < 45) return;
      lastHoverTime = now;

      const rect = renderer.domElement.getBoundingClientRect();
      pointerNdc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointerNdc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(pointerNdc, camera);
      const hits = raycaster.intersectObjects(pickables, false);
      if (hoveredMesh && hoveredMesh !== hits[0]?.object) {
        if ('emissiveIntensity' in hoveredMesh.material) {
          (hoveredMesh.material as THREE.MeshStandardMaterial).emissiveIntensity =
            hoveredMesh.userData.baseEmissive ?? 0;
        }
      }
      if (hits.length > 0) {
        const hit = hits[0].object as THREE.Mesh;
        hoveredMesh = hit;
        _hoverLocalTarget.copy(hits[0].point);
        cranialRoot.worldToLocal(_hoverLocalTarget);
        hoverStrengthTarget = 1;
        if ('emissiveIntensity' in hit.material) {
          if (hit.userData.baseEmissive === undefined) {
            hit.userData.baseEmissive = (hit.material as THREE.MeshStandardMaterial).emissiveIntensity;
          }
          (hit.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.72;
        }
        renderer.domElement.style.cursor = controlsStateRef.current.pinMode ? 'crosshair' : 'pointer';
      } else {
        hoveredMesh = null;
        hoverStrengthTarget = 0;
        renderer.domElement.style.cursor = controlsStateRef.current.pinMode ? 'crosshair' : 'grab';
      }
    };

    const handleClick = (e: MouseEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointerNdc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointerNdc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointerNdc, camera);
      const hits = raycaster.intersectObjects(pickables, false);
      if (hits.length === 0) return;

      const hit = hits[0];
      const obj = hit.object;

      // 3D Spatial Pin Caliper Mode
      if (controlsStateRef.current.pinMode) {
        if (pinPoints.length >= 2) {
          clearAllPins();
        }
        const pt = hit.point.clone();
        pinPoints.push(pt);
        const pinSphere = new THREE.Mesh(
          new THREE.SphereGeometry(0.055, 16, 16),
          new THREE.MeshBasicMaterial({ color: pinPoints.length === 1 ? 0x06b6d4 : 0xf43f5e })
        );
        pinSphere.position.copy(pt);
        pinsGroup.add(pinSphere);

        shockwaveMesh.position.copy(pt);
        shockwaveMesh.lookAt(camera.position);
        shockwaveProgress = 0;
        playAnatomicalChime('pin');

        if (pinPoints.length === 2) {
          const [p1, p2] = pinPoints;
          _arcMidVec.copy(p1).add(p2).multiplyScalar(0.5);
          _arcMidVec.y += 0.14;
          const arcCurve = new THREE.QuadraticBezierCurve3(p1, _arcMidVec, p2);
          const arcTube = new THREE.Mesh(
            new THREE.TubeGeometry(arcCurve, 24, 0.014, 8, false),
            new THREE.MeshBasicMaterial({ color: 0x6d5ce7, transparent: true, opacity: 0.9 })
          );
          pinsGroup.add(arcTube);

          // Cranial vault scale (~2.85 world units across ~16.5 cm anatomical cranial breadth -> ~5.8 cm/unit)
          const distCm = Math.round(p1.distanceTo(p2) * 5.8 * 10) / 10;
          setPinSpanCm(distCm);
        }
        setPinCount(pinPoints.length);
        return;
      }

      // Standard Touch Bounce + Spatial Chime + Shockwave
      obj.userData.touchBounce = 1.0;
      shockwaveMesh.position.copy(hit.point);
      shockwaveMesh.lookAt(camera.position);
      shockwaveProgress = 0;
      playAnatomicalChime((obj.userData.soundRegion as AnatomicalSoundRegion) || 'cortex');

      setSelectedPart({
        name: obj.userData.partName || 'Anatomical Structure',
        detail: obj.userData.partDetail || '',
        focusPos: obj.userData.focusPos || [0, 0.35, 0],
      });
    };

    renderer.domElement.addEventListener('pointermove', handlePointerMove);
    renderer.domElement.addEventListener('click', handleClick);

    const resizeObserver = new ResizeObserver(() => {
      const w = container.clientWidth || 640;
      const h = Math.max(1, container.clientHeight || 460);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    });
    resizeObserver.observe(container);

    let disposed = false;
    let frameId = 0;
    const timers: number[] = [];
    const registerTimer = (id: number) => timers.push(id);
    const clock = new THREE.Clock();

    const onContextLost = (e: Event) => {
      e.preventDefault();
      cancelAnimationFrame(frameId);
    };
    renderer.domElement.addEventListener('webglcontextlost', onContextLost);

    const _ptVec = new THREE.Vector3();
    const _vPtVec = new THREE.Vector3();

    const tick = () => {
      if (disposed) return;
      const dt = Math.min(0.05, clock.getDelta());
      const elapsed = clock.getElapsedTime();
      const st = controlsStateRef.current;

      const targetSkullY = st.explodeLevel * 1.15;
      skullGroup.position.y = THREE.MathUtils.damp(skullGroup.position.y, targetSkullY, 7, dt);
      rightHemi.position.x = THREE.MathUtils.damp(rightHemi.position.x, -st.explodeLevel * 0.36, 7, dt);
      leftHemi.position.x = THREE.MathUtils.damp(leftHemi.position.x, st.explodeLevel * 0.36, 7, dt);
      skullMat.opacity = THREE.MathUtils.damp(skullMat.opacity, st.skullOpacity, 8, dt);

      // Update Volumetric Pulse Uniforms
      volumetricUniforms.uTime.value = reduced ? 0 : elapsed;
      volumetricUniforms.uIntensity.value = THREE.MathUtils.damp(
        volumetricUniforms.uIntensity.value,
        st.targetIntensity,
        5,
        dt
      );
      const targetSpeed = st.targetPulseHz * Math.PI * 2;
      volumetricUniforms.uPulseSpeed.value = THREE.MathUtils.damp(
        volumetricUniforms.uPulseSpeed.value,
        targetSpeed,
        5,
        dt
      );
      _targetPulseColor.setHex(st.targetColorHex);
      volumetricUniforms.uPulseColor.value.lerp(_targetPulseColor, Math.min(1, dt * 4));
      _targetLesionLocal.set(...st.targetLesionLocal);
      volumetricUniforms.uLesionLocal.value.lerp(_targetLesionLocal, Math.min(1, dt * 5));
      volumetricUniforms.uHoverLocal.value.lerp(_hoverLocalTarget, Math.min(1, dt * 8));
      volumetricUniforms.uHoverStrength.value = THREE.MathUtils.damp(
        volumetricUniforms.uHoverStrength.value,
        hoverStrengthTarget,
        8,
        dt
      );

      // 4D Timeline Lesion Expansion & Ventricular Mass Effect
      const currentLesionScale = THREE.MathUtils.damp(
        lesionGroup.scale.x,
        st.expansionFactor,
        7,
        dt
      );
      lesionGroup.scale.setScalar(currentLesionScale);
      shiftVectorGroup.scale.x = THREE.MathUtils.damp(
        shiftVectorGroup.scale.x,
        st.expansionFactor,
        7,
        dt
      );

      const pulseWave = reduced
        ? 0.5
        : 0.5 + 0.5 * Math.sin(elapsed * volumetricUniforms.uPulseSpeed.value);
      const baseBrainAlpha = st.insideMode ? 0.24 : 0.42;
      const targetBrainOpacity =
        baseBrainAlpha + (pulseWave - 0.5) * volumetricUniforms.uIntensity.value * 0.14;
      brainMatRight.opacity = THREE.MathUtils.damp(brainMatRight.opacity, targetBrainOpacity, 6, dt);
      brainMatLeft.opacity = brainMatRight.opacity;

      lesionMat.emissiveIntensity =
        0.28 + volumetricUniforms.uIntensity.value * (0.25 + pulseWave * 0.65);
      edemaMat.opacity = 0.14 + pulseWave * volumetricUniforms.uIntensity.value * 0.28;
      volumeCloud.visible = st.showVolumeCloud;

      if (st.isAnalyzing && !reduced) {
        scanSweepRing.position.y = Math.sin(elapsed * 2.8) * 0.82 + 0.1;
        scanSweepMat.opacity = 0.62;
      } else {
        scanSweepMat.opacity = THREE.MathUtils.damp(scanSweepMat.opacity, 0, 8, dt);
      }

      // Elastic 3D touch bounce
      for (let p = 0; p < pickables.length; p++) {
        const obj = pickables[p];
        if (obj.userData.touchBounce > 0.002) {
          obj.userData.touchBounce = THREE.MathUtils.damp(obj.userData.touchBounce, 0, 8, dt);
          const s = 1 + Math.sin(obj.userData.touchBounce * Math.PI) * 0.075;
          obj.scale.setScalar(s);
        } else if (obj.scale.x !== 1) {
          obj.scale.setScalar(1);
        }
      }

      if (shockwaveProgress < 1) {
        shockwaveProgress = Math.min(1, shockwaveProgress + dt / 0.45);
        shockwaveMesh.scale.setScalar(0.5 + shockwaveProgress * 2.6);
        shockwaveMat.opacity = Math.sin(shockwaveProgress * Math.PI) * 0.72;
      } else {
        shockwaveMat.opacity = 0;
      }

      slicePlaneGroup.visible = st.showSlicePlane;
      const targetSliceY = (st.slicePlaneHeight - 0.5) * 1.5;
      slicePlaneGroup.position.y = THREE.MathUtils.damp(
        slicePlaneGroup.position.y,
        targetSliceY,
        9,
        dt
      );

      // Tri-Planar MPR Coronal/Sagittal Offset Planes
      mprGroup.visible = st.showMprPlanes;
      if (st.showMprPlanes) {
        const zSweep = (st.slicePlaneHeight - 0.5) * 1.4;
        coronalPlane.position.z = THREE.MathUtils.damp(coronalPlane.position.z, zSweep, 8, dt);
        coronalFrame.position.z = coronalPlane.position.z;
        const xSweep = (st.slicePlaneHeight - 0.5) * 1.25;
        sagittalPlane.position.x = THREE.MathUtils.damp(sagittalPlane.position.x, xSweep, 8, dt);
        sagittalFrame.position.x = sagittalPlane.position.x;
      }

      // Synaptic Tracts Photons
      pathwaysGroup.visible = st.showPathways;
      if (st.showPathways && !reduced) {
        for (let i = 0; i < photonCount; i++) {
          const curve = tractCurves[i % tractCurves.length];
          const progress = (elapsed * 0.24 + i / photonCount) % 1;
          curve.getPointAt(progress, _ptVec);
          _photonDummy.position.copy(_ptVec);
          const pulse = 0.75 + Math.sin(elapsed * 4 + i) * 0.28;
          _photonDummy.scale.setScalar(pulse);
          _photonDummy.updateMatrix();
          photonInstanced.setMatrixAt(i, _photonDummy.matrix);
        }
        photonInstanced.instanceMatrix.needsUpdate = true;
      }

      // Cerebral Vasculature Arterial Blood Flow Particles
      vasculatureGroup.visible = st.showVessels;
      if (st.showVessels && !reduced) {
        for (let i = 0; i < vesselParticleCount; i++) {
          const curve = vesselCurves[i % vesselCurves.length];
          const progress = (elapsed * 0.36 + i / vesselParticleCount) % 1;
          curve.getPointAt(progress, _vPtVec);
          _vesselDummy.position.copy(_vPtVec);
          _vesselDummy.scale.setScalar(0.8 + pulseWave * 0.45);
          _vesselDummy.updateMatrix();
          vesselInstanced.setMatrixAt(i, _vesselDummy.matrix);
        }
        vesselInstanced.instanceMatrix.needsUpdate = true;
      }

      if (st.camTransitionActive) {
        camera.position.x = THREE.MathUtils.damp(camera.position.x, _targetCamPos.x, 5.5, dt);
        camera.position.y = THREE.MathUtils.damp(camera.position.y, _targetCamPos.y, 5.5, dt);
        camera.position.z = THREE.MathUtils.damp(camera.position.z, _targetCamPos.z, 5.5, dt);
        controls.target.x = THREE.MathUtils.damp(controls.target.x, _targetCtrlPos.x, 5.5, dt);
        controls.target.y = THREE.MathUtils.damp(controls.target.y, _targetCtrlPos.y, 5.5, dt);
        controls.target.z = THREE.MathUtils.damp(controls.target.z, _targetCtrlPos.z, 5.5, dt);

        if (camera.position.distanceTo(_targetCamPos) < 0.03) {
          st.camTransitionActive = false;
        }
      }

      controls.autoRotate = st.autoRotate && !reduced && !isSoftwareGl && !st.pinMode;
      controls.autoRotateSpeed = st.insideMode ? 0.45 : 0.85;
      controls.update();

      renderer.render(scene, camera);

      if (isSoftwareGl) {
        scheduleAfterDraw(renderer, tick, registerTimer);
      } else {
        frameId = requestAnimationFrame(tick);
      }
    };

    if (!isSoftwareGl) {
      renderer.compile(scene, camera);
    }

    tick();

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      timers.forEach((t) => window.clearTimeout(t));
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener('pointermove', handlePointerMove);
      renderer.domElement.removeEventListener('click', handleClick);
      renderer.domElement.removeEventListener('webglcontextlost', onContextLost);
      controls.dispose();

      scene.traverse((obj) => {
        if (
          (obj as THREE.Mesh).isMesh ||
          (obj as THREE.LineSegments).isLineSegments ||
          (obj as THREE.Points).isPoints ||
          (obj as THREE.InstancedMesh).isInstancedMesh
        ) {
          const m = obj as THREE.Mesh;
          m.geometry?.dispose();
          if (Array.isArray(m.material)) {
            m.material.forEach((mat) => mat.dispose());
          } else {
            m.material?.dispose();
          }
        }
      });
      shadowTex.dispose();
      gridTex.dispose();
      if (activeSliceTex) activeSliceTex.dispose();
      scene.environment?.dispose();
      renderer.dispose();

      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  if (webglUnavailable) {
    return (
      <div className="w-full h-full min-h-[420px] flex flex-col items-center justify-center bg-[#EDE9F8] p-6 text-center">
        <Layers className="w-8 h-8 text-indigo-600 mb-2" />
        <p className="text-sm font-semibold text-[#1E1B3A]">3D WebGL Context Unavailable</p>
        <p className="text-xs text-[#565278] mt-1">
          Switch back to 2D PACS view using the toolbar above.
        </p>
      </div>
    );
  }

  return (
    <div className="relative w-full h-full min-h-[460px] bg-[#EDE9F8] overflow-hidden select-none">
      {/* Isolated WebGL Mount Container */}
      <div ref={mountRef} className="w-full h-full min-h-[460px]" />

      {/* Top-Left Minimal Spec & Volumetric Pulse Readout */}
      <div className="pointer-events-none absolute top-3 left-3.5 z-10 max-w-[60%] text-xs font-mono tabular-nums space-y-0.5">
        <div className="text-[#1E1B3A] font-semibold truncate">
          4D/5D Volumetric Brain · {activeCase.accessionNumber}
        </div>
        <div className="text-indigo-700 font-medium truncate">
          {focusedSubtype
            ? SUBTYPE_FOCUS_CAMERA[focusedSubtype].label
            : activeCase.analysis?.anyHemorrhage
            ? `${activeCase.analysis.dominantSubtype.toUpperCase()} · ${activeCase.analysis.localization.anatomicalRegion}`
            : 'Translucent Parenchyma · Drag to orbit · Click to touch'}
        </div>
        <div className="flex items-center gap-2 text-[11px] text-[#4A4766]">
          <Activity className="w-3 h-3 text-indigo-600 shrink-0" />
          <span>
            {volumetricMetrics.label} · {Math.round(volumetricMetrics.intensity * 100)}% ·{' '}
            {volumetricMetrics.pulseHz.toFixed(1)} Hz
          </span>
        </div>
      </div>

      {/* Top-Right Direct 3D Pin Caliper Floating HUD (when 3D Pin mode active or span measured) */}
      {(pinMode || pinSpanCm !== null) && (
        <div className="absolute top-3 right-3.5 z-20 bg-white/95 border border-[#A78BFA]/75 rounded-xl px-3 py-2 text-xs shadow-lg space-y-1.5 max-w-[235px]">
          <div className="flex items-center justify-between gap-2 font-mono">
            <span className="inline-flex items-center gap-1 text-indigo-700 font-semibold">
              <Crosshair className="w-3.5 h-3.5" />
              3D Spatial Caliper
            </span>
            <span className="text-[11px] text-[#565278] tabular-nums">{pinCount}/2 pins</span>
          </div>
          {pinSpanCm !== null ? (
            <>
              <div className="text-sm font-mono font-semibold tabular-nums text-[#1E1B3A]">
                Span: {pinSpanCm.toFixed(1)} cm
              </div>
              <div className="flex items-center gap-1.5">
                {onSync3dCaliperToAbc && (
                  <TactileButton
                    variant="active"
                    soundVariant="confirm"
                    onClick={() => onSync3dCaliperToAbc(pinSpanCm)}
                    className="flex-1 py-1 px-2 text-[11px] font-medium rounded"
                  >
                    Send to ABC/2
                  </TactileButton>
                )}
                <TactileButton
                  variant="secondary"
                  onClick={() => clearPinsRef.current?.()}
                  className="py-1 px-2 text-[11px] font-medium rounded"
                >
                  Clear
                </TactileButton>
              </div>
            </>
          ) : (
            <div className="text-[11px] text-[#4A4766]">
              Click {pinCount === 0 ? '2 points' : '1 more point'} on the 3D brain or clot to measure
              in cm.
            </div>
          )}
        </div>
      )}

      {/* Selected Anatomical Part Readout */}
      {selectedPart && !pinMode && pinSpanCm === null && (
        <div className="absolute top-3 right-3.5 z-20 max-w-[248px] bg-white/95 border border-[#A78BFA]/70 rounded-xl p-3 text-xs space-y-2 shadow-lg">
          <div className="flex items-start justify-between gap-2">
            <span className="font-semibold text-indigo-700 leading-snug">{selectedPart.name}</span>
            <button
              type="button"
              onClick={() => setSelectedPart(null)}
              className="text-[#565278] hover:text-[#1E1B3A] text-[11px] font-mono cursor-pointer shrink-0"
            >
              Close
            </button>
          </div>
          <p className="text-[11px] text-[#3E3A5E] leading-relaxed">{selectedPart.detail}</p>
          <div className="flex flex-col gap-1.5">
            <TactileButton
              variant="secondary"
              onClick={() => flyToSelectedPart(selectedPart.focusPos)}
              className="w-full py-1 px-2 text-[11px] font-medium rounded"
            >
              <Compass className="w-3 h-3 text-indigo-600" />
              Dive Closer to Structure
            </TactileButton>
            {onAskConsultAboutPart && (
              <TactileButton
                variant="active"
                onClick={() =>
                  onAskConsultAboutPart(
                    `Explain the clinical significance of the ${selectedPart.name} findings in this ${
                      activeCase.analysis?.dominantSubtype?.toUpperCase() || 'head CT'
                    } scan.`
                  )
                }
                className="w-full py-1 px-2 text-[11px] font-medium rounded"
              >
                <Sparkles className="w-3 h-3 text-indigo-700" />
                Consult on Structure
              </TactileButton>
            )}
          </div>
        </div>
      )}

      {/* Cleanly Aligned Compact Bottom 3D/4D Dock */}
      <div
        className={`absolute bottom-2.5 left-1/2 -translate-x-1/2 z-20 w-[calc(100%-24px)] max-w-[700px] transition-transform duration-200 ease-out ${
          dockCollapsed ? 'translate-y-[calc(100%-28px)]' : 'translate-y-0'
        }`}
      >
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => setDockCollapsed((v) => !v)}
            className="inline-flex items-center gap-1.5 px-3 py-0.5 text-[10px] font-mono text-[#4A4766] hover:text-indigo-700 bg-white border border-b-0 border-[#DCD5F4] rounded-t-md cursor-pointer shadow-xs"
          >
            {dockCollapsed ? (
              <>
                <ChevronUp className="w-3 h-3" />
                Show 3D/4D Controls
              </>
            ) : (
              <>
                <ChevronDown className="w-3 h-3" />
                Hide Controls
              </>
            )}
          </button>
        </div>

        <div className="bg-white/95 border border-[#DCD5F4] rounded-xl px-3 py-2 shadow-[0_14px_30px_-10px_rgba(91,75,138,0.22)] space-y-2">
          {/* Row 1: Camera Presets + Anatomical & 5D Tool Toggles */}
          <div className="flex flex-wrap items-center justify-between gap-1.5">
            <div className="flex flex-wrap items-center gap-1">
              {CAMERA_PRESETS.map((preset) => (
                <TactileButton
                  key={preset.id}
                  variant={activePreset === preset.id ? 'active' : 'secondary'}
                  onClick={() => triggerCameraPreset(preset)}
                  className="px-2 py-1 text-[10px] font-semibold rounded whitespace-nowrap shrink-0"
                >
                  {preset.id === 'inside' && <Compass className="w-3 h-3" />}
                  {preset.label}
                </TactileButton>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-1">
              <TactileButton
                variant={showVolumeCloud ? 'active' : 'secondary'}
                onClick={() => setShowVolumeCloud((v) => !v)}
                className="px-2 py-1 text-[10px] font-semibold rounded whitespace-nowrap shrink-0"
              >
                <Activity className="w-3 h-3" />
                Vol
              </TactileButton>

              <TactileButton
                variant={showVessels ? 'active' : 'secondary'}
                onClick={() => setShowVessels((v) => !v)}
                title="Toggle Circle of Willis & Cerebral Vasculature"
                className="px-2 py-1 text-[10px] font-semibold rounded whitespace-nowrap shrink-0"
              >
                <GitBranch className="w-3 h-3" />
                Vessels
              </TactileButton>

              <TactileButton
                variant={showPathways ? 'active' : 'secondary'}
                onClick={() => setShowPathways((v) => !v)}
                className="px-2 py-1 text-[10px] font-semibold rounded whitespace-nowrap shrink-0"
              >
                <Zap className="w-3 h-3" />
                Tracts
              </TactileButton>

              <TactileButton
                variant={showMprPlanes ? 'active' : 'secondary'}
                onClick={() => setShowMprPlanes((v) => !v)}
                title="Toggle Tri-Planar 3D MPR Orthogonal Slice Planes"
                className="px-2 py-1 text-[10px] font-semibold rounded whitespace-nowrap shrink-0"
              >
                <Layers className="w-3 h-3" />
                MPR
              </TactileButton>

              <TactileButton
                variant={pinMode ? 'active' : 'secondary'}
                onClick={() => setPinMode((v) => !v)}
                title="Click 2 points on the 3D brain to measure span in cm"
                className="px-2 py-1 text-[10px] font-semibold rounded whitespace-nowrap shrink-0"
              >
                <MapPin className="w-3 h-3" />
                3D Pin
              </TactileButton>

              <TactileButton
                variant={sonicPulse ? 'active' : 'secondary'}
                onClick={() => setSonicPulse((v) => !v)}
                title="Toggle Spatial Heartbeat Sonification synced to bleed intensity"
                className="px-2 py-1 text-[10px] font-semibold rounded whitespace-nowrap shrink-0"
              >
                <Radio className="w-3 h-3" />
                Sonic
              </TactileButton>

              <TactileButton
                variant={showSlicePlane ? 'active' : 'secondary'}
                onClick={() => setShowSlicePlane((v) => !v)}
                className="px-2 py-1 text-[10px] font-semibold rounded whitespace-nowrap shrink-0"
              >
                <Eye className="w-3 h-3" />
                Slice
              </TactileButton>

              <TactileButton
                variant={autoRotate ? 'active' : 'secondary'}
                onClick={() => setAutoRotate((v) => !v)}
                className="px-2 py-1 text-[10px] font-semibold rounded whitespace-nowrap shrink-0"
              >
                Orbit
              </TactileButton>

              <TactileButton
                variant="secondary"
                onClick={() => {
                  setExplodeLevel(0.18);
                  setSkullOpacity(0.22);
                  setSlicePlaneHeight(0.5);
                  setShowVolumeCloud(true);
                  setShowPathways(true);
                  setShowVessels(true);
                  setTimelineHours(0);
                  setReversalApplied(false);
                  setPinMode(false);
                  clearPinsRef.current?.();
                  triggerCameraPreset(CAMERA_PRESETS[0]);
                }}
                title="Reset 3D camera & layers"
                className="p-1 rounded text-[#3E3A5E]"
              >
                <RotateCcw className="w-3 h-3" />
              </TactileButton>
            </div>
          </div>

          {/* Row 2: Anatomical Explode / Skull / Z-Plane Sliders */}
          <div className="grid grid-cols-3 gap-2.5 text-[10px] font-mono text-[#4A4766]">
            <label className="flex items-center gap-1.5">
              <span className="whitespace-nowrap">Explode</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.02}
                value={explodeLevel}
                onChange={(e) => setExplodeLevel(Number(e.target.value))}
                className="w-full accent-indigo-500 h-1.5 bg-[#E8E2F7] rounded cursor-pointer"
              />
            </label>

            <label className="flex items-center gap-1.5">
              <span className="whitespace-nowrap">Skull</span>
              <input
                type="range"
                min={0.04}
                max={0.65}
                step={0.02}
                value={skullOpacity}
                onChange={(e) => setSkullOpacity(Number(e.target.value))}
                className="w-full accent-indigo-500 h-1.5 bg-[#E8E2F7] rounded cursor-pointer"
              />
            </label>

            <label className="flex items-center gap-1.5">
              <span className="whitespace-nowrap">Z-Plane</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.02}
                value={slicePlaneHeight}
                onChange={(e) => setSlicePlaneHeight(Number(e.target.value))}
                className="w-full accent-indigo-500 h-1.5 bg-[#E8E2F7] rounded cursor-pointer"
              />
            </label>
          </div>

          {/* Row 3: 4D Hematoma Expansion & Reversal Timeline (visible when bleed detected) */}
          {hasHemorrhage && (
            <div className="flex flex-wrap items-center justify-between gap-2 pt-1.5 border-t border-[#EDE8F8] text-[10px] font-mono">
              <div className="flex items-center gap-2 flex-1 min-w-[200px]">
                <Timer className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                <span className="text-[#4A4766] whitespace-nowrap">4D Growth</span>
                <input
                  type="range"
                  min={0}
                  max={24}
                  step={1}
                  value={timelineHours}
                  onChange={(e) => setTimelineHours(Number(e.target.value))}
                  className="w-full accent-rose-500 h-1.5 bg-[#FDE8EC] rounded cursor-pointer"
                  aria-label="4D Hematoma expansion forecast timeline in hours"
                />
                <span className="text-[#1E1B3A] font-semibold tabular-nums whitespace-nowrap">
                  T+{timelineHours}h · ~{projectedVolumeMl.toFixed(1)} mL
                </span>
              </div>

              <TactileButton
                variant={reversalApplied ? 'active' : 'secondary'}
                soundVariant="confirm"
                onClick={() => setReversalApplied((v) => !v)}
                title="Simulate STAT PCC / Idarucizumab / Andexanet anticoagulation reversal"
                className="px-2 py-0.5 text-[10px] font-semibold rounded whitespace-nowrap shrink-0"
              >
                <ShieldCheck className="w-3 h-3 text-emerald-600" />
                {reversalApplied ? 'Reversal Active' : 'Simulate Reversal'}
              </TactileButton>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
