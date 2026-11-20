import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import {
  detectSoftwareWebGL,
  prefersReducedMotion,
  scheduleAfterDraw,
} from '../../utils/webglDetect';

interface PageTransition3DProps {
  transitionKey: string;
  subTransitionKey?: string;
}

const _dummy = new THREE.Object3D();

/**
 * Lusion-inspired "Voyage Inside the Mind" 3D WebGL Portal Transition.
 * Non-gory, luminous pastel architectural anatomy:
 * - Full tab changes fly the camera inward along a helical neural tunnel through
 *   translucent pastel cranial/vascular rings, glowing synaptic fiber ribbons, and
 *   floating bioluminescent micro-spheres.
 * - Case switches (`subTransitionKey`) trigger a fast, crisp radial synaptic wave.
 */
export const PageTransition3D: React.FC<PageTransition3DProps> = ({
  transitionKey,
  subTransitionKey,
}) => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<((mode: 'full' | 'pulse') => void) | null>(null);
  const firstMountRef = useRef(true);
  const firstSubMountRef = useRef(true);

  useEffect(() => {
    if (firstMountRef.current) {
      firstMountRef.current = false;
      return;
    }
    triggerRef.current?.('full');
  }, [transitionKey]);

  useEffect(() => {
    if (firstSubMountRef.current) {
      firstSubMountRef.current = false;
      return;
    }
    triggerRef.current?.('pulse');
  }, [subTransitionKey]);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const reduced = prefersReducedMotion();
    if (reduced) return;

    const isSoftwareGl = detectSoftwareWebGL();
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: !isSoftwareGl,
        alpha: true,
        powerPreference: 'high-performance',
      });
    } catch {
      return;
    }

    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 1.5));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(
      54,
      window.innerWidth / Math.max(1, window.innerHeight),
      0.1,
      48
    );
    camera.position.set(0, 0, 10);

    const keyLight = new THREE.DirectionalLight(0xffffff, 1.9);
    keyLight.position.set(3, 5, 8);
    scene.add(keyLight);
    scene.add(new THREE.HemisphereLight(0xfdf2f8, 0xc4b5fd, 1.35));

    const tunnelGroup = new THREE.Group();
    scene.add(tunnelGroup);

    // 1. Concentric Pastel Vascular / Neural Aperture Rings (Voyage Inward Tunnel)
    const pastelHexes = [0xddd6fe, 0xa7f3d0, 0xfecdd3, 0xbfdbfe, 0xfde68a, 0xc4b5fd];
    const ringCount = 12;
    const ringGeo = new THREE.TorusGeometry(2.65, 0.065, 14, 72);
    const rings: Array<{
      mesh: THREE.Mesh;
      mat: THREE.MeshStandardMaterial;
      baseZ: number;
      baseRotZ: number;
      baseScale: number;
    }> = [];

    for (let i = 0; i < ringCount; i++) {
      const mat = new THREE.MeshStandardMaterial({
        color: pastelHexes[i % pastelHexes.length],
        emissive: pastelHexes[(i + 1) % pastelHexes.length],
        emissiveIntensity: 0.28,
        roughness: 0.2,
        metalness: 0.15,
        transparent: true,
        opacity: 0,
      });
      const mesh = new THREE.Mesh(ringGeo, mat);
      const baseZ = 7.2 - i * 1.45;
      const baseScale = 0.85 + Math.sin(i * 0.6) * 0.18;
      mesh.position.set(Math.sin(i * 0.7) * 0.28, Math.cos(i * 0.5) * 0.22, baseZ);
      mesh.scale.setScalar(baseScale);
      tunnelGroup.add(mesh);
      rings.push({
        mesh,
        mat,
        baseZ,
        baseRotZ: i * 0.35,
        baseScale,
      });
    }

    // 2. Serene Helical Synaptic Fiber Strands curving into depth
    const fiberCount = 6;
    const fiberMeshes: Array<{ mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial }> = [];
    for (let f = 0; f < fiberCount; f++) {
      const baseAngle = (f / fiberCount) * Math.PI * 2;
      const pts: THREE.Vector3[] = [];
      for (let s = 0; s <= 16; s++) {
        const t = s / 16;
        const z = 8.5 - t * 20;
        const angle = baseAngle + t * Math.PI * 1.35;
        const radius = 2.35 + Math.sin(t * Math.PI * 2 + f) * 0.42;
        pts.push(new THREE.Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius, z));
      }
      const curve = new THREE.CatmullRomCurve3(pts);
      const tubeGeo = new THREE.TubeGeometry(curve, 44, 0.032, 8, false);
      const mat = new THREE.MeshBasicMaterial({
        color: pastelHexes[(f + 2) % pastelHexes.length],
        transparent: true,
        opacity: 0,
      });
      const mesh = new THREE.Mesh(tubeGeo, mat);
      tunnelGroup.add(mesh);
      fiberMeshes.push({ mesh, mat });
    }

    // 3. Bioluminescent Pastel Neural Micro-Orbs (InstancedMesh)
    const orbCount = 48;
    const orbGeo = new THREE.SphereGeometry(0.085, 10, 10);
    const orbMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0,
    });
    const orbInstanced = new THREE.InstancedMesh(orbGeo, orbMat, orbCount);
    const orbPalette = [
      new THREE.Color(0xc4b5fd),
      new THREE.Color(0x6ee7b7),
      new THREE.Color(0xfda4af),
      new THREE.Color(0x93c5fd),
    ];
    const orbSeeds: Array<{ angle: number; radius: number; z: number; scale: number }> = [];
    for (let i = 0; i < orbCount; i++) {
      const angle = (i / orbCount) * Math.PI * 6.5;
      const radius = 1.15 + ((i * 37) % 19) * 0.11;
      const z = 7.5 - (i / orbCount) * 18.5;
      const scale = 0.55 + ((i * 13) % 9) * 0.1;
      orbSeeds.push({ angle, radius, z, scale });
      orbInstanced.setColorAt(i, orbPalette[i % orbPalette.length]);
    }
    if (orbInstanced.instanceColor) orbInstanced.instanceColor.needsUpdate = true;
    tunnelGroup.add(orbInstanced);

    // 4. Center Translucent Expanding Portal Halo (used in both full & pulse modes)
    const portalGeo = new THREE.TorusGeometry(1.7, 0.055, 14, 72);
    const portalMat = new THREE.MeshBasicMaterial({
      color: 0xa78bfa,
      transparent: true,
      opacity: 0,
    });
    const portalHalo = new THREE.Mesh(portalGeo, portalMat);
    scene.add(portalHalo);

    let active = false;
    let mode: 'full' | 'pulse' = 'full';
    let progress = 0;
    let disposed = false;
    let frameId = 0;
    const timers: number[] = [];
    const registerTimer = (id: number) => timers.push(id);
    const clock = new THREE.Clock();

    const handleResize = () => {
      camera.aspect = window.innerWidth / Math.max(1, window.innerHeight);
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener('resize', handleResize);

    const runLoop = () => {
      if (disposed || !active) return;
      const dt = Math.min(0.05, clock.getDelta());
      const duration = mode === 'full' ? 0.68 : 0.42;
      progress += dt / duration;

      if (progress >= 1.05) {
        active = false;
        rings.forEach((r) => {
          r.mat.opacity = 0;
        });
        fiberMeshes.forEach((f) => {
          f.mat.opacity = 0;
        });
        orbMat.opacity = 0;
        portalMat.opacity = 0;
        renderer.clear();
        return;
      }

      const t = Math.min(1, progress);
      const envelope = Math.sin(t * Math.PI);

      if (mode === 'full') {
        // Camera gracefully dives inward into the luminous pastel neural tunnel
        const camZ = 10.2 - t * 14.5;
        camera.position.set(
          Math.sin(t * Math.PI * 1.4) * 0.42,
          Math.cos(t * Math.PI * 1.1) * 0.25,
          camZ
        );
        camera.lookAt(0, 0, camZ - 6);
        tunnelGroup.rotation.z = t * 0.55;

        rings.forEach((r, idx) => {
          const distFromCam = camera.position.z - r.baseZ;
          const proxAlpha = distFromCam > -0.5 && distFromCam < 13 ? 1 - Math.abs(distFromCam - 4.5) / 8.5 : 0;
          r.mat.opacity = Math.max(0, Math.min(0.55, envelope * Math.max(0.1, proxAlpha) * 0.62));
          r.mesh.rotation.z = r.baseRotZ + t * (idx % 2 === 0 ? 0.8 : -0.8);
          r.mesh.scale.setScalar(r.baseScale * (0.92 + envelope * 0.25));
        });

        fiberMeshes.forEach((f) => {
          f.mat.opacity = envelope * 0.48;
        });

        orbMat.opacity = envelope * 0.72;
        for (let i = 0; i < orbCount; i++) {
          const seed = orbSeeds[i];
          const a = seed.angle + t * 1.1;
          _dummy.position.set(
            Math.cos(a) * seed.radius,
            Math.sin(a) * seed.radius,
            seed.z + t * 1.4
          );
          _dummy.scale.setScalar(seed.scale * (0.7 + envelope * 0.6));
          _dummy.updateMatrix();
          orbInstanced.setMatrixAt(i, _dummy.matrix);
        }
        orbInstanced.instanceMatrix.needsUpdate = true;

        portalMat.opacity = envelope * 0.52;
        portalHalo.position.set(0, 0, camZ - 4.5);
        portalHalo.scale.setScalar(0.65 + t * 1.65);
        portalHalo.rotation.x = t * 0.6;
        portalHalo.rotation.y = t * 0.9;
      } else {
        // Lightweight radial synaptic ripple when selecting another CT exam
        camera.position.set(0, 0, 10 - t * 2.4);
        camera.lookAt(0, 0, 0);
        rings.forEach((r) => {
          r.mat.opacity = 0;
        });
        fiberMeshes.forEach((f) => {
          f.mat.opacity = envelope * 0.18;
        });
        orbMat.opacity = envelope * 0.42;
        for (let i = 0; i < orbCount; i++) {
          const seed = orbSeeds[i];
          _dummy.position.set(
            Math.cos(seed.angle) * (seed.radius + t * 0.8),
            Math.sin(seed.angle) * (seed.radius + t * 0.8),
            seed.z + 4
          );
          _dummy.scale.setScalar(seed.scale * envelope);
          _dummy.updateMatrix();
          orbInstanced.setMatrixAt(i, _dummy.matrix);
        }
        orbInstanced.instanceMatrix.needsUpdate = true;

        portalMat.opacity = envelope * 0.48;
        portalHalo.position.set(0, 0, 2);
        portalHalo.scale.setScalar(0.5 + t * 2.1);
        portalHalo.rotation.set(t * 0.4, t * 0.7, 0);
      }

      renderer.render(scene, camera);

      if (isSoftwareGl) {
        scheduleAfterDraw(renderer, runLoop, registerTimer);
      } else {
        frameId = requestAnimationFrame(runLoop);
      }
    };

    triggerRef.current = (nextMode: 'full' | 'pulse') => {
      mode = nextMode;
      progress = 0;
      clock.getDelta();
      if (!active) {
        active = true;
        runLoop();
      }
    };

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      timers.forEach((t) => window.clearTimeout(t));
      window.removeEventListener('resize', handleResize);
      ringGeo.dispose();
      rings.forEach((r) => r.mat.dispose());
      fiberMeshes.forEach((f) => {
        f.mesh.geometry.dispose();
        f.mat.dispose();
      });
      orbGeo.dispose();
      orbMat.dispose();
      portalGeo.dispose();
      portalMat.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  return (
    <div
      ref={mountRef}
      aria-hidden="true"
      className="fixed inset-0 pointer-events-none z-50 no-print"
    />
  );
};
