// Full-screen image viewer with pinch / wheel zoom and drag-to-pan.

const MAX_SCALE = 6;

export function createViewer() {
  const root = document.getElementById('viewer');
  const stage = document.getElementById('viewer-stage');
  const img = document.getElementById('viewer-img');
  const title = document.getElementById('viewer-title');
  const caption = document.getElementById('viewer-caption');

  let scale = 1;
  let tx = 0;
  let ty = 0;
  const points = new Map();
  let pinchStart = null;

  const apply = () => {
    if (scale <= 1) tx = ty = 0;
    img.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
    img.style.cursor = scale > 1 ? 'grab' : 'zoom-in';
  };
  const setScale = (s) => {
    scale = Math.min(MAX_SCALE, Math.max(1, s));
    apply();
  };
  const spread = () => {
    const [a, b] = [...points.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };

  stage.addEventListener('pointerdown', (e) => {
    stage.setPointerCapture(e.pointerId);
    points.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (points.size === 2) pinchStart = { spread: spread(), scale };
  });
  stage.addEventListener('pointermove', (e) => {
    const prev = points.get(e.pointerId);
    if (!prev) return;
    const dx = e.clientX - prev.x;
    const dy = e.clientY - prev.y;
    prev.x = e.clientX;
    prev.y = e.clientY;
    if (points.size === 2 && pinchStart) setScale((pinchStart.scale * spread()) / pinchStart.spread);
    else if (points.size === 1 && scale > 1) {
      tx += dx;
      ty += dy;
      apply();
    }
  });
  const lift = (e) => {
    points.delete(e.pointerId);
    if (points.size < 2) pinchStart = null;
  };
  stage.addEventListener('pointerup', lift);
  stage.addEventListener('pointercancel', lift);
  stage.addEventListener('wheel', (e) => {
    e.preventDefault();
    setScale(scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15));
  }, { passive: false });
  stage.addEventListener('dblclick', () => setScale(scale > 1 ? 1 : 2.5));

  function close() {
    root.classList.remove('open');
    img.removeAttribute('src');
    points.clear();
  }
  root.querySelector('[data-close]').addEventListener('click', close);
  // Click on the dark backdrop (not the image) closes when not zoomed.
  stage.addEventListener('click', (e) => e.target === stage && scale === 1 && close());
  window.addEventListener('keydown', (e) => e.key === 'Escape' && root.classList.contains('open') && close());

  return {
    open(frame) {
      document.exitPointerLock?.();
      scale = 1;
      apply();
      // Show the thumbnail instantly, then swap in the full image once loaded.
      img.src = `/images/${frame.thumb}`;
      const full = new Image();
      full.onload = () => root.classList.contains('open') && img.src.endsWith(frame.thumb) && (img.src = full.src);
      full.src = `/images/${frame.file}`;
      img.alt = frame.title || 'Artwork';
      title.textContent = frame.title || '';
      caption.textContent = frame.caption || '';
      root.classList.add('open');
    },
    close,
  };
}
