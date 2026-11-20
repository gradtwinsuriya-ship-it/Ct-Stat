import React from 'react';
import type { HemorrhageSubtypeId, TriageLevel } from '../../types/ct';

interface HolographicMiniBrainProps {
  triageLevel?: TriageLevel;
  dominantSubtype?: HemorrhageSubtypeId | 'none';
  xPercent?: number;
  yPercent?: number;
  selected?: boolean;
}

const TRIAGE_COLORS: Record<TriageLevel, { stroke: string; fill: string; bleed: string }> = {
  STAT_SURGICAL: {
    stroke: '#FB7185',
    fill: 'rgba(251, 113, 133, 0.22)',
    bleed: '#F43F5E',
  },
  URGENT_NEURO: {
    stroke: '#FBBF24',
    fill: 'rgba(251, 191, 36, 0.22)',
    bleed: '#F59E0B',
  },
  PRIORITY_REVIEW: {
    stroke: '#A78BFA',
    fill: 'rgba(167, 139, 250, 0.22)',
    bleed: '#8B5CF6',
  },
  ROUTINE_NEGATIVE: {
    stroke: '#34D399',
    fill: 'rgba(52, 211, 153, 0.2)',
    bleed: '#10B981',
  },
};

/**
 * Lightweight CSS-3D + SVG holographic mini-brain badge for worklist rows.
 * Uses zero WebGL contexts so lists scale cleanly without exceeding browser limits.
 */
export const HolographicMiniBrain: React.FC<HolographicMiniBrainProps> = ({
  triageLevel = 'PRIORITY_REVIEW',
  dominantSubtype = 'none',
  xPercent = 50,
  yPercent = 50,
  selected = false,
}) => {
  const palette = TRIAGE_COLORS[triageLevel] ?? TRIAGE_COLORS.PRIORITY_REVIEW;
  const cx = Math.max(12, Math.min(36, (xPercent / 100) * 48));
  const cy = Math.max(12, Math.min(36, (yPercent / 100) * 48));

  return (
    <div
      className={`relative w-11 h-11 rounded-lg bg-[#0B0D18] border flex items-center justify-center shrink-0 overflow-hidden preserve-3d transition-transform duration-300 ${
        selected
          ? 'border-indigo-500 shadow-[0_6px_16px_-4px_rgba(124,111,246,0.5)] scale-105'
          : 'border-[#DCD5F4] group-hover:scale-105'
      }`}
    >
      <div
        className={`w-9 h-9 transition-transform duration-500 ${
          selected ? 'animate-[spin_9s_linear_infinite]' : 'group-hover:rotate-12'
        }`}
        style={{ transformStyle: 'preserve-3d' }}
      >
        <svg viewBox="0 0 48 48" className="w-full h-full">
          {/* Outer Cranial Vault Ring */}
          <ellipse
            cx="24"
            cy="24"
            rx="16"
            ry="19"
            fill={palette.fill}
            stroke={palette.stroke}
            strokeWidth="1.4"
          />
          {/* Falx Midline */}
          <line
            x1="24"
            y1="6"
            x2="24"
            y2="42"
            stroke="rgba(196, 181, 253, 0.55)"
            strokeWidth="0.9"
            strokeDasharray="2 1.5"
          />
          {/* Left & Right Ventricular Horns */}
          <path
            d="M21 17 C18 20, 18 28, 21 31"
            fill="none"
            stroke="rgba(45, 212, 191, 0.72)"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
          <path
            d="M27 17 C30 20, 30 28, 27 31"
            fill="none"
            stroke="rgba(45, 212, 191, 0.72)"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
          {/* Localized Hemorrhage Focus Glow */}
          {dominantSubtype !== 'none' && (
            <>
              <circle cx={cx} cy={cy} r="5.5" fill={palette.bleed} fillOpacity="0.32" />
              <circle cx={cx} cy={cy} r="2.5" fill={palette.bleed} />
            </>
          )}
        </svg>
      </div>
    </div>
  );
};
