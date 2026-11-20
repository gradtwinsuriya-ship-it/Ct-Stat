import type { DicomMetadata } from '../types/ct';

export interface ParsedDicomResult {
  dataUrl: string;
  metadata: DicomMetadata;
}

function readAscii(view: DataView, offset: number, length: number): string {
  let out = '';
  const end = Math.min(offset + length, view.byteLength);
  for (let i = offset; i < end; i++) {
    const code = view.getUint8(i);
    if (code === 0) break;
    out += String.fromCharCode(code);
  }
  return out.trim();
}

const EXPLICIT_LONG_VRS = new Set([
  'OB',
  'OD',
  'OF',
  'OL',
  'OV',
  'OW',
  'SQ',
  'SV',
  'UC',
  'UN',
  'UR',
  'UT',
  'UV',
]);

/**
 * Uncompressed DICOM Part 10 (.dcm) parser with automatic HIPAA PHI tag detection/stripping.
 * Extracts Rows, Columns, PixelSpacing, SliceThickness, InstanceNumber, SliceLocation,
 * WindowCenter/Width, RescaleSlope/Intercept, and raw Hounsfield Unit pixel buffer.
 */
export function parseDicomBuffer(buffer: ArrayBuffer): ParsedDicomResult {
  if (buffer.byteLength < 136) {
    throw new Error('File is too small to be a valid DICOM dataset.');
  }

  const view = new DataView(buffer);
  const magic = readAscii(view, 128, 4);
  if (magic !== 'DICM') {
    throw new Error('Missing DICM header. Only standard DICOM Part 10 (.dcm) files are supported.');
  }

  let offset = 132;
  let rows = 0;
  let columns = 0;
  let bitsAllocated = 16;
  let pixelRepresentation = 0;
  let rescaleSlope = 1;
  let rescaleIntercept = 0;
  let windowCenter: number | undefined;
  let windowWidth: number | undefined;
  let pixelSpacingMm: [number, number] | undefined;
  let sliceThicknessMm: number | undefined;
  let instanceNumber: number | undefined;
  let sliceLocationMm: number | undefined;
  let studyDescription: string | undefined;
  let transferSyntax = '';
  let pixelDataOffset = -1;
  let pixelDataLength = 0;

  const strippedPhiTags: string[] = [];

  while (offset + 8 <= view.byteLength) {
    const group = view.getUint16(offset, true);
    const element = view.getUint16(offset + 2, true);
    offset += 4;

    if (group === 0xfffe) {
      const itemLength = view.getUint32(offset, true);
      offset += 4;
      if (itemLength !== 0xffffffff && itemLength > 0) {
        offset += itemLength;
      }
      continue;
    }

    const vrCandidate = readAscii(view, offset, 2);
    const isAsciiVr =
      vrCandidate.length === 2 &&
      vrCandidate.charCodeAt(0) >= 65 &&
      vrCandidate.charCodeAt(0) <= 90 &&
      vrCandidate.charCodeAt(1) >= 65 &&
      vrCandidate.charCodeAt(1) <= 90;

    let vr = '';
    let valueLength = 0;

    if (isAsciiVr) {
      vr = vrCandidate;
      offset += 2;
      if (EXPLICIT_LONG_VRS.has(vr)) {
        offset += 2;
        valueLength = view.getUint32(offset, true);
        offset += 4;
      } else {
        valueLength = view.getUint16(offset, true);
        offset += 2;
      }
    } else {
      valueLength = view.getUint32(offset, true);
      offset += 4;
    }

    if (group === 0x7fe0 && element === 0x0010) {
      if (valueLength === 0xffffffff) {
        throw new Error(
          'Encapsulated/compressed DICOM pixel data (e.g. JPEG2000/RLE) detected. Export as uncompressed DICOM or PNG/JPEG.'
        );
      }
      pixelDataOffset = offset;
      pixelDataLength = valueLength;
      break;
    }

    if (valueLength === 0xffffffff) {
      continue;
    }

    if (offset + valueLength > view.byteLength) {
      break;
    }

    // Track and strip HIPAA PHI tags rather than retaining raw patient identifiers
    if (group === 0x0010 && element === 0x0010 && valueLength > 0) {
      strippedPhiTags.push('PatientName (0010,0010)');
    } else if (group === 0x0010 && element === 0x0020 && valueLength > 0) {
      strippedPhiTags.push('PatientID (0010,0020)');
    } else if (group === 0x0010 && element === 0x0030 && valueLength > 0) {
      strippedPhiTags.push('PatientBirthDate (0010,0030)');
    } else if (group === 0x0008 && element === 0x0080 && valueLength > 0) {
      strippedPhiTags.push('InstitutionName (0008,0080)');
    } else if (group === 0x0008 && element === 0x0090 && valueLength > 0) {
      strippedPhiTags.push('ReferringPhysician (0008,0090)');
    } else if (group === 0x0002 && element === 0x0010) {
      transferSyntax = readAscii(view, offset, valueLength);
    } else if (group === 0x0008 && element === 0x1030) {
      studyDescription = readAscii(view, offset, valueLength);
    } else if (group === 0x0018 && element === 0x0050) {
      const val = parseFloat(readAscii(view, offset, valueLength));
      if (!Number.isNaN(val)) sliceThicknessMm = val;
    } else if (group === 0x0020 && element === 0x0013) {
      const val = parseInt(readAscii(view, offset, valueLength), 10);
      if (!Number.isNaN(val)) instanceNumber = val;
    } else if (group === 0x0020 && element === 0x1041) {
      const val = parseFloat(readAscii(view, offset, valueLength));
      if (!Number.isNaN(val)) sliceLocationMm = val;
    } else if (group === 0x0028 && element === 0x0010 && valueLength >= 2) {
      rows = view.getUint16(offset, true);
    } else if (group === 0x0028 && element === 0x0011 && valueLength >= 2) {
      columns = view.getUint16(offset, true);
    } else if (group === 0x0028 && element === 0x0030) {
      const parts = readAscii(view, offset, valueLength).split('\\').map(parseFloat);
      if (parts.length >= 2 && !Number.isNaN(parts[0]) && !Number.isNaN(parts[1])) {
        pixelSpacingMm = [parts[0], parts[1]];
      }
    } else if (group === 0x0028 && element === 0x0100 && valueLength >= 2) {
      bitsAllocated = view.getUint16(offset, true);
    } else if (group === 0x0028 && element === 0x0103 && valueLength >= 2) {
      pixelRepresentation = view.getUint16(offset, true);
    } else if (group === 0x0028 && element === 0x1050) {
      const raw = readAscii(view, offset, valueLength).split('\\')[0];
      const num = parseFloat(raw);
      if (!Number.isNaN(num)) windowCenter = num;
    } else if (group === 0x0028 && element === 0x1051) {
      const raw = readAscii(view, offset, valueLength).split('\\')[0];
      const num = parseFloat(raw);
      if (!Number.isNaN(num)) windowWidth = num;
    } else if (group === 0x0028 && element === 0x1052) {
      const num = parseFloat(readAscii(view, offset, valueLength));
      if (!Number.isNaN(num)) rescaleIntercept = num;
    } else if (group === 0x0028 && element === 0x1053) {
      const num = parseFloat(readAscii(view, offset, valueLength));
      if (!Number.isNaN(num)) rescaleSlope = num;
    }

    offset += valueLength;
  }

  if (
    transferSyntax &&
    transferSyntax !== '1.2.840.10008.1.2' &&
    transferSyntax !== '1.2.840.10008.1.2.1'
  ) {
    throw new Error(
      `Compressed DICOM transfer syntax (${transferSyntax}) is not supported directly in-browser. Please export uncompressed DICOM or PNG/JPEG.`
    );
  }

  if (!rows || !columns || pixelDataOffset < 0) {
    throw new Error('Could not locate uncompressed CT pixel matrix in this DICOM file.');
  }

  const totalPixels = rows * columns;
  const huBuffer = new Float32Array(totalPixels);

  const wc = windowCenter ?? 40;
  const ww = windowWidth ?? 80;
  const minVal = wc - ww / 2;
  const maxVal = wc + ww / 2;

  const canvas = document.createElement('canvas');
  canvas.width = columns;
  canvas.height = rows;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Unable to initialize canvas context for DICOM rendering.');
  }
  const imgData = ctx.createImageData(columns, rows);

  for (let i = 0; i < totalPixels; i++) {
    let rawPixel = 0;
    if (bitsAllocated === 16) {
      const bytePos = pixelDataOffset + i * 2;
      if (bytePos + 2 <= pixelDataOffset + pixelDataLength && bytePos + 2 <= view.byteLength) {
        rawPixel = pixelRepresentation === 1 ? view.getInt16(bytePos, true) : view.getUint16(bytePos, true);
      }
    } else {
      const bytePos = pixelDataOffset + i;
      if (bytePos + 1 <= pixelDataOffset + pixelDataLength && bytePos + 1 <= view.byteLength) {
        rawPixel = view.getUint8(bytePos);
      }
    }

    const hu = rawPixel * rescaleSlope + rescaleIntercept;
    huBuffer[i] = hu;

    let norm = ((hu - minVal) / (maxVal - minVal)) * 255;
    if (norm < 0) norm = 0;
    if (norm > 255) norm = 255;
    const byte = Math.round(norm);

    const idx = i * 4;
    imgData.data[idx] = byte;
    imgData.data[idx + 1] = byte;
    imgData.data[idx + 2] = byte;
    imgData.data[idx + 3] = 255;
  }

  ctx.putImageData(imgData, 0, 0);

  return {
    dataUrl: canvas.toDataURL('image/png'),
    metadata: {
      rows,
      columns,
      windowCenter: wc,
      windowWidth: ww,
      pixelSpacingMm,
      sliceThicknessMm,
      instanceNumber,
      sliceLocationMm,
      patientId: strippedPhiTags.length > 0 ? 'ANON-DICOM' : undefined,
      studyDescription,
      strippedPhiTags,
      huBuffer,
    },
  };
}
