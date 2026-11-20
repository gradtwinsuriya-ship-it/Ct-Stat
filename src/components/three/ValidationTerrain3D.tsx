import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Layers, RotateCcw } from 'lucide-react';
import { MULTI_DATASET_COHORT, SUBTYPE_PROFILES } from '../../data/rsnaCohort';
import type { HemorrhageSubtypeId } from '../../types/ct';
import {
  detectSoftwareWebGL,
  prefersReducedMotion,
  scheduleAfterDraw,
} from '../../utils/webglDetect';
import { playTactileSound } from '../../utils/hapticSound';
import { TactileButton } from '../ui/Tactile3D';

interface ValidationTerrain3DProps {
  selectedSubtypeId: HemorrhageSubtypeId;
  onSelectSubtype: (id: HemorrhageSubtypeId) => void;
}

interface TerrainBeacon {
  id: HemorrhageSubtypeId;
  shortCode: string;
  auroc: number;
  sensitivity: number;
  x: number;
  z: number;
  color: number;
}

const SUBTYPE_BEACONS: TerrainBeacon[] = [
  { id: 'epidural', shortCode: 'EDH', auroc: 0.968, sensitivity: 94.2, x: -2.1, z: -0.9, color: 0xf43f5e },
  { id: 'subdural', shortCode: 'SDH', auroc: 0.962, sensitivity: 93.4, x: -1.05, z: 0.95, color: 0xfb923c },
  { id: 'subarachnoid', shortCode: 'SAH', auroc: 0.941, sensitivity: 89.6, x: 0.05, z: -1.15, color: 0xf59e0b },
  { id: 'intraventricular', shortCode: 'IVH', auroc: 0.974, sensitivity: 95.8, x: 1.15, z: 0.85, color: 0xec4899 },
  { id: 'intraparenchymal', shortCode: 'IPH', auroc: 0.969, sensitivity: 94.6, x: 2.1, z: -0.75, color: 0x8b5cf6 },
];

function evaluateTerrainHeight(x: number, z: number): number {
  let h = 0.08 * Math.sin(x * 1.1) * Math.cos(z * 1.1);
  for (let i = 0; i < SUBTYPE_BEACONS.length; i++) {
    const b = SUBTYPE_BEACONS[i];
    const dx = x - b.x;
    const dz = z - b.z;
    const peak = (b.auroc - 0.85) * 10.5;
    h += peak * Math.exp(-(dx * dx + dz * dz) * 1.35);
  }
  return Math.max(0.02, h);
}

export const ValidationTerrain3D: React.FC<ValidationTerrain3DProps> = ({
  selectedSubtypeId,
  onSelectSubtype,
}) => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const selectedRef = useRef<HemorrhageSubtypeId>(selectedSubtypeId);
  const resetCamRef = useRef<(() => void) | null>(null);
  const [webglUnavailable, setWebglUnavailable] = useState<boolean>(false);

  useEffect(() => {
    selectedRef.current = selectedSubtypeId;
  }, [selectedSubtypeId]);

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
    renderer.toneMappingExposure = 1.05;
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.setSize(container.clientWidth || 720, container.clientHeight || 290);
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf4f0fc);
    scene.fog = new THREE.FogExp2(0xf4f0fc, 0.055);

    const pmrem = new THREE.PMREMGenerator(renderer);
    const roomEnv = new RoomEnvironment();
    scene.environment = pmrem.fromScene(roomEnv, 0.04).texture;
    roomEnv.dispose();
    pmrem.dispose();

    const camera = new THREE.PerspectiveCamera(
      38,
      (container.clientWidth || 720) / Math.max(1, container.clientHeight || 290),
      0.1,
      40
    );
    camera.position.set(0, 3.6, 5.4);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.07;
    controls.minDistance = 2.8;
    controls.maxDistance = 8.5;
    controls.maxPolarAngle = Math.PI * 0.45;
    controls.target.set(0, 0.55, 0);

    resetCamRef.current = () => {
      camera.position.set(0, 3.6, 5.4);
      controls.target.set(0, 0.55, 0);
      controls.update();
    };

    scene.add(new THREE.HemisphereLight(0xffffff, 0xc4b5fd, 1.25));
    const dirLight = new THREE.DirectionalLight(0xfff8f0, 1.5);
    dirLight.position.set(4, 6, 4);
    scene.add(dirLight);

    // Topographic ROC Surface Mesh
    const planeGeo = new THREE.PlaneGeometry(6.6, 4.2, 48, 34);
    planeGeo.rotateX(-Math.PI / 2);

    const pos = planeGeo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const cLow = new THREE.Color(0xd8cffc);
    const cMid = new THREE.Color(0x818cf8);
    const cHigh = new THREE.Color(0x34d399);
    const tmpCol = new THREE.Color();

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const y = evaluateTerrainHeight(x, z);
      pos.setY(i, y);

      const t = Math.max(0, Math.min(1, y / 1.45));
      if (t < 0.5) {
        tmpCol.copy(cLow).lerp(cMid, t * 2);
      } else {
        tmpCol.copy(cMid).lerp(cHigh, (t - 0.5) * 2);
      }
      colors[i * 3] = tmpCol.r;
      colors[i * 3 + 1] = tmpCol.g;
      colors[i * 3 + 2] = tmpCol.b;
    }
    planeGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    planeGeo.computeVertexNormals();

    const terrainMat = new THREE.MeshPhysicalMaterial({
      vertexColors: true,
      roughness: 0.35,
      metalness: 0.08,
      clearcoat: 0.4,
      transparent: true,
      opacity: 0.88,
      side: THREE.DoubleSide,
    });
    const terrainMesh = new THREE.Mesh(planeGeo, terrainMat);
    scene.add(terrainMesh);

    const wireMat = new THREE.MeshBasicMaterial({
      color: 0x7c3aed,
      wireframe: true,
      transparent: true,
      opacity: 0.14,
    });
    const wireMesh = new THREE.Mesh(planeGeo, wireMat);
    wireMesh.position.y = 0.004;
    scene.add(wireMesh);

    // Interactive Clickable Subtype Peak Beacons
    const beaconPickables: THREE.Mesh[] = [];
    const beaconOrbs: { id: HemorrhageSubtypeId; orb: THREE.Mesh; ring: THREE.Mesh; baseY: number }[] = [];

    SUBTYPE_BEACONS.forEach((b) => {
      const h = evaluateTerrainHeight(b.x, b.z);
      const stemGeo = new THREE.CylinderGeometry(0.025, 0.035, 0.55, 10);
      const stemMat = new THREE.MeshStandardMaterial({
        color: b.color,
        emissive: b.color,
        emissiveIntensity: 0.25,
      });
      const stem = new THREE.Mesh(stemGeo, stemMat);
      stem.position.set(b.x, h + 0.25, b.z);
      scene.add(stem);

      const orbGeo = new THREE.SphereGeometry(0.13, 18, 18);
      const orbMat = new THREE.MeshPhysicalMaterial({
        color: b.color,
        emissive: b.color,
        emissiveIntensity: 0.35,
        roughness: 0.18,
        clearcoat: 0.9,
      });
      const orb = new THREE.Mesh(orbGeo, orbMat);
      orb.position.set(b.x, h + 0.6, b.z);
      orb.userData.subtypeId = b.id;
      scene.add(orb);
      beaconPickables.push(orb);

      const ringGeo = new THREE.TorusGeometry(0.21, 0.018, 8, 32);
      const ringMat = new THREE.MeshBasicMaterial({
        color: b.color,
        transparent: true,
        opacity: 0.55,
      });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.rotation.x = Math.PI / 2;
      ring.position.set(b.x, h + 0.6, b.z);
      scene.add(ring);

      beaconOrbs.push({ id: b.id, orb, ring, baseY: h + 0.6 });
    });

    const raycaster = new THREE.Raycaster();
    const pointerNdc = new THREE.Vector2();

    const handlePointerMove = (e: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointerNdc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointerNdc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointerNdc, camera);
      const hits = raycaster.intersectObjects(beaconPickables, false);
      renderer.domElement.style.cursor = hits.length > 0 ? 'pointer' : 'grab';
    };

    const handleClick = (e: MouseEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointerNdc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointerNdc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointerNdc, camera);
      const hits = raycaster.intersectObjects(beaconPickables, false);
      if (hits.length > 0) {
        const subId = hits[0].object.userData.subtypeId as HemorrhageSubtypeId | undefined;
        if (subId) {
          playTactileSound('click');
          onSelectSubtype(subId);
        }
      }
    };

    renderer.domElement.addEventListener('pointermove', handlePointerMove);
    renderer.domElement.addEventListener('click', handleClick);

    const resizeObserver = new ResizeObserver(() => {
      const w = container.clientWidth || 720;
      const h = Math.max(1, container.clientHeight || 290);
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

    const tick = () => {
      if (disposed) return;
      const elapsed = clock.getElapsedTime();
      const sel = selectedRef.current;

      for (let i = 0; i < beaconOrbs.length; i++) {
        const item = beaconOrbs[i];
        const isSel = item.id === sel;
        const bob = reduced ? 0 : Math.sin(elapsed * 2.4 + i) * 0.035;
        item.orb.position.y = item.baseY + bob;
        item.ring.position.y = item.orb.position.y;
        item.orb.scale.setScalar(isSel ? 1.32 : 1.0);
        item.ring.scale.setScalar(isSel ? 1.45 + (reduced ? 0 : Math.sin(elapsed * 4) * 0.12) : 0.85);
        (item.orb.material as THREE.MeshPhysicalMaterial).emissiveIntensity = isSel ? 0.85 : 0.25;
      }

      controls.autoRotate = !reduced && !isSoftwareGl;
      controls.autoRotateSpeed = 0.45;
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
        if ((obj as THREE.Mesh).isMesh) {
          const m = obj as THREE.Mesh;
          m.geometry?.dispose();
          if (Array.isArray(m.material)) m.material.forEach((mat) => mat.dispose());
          else m.material?.dispose();
        }
      });
      scene.environment?.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [onSelectSubtype]);

  const activeProfile =
    SUBTYPE_PROFILES.find((p) => p.id === selectedSubtypeId) ?? SUBTYPE_PROFILES[0];

  if (webglUnavailable) {
    return (
      <div className="surface-3d border border-[#E3DCF5] rounded-xl p-6 text-center text-xs text-[#565278]">
        <Layers className="w-6 h-6 text-indigo-600 mx-auto mb-2" />
        3D ROC Topographic Terrain unavailable on this browser context.
      </div>
    );
  }

  return (
    <div className="surface-3d border border-[#E3DCF5] rounded-xl overflow-hidden">
      <div className="px-4 py-2.5 border-b border-[#E3DCF5] bg-[#FAF8FF] flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-[#1E1B3A]">
            3D Topographic ROC &amp; Multi-Cohort Landscape
          </h2>
          <p className="text-[11px] text-[#565278]">
            Orbit the 3D AUROC elevation surface or click any floating subtype beacon spire (RSNA ·
            CQ500 · PhysioNet TBI)
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            {SUBTYPE_PROFILES.map((s) => (
              <TactileButton
                key={s.id}
                variant={selectedSubtypeId === s.id ? 'active' : 'secondary'}
                onClick={() => onSelectSubtype(s.id)}
                className="px-2 py-1 text-[10px] font-mono font-semibold rounded"
              >
                {s.shortCode}
              </TactileButton>
            ))}
          </div>
          <TactileButton
            variant="secondary"
            onClick={() => resetCamRef.current?.()}
            title="Reset 3D Terrain Camera"
            className="p-1.5 rounded text-[#3E3A5E]"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </TactileButton>
        </div>
      </div>

      <div className="relative h-[280px] w-full bg-[#F4F0FC]">
        <div ref={mountRef} className="w-full h-full" />

        <div className="pointer-events-none absolute bottom-3 left-3.5 bg-white/90 border border-[#DCD5F4] rounded-lg px-3 py-2 text-xs shadow-sm space-y-0.5">
          <div className="font-semibold text-indigo-700">
            {activeProfile.name} ({activeProfile.shortCode})
          </div>
          <div className="font-mono text-[11px] tabular-nums text-[#2D2952]">
            AUROC {activeProfile.validationAuroc.toFixed(3)} · Sens{' '}
            {activeProfile.validationSensitivityPct.toFixed(1)}% · Spec{' '}
            {activeProfile.validationSpecificityPct.toFixed(1)}%
          </div>
        </div>

        <div className="pointer-events-none absolute top-3 right-3.5 bg-white/90 border border-[#DCD5F4] rounded-lg px-2.5 py-1.5 text-[10px] font-mono text-[#4A4766]">
          {MULTI_DATASET_COHORT.map((d) => `${d.id.toUpperCase()} (${d.exams.toLocaleString()})`).join(
            ' · '
          )}
        </div>
      </div>
    </div>
  );
};
