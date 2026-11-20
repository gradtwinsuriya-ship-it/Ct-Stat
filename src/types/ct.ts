export type HemorrhageSubtypeId =
  | 'epidural'
  | 'subdural'
  | 'subarachnoid'
  | 'intraventricular'
  | 'intraparenchymal';

export type TriageLevel =
  | 'STAT_SURGICAL'
  | 'URGENT_NEURO'
  | 'PRIORITY_REVIEW'
  | 'ROUTINE_NEGATIVE';

export type AnticoagulantType =
  | 'none'
  | 'warfarin'
  | 'xa_inhibitor'
  | 'dabigatran'
  | 'antiplatelet';

export interface SubtypePrediction {
  detected: boolean;
  probability: number;
  rationale: string;
}

export interface LocalizationInfo {
  hemisphere: string;
  anatomicalRegion: string;
  xPercent: number;
  yPercent: number;
  radiusPercent: number;
}

export interface SecondaryFindings {
  midlineShiftPresent: boolean;
  midlineShiftMmEstimate: number;
  massEffectPresent: boolean;
  hydrocephalusRisk: string;
  skullFractureSuspicion: boolean;
}

export interface AnalysisResult {
  isValidHeadCT: boolean;
  imageQualityNote: string;
  anyHemorrhage: boolean;
  overallProbability: number;
  triageLevel: TriageLevel;
  surgicalUrgencyWindow: string;
  dominantSubtype: HemorrhageSubtypeId | 'none';
  subtypes: Record<HemorrhageSubtypeId, SubtypePrediction>;
  localization: LocalizationInfo;
  secondaryFindings: SecondaryFindings;
  radiologyImpression: string;
  recommendedActions: string[];
  windowAgreementPct?: number;
  differentialCheck?: string;
}

export interface ClinicalContext {
  patientId: string;
  age: string;
  sex: 'M' | 'F' | 'Other';
  gcs: number;
  symptoms: string;
  onsetHours: string;
  anticoagulant?: AnticoagulantType;
}

export interface DicomMetadata {
  rows: number;
  columns: number;
  windowCenter?: number;
  windowWidth?: number;
  pixelSpacingMm?: [number, number];
  sliceThicknessMm?: number;
  instanceNumber?: number;
  sliceLocationMm?: number;
  patientId?: string;
  studyDescription?: string;
  strippedPhiTags?: string[];
  huBuffer?: Float32Array;
}

export interface CTSeriesSlice {
  id: string;
  label: string;
  imageUrl: string;
  mimeType: string;
  instanceNumber: number;
  sliceLocationMm?: number;
  dicomMeta?: DicomMetadata;
}

export interface AbcVolumeData {
  aCm: number;
  bCm: number;
  slicesCount: number;
  sliceThicknessCm: number;
  volumeMl: number;
}

export interface ClinicianSignOff {
  status: 'confirmed' | 'overridden';
  clinicianName: string;
  finalSubtype: HemorrhageSubtypeId | 'none';
  notes: string;
  signedAt: string;
}

export interface ConsultMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

export interface CTCase {
  id: string;
  accessionNumber: string;
  title: string;
  source: 'rsna_cohort' | 'user_upload';
  imageUrl: string;
  mimeType: string;
  slices?: CTSeriesSlice[];
  clinicalContext: ClinicalContext;
  groundTruth?: {
    label: HemorrhageSubtypeId | 'none';
    summary: string;
    rsnaExamRef: string;
  };
  analysis: AnalysisResult | null;
  inferenceMs?: number;
  analyzedAt?: string;
  isLiveInference?: boolean;
  dicomMeta?: DicomMetadata;
  abcVolume?: AbcVolumeData;
  measuredMidlineShiftMm?: number;
  signOff?: ClinicianSignOff;
}

export interface WindowPreset {
  id: 'brain' | 'subdural' | 'stroke' | 'bone';
  label: string;
  width: number;
  level: number;
  description: string;
}

export interface MeasurementLine {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  lengthMm: number;
}

export interface RoiEllipseMeasurement {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  areaCm2: number;
  meanHu: number;
  maxHu: number;
  minHu: number;
  tissueHint: string;
}

export interface MidlineShiftOverlay {
  falxX1: number;
  falxY1: number;
  falxX2: number;
  falxY2: number;
  septumX: number;
  septumY: number;
  shiftMm: number;
}

export interface SubtypeClinicalProfile {
  id: HemorrhageSubtypeId;
  shortCode: string;
  name: string;
  compartment: string;
  ctMorphology: string;
  vascularSource: string;
  sutureRule: string;
  typicalHu: string;
  surgicalUrgency: string;
  surgicalProcedure: string;
  rsnaPrevalencePct: number;
  validationAuroc: number;
  validationSensitivityPct: number;
  validationSpecificityPct: number;
  referenceImageUrl: string;
}
