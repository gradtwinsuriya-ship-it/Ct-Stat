import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import type { TriageLevel } from '../../types/ct';
import {
  detectSoftwareWebGL,
  prefersReducedMotion,
  scheduleAfterDraw,
} from '../../utils/webglDetect';

interface AmbientNeuroBackdropProps {
  triageLevel?: TriageLevel;
  isAnalyzing?: boolean;
  activeTab?: string;
  activeCaseId?: string;
}

const TRIAGE_ACCENTS: Record<TriageLevel, number> = {
  STAT_SURGICAL: 0xfda4af,
  URGENT_NEURO: 0xfdba74,
  PRIORITY_REVIEW: 0xa78bfa,
  ROUTINE_NEGATIVE: 0x6ee7b7,
};

const RIBBON_VERTEX_SHADER = /* glsl */ `
  uniform float uTime;
  uniform float uImpulse;
  uniform float uTouchPulse;
  uniform vec2 uTouchPos;
  varying vec3 vNormalWorld;
  varying vec3 vViewDir;
  varying vec2 vUv;
  varying float vWave;
  varying float vRipple;

  void main() {
    vUv = uv;
    float wave = sin(position.x * 2.2 + uTime * 1.1) * cos(position.y * 2.0 - uTime * 0.85);
    float touchDist = distance(position.xy * 0.25, uTouchPos);
    float ripple = sin(touchDist * 10.0 - uTime * 7.5) * exp(-touchDist * 1.4) * uTouchPulse;
    float disp = wave * (0.065 + uImpulse * 0.18) + ripple * 0.24;
    vWave = wave;
    vRipple = abs(ripple);
    vec3 displaced = position + normal * disp;
    vec4 worldPos = modelMatrix * vec4(displaced, 1.0);
    vNormalWorld = normalize(mat3(modelMatrix) * normal);
    vViewDir = normalize(cameraPosition - worldPos.xyz);
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const RIBBON_FRAGMENT_SHADER = /* glsl */ `
  uniform float uTime;
  uniform float uImpulse;
  uniform float uTouchPulse;
  uniform vec3 uTintColor;
  varying vec3 vNormalWorld;
  varying vec3 vViewDir;
  varying vec2 vUv;
  varying float vWave;
  varying float vRipple;

  void main() {
    float fresnel = pow(1.0 - max(0.0, dot(normalize(vNormalWorld), normalize(vViewDir))), 2.2);
    vec3 lavender = vec3(0.84, 0.78, 0.99);
    vec3 mint = vec3(0.67, 0.95, 0.86);
    vec3 blush = vec3(0.99, 0.80, 0.86);
    vec3 sky = vec3(0.75, 0.86, 0.99);

    float phase = vUv.x * 6.2831 + uTime * 0.35 + vWave * 0.8;
    vec3 irid = mix(lavender, mint, 0.5 + 0.5 * sin(phase));
    irid = mix(irid, blush, 0.35 + 0.35 * cos(phase * 1.3 + 1.2));
    irid = mix(irid, sky, fresnel * 0.45);
    irid = mix(irid, uTintColor, 0.22 + uImpulse * 0.26 + vRipple * 0.4);

    vec3 finalCol = mix(irid, vec3(1.0), fresnel * 0.48 + uTouchPulse * 0.12);
    float alpha = 0.22 + fresnel * 0.36 + uImpulse * 0.15 + vRipple * 0.2;
    gl_FragColor = vec4(finalCol, clamp(alpha, 0.14, 0.68));
  }
`;

const _targetColor = new THREE.Color(0xa78bfa);
const _dummy = new THREE.Object3D();

export const AmbientNeuroBackdrop: React.FC<AmbientNeuroBackdropProps> = ({
  triageLevel = 'PRIORITY_REVIEW',
  isAnalyzing = false,
  activeTab = 'workstation',
  activeCaseId = '',
}) => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const stateRef = useRef<{
    triageLevel: TriageLevel;
    isAnalyzing: boolean;
    pointerX: number;
    pointerY: number;
    pageImpulse: number;
    touchPulse: number;
    touchX: number;
    touchY: number;
  }>({
    triageLevel,
    isAnalyzing,
    pointerX: 0,
    pointerY: 0,
    pageImpulse: 0,
    touchPulse: 0,
    touchX: 0,
    touchY: 0,
  });

  const firstTabRef = useRef(true);
  const firstCaseRef = useRef(true);

  useEffect(() => {
    stateRef.current.triageLevel = triageLevel;
    stateRef.current.isAnalyzing = isAnalyzing;
  }, [triageLevel, isAnalyzing]);

  useEffect(() => {
    if (firstTabRef.current) {
      firstTabRef.current = false;
      return;
    }
    stateRef.current.pageImpulse = 1.0;
  }, [activeTab]);

  useEffect(() => {
    if (firstCaseRef.current) {
      firstCaseRef.current = false;
      return;
    }
    stateRef.current.pageImpulse = Math.max(stateRef.current.pageImpulse, 0.55);
  }, [activeCaseId]);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const reduced = prefersReducedMotion();
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
    scene.fog = new THREE.FogExp2(0xf6f4fb, 0.042);

    const camera = new THREE.PerspectiveCamera(
      46,
      window.innerWidth / Math.max(1, window.innerHeight),
      0.1,
      60
    );
    camera.position.set(0, 0.25, 9.8);

    const neuroGroup = new THREE.Group();
    scene.add(neuroGroup);

    // 1. Lusion-style Sculptural Iridescent Pastel Cortical Knot with Touch Ripple
    const knotGeo = new THREE.TorusKnotGeometry(
      2.15,
      0.46,
      isSoftwareGl ? 96 : 160,
      isSoftwareGl ? 18 : 28,
      2,
      3
    );
    const knotMat = new THREE.ShaderMaterial({
      vertexShader: RIBBON_VERTEX_SHADER,
      fragmentShader: RIBBON_FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      uniforms: {
        uTime: { value: 0 },
        uImpulse: { value: 0 },
        uTouchPulse: { value: 0 },
        uTouchPos: { value: new THREE.Vector2(0, 0) },
        uTintColor: { value: new THREE.Color(0xa78bfa) },
      },
    });
    const knotMesh = new THREE.Mesh(knotGeo, knotMat);
    knotMesh.scale.set(1.05, 0.94, 0.92);
    neuroGroup.add(knotMesh);

    // 2. Delicate Pearlescent Geodesic Lattice Halo
    const shellGeo = new THREE.IcosahedronGeometry(3.45, 2);
    shellGeo.scale(0.92, 1.0, 1.05);
    const shellWire = new THREE.WireframeGeometry(shellGeo);
    const shellMat = new THREE.LineBasicMaterial({
      color: 0xa78bfa,
      transparent: true,
      opacity: 0.16,
    });
    const shellMesh = new THREE.LineSegments(shellWire, shellMat);
    neuroGroup.add(shellMesh);

    // 3. Flowing Serene Neural Fiber Conduits
    const conduitColors = [0xc4b5fd, 0x6ee7b7, 0xfecdd3, 0x93c5fd];
    const conduits: Array<{ mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial }> = [];
    for (let c = 0; c < 4; c++) {
      const offsetAngle = (c / 4) * Math.PI * 2;
      const curvePts: THREE.Vector3[] = [];
      for (let i = 0; i <= 10; i++) {
        const t = i / 10;
        const theta = offsetAngle + t * Math.PI * 1.8;
        const r = 2.8 + Math.sin(t * Math.PI * 2) * 0.7;
        curvePts.push(
          new THREE.Vector3(
            Math.cos(theta) * r,
            (t - 0.5) * 4.4,
            Math.sin(theta) * r
          )
        );
      }
      const curve = new THREE.CatmullRomCurve3(curvePts);
      const cGeo = new THREE.TubeGeometry(curve, 36, 0.018, 6, false);
      const cMat = new THREE.MeshBasicMaterial({
        color: conduitColors[c % conduitColors.length],
        transparent: true,
        opacity: 0.25,
      });
      const cMesh = new THREE.Mesh(cGeo, cMat);
      neuroGroup.add(cMesh);
      conduits.push({ mesh: cMesh, mat: cMat });
    }

    // 4. Instanced Pastel Pearl Orbitals + Touch-Responsive Scatter
    const nodeCount = 68;
    const nodeGeo = new THREE.SphereGeometry(0.068, 10, 10);
    const nodeMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.68,
    });
    const nodeInstanced = new THREE.InstancedMesh(nodeGeo, nodeMat, nodeCount);
    const pearlPalette = [
      new THREE.Color(0xc4b5fd),
      new THREE.Color(0x6ee7b7),
      new THREE.Color(0xfda4af),
      new THREE.Color(0x93c5fd),
      new THREE.Color(0xfde68a),
    ];
    const baseNodePositions: Array<{ x: number; y: number; z: number; s: number; phase: number }> = [];
    const posAttr = shellGeo.getAttribute('position');
    const stride = Math.max(1, Math.floor(posAttr.count / nodeCount));
    for (let i = 0; i < nodeCount; i++) {
      const vi = (i * stride) % posAttr.count;
      const radialBoost = i > 48 ? 1.32 : 1.0;
      const x = posAttr.getX(vi) * radialBoost;
      const y = posAttr.getY(vi) * radialBoost;
      const z = posAttr.getZ(vi) * radialBoost;
      const s = 0.65 + ((i * 29) % 10) * 0.065;
      baseNodePositions.push({ x, y, z, s, phase: i * 0.42 });
      _dummy.position.set(x, y, z);
      _dummy.scale.setScalar(s);
      _dummy.updateMatrix();
      nodeInstanced.setMatrixAt(i, _dummy.matrix);
      nodeInstanced.setColorAt(i, pearlPalette[i % pearlPalette.length]);
    }
    nodeInstanced.instanceMatrix.needsUpdate = true;
    if (nodeInstanced.instanceColor) nodeInstanced.instanceColor.needsUpdate = true;
    nodeInstanced.computeBoundingSphere();
    neuroGroup.add(nodeInstanced);

    // 5. Sweeping Axial Pastel Scan Torus
    const ringGeo = new THREE.TorusGeometry(3.8, 0.022, 10, 96);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x818cf8,
      transparent: true,
      opacity: 0.24,
    });
    const scanRing = new THREE.Mesh(ringGeo, ringMat);
    scanRing.rotation.x = Math.PI / 2;
    neuroGroup.add(scanRing);

    const handlePointerMove = (e: PointerEvent) => {
      stateRef.current.pointerX = (e.clientX / Math.max(1, window.innerWidth) - 0.5) * 2;
      stateRef.current.pointerY = (e.clientY / Math.max(1, window.innerHeight) - 0.5) * 2;
    };

    const handlePointerDown = (e: PointerEvent) => {
      stateRef.current.touchX = (e.clientX / Math.max(1, window.innerWidth) - 0.5) * 2;
      stateRef.current.touchY = -(e.clientY / Math.max(1, window.innerHeight) - 0.5) * 2;
      stateRef.current.touchPulse = 1.0;
    };

    window.addEventListener('pointermove', handlePointerMove, { passive: true });
    window.addEventListener('pointerdown', handlePointerDown, { passive: true });

    const handleResize = () => {
      const w = window.innerWidth;
      const h = Math.max(1, window.innerHeight);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);

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
      const dt = Math.min(0.05, clock.getDelta());
      const elapsed = clock.getElapsedTime();
      const st = stateRef.current;

      st.pageImpulse = THREE.MathUtils.damp(st.pageImpulse, 0, 3.6, dt);
      st.touchPulse = THREE.MathUtils.damp(st.touchPulse, 0, 4.2, dt);

      _targetColor.setHex(TRIAGE_ACCENTS[st.triageLevel] ?? 0xa78bfa);
      knotMat.uniforms.uTintColor.value.lerp(_targetColor, Math.min(1, dt * 3.5));
      knotMat.uniforms.uTime.value = elapsed;
      knotMat.uniforms.uImpulse.value = st.pageImpulse;
      knotMat.uniforms.uTouchPulse.value = st.touchPulse;
      knotMat.uniforms.uTouchPos.value.set(st.touchX, st.touchY);
      shellMat.color.lerp(_targetColor, Math.min(1, dt * 3));
      ringMat.color.lerp(_targetColor, Math.min(1, dt * 3));

      if (!reduced) {
        const speedMult = (st.isAnalyzing ? 2.6 : 1) + st.pageImpulse * 4.0 + st.touchPulse * 1.4;
        neuroGroup.rotation.y += dt * 0.11 * speedMult;
        knotMesh.rotation.z += dt * 0.06 * speedMult;
        neuroGroup.rotation.x = THREE.MathUtils.damp(
          neuroGroup.rotation.x,
          st.pointerY * 0.24,
          4.5,
          dt
        );
        neuroGroup.rotation.z = THREE.MathUtils.damp(
          neuroGroup.rotation.z,
          -st.pointerX * 0.16,
          4.5,
          dt
        );
        camera.position.x = THREE.MathUtils.damp(camera.position.x, st.pointerX * 0.55, 3.5, dt);
        camera.position.y = THREE.MathUtils.damp(camera.position.y, 0.25 - st.pointerY * 0.35, 3.5, dt);
        camera.position.z = THREE.MathUtils.damp(
          camera.position.z,
          9.8 - st.pageImpulse * 1.65 - st.touchPulse * 0.45,
          4.5,
          dt
        );
        scanRing.position.y = Math.sin(elapsed * (st.isAnalyzing ? 2.4 : 0.7)) * 2.1;
        ringMat.opacity = st.isAnalyzing ? 0.44 : 0.22 + st.pageImpulse * 0.26 + st.touchPulse * 0.18;

        for (let i = 0; i < nodeCount; i++) {
          const b = baseNodePositions[i];
          const breath =
            1 +
            Math.sin(elapsed * 1.4 + b.phase) * 0.045 +
            st.pageImpulse * 0.14 +
            st.touchPulse * 0.12;
          _dummy.position.set(b.x * breath, b.y * breath, b.z * breath);
          _dummy.scale.setScalar(b.s * (1 + st.pageImpulse * 0.35 + st.touchPulse * 0.45));
          _dummy.updateMatrix();
          nodeInstanced.setMatrixAt(i, _dummy.matrix);
        }
        nodeInstanced.instanceMatrix.needsUpdate = true;
      }

      renderer.render(scene, camera);

      if (reduced) return;
      if (isSoftwareGl) {
        scheduleAfterDraw(renderer, tick, registerTimer);
      } else {
        frameId = requestAnimationFrame(tick);
      }
    };

    tick();

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      timers.forEach((t) => window.clearTimeout(t));
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('resize', handleResize);
      renderer.domElement.removeEventListener('webglcontextlost', onContextLost);

      knotGeo.dispose();
      knotMat.dispose();
      shellGeo.dispose();
      shellWire.dispose();
      shellMat.dispose();
      conduits.forEach((c) => {
        c.mesh.geometry.dispose();
        c.mat.dispose();
      });
      nodeGeo.dispose();
      nodeMat.dispose();
      ringGeo.dispose();
      ringMat.dispose();
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
      className="fixed inset-0 pointer-events-none z-0 opacity-85 no-print"
    />
  );
};
