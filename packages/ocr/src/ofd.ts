import * as zlib from 'zlib';
import type { OcrResult } from '@sse/shared';

const ZIP_MAGIC = 0x04034b50;
const ZIP_CD_MAGIC = 0x02014b50;

interface ZipEntry {
  name: string;
  compression: number;
  compressedSize: number;
  uncompressedSize: number;
  offset: number;
}

function readUint32LE(buf: Buffer, offset: number): number {
  return buf.readUInt32LE(offset);
}

function readUint16LE(buf: Buffer, offset: number): number {
  return buf.readUInt16LE(offset);
}

function findCentralDirectory(buf: Buffer): number {
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      return i;
    }
  }
  return -1;
}

function parseEntries(buf: Buffer): ZipEntry[] {
  const cdOffset = findCentralDirectory(buf);
  if (cdOffset < 0) return [];

  const totalEntries = readUint16LE(buf, cdOffset + 10);
  let cursor = cdOffset + 22;

  const cdStart = readUint32LE(buf, cdOffset + 16);
  cursor = cdStart;

  const entries: ZipEntry[] = [];

  for (let i = 0; i < totalEntries; i++) {
    if (readUint32LE(buf, cursor) !== ZIP_CD_MAGIC) break;

    const compression = readUint16LE(buf, cursor + 10);
    const compressedSize = readUint32LE(buf, cursor + 20);
    const uncompressedSize = readUint32LE(buf, cursor + 24);
    const nameLen = readUint16LE(buf, cursor + 28);
    const extraLen = readUint16LE(buf, cursor + 30);
    const commentLen = readUint16LE(buf, cursor + 32);
    const localOffset = readUint32LE(buf, cursor + 42);

    const name = buf.toString('utf-8', cursor + 46, cursor + 46 + nameLen);

    if (!name.endsWith('/')) {
      entries.push({ name, compression, compressedSize, uncompressedSize, offset: localOffset });
    }

    cursor += 46 + nameLen + extraLen + commentLen;
  }

  return entries;
}

function extractEntry(buf: Buffer, entry: ZipEntry): Buffer | null {
  let cursor = entry.offset;
  if (readUint32LE(buf, cursor) !== ZIP_MAGIC) return null;

  const nameLen = readUint16LE(buf, cursor + 26);
  const extraLen = readUint16LE(buf, cursor + 28);
  const dataOffset = cursor + 30 + nameLen + extraLen;

  try {
    if (entry.compression === 0) {
      return buf.subarray(dataOffset, dataOffset + entry.compressedSize);
    } else if (entry.compression === 8) {
      const compressed = buf.subarray(dataOffset, dataOffset + entry.compressedSize);
      return zlib.inflateRawSync(compressed);
    }
  } catch {
    return null;
  }

  return null;
}

function extractXmlValue(xml: string, tag: string): string | undefined {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'mi');
  const m = xml.match(re);
  if (m && m[1]) {
    return m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/, '$1').trim();
  }
  return undefined;
}

function parseOfdXml(xml: string): Partial<OcrResult> {
  const result: Partial<OcrResult> = {};

  const invoiceNo =
    extractXmlValue(xml, 'ofd:InvoiceCode') ||
    extractXmlValue(xml, 'fp:InvoiceCode') ||
    extractXmlValue(xml, 'InvoiceCode');
  if (!invoiceNo) {
    return result;
  }

  result.invoiceNo = invoiceNo;

  const totalAmount =
    extractXmlValue(xml, 'ofd:TotalAmount') ||
    extractXmlValue(xml, 'fp:TotalAmount') ||
    extractXmlValue(xml, 'TotalAmount') ||
    extractXmlValue(xml, 'ofd:AmountInWords') ||
    extractXmlValue(xml, 'AmountInWords');
  if (totalAmount) {
    result.totalAmount = parseFloat(totalAmount) || undefined;
  }

  const taxAmount =
    extractXmlValue(xml, 'ofd:TaxAmount') ||
    extractXmlValue(xml, 'fp:TaxAmount') ||
    extractXmlValue(xml, 'TaxAmount');
  if (taxAmount) {
    result.taxAmount = parseFloat(taxAmount) || undefined;
  }

  const amount =
    extractXmlValue(xml, 'ofd:Amount') ||
    extractXmlValue(xml, 'fp:Amount') ||
    extractXmlValue(xml, 'Amount');
  if (amount) {
    result.amount = parseFloat(amount) || undefined;
  }

  const invoiceDate =
    extractXmlValue(xml, 'ofd:InvoiceDate') ||
    extractXmlValue(xml, 'fp:InvoiceDate') ||
    extractXmlValue(xml, 'InvoiceDate');
  if (invoiceDate) {
    const d = new Date(invoiceDate);
    if (!isNaN(d.getTime())) {
      result.invoiceDate = d;
    }
  }

  const sellerName =
    extractXmlValue(xml, 'ofd:SellerName') ||
    extractXmlValue(xml, 'fp:SellerName') ||
    extractXmlValue(xml, 'SellerName');
  if (sellerName) {
    result.sellerName = sellerName;
  }

  const buyerName =
    extractXmlValue(xml, 'ofd:BuyerName') ||
    extractXmlValue(xml, 'fp:BuyerName') ||
    extractXmlValue(xml, 'BuyerName');
  if (buyerName) {
    result.buyerName = buyerName;
  }

  return result;
}

export async function parseOfd(buffer: Buffer): Promise<OcrResult> {
  if (buffer.length < 4 || readUint32LE(buffer, 0) !== ZIP_MAGIC) {
    return { status: 'unverified' };
  }

  const entries = parseEntries(buffer);
  if (entries.length === 0) {
    return { status: 'unverified' };
  }

  const xmlEntries = entries.filter(
    (e) => e.name.endsWith('.xml') && !e.name.startsWith('__MACOSX'),
  );

  let bestResult: Partial<OcrResult> = {};

  for (const entry of xmlEntries) {
    const data = extractEntry(buffer, entry);
    if (!data) continue;

    const xml = data.toString('utf-8');
    const parsed = parseOfdXml(xml);
    if (parsed.invoiceNo) {
      bestResult = parsed;
      break;
    }
  }

  if (bestResult.invoiceNo) {
    return { ...bestResult, status: 'verified' } as OcrResult;
  }

  return { status: 'unverified' };
}
