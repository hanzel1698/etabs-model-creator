import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export interface RenderedPage {
  url: string; // object URL of the rasterised page
  wPt: number; // page size in PDF points
  hPt: number;
}

export async function pdfPageCount(bytes: ArrayBuffer): Promise<number> {
  const doc = await pdfjs.getDocument({ data: bytes.slice(0) }).promise;
  const n = doc.numPages;
  doc.destroy();
  return n;
}

/** Rasterise one page so its longest side is about `maxPx` pixels. */
export async function renderPdfPage(bytes: ArrayBuffer, pageNo: number, maxPx = 6000): Promise<RenderedPage> {
  const doc = await pdfjs.getDocument({ data: bytes.slice(0) }).promise;
  const page = await doc.getPage(pageNo);
  const vp1 = page.getViewport({ scale: 1 });
  const scale = Math.min(8, maxPx / Math.max(vp1.width, vp1.height));
  const vp = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(vp.width);
  canvas.height = Math.round(vp.height);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  const blob: Blob = await new Promise((res) => canvas.toBlob((b) => res(b!), 'image/png'));
  doc.destroy();
  return { url: URL.createObjectURL(blob), wPt: vp1.width, hPt: vp1.height };
}
