// In-browser image editor for the curator: crop (free or fixed shape), rotate,
// flip, brightness / contrast / colour. Produces a JPEG that is then uploaded
// like any other file — the server still does the final resize and WebP step.

const $ = (id) => document.getElementById(id);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

const PREVIEW_MAX = 1600; // px, longest side of the on-screen canvas
const WORK_MAX = 4096; // px, keeps big phone photos inside canvas limits
const OUTPUT_MAX = 2560; // px, the server shrinks to 2048 anyway
const MIN_CROP = 0.06; // fraction of the image
const RATIOS = [
  ['Free', 0],
  ['1:1', 1],
  ['4:3', 4 / 3],
  ['3:4', 3 / 4],
  ['3:2', 3 / 2],
  ['2:3', 2 / 3],
  ['16:9', 16 / 9],
];

export function createEditor() {
  const root = $('editor');
  const stage = $('editor-stage');
  const frame = $('editor-frame');
  const canvas = $('editor-canvas');
  const box = $('editor-crop');
  const sliders = { b: $('editor-brightness'), c: $('editor-contrast'), s: $('editor-saturation') };

  let src = null; // HTMLImageElement
  let srcUrl = null;
  let rot = 0; // quarter turns clockwise
  let flip = false;
  let ratio = 0; // width / height, 0 = free
  let crop = { x: 0, y: 0, w: 1, h: 1 }; // fractions of the rotated image
  let finish = null;

  // ---- geometry ----
  const orientedSize = () => {
    const swap = rot % 2 === 1;
    return { w: swap ? src.naturalHeight : src.naturalWidth, h: swap ? src.naturalWidth : src.naturalHeight };
  };

  // Draw the rotated / flipped source into a canvas whose longest side is at most maxSide.
  function drawOriented(target, maxSide) {
    const { w, h } = orientedSize();
    const k = Math.min(1, maxSide / Math.max(w, h));
    target.width = Math.max(1, Math.round(w * k));
    target.height = Math.max(1, Math.round(h * k));
    const g = target.getContext('2d');
    g.save();
    g.translate(target.width / 2, target.height / 2);
    g.rotate((rot * Math.PI) / 2);
    if (flip) g.scale(-1, 1);
    const sw = src.naturalWidth * k;
    const sh = src.naturalHeight * k;
    g.drawImage(src, -sw / 2, -sh / 2, sw, sh);
    g.restore();
  }

  // Crop shape as a ratio of *fractions* (the image itself is rarely square).
  const fractionRatio = () => {
    const { w, h } = orientedSize();
    return ratio ? (ratio * h) / w : 0;
  };

  function fitCropToRatio() {
    const rn = fractionRatio();
    if (!rn) return;
    const w = Math.min(1, rn);
    const h = w / rn;
    crop = { x: (1 - w) / 2, y: (1 - h) / 2, w, h };
  }

  function layout() {
    if (!src) return;
    const pad = 28;
    const scale = Math.min(
      (stage.clientWidth - pad * 2) / canvas.width,
      (stage.clientHeight - pad * 2) / canvas.height,
    );
    frame.style.width = `${Math.max(40, canvas.width * scale)}px`;
    frame.style.height = `${Math.max(40, canvas.height * scale)}px`;
  }

  function showCrop() {
    box.style.left = `${crop.x * 100}%`;
    box.style.top = `${crop.y * 100}%`;
    box.style.width = `${crop.w * 100}%`;
    box.style.height = `${crop.h * 100}%`;
    box.classList.toggle('locked', ratio !== 0); // fixed shapes resize from corners only
  }

  const cssFilter = () =>
    `brightness(${sliders.b.value}%) contrast(${sliders.c.value}%) saturate(${sliders.s.value}%)`;

  function redraw() {
    drawOriented(canvas, PREVIEW_MAX);
    canvas.style.filter = cssFilter();
    layout();
    showCrop();
  }

  // ---- crop dragging ----
  let drag = null;
  box.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    try {
      box.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, start: { ...crop }, handle: e.target.dataset.h || '' };
  });
  box.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = (e.clientX - drag.x) / frame.clientWidth;
    const dy = (e.clientY - drag.y) / frame.clientHeight;
    const s = drag.start;
    const h = drag.handle;
    if (!h) {
      crop = { ...s, x: clamp(s.x + dx, 0, 1 - s.w), y: clamp(s.y + dy, 0, 1 - s.h) };
    } else {
      let x = s.x;
      let y = s.y;
      let x2 = s.x + s.w;
      let y2 = s.y + s.h;
      if (h.includes('w')) x = clamp(x + dx, 0, x2 - MIN_CROP);
      if (h.includes('e')) x2 = clamp(x2 + dx, x + MIN_CROP, 1);
      if (h.includes('n')) y = clamp(y + dy, 0, y2 - MIN_CROP);
      if (h.includes('s')) y2 = clamp(y2 + dy, y + MIN_CROP, 1);
      const rn = fractionRatio();
      if (rn) {
        // Keep the shape: width follows the pointer, height follows width,
        // anchored at the corner opposite the one being dragged.
        const north = h.includes('n');
        const room = north ? s.y + s.h : 1 - s.y;
        let w = x2 - x;
        let hh = w / rn;
        if (hh > room) {
          hh = room;
          w = hh * rn;
        }
        if (h.includes('w')) x = x2 - w;
        else x2 = x + w;
        if (north) y = y2 - hh;
        else y2 = y + hh;
      }
      crop = { x, y, w: x2 - x, h: y2 - y };
    }
    showCrop();
  });
  const endDrag = (e) => {
    if (drag && e.pointerId === drag.id) drag = null;
  };
  box.addEventListener('pointerup', endDrag);
  box.addEventListener('pointercancel', endDrag);

  // ---- tools ----
  const ratioBar = $('editor-ratios');
  for (const [label, value] of RATIOS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.setAttribute('role', 'radio');
    b.addEventListener('click', () => {
      ratio = value;
      fitCropToRatio();
      syncRatioButtons();
      showCrop();
    });
    ratioBar.append(b);
  }
  function syncRatioButtons() {
    [...ratioBar.children].forEach((b, i) => b.setAttribute('aria-checked', String(RATIOS[i][1] === ratio)));
  }

  function turn(quarters) {
    rot = (rot + quarters + 4) % 4;
    crop = { x: 0, y: 0, w: 1, h: 1 };
    fitCropToRatio();
    redraw();
  }
  $('editor-rot-l').addEventListener('click', () => turn(-1));
  $('editor-rot-r').addEventListener('click', () => turn(1));
  $('editor-flip').addEventListener('click', () => {
    // Mirror left-right as seen on screen, whatever the current rotation.
    flip = !flip;
    if (rot % 2 === 1) rot = (rot + 2) % 4;
    crop = { ...crop, x: 1 - crop.x - crop.w };
    redraw();
  });

  function reset() {
    rot = 0;
    flip = false;
    ratio = 0;
    crop = { x: 0, y: 0, w: 1, h: 1 };
    for (const s of Object.values(sliders)) s.value = 100;
    syncRatioButtons();
    redraw();
  }
  $('editor-reset').addEventListener('click', reset);
  for (const s of Object.values(sliders)) s.addEventListener('input', () => (canvas.style.filter = cssFilter()));

  // ---- export ----
  // Same maths as the CSS brightness() / contrast() / saturate() used for the
  // preview, applied by hand because canvas filters are not supported everywhere.
  function applyAdjustments(g, w, h) {
    const b = sliders.b.value / 100;
    const c = sliders.c.value / 100;
    const s = sliders.s.value / 100;
    if (b === 1 && c === 1 && s === 1) return;
    const data = g.getImageData(0, 0, w, h);
    const px = data.data;
    const offset = 127.5 * (1 - c);
    const m = [
      0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s,
      0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s,
      0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s,
    ];
    for (let i = 0; i < px.length; i += 4) {
      const r = clamp(px[i] * b, 0, 255) * c + offset;
      const gr = clamp(px[i + 1] * b, 0, 255) * c + offset;
      const bl = clamp(px[i + 2] * b, 0, 255) * c + offset;
      const R = clamp(r, 0, 255);
      const G = clamp(gr, 0, 255);
      const B = clamp(bl, 0, 255);
      px[i] = m[0] * R + m[1] * G + m[2] * B;
      px[i + 1] = m[3] * R + m[4] * G + m[5] * B;
      px[i + 2] = m[6] * R + m[7] * G + m[8] * B;
    }
    g.putImageData(data, 0, 0);
  }

  function render() {
    const work = document.createElement('canvas');
    drawOriented(work, WORK_MAX);
    const sx = Math.round(crop.x * work.width);
    const sy = Math.round(crop.y * work.height);
    const sw = Math.max(1, Math.round(crop.w * work.width));
    const sh = Math.max(1, Math.round(crop.h * work.height));
    const k = Math.min(1, OUTPUT_MAX / Math.max(sw, sh));
    const out = document.createElement('canvas');
    out.width = Math.max(1, Math.round(sw * k));
    out.height = Math.max(1, Math.round(sh * k));
    const g = out.getContext('2d', { willReadFrequently: true });
    g.fillStyle = '#fff'; // JPEG has no transparency
    g.fillRect(0, 0, out.width, out.height);
    g.imageSmoothingQuality = 'high';
    g.drawImage(work, sx, sy, sw, sh, 0, 0, out.width, out.height);
    applyAdjustments(g, out.width, out.height);
    return new Promise((resolve) => out.toBlob(resolve, 'image/jpeg', 0.92));
  }

  function close(result) {
    root.classList.remove('open');
    if (srcUrl) URL.revokeObjectURL(srcUrl);
    srcUrl = null;
    src = null;
    finish?.(result);
    finish = null;
  }

  $('editor-cancel').addEventListener('click', () => close(null));
  $('editor-apply').addEventListener('click', async () => {
    const button = $('editor-apply');
    button.disabled = true;
    try {
      close(await render());
    } finally {
      button.disabled = false;
    }
  });
  window.addEventListener('keydown', (e) => e.key === 'Escape' && root.classList.contains('open') && close(null));
  window.addEventListener('resize', () => root.classList.contains('open') && layout());

  return {
    // source: a File/Blob, or the URL of an image on this server.
    // Resolves with a JPEG Blob, or null if the curator cancelled.
    async edit(source) {
      const blob = typeof source === 'string' ? await (await fetch(source)).blob() : source;
      const url = URL.createObjectURL(blob);
      const img = new Image();
      try {
        await new Promise((resolve, reject) => {
          img.onload = resolve;
          img.onerror = () => reject(new Error('This file could not be opened as an image.'));
          img.src = url;
        });
      } catch (err) {
        URL.revokeObjectURL(url);
        throw err;
      }
      src = img;
      srcUrl = url;
      root.classList.add('open');
      reset();
      return new Promise((resolve) => (finish = resolve));
    },
  };
}
