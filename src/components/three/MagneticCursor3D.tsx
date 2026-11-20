import React, { useEffect, useRef } from 'react';
import type { TriageLevel } from '../../types/ct';
import { prefersReducedMotion } from '../../utils/webglDetect';

interface MagneticCursor3DProps {
  triageLevel?: TriageLevel;
}

const TRIAGE_RGB: Record<TriageLevel, { border: string; core: string; trail: string }> = {
  STAT_SURGICAL: {
    border: 'rgba(244, 63, 94, 0.75)',
    core: 'rgba(225, 29, 72, 0.85)',
    trail: 'rgba(251, 113, 133, 0.45)',
  },
  URGENT_NEURO: {
    border: 'rgba(245, 158, 11, 0.75)',
    core: 'rgba(217, 119, 6, 0.85)',
    trail: 'rgba(251, 191, 36, 0.42)',
  },
  PRIORITY_REVIEW: {
    border: 'rgba(124, 111, 246, 0.72)',
    core: 'rgba(109, 92, 231, 0.85)',
    trail: 'rgba(167, 139, 250, 0.44)',
  },
  ROUTINE_NEGATIVE: {
    border: 'rgba(16, 185, 129, 0.72)',
    core: 'rgba(5, 150, 105, 0.82)',
    trail: 'rgba(52, 211, 153, 0.42)',
  },
};

/**
 * Lusion-inspired multi-ring bioluminescent gravity cursor + trailing pastel orbs
 * synced to active diagnostic urgency without interfering with PACS crosshairs.
 */
export const MagneticCursor3D: React.FC<MagneticCursor3DProps> = ({
  triageLevel = 'PRIORITY_REVIEW',
}) => {
  const ringRef = useRef<HTMLDivElement | null>(null);
  const dotRef = useRef<HTMLDivElement | null>(null);
  const trail1Ref = useRef<HTMLDivElement | null>(null);
  const trail2Ref = useRef<HTMLDivElement | null>(null);
  const trail3Ref = useRef<HTMLDivElement | null>(null);
  const paletteRef = useRef(TRIAGE_RGB[triageLevel]);

  useEffect(() => {
    paletteRef.current = TRIAGE_RGB[triageLevel] ?? TRIAGE_RGB.PRIORITY_REVIEW;
  }, [triageLevel]);

  useEffect(() => {
    if (prefersReducedMotion()) return;
    if (typeof window === 'undefined' || !window.matchMedia('(pointer: fine)').matches) return;

    let mouseX = -100;
    let mouseY = -100;
    let curX = -100;
    let curY = -100;
    let t1X = -100;
    let t1Y = -100;
    let t2X = -100;
    let t2Y = -100;
    let t3X = -100;
    let t3Y = -100;
    let hoveringInteractive = false;
    let pressing = false;
    let rafId = 0;

    const onMove = (e: PointerEvent) => {
      mouseX = e.clientX;
      mouseY = e.clientY;
      const target = e.target as HTMLElement | null;
      hoveringInteractive = Boolean(
        target?.closest('button, a, select, input[type="range"], [role="button"]')
      );
    };

    const onDown = () => {
      pressing = true;
    };

    const onUp = () => {
      pressing = false;
    };

    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerdown', onDown, { passive: true });
    window.addEventListener('pointerup', onUp, { passive: true });

    const loop = () => {
      curX += (mouseX - curX) * 0.24;
      curY += (mouseY - curY) * 0.24;
      t1X += (curX - t1X) * 0.22;
      t1Y += (curY - t1Y) * 0.22;
      t2X += (t1X - t2X) * 0.2;
      t2Y += (t1Y - t2Y) * 0.2;
      t3X += (t2X - t3X) * 0.18;
      t3Y += (t2Y - t3Y) * 0.18;

      const palette = paletteRef.current;

      if (ringRef.current) {
        const scale = pressing ? 0.78 : hoveringInteractive ? 1.5 : 1;
        ringRef.current.style.transform = `translate3d(${curX}px, ${curY}px, 0) translate(-50%, -50%) scale(${scale})`;
        ringRef.current.style.borderColor = hoveringInteractive ? palette.border : palette.trail;
      }

      if (dotRef.current) {
        dotRef.current.style.transform = `translate3d(${mouseX}px, ${mouseY}px, 0) translate(-50%, -50%) scale(${
          pressing ? 1.55 : 1
        })`;
        dotRef.current.style.backgroundColor = palette.core;
      }

      if (trail1Ref.current) {
        trail1Ref.current.style.transform = `translate3d(${t1X}px, ${t1Y}px, 0) translate(-50%, -50%)`;
        trail1Ref.current.style.backgroundColor = palette.trail;
      }
      if (trail2Ref.current) {
        trail2Ref.current.style.transform = `translate3d(${t2X}px, ${t2Y}px, 0) translate(-50%, -50%)`;
        trail2Ref.current.style.backgroundColor = palette.trail;
      }
      if (trail3Ref.current) {
        trail3Ref.current.style.transform = `translate3d(${t3X}px, ${t3Y}px, 0) translate(-50%, -50%)`;
        trail3Ref.current.style.backgroundColor = palette.trail;
      }

      rafId = requestAnimationFrame(loop);
    };

    rafId = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerup', onUp);
    };
  }, []);

  return (
    <>
      <div
        ref={trail3Ref}
        aria-hidden="true"
        className="hidden md:block fixed top-0 left-0 w-2 h-2 rounded-full pointer-events-none z-[59] opacity-40 no-print"
        style={{ transform: 'translate3d(-100px, -100px, 0)' }}
      />
      <div
        ref={trail2Ref}
        aria-hidden="true"
        className="hidden md:block fixed top-0 left-0 w-2.5 h-2.5 rounded-full pointer-events-none z-[59] opacity-55 no-print"
        style={{ transform: 'translate3d(-100px, -100px, 0)' }}
      />
      <div
        ref={trail1Ref}
        aria-hidden="true"
        className="hidden md:block fixed top-0 left-0 w-3 h-3 rounded-full pointer-events-none z-[59] opacity-65 no-print"
        style={{ transform: 'translate3d(-100px, -100px, 0)' }}
      />
      <div
        ref={ringRef}
        aria-hidden="true"
        className="hidden md:block fixed top-0 left-0 w-7 h-7 rounded-full border pointer-events-none z-[60] transition-[border-color] duration-150 no-print"
        style={{ transform: 'translate3d(-100px, -100px, 0)' }}
      />
      <div
        ref={dotRef}
        aria-hidden="true"
        className="hidden md:block fixed top-0 left-0 w-1.5 h-1.5 rounded-full pointer-events-none z-[60] no-print"
        style={{ transform: 'translate3d(-100px, -100px, 0)' }}
      />
    </>
  );
};
