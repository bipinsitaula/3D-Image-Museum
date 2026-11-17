import * as THREE from 'three';
import { START, SECTIONS } from '../../shared/layout.js';
import { createGallery } from './gallery.js';
import { createControls } from './controls.js';
import { createViewer } from './viewer.js';
import { createEditor } from './editor.js';
import { createAdmin } from './admin.js';
import { createMenu } from './menu.js';

const isMobile =
  matchMedia('(pointer: coarse)').matches || /Android|iPhone|iPad|iPod|Mobi/i.test(navigator.userAgent);
document.body.classList.toggle('mobile', isMobile);

const MIN_LOADING_MS = 1400; // long enough to read the logo, short enough not to annoy
const MAX_LOADING_MS = 9000; // never trap visitors behind slow images

// ---- renderer ----
const container = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ antialias: !isMobile, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, isMobile ? 1.5 : 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NeutralToneMapping; // keeps white walls white
renderer.toneMappingExposure = 1.0;
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x83745f);
const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 150); // far enough to see down the whole building

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  // Keep a comfortable horizontal view in portrait.
  camera.fov = w < h ? 82 : 70;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// ---- UI helpers ----
const toastEl = document.getElementById('toast');
let toastTimer;
function toast(message) {
  toastEl.textContent = message;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 3200);
}

const hint = document.getElementById('hint');
hint.textContent = isMobile
  ? 'Joystick to walk · drag to look · tap a picture to view'
  : 'WASD to walk · Shift to run · click a picture to view · Esc for menu';
let hintTimer;
let hintShown = false;
const hideHintSoon = (ms) => {
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => hint.classList.add('hidden'), ms);
};

// Slots that currently hold a picture, for the line under the menu buttons.
const hung = new Set();
const showCount = () =>
  menu.setInfo(`${hung.size} ${hung.size === 1 ? 'picture' : 'pictures'} on display · ${SECTIONS.length} sections`);

const isBlocked = () => document.querySelector('.overlay.open') !== null;

// ---- world ----
const gallery = createGallery(scene, renderer, { isMobile });
const viewer = createViewer();
const editor = createEditor();

const menu = createMenu({
  isMobile,
  isBlocked,
  onAdmin: () => admin.toggle(),
  onHome: () => controls.goHome(),
  onEnter(first) {
    if (first) controls.faceStart(); // the view was drifting behind the start menu
    controls.lock();
    if (!hintShown) {
      hintShown = true;
      hint.classList.remove('hidden');
      hideHintSoon(10000);
    }
  },
});

const admin = createAdmin({
  gallery,
  editor,
  toast,
  onChange(slotId, frame) {
    gallery.setFrame(slotId, frame);
    if (frame) hung.add(slotId);
    else hung.delete(slotId);
    showCount();
  },
  onSectionChange: (id, section) => gallery.setSection(id, section),
  onState: (isAdmin) => menu.setAdmin(isAdmin),
});

const controls = createControls({
  isIdle: () => menu.mode === 'start',
  camera,
  dom: renderer.domElement,
  gallery,
  start: START,
  isMobile,
  isBlocked,
  onInteract: () => hintShown && hideHintSoon(2500),
  onBoard(sectionId) {
    if (admin.isAdmin) admin.openSection(sectionId);
  },
  onFrame(slotId) {
    if (admin.isAdmin) return admin.openPanel(slotId);
    const frame = gallery.getFrame(slotId);
    if (frame) viewer.open(frame);
  },
});

// ---- loading ----
async function load() {
  const started = performance.now();
  menu.setProgress(0.08, 'Opening the doors…');

  let frames = [];
  try {
    const res = await fetch('/api/museum');
    if (!res.ok) throw new Error();
    const museum = await res.json();
    frames = Object.entries(museum.frames || {});
    for (const [slotId] of frames) hung.add(slotId);
    for (const [id, section] of Object.entries(museum.sections || {})) gallery.setSection(id, section);
  } catch {
    toast('Could not load the collection. Try reloading.');
  }

  // Wait for the thumbnails so nobody walks into a room of grey rectangles.
  if (frames.length) {
    await new Promise((resolve) => {
      let done = 0;
      gallery.onThumb = () => {
        done++;
        menu.setProgress(0.2 + 0.7 * (done / frames.length), `Hanging the pictures… ${done} / ${frames.length}`);
        if (done >= frames.length) resolve();
      };
      for (const [slotId, frame] of frames) gallery.setFrame(slotId, frame);
      setTimeout(resolve, MAX_LOADING_MS);
    });
    gallery.onThumb = null;
  }

  menu.setProgress(0.95, 'Switching on the lights…');
  gallery.update(camera.position, 0);
  renderer.compile(scene, camera); // build shaders now, not on the first step
  await new Promise((r) => setTimeout(r, Math.max(0, MIN_LOADING_MS - (performance.now() - started))));

  showCount();
  menu.setProgress(1, 'Ready');
  menu.open('start');
  admin.restore();
}
load();

// ---- loop ----
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  controls.update(dt);
  gallery.update(camera.position, dt);
  renderer.render(scene, camera);
});

if (import.meta.env.DEV) window.__museum = { scene, camera, renderer, gallery };
