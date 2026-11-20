import express from 'express';
import type { Request, Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, Type, ThinkingLevel } from '@google/genai';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    },
  },
});

const SYSTEM_INSTRUCTION = `You are HemaSTAT, an emergency neuroradiology CT triage engine calibrated across multi-institutional head CT benchmarks (RSNA/ASNR 25,272 exams, CQ500 491 exams, PhysioNet TBI 82 exams).

You may receive either a single CT slice or a synchronized 3-window CT stack:
- Window 1 (Brain W80/L40): gray-white differentiation, parenchymal hematoma, cisternal/ventricular blood.
- Window 2 (Subdural W200/L75): separates thin extra-axial subdural/epidural hemorrhage from the inner skull table.
- Window 3 (Bone W2500/L480): identifies skull fractures and physiologic calcifications (>150 HU) vs. acute blood (55-85 HU).

Follow this strict clinical verification protocol:
1. Modality Validity: Confirm the image is a recognizable head CT scan (set isValidHeadCT = false for non-medical photos, MRI, chest X-ray, or non-diagnostic inputs).
2. Artifact & Calcification Exclusion: Cross-check bright foci across Brain, Subdural, and Bone windows. Do NOT confuse symmetric choroid plexus glomus calcification, pineal calcification, falx calcification, or posterior fossa beam hardening with acute hemorrhage.
3. 5-Subtype Multi-Label Classification (probabilities 0-100):
   - epidural (EDH): Extra-axial biconvex/lentiform hyperdensity bounded by cranial sutures; arterial (middle meningeal) emergency.
   - subdural (SDH): Extra-axial crescentic/concave hyperdensity along convexity or tentorium crossing suture lines; best separated from skull on Subdural W200/L75.
   - subarachnoid (SAH): Hyperdensity filling cortical sulci, Sylvian fissures, or suprasellar/basal cisterns.
   - intraventricular (IVH): Hyperdense blood casting or layering within lateral, third, or fourth ventricles.
   - intraparenchymal (IPH): Focal hyperdense hematoma inside brain parenchyma (lobar, basal ganglia, thalamus, brainstem, cerebellum) typically with hypodense perilesional edema.
4. Anatomical Localization (radiological convention: viewer left = Patient Right, viewer right = Patient Left): hemisphere, anatomicalRegion, and lesion center (xPercent 0-100, yPercent 0-100, radiusPercent 5-35; set radiusPercent = 0 if negative).
5. Secondary Surgical Indicators: midlineShiftPresent, midlineShiftMmEstimate, massEffectPresent, hydrocephalusRisk, skullFractureSuspicion.
6. Triage Priority: STAT_SURGICAL, URGENT_NEURO, PRIORITY_REVIEW, or ROUTINE_NEGATIVE.
7. Report windowAgreementPct (0-100 consistency across Brain/Subdural/Bone windows) and differentialCheck (1 concise sentence confirming how competing subtypes & physiologic calcifications/artifacts were ruled out). Keep radiologyImpression under 65 words and recommendedActions to 3-4 concrete steps.`;

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    isValidHeadCT: {
      type: Type.BOOLEAN,
      description: 'True only if the image is a recognizable head CT scan.',
    },
    imageQualityNote: {
      type: Type.STRING,
      description: 'Brief note on slice level, windowing adequacy, or why image is not a valid head CT.',
    },
    anyHemorrhage: {
      type: Type.BOOLEAN,
      description: 'True if any acute intracranial hemorrhage is detected.',
    },
    overallProbability: {
      type: Type.NUMBER,
      description: 'Overall probability (0-100) that acute intracranial hemorrhage is present.',
    },
    triageLevel: {
      type: Type.STRING,
      description: 'One of: STAT_SURGICAL, URGENT_NEURO, PRIORITY_REVIEW, ROUTINE_NEGATIVE.',
    },
    surgicalUrgencyWindow: {
      type: Type.STRING,
      description: 'Clinical action window, e.g. Immediate (< 15 min) Neurosurgery STAT or Routine Negative.',
    },
    dominantSubtype: {
      type: Type.STRING,
      description: 'One of: epidural, subdural, subarachnoid, intraventricular, intraparenchymal, none.',
    },
    subtypes: {
      type: Type.OBJECT,
      properties: {
        epidural: {
          type: Type.OBJECT,
          properties: {
            detected: { type: Type.BOOLEAN },
            probability: { type: Type.NUMBER },
            rationale: { type: Type.STRING },
          },
          required: ['detected', 'probability', 'rationale'],
        },
        subdural: {
          type: Type.OBJECT,
          properties: {
            detected: { type: Type.BOOLEAN },
            probability: { type: Type.NUMBER },
            rationale: { type: Type.STRING },
          },
          required: ['detected', 'probability', 'rationale'],
        },
        subarachnoid: {
          type: Type.OBJECT,
          properties: {
            detected: { type: Type.BOOLEAN },
            probability: { type: Type.NUMBER },
            rationale: { type: Type.STRING },
          },
          required: ['detected', 'probability', 'rationale'],
        },
        intraventricular: {
          type: Type.OBJECT,
          properties: {
            detected: { type: Type.BOOLEAN },
            probability: { type: Type.NUMBER },
            rationale: { type: Type.STRING },
          },
          required: ['detected', 'probability', 'rationale'],
        },
        intraparenchymal: {
          type: Type.OBJECT,
          properties: {
            detected: { type: Type.BOOLEAN },
            probability: { type: Type.NUMBER },
            rationale: { type: Type.STRING },
          },
          required: ['detected', 'probability', 'rationale'],
        },
      },
      required: ['epidural', 'subdural', 'subarachnoid', 'intraventricular', 'intraparenchymal'],
    },
    localization: {
      type: Type.OBJECT,
      properties: {
        hemisphere: {
          type: Type.STRING,
          description: 'Patient Right, Patient Left, Bilateral, Midline/Cisternal, or None.',
        },
        anatomicalRegion: {
          type: Type.STRING,
          description: 'Specific region e.g. Right Temporoparietal Epidural Space, Basal Cisterns, Lateral Ventricles.',
        },
        xPercent: { type: Type.NUMBER },
        yPercent: { type: Type.NUMBER },
        radiusPercent: { type: Type.NUMBER },
      },
      required: ['hemisphere', 'anatomicalRegion', 'xPercent', 'yPercent', 'radiusPercent'],
    },
    secondaryFindings: {
      type: Type.OBJECT,
      properties: {
        midlineShiftPresent: { type: Type.BOOLEAN },
        midlineShiftMmEstimate: { type: Type.NUMBER },
        massEffectPresent: { type: Type.BOOLEAN },
        hydrocephalusRisk: { type: Type.STRING },
        skullFractureSuspicion: { type: Type.BOOLEAN },
      },
      required: [
        'midlineShiftPresent',
        'midlineShiftMmEstimate',
        'massEffectPresent',
        'hydrocephalusRisk',
        'skullFractureSuspicion',
      ],
    },
    radiologyImpression: {
      type: Type.STRING,
      description: 'Concise structured neuroradiology impression.',
    },
    recommendedActions: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: '3 to 4 specific emergency triage actions.',
    },
    windowAgreementPct: {
      type: Type.NUMBER,
      description: 'Cross-window consistency percentage (0-100) across Brain, Subdural, and Bone views.',
    },
    differentialCheck: {
      type: Type.STRING,
      description: '1 concise sentence verifying physiologic calcifications/artifacts and competing subtypes were excluded.',
    },
  },
  required: [
    'isValidHeadCT',
    'imageQualityNote',
    'anyHemorrhage',
    'overallProbability',
    'triageLevel',
    'surgicalUrgencyWindow',
    'dominantSubtype',
    'subtypes',
    'localization',
    'secondaryFindings',
    'radiologyImpression',
    'recommendedActions',
    'windowAgreementPct',
    'differentialCheck',
  ],
};

interface AnalyzeBody {
  imageBase64?: string;
  mimeType?: string;
  multiWindow?: {
    brainBase64: string;
    subduralBase64: string;
    boneBase64: string;
    mimeType?: string;
  };
  clinicalContext?: {
    patientId?: string;
    age?: string;
    sex?: string;
    gcs?: number;
    symptoms?: string;
    onsetHours?: string;
  };
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '25mb' }));

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      service: 'HemaSTAT Inference Gateway',
      geminiConfigured: Boolean(process.env.GEMINI_API_KEY),
    });
  });

  app.post('/api/analyze-ct', async (req: Request, res: Response) => {
    const startTime = Date.now();
    try {
      if (!process.env.GEMINI_API_KEY) {
        return res.status(503).json({
          error: 'GEMINI_API_KEY is not configured on the server. Add it in Settings > Secrets.',
        });
      }

      const body = req.body as AnalyzeBody;
      if (!body.imageBase64 && !body.multiWindow?.brainBase64) {
        return res.status(400).json({ error: 'Missing imageBase64 or multiWindow payload.' });
      }

      const ctx = body.clinicalContext || {};
      const contextLines = [
        ctx.patientId ? `Study/Patient ID: ${ctx.patientId}` : null,
        ctx.age || ctx.sex ? `Demographics: ${ctx.age || 'Unknown'}y ${ctx.sex || ''}`.trim() : null,
        typeof ctx.gcs === 'number' ? `Glasgow Coma Scale (GCS): ${ctx.gcs}/15` : null,
        ctx.onsetHours ? `Time from symptom onset/trauma: ${ctx.onsetHours}` : null,
        ctx.symptoms ? `Clinical presentation: ${ctx.symptoms}` : null,
      ]
        .filter(Boolean)
        .join('\n');

      const parts: Array<{ inlineData: { mimeType: string; data: string } } | { text: string }> = [];

      if (body.multiWindow?.brainBase64 && body.multiWindow?.subduralBase64 && body.multiWindow?.boneBase64) {
        const mwMime = body.multiWindow.mimeType || 'image/jpeg';
        parts.push(
          { text: 'Window 1 — Brain Parenchymal Window (W80/L40):' },
          {
            inlineData: {
              mimeType: mwMime,
              data: body.multiWindow.brainBase64.replace(/^data:[^;]+;base64,/, ''),
            },
          },
          { text: 'Window 2 — Subdural / Extra-Axial Window (W200/L75):' },
          {
            inlineData: {
              mimeType: mwMime,
              data: body.multiWindow.subduralBase64.replace(/^data:[^;]+;base64,/, ''),
            },
          },
          { text: 'Window 3 — Bone / Calcification Exclusion Window (W2500/L480):' },
          {
            inlineData: {
              mimeType: mwMime,
              data: body.multiWindow.boneBase64.replace(/^data:[^;]+;base64,/, ''),
            },
          }
        );
      } else if (body.imageBase64) {
        const cleanBase64 = body.imageBase64.replace(/^data:[^;]+;base64,/, '');
        const mimeType = body.mimeType || 'image/jpeg';
        parts.push({
          inlineData: {
            mimeType,
            data: cleanBase64,
          },
        });
      }

      const promptText = contextLines
        ? `Perform 3-window differential head CT evaluation for acute intracranial hemorrhage across all 5 subtypes (Epidural, Subdural, Subarachnoid, Intraventricular, Intraparenchymal).\n\nClinical Context:\n${contextLines}`
        : 'Perform 3-window differential head CT evaluation for acute intracranial hemorrhage across all 5 subtypes (Epidural, Subdural, Subarachnoid, Intraventricular, Intraparenchymal).';

      parts.push({ text: promptText });

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: { parts },
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
          responseMimeType: 'application/json',
          responseSchema: RESPONSE_SCHEMA,
          thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH },
        },
      });

      const rawText = (response.text ?? '').trim();
      if (!rawText) {
        return res.status(502).json({ error: 'Model returned an empty response.' });
      }

      const parsed = JSON.parse(rawText);
      const inferenceMs = Date.now() - startTime;

      return res.json({
        analysis: parsed,
        inferenceMs,
        analyzedAt: new Date().toISOString(),
        modelId: 'gemini-4-hydrogen',
      });
    } catch (err: unknown) {
      const errorObj = err as { status?: number; message?: string };
      const status = typeof errorObj?.status === 'number' ? errorObj.status : 500;
      const message = errorObj?.message || 'Failed to analyze CT scan.';
      console.error('CT Analysis Error:', message);
      return res.status(status >= 400 && status < 600 ? status : 500).json({
        error: message,
      });
    }
  });

  app.post('/api/clinical-consult', async (req: Request, res: Response) => {
    try {
      if (!process.env.GEMINI_API_KEY) {
        return res.status(503).json({
          error: 'GEMINI_API_KEY is not configured on the server.',
        });
      }

      const body = req.body as {
        question?: string;
        imageBase64?: string;
        mimeType?: string;
        caseSummary?: string;
        history?: Array<{ role: 'user' | 'assistant'; content: string }>;
      };

      if (!body.question?.trim()) {
        return res.status(400).json({ error: 'Missing clinical question.' });
      }

      const parts: Array<{ inlineData: { mimeType: string; data: string } } | { text: string }> = [];
      if (body.imageBase64) {
        parts.push({
          inlineData: {
            mimeType: body.mimeType || 'image/jpeg',
            data: body.imageBase64.replace(/^data:[^;]+;base64,/, ''),
          },
        });
      }

      const historyText = (body.history || [])
        .slice(-6)
        .map((m) => `${m.role === 'user' ? 'Clinician' : 'Neuroradiology Consult'}: ${m.content}`)
        .join('\n');

      parts.push({
        text: [
          body.caseSummary ? `Active Case Context:\n${body.caseSummary}` : '',
          historyText ? `Prior Consultation:\n${historyText}` : '',
          `Clinician Question: ${body.question.trim()}`,
        ]
          .filter(Boolean)
          .join('\n\n'),
      });

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: { parts },
        config: {
          systemInstruction:
            'You are a concise, evidence-based emergency neuroradiology & neurosurgery clinical consult assistant inside HemaSTAT. Ground every answer directly in the provided head CT slice, Brain Trauma Foundation / AHA ICH guidelines, ABC/2 volume, midline shift, and anticoagulation status. Keep responses crisp, structured, and under 160 words. Always note that final operative decisions rest with the attending neurosurgeon.',
          thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM },
        },
      });

      const answer = (response.text ?? '').trim();
      if (!answer) {
        return res.status(502).json({ error: 'Consult model returned an empty response.' });
      }

      return res.json({ answer });
    } catch (err: unknown) {
      const errorObj = err as { status?: number; message?: string };
      const status = typeof errorObj?.status === 'number' ? errorObj.status : 500;
      const message = errorObj?.message || 'Clinical consultation failed.';
      return res.status(status >= 400 && status < 600 ? status : 500).json({ error: message });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false, ws: false },
      appType: 'spa',
    });

    // Vite 8 injects /@vite/client which still attempts a WebSocket connection even when hmr/ws are false.
    // Serve a lightweight no-WebSocket client shim that preserves CSS injection and module stubs without WS errors.
    app.get('/@vite/client', (_req: Request, res: Response) => {
      res.type('application/javascript').send(`
const sheetsMap = new Map();
export function updateStyle(id, content) {
  if (typeof document === 'undefined') return;
  let style = sheetsMap.get(id);
  if (!style) {
    style = document.createElement('style');
    style.setAttribute('type', 'text/css');
    style.setAttribute('data-vite-dev-id', id);
    style.textContent = content;
    document.head.appendChild(style);
    sheetsMap.set(id, style);
  } else {
    style.textContent = content;
  }
}
export function removeStyle(id) {
  const style = sheetsMap.get(id);
  if (style && style.parentNode) {
    style.parentNode.removeChild(style);
    sheetsMap.delete(id);
  }
}
export function createHotContext() {
  return {
    data: {},
    accept() {},
    dispose() {},
    prune() {},
    invalidate() {},
    decline() {},
    on() {},
    off() {},
    send() {},
  };
}
export function injectQuery(url) {
  return url;
}
export class ErrorOverlay {}
`);
    });

    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const PORT = 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`HemaSTAT workstation listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
