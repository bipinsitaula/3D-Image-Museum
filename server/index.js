import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
try {
  process.loadEnvFile(path.join(ROOT, '.env'));
} catch {
  // No .env file: rely on real environment variables.
}

const { default: express } = await import('express');
const { default: multer } = await import('multer');
const { rateLimit } = await import('express-rate-limit');
const { SLOT_IDS, FRAME_STYLE_IDS, DEFAULT_FRAME_STYLE, SECTION_IDS, SECTION_LIMITS } = await import(
  '../shared/layout.js'
);
const store = await import('./storage.js');

const { ADMIN_PASSWORD, SESSION_SECRET } = process.env;
// "--port N" wins over the PORT variable (the dev script uses it so a PORT
// meant for Vite can't land the API on the wrong port).
const portArg = process.argv.indexOf('--port');
const PORT = Number(portArg > -1 ? process.argv[portArg + 1] : process.env.PORT) || 3000;
if (!ADMIN_PASSWORD || !SESSION_SECRET || SESSION_SECRET.length < 32) {
  console.error('Set ADMIN_PASSWORD and SESSION_SECRET (32+ chars) in .env — see .env.example.');
  process.exit(1);
}

const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
const MAX_TITLE = 120;
const MAX_CAPTION = 1000;

// ---- auth ----------------------------------------------------------------

const sign = (data) => crypto.createHmac('sha256', SESSION_SECRET).update(data).digest('base64url');

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function issueToken() {
  const body = Buffer.from(JSON.stringify({ exp: Date.now() + TOKEN_TTL_MS })).toString('base64url');
  return `${body}.${sign(body)}`;
}

function verifyToken(token) {
  if (typeof token !== 'string') return false;
  const [body, sig, extra] = token.split('.');
  if (!body || !sig || extra !== undefined) return false;
  if (!safeEqual(sig, sign(body))) return false;
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString()).exp > Date.now();
  } catch {
    return false;
  }
}

function requireAdmin(req, res, next) {
  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!verifyToken(token)) return res.status(401).json({ error: 'Admin login required.' });
  next();
}

// ---- helpers ---------------------------------------------------------------

function requireSlot(req, res, next) {
  if (!SLOT_IDS.has(req.params.slot)) return res.status(404).json({ error: 'No such frame.' });
  next();
}

const cleanText = (value, max) =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
}).single('image');

// ---- app -------------------------------------------------------------------

await store.init();

const app = express();
app.disable('x-powered-by');
if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);
app.use(express.json({ limit: '20kb' }));

app.get('/api/museum', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(store.getMuseum());
});

app.post(
  '/api/login',
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many login attempts. Try again in a few minutes.' },
  }),
  (req, res) => {
    if (!safeEqual(req.body?.password ?? '', ADMIN_PASSWORD)) {
      return res.status(401).json({ error: 'Wrong password.' });
    }
    res.json({ token: issueToken() });
  },
);

app.get('/api/session', requireAdmin, (req, res) => res.json({ ok: true }));

app.post('/api/frames/:slot', requireAdmin, requireSlot, upload, async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Choose an image to upload.' });

  let image;
  try {
    image = await store.processImage(req.file.buffer);
  } catch {
    return res.status(400).json({ error: 'That file is not an image we can read.' });
  }

  const { slot } = req.params;
  const frame = {
    ...image,
    title: cleanText(req.body.title, MAX_TITLE),
    caption: cleanText(req.body.caption, MAX_CAPTION),
    style: FRAME_STYLE_IDS.has(req.body.style) ? req.body.style : DEFAULT_FRAME_STYLE,
    updatedAt: new Date().toISOString(),
  };
  let previous;
  try {
    previous = await store.mutate((museum) => {
      const old = museum.frames[slot];
      museum.frames[slot] = frame;
      return old;
    });
  } catch (err) {
    await store.removeImageFiles(frame);
    throw err;
  }
  await store.removeImageFiles(previous);
  res.json({ slot, frame });
});

app.patch('/api/frames/:slot', requireAdmin, requireSlot, async (req, res) => {
  const { slot } = req.params;
  if (!store.getMuseum().frames[slot]) return res.status(404).json({ error: 'That frame is empty.' });
  const frame = await store.mutate((museum) => {
    const f = museum.frames[slot];
    if (typeof req.body?.title === 'string') f.title = cleanText(req.body.title, MAX_TITLE);
    if (typeof req.body?.caption === 'string') f.caption = cleanText(req.body.caption, MAX_CAPTION);
    if (FRAME_STYLE_IDS.has(req.body?.style)) f.style = req.body.style;
    f.updatedAt = new Date().toISOString();
    return f;
  });
  res.json({ slot, frame });
});

app.delete('/api/frames/:slot', requireAdmin, requireSlot, async (req, res) => {
  const { slot } = req.params;
  const previous = await store.mutate((museum) => {
    const old = museum.frames[slot];
    delete museum.frames[slot];
    return old;
  });
  await store.removeImageFiles(previous);
  res.json({ slot, frame: null });
});

// Title and text shown on a section's boards. An empty title falls back to the default.
app.patch('/api/sections/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  if (!SECTION_IDS.has(id)) return res.status(404).json({ error: 'No such section.' });
  const section = await store.mutate((museum) => {
    museum.sections ??= {};
    const s = museum.sections[id] ?? {};
    if (typeof req.body?.title === 'string') s.title = cleanText(req.body.title, SECTION_LIMITS.title);
    if (typeof req.body?.text === 'string') s.text = cleanText(req.body.text, SECTION_LIMITS.text);
    museum.sections[id] = s;
    return s;
  });
  res.json({ id, section });
});

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

// Filenames are random and never reused, so images can be cached forever.
app.use(
  '/images',
  express.static(store.IMAGES_DIR, { immutable: true, maxAge: '365d', index: false }),
  (req, res) => res.status(404).end(),
);

const DIST = path.join(ROOT, 'client', 'dist');
if (fs.existsSync(path.join(DIST, 'index.html'))) {
  app.use(express.static(DIST, { index: false, maxAge: '1h' }));
  app.use((req, res, next) => {
    if (req.method !== 'GET') return next();
    res.set('Cache-Control', 'no-cache');
    res.sendFile(path.join(DIST, 'index.html'));
  });
} else {
  app.get('/', (req, res) =>
    res.type('text').send('Frontend not built. Run "npm run build" (or "npm run dev" for development).'),
  );
}

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    const tooBig = err.code === 'LIMIT_FILE_SIZE';
    return res
      .status(tooBig ? 413 : 400)
      .json({ error: tooBig ? 'Image is larger than 15 MB.' : 'Upload failed.' });
  }
  if (err.type === 'entity.parse.failed' || err.type === 'entity.too.large') {
    return res.status(400).json({ error: 'Bad request.' });
  }
  console.error(err);
  res.status(500).json({ error: 'Server error.' });
});

app.listen(PORT, () => console.log(`Museum server listening on http://localhost:${PORT}`));
