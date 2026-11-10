import { createRequire } from 'module';
import { pathToFileURL } from 'url';

export interface OcrImage {
  buffer: Buffer;
  mimeType: string;
}

export interface TrimBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

const PDF_SIGNATURE = '%PDF-';
const WHITE_THRESHOLD = 245;
const TRIM_MARGIN = 4;
const RENDER_DPI = 200;

const nodeRequire = createRequire(__filename);

/** 保留真正的动态 import，用于旧版 Node（不支持 require(esm)） */
const dynamicImport = new Function('specifier', 'return import(specifier)') as (
  specifier: string,
) => Promise<any>;

let canvasModule: any;
let pdfjsModule: any;

function loadCanvas(): any {
  if (!canvasModule) {
    canvasModule = nodeRequire('@napi-rs/canvas');
  }
  return canvasModule;
}

async function loadPdfjs(): Promise<any> {
  if (pdfjsModule) return pdfjsModule;

  const entry = nodeRequire.resolve('pdfjs-dist/legacy/build/pdf.mjs');

  // pdfjs-dist 只提供 ESM 构建。Node 22+ 与测试环境里用 require(esm) 加载，
  // 绕开打包器/测试运行器对 .mjs 的拦截。
  try {
    const getBuiltinModule = (process as any).getBuiltinModule;
    if (typeof getBuiltinModule === 'function') {
      pdfjsModule = getBuiltinModule('module').createRequire(__filename)(entry);
      return pdfjsModule;
    }
  } catch {
    /* 落到动态 import */
  }

  pdfjsModule = await dynamicImport(pathToFileURL(entry).href);
  return pdfjsModule;
}

export function isPdfBuffer(buffer: Buffer): boolean {
  if (!buffer || buffer.length < PDF_SIGNATURE.length) return false;
  return buffer.subarray(0, 1024).includes(Buffer.from(PDF_SIGNATURE, 'latin1'));
}

export function isImageBuffer(buffer: Buffer): boolean {
  if (!buffer || buffer.length < 4) return false;
  return (
    (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) ||
    (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47)
  );
}

/** 找出非白像素的包围盒；整页都是白底时返回 null */
export function trimWhiteBorder(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  threshold: number = WHITE_THRESHOLD,
): TrimBox | null {
  let top = height;
  let bottom = -1;
  let left = width;
  let right = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      if (data[offset] < threshold || data[offset + 1] < threshold || data[offset + 2] < threshold) {
        if (y < top) top = y;
        if (y > bottom) bottom = y;
        if (x < left) left = x;
        if (x > right) right = x;
      }
    }
  }

  if (bottom < 0 || right < 0) return null;

  const x = Math.max(0, left - TRIM_MARGIN);
  const y = Math.max(0, top - TRIM_MARGIN);
  return {
    x,
    y,
    width: Math.min(width - x, right - left + 1 + TRIM_MARGIN * 2),
    height: Math.min(height - y, bottom - top + 1 + TRIM_MARGIN * 2),
  };
}

function cropCanvas(source: any, box: TrimBox): any {
  const { createCanvas } = loadCanvas();
  const canvas = createCanvas(box.width, box.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(source, box.x, box.y, box.width, box.height, 0, 0, box.width, box.height);
  return canvas;
}

async function renderPdfFirstPage(buffer: Buffer): Promise<any | null> {
  try {
    const pdfjs = await loadPdfjs();
    const doc = await pdfjs.getDocument({
      data: new Uint8Array(buffer),
      useSystemFonts: true,
      isEvalSupported: false,
    }).promise;
    try {
      const page = await doc.getPage(1);
      const viewport = page.getViewport({ scale: RENDER_DPI / 72 });
      const { createCanvas } = loadCanvas();
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const context = canvas.getContext('2d');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: context, viewport } as any).promise;
      return canvas;
    } finally {
      await doc.destroy();
    }
  } catch {
    return null;
  }
}

async function loadImageCanvas(buffer: Buffer): Promise<any | null> {
  try {
    const { loadImage } = loadCanvas();
    const image = await loadImage(buffer);
    const { createCanvas } = loadCanvas();
    const canvas = createCanvas(image.width, image.height);
    const context = canvas.getContext('2d');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0);
    return canvas;
  } catch {
    return null;
  }
}

function canvasToTrimmedPng(canvas: any): Buffer {
  const context = canvas.getContext('2d');
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  const box = trimWhiteBorder(image.data, canvas.width, canvas.height);
  const cropped = box ? cropCanvas(canvas, box) : canvas;
  return cropped.toBuffer('image/png');
}

/**
 * 把文档转成适合送入 OCR 的图片：
 * PDF 走渲染（扫描件没有文本层时也能被识别），并裁掉页面白边。
 * 无法处理时返回 null，由调用方回退到原始文件。
 */
export async function prepareOcrImage(buffer: Buffer, _fileName?: string): Promise<OcrImage | null> {
  try {
    if (isPdfBuffer(buffer)) {
      const canvas = await renderPdfFirstPage(buffer);
      if (!canvas) return null;
      return { buffer: canvasToTrimmedPng(canvas), mimeType: 'image/png' };
    }

    if (isImageBuffer(buffer)) {
      const canvas = await loadImageCanvas(buffer);
      if (!canvas) return null;
      return { buffer: canvasToTrimmedPng(canvas), mimeType: 'image/png' };
    }

    return null;
  } catch {
    return null;
  }
}

/** PDF 是否自带文本层（电子发票有，扫描件没有） */
export async function hasPdfTextLayer(buffer: Buffer): Promise<boolean> {
  try {
    const pdfjs = await loadPdfjs();
    const doc = await pdfjs.getDocument({
      data: new Uint8Array(buffer),
      useSystemFonts: true,
      isEvalSupported: false,
    }).promise;
    try {
      const page = await doc.getPage(1);
      const content = await page.getTextContent();
      return content.items.some((item: any) => typeof item?.str === 'string' && item.str.trim().length > 0);
    } finally {
      await doc.destroy();
    }
  } catch {
    return false;
  }
}
