import { createCanvas } from '@napi-rs/canvas';

export function makeJpeg(width: number, height: number): Buffer {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#101010';
  ctx.fillRect(0, 0, Math.floor(width / 2), Math.floor(height / 4));
  return canvas.toBuffer('image/jpeg');
}

/** 生成一个"整页只有一张图、没有文本层"的 PDF，模拟扫描件 */
export function buildImageOnlyPdf(jpeg: Buffer, width: number, height: number): Buffer {
  const pageWidth = 200;
  const pageHeight = 200;
  const content = `q ${pageWidth} 0 0 ${pageHeight} 0 0 cm /Im0 Do Q`;
  const bodies: string[] = [];
  bodies[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  bodies[2] = '<< /Type /Pages /Kids [3 0 R] /Count 1 >>';
  bodies[3] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}]`
    + ' /Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>';
  bodies[4] = `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`;
  bodies[5] = `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height}`
    + ` /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`;

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let i = 1; i <= 5; i += 1) {
    offsets[i] = Buffer.byteLength(pdf, 'latin1');
    if (i === 5) {
      pdf += `5 0 obj\n${bodies[5]}`;
      pdf += Buffer.from(jpeg).toString('latin1');
      pdf += '\nendstream\nendobj\n';
      continue;
    }
    pdf += `${i} 0 obj\n${bodies[i]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 6\n0000000000 65535 f \n`;
  for (let i = 1; i <= 5; i += 1) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}
