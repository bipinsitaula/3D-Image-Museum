import * as THREE from 'three';
import {
  FRAME_SLOTS,
  ROOM,
  BUILDING,
  SECTIONS,
  DIVIDERS,
  DOOR,
  PARTITIONS,
  PARTITION_HEIGHT,
  BLOCKS,
  BENCHES,
  BENCH_SIZE,
  BOARDS,
  BOARD_SIZE,
  ENTRANCE,
  LOBBY,
} from '../../shared/layout.js';

// Frame designs. border = visible frame width, mat = passe-partout width,
// depth = how far the frame stands off the wall (all metres).
const STYLE_SPECS = {
  black: { border: 0.028, depth: 0.045, mat: 0.09, color: 0x19191a, rough: 0.5 },
  white: { border: 0.04, depth: 0.05, mat: 0.1, color: 0xffffff, rough: 0.6, matColor: 0xf0ede6 },
  oak: { border: 0.036, depth: 0.05, mat: 0.1, color: 0xc79f6b, rough: 0.65 },
  gold: { border: 0.085, depth: 0.07, mat: 0, color: 0xc9a14a, rough: 0.34, metal: 0.35, lip: 0x8f6f2a },
  slim: { border: 0.018, depth: 0.05, mat: 0, color: 0x19191a, rough: 0.5 },
  canvas: { border: 0, depth: 0.04, mat: 0, color: 0xe4e0d8, rough: 0.9 },
};
const EMPTY_SIZE = { w: 1.3, h: 0.98 };
const FULL_RES_DISTANCE = 9; // swap thumb → full image inside this range
const PLAYER_RADIUS = 0.45;
const UP = new THREE.Vector3(0, 1, 0);

// ---- generated textures (no asset downloads) --------------------------------

function mulberry32(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Palette sampled from the reference gallery photo.
const PALETTE = {
  wall: 0xeceae8, // cool white, lit
  endCap: 0x101722, // deep navy edge of the freestanding walls
  floor: [205, 201, 195], // pale warm-grey polished stone, as it reads in the photo (rgb)
  ceiling: 0x83745f, // taupe, left in shade above the track lights
  bench: 0x1a2230,
  spot: 0xfff3e2,
};

// Large warm-grey stone tiles with soft mottling and thin joints.
function floorTexture() {
  const size = 1024;
  const tile = size / 2;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d');
  const rnd = mulberry32(4242);
  const [r, gr, b] = PALETTE.floor;

  for (let ty = 0; ty < 2; ty++) {
    for (let tx = 0; tx < 2; tx++) {
      const shift = (rnd() - 0.5) * 9; // slight tile-to-tile tone difference
      g.fillStyle = `rgb(${r + shift}, ${gr + shift}, ${b + shift})`;
      g.fillRect(tx * tile, ty * tile, tile, tile);
    }
  }
  // Cloudy mottling; every blotch is repeated across the edges so the texture tiles.
  for (let i = 0; i < 90; i++) {
    const x = rnd() * size;
    const y = rnd() * size;
    const radius = 30 + rnd() * 110;
    const light = rnd() > 0.5;
    for (const ox of [-size, 0, size]) {
      for (const oy of [-size, 0, size]) {
        const grad = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, radius);
        grad.addColorStop(0, light ? 'rgba(255, 252, 246, 0.08)' : 'rgba(60, 50, 40, 0.045)');
        grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
        g.fillStyle = grad;
        g.fillRect(x + ox - radius, y + oy - radius, radius * 2, radius * 2);
      }
    }
  }
  g.strokeStyle = 'rgba(90, 82, 72, 0.45)';
  g.lineWidth = 2;
  for (const p of [0, tile, size]) {
    g.beginPath();
    g.moveTo(p, 0);
    g.lineTo(p, size);
    g.moveTo(0, p);
    g.lineTo(size, p);
    g.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function plusTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 384;
  const g = canvas.getContext('2d');
  g.fillStyle = '#f1efea';
  g.fillRect(0, 0, 512, 384);
  g.strokeStyle = 'rgba(29, 28, 26, 0.3)';
  g.lineWidth = 3;
  g.setLineDash([14, 12]);
  g.strokeRect(22, 22, 468, 340);
  g.setLineDash([]);
  g.lineWidth = 6;
  g.lineCap = 'round';
  g.strokeStyle = 'rgba(29, 28, 26, 0.42)';
  g.beginPath();
  g.moveTo(256, 150);
  g.lineTo(256, 234);
  g.moveTo(214, 192);
  g.lineTo(298, 192);
  g.stroke();
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.userData.shared = true;
  return tex;
}

// Soft contact shadow behind each frame.
function shadowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const g = canvas.getContext('2d');
  // Draw the rectangle off-canvas and keep only its blurred shadow.
  g.shadowColor = 'rgba(40, 30, 20, 0.5)';
  g.shadowBlur = 16;
  g.shadowOffsetX = 256;
  g.fillRect(19 - 256, 19, 90, 90);
  const tex = new THREE.CanvasTexture(canvas);
  tex.userData.shared = true;
  return tex;
}

// Small wall label, like the ones beside each work in a real gallery.
function labelTexture(title) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 176;
  const g = canvas.getContext('2d');
  g.fillStyle = '#fdfcfa';
  g.fillRect(0, 0, 512, 176);
  g.fillStyle = '#1d1c1a';
  g.textBaseline = 'middle';
  let px = 66;
  const font = () => `600 ${px}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  g.font = font();
  while (px > 30 && g.measureText(title).width > 452) {
    px -= 2;
    g.font = font();
  }
  let text = title;
  while (text.length > 1 && g.measureText(text).width > 452) text = `${text.slice(0, -2).trimEnd()}…`;
  g.fillText(text, 30, 92);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Break text into lines no wider than maxWidth; the last allowed line gets an ellipsis.
function wrapLines(g, text, maxWidth, maxLines) {
  const lines = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (!line || g.measureText(next).width <= maxWidth) line = next;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    lines.length = maxLines;
    let last = lines[maxLines - 1];
    while (last.length > 1 && g.measureText(`${last}…`).width > maxWidth) last = last.slice(0, -1).trimEnd();
    lines[maxLines - 1] = `${last}…`;
  }
  return lines;
}

const SANS = 'system-ui, -apple-system, "Segoe UI", sans-serif';

// Face of a hanging section board: number and title on the left, text on the right.
// Without text, the title takes the whole board.
function boardTexture(number, title, text) {
  const canvas = document.createElement('canvas');
  canvas.width = 1300;
  canvas.height = 650;
  const g = canvas.getContext('2d');
  g.fillStyle = '#101722';
  g.fillRect(0, 0, 1300, 650);
  g.textBaseline = 'alphabetic';
  const hasText = text.trim().length > 0;

  g.fillStyle = '#5aa2ff';
  g.font = `600 30px ${SANS}`;
  g.letterSpacing = '8px';
  g.fillText(`SECTION ${number}`, 80, 128);
  g.letterSpacing = '0px';

  const px = hasText ? 76 : 112;
  g.fillStyle = '#ffffff';
  g.font = `700 ${px}px ${SANS}`;
  let y = 128 + px + 34;
  for (const line of wrapLines(g, title, hasText ? 520 : 1140, hasText ? 4 : 3)) {
    g.fillText(line, 80, y);
    y += px * 1.15;
  }
  g.fillStyle = '#5aa2ff';
  g.fillRect(80, Math.min(y - px * 0.55, 590), 110, 6);

  if (hasText) {
    g.fillStyle = 'rgba(255, 255, 255, 0.16)';
    g.fillRect(660, 96, 2, 458);
    g.fillStyle = '#c8cedb';
    g.font = `400 36px ${SANS}`;
    y = 136;
    for (const line of wrapLines(g, text, 510, 9)) {
      g.fillText(line, 720, y);
      y += 52;
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Lettering above a doorway.
function signTexture(title) {
  const canvas = document.createElement('canvas');
  canvas.width = 1280;
  canvas.height = 200;
  const g = canvas.getContext('2d');
  g.fillStyle = '#101722';
  g.fillRect(0, 0, 1280, 200);
  g.fillStyle = '#ffffff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.letterSpacing = '10px';
  let px = 84;
  const text = title.toUpperCase();
  do {
    g.font = `600 ${px}px ${SANS}`;
    px -= 4;
  } while (px > 30 && g.measureText(text).width > 1160);
  g.fillText(wrapLines(g, text, 1160, 1)[0] ?? '', 640, 106);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// The sign over the entrance: gallery mark, divider, and the name.
function entranceSignTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 2048;
  canvas.height = 420;
  const g = canvas.getContext('2d');
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mark = new Image();

  const draw = () => {
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = '#17181b';
    g.fillRect(0, 0, 2048, 420);
    g.fillStyle = '#ffffff';
    if (mark.complete && mark.naturalWidth) {
      // The icon file is the mark centred on black; "lighten" drops the black.
      g.globalCompositeOperation = 'lighten';
      // Only the band holding the mark; just below it the file has the top of the lettering.
      const top = mark.naturalHeight * 0.285;
      const band = mark.naturalHeight * 0.385;
      g.drawImage(mark, 0, top, mark.naturalWidth, band, 262, 78, 686, 264);
      g.globalCompositeOperation = 'source-over';
    }
    g.fillStyle = '#ffffff';
    g.fillRect(1010, 70, 5, 280);

    g.textBaseline = 'alphabetic';
    g.textAlign = 'left';
    g.font = `600 84px ${SANS}`;
    g.fillText('Bipin’s', 1090, 142);
    g.font = `800 132px ${SANS}`;
    g.fillStyle = '#1e7bff';
    g.fillText('3D', 1086, 268);
    const w3d = g.measureText('3D ').width;
    g.fillStyle = '#ffffff';
    g.fillText('IMAGE', 1086 + w3d, 268);
    const lineW = w3d + g.measureText('IMAGE').width;
    g.font = `500 58px ${SANS}`;
    g.letterSpacing = '26px';
    const word = 'MUSEUM';
    const wWord = g.measureText(word).width - 26;
    const x0 = 1086 + (lineW - wWord) / 2;
    g.fillText(word, x0, 352);
    g.letterSpacing = '0px';
    g.fillRect(1086, 328, x0 - 1086 - 30, 4);
    g.fillRect(x0 + wWord + 30, 328, 1086 + lineW - (x0 + wWord + 30), 4);
    tex.needsUpdate = true;
  };
  mark.onload = draw;
  mark.src = '/icon-512.png';
  draw();
  return tex;
}

// ---- gallery ----------------------------------------------------------------

export function createGallery(scene, renderer, { isMobile }) {
  const { depth: D, height: H } = ROOM;
  const { x0: X0, x1: X1 } = BUILDING;
  const LEN = X1 - X0;
  const CX = (X0 + X1) / 2;
  const loader = new THREE.TextureLoader();
  const anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const shared = (m) => ((m.userData.shared = true), m);

  // Things the player cannot walk through: { x, z, hx, hz } boxes on the floor.
  const obstacles = [];

  // ---- building shell ----
  const shell = new THREE.Group();
  scene.add(shell);

  const floorTex = floorTexture();
  floorTex.repeat.set(LEN / 2.4, D / 2.4); // tiles ≈ 1.2 m square
  floorTex.anisotropy = anisotropy;
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(LEN, D),
    new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.35, metalness: 0 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.x = CX;
  shell.add(floor);

  const wallMat = new THREE.MeshStandardMaterial({ color: PALETTE.wall, roughness: 0.96 });
  const wall = (w, x, z, rotY) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, H), wallMat);
    m.position.set(x, H / 2, z);
    m.rotation.y = rotY;
    shell.add(m);
  };
  wall(LEN, CX, -D / 2, 0);
  wall(D, X0, 0, Math.PI / 2);
  wall(D, X1, 0, -Math.PI / 2);

  const ceiling = new THREE.Mesh(
    new THREE.PlaneGeometry(LEN, D),
    // Unlit: the ceiling stays in shade above the track lights, as in the reference.
    new THREE.MeshBasicMaterial({ color: PALETTE.ceiling }),
  );
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.set(CX, H, 0);
  shell.add(ceiling);

  // Shadow-gap line where the outer walls meet the floor.
  const gapMat = new THREE.MeshStandardMaterial({ color: 0xb4afa8, roughness: 1 });
  const gap = (w, d, x, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.035, d), gapMat);
    m.position.set(x, 0.0175, z);
    shell.add(m);
  };
  gap(LEN, 0.02, CX, -D / 2 + 0.01);
  gap(LEN, 0.02, CX, D / 2 - 0.01);
  gap(0.02, D, X0 + 0.01, 0);
  gap(0.02, D, X1 - 0.01, 0);

  const box = (w, h, d, x, y, z, material) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    m.position.set(x, y, z);
    shell.add(m);
    return m;
  };

  // Walls between sections: a solid piece each side of the doorway and a lintel above it.
  for (const d of DIVIDERS) {
    const t = d.x1 - d.x0;
    const x = (d.x0 + d.x1) / 2;
    const side = (D - DOOR.width) / 2;
    for (const sign of [-1, 1]) {
      const z = sign * (DOOR.width / 2 + side / 2);
      box(t, H, side, x, H / 2, z, wallMat);
      obstacles.push({ x, z, hx: t / 2, hz: side / 2 });
    }
    box(t, H - DOOR.height, DOOR.width, x, (H + DOOR.height) / 2, 0, wallMat);
  }

  // Freestanding walls: white faces, navy end caps.
  const capMat = new THREE.MeshStandardMaterial({ color: PALETTE.endCap, roughness: 0.7 });
  const topMat = new THREE.MeshStandardMaterial({ color: 0xe9e7e2, roughness: 1 });
  for (const p of PARTITIONS) {
    const alongX = p.axis === 'x';
    const w = alongX ? p.length : p.thickness;
    const d = alongX ? p.thickness : p.length;
    // BoxGeometry face order: +x, -x, +y, -y, +z, -z — the caps go on the short ends.
    const sides = alongX ? [capMat, capMat] : [wallMat, wallMat];
    const ends = alongX ? [wallMat, wallMat] : [capMat, capMat];
    box(w, PARTITION_HEIGHT, d, p.x, PARTITION_HEIGHT / 2, p.z, [...sides, topMat, topMat, ...ends]);
    obstacles.push({ x: p.x, z: p.z, hx: w / 2, hz: d / 2 });
  }
  for (const b of BLOCKS) {
    const h = b.height || H;
    box(b.width, h, b.depth, b.x, h / 2, b.z, [wallMat, wallMat, topMat, topMat, wallMat, wallMat]);
    obstacles.push({ x: b.x, z: b.z, hx: b.width / 2, hz: b.depth / 2 });
  }

  // Benches in the same navy as the wall edges.
  const benchMat = new THREE.MeshStandardMaterial({ color: PALETTE.bench, roughness: 0.6 });
  for (const b of BENCHES) {
    box(BENCH_SIZE.length, BENCH_SIZE.height, BENCH_SIZE.depth, b.x, BENCH_SIZE.height / 2, b.z, benchMat);
    obstacles.push({ x: b.x, z: b.z, hx: BENCH_SIZE.length / 2, hz: BENCH_SIZE.depth / 2 });
  }

  // ---- section boards ----
  // Each section has boards hanging from the ceiling (title + text) and its title above
  // the doors that lead into it. All of them show the same editable text.
  const boardsRoot = new THREE.Group();
  scene.add(boardsRoot);
  const sections = new Map(SECTIONS.map((def, i) => [def.id, { def, number: i + 1, data: {}, faces: [] }]));
  const sectionText = (id) => {
    const s = sections.get(id);
    return { title: s.data.title || s.def.title, text: s.data.text ?? s.def.text };
  };
  const face = (sectionId, kind, w, h) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ toneMapped: false }));
    m.userData.kind = kind;
    sections.get(sectionId).faces.push(m);
    return m;
  };
  function refreshSection(id) {
    const s = sections.get(id);
    const { title, text } = sectionText(id);
    for (const m of s.faces) {
      m.material.map?.dispose();
      m.material.map = m.userData.kind === 'board' ? boardTexture(s.number, title, text) : signTexture(title);
      m.material.map.anisotropy = anisotropy;
      m.material.needsUpdate = true;
    }
  }

  const slabMat = new THREE.MeshStandardMaterial({ color: PALETTE.endCap, roughness: 0.7 });
  const cableMat = new THREE.MeshBasicMaterial({ color: 0xf4f3f1 });
  const boardY = BOARD_SIZE.bottom + BOARD_SIZE.height / 2;
  const cableLength = H - (BOARD_SIZE.bottom + BOARD_SIZE.height);
  for (const b of BOARDS) {
    const group = new THREE.Group();
    group.position.set(b.x, boardY, b.z);
    group.rotation.y = Math.PI / 2; // faces east and west
    group.userData.sectionId = b.section;
    const slab = new THREE.Mesh(
      new THREE.BoxGeometry(BOARD_SIZE.width, BOARD_SIZE.height, BOARD_SIZE.thickness),
      slabMat,
    );
    const front = face(b.section, 'board', BOARD_SIZE.width, BOARD_SIZE.height);
    front.position.z = BOARD_SIZE.thickness / 2 + 0.003;
    const back = face(b.section, 'board', BOARD_SIZE.width, BOARD_SIZE.height);
    back.position.z = -front.position.z;
    back.rotation.y = Math.PI;
    group.add(slab, front, back);
    // Two cables up to the ceiling. The board hangs above head height, so it is not an obstacle.
    for (const side of [-1, 1]) {
      const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, cableLength, 6), cableMat);
      cable.position.set(side * (BOARD_SIZE.width / 2 - 0.3), BOARD_SIZE.height / 2 + cableLength / 2, 0);
      group.add(cable);
    }
    boardsRoot.add(group);
  }
  // Above each doorway: the name of the section you are about to walk into.
  for (const d of DIVIDERS) {
    for (const [x, rotY, shown] of [
      [d.x0 - 0.004, -Math.PI / 2, d.east],
      [d.x1 + 0.004, Math.PI / 2, d.west],
    ]) {
      const sign = face(shown, 'sign', 3.2, 0.5);
      sign.position.set(x, DOOR.height + 0.62, 0);
      sign.rotation.y = rotY;
      sign.userData.sectionId = shown;
      boardsRoot.add(sign);
    }
  }
  for (const id of sections.keys()) refreshSection(id);

  const glowMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });

  // Track lighting: one fixture in front of every slot, hung from ceiling rails.
  const fixtures = new THREE.Group(); // not pickable: rays pass through the lamps
  scene.add(fixtures);
  const trackMat = new THREE.MeshBasicMaterial({ color: 0xf4f3f1 }); // white rails read against the dark ceiling
  const lampY = H - 0.42;
  const lampGeo = new THREE.CylinderGeometry(0.055, 0.07, 0.17, 12);
  const lensGeo = new THREE.CircleGeometry(0.058, 12);
  const stemGeo = new THREE.BoxGeometry(0.02, H - lampY - 0.08, 0.02);


  // ---- entrance and lobby ----
  // A doorway in the main hall's south wall, and the lobby outside it where the visit starts.
  const half = ENTRANCE.width / 2;
  const zIn = D / 2; // hall side of the south wall
  const zOut = zIn + ENTRANCE.wallThickness; // lobby side
  const lobbyBack = zOut + LOBBY.depth;
  const LW = LOBBY.halfWidth;
  const block = (xa, xb, za, zb) =>
    obstacles.push({ x: (xa + xb) / 2, z: (za + zb) / 2, hx: (xb - xa) / 2, hz: (zb - za) / 2 });

  // Hall side of the south wall, with the doorway cut out.
  wall(-half - X0, (X0 - half) / 2, zIn, Math.PI);
  wall(X1 - half, (X1 + half) / 2, zIn, Math.PI);
  const overDoor = new THREE.Mesh(new THREE.PlaneGeometry(ENTRANCE.width, H - ENTRANCE.height), wallMat);
  overDoor.position.set(0, (H + ENTRANCE.height) / 2, zIn);
  overDoor.rotation.y = Math.PI;
  shell.add(overDoor);

  // The wall's thickness (seen in the doorway) and its lobby face.
  const lobbyWallMat = new THREE.MeshStandardMaterial({ color: 0xdedcd8, roughness: 0.95 });
  const portalMat = new THREE.MeshStandardMaterial({ color: 0x17181b, roughness: 0.6 });
  const bodyMats = [portalMat, portalMat, portalMat, portalMat, lobbyWallMat, wallMat];
  const bodyZ = (zIn + zOut) / 2 + 0.005;
  const bodyD = ENTRANCE.wallThickness - 0.01;
  box(LW - half, H, bodyD, -(LW + half) / 2, H / 2, bodyZ, bodyMats);
  box(LW - half, H, bodyD, (LW + half) / 2, H / 2, bodyZ, bodyMats);
  box(ENTRANCE.width, H - ENTRANCE.height, bodyD, 0, (H + ENTRANCE.height) / 2, bodyZ, bodyMats);
  block(X0 - 1, -half, zIn, zOut);
  block(half, X1 + 1, zIn, zOut);
  // Nothing to walk on either side of the lobby.
  block(X0 - 1, -LW, zOut, lobbyBack + 1);
  block(LW, X1 + 1, zOut, lobbyBack + 1);

  // Lobby room.
  const lobbyDepth = lobbyBack - zIn;
  const lobbyFloorTex = floorTex.clone();
  lobbyFloorTex.repeat.set((LW * 2) / 2.4, lobbyDepth / 2.4);
  lobbyFloorTex.needsUpdate = true;
  const lobbyFloor = new THREE.Mesh(
    new THREE.PlaneGeometry(LW * 2, lobbyDepth),
    new THREE.MeshStandardMaterial({ map: lobbyFloorTex, roughness: 0.35 }),
  );
  lobbyFloor.rotation.x = -Math.PI / 2;
  lobbyFloor.position.set(0, 0, (zIn + lobbyBack) / 2);
  const lobbyCeiling = new THREE.Mesh(
    new THREE.PlaneGeometry(LW * 2, lobbyDepth),
    new THREE.MeshBasicMaterial({ color: 0xe9e7e3 }),
  );
  lobbyCeiling.rotation.x = Math.PI / 2;
  lobbyCeiling.position.set(0, H, (zIn + lobbyBack) / 2);
  shell.add(lobbyFloor, lobbyCeiling);
  const lobbyWall = (w, x, z, rotY) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, H), lobbyWallMat);
    m.position.set(x, H / 2, z);
    m.rotation.y = rotY;
    shell.add(m);
  };
  lobbyWall(LOBBY.depth, -LW, (zOut + lobbyBack) / 2, Math.PI / 2);
  lobbyWall(LOBBY.depth, LW, (zOut + lobbyBack) / 2, -Math.PI / 2);
  lobbyWall(LW * 2, 0, lobbyBack, Math.PI);
  // Dark skirting, as in the reference.
  box(LW - half - 0.9, 0.14, 0.03, -(LW + half + 0.9) / 2, 0.07, zOut + 0.015, portalMat);
  box(LW - half - 0.9, 0.14, 0.03, (LW + half + 0.9) / 2, 0.07, zOut + 0.015, portalMat);
  box(0.03, 0.14, LOBBY.depth, -LW + 0.015, 0.07, (zOut + lobbyBack) / 2, portalMat);
  box(0.03, 0.14, LOBBY.depth, LW - 0.015, 0.07, (zOut + lobbyBack) / 2, portalMat);
  box(LW * 2, 0.14, 0.03, 0, 0.07, lobbyBack - 0.015, portalMat);

  // Dark portal around the doorway, with the sign across the top.
  const proud = 0.14;
  const headerH = 1.55;
  for (const side of [-1, 1]) {
    box(0.9, ENTRANCE.height, proud, side * (half + 0.45), ENTRANCE.height / 2, zOut + proud / 2, portalMat);
  }
  box(ENTRANCE.width + 1.8, headerH, proud, 0, ENTRANCE.height + headerH / 2, zOut + proud / 2, portalMat);
  const signTex = entranceSignTexture();
  signTex.anisotropy = anisotropy;
  const entranceSign = new THREE.Mesh(
    new THREE.PlaneGeometry(ENTRANCE.width + 1.6, ((ENTRANCE.width + 1.6) * 420) / 2048),
    // Lit like the portal around it, so the sign's background matches exactly.
    new THREE.MeshStandardMaterial({ map: signTex, roughness: 0.6 }),
  );
  entranceSign.position.set(0, ENTRANCE.height + headerH / 2, zOut + proud + 0.004);
  shell.add(entranceSign);

  // Glass: a fixed pane each side of the opening, with a tall pull handle. Not
  // pickable, so you can click pictures through it.
  const decor = new THREE.Group();
  scene.add(decor);
  const glassMat = new THREE.MeshBasicMaterial({
    color: 0xcfe6f5,
    transparent: true,
    opacity: 0.16,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const steelMat = new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.4, metalness: 0.5 });
  const glassZ = (zIn + zOut) / 2;
  for (const side of [-1, 1]) {
    const x = side * (half - ENTRANCE.glassPanel / 2);
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(ENTRANCE.glassPanel, ENTRANCE.height), glassMat);
    pane.position.set(x, ENTRANCE.height / 2, glassZ);
    const edge = new THREE.Mesh(new THREE.BoxGeometry(0.03, ENTRANCE.height, 0.05), steelMat);
    edge.position.set(side * (half - ENTRANCE.glassPanel), ENTRANCE.height / 2, glassZ);
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 1.3, 10), steelMat);
    handle.position.set(side * (half - ENTRANCE.glassPanel + 0.12), 1.15, glassZ + 0.07);
    decor.add(pane, edge, handle);
    block(Math.min(x - ENTRANCE.glassPanel / 2, x + ENTRANCE.glassPanel / 2), Math.max(x - ENTRANCE.glassPanel / 2, x + ENTRANCE.glassPanel / 2), glassZ - 0.04, glassZ + 0.04);
  }

  // Door mat.
  const mat = new THREE.Mesh(
    new THREE.PlaneGeometry(3.6, 1.3),
    new THREE.MeshStandardMaterial({ color: 0x1c1d20, roughness: 1 }),
  );
  mat.rotation.x = -Math.PI / 2;
  mat.position.set(0, 0.012, zOut + 1.2);
  decor.add(mat);

  // A potted palm each side.
  const planterMat = new THREE.MeshStandardMaterial({ color: 0xb7b5b0, roughness: 0.9 });
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x3c7a30, roughness: 0.8 });
  const stemMat = new THREE.MeshStandardMaterial({ color: 0x5b4a33, roughness: 0.9 });
  const leafGeo = new THREE.SphereGeometry(1, 8, 6);
  const rnd = mulberry32(77);
  for (const side of [-1, 1]) {
    const px = side * (half + 2.3);
    const pz = zOut + 0.85;
    box(0.66, 0.8, 0.66, px, 0.4, pz, planterMat);
    block(px - 0.33, px + 0.33, pz - 0.33, pz + 0.33);
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 0.7, 8), stemMat);
    trunk.position.set(px, 1.15, pz);
    decor.add(trunk);
    for (let i = 0; i < 30; i++) {
      const length = 0.5 + rnd() * 0.45;
      const turn = new THREE.Group(); // which way round the trunk
      turn.position.set(px, 1.0 + rnd() * 0.5, pz);
      turn.rotation.y = (i / 30) * Math.PI * 2 + rnd() * 0.4;
      const lean = new THREE.Group(); // how far the frond droops
      lean.rotation.z = 0.25 + rnd() * 1.0;
      const leaf = new THREE.Mesh(leafGeo, leafMat);
      leaf.scale.set(0.02, length, 0.075);
      leaf.position.y = length;
      lean.add(leaf);
      turn.add(lean);
      decor.add(turn);
    }
  }

  // ---- lighting ----
  // Soft, even base light; spotlights add warm pools on the hung pieces.
  scene.add(new THREE.AmbientLight(0xffffff, 1.45));
  scene.add(new THREE.HemisphereLight(0xffffff, 0xbdb6ad, 1.7));

  // Fixed pool of spotlights, re-aimed at the nearest occupied frames. Lights
  // are dimmed to 0 rather than hidden: toggling visibility recompiles shaders.
  const SPOT_INTENSITY = 24;
  const spots = [];
  const spotCount = isMobile ? 8 : 16;
  for (let i = 0; i < spotCount; i++) {
    const s = new THREE.SpotLight(PALETTE.spot, 0, 11, 0.44, 0.95, 1.4);
    scene.add(s, s.target);
    spots.push(s);
  }

  // ---- frames ----
  const styles = {};
  for (const [id, s] of Object.entries(STYLE_SPECS)) {
    const std = (color, roughness, metalness = 0) =>
      shared(new THREE.MeshStandardMaterial({ color, roughness, metalness }));
    styles[id] = {
      ...s,
      frameMat: std(s.color, s.rough, s.metal),
      matMat: std(s.matColor ?? 0xfbfaf6, 0.95),
      lipMat: s.lip ? std(s.lip, 0.4, s.metal) : null,
    };
  }
  const shadowMat = shared(
    new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false, toneMapped: false }),
  );
  const plusMat = shared(new THREE.MeshStandardMaterial({ map: plusTexture(), roughness: 1 }));

  const framesRoot = new THREE.Group();
  scene.add(framesRoot);
  const frames = new Map();
  let adminMode = false;

  function clearGroup(group) {
    for (const child of [...group.children]) {
      group.remove(child);
      child.geometry.dispose();
      if (!child.material.userData.shared) {
        if (child.material.map && !child.material.map.userData.shared) child.material.map.dispose();
        child.material.dispose();
      }
    }
  }

  function loadImage(f, file, isFull) {
    const version = f.version;
    loader.load(`/images/${file}`, (tex) => {
      // Ignore results for a frame that was replaced meanwhile, or a thumb that lost the race.
      if (f.version !== version || (!isFull && f.hasFull)) return tex.dispose();
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = anisotropy;
      const old = f.imageMat.map;
      f.imageMat.map = tex;
      f.imageMat.color.set(0xffffff);
      f.imageMat.needsUpdate = true;
      old?.dispose();
      if (isFull) f.hasFull = true;
      else api.onThumb?.();
    }, undefined, () => !isFull && api.onThumb?.());
  }

  function build(f) {
    clearGroup(f.group);
    f.version++;
    f.fullRequested = false;
    f.hasFull = false;
    f.imageMat = null;

    const d = f.data;
    // Visitors see a clean wall where nothing hangs; the admin sees a "+" placeholder.
    if (!d && !adminMode) return;

    let w = EMPTY_SIZE.w;
    let h = EMPTY_SIZE.h;
    if (d) {
      const aspect = d.width / d.height;
      w = Math.min(f.slot.maxW, f.slot.maxH * aspect);
      h = w / aspect;
    } else {
      w = Math.min(w, f.slot.maxW);
    }
    const style = styles[d?.style] ?? styles.black;
    const matW = w + 2 * style.mat;
    const matH = h + 2 * style.mat;
    const outerW = matW + 2 * style.border;
    const outerH = matH + 2 * style.border;
    const front = style.depth;

    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(outerW * 1.42, outerH * 1.42), shadowMat);
    shadow.position.set(0, -0.035, 0.003);
    const border = new THREE.Mesh(new THREE.BoxGeometry(outerW, outerH, front), style.frameMat);
    border.position.z = front / 2;
    f.group.add(shadow, border);
    // Inner layer sitting just proud of the frame: the mat, or a darker lip on mat-less frames.
    const inner = style.mat ? style.matMat : style.lipMat;
    if (inner) {
      const pad = style.mat ? 0 : 0.03;
      const layer = new THREE.Mesh(new THREE.BoxGeometry(matW + pad, matH + pad, 0.01), inner);
      layer.position.z = front - 0.003;
      f.group.add(layer);
    }

    let imageMat = plusMat;
    if (d) {
      imageMat = new THREE.MeshBasicMaterial({ color: 0xe6e3dc, toneMapped: false });
      f.imageMat = imageMat;
      loadImage(f, d.thumb, false);
    }
    const image = new THREE.Mesh(new THREE.PlaneGeometry(w, h), imageMat);
    image.position.z = front + 0.004;
    f.group.add(image);

    if (d?.title) {
      const lw = 0.42;
      const lh = 0.144;
      const label = new THREE.Mesh(
        new THREE.PlaneGeometry(lw, lh),
        new THREE.MeshStandardMaterial({ map: labelTexture(d.title), roughness: 0.9 }),
      );
      if (f.slot.labelBelow) label.position.set(0, -(outerH / 2 + 0.16), 0.004);
      else label.position.set(outerW / 2 + 0.14 + lw / 2, -outerH / 2 + 0.28, 0.004);
      f.group.add(label);
    }
  }

  const rails = new Map();
  for (const slot of FRAME_SLOTS) {
    const group = new THREE.Group();
    group.position.set(...slot.position);
    group.rotation.y = slot.rotY;
    group.userData.slotId = slot.id;
    framesRoot.add(group);
    const normal = new THREE.Vector3(0, 0, 1).applyAxisAngle(UP, slot.rotY);
    const lamp = group.position.clone().addScaledVector(normal, slot.lightOffset).setY(lampY);
    const f = { slot, group, center: group.position.clone(), normal, lamp, data: null, version: 0 };
    frames.set(slot.id, f);
    build(f);

    // One ceiling rail per row of lamps, running the length of that section only.
    const alongX = Math.abs(normal.z) > 0.5;
    const at = alongX ? lamp.z : lamp.x;
    rails.set(`${slot.section}|${alongX}|${at.toFixed(2)}`, { section: slot.section, alongX, at });
  }

  // Lamps are instanced: three draw calls for every fixture in the building.
  const all = [...frames.values()];
  const heads = new THREE.InstancedMesh(lampGeo, trackMat, all.length);
  const lenses = new THREE.InstancedMesh(lensGeo, glowMat, all.length);
  const stems = new THREE.InstancedMesh(stemGeo, trackMat, all.length);
  const dummy = new THREE.Object3D();
  all.forEach((f, i) => {
    const away = f.lamp.clone().sub(f.center).normalize();
    dummy.position.copy(f.lamp);
    dummy.quaternion.setFromUnitVectors(UP, away); // head tilted toward its frame
    dummy.updateMatrix();
    heads.setMatrixAt(i, dummy.matrix);
    dummy.position.copy(f.lamp).addScaledVector(away, -0.087);
    dummy.lookAt(f.center);
    dummy.updateMatrix();
    lenses.setMatrixAt(i, dummy.matrix);
    dummy.position.set(f.lamp.x, (H + lampY + 0.08) / 2, f.lamp.z);
    dummy.quaternion.identity();
    dummy.updateMatrix();
    stems.setMatrixAt(i, dummy.matrix);
  });
  for (const m of [heads, lenses, stems]) {
    m.frustumCulled = false;
    fixtures.add(m);
  }

  for (const { section, alongX, at } of rails.values()) {
    const s = sections.get(section).def;
    const rail = new THREE.Mesh(
      alongX ? new THREE.BoxGeometry(s.x1 - s.x0 - 1, 0.04, 0.05) : new THREE.BoxGeometry(0.05, 0.04, D - 1),
      trackMat,
    );
    if (alongX) rail.position.set((s.x0 + s.x1) / 2, H - 0.02, at);
    else rail.position.set(at, H - 0.02, 0);
    fixtures.add(rail);
  }

  let spotTimer = 0;
  const occupied = [];

  function aimSpots(camPos) {
    occupied.length = 0;
    for (const f of frames.values()) if (f.data) occupied.push(f);
    occupied.sort((a, b) => a.center.distanceToSquared(camPos) - b.center.distanceToSquared(camPos));
    spots.forEach((s, i) => {
      const f = occupied[i];
      if (!f) return (s.intensity = 0);
      s.position.copy(f.lamp);
      s.target.position.copy(f.center);
      s.target.updateMatrixWorld();
      s.intensity = SPOT_INTENSITY;
    });
  }

  const api = {
    onThumb: null, // called each time a thumbnail finishes loading (or fails)
    floor,
    // Everything a click-ray can hit; walls are included so they hide frames behind them.
    pickTargets: [framesRoot, boardsRoot, shell],

    getFrame: (slotId) => frames.get(slotId)?.data ?? null,

    // Section boards: { title, text }. Empty values fall back to the defaults.
    getSection: (id) => (sections.has(id) ? sectionText(id) : null),
    setSection(id, data) {
      const s = sections.get(id);
      if (!s) return;
      s.data = data || {};
      refreshSection(id);
    },

    setFrame(slotId, data) {
      const f = frames.get(slotId);
      if (!f) return;
      f.data = data || null;
      build(f);
      spotTimer = 0;
    },

    setAdminMode(on) {
      if (adminMode === on) return;
      adminMode = on;
      for (const f of frames.values()) if (!f.data) build(f);
    },

    update(camPos, dt) {
      for (const f of frames.values()) {
        if (f.data && !f.fullRequested && f.center.distanceTo(camPos) < FULL_RES_DISTANCE) {
          f.fullRequested = true;
          loadImage(f, f.data.file, true);
        }
      }
      spotTimer -= dt;
      if (spotTimer <= 0) {
        spotTimer = 0.3;
        aimSpots(camPos);
      }
    },

    // Keep the player inside the room and out of walls and benches (AABB push-out).
    clampPosition(pos) {
      const r = PLAYER_RADIUS;
      pos.x = THREE.MathUtils.clamp(pos.x, X0 + r, X1 - r);
      pos.z = THREE.MathUtils.clamp(pos.z, -D / 2 + r, lobbyBack - r);
      for (const o of obstacles) {
        const dx = pos.x - o.x;
        const dz = pos.z - o.z;
        const pushX = o.hx + r - Math.abs(dx);
        const pushZ = o.hz + r - Math.abs(dz);
        if (pushX <= 0 || pushZ <= 0) continue;
        if (pushX < pushZ) pos.x = o.x + Math.sign(dx || 1) * (o.hx + r);
        else pos.z = o.z + Math.sign(dz || 1) * (o.hz + r);
      }
      return pos;
    },
  };
  return api;
}
