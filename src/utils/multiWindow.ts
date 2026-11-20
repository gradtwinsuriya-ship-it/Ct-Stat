import type { DicomMetadata } from '../types/ct';

export interface MultiWindowPayloads {
  brainBase64: string;
  subduralBase64: string;
  boneBase64: string;
  mimeType: string;
}

function mapPixelWindow(
  rawLum: number,
  width: number,
  level: number
): number {
  if (rawLum < 8) return 0;
  const contrastGain = Math.min(2.8, Math.max(0.28, 80 / Math.max(20, width)));
  const levelShift = (40 - level) * 0.45;
  const mapped = (rawLum - 105 + levelShift) * contrastGain + 105;
  return Math.max(0, Math.min(255, Math.round(mapped)));
}

function renderHuBufferWindow(
  huBuffer: Float32Array,
  rows: number,
  cols: number,
  width: number,
  level: number
): string {
  const canvas = document.createElement('canvas');
  canvas.width = cols;
  canvas.height = rows;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');

  const imgData = ctx.createImageData(cols, rows);
  const minHu = level - width / 2;
  const range = Math.max(1, width);

  for (let i = 0; i < huBuffer.length; i++) {
    let norm = ((huBuffer[i] - minHu) / range) * 255;
    if (norm < 0) norm = 0;
    if (norm > 255) norm = 255;
    const b = Math.round(norm);
    const idx = i * 4;
    imgData.data[idx] = b;
    imgData.data[idx + 1] = b;
    imgData.data[idx + 2] = b;
    imgData.data[idx + 3] = 255;
  }
  ctx.putImageData(imgData, 0, 0);
  return canvas.toDataURL('image/jpeg', 0.92).split(',')[1] || '';
}

/**
 * Generates a 3-channel radiological window stack (Brain W80/L40, Subdural W200/L75, Bone W2500/L480)
 * matching clinical multi-window neuroradiology & RSNA ensemble pipelines.
 */
export async function buildMultiWindowPayloads(
  imageUrl: string,
  dicomMeta?: DicomMetadata
): Promise<MultiWindowPayloads> {
  if (dicomMeta?.huBuffer && dicomMeta.rows && dicomMeta.columns) {
    return {
      brainBase64: renderHuBufferWindow(dicomMeta.huBuffer, dicomMeta.rows, dicomMeta.columns, 80, 40),
      subduralBase64: renderHuBufferWindow(dicomMeta.huBuffer, dicomMeta.rows, dicomMeta.columns, 200, 75),
      boneBase64: renderHuBufferWindow(dicomMeta.huBuffer, dicomMeta.rows, dicomMeta.columns, 2500, 480),
      mimeType: 'image/jpeg',
    };
  }

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.crossOrigin = 'anonymous';
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('Failed to load CT slice for multi-window rendering.'));
    el.src = imageUrl;
  });

  const targetSize = Math.min(768, Math.max(512, img.naturalWidth || 512));
  const canvas = document.createElement('canvas');
  canvas.width = targetSize;
  canvas.height = targetSize;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');

  ctx.drawImage(img, 0, 0, targetSize, targetSize);
  const srcData = ctx.getImageData(0, 0, targetSize, targetSize).data;

  const renderStandardWindow = (width: number, level: number): string => {
    const out = ctx.createImageData(targetSize, targetSize);
    for (let i = 0; i < srcData.length; i += 4) {
      const byte = mapPixelWindow(srcData[i], width, level);
      out.data[i] = byte;
      out.data[i + 1] = byte;
      out.data[i + 2] = byte;
      out.data[i + 3] = 255;
    }
    ctx.putImageData(out, 0, 0);
    return canvas.toDataURL('image/jpeg', 0.92).split(',')[1] || '';
  };

  return {
    brainBase64: renderStandardWindow(80, 40),
    subduralBase64: renderStandardWindow(200, 75),
    boneBase64: renderStandardWindow(2500, 480),
    mimeType: 'image/jpeg',
  };
}
