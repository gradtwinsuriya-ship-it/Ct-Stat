import React, { useState } from 'react';
import { motion } from 'motion/react';
import { CheckCircle2, Loader2, Play, XCircle } from 'lucide-react';
import {
  MULTI_DATASET_COHORT,
  RSNA_DATASET_METRICS,
  SUBTYPE_PROFILES,
} from '../data/rsnaCohort';
import type { AnalysisResult, CTCase, HemorrhageSubtypeId } from '../types/ct';
import { TactileButton, TiltCard3D } from './ui/Tactile3D';
import { ValidationTerrain3D } from './three/ValidationTerrain3D';
import { playTactileSound } from '../utils/hapticSound';

interface ValidationViewProps {
  cases: CTCase[];
  onRunSingleAudit: (ctCase: CTCase) => Promise<{
    analysis: AnalysisResult;
    inferenceMs: number;
  }>;
  onSelectCase: (caseId: string) => void;
}

interface BenchmarkRow {
  caseId: string;
  accessionNumber: string;
  expectedLabel: string;
  predictedLabel: string;
  overallProb: number;
  windowAgreement?: number;
  inferenceMs: number;
  matched: boolean;
}

export const ValidationView: React.FC<ValidationViewProps> = ({
  cases,
  onRunSingleAudit,
  onSelectCase,
}) => {
  const maxPrevalence = Math.max(...SUBTYPE_PROFILES.map((s) => s.rsnaPrevalencePct));
  const cohortCases = cases.filter((c) => c.source === 'rsna_cohort' && c.groundTruth);

  const [isAuditing, setIsAuditing] = useState<boolean>(false);
  const [auditProgress, setAuditProgress] = useState<number>(0);
  const [auditResults, setAuditResults] = useState<BenchmarkRow[]>([]);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [selectedPrismId, setSelectedPrismId] = useState<HemorrhageSubtypeId>('epidural');

  const totalCombinedExams = MULTI_DATASET_COHORT.reduce((acc, d) => acc + d.exams, 0);

  const handleRunLiveAudit = async () => {
    setIsAuditing(true);
    setAuditError(null);
    setAuditResults([]);
    setAuditProgress(0);

    const rows: BenchmarkRow[] = [];
    for (let i = 0; i < cohortCases.length; i++) {
      const item = cohortCases[i];
      try {
        const res = await onRunSingleAudit(item);
        const expected = item.groundTruth?.label ?? 'none';
        const predicted = res.analysis.anyHemorrhage
          ? res.analysis.dominantSubtype
          : 'none';

        rows.push({
          caseId: item.id,
          accessionNumber: item.accessionNumber,
          expectedLabel: expected,
          predictedLabel: predicted,
          overallProb: res.analysis.overallProbability,
          windowAgreement: res.analysis.windowAgreementPct,
          inferenceMs: res.inferenceMs,
          matched: expected === predicted,
        });
        setAuditResults([...rows]);
        setAuditProgress(i + 1);
      } catch (err: unknown) {
        setAuditError(
          err instanceof Error
            ? err.message
            : `Audit interrupted on ${item.accessionNumber}`
        );
        break;
      }
    }
    setIsAuditing(false);
  };

  const matchedCount = auditResults.filter((r) => r.matched).length;
  const observedAccuracy =
    auditResults.length > 0 ? (matchedCount / auditResults.length) * 100 : null;
  const selectedProfile =
    SUBTYPE_PROFILES.find((p) => p.id === selectedPrismId) ?? SUBTYPE_PROFILES[0];

  return (
    <div className="relative z-10 max-w-[1360px] mx-auto px-6 py-6 space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-3xl">
          <h1 className="text-xl font-semibold text-[#1E1B3A]">
            Multi-Dataset Calibration &amp; Live 3-Window Benchmark
          </h1>
          <p className="text-xs text-[#565278] mt-1.5 leading-relaxed">
            Calibrated across {totalCombinedExams.toLocaleString()} radiologist-labeled non-contrast
            head CT exams (RSNA/ASNR, CQ500, and PhysioNet TBI) using synchronized 3-window
            stacking (Brain W80/L40 · Subdural W200/L75 · Bone W2500/L480) to eliminate false
            positives from physiologic calcifications and skull-interface artifacts.
          </p>
        </div>

        <TactileButton
          variant="primary"
          magnetic
          onClick={handleRunLiveAudit}
          disabled={isAuditing}
          className="px-4 py-2 text-xs font-semibold rounded whitespace-nowrap shrink-0 cursor-pointer"
        >
          {isAuditing ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Evaluating {auditProgress}/{cohortCases.length}...
            </>
          ) : (
            <>
              <Play className="w-3.5 h-3.5" />
              Run Live 3-Window Cohort Audit
            </>
          )}
        </TactileButton>
      </div>

      {/* 4-Column Interactive 3D KPI Monolith Strip */}
      <motion.div
        initial={{ opacity: 0, y: 16, rotateX: 5 }}
        animate={{ opacity: 1, y: 0, rotateX: 0 }}
        transition={{ duration: 0.42, ease: [0.16, 1, 0.3, 1] }}
        className="grid grid-cols-2 lg:grid-cols-4 gap-4"
      >
        <TiltCard3D className="p-4">
          <div className="text-xs text-[#565278]">Combined Training &amp; Cal. Cohort</div>
          <div className="text-2xl font-mono font-semibold tabular-nums text-[#1E1B3A] mt-1">
            {totalCombinedExams.toLocaleString()}
          </div>
          <div className="text-[11px] font-mono text-[#6B668E] mt-1">
            RSNA + CQ500 + PhysioNet TBI
          </div>
        </TiltCard3D>

        <TiltCard3D className="p-4">
          <div className="text-xs text-[#565278]">Any-Hemorrhage AUROC</div>
          <div className="text-2xl font-mono font-semibold tabular-nums text-indigo-700 mt-1">
            {RSNA_DATASET_METRICS.overallAnyBleedAuroc.toFixed(3)}
          </div>
          <div className="text-[11px] font-mono text-[#6B668E] mt-1">
            3-Window Brain/Subdural/Bone stack
          </div>
        </TiltCard3D>

        <TiltCard3D glowColor="rgba(52, 211, 153, 0.25)" className="p-4">
          <div className="text-xs text-[#565278]">Live Audit Accuracy</div>
          <div className="text-2xl font-mono font-semibold tabular-nums text-emerald-700 mt-1">
            {observedAccuracy !== null ? `${observedAccuracy.toFixed(1)}%` : 'Run Audit'}
          </div>
          <div className="text-[11px] font-mono text-[#6B668E] mt-1">
            {auditResults.length > 0
              ? `${matchedCount}/${auditResults.length} exact subtype matches`
              : `${cohortCases.length} labeled test exams ready`}
          </div>
        </TiltCard3D>

        <TiltCard3D className="p-4">
          <div className="text-xs text-[#565278]">Annotator Consensus</div>
          <div className="text-2xl font-mono font-semibold tabular-nums text-[#1E1B3A] mt-1">
            60+ ASNR
          </div>
          <div className="text-[11px] font-mono text-[#6B668E] mt-1">
            Multi-reader majority reference
          </div>
        </TiltCard3D>
      </motion.div>

      {/* Interactive 3D Topographic ROC & Cohort Landscape */}
      <ValidationTerrain3D
        selectedSubtypeId={selectedPrismId}
        onSelectSubtype={setSelectedPrismId}
      />

      {/* Live Cohort Audit Results Table */}
      {(auditResults.length > 0 || auditError) && (
        <div className="surface-3d border border-[#E3DCF5] rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-[#E3DCF5] flex items-center justify-between">
            <h2 className="text-sm font-semibold text-[#1E1B3A]">
              Live 3-Window Inference Audit vs. Radiologist Ground Truth
            </h2>
            <span className="text-xs font-mono text-[#565278] tabular-nums">
              {auditResults.length}/{cohortCases.length} completed
            </span>
          </div>

          {auditError && (
            <div className="px-4 py-3 bg-rose-50 border-b border-rose-200 text-xs text-rose-800">
              {auditError}
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-[#E3DCF5] bg-[#F4F0FC] font-mono text-[11px] text-[#565278]">
                  <th className="py-2.5 px-4 font-medium">Match</th>
                  <th className="py-2.5 px-4 font-medium">Accession</th>
                  <th className="py-2.5 px-4 font-medium">ASNR Ground Truth</th>
                  <th className="py-2.5 px-4 font-medium">3-Window Prediction</th>
                  <th className="py-2.5 px-4 font-medium text-right">Confidence</th>
                  <th className="py-2.5 px-4 font-medium text-right">Window Agree</th>
                  <th className="py-2.5 px-4 font-medium text-right">Latency</th>
                  <th className="py-2.5 px-4 font-medium text-right">Inspect</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#EDE8F8]">
                {auditResults.map((r) => (
                  <tr key={r.caseId} className="hover:bg-[#F7F4FD]">
                    <td className="py-2.5 px-4">
                      {r.matched ? (
                        <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Exact
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-rose-700 font-semibold">
                          <XCircle className="w-3.5 h-3.5" />
                          Mismatch
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-4 font-mono text-[#1E1B3A] font-medium">
                      {r.accessionNumber}
                    </td>
                    <td className="py-2.5 px-4 font-mono text-[#4A4766] uppercase">
                      {r.expectedLabel}
                    </td>
                    <td className="py-2.5 px-4 font-mono text-indigo-700 uppercase font-semibold">
                      {r.predictedLabel}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums text-[#1E1B3A]">
                      {r.overallProb.toFixed(1)}%
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums text-[#4A4766]">
                      {typeof r.windowAgreement === 'number'
                        ? `${r.windowAgreement.toFixed(0)}%`
                        : '—'}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums text-[#565278]">
                      {r.inferenceMs} ms
                    </td>
                    <td className="py-2.5 px-4 text-right">
                      <TactileButton
                        variant="active"
                        onClick={() => onSelectCase(r.caseId)}
                        className="px-2.5 py-1 text-xs rounded cursor-pointer"
                      >
                        Open
                      </TactileButton>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Multi-Dataset Sources Table */}
      <div className="surface-3d border border-[#E3DCF5] rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-[#E3DCF5] flex items-center justify-between">
          <h2 className="text-sm font-semibold text-[#1E1B3A]">
            Multi-Institutional Benchmark Datasets
          </h2>
          <span className="text-[11px] font-mono text-[#6B668E]">
            Cross-scanner &amp; multi-center calibration
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-[#E3DCF5] bg-[#F4F0FC] font-mono text-[11px] text-[#565278]">
                <th className="py-2.5 px-4 font-medium">Dataset Cohort</th>
                <th className="py-2.5 px-4 font-medium text-right">Exams</th>
                <th className="py-2.5 px-4 font-medium">Volume</th>
                <th className="py-2.5 px-4 font-medium">Labeling Standard</th>
                <th className="py-2.5 px-4 font-medium">Role in HemaSTAT</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#EDE8F8]">
              {MULTI_DATASET_COHORT.map((ds) => (
                <tr key={ds.id} className="hover:bg-[#F7F4FD]">
                  <td className="py-3 px-4 font-semibold text-[#1E1B3A]">{ds.name}</td>
                  <td className="py-3 px-4 text-right font-mono tabular-nums text-indigo-700 font-semibold">
                    {ds.exams.toLocaleString()}
                  </td>
                  <td className="py-3 px-4 font-mono text-[#3E3A5E] whitespace-nowrap">
                    {ds.slices}
                  </td>
                  <td className="py-3 px-4 text-[#3E3A5E]">{ds.annotationStandard}</td>
                  <td className="py-3 px-4 text-[#565278]">{ds.calibrationRole}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Per-Subtype Sensitivity / Specificity / AUROC Table + Interactive 3D Pastel Prism Chart */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
        <div className="lg:col-span-8 surface-3d border border-[#E3DCF5] rounded-xl overflow-hidden flex flex-col h-full">
          <div className="px-4 py-3 border-b border-[#E3DCF5] flex items-center justify-between shrink-0">
            <h2 className="text-sm font-semibold text-[#1E1B3A]">
              Per-Subtype Classification Benchmarks
            </h2>
            <span className="text-[11px] font-mono text-[#6B668E]">
              5-Class Multi-Label Evaluation
            </span>
          </div>
          <div className="overflow-x-auto flex-1">
            <table className="w-full h-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-[#E3DCF5] bg-[#F4F0FC] font-mono text-[11px] text-[#565278]">
                  <th className="py-3 px-4 font-medium">Subtype</th>
                  <th className="py-3 px-4 font-medium text-right">Dataset Share</th>
                  <th className="py-3 px-4 font-medium text-right">AUROC</th>
                  <th className="py-3 px-4 font-medium text-right">Sensitivity</th>
                  <th className="py-3 px-4 font-medium text-right">Specificity</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#EDE8F8]">
                {SUBTYPE_PROFILES.map((s) => (
                  <tr
                    key={s.id}
                    onClick={() => {
                      playTactileSound('click');
                      setSelectedPrismId(s.id);
                    }}
                    className={`cursor-pointer transition-colors ${
                      selectedPrismId === s.id ? 'bg-[#EDE9FE]/80' : 'hover:bg-[#F7F4FD]'
                    }`}
                  >
                    <td className="py-3.5 px-4">
                      <span className="font-semibold text-[#1E1B3A]">{s.name}</span>
                      <span className="ml-2 font-mono text-[11px] text-[#6B668E]">
                        {s.shortCode}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono tabular-nums text-[#3E3A5E]">
                      {s.rsnaPrevalencePct.toFixed(1)}%
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono tabular-nums text-indigo-700 font-semibold">
                      {s.validationAuroc.toFixed(3)}
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono tabular-nums text-[#1E1B3A]">
                      {s.validationSensitivityPct.toFixed(1)}%
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono tabular-nums text-[#1E1B3A]">
                      {s.validationSpecificityPct.toFixed(1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Interactive 3D Pastel Prism Prevalence Matrix */}
        <TiltCard3D maxTiltDeg={5} className="lg:col-span-4 p-4 flex flex-col justify-between h-full">
          <div>
            <h2 className="text-sm font-semibold text-[#1E1B3A]">
              3D Subtype Cohort Prism
            </h2>
            <p className="text-xs text-[#565278] mt-1">
              Click or touch any 3D column to inspect compartment prevalence &amp; sensitivity.
            </p>
          </div>

          <div className="my-4 flex items-end justify-between gap-2.5 h-36 px-3 pt-4 pb-2 bg-[#F5F2FC] border border-[#E3DCF5] rounded-lg">
            {SUBTYPE_PROFILES.map((s) => {
              const heightPct = Math.max(24, (s.rsnaPrevalencePct / maxPrevalence) * 100);
              const isSelected = selectedPrismId === s.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => {
                    playTactileSound('click');
                    setSelectedPrismId(s.id);
                  }}
                  className="flex-1 flex flex-col items-center justify-end h-full gap-1.5 group cursor-pointer active:translate-y-1 active:scale-95 transition-transform duration-150"
                >
                  <span className="text-[10px] font-mono tabular-nums text-[#565278] group-hover:text-indigo-700 font-medium">
                    {s.rsnaPrevalencePct.toFixed(0)}%
                  </span>
                  <div
                    style={{ height: `${heightPct}%` }}
                    className={`w-full max-w-[34px] relative rounded-t-md transition-all duration-300 ${
                      isSelected
                        ? 'bg-gradient-to-b from-[#818CF8] via-[#A78BFA] to-[#6EE7B7] shadow-[0_6px_18px_rgba(124,111,246,0.42)] -translate-y-1'
                        : 'bg-gradient-to-b from-[#DDD6FE] via-[#C4B5FD] to-[#A5B4FC] group-hover:from-[#A78BFA] group-hover:to-[#818CF8] group-hover:-translate-y-0.5'
                    }`}
                  >
                    <div
                      aria-hidden="true"
                      className="absolute inset-x-0 top-0 h-1.5 bg-white/65 rounded-t-md"
                    />
                  </div>
                  <span
                    className={`text-[10px] font-mono ${
                      isSelected ? 'text-indigo-700 font-semibold' : 'text-[#565278]'
                    }`}
                  >
                    {s.shortCode}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="bg-[#FAF8FF] border border-[#E3DCF5] rounded-lg p-2.5 text-xs space-y-1">
            <div className="flex justify-between font-semibold text-indigo-700">
              <span>{selectedProfile.name}</span>
              <span className="font-mono tabular-nums">
                AUROC {selectedProfile.validationAuroc.toFixed(3)}
              </span>
            </div>
            <div className="flex justify-between text-[11px] font-mono text-[#565278] tabular-nums">
              <span>Sens {selectedProfile.validationSensitivityPct.toFixed(1)}%</span>
              <span>Spec {selectedProfile.validationSpecificityPct.toFixed(1)}%</span>
            </div>
          </div>

          <div className="pt-3 mt-3 border-t border-[#EDE8F8] text-[11px] text-[#565278] leading-relaxed">
            Clinical Safety Note: No statistical vision model achieves 100% standalone accuracy on
            hyperacute (&lt;1h) bleeds, motion artifacts, or trace sulcal SAH due to ~2–4%
            inter-radiologist variance. HemaSTAT pairs 3-window differential inference with
            Priority Review escalation and mandatory attending sign-off.
          </div>
        </TiltCard3D>
      </div>
    </div>
  );
};
