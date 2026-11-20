import React, { useState } from 'react';
import { motion } from 'motion/react';
import { ArrowRight, RotateCw, SlidersHorizontal } from 'lucide-react';
import { SUBTYPE_PROFILES } from '../data/rsnaCohort';
import type { HemorrhageSubtypeId } from '../types/ct';
import { TactileButton, TiltCard3D } from './ui/Tactile3D';

interface SubtypeAtlasViewProps {
  onInspectSubtypeCase: (subtype: HemorrhageSubtypeId) => void;
}

/**
 * Interactive SVG + CSS-3D Cranial Suture & Compartment Morph diagram:
 * Users scrub "morphPct" (0-100) to watch how each subtype's morphology obeys or crosses cranial sutures.
 */
const SubtypeAnatomyMorphLab: React.FC<{
  subtypeId: HemorrhageSubtypeId;
  morphPct: number;
  onChangeMorph: (val: number) => void;
}> = ({ subtypeId, morphPct, onChangeMorph }) => {
  const t = Math.max(0.1, Math.min(1, morphPct / 100));

  return (
    <div className="bg-[#0E1120] border border-[#312B5B] rounded-lg p-2.5 space-y-2">
      <div className="flex items-center justify-between text-[10px] font-mono text-violet-300">
        <span className="inline-flex items-center gap-1">
          <SlidersHorizontal className="w-3 h-3 text-cyan-300" />
          3D Suture &amp; Clot Morph
        </span>
        <span className="tabular-nums text-cyan-300">{morphPct}%</span>
      </div>

      <svg viewBox="0 0 140 86" className="w-full h-[76px] block">
        {/* Cranial Vault Arc */}
        <path
          d="M 16 74 C 14 28, 36 10, 70 10 C 104 10, 126 28, 124 74"
          fill="rgba(139, 92, 246, 0.1)"
          stroke="#A78BFA"
          strokeWidth="2.5"
        />
        {/* Inner Cortical Brain Surface */}
        <path
          d="M 24 74 C 22 34, 42 18, 70 18 C 98 18, 118 34, 116 74"
          fill="rgba(167, 139, 250, 0.16)"
          stroke="rgba(196, 181, 253, 0.45)"
          strokeWidth="1"
        />
        {/* Anterior & Posterior Cranial Suture Markers (Pinned Barriers) */}
        <line x1="34" y1="16" x2="39" y2="23" stroke="#34D399" strokeWidth="2.2" strokeLinecap="round" />
        <line x1="106" y1="16" x2="101" y2="23" stroke="#34D399" strokeWidth="2.2" strokeLinecap="round" />
        {/* Ventricular System */}
        <path
          d="M 63 40 C 57 45, 57 58, 63 63 M 77 40 C 83 45, 83 58, 77 63"
          fill="none"
          stroke="#2DD4BF"
          strokeWidth="2"
          strokeLinecap="round"
        />

        {/* Subtype-specific Dynamic Morph Geometry */}
        {subtypeId === 'epidural' && (
          <path
            d={`M 38 22 Q ${58 + t * 18} ${32 + t * 24}, 98 22 Q ${68} ${12}, 38 22 Z`}
            fill="#F43F5E"
            fillOpacity="0.82"
            stroke="#FDA4AF"
            strokeWidth="1.2"
          />
        )}

        {subtypeId === 'subdural' && (
          <path
            d={`M ${28 - t * 6} ${60 - t * 8} C ${20} ${24}, ${68 + t * 38} ${8}, ${108 + t * 10} ${
              26 + t * 20
            } C ${86 + t * 10} ${18 + t * 14}, ${38} ${24}, ${28 - t * 6} ${60 - t * 8} Z`}
            fill="#FB923C"
            fillOpacity="0.82"
            stroke="#FDBA74"
            strokeWidth="1.2"
          />
        )}

        {subtypeId === 'subarachnoid' && (
          <g stroke="#FBBF24" strokeWidth={1.6 + t * 1.4} strokeLinecap="round" fill="none" opacity="0.9">
            <path d={`M 70 52 L ${70 - t * 22} ${38 - t * 10}`} />
            <path d={`M 70 52 L ${70 + t * 24} ${38 - t * 10}`} />
            <path d={`M 70 52 L ${70 - t * 16} ${68}`} />
            <path d={`M 70 52 L ${70 + t * 16} ${68}`} />
            <circle cx="70" cy="52" r={4 + t * 5} fill="#F59E0B" fillOpacity="0.72" />
          </g>
        )}

        {subtypeId === 'intraventricular' && (
          <g>
            <path
              d="M 63 40 C 57 45, 57 58, 63 63"
              fill="none"
              stroke="#EC4899"
              strokeWidth={2.5 + t * 4}
              strokeLinecap="round"
            />
            {t > 0.45 && (
              <path
                d="M 77 40 C 83 45, 83 58, 77 63"
                fill="none"
                stroke="#F43F5E"
                strokeWidth={(t - 0.35) * 6}
                strokeLinecap="round"
              />
            )}
          </g>
        )}

        {subtypeId === 'intraparenchymal' && (
          <g>
            <circle
              cx="48"
              cy="48"
              r={7 + t * 11}
              fill="#F59E0B"
              fillOpacity="0.22"
              stroke="#FBBF24"
              strokeWidth="0.9"
              strokeDasharray="2 1.5"
            />
            <circle cx="48" cy="48" r={4 + t * 7.5} fill="#E11D48" fillOpacity="0.88" />
          </g>
        )}
      </svg>

      <input
        type="range"
        min={10}
        max={100}
        step={5}
        value={morphPct}
        onChange={(e) => onChangeMorph(Number(e.target.value))}
        className="w-full accent-cyan-400 h-1 bg-slate-800 rounded cursor-pointer"
        aria-label={`Morph ${subtypeId} clot expansion`}
      />
    </div>
  );
};

export const SubtypeAtlasView: React.FC<SubtypeAtlasViewProps> = ({ onInspectSubtypeCase }) => {
  const [flippedCards, setFlippedCards] = useState<Record<string, boolean>>({});
  const [morphValues, setMorphValues] = useState<Record<string, number>>({
    epidural: 60,
    subdural: 65,
    subarachnoid: 55,
    intraventricular: 70,
    intraparenchymal: 60,
  });

  const toggleFlip = (id: string) => {
    setFlippedCards((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <div className="relative z-10 max-w-[1360px] mx-auto px-6 py-6 space-y-6">
      <div className="max-w-3xl">
        <h1 className="text-xl font-semibold text-[#1E1B3A]">
          Five Intracranial Hemorrhage Subtypes
        </h1>
        <p className="text-xs text-[#565278] mt-1.5 leading-relaxed">
          Distinguishing bleed compartment on non-contrast head CT determines emergency surgical
          triage—from immediate arterial craniotomy in Epidural Hematoma to STAT CT angiography in
          Subarachnoid Hemorrhage or External Ventricular Drain placement in Intraventricular
          Hemorrhage. Scrub the live morph slider or flip any 3D card for surgical benchmarks.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 auto-rows-fr">
        {SUBTYPE_PROFILES.map((profile, idx) => {
          const isFlipped = Boolean(flippedCards[profile.id]);
          const morphPct = morphValues[profile.id] ?? 60;

          return (
            <motion.div
              key={profile.id}
              initial={{ opacity: 0, y: 22, rotateX: 6, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, rotateX: 0, scale: 1 }}
              transition={{ duration: 0.42, delay: idx * 0.055, ease: [0.16, 1, 0.3, 1] }}
              className="perspective-stage min-h-[388px] h-full"
            >
              <div
                style={{
                  transform: isFlipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
                  transition: 'transform 560ms cubic-bezier(0.16, 1, 0.3, 1)',
                }}
                className="relative w-full h-full preserve-3d"
              >
                {/* FRONT FACE */}
                <div className="backface-hidden w-full h-full">
                  <TiltCard3D maxTiltDeg={4.5} className="h-full overflow-hidden">
                    <div className="grid grid-cols-1 sm:grid-cols-[204px_1fr] h-full">
                      {/* Reference CT Slice + Interactive Suture & Compartment Morph Lab */}
                      <div className="bg-[#07090F] flex flex-col justify-between p-3 border-b sm:border-b-0 sm:border-r border-[#E3DCF5] gap-2.5">
                        <div className="flex flex-col items-center gap-1.5">
                          <img
                            src={profile.referenceImageUrl}
                            alt={`${profile.name} axial head CT example`}
                            referrerPolicy="no-referrer"
                            className="w-full max-w-[144px] aspect-square object-contain rounded"
                          />
                          <span className="text-[11px] font-mono text-violet-300">
                            {profile.shortCode} · {profile.typicalHu}
                          </span>
                        </div>

                        <SubtypeAnatomyMorphLab
                          subtypeId={profile.id}
                          morphPct={morphPct}
                          onChangeMorph={(val) =>
                            setMorphValues((prev) => ({ ...prev, [profile.id]: val }))
                          }
                        />
                      </div>

                      {/* Clinical Breakdown */}
                      <div className="p-4 flex flex-col justify-between gap-4">
                        <div className="space-y-3">
                          <div className="flex items-baseline justify-between gap-2 pb-2 border-b border-[#EDE8F8]">
                            <h2 className="text-sm font-semibold text-[#1E1B3A]">{profile.name}</h2>
                            <span className="text-xs font-mono font-semibold text-indigo-700 shrink-0 tabular-nums">
                              AUROC {profile.validationAuroc.toFixed(3)}
                            </span>
                          </div>

                          <div className="grid grid-cols-[112px_1fr] gap-x-2 gap-y-1.5 text-xs items-baseline">
                            <span className="text-[#6B668E]">Compartment</span>
                            <span className="text-[#1E1B3A] font-medium">{profile.compartment}</span>

                            <span className="text-[#6B668E]">Morphology</span>
                            <span className="text-[#2D2952]">{profile.ctMorphology}</span>

                            <span className="text-[#6B668E]">Vascular Origin</span>
                            <span className="text-[#3E3A5E]">{profile.vascularSource}</span>

                            <span className="text-[#6B668E]">Suture Rule</span>
                            <span className="text-[#3E3A5E]">{profile.sutureRule}</span>
                          </div>
                        </div>

                        <div className="pt-3 border-t border-[#EDE8F8] flex flex-wrap items-center justify-between gap-2">
                          <TactileButton
                            variant="secondary"
                            onClick={() => toggleFlip(profile.id)}
                            className="px-2.5 py-1.5 text-xs font-medium text-[#2D2952] rounded whitespace-nowrap shrink-0 cursor-pointer"
                          >
                            <RotateCw className="w-3.5 h-3.5 text-indigo-600" />
                            Flip Surgical Matrix
                          </TactileButton>

                          <TactileButton
                            variant="primary"
                            magnetic
                            onClick={() => onInspectSubtypeCase(profile.id)}
                            className="px-3 py-1.5 text-xs font-semibold rounded whitespace-nowrap shrink-0 cursor-pointer"
                          >
                            Inspect 3D + PACS
                            <ArrowRight className="w-3.5 h-3.5" />
                          </TactileButton>
                        </div>
                      </div>
                    </div>
                  </TiltCard3D>
                </div>

                {/* BACK FACE (180deg 3D Flip) */}
                <div className="backface-hidden rotate-y-180 absolute inset-0 w-full h-full">
                  <TiltCard3D
                    maxTiltDeg={4}
                    glowColor="rgba(251, 113, 133, 0.24)"
                    className="h-full p-5 flex flex-col justify-between"
                  >
                    <div className="space-y-3">
                      <div className="flex items-center justify-between border-b border-[#EDE8F8] pb-2.5">
                        <div>
                          <div className="text-xs font-mono font-semibold text-rose-700">
                            {profile.shortCode} · Surgical &amp; Validation Protocol
                          </div>
                          <h3 className="text-base font-semibold text-[#1E1B3A] mt-0.5">
                            {profile.name}
                          </h3>
                        </div>
                        <TactileButton
                          variant="secondary"
                          onClick={() => toggleFlip(profile.id)}
                          className="px-2.5 py-1 text-xs font-medium text-[#2D2952] rounded cursor-pointer"
                        >
                          <RotateCw className="w-3.5 h-3.5 text-indigo-600" />
                          Front
                        </TactileButton>
                      </div>

                      <div className="grid grid-cols-3 gap-3 bg-[#F6F4FB] border border-[#E3DCF5] rounded-lg p-3 text-center">
                        <div>
                          <div className="text-[11px] text-[#565278]">AUROC</div>
                          <div className="text-base font-mono font-semibold tabular-nums text-indigo-700">
                            {profile.validationAuroc.toFixed(3)}
                          </div>
                        </div>
                        <div>
                          <div className="text-[11px] text-[#565278]">Sensitivity</div>
                          <div className="text-base font-mono font-semibold tabular-nums text-emerald-700">
                            {profile.validationSensitivityPct.toFixed(1)}%
                          </div>
                        </div>
                        <div>
                          <div className="text-[11px] text-[#565278]">Specificity</div>
                          <div className="text-base font-mono font-semibold tabular-nums text-[#1E1B3A]">
                            {profile.validationSpecificityPct.toFixed(1)}%
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-[120px_1fr] gap-x-2 gap-y-1.5 text-xs items-baseline">
                        <span className="text-[#565278]">Triage Window</span>
                        <span className="text-rose-700 font-semibold">{profile.surgicalUrgency}</span>

                        <span className="text-[#565278]">Intervention</span>
                        <span className="text-[#1E1B3A]">{profile.surgicalProcedure}</span>

                        <span className="text-[#565278]">Cohort Share</span>
                        <span className="font-mono tabular-nums text-indigo-700 font-medium">
                          {profile.rsnaPrevalencePct.toFixed(1)}% of positive exams
                        </span>
                      </div>
                    </div>

                    <div className="pt-3 border-t border-[#EDE8F8] flex items-center justify-end">
                      <TactileButton
                        variant="primary"
                        magnetic
                        onClick={() => onInspectSubtypeCase(profile.id)}
                        className="px-3.5 py-1.5 text-xs font-semibold rounded whitespace-nowrap cursor-pointer"
                      >
                        Open {profile.shortCode} in 3D Workstation
                        <ArrowRight className="w-3.5 h-3.5" />
                      </TactileButton>
                    </div>
                  </TiltCard3D>
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
};
