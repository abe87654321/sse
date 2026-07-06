import * as zlib from 'zlib';
import type { OcrResult } from '@sse/shared';

export function parseOfdXml(buffer: Buffer): Partial<OcrResult> {
  try {
    if (buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
      return { status: 'unverified' };
    }

    const files = extractZipFiles(buffer);
    const invoiceXml = files.find(f => f.name.toLowerCase().includes('invoice'));
    if (!invoiceXml) return { status: 'unverified' };

    const xml = invoiceXml.data.toString('utf-8');
    const getVal = (tag: string) => {
      const m = xml.match(new RegExp(`<${tag}[^>]*>([^<]*)<\\/${tag}>`, 'i'));
      return m ? m[1].trim() : undefined;
    };

    return {
      invoiceNo: getVal('FP_DMHM') || getVal('InvoiceCode'),
      amount: parseFloatOrUndef(getVal('InvoiceAmount') || getVal('JSHJ')),
      totalAmount: parseFloatOrUndef(getVal('JSHJ') || getVal('TotalAmount')),
      invoiceDate: getVal('KPRQ') || getVal('InvoiceDate'),
      sellerName: getVal('XSF_MC') || getVal('SellerName'),
      buyerName: getVal('GMF_MC') || getVal('BuyerName'),
      status: 'verified',
    };
  } catch {
    return { status: 'unverified' };
  }
}

function parseFloatOrUndef(val?: string): number | undefined {
  if (!val) return undefined;
  const n = parseFloat(val);
  return isNaN(n) ? undefined : n;
}

function extractZipFiles(buffer: Buffer): { name: string; data: Buffer }[] {
  const files: { name: string; data: Buffer }[] = [];
  let offset = 0;

  while (offset < buffer.length - 30) {
    const sig = buffer.readUInt32LE(offset);
    if (sig !== 0x04034b50) break;

    const compression = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const fileNameLen = buffer.readUInt16LE(offset + 26);
    const extraLen = buffer.readUInt16LE(offset + 28);
    const name = buffer.slice(offset + 30, offset + 30 + fileNameLen).toString('utf-8');
    const dataStart = offset + 30 + fileNameLen + extraLen;

    let data: Buffer;
    if (compression === 8) {
      data = zlib.inflateRawSync(buffer.slice(dataStart, dataStart + compressedSize));
    } else {
      data = buffer.slice(dataStart, dataStart + compressedSize);
    }

    files.push({ name, data });
    offset = dataStart + compressedSize;
  }

  return files;
}
