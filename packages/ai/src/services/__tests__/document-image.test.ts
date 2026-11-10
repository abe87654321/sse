import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import {
  hasPdfTextLayer,
  isImageBuffer,
  isPdfBuffer,
  prepareOcrImage,
  trimWhiteBorder,
} from '../document-image';
import { buildImageOnlyPdf, makeJpeg } from './fixtures';

const SAMPLE_INVOICE = join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  '..',
  'docs',
  'dzfp_25362000000115126055_深圳市数恒纪元信息技术咨询企业（个人独资）_20251106105357.pdf',
);

function makeBlankCanvas(width: number, height: number) {
  const { createCanvas } = require('@napi-rs/canvas');
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  return { canvas, ctx };
}

describe('buffer type detection', () => {
  it('recognises a PDF by its header', () => {
    expect(isPdfBuffer(Buffer.from('%PDF-1.7\nrest'))).toBe(true);
    expect(isPdfBuffer(Buffer.from('not a pdf'))).toBe(false);
  });

  it('recognises a PDF whose header does not start at offset zero', () => {
    const padded = Buffer.concat([Buffer.alloc(32, 7), Buffer.from('%PDF-1.3\nrest')]);
    expect(isPdfBuffer(padded)).toBe(true);
  });

  it('recognises images by their magic bytes', () => {
    expect(isImageBuffer(Buffer.from([0xff, 0xd8, 0xff, 0x00]))).toBe(true);
    expect(isImageBuffer(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true);
    expect(isImageBuffer(Buffer.from('%PDF-1.7'))).toBe(false);
  });
});

describe('trimWhiteBorder', () => {
  it('returns null when everything is white', () => {
    const data = new Uint8ClampedArray(4 * 4 * 4).fill(255);
    expect(trimWhiteBorder(data, 4, 4)).toBeNull();
  });

  it('finds the bounding box of the dark pixels', () => {
    const width = 40;
    const height = 40;
    const data = new Uint8ClampedArray(width * height * 4).fill(255);
    for (let y = 12; y < 25; y += 1) {
      for (let x = 13; x < 27; x += 1) {
        const offset = (y * width + x) * 4;
        data[offset] = 0;
        data[offset + 1] = 0;
        data[offset + 2] = 0;
      }
    }
    // 内容包围盒为 x=13..26 / y=12..24，四周再留 4px 边距
    expect(trimWhiteBorder(data, width, height)).toEqual({ x: 9, y: 8, width: 22, height: 21 });
  });
});

describe('prepareOcrImage', () => {
  it('renders a scan-like PDF and trims the white margins', async () => {
    const jpeg = makeJpeg(200, 200);
    const pdf = buildImageOnlyPdf(jpeg, 200, 200);

    const result = await prepareOcrImage(pdf, 'scan.pdf');

    expect(result).not.toBeNull();
    expect(result!.mimeType).toBe('image/png');
    const { loadImage } = await import('@napi-rs/canvas');
    const rendered = await loadImage(result!.buffer);
    // 整页 200x200pt 在 200dpi 下约 555x555，内容只占左上角，裁剪后应明显更小
    expect(rendered.width).toBeLessThan(400);
    expect(rendered.height).toBeLessThan(300);
  }, 30000);

  it('trims the white margins of a plain image', async () => {
    const { canvas, ctx } = makeBlankCanvas(400, 300);
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, 400, 40);
    const png = canvas.toBuffer('image/png');

    const result = await prepareOcrImage(png, 'wide.png');

    expect(result).not.toBeNull();
    const { loadImage } = await import('@napi-rs/canvas');
    const rendered = await loadImage(result!.buffer);
    expect(rendered.height).toBeLessThan(300);
  }, 30000);

  it('returns null for content it cannot decode', async () => {
    expect(await prepareOcrImage(Buffer.from('not an image'), 'x.txt')).toBeNull();
  });
});

describe('hasPdfTextLayer', () => {
  it('reports no text layer for a scan-like PDF', async () => {
    const jpeg = makeJpeg(200, 200);
    const pdf = buildImageOnlyPdf(jpeg, 200, 200);

    expect(await hasPdfTextLayer(pdf)).toBe(false);
  }, 30000);

  it('reports a text layer for a digital PDF', async () => {
    expect(existsSync(SAMPLE_INVOICE)).toBe(true);

    expect(await hasPdfTextLayer(readFileSync(SAMPLE_INVOICE))).toBe(true);
  }, 30000);
});
