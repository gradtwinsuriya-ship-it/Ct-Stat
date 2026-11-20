import React, { useRef, useState } from 'react';
import { FileImage, Layers, Loader2, ShieldCheck, Upload, X } from 'lucide-react';
import type { AnticoagulantType, ClinicalContext } from '../types/ct';
import { TactileButton } from './ui/Tactile3D';

interface UploadModalProps {
  isOpen: boolean;
  isSubmitting: boolean;
  initialFile: File | null;
  onClose: () => void;
  onSubmitScan: (files: File[], context: ClinicalContext) => Promise<void>;
}

export const UploadModal: React.FC<UploadModalProps> = ({
  isOpen,
  isSubmitting,
  initialFile,
  onClose,
  onSubmitScan,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<File[]>(initialFile ? [initialFile] : []);
  const [patientId, setPatientId] = useState<string>('PT-ER-9042');
  const [age, setAge] = useState<string>('58');
  const [sex, setSex] = useState<'M' | 'F' | 'Other'>('M');
  const [gcs, setGcs] = useState<number>(13);
  const [onsetHours, setOnsetHours] = useState<string>('1.5h');
  const [anticoagulant, setAnticoagulant] = useState<AnticoagulantType>('none');
  const [symptoms, setSymptoms] = useState<string>(
    'Acute severe headache and focal neurological deficit following head trauma'
  );
  const [localError, setLocalError] = useState<string | null>(null);

  React.useEffect(() => {
    if (initialFile) {
      setSelectedFiles([initialFile]);
      setLocalError(null);
    }
  }, [initialFile]);

  if (!isOpen) return null;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = e.target.files ? Array.from(e.target.files) : [];
    if (list.length > 0) {
      setSelectedFiles(list);
      setLocalError(null);
    }
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedFiles.length === 0) {
      setLocalError('Select one or more head CT slices (.dcm, .png, .jpg, or .webp) first.');
      return;
    }
    setLocalError(null);
    await onSubmitScan(selectedFiles, {
      patientId: patientId.trim() || 'PT-STAT',
      age: age.trim() || 'Unknown',
      sex,
      gcs,
      symptoms: symptoms.trim(),
      onsetHours: onsetHours.trim(),
      anticoagulant,
    });
  };

  const totalKb = selectedFiles.reduce((sum, f) => sum + f.size, 0) / 1024;
  const hasDicom = selectedFiles.some((f) => f.name.toLowerCase().endsWith('.dcm'));

  return (
    <div className="fixed inset-0 z-50 bg-[#1E1B3A]/35 flex items-center justify-center p-4 perspective-stage">
      <div className="w-full max-w-lg surface-3d border border-[#DCD5F4] rounded-xl overflow-hidden shadow-[0_28px_60px_-15px_rgba(76,60,150,0.34)]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#E3DCF5] bg-[#FAF8FF]">
          <div>
            <h2 className="text-base font-semibold text-[#1E1B3A]">
              Ingest Head CT Series or Slice
            </h2>
            <p className="text-xs text-[#565278] mt-0.5">
              Select single slice or multi-slice Z-stack (.dcm, .png, .jpg, .webp)
            </p>
          </div>
          <TactileButton
            variant="secondary"
            onClick={onClose}
            className="p-1.5 text-[#565278] hover:text-[#1E1B3A] rounded cursor-pointer"
            aria-label="Close modal"
          >
            <X className="w-4 h-4" />
          </TactileButton>
        </div>

        <form onSubmit={handleFormSubmit} className="p-5 space-y-4">
          {/* File Drop / Picker */}
          <div
            onClick={() => fileInputRef.current?.click()}
            className="border border-dashed border-[#C4B5FD] hover:border-indigo-500 bg-[#FAF8FF] rounded-lg p-4 text-center cursor-pointer transition-colors"
          >
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".dcm,application/dicom,image/png,image/jpeg,image/webp"
              onChange={handleFileChange}
              className="hidden"
            />
            {selectedFiles.length > 0 ? (
              <div className="flex items-center justify-center gap-4 text-left py-1 group">
                {/* Interactive 3D Fanned Pastel Z-Stack Preview */}
                <div className="relative w-14 h-14 shrink-0 perspective-stage">
                  {Array.from({ length: Math.min(3, selectedFiles.length) }).map((_, idx) => {
                    const offset = idx - 1;
                    return (
                      <div
                        key={idx}
                        style={{
                          transform: `translateZ(${idx * 8}px) rotate(${offset * 7}deg) translateX(${offset * 4}px)`,
                        }}
                        className="absolute inset-0 rounded-lg border border-[#A78BFA]/70 bg-gradient-to-br from-white via-[#EDE9FE] to-[#D1FAE5]/70 shadow-sm flex items-center justify-center transition-transform duration-300 group-hover:scale-105"
                      >
                        {idx === Math.min(3, selectedFiles.length) - 1 &&
                          (selectedFiles.length > 1 ? (
                            <Layers className="w-5 h-5 text-indigo-600" />
                          ) : (
                            <FileImage className="w-5 h-5 text-indigo-600" />
                          ))}
                      </div>
                    );
                  })}
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-[#1E1B3A] truncate">
                    {selectedFiles.length > 1
                      ? `${selectedFiles.length} CT Slices Selected (Z-Stack Series)`
                      : selectedFiles[0].name}
                  </div>
                  <div className="text-xs font-mono text-[#565278]">
                    {totalKb.toFixed(1)} KB total · Click to replace selection
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-1.5 py-1">
                <Upload className="w-6 h-6 text-indigo-600 mx-auto" />
                <div className="text-sm font-semibold text-[#1E1B3A]">
                  Select single slice or multi-slice DICOM stack
                </div>
                <div className="text-xs text-[#565278]">
                  Uncompressed DICOM (.dcm), PNG, JPG, or WebP
                </div>
              </div>
            )}
          </div>

          {hasDicom && (
            <div className="flex items-center gap-2 text-[11px] text-emerald-800 bg-[#D1FAE5]/70 border border-emerald-300 rounded-md px-3 py-2">
              <ShieldCheck className="w-4 h-4 shrink-0 text-emerald-700" />
              <span>
                DICOM PHI tags (PatientName, PatientID, BirthDate, Institution) are stripped
                locally before AI transmission.
              </span>
            </div>
          )}

          {/* Clinical Triage Context */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="col-span-2">
              <label className="block text-xs text-[#565278] mb-1" htmlFor="pt-id">
                Study / Anon ID
              </label>
              <input
                id="pt-id"
                type="text"
                value={patientId}
                onChange={(e) => setPatientId(e.target.value)}
                className="w-full px-3 py-1.5 text-xs font-mono bg-white border border-[#DCD5F4] rounded text-[#1E1B3A] focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div>
              <label className="block text-xs text-[#565278] mb-1" htmlFor="pt-age">
                Age
              </label>
              <input
                id="pt-age"
                type="text"
                value={age}
                onChange={(e) => setAge(e.target.value)}
                className="w-full px-3 py-1.5 text-xs font-mono bg-white border border-[#DCD5F4] rounded text-[#1E1B3A] focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div>
              <label className="block text-xs text-[#565278] mb-1" htmlFor="pt-sex">
                Sex
              </label>
              <select
                id="pt-sex"
                value={sex}
                onChange={(e) => setSex(e.target.value as 'M' | 'F' | 'Other')}
                className="w-full px-2.5 py-1.5 text-xs bg-white border border-[#DCD5F4] rounded text-[#1E1B3A] focus:outline-none focus:border-indigo-500"
              >
                <option value="M">M</option>
                <option value="F">F</option>
                <option value="Other">Other</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-[#565278] mb-1" htmlFor="pt-gcs">
                GCS ({gcs}/15)
              </label>
              <input
                id="pt-gcs"
                type="range"
                min={3}
                max={15}
                value={gcs}
                onChange={(e) => setGcs(Number(e.target.value))}
                className="w-full accent-indigo-500 mt-1.5"
              />
            </div>

            <div>
              <label className="block text-xs text-[#565278] mb-1" htmlFor="pt-onset">
                Time Since Onset
              </label>
              <input
                id="pt-onset"
                type="text"
                value={onsetHours}
                onChange={(e) => setOnsetHours(e.target.value)}
                placeholder="e.g. 1.5h"
                className="w-full px-3 py-1.5 text-xs bg-white border border-[#DCD5F4] rounded text-[#1E1B3A] focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div>
              <label className="block text-xs text-[#565278] mb-1" htmlFor="pt-anticoag">
                Anticoagulation
              </label>
              <select
                id="pt-anticoag"
                value={anticoagulant}
                onChange={(e) => setAnticoagulant(e.target.value as AnticoagulantType)}
                className="w-full px-2.5 py-1.5 text-xs bg-white border border-[#DCD5F4] rounded text-[#1E1B3A] focus:outline-none focus:border-indigo-500"
              >
                <option value="none">None / Unknown</option>
                <option value="warfarin">Warfarin (VKA)</option>
                <option value="xa_inhibitor">Factor Xa (Apixaban/Rivaroxaban)</option>
                <option value="dabigatran">Dabigatran</option>
                <option value="antiplatelet">Antiplatelet (ASA/Clopidogrel)</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs text-[#565278] mb-1" htmlFor="pt-symptoms">
              Clinical Presentation / Mechanism
            </label>
            <textarea
              id="pt-symptoms"
              rows={2}
              value={symptoms}
              onChange={(e) => setSymptoms(e.target.value)}
              className="w-full px-3 py-1.5 text-xs bg-white border border-[#DCD5F4] rounded text-[#1E1B3A] focus:outline-none focus:border-indigo-500 resize-none"
            />
          </div>

          {localError && (
            <div className="text-xs text-rose-800 bg-rose-50 border border-rose-200 rounded px-3 py-2">
              {localError}
            </div>
          )}

          <div className="flex items-center justify-end gap-3 pt-2 border-t border-[#E3DCF5]">
            <TactileButton
              variant="secondary"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-[#2D2952] rounded cursor-pointer"
            >
              Cancel
            </TactileButton>
            <TactileButton
              type="submit"
              variant="primary"
              magnetic
              disabled={isSubmitting}
              className="px-4 py-2 text-xs font-semibold disabled:opacity-60 rounded cursor-pointer"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Running 3-Window Triage...
                </>
              ) : (
                'Analyze Active Slice'
              )}
            </TactileButton>
          </div>
        </form>
      </div>
    </div>
  );
};
