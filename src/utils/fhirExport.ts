import type { AnticoagulantType, CTCase } from '../types/ct';

export function getReversalProtocol(anticoagulant?: AnticoagulantType): {
  label: string;
  urgency: string;
  regimen: string[];
} {
  switch (anticoagulant) {
    case 'warfarin':
      return {
        label: 'Warfarin / VKA Coagulopathy',
        urgency: 'STAT Reversal Required (Target INR < 1.4)',
        regimen: [
          'Administer 4-Factor Prothrombin Complex Concentrate (4F-PCC) 25–50 units/kg IV based on INR',
          'Administer Vitamin K 10 mg slow IV infusion over 10–20 min concurrently',
          'Recheck STAT INR 15–30 minutes post-4F-PCC infusion',
        ],
      };
    case 'xa_inhibitor':
      return {
        label: 'Direct Factor Xa Inhibitor (Apixaban / Rivaroxaban)',
        urgency: 'STAT Reversal Required',
        regimen: [
          'Administer Andexanet alfa (per dose/time-since-last-dose protocol) OR 4F-PCC 50 units/kg IV',
          'Hold all antithrombotic agents; obtain STAT anti-Xa level & renal panel',
          'Target SBP 130–140 mmHg in acute parenchymal hemorrhage',
        ],
      };
    case 'dabigatran':
      return {
        label: 'Direct Thrombin Inhibitor (Dabigatran)',
        urgency: 'STAT Reversal Required',
        regimen: [
          'Administer Idarucizumab 5 g IV (two consecutive 2.5 g boluses)',
          'Obtain STAT aPTT, thrombin time, and serum creatinine',
          'Consider hemodialysis if life-threatening bleed with impaired renal clearance',
        ],
      };
    case 'antiplatelet':
      return {
        label: 'Antiplatelet Therapy (Aspirin / Clopidogrel / Ticagrelor)',
        urgency: 'Surgical Consideration',
        regimen: [
          'Discontinue all antiplatelet therapy immediately',
          'Avoid routine platelet transfusion unless emergent craniotomy is planned (PATCH trial guidance)',
          'Consider Desmopressin (DDAVP) 0.4 mcg/kg IV single dose if neurosurgical intervention indicated',
        ],
      };
    case 'none':
    default:
      return {
        label: 'No Active Anticoagulation Reported',
        urgency: 'Standard Coagulation Screen',
        regimen: [
          'Verify baseline PT/INR, aPTT, and platelet count (>100,000/µL before neurosurgery)',
          'Confirm medication reconciliation with patient/family/EMS',
        ],
      };
  }
}

export function buildNeurosurgerySbar(ctCase: CTCase): string {
  const a = ctCase.analysis;
  const ctx = ctCase.clinicalContext;
  const reversal = getReversalProtocol(ctx.anticoagulant);

  const bleedSummary = a
    ? a.anyHemorrhage
      ? `POSITIVE for acute ${a.dominantSubtype.toUpperCase()} hemorrhage (${a.overallProbability.toFixed(
          1
        )}% confidence) in ${a.localization.anatomicalRegion} (${a.localization.hemisphere}).`
      : 'NEGATIVE for acute intracranial hemorrhage.'
    : 'Pending AI triage.';

  const shiftVal =
    typeof ctCase.measuredMidlineShiftMm === 'number'
      ? `${ctCase.measuredMidlineShiftMm.toFixed(1)} mm (caliper measured)`
      : a?.secondaryFindings.midlineShiftPresent
      ? `${a.secondaryFindings.midlineShiftMmEstimate.toFixed(1)} mm (AI estimate)`
      : 'None';

  const volVal = ctCase.abcVolume
    ? `${ctCase.abcVolume.volumeMl.toFixed(1)} mL (ABC/2: ${ctCase.abcVolume.aCm}×${ctCase.abcVolume.bCm}×${(
        ctCase.abcVolume.slicesCount * ctCase.abcVolume.sliceThicknessCm
      ).toFixed(1)} cm)`
    : 'Not measured';

  return [
    `HEMASTAT STAT NEUROSURGERY SBAR HANDOFF`,
    `========================================`,
    `SITUATION:`,
    `- Accession: ${ctCase.accessionNumber} | Patient ID: ${ctx.patientId} (${ctx.age}Y ${ctx.sex})`,
    `- Triage Level: ${a?.triageLevel || 'PENDING'} — ${a?.surgicalUrgencyWindow || ''}`,
    `- CT Finding: ${bleedSummary}`,
    ``,
    `BACKGROUND:`,
    `- GCS: ${ctx.gcs}/15 | Onset: ${ctx.onsetHours || 'Unknown'}`,
    `- Presentation: ${ctx.symptoms}`,
    `- Anticoagulation: ${reversal.label}`,
    ``,
    `ASSESSMENT:`,
    `- Midline Shift: ${shiftVal} | Mass Effect: ${a?.secondaryFindings.massEffectPresent ? 'Yes' : 'No'}`,
    `- Estimated Hematoma Volume (ABC/2): ${volVal}`,
    `- Impression: ${a?.radiologyImpression || 'N/A'}`,
    ctCase.signOff
      ? `- Attending Attestation: ${ctCase.signOff.status.toUpperCase()} by ${ctCase.signOff.clinicianName} (${ctCase.signOff.finalSubtype.toUpperCase()})`
      : `- Attending Attestation: Pending physician sign-off`,
    ``,
    `RECOMMENDATION:`,
    ...(a?.recommendedActions.map((act, i) => `  0${i + 1}. ${act}`) || []),
    ...(ctx.anticoagulant && ctx.anticoagulant !== 'none'
      ? [`  -- Reversal (${reversal.urgency}): ${reversal.regimen[0]}`]
      : []),
  ].join('\n');
}

export function buildFhirDiagnosticReport(ctCase: CTCase): object {
  const a = ctCase.analysis;
  const ctx = ctCase.clinicalContext;

  return {
    resourceType: 'DiagnosticReport',
    id: `hemastat-${ctCase.id}`,
    status: ctCase.signOff ? 'final' : 'preliminary',
    category: [
      {
        coding: [
          {
            system: 'http://terminology.hl7.org/CodeSystem/v2-0074',
            code: 'RAD',
            display: 'Radiology',
          },
        ],
      },
    ],
    code: {
      coding: [
        {
          system: 'http://loinc.org',
          code: '24725-4',
          display: 'CT Head W/O contrast',
        },
      ],
      text: 'Non-Contrast Head CT — Intracranial Hemorrhage Triage',
    },
    subject: {
      identifier: {
        system: 'urn:hemastat:patient-id',
        value: ctx.patientId,
      },
      display: `${ctx.age}Y ${ctx.sex} (GCS ${ctx.gcs}/15)`,
    },
    effectiveDateTime: ctCase.analyzedAt || new Date().toISOString(),
    issued: new Date().toISOString(),
    conclusion: a?.radiologyImpression || 'Pending review',
    conclusionCode: a?.anyHemorrhage
      ? [
          {
            coding: [
              {
                system: 'urn:hemastat:ich-subtype',
                code: a.dominantSubtype,
                display: `Acute ${a.dominantSubtype} hemorrhage`,
              },
            ],
          },
        ]
      : [
          {
            coding: [
              {
                system: 'http://snomed.info/sct',
                code: '260413007',
                display: 'None (no acute intracranial hemorrhage)',
              },
            ],
          },
        ],
    extension: [
      {
        url: 'urn:hemastat:triage-priority',
        valueString: a?.triageLevel || 'PENDING',
      },
      {
        url: 'urn:hemastat:overall-probability',
        valueDecimal: a?.overallProbability ?? 0,
      },
      {
        url: 'urn:hemastat:subtype-scores',
        valueString: JSON.stringify(
          a
            ? {
                epidural: a.subtypes.epidural.probability,
                subdural: a.subtypes.subdural.probability,
                subarachnoid: a.subtypes.subarachnoid.probability,
                intraventricular: a.subtypes.intraventricular.probability,
                intraparenchymal: a.subtypes.intraparenchymal.probability,
              }
            : {}
        ),
      },
      ...(ctCase.abcVolume
        ? [
            {
              url: 'urn:hemastat:abc2-volume-ml',
              valueDecimal: ctCase.abcVolume.volumeMl,
            },
          ]
        : []),
      ...(typeof ctCase.measuredMidlineShiftMm === 'number'
        ? [
            {
              url: 'urn:hemastat:measured-midline-shift-mm',
              valueDecimal: ctCase.measuredMidlineShiftMm,
            },
          ]
        : []),
      ...(ctCase.signOff
        ? [
            {
              url: 'urn:hemastat:attending-signoff',
              valueString: `${ctCase.signOff.status} by ${ctCase.signOff.clinicianName} at ${ctCase.signOff.signedAt}`,
            },
          ]
        : []),
    ],
  };
}
