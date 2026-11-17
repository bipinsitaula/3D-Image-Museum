// Single source of truth for the building and its frame slots.
// Used by the client (to build the rooms) and the server (to validate ids).
// Units are metres; x runs along the building, z across it, north = -z.
//
// Five sections stand in a row from west to east, joined by doorways in the
// middle of the walls between them:
//
//   [ s1 ] | [ s2 ] | [   s3 main hall   ] | [ s4 ] | [ s5 ]

export const ROOM = { depth: 16, height: 5.2 };
export const DOOR = { width: 3.6, height: 3.0 };

// Freestanding walls stop short of the ceiling, like temporary exhibition walls.
export const PARTITION_HEIGHT = 3.7;

// Text shown on a section's boards until the curator changes it.
export const SECTIONS = [
  { id: 's1', x0: -59.8, x1: -37.8, title: 'Section 1', text: '' },
  { id: 's2', x0: -37.4, x1: -15.4, title: 'Section 2', text: '' },
  { id: 's3', x0: -15, x1: 15, title: 'Main Hall', text: '' },
  { id: 's4', x0: 15.4, x1: 37.4, title: 'Section 4', text: '' },
  { id: 's5', x0: 37.8, x1: 59.8, title: 'Section 5', text: '' },
];
export const SECTION_IDS = new Set(SECTIONS.map((s) => s.id));
export const SECTION_LIMITS = { title: 60, text: 400 };
export const BUILDING = { x0: SECTIONS[0].x0, x1: SECTIONS.at(-1).x1 };

// Walls between neighbouring sections; each has one doorway centred on z = 0.
export const DIVIDERS = SECTIONS.slice(0, -1).map((s, i) => ({
  x0: s.x1,
  x1: SECTIONS[i + 1].x0,
  west: s.id,
  east: SECTIONS[i + 1].id,
}));

const mid = (id) => {
  const s = SECTIONS.find((sec) => sec.id === id);
  return (s.x0 + s.x1) / 2;
};
const [C1, C2, C4, C5] = ['s1', 's2', 's4', 's5'].map(mid);

// Freestanding walls. axis 'x' runs east-west (frames face north / south);
// axis 'z' runs north-south (frames face west / east).
export const PARTITIONS = [
  // Main hall
  { id: 'a', section: 's3', axis: 'x', x: -7.6, z: -1.9, length: 6, thickness: 0.5, framesPerSide: 2 },
  { id: 'b', section: 's3', axis: 'x', x: 7.8, z: -1.9, length: 4, thickness: 0.5, framesPerSide: 1 },
  { id: 'c', section: 's3', axis: 'x', x: 0, z: 4, length: 16, thickness: 0.5, framesPerSide: 4 },
  // Section 2: two long walls either side of a central aisle
  { id: 's2-p1', section: 's2', axis: 'x', x: C2, z: -3.4, length: 11, thickness: 0.5, framesPerSide: 3 },
  { id: 's2-p2', section: 's2', axis: 'x', x: C2, z: 3.4, length: 11, thickness: 0.5, framesPerSide: 3 },
  // Section 4: two cross walls making four bays
  { id: 's4-p1', section: 's4', axis: 'z', x: C4, z: -5.3, length: 5.4, thickness: 0.5, framesPerSide: 2, maxW: 1.6 },
  { id: 's4-p2', section: 's4', axis: 'z', x: C4, z: 5.3, length: 5.4, thickness: 0.5, framesPerSide: 2, maxW: 1.6 },
];

// Solid blocks. height 0 = floor to ceiling.
export const BLOCKS = [
  { id: 'p', section: 's3', x: 0, z: -1.9, width: 1.3, depth: 2.0, height: 0 }, // main hall pillar
  { id: 's5-c', section: 's5', x: C5, z: 0, width: 5, depth: 5, height: PARTITION_HEIGHT }, // section 5 centre block
];

export const BENCH_SIZE = { length: 3.2, depth: 0.7, height: 0.45 };
export const BENCHES = [
  { x: -7.6, z: -5 },
  { x: 0, z: -5 },
  { x: 7.6, z: -5 },
  { x: 0, z: 1.1 },
  { x: C1, z: -2.6 },
  { x: C1, z: 2.6 },
  { x: C5, z: -5.3 },
  { x: C5, z: 5.3 },
];

// Hanging label boards (double-sided, facing east and west), suspended from
// the ceiling a few metres inside each doorway, high enough to walk under.
// They show the section's title and text; the curator clicks one to edit it.
export const BOARD_SIZE = { width: 2.6, height: 1.3, thickness: 0.06, bottom: 2.4 };
const INSIDE_DOOR = 4.5;
export const BOARDS = [
  { section: 's1', x: SECTIONS[0].x1 - INSIDE_DOOR, z: 0 },
  { section: 's2', x: SECTIONS[1].x0 + INSIDE_DOOR, z: 0 },
  { section: 's2', x: SECTIONS[1].x1 - INSIDE_DOOR, z: 0 },
  { section: 's3', x: -9.5, z: 1 },
  { section: 's3', x: 10.6, z: 1 },
  { section: 's4', x: SECTIONS[3].x0 + INSIDE_DOOR, z: 0 },
  { section: 's4', x: SECTIONS[3].x1 - INSIDE_DOOR, z: 0 },
  { section: 's5', x: SECTIONS[4].x0 + INSIDE_DOOR, z: 0 },
];

// The way in: a doorway in the middle of the main hall's south wall, reached
// from a lobby outside it. Visitors start in the lobby, facing the entrance.
export const ENTRANCE = { width: 5, height: 3.2, wallThickness: 0.4, glassPanel: 1.25 };
export const LOBBY = { halfWidth: 10, depth: 9 };
export const START = { x: 0, z: ROOM.depth / 2 + ENTRANCE.wallThickness + 6.2, yaw: 0 };

// ---- frame slots -------------------------------------------------------------

const EYE_LEVEL = 1.7;
const slots = [];

// rotY turns the frame to face into the room (a frame faces +z at rotY 0).
const FACE = { south: 0, north: Math.PI, east: Math.PI / 2, west: -Math.PI / 2 };

function slot(section, id, x, z, rotY, extra = {}) {
  slots.push({
    id,
    section,
    position: [x, EYE_LEVEL, z],
    rotY,
    maxW: 2.0, // largest image size inside the mat
    maxH: 1.5,
    lightOffset: 2.05, // how far in front of the wall its ceiling spot hangs
    ...extra,
  });
}

const halfD = ROOM.depth / 2;

// Main hall — these ids predate the other sections, so they have no prefix.
[-12, -6, 0, 6, 12].forEach((x, i) => slot('s3', `n${i + 1}`, x, -halfD, FACE.south));
// South wall: the middle position (id "s3") is where the entrance is.
[-12, -6, 0, 6, 12].forEach((x, i) => x !== 0 && slot('s3', `s${i + 1}`, x, halfD, FACE.north));
[-4, 4].forEach((z, i) => slot('s3', `w${i + 1}`, -15, z, FACE.east));
[-4, 4].forEach((z, i) => slot('s3', `e${i + 1}`, 15, z, FACE.west));

// Perimeter walls of the four side sections.
const BESIDE_DOOR = [-4.6, 4.6];
const END_WALL = [-4.8, 0, 4.8];
for (const s of SECTIONS) {
  if (s.id === 's3') continue;
  const cx = (s.x0 + s.x1) / 2;
  [-8, -3.2, 3.2, 8].forEach((dx, i) => {
    slot(s.id, `${s.id}-n${i + 1}`, cx + dx, -halfD, FACE.south);
    slot(s.id, `${s.id}-s${i + 1}`, cx + dx, halfD, FACE.north);
  });
  (s.x0 === BUILDING.x0 ? END_WALL : BESIDE_DOOR).forEach((z, i) =>
    slot(s.id, `${s.id}-w${i + 1}`, s.x0, z, FACE.east),
  );
  (s.x1 === BUILDING.x1 ? END_WALL : BESIDE_DOOR).forEach((z, i) =>
    slot(s.id, `${s.id}-e${i + 1}`, s.x1, z, FACE.west),
  );
}

for (const p of PARTITIONS) {
  const step = p.length / p.framesPerSide;
  const extra = p.maxW ? { maxW: p.maxW } : {};
  for (let i = 0; i < p.framesPerSide; i++) {
    const along = (i - (p.framesPerSide - 1) / 2) * step;
    if (p.axis === 'x') {
      slot(p.section, `${p.id}n${i + 1}`, p.x + along, p.z - p.thickness / 2, FACE.north, extra);
      slot(p.section, `${p.id}s${i + 1}`, p.x + along, p.z + p.thickness / 2, FACE.south, extra);
    } else {
      slot(p.section, `${p.id}w${i + 1}`, p.x - p.thickness / 2, p.z + along, FACE.west, extra);
      slot(p.section, `${p.id}e${i + 1}`, p.x + p.thickness / 2, p.z + along, FACE.east, extra);
    }
  }
}

// Main hall pillar: narrow faces, so smaller frames with the label underneath.
const pillar = BLOCKS[0];
const pillarFrame = { maxW: 1.15, maxH: 1.5, labelBelow: true };
slot('s3', 'pw1', pillar.x - pillar.width / 2, pillar.z, FACE.west, pillarFrame);
slot('s3', 'pe1', pillar.x + pillar.width / 2, pillar.z, FACE.east, pillarFrame);

// Section 5 centre block: one large picture on each face.
const cube = BLOCKS[1];
slot('s5', 's5-cw1', cube.x - cube.width / 2, cube.z, FACE.west);
slot('s5', 's5-ce1', cube.x + cube.width / 2, cube.z, FACE.east);
slot('s5', 's5-cn1', cube.x, cube.z - cube.depth / 2, FACE.north);
slot('s5', 's5-cs1', cube.x, cube.z + cube.depth / 2, FACE.south);

// Frame designs the admin can pick per picture. The look of each one is
// defined in client/src/gallery.js (STYLE_SPECS); ids must match.
export const FRAME_STYLES = [
  { id: 'black', label: 'Black' },
  { id: 'white', label: 'White' },
  { id: 'oak', label: 'Oak' },
  { id: 'gold', label: 'Gold' },
  { id: 'slim', label: 'Slim' },
  { id: 'canvas', label: 'Canvas' },
];
export const DEFAULT_FRAME_STYLE = 'black';
export const FRAME_STYLE_IDS = new Set(FRAME_STYLES.map((s) => s.id));

export const FRAME_SLOTS = slots;
export const SLOT_IDS = new Set(slots.map((s) => s.id));
