import { jsPDF } from 'jspdf';
import type { CTCase, HemorrhageSubtypeId, TriageLevel } from '../types/ct';
import { getReversalProtocol } from './fhirExport';

const SUBTYPE_META: { id: HemorrhageSubtypeId; name: string; code: string }[] = [
  { id: 'epidural', name: 'Epidural Hemorrhage', code: 'EDH' },
  { id: 'subdural', name: 'Subdural Hemorrhage', code: 'SDH' },
  { id: 'subarachnoid', name: 'Subarachnoid Hemorrhage', code: 'SAH' },
  { id: 'intraventricular', name: 'Intraventricular Hemorrhage', code: 'IVH' },
  { id: 'intraparenchymal', name: 'Intraparenchymal Hemorrhage', code: 'IPH' },
];

function getTriageTheme(level: TriageLevel, isValidHeadCT: boolean): {
  label: string;
  rgb: [number, number, number];
  bgRgb: [number, number, number];
} {
  if (!isValidHeadCT) {
    return {
      label: 'NON-DIAGNOSTIC INPUT',
      rgb: [180, 83, 9],
      bgRgb: [254, 243, 199],
    };
  }
  switch (level) {
    case 'STAT_SURGICAL':
      return {
        label: 'STAT SURGICAL TRIAGE',
        rgb: [185, 28, 28],
        bgRgb: [254, 226, 226],
      };
    case 'URGENT_NEURO':
      return {
        label: 'URGENT NEUROLOGY / NEUROSURGERY',
        rgb: [180, 83, 9],
        bgRgb: [254, 243, 199],
      };
    case 'PRIORITY_REVIEW':
      return {
        label: 'PRIORITY RADIOLOGY REVIEW',
        rgb: [14, 116, 144],
        bgRgb: [207, 250, 254],
      };
    case 'ROUTINE_NEGATIVE':
    default:
      return {
        label: 'NEGATIVE — NO ACUTE BLEED',
        rgb: [4, 120, 87],
        bgRgb: [209, 250, 229],
      };
  }
}

async function loadImageAsJpegDataUrl(url: string): Promise<string | null> {
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.crossOrigin = 'anonymous';
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Image load failed'));
      el.src = url;
    });

    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, size, size);
    ctx.drawImage(img, 0, 0, size, size);
    return canvas.toDataURL('image/jpeg', 0.88);
  } catch {
    return null;
  }
}

export async function exportDiagnosticPdf(ctCase: CTCase): Promise<void> {
  const analysis = ctCase.analysis;
  if (!analysis) {
    throw new Error('Run AI CT triage before exporting a diagnostic report.');
  }

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 15;
  const contentWidth = pageWidth - margin * 2;
  let y = 15;

  const ensureSpace = (neededMm: number) => {
    if (y + neededMm > pageHeight - 18) {
      doc.addPage();
      y = 16;
    }
  };

  // 1. Header Band
  doc.setFillColor(13, 17, 23);
  doc.rect(0, 0, pageWidth, 24, 'F');

  doc.setTextColor(248, 250, 252);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text('HemaSTAT', margin, 11);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(148, 163, 184);
  doc.text('ACUTE INTRACRANIAL HEMORRHAGE CT TRIAGE DIAGNOSTIC SUMMARY', margin, 17.5);

  const generatedAt = ctCase.analyzedAt
    ? new Date(ctCase.analyzedAt).toLocaleString()
    : new Date().toLocaleString();
  doc.setFont('courier', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(203, 213, 225);
  doc.text(`Accession: ${ctCase.accessionNumber}`, pageWidth - margin, 10.5, { align: 'right' });
  doc.text(`Generated: ${generatedAt}`, pageWidth - margin, 16.5, { align: 'right' });

  y = 31;

  // 2. Top-Level Triage Recommendation Banner
  const theme = getTriageTheme(analysis.triageLevel, analysis.isValidHeadCT);
  const urgencyLines = doc.splitTextToSize(
    `Recommended Action Window: ${analysis.surgicalUrgencyWindow}`,
    contentWidth - 42
  );
  const bannerHeight = Math.max(20, 12 + urgencyLines.length * 4.2);

  doc.setFillColor(...theme.bgRgb);
  doc.setDrawColor(...theme.rgb);
  doc.setLineWidth(0.5);
  doc.roundedRect(margin, y, contentWidth, bannerHeight, 1.5, 1.5, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.setTextColor(...theme.rgb);
  doc.text(theme.label, margin + 4, y + 7);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(30, 41, 59);
  doc.text(urgencyLines, margin + 4, y + 13);

  doc.setFont('courier', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(...theme.rgb);
  doc.text(`${analysis.overallProbability.toFixed(1)}%`, pageWidth - margin - 4, y + 9, {
    align: 'right',
  });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(71, 85, 105);
  doc.text(
    analysis.anyHemorrhage
      ? `Primary: ${analysis.dominantSubtype.toUpperCase()}`
      : 'Bleed Probability',
    pageWidth - margin - 4,
    y + 14.5,
    { align: 'right' }
  );

  y += bannerHeight + 6;

  // 3. Patient Clinical Context + Optional CT Slice Thumbnail
  const thumbnailDataUrl = await loadImageAsJpegDataUrl(ctCase.imageUrl);
  const thumbSize = thumbnailDataUrl ? 34 : 0;
  const infoWidth = thumbnailDataUrl ? contentWidth - thumbSize - 6 : contentWidth;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(15, 23, 42);
  doc.text('PATIENT CLINICAL CONTEXT', margin, y);
  y += 2;
  doc.setDrawColor(203, 213, 225);
  doc.setLineWidth(0.3);
  doc.line(margin, y, margin + infoWidth, y);
  y += 5;

  const startContextY = y;
  const ctx = ctCase.clinicalContext;
  const reversal = getReversalProtocol(ctx.anticoagulant);

  doc.setFontSize(8.5);
  const col1X = margin;
  const col2X = margin + infoWidth * 0.52;

  const drawKv = (label: string, value: string, x: number, rowY: number) => {
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(100, 116, 139);
    doc.text(label, x, rowY);
    doc.setFont('courier', 'normal');
    doc.setTextColor(15, 23, 42);
    doc.text(value, x + 28, rowY);
  };

  drawKv('Patient ID:', ctx.patientId, col1X, y);
  drawKv('Demographics:', `${ctx.age}Y / ${ctx.sex}`, col2X, y);
  y += 5;
  drawKv('GCS Score:', `${ctx.gcs} / 15`, col1X, y);
  drawKv('Onset:', ctx.onsetHours || 'Not specified', col2X, y);
  y += 5;
  drawKv('Anticoag.:', reversal.label.slice(0, 24), col1X, y);
  drawKv(
    'Analysis:',
    ctCase.isLiveInference
      ? `3-Win Live AI (${ctCase.inferenceMs ?? 0} ms)`
      : 'RSNA Cohort Baseline',
    col2X,
    y
  );
  y += 5.5;

  doc.setFont('helvetica', 'bold');
  doc.setTextColor(100, 116, 139);
  doc.text('Presentation:', col1X, y);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(30, 41, 59);
  const symptomLines = doc.splitTextToSize(ctx.symptoms || 'None documented', infoWidth - 28);
  doc.text(symptomLines, col1X + 28, y);
  y += Math.max(5, symptomLines.length * 4);

  if (thumbnailDataUrl) {
    const thumbX = margin + infoWidth + 6;
    const thumbY = startContextY - 6;
    doc.setFillColor(0, 0, 0);
    doc.rect(thumbX, thumbY, thumbSize, thumbSize, 'F');
    doc.addImage(thumbnailDataUrl, 'JPEG', thumbX, thumbY, thumbSize, thumbSize);
    doc.setFont('courier', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(100, 116, 139);
    doc.text('Axial NCCT Slice', thumbX + thumbSize / 2, thumbY + thumbSize + 3.5, {
      align: 'center',
    });
    y = Math.max(y, thumbY + thumbSize + 6);
  } else {
    y += 3;
  }

  // 4. 5-Subtype AI Analysis Scores
  ensureSpace(64);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(15, 23, 42);
  doc.text('5-SUBTYPE INTRACRANIAL HEMORRHAGE AI SCORES', margin, y);
  y += 2;
  doc.setDrawColor(203, 213, 225);
  doc.line(margin, y, pageWidth - margin, y);
  y += 5;

  for (const st of SUBTYPE_META) {
    const pred = analysis.subtypes[st.id];
    const rationaleLines = pred.detected
      ? doc.splitTextToSize(pred.rationale, contentWidth - 8)
      : [];
    const blockHeight = 8.5 + (rationaleLines.length > 0 ? rationaleLines.length * 3.8 + 1.5 : 0);
    ensureSpace(blockHeight);

    doc.setFont('helvetica', pred.detected ? 'bold' : 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(pred.detected ? 15 : 71, pred.detected ? 23 : 85, pred.detected ? 42 : 105);
    doc.text(`${st.name} (${st.code})`, margin, y);

    const statusText = pred.detected ? 'DETECTED' : 'Not Detected';
    doc.setFont('courier', pred.detected ? 'bold' : 'normal');
    doc.setFontSize(8);
    if (pred.detected) {
      doc.setTextColor(185, 28, 28);
    } else {
      doc.setTextColor(100, 116, 139);
    }
    doc.text(statusText, margin + 74, y);

    const barX = margin + 102;
    const barW = 54;
    const barH = 2.6;
    doc.setFillColor(226, 232, 240);
    doc.rect(barX, y - 2.3, barW, barH, 'F');
    const fillW = Math.max(0.8, (Math.min(100, Math.max(0, pred.probability)) / 100) * barW);
    if (pred.detected) {
      doc.setFillColor(220, 38, 38);
    } else {
      doc.setFillColor(148, 163, 184);
    }
    doc.rect(barX, y - 2.3, fillW, barH, 'F');

    doc.setFont('courier', pred.detected ? 'bold' : 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(pred.detected ? 15 : 71, pred.detected ? 23 : 85, pred.detected ? 42 : 105);
    doc.text(`${pred.probability.toFixed(1)}%`, pageWidth - margin, y, { align: 'right' });

    y += 4.5;
    if (rationaleLines.length > 0) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.8);
      doc.setTextColor(71, 85, 105);
      doc.text(rationaleLines, margin + 4, y);
      y += rationaleLines.length * 3.8 + 1.5;
    } else {
      y += 2;
    }
  }

  y += 2;

  // 5. Anatomical Localization, ABC/2 Volume & Surgical Indicators
  ensureSpace(34);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(15, 23, 42);
  doc.text('LOCALIZATION, VOLUMETRICS & SURGICAL INDICATORS', margin, y);
  y += 2;
  doc.setDrawColor(203, 213, 225);
  doc.line(margin, y, pageWidth - margin, y);
  y += 5;

  const sf = analysis.secondaryFindings;
  const shiftLabel =
    typeof ctCase.measuredMidlineShiftMm === 'number'
      ? `${ctCase.measuredMidlineShiftMm.toFixed(1)} mm (caliper)`
      : sf.midlineShiftPresent
      ? `${sf.midlineShiftMmEstimate.toFixed(1)} mm (AI est.)`
      : 'Absent';

  doc.setFontSize(8.5);
  drawKv('Hemisphere:', analysis.localization.hemisphere, margin, y);
  drawKv('Midline Shift:', shiftLabel, margin + contentWidth * 0.52, y);
  y += 5;
  drawKv('Region:', analysis.localization.anatomicalRegion.slice(0, 32), margin, y);
  drawKv(
    'ABC/2 Volume:',
    ctCase.abcVolume ? `${ctCase.abcVolume.volumeMl.toFixed(1)} mL` : 'Not calculated',
    margin + contentWidth * 0.52,
    y
  );
  y += 5;
  drawKv('Mass Effect:', sf.massEffectPresent ? 'Present' : 'Absent', margin, y);
  drawKv(
    'Skull Fracture:',
    sf.skullFractureSuspicion ? 'Suspected (Check Bone)' : 'None Seen',
    margin + contentWidth * 0.52,
    y
  );
  y += 5;
  drawKv('Hydrocephalus:', sf.hydrocephalusRisk.slice(0, 32), margin, y);
  drawKv(
    '3-Win Agree:',
    typeof analysis.windowAgreementPct === 'number'
      ? `${analysis.windowAgreementPct.toFixed(0)}%`
      : 'N/A',
    margin + contentWidth * 0.52,
    y
  );
  y += 7;

  // 6. Radiology Impression & Emergency Action Plan
  const impLines = doc.splitTextToSize(analysis.radiologyImpression, contentWidth);
  ensureSpace(16 + impLines.length * 4.2);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(15, 23, 42);
  doc.text('RADIOLOGY IMPRESSION', margin, y);
  y += 2;
  doc.setDrawColor(203, 213, 225);
  doc.line(margin, y, pageWidth - margin, y);
  y += 5;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(30, 41, 59);
  doc.text(impLines, margin, y);
  y += impLines.length * 4.2 + 4;

  if (analysis.recommendedActions.length > 0) {
    ensureSpace(24);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(15, 23, 42);
    doc.text('EMERGENCY TRIAGE ACTION PLAN', margin, y);
    y += 2;
    doc.setDrawColor(203, 213, 225);
    doc.line(margin, y, pageWidth - margin, y);
    y += 5;

    analysis.recommendedActions.forEach((act, idx) => {
      const actLines = doc.splitTextToSize(act, contentWidth - 8);
      ensureSpace(actLines.length * 4 + 2);
      doc.setFont('courier', 'bold');
      doc.setFontSize(8.5);
      doc.setTextColor(14, 116, 144);
      doc.text(`0${idx + 1}.`, margin, y);

      doc.setFont('helvetica', 'normal');
      doc.setTextColor(30, 41, 59);
      doc.text(actLines, margin + 7, y);
      y += actLines.length * 4 + 1.5;
    });
  }

  // 7. Anticoagulation Reversal & Attending Attestation
  if (ctx.anticoagulant && ctx.anticoagulant !== 'none') {
    ensureSpace(22);
    y += 2;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(185, 28, 28);
    doc.text(`COAGULOPATHY REVERSAL ORDER — ${reversal.label.toUpperCase()}`, margin, y);
    y += 2;
    doc.setDrawColor(254, 202, 202);
    doc.line(margin, y, pageWidth - margin, y);
    y += 5;
    reversal.regimen.forEach((step) => {
      const lines = doc.splitTextToSize(`• ${step}`, contentWidth - 4);
      ensureSpace(lines.length * 4 + 1);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.2);
      doc.setTextColor(30, 41, 59);
      doc.text(lines, margin + 2, y);
      y += lines.length * 4 + 1;
    });
  }

  if (ctCase.signOff) {
    ensureSpace(18);
    y += 3;
    doc.setFillColor(241, 245, 249);
    doc.setDrawColor(148, 163, 184);
    doc.roundedRect(margin, y, contentWidth, 14, 1, 1, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(15, 23, 42);
    doc.text(
      `ATTENDING SIGN-OFF: ${ctCase.signOff.status.toUpperCase()} — Final Diagnosis: ${ctCase.signOff.finalSubtype.toUpperCase()}`,
      margin + 3,
      y + 5.5
    );
    doc.setFont('courier', 'normal');
    doc.setFontSize(7.8);
    doc.setTextColor(71, 85, 105);
    doc.text(
      `Signed by ${ctCase.signOff.clinicianName} at ${new Date(
        ctCase.signOff.signedAt
      ).toLocaleString()}`,
      margin + 3,
      y + 10.5
    );
  }

  // Footer Disclaimer on all pages
  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setDrawColor(226, 232, 240);
    doc.line(margin, pageHeight - 13, pageWidth - margin, pageHeight - 13);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.2);
    doc.setTextColor(100, 116, 139);
    doc.text(
      'HemaSTAT Clinical Triage Decision Support · Attending physician sign-off on full volumetric DICOM series required.',
      margin,
      pageHeight - 8.5
    );
    doc.text(`Page ${p} of ${totalPages}`, pageWidth - margin, pageHeight - 8.5, {
      align: 'right',
    });
  }

  const safeAcc = ctCase.accessionNumber.replace(/[^a-zA-Z0-9_-]/g, '_');
  const safePt = ctCase.clinicalContext.patientId.replace(/[^a-zA-Z0-9_-]/g, '_');
  doc.save(`HemaSTAT-Diagnostic-Report-${safeAcc}-${safePt}.pdf`);
}
