export { OcrParser } from './parser';
export { parsePdf } from './pdf';
export { parseOfd } from './ofd';
export { PaddleOcrAdapter } from './providers/paddle-ocr';
export type { PaddleOcrConfig } from './providers/paddle-ocr';

export async function parseOcr(base64: string, format: string): Promise<string | null> {
  try {
    const buffer = Buffer.from(base64, "base64");
    if (format === "pdf") {
      const result = await (await import("./pdf.js")).parsePdf(buffer);
      return result.status !== "unverified" ? JSON.stringify(result) : null;
    }
    if (format === "image" || format === "png" || format === "jpg" || format === "jpeg") {
      try {
        const { PaddleOcrAdapter } = await import("./providers/paddle-ocr.js");
        const adapter = new PaddleOcrAdapter({ apiUrl: process.env.PADDLE_OCR_URL || "http://localhost:8866" });
        const result = await adapter.recognize(buffer);
        return JSON.stringify(result);
      } catch {
        return null;
      }
    }
    return null;
  } catch {
    return null;
  }
}
