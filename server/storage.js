import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const STORAGE_DIR = path.resolve(ROOT, process.env.STORAGE_DIR || 'storage');
export const IMAGES_DIR = path.join(STORAGE_DIR, 'images');
const MUSEUM_FILE = path.join(STORAGE_DIR, 'museum.json');

const FULL_MAX = 2048;
const THUMB_MAX = 512;

let state = { frames: {} };
let queue = Promise.resolve();

export async function init() {
  await fs.mkdir(IMAGES_DIR, { recursive: true });
  try {
    const parsed = JSON.parse(await fs.readFile(MUSEUM_FILE, 'utf8'));
    if (parsed && typeof parsed.frames === 'object') state = parsed;
  } catch (err) {
    if (err.code !== 'ENOENT') throw new Error(`Could not read ${MUSEUM_FILE}: ${err.message}`);
  }
}

export function getMuseum() {
  return state;
}

// Write to a temp file, then rename, so museum.json is never half-written.
async function writeAtomic(next) {
  const tmp = `${MUSEUM_FILE}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(next, null, 2));
  await fs.rename(tmp, MUSEUM_FILE);
}

// Mutations run one at a time; memory is only updated after the file is on disk.
export function mutate(fn) {
  const run = queue.then(async () => {
    const next = structuredClone(state);
    const result = await fn(next);
    await writeAtomic(next);
    state = next;
    return result;
  });
  queue = run.catch(() => {});
  return run;
}

// Decode, auto-rotate, shrink and convert to WebP. Throws if the buffer isn't an image.
export async function processImage(buffer) {
  const id = crypto.randomBytes(12).toString('hex');
  const base = () => sharp(buffer, { failOn: 'error' }).rotate();

  const full = await base()
    .resize({ width: FULL_MAX, height: FULL_MAX, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer({ resolveWithObject: true });
  const thumb = await base()
    .resize({ width: THUMB_MAX, height: THUMB_MAX, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 75 })
    .toBuffer();

  const file = `${id}.webp`;
  const thumbFile = `${id}_thumb.webp`;
  await fs.writeFile(path.join(IMAGES_DIR, file), full.data);
  await fs.writeFile(path.join(IMAGES_DIR, thumbFile), thumb);

  return { file, thumb: thumbFile, width: full.info.width, height: full.info.height };
}

export async function removeImageFiles(frame) {
  if (!frame) return;
  for (const name of [frame.file, frame.thumb]) {
    // Names in museum.json are server-generated, but never trust a path blindly.
    if (typeof name !== 'string' || !/^[a-f0-9]+(_thumb)?\.webp$/.test(name)) continue;
    await fs.rm(path.join(IMAGES_DIR, name), { force: true });
  }
}
