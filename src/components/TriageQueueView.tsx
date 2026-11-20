import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpDown,
  Box,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Search,
  ShieldAlert,
  ShieldCheck,
  Table2,
} from 'lucide-react';
import type { CTCase, TriageLevel } from '../types/ct';
import { TactileButton, TiltCard3D } from './ui/Tactile3D';
import { HolographicMiniBrain } from './ui/HolographicMiniBrain';
import { playTactileSound } from '../utils/hapticSound';

interface TriageQueueViewProps {
  cases: CTCase[];
  activeCaseId: string;
  onSelectCase: (caseId: string) => void;
  onOpenUploadModal: () => void;
}

type FilterTab = 'all' | 'stat' | 'urgent' | 'negative' | 'uploads';
type SortKey = 'priority' | 'probability' | 'gcs';

const PRIORITY_RANK: Record<TriageLevel, number> = {
  STAT_SURGICAL: 0,
  URGENT_NEURO: 1,
  PRIORITY_REVIEW: 2,
  ROUTINE_NEGATIVE: 3,
};

function renderStatusCell(level?: TriageLevel) {
  switch (level) {
    case 'STAT_SURGICAL':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-rose-700">
          <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
          STAT Surgical
        </span>
      );
    case 'URGENT_NEURO':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-700">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          Urgent Neuro
        </span>
      );
    case 'PRIORITY_REVIEW':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-700">
          <Clock className="w-3.5 h-3.5 shrink-0" />
          Priority Review
        </span>
      );
    case 'ROUTINE_NEGATIVE':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
          Negative
        </span>
      );
    default:
      return <span className="text-xs text-[#6B668E]">Pending</span>;
  }
}

export const TriageQueueView: React.FC<TriageQueueViewProps> = ({
  cases,
  activeCaseId,
  onSelectCase,
  onOpenUploadModal,
}) => {
  const [filter, setFilter] = useState<FilterTab>('all');
  const [query, setQuery] = useState<string>('');
  const [sortBy, setSortBy] = useState<SortKey>('priority');
  const [queueViewMode, setQueueViewMode] = useState<'table' | 'orbital'>('orbital');
  const [orbitalIndex, setOrbitalIndex] = useState<number>(0);

  const counts = useMemo(() => {
    return {
      stat: cases.filter((c) => c.analysis?.triageLevel === 'STAT_SURGICAL').length,
      urgent: cases.filter((c) => c.analysis?.triageLevel === 'URGENT_NEURO').length,
      negative: cases.filter((c) => c.analysis?.triageLevel === 'ROUTINE_NEGATIVE').length,
      signed: cases.filter((c) => Boolean(c.signOff)).length,
    };
  }, [cases]);

  const filteredCases = useMemo(() => {
    const q = query.trim().toLowerCase();
    return cases
      .filter((c) => {
        if (filter === 'stat' && c.analysis?.triageLevel !== 'STAT_SURGICAL') return false;
        if (filter === 'urgent' && c.analysis?.triageLevel !== 'URGENT_NEURO') return false;
        if (filter === 'negative' && c.analysis?.triageLevel !== 'ROUTINE_NEGATIVE') return false;
        if (filter === 'uploads' && c.source !== 'user_upload') return false;

        if (!q) return true;
        return (
          c.accessionNumber.toLowerCase().includes(q) ||
          c.title.toLowerCase().includes(q) ||
          c.clinicalContext.patientId.toLowerCase().includes(q) ||
          (c.analysis?.dominantSubtype || '').toLowerCase().includes(q)
        );
      })
      .sort((a, b) => {
        if (sortBy === 'priority') {
          const ra = a.analysis ? PRIORITY_RANK[a.analysis.triageLevel] : 99;
          const rb = b.analysis ? PRIORITY_RANK[b.analysis.triageLevel] : 99;
          return ra - rb;
        }
        if (sortBy === 'probability') {
          return (b.analysis?.overallProbability ?? 0) - (a.analysis?.overallProbability ?? 0);
        }
        return a.clinicalContext.gcs - b.clinicalContext.gcs;
      });
  }, [cases, filter, query, sortBy]);

  return (
    <div className="relative z-10 max-w-[1360px] mx-auto px-6 py-6 space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-[#1E1B3A]">Emergency CT Triage Worklist</h1>
        <p className="text-xs text-[#565278] mt-1">
          Prioritized acute non-contrast head CT queue ordered by surgical urgency, midline shift,
          and attending attestation status
        </p>
      </div>

      {/* Interactive 3D Urgency Command Deck */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <TiltCard3D
          active={filter === 'stat'}
          glowColor="rgba(251, 113, 133, 0.28)"
          onClick={() => setFilter(filter === 'stat' ? 'all' : 'stat')}
          className="p-4"
        >
          <div className="flex items-center justify-between text-xs text-rose-700 font-semibold">
            <span>STAT Surgical</span>
            <ShieldAlert className="w-4 h-4" />
          </div>
          <div className="text-2xl font-mono font-semibold tabular-nums text-[#1E1B3A] mt-1">
            {counts.stat}
          </div>
          <div className="text-[11px] text-[#565278] mt-1">Immediate OR / EVD triage</div>
        </TiltCard3D>

        <TiltCard3D
          active={filter === 'urgent'}
          glowColor="rgba(251, 191, 36, 0.28)"
          onClick={() => setFilter(filter === 'urgent' ? 'all' : 'urgent')}
          className="p-4"
        >
          <div className="flex items-center justify-between text-xs text-amber-700 font-semibold">
            <span>Urgent Neuro</span>
            <AlertTriangle className="w-4 h-4" />
          </div>
          <div className="text-2xl font-mono font-semibold tabular-nums text-[#1E1B3A] mt-1">
            {counts.urgent}
          </div>
          <div className="text-[11px] text-[#565278] mt-1">STAT CTA / ICU admission</div>
        </TiltCard3D>

        <TiltCard3D
          active={filter === 'negative'}
          glowColor="rgba(52, 211, 153, 0.28)"
          onClick={() => setFilter(filter === 'negative' ? 'all' : 'negative')}
          className="p-4"
        >
          <div className="flex items-center justify-between text-xs text-emerald-700 font-semibold">
            <span>Clear / Negative</span>
            <CheckCircle2 className="w-4 h-4" />
          </div>
          <div className="text-2xl font-mono font-semibold tabular-nums text-[#1E1B3A] mt-1">
            {counts.negative}
          </div>
          <div className="text-[11px] text-[#565278] mt-1">Routine review queue</div>
        </TiltCard3D>

        <TiltCard3D
          active={filter === 'all'}
          glowColor="rgba(139, 124, 246, 0.28)"
          onClick={() => setFilter('all')}
          className="p-4"
        >
          <div className="flex items-center justify-between text-xs text-indigo-700 font-semibold">
            <span>Attending Attested</span>
            <ShieldCheck className="w-4 h-4" />
          </div>
          <div className="text-2xl font-mono font-semibold tabular-nums text-[#1E1B3A] mt-1">
            {counts.signed} / {cases.length}
          </div>
          <div className="text-[11px] text-[#565278] mt-1">Physician sign-off coverage</div>
        </TiltCard3D>
      </div>

      {/* Unified Queue Toolbar: Filter Tabs Left + Search & Sort Right */}
      <div className="p-2 bg-[#FAF8FF] border border-[#E3DCF5] rounded-xl flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1 bg-[#F3F0FA] p-1 rounded-lg border border-[#E3DCF5]">
          {(
            [
              ['all', `All Exams (${cases.length})`],
              ['stat', 'STAT Surgical'],
              ['urgent', 'Urgent Neuro'],
              ['negative', 'Negative'],
              ['uploads', 'Uploaded Scans'],
            ] as [FilterTab, string][]
          ).map(([key, label]) => (
            <TactileButton
              key={key}
              variant={filter === key ? 'active' : 'ghost'}
              onClick={() => setFilter(key)}
              className="px-3 py-1.5 text-xs font-medium rounded whitespace-nowrap shrink-0 cursor-pointer"
            >
              {label}
            </TactileButton>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-[#6B668E] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search accession, patient, subtype..."
              className="pl-8 pr-3 py-1.5 w-60 text-xs bg-white border border-[#DCD5F4] rounded-lg text-[#1E1B3A] placeholder:text-[#78749A] focus:outline-none focus:border-indigo-500 shadow-xs"
            />
          </div>

          <TactileButton
            variant="secondary"
            onClick={() =>
              setSortBy((prev) =>
                prev === 'priority' ? 'probability' : prev === 'probability' ? 'gcs' : 'priority'
              )
            }
            className="px-3 py-1.5 text-xs font-medium rounded-lg text-[#2D2952] whitespace-nowrap shrink-0 cursor-pointer"
          >
            <ArrowUpDown className="w-3.5 h-3.5 text-indigo-600" />
            Sort:{' '}
            {sortBy === 'priority'
              ? 'Triage Priority'
              : sortBy === 'probability'
              ? 'Bleed Prob.'
              : 'Lowest GCS'}
          </TactileButton>

          <div className="flex items-center gap-1 bg-[#F3F0FA] p-1 rounded-lg border border-[#E3DCF5]">
            <TactileButton
              variant={queueViewMode === 'orbital' ? 'active' : 'ghost'}
              onClick={() => setQueueViewMode('orbital')}
              className="px-2.5 py-1 text-xs font-medium rounded whitespace-nowrap cursor-pointer"
            >
              <Box className="w-3.5 h-3.5" />
              3D Deck
            </TactileButton>
            <TactileButton
              variant={queueViewMode === 'table' ? 'active' : 'ghost'}
              onClick={() => setQueueViewMode('table')}
              className="px-2.5 py-1 text-xs font-medium rounded whitespace-nowrap cursor-pointer"
            >
              <Table2 className="w-3.5 h-3.5" />
              Table
            </TactileButton>
          </div>
        </div>
      </div>

      {queueViewMode === 'orbital' && (
        <div className="surface-3d border border-[#E3DCF5] rounded-xl p-5 overflow-hidden">
          {filteredCases.length === 0 ? (
            <div className="py-12 text-center text-[#565278]">
              <p className="text-sm text-[#1E1B3A] font-semibold">No matching CT exams in queue</p>
              <TactileButton
                variant="primary"
                onClick={onOpenUploadModal}
                className="mt-4 px-4 py-2 text-xs font-semibold rounded cursor-pointer"
              >
                Upload Head CT
              </TactileButton>
            </div>
          ) : (
            (() => {
              const safeIdx = Math.min(orbitalIndex, filteredCases.length - 1);
              return (
                <div className="space-y-4">
                  <div className="flex items-center justify-between text-xs text-[#565278]">
                    <span className="font-mono">
                      3D Orbital Coverflow Deck · Card {safeIdx + 1} / {filteredCases.length}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <TactileButton
                        variant="secondary"
                        disabled={safeIdx <= 0}
                        onClick={() => setOrbitalIndex((i) => Math.max(0, i - 1))}
                        className="p-1.5 rounded disabled:opacity-35"
                        aria-label="Previous study card"
                      >
                        <ChevronLeft className="w-4 h-4" />
                      </TactileButton>
                      <TactileButton
                        variant="secondary"
                        disabled={safeIdx >= filteredCases.length - 1}
                        onClick={() =>
                          setOrbitalIndex((i) => Math.min(filteredCases.length - 1, i + 1))
                        }
                        className="p-1.5 rounded disabled:opacity-35"
                        aria-label="Next study card"
                      >
                        <ChevronRight className="w-4 h-4" />
                      </TactileButton>
                    </div>
                  </div>

                  <div
                    onWheel={(e) => {
                      if (Math.abs(e.deltaY) > 10 || Math.abs(e.deltaX) > 10) {
                        const dir = e.deltaY + e.deltaX > 0 ? 1 : -1;
                        setOrbitalIndex((i) =>
                          Math.max(0, Math.min(filteredCases.length - 1, i + dir))
                        );
                      }
                    }}
                    className="relative h-[310px] w-full flex items-center justify-center perspective-stage select-none"
                  >
                    {filteredCases.map((item, idx) => {
                      const offset = idx - safeIdx;
                      const absOff = Math.abs(offset);
                      if (absOff > 3) return null;

                      const a = item.analysis;
                      const shiftMm =
                        typeof item.measuredMidlineShiftMm === 'number'
                          ? item.measuredMidlineShiftMm
                          : a?.secondaryFindings.midlineShiftPresent
                          ? a.secondaryFindings.midlineShiftMmEstimate
                          : 0;
                      const isCenter = offset === 0;
                      const tx = offset * 215;
                      const tz = -absOff * 125;
                      const ry = offset * -24;
                      const scale = Math.max(0.72, 1 - absOff * 0.12);
                      const opacity = Math.max(0.28, 1 - absOff * 0.28);

                      return (
                        <div
                          key={item.id}
                          onClick={() => {
                            playTactileSound('click');
                            if (isCenter) onSelectCase(item.id);
                            else setOrbitalIndex(idx);
                          }}
                          style={{
                            transform: `translate3d(${tx}px, 0, ${tz}px) rotateY(${ry}deg) scale(${scale})`,
                            zIndex: 30 - absOff,
                            opacity,
                            transition: 'transform 380ms cubic-bezier(0.16, 1, 0.3, 1), opacity 280ms ease',
                          }}
                          className={`absolute w-[310px] rounded-xl surface-3d border p-4 cursor-pointer space-y-3 ${
                            isCenter
                              ? 'border-[#8B7CF6] shadow-[0_24px_48px_-14px_rgba(91,75,138,0.38)]'
                              : 'border-[#DCD5F4]'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-center gap-2.5 min-w-0">
                              <HolographicMiniBrain
                                triageLevel={a?.triageLevel}
                                dominantSubtype={a?.dominantSubtype}
                                xPercent={a?.localization.xPercent}
                                yPercent={a?.localization.yPercent}
                                selected={isCenter}
                              />
                              <div className="min-w-0">
                                <div className="text-xs font-mono font-semibold text-[#1E1B3A] truncate">
                                  {item.accessionNumber}
                                </div>
                                <div className="text-[11px] text-[#565278] truncate">
                                  {item.clinicalContext.patientId} · {item.clinicalContext.age}Y{' '}
                                  {item.clinicalContext.sex}
                                </div>
                              </div>
                            </div>
                            {renderStatusCell(a?.triageLevel)}
                          </div>

                          <div className="text-xs font-medium text-[#2D2952] truncate">{item.title}</div>

                          <div className="grid grid-cols-3 gap-2 bg-[#F6F4FB] border border-[#E3DCF5] rounded-lg p-2.5 text-center font-mono">
                            <div>
                              <div className="text-[10px] text-[#565278]">Subtype</div>
                              <div className="text-xs font-semibold text-indigo-700">
                                {a?.anyHemorrhage ? a.dominantSubtype.toUpperCase() : 'NONE'}
                              </div>
                            </div>
                            <div>
                              <div className="text-[10px] text-[#565278]">Prob.</div>
                              <div className="text-xs font-semibold tabular-nums text-[#1E1B3A]">
                                {a ? `${a.overallProbability.toFixed(0)}%` : '—'}
                              </div>
                            </div>
                            <div>
                              <div className="text-[10px] text-[#565278]">Shift / GCS</div>
                              <div className="text-xs font-semibold tabular-nums text-[#1E1B3A]">
                                {shiftMm.toFixed(1)}mm · {item.clinicalContext.gcs}
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center justify-between pt-1">
                            <span className="text-[11px] font-mono text-[#6B668E]">
                              {item.signOff ? 'Attested' : 'Awaiting Read'}
                            </span>
                            {isCenter ? (
                              <TactileButton
                                variant="primary"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onSelectCase(item.id);
                                }}
                                className="px-3 py-1 text-xs font-semibold rounded"
                              >
                                Open in 3D Workstation
                              </TactileButton>
                            ) : (
                              <span className="text-[11px] text-indigo-600 font-medium">
                                Focus Card
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()
          )}
        </div>
      )}

      {queueViewMode === 'table' && (

      <div className="surface-3d border border-[#E3DCF5] rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[#E3DCF5] text-[11px] font-mono text-[#565278] bg-[#F4F0FC]">
                <th className="py-3 px-4 font-medium">Triage Status</th>
                <th className="py-3 px-4 font-medium">Accession / Patient</th>
                <th className="py-3 px-4 font-medium">Primary Subtype</th>
                <th className="py-3 px-4 font-medium text-right">Bleed Prob.</th>
                <th className="py-3 px-4 font-medium text-right">Shift / Vol.</th>
                <th className="py-3 px-4 font-medium text-right">GCS</th>
                <th className="py-3 px-4 font-medium">Attending Sign-Off</th>
                <th className="py-3 px-4 font-medium text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#EDE8F8] text-xs">
              {filteredCases.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-[#565278]">
                    <p className="text-sm text-[#1E1B3A] font-semibold">
                      No matching CT exams in queue
                    </p>
                    <p className="text-xs text-[#6B668E] mt-1">
                      Adjust search filters or upload a new non-contrast head CT scan.
                    </p>
                    <TactileButton
                      variant="primary"
                      onClick={onOpenUploadModal}
                      className="mt-4 px-4 py-2 text-xs font-semibold rounded cursor-pointer"
                    >
                      Upload Head CT
                    </TactileButton>
                  </td>
                </tr>
              ) : (
                filteredCases.map((item) => {
                  const isActive = item.id === activeCaseId;
                  const a = item.analysis;
                  const shiftMm =
                    typeof item.measuredMidlineShiftMm === 'number'
                      ? item.measuredMidlineShiftMm
                      : a?.secondaryFindings.midlineShiftPresent
                      ? a.secondaryFindings.midlineShiftMmEstimate
                      : 0;

                  return (
                    <tr
                      key={item.id}
                      onClick={() => onSelectCase(item.id)}
                      className={`cursor-pointer transition-colors align-middle ${
                        isActive
                          ? 'bg-[#EDE9FE]/85 shadow-[inset_0_1px_0_rgba(255,255,255,0.85)]'
                          : 'hover:bg-[#F7F4FD]'
                      }`}
                    >
                      <td className="py-3 px-4 whitespace-nowrap">
                        {renderStatusCell(a?.triageLevel)}
                      </td>
                      <td className="py-3 px-4">
                        <div className="font-mono text-[#1E1B3A] font-semibold">
                          {item.accessionNumber}
                        </div>
                        <div className="text-[11px] text-[#565278]">
                          {item.clinicalContext.patientId} · {item.clinicalContext.age}Y{' '}
                          {item.clinicalContext.sex} · {item.title}
                        </div>
                      </td>
                      <td className="py-3 px-4 font-mono text-[#2D2952] font-medium whitespace-nowrap">
                        {a?.anyHemorrhage ? a.dominantSubtype.toUpperCase() : 'NONE'}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums text-[#1E1B3A] font-semibold whitespace-nowrap">
                        {a ? `${a.overallProbability.toFixed(1)}%` : '—'}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums whitespace-nowrap">
                        <span className={shiftMm >= 5 ? 'text-rose-700 font-semibold' : 'text-[#3E3A5E]'}>
                          {shiftMm.toFixed(1)}mm
                        </span>
                        {item.abcVolume && (
                          <span className="text-[#565278] ml-1.5">
                            · {item.abcVolume.volumeMl.toFixed(0)}mL
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums text-[#1E1B3A] whitespace-nowrap">
                        {item.clinicalContext.gcs}/15
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        {item.signOff ? (
                          <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                            <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                            {item.signOff.status === 'confirmed' ? 'Confirmed' : 'Overridden'}
                          </span>
                        ) : (
                          <span className="text-[#6B668E]">Awaiting Read</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <TactileButton
                          variant="active"
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectCase(item.id);
                          }}
                          className="px-3 py-1 text-xs font-medium rounded cursor-pointer"
                        >
                          Open Slice
                        </TactileButton>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
      )}
    </div>
  );
};
