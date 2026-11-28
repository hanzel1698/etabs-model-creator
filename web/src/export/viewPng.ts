// What the main area shows now: every view SVG and canvas (plan, elevation, section, 3D, underlay) composited at screen positions.
// shortcut: HTML overlays (tags, tooltips) are not drawn; render them into the SVG if they're ever needed in the image.

const PROPS = ['fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin', 'vector-effect', 'opacity', 'visibility', 'display', 'filter', 'paint-order', 'font-family', 'font-size', 'font-weight', 'font-style', 'text-anchor', 'dominant-baseline'];

const toDataUrl = (b: Blob) => new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(r.result as string); r.readAsDataURL(b); });

async function svgImage(svg: SVGSVGElement, w: number, h: number): Promise<HTMLImageElement> {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  // stylesheet rules don't reach an SVG loaded as an image: inline the computed values
  const src = [svg, ...svg.querySelectorAll('*')], dst = [clone, ...clone.querySelectorAll('*')];
  src.forEach((el, i) => {
    const cs = getComputedStyle(el);
    (dst[i] as SVGElement).setAttribute('style', PROPS.map((p) => `${p}:${cs.getPropertyValue(p)}`).join(';'));
  });
  // blob: hrefs (PDF underlay pages) don't load inside an SVG image either
  for (const im of clone.querySelectorAll('image')) {
    const href = im.getAttribute('href');
    if (href?.startsWith('blob:')) im.setAttribute('href', await toDataUrl(await (await fetch(href)).blob()));
  }
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', String(w));
  clone.setAttribute('height', String(h));
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

const INVERT = 'invert(1) hue-rotate(180deg)'; // dark theme → dark lines on white, hues kept

/** src drawn through INVERT, with anything close to the (inverted) screen background made pure white. */
function toPaper(src: HTMLCanvasElement, bg: string): HTMLCanvasElement {
  const px = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!;
  px.filter = INVERT;
  px.fillStyle = bg;
  px.fillRect(0, 0, 1, 1);
  const [r, gg, b] = px.getImageData(0, 0, 1, 1).data;
  const out = document.createElement('canvas');
  out.width = src.width;
  out.height = src.height;
  const g = out.getContext('2d', { willReadFrequently: true })!;
  g.filter = INVERT;
  g.drawImage(src, 0, 0);
  const im = g.getImageData(0, 0, out.width, out.height), d = im.data;
  for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - r) + Math.abs(d[i + 1] - gg) + Math.abs(d[i + 2] - b) < 24) d[i] = d[i + 1] = d[i + 2] = 255;
  g.putImageData(im, 0, 0);
  return out;
}

/** The view area as on screen, on white paper, saved as PNG or as a PDF page (A3, orientation to fit). */
export async function exportView(name: string, fmt: 'png' | 'pdf') {
  const main = document.querySelector<HTMLElement>('.main');
  if (!main) return;
  const box = main.getBoundingClientRect(), k = 3; // 3x: SVG layers stay sharp when printed
  const cv = document.createElement('canvas');
  cv.width = Math.round(box.width * k);
  cv.height = Math.round(box.height * k);
  const g = cv.getContext('2d')!;
  g.scale(k, k);
  let bgEl: HTMLElement | null = main; // first ancestor with a real background (.main itself is transparent)
  while (bgEl && getComputedStyle(bgEl).backgroundColor === 'rgba(0, 0, 0, 0)') bgEl = bgEl.parentElement;
  const bg = bgEl ? getComputedStyle(bgEl).backgroundColor : '#000';
  g.fillStyle = bg;
  g.fillRect(0, 0, box.width, box.height);
  for (const el of main.querySelectorAll<SVGSVGElement | HTMLCanvasElement>('svg, canvas')) {
    if (el.parentElement?.closest('svg, button')) continue; // nested svgs come with their parent; icons stay out
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    const img = el instanceof HTMLCanvasElement ? el : await svgImage(el, r.width, r.height);
    g.drawImage(img, r.left - box.left, r.top - box.top, r.width, r.height);
  }
  const paper = toPaper(cv, bg);
  if (fmt === 'pdf') {
    const { jsPDF } = await import('jspdf');
    const land = paper.width >= paper.height;
    const doc = new jsPDF({ unit: 'mm', format: 'a3', orientation: land ? 'landscape' : 'portrait' });
    const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), m = 10;
    const s = Math.min((W - 2 * m) / paper.width, (H - 2 * m - 8) / paper.height);
    const w = paper.width * s, h = paper.height * s;
    doc.addImage(paper.toDataURL('image/jpeg', 0.92), 'JPEG',(W - w) / 2, m + (H - 2 * m - 8 - h) / 2, w, h);
    doc.setDrawColor(0).setLineWidth(0.35).rect(m, m, W - 2 * m, H - 2 * m);
    doc.setFontSize(9).text(`${name}   ${new Date().toLocaleDateString()}`, m + 3, H - m - 3);
    return doc.save(`${name}.pdf`);
  }
  const blob = await new Promise<Blob | null>((res) => paper.toBlob(res, 'image/png'));
  if (!blob) return;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${name}.png`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
