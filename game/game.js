"use strict";

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------
const VIEW_H = 720;              // logical screen height; width follows aspect
const GROUND_Y = 660;            // top of the grass
const GRAVITY = 2100;
const JUMP_V = 900;              // initial jump speed (px/s)
const JUMP_CUT = 0.45;           // vy multiplier when jump is released early
const RUN_SPEED = 320;
const RUN_ACCEL = 2600;
const AIR_ACCEL = 1700;
const MAX_FALL = 1200;
const COYOTE = 0.1;              // can still jump this long after leaving a branch
const JUMP_BUFFER = 0.12;        // jump pressed slightly before landing still counts
const STEP = 1 / 120;            // fixed physics step

// Těžká (hard) mode only
const HUNGER_TIME = 20;          // seconds from full to empty at the start
const HUNGER_RAMP = 240;         // hunger gets this much faster every N seconds played
const WIND_PUSH = 60;            // air speed the strongest wind adds (px/s)
const RAIN_GRIP = 0.2;           // ground grip in full rain (1 = dry)
const CRACK_TIME = 1.1;          // seconds a cracked branch holds you

const SQUIRREL_W = 112;          // drawn width of the squirrel
const HIT_W = 40, HIT_H = 70;    // squirrel body hitbox
const NUT_SIZE = 38;

// points per nut sprite; rarer nuts are worth more
const NUT_TYPES = [
  { img: "nut-1", points: 10, weight: 30, color: "#d97b1f" },
  { img: "nut-3", points: 10, weight: 30, color: "#b9561d" },
  { img: "nut-4", points: 20, weight: 18, color: "#c9852b" },
  { img: "nut-5", points: 30, weight: 12, color: "#9b4a16" },
  { img: "nut-2", points: 50, weight: 6, color: "#e29a1b" },
];
const LEAVES = ["leaf-1", "leaf-2", "leaf-3", "leaf-4", "leaf-5"];
const GRASS_TUFTS = ["grass-1", "grass-2", "grass-3", "grass-4", "grass-5"];
const TREES = ["tree-1", "tree-2", "tree-3", "tree-4"];

// squirrel sprite landmarks (fractions of the unflipped sprite)
const SQ_BODY_X = 0.28;          // body centre; the tail sticks out to the right
const SQ_EYES = [[0.222, 0.24], [0.376, 0.256]];
const SQ_HEAD = [0.3, 0.17];
const SQ_PAW = [0.1, 0.57];      // front paw, holds the umbrella
const UMBRELLA_W = 118;

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------
const canvas = document.getElementById("game");
const mainCtx = canvas.getContext("2d");
let ctx = mainCtx;               // draw target; swapped to render offscreen layers
// offscreen layer for scenery that gets tinted by night / weather
const layer = document.createElement("canvas");
const layerCtx = layer.getContext("2d");
let viewW = 1280, scale = 1;

function resize() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(window.innerWidth * dpr);
  canvas.height = Math.round(window.innerHeight * dpr);
  scale = canvas.height / VIEW_H;
  viewW = Math.min(Math.max(canvas.width / scale, 900), 1800);
  // very narrow screens: letterbox vertically by fitting width instead
  if (canvas.width / scale < 900) scale = canvas.width / viewW;
  layer.width = canvas.width;
  layer.height = canvas.height;
}
window.addEventListener("resize", resize);
resize();

const images = {};
function loadImages() {
  return Promise.all(Object.keys(SPRITE_DATA).map(name => new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => { images[name] = img; resolve(); };
    img.onerror = () => reject(new Error("failed to load " + name));
    img.src = "sprites/" + name + ".png";
  })));
}

const rand = (a, b) => a + Math.random() * (b - a);
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
function pickWeighted(arr) {
  let r = Math.random() * arr.reduce((s, x) => s + x.weight, 0);
  for (const x of arr) if ((r -= x.weight) < 0) return x;
  return arr[arr.length - 1];
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
const keys = { left: false, right: false, jump: false };
let jumpPressedAt = -1;          // time of the last jump press (for buffering)
let anyPress = false;            // used to start / restart

// game mode: "easy" (Lehká) or "hard" (Těžká)
const MODES = {
  easy: { label: "Lehká", hint: "klidné skákání", record: "squirrel-best" },
  hard: { label: "Těžká", hint: "hlad · praskající větve · vítr · klouzání", record: "squirrel-best-hard" },
};
let mode = "easy";
try { if (localStorage.getItem("squirrel-mode") === "hard") mode = "hard"; } catch {}
const hard = () => mode === "hard";
let modeButtons = [];            // [{ mode, x, y, w, h }] in logical coords, set while drawn

function setMode(m) {
  mode = m;
  try { localStorage.setItem("squirrel-mode", m); } catch {}
  loadBest();
}

const choosingMode = () => state === "title" || (state === "dizzy" && stateTime > 1.0);

// pick a mode button under a pointer (client coords); true if one was hit
function pressModeButton(clientX, clientY) {
  if (!choosingMode()) return false;
  const dpr = window.devicePixelRatio || 1;
  const x = (clientX * dpr - (canvas.width - viewW * scale) / 2) / scale;
  const y = (clientY * dpr - (canvas.height - VIEW_H * scale) / 2) / scale;
  const b = modeButtons.find(b => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h);
  if (b) setMode(b.mode);
  return !!b;
}

const KEYMAP = {
  ArrowLeft: "left", KeyA: "left",
  ArrowRight: "right", KeyD: "right",
  ArrowUp: "jump", KeyW: "jump", Space: "jump",
};
window.addEventListener("keydown", e => {
  if (e.code === "KeyM") { audio.toggleMute(); return; }
  if (e.code === "KeyH") { music.toggle(); return; }
  if (choosingMode()) {
    if (e.code === "ArrowLeft" || e.code === "KeyA" || e.code === "Digit1") setMode("easy");
    if (e.code === "ArrowRight" || e.code === "KeyD" || e.code === "Digit2") setMode("hard");
  }
  const k = KEYMAP[e.code];
  if (k) {
    e.preventDefault();
    if (k === "jump" && !keys.jump) jumpPressedAt = time;
    keys[k] = true;
  }
  if (!e.repeat && (k === "jump" || e.code === "Enter" || e.code === "KeyR")) anyPress = true;
});
window.addEventListener("keyup", e => {
  const k = KEYMAP[e.code];
  if (k) keys[k] = false;
});

// touch: left third = run left, middle = run right, right third = jump
const touches = new Map();
function touchZone(x) {
  const w = window.innerWidth;
  return x < w * 0.22 ? "left" : x < w * 0.5 ? "right" : "jump";
}
function syncTouchKeys() {
  const zones = new Set(touches.values());
  keys.left = zones.has("left");
  keys.right = zones.has("right");
  const jump = zones.has("jump");
  if (jump && !keys.jump) jumpPressedAt = time;
  keys.jump = jump;
}
let isTouch = false;
canvas.addEventListener("touchstart", e => {
  e.preventDefault();
  isTouch = true;
  audio.unlock();
  for (const t of e.changedTouches) {
    pressModeButton(t.clientX, t.clientY);
    touches.set(t.identifier, touchZone(t.clientX));
  }
  syncTouchKeys();
  anyPress = true;
}, { passive: false });
const touchEnd = e => {
  e.preventDefault();
  for (const t of e.changedTouches) touches.delete(t.identifier);
  syncTouchKeys();
};
canvas.addEventListener("touchend", touchEnd, { passive: false });
canvas.addEventListener("touchcancel", touchEnd, { passive: false });
canvas.addEventListener("mousedown", e => {
  pressModeButton(e.clientX, e.clientY);
  anyPress = true;
  audio.unlock();
});
window.addEventListener("keydown", () => audio.unlock());

// ---------------------------------------------------------------------------
// Sound: tiny synthesized blips, no audio files needed
// ---------------------------------------------------------------------------
const audio = {
  ctx: null,
  muted: false,
  unlock() {
    if (!this.ctx) {
      try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return; }
    }
    if (this.ctx.state === "suspended") this.ctx.resume();
  },
  toggleMute() { this.muted = !this.muted; },
  tone(freq, endFreq, dur, type = "square", vol = 0.08, delay = 0) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(endFreq, t + dur);
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain).connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + dur);
  },
  jump() { this.tone(300, 620, 0.14, "square", 0.05); },
  nut(points) {
    const base = 700 + points * 6;
    this.tone(base, base, 0.07, "triangle", 0.1);
    this.tone(base * 1.5, base * 1.5, 0.12, "triangle", 0.1, 0.07);
  },
  land() { this.tone(160, 90, 0.06, "sine", 0.08); },
  dizzy() {
    this.tone(500, 120, 0.6, "sawtooth", 0.06);
    for (let i = 0; i < 4; i++) this.tone(1200, 1500, 0.08, "triangle", 0.05, 0.45 + i * 0.12);
  },
  noise() {
    if (!this.noiseBuf) {
      const len = this.ctx.sampleRate * 2;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    return src;
  },
  // looping rain and wind noise, volume follows the weather
  ambience(rain, wind) {
    if (!this.ctx) return;
    if (!this.loops) {
      this.loops = {};
      for (const [name, type, freq] of [["rain", "highpass", 1200], ["wind", "lowpass", 500]]) {
        const src = this.noise();
        src.loop = true;
        const filter = this.ctx.createBiquadFilter();
        filter.type = type;
        filter.frequency.value = freq;
        const gain = this.ctx.createGain();
        gain.gain.value = 0;
        src.connect(filter).connect(gain).connect(this.ctx.destination);
        src.start();
        this.loops[name] = { gain, filter };
      }
    }
    const t = this.ctx.currentTime;
    const on = this.muted ? 0 : 1;
    this.loops.rain.gain.gain.setTargetAtTime(on * rain * 0.06, t, 0.3);
    const gust = 0.7 + 0.3 * Math.sin(t * 1.3);
    this.loops.wind.gain.gain.setTargetAtTime(on * Math.max(0, wind - 0.2) * 0.12 * gust, t, 0.3);
    this.loops.wind.filter.frequency.setTargetAtTime(300 + 400 * gust, t, 0.3);
  },
  // owl: two soft, slightly falling "hoo" notes
  // owl: a tawny-owl call "hú… hú-hú-húúú", about 2.5 s long
  hoot() {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    for (const [at, dur, f0, f1] of [[0, 0.6, 400, 380], [0.9, 0.24, 425, 405], [1.2, 0.24, 425, 405], [1.5, 1.05, 415, 345]]) {
      this.owlNote(t + at, dur, f0, f1, 0.15);
    }
  },
  // one soft, breathy owl note: sine with a quiet overtone and a slow wobble
  owlNote(t, dur, f0, f1, vol) {
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(vol, t + Math.min(0.08, dur * 0.3));
    gain.gain.setValueAtTime(vol, t + dur * 0.6);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    gain.connect(this.ctx.destination);
    const wobble = this.ctx.createOscillator();
    const depth = this.ctx.createGain();
    wobble.frequency.value = 5;
    depth.gain.value = 6;
    wobble.connect(depth);
    for (const [mult, level] of [[1, 1], [2, 0.18]]) {
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(f0 * mult, t);
      osc.frequency.exponentialRampToValueAtTime(f1 * mult, t + dur);
      depth.connect(osc.frequency);
      g.gain.value = level;
      osc.connect(g).connect(gain);
      osc.start(t);
      osc.stop(t + dur + 0.02);
    }
    wobble.start(t);
    wobble.stop(t + dur + 0.02);
  },
  // bunny: a tiny springy "boing"
  boing() {
    this.tone(320, 760, 0.12, "triangle", 0.045);
    this.tone(760, 520, 0.1, "triangle", 0.03, 0.11);
  },
  creak() {
    this.tone(140, 95, 0.35, "sawtooth", 0.035);
    this.tone(110, 150, 0.25, "sawtooth", 0.025, 0.3);
  },
  snap() {
    this.tone(260, 50, 0.25, "square", 0.06);
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const src = this.noise();
    const filter = this.ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 1800;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.25, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    src.connect(filter).connect(gain).connect(this.ctx.destination);
    src.start(t);
    src.stop(t + 0.2);
  },
  thunder(delay) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime + delay;
    const src = this.noise();
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 180;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.5, t + 0.08);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 1.8);
    src.connect(filter).connect(gain).connect(this.ctx.destination);
    src.start(t);
    src.stop(t + 1.9);
  },
};

// ---------------------------------------------------------------------------
// World generation
// ---------------------------------------------------------------------------
let trees, platforms, nuts, treeLeaves, fallingLeaves, popups, particles;
let player, camX, score, nutCount, best, state, stateTime, treesBuilt;
let time = 0;
let umbrellaOpen = 0;            // 0 closed .. 1 open; opens while it rains
let hunger = 1;                  // hard mode: 1 full .. 0 exhausted
let hungerWarned = false;
let gameOverReason = "fall";     // "fall" or "hunger"
let brokenBranches = [];         // pieces of broken branches falling down

// best score of the current mode
function loadBest() {
  try { best = Number(localStorage.getItem(MODES[mode].record)) || 0; } catch { best = 0; }
}
loadBest();

function makeTree(name, height, x) {
  const d = SPRITE_DATA[name];
  const w = d.w * height / d.h;
  const top = GROUND_Y + 14 - height;    // bury the trunk base a bit in the grass
  const tree = { name, x, top, w, h: height, platforms: [] };
  for (const b of d.branches) {
    // ignore the trunk part so you can't stand "inside" the trunk on the far side
    let x0 = x + b.x0 * w, x1 = x + b.x1 * w;
    // the part of the drawing that breaks off a cracked branch: from the trunk
    // to the tip (fractions of the sprite)
    const px0 = b.side === "right" ? d.trunk[1] : b.x0;
    const px1 = b.side === "right" ? b.x1 : d.trunk[0];
    const py0 = Math.max(0, b.y - 0.02), py1 = Math.min(1, b.y + b.thick + 0.02);
    const piece = {
      sx: px0 * d.w, sy: py0 * d.h, sw: (px1 - px0) * d.w, sh: (py1 - py0) * d.h,
      x: x + px0 * w, y: top + py0 * height, w: (px1 - px0) * w, h: (py1 - py0) * height,
      by: top + b.y * height, bh: b.thick * height,   // the wood itself, without padding
    };
    tree.platforms.push({ x0, x1, y: top + b.y * height + 3, side: b.side, tree, piece });
  }
  return tree;
}

// how far the squirrel can travel horizontally while ending `rise` px higher
function reachFor(rise, speed = RUN_SPEED) {
  const disc = JUMP_V * JUMP_V - 2 * GRAVITY * rise;
  if (disc < 0) return -Infinity;
  const t = (JUMP_V + Math.sqrt(disc)) / GRAVITY;
  return speed * t;
}

// hard mode: some branches are cracked and break shortly after you land.
// Never the branch you arrive on or the one you take off from towards the
// next tree, so the way forward always holds.
function crackBranches(tree, takeoff) {
  if (!hard()) return;
  const chance = 0.3 + 0.25 * Math.min(treesBuilt / 30, 1);
  for (const pl of tree.platforms) {
    pl.fragile = pl !== takeoff && pl !== tree.entry && Math.random() < chance;
  }
  // cracked branches are dead: no leaves on them
  treeLeaves = treeLeaves.filter(l => !(l.platform && l.platform.fragile));
}

function addTree(tree) {
  trees.push(tree);
  platforms.push(...tree.platforms);
  decorateTree(tree);
}

function nextTree() {
  const prev = trees[trees.length - 1];
  const difficulty = Math.min(treesBuilt / 30, 1);
  for (let attempt = 0; attempt < 40; attempt++) {
    const name = pick(TREES);
    const height = rand(470, 610);
    const probe = makeTree(name, height, 0);
    const gap = rand(50, 120 + 80 * difficulty) * (attempt < 20 ? 1 : 0.5);
    // try a random pair of branches (from, to) and position the new tree so
    // the jump between them has the chosen gap. Only take off from branches
    // reachable from where the squirrel landed: that one or any lower one.
    const from = pick(prev.platforms.filter(pl => pl.y >= prev.entry.y - 1));
    const to = pick(probe.platforms);
    const rise = from.y - to.y;
    if (rise > JUMP_V * JUMP_V / (2 * GRAVITY) - 45) continue;   // too high
    // in hard mode assume the strongest headwind slows the jump
    const speed = hard() ? RUN_SPEED - WIND_PUSH * 1.2 : RUN_SPEED;
    if (gap > reachFor(Math.max(rise, 0) + 30, speed) * 0.75) continue;  // too far
    const x = from.x1 + gap - to.x0;
    // keep trees from overlapping too much visually
    const prevTrunk = prev.x + prev.w * SPRITE_DATA[prev.name].trunk[1];
    const newTrunk = x + probe.w * SPRITE_DATA[name].trunk[0];
    if (newTrunk - prevTrunk < 260) continue;
    const tree = makeTree(name, height, x);
    addTree(tree);
    treesBuilt++;
    const target = tree.platforms[probe.platforms.indexOf(to)];
    tree.entry = target;
    crackBranches(prev, from);
    if (treesBuilt > 1) maybePlaceOwl(prev);   // not on the starting tree (counted already)
    placeNuts(tree, from, target);
    return;
  }
  // fallback: a guaranteed-easy tree right next to the previous one
  const tree = makeTree("tree-1", 520, prev.x + prev.w - 60);
  tree.entry = tree.platforms[tree.platforms.length - 1];
  addTree(tree);
  treesBuilt++;
  placeNuts(tree, null, null);
}

function addNut(x, y) {
  const type = pickWeighted(NUT_TYPES);
  nuts.push({ x, y, type, phase: Math.random() * Math.PI * 2, taken: false });
}

function placeNuts(tree, from, to) {
  // a few nuts resting above branches
  for (const p of tree.platforms) {
    if (Math.random() < 0.35) continue;
    const n = 1 + Math.floor(Math.random() * 3);
    const len = p.x1 - p.x0;
    for (let i = 0; i < n; i++) {
      addNut(p.x0 + len * (i + 1) / (n + 1), p.y - 34);
    }
  }
  // an arc of nuts along the jump into this tree
  if (from && to && Math.random() < 0.7) {
    const x0 = from.x1 - 20, x1 = to.x0 + 30;
    const y0 = from.y - 40, y1 = to.y - 40;
    const peak = Math.min(y0, y1) - 110;
    for (let i = 1; i <= 3; i++) {
      const t = i / 4;
      const x = x0 + (x1 - x0) * t;
      const y = (1 - t) * (1 - t) * y0 + 2 * (1 - t) * t * peak + t * t * y1;
      addNut(x, y);
    }
  }
}

function decorateTree(tree) {
  // foliage: pure decoration, never collides
  const leaf = (x, y, size, front, platform = null) => treeLeaves.push({
    img: pick(LEAVES), x, y, size,
    rot: rand(-1.4, 1.4),
    phase: Math.random() * 6,
    front,
    platform,
  });
  const trunk = SPRITE_DATA[tree.name].trunk;
  const trunkX = tree.x + tree.w * (trunk[0] + trunk[1]) / 2;

  for (const p of tree.platforms) {
    const tip = p.side === "left" ? p.x0 : p.x1;
    const base = p.side === "left" ? p.x1 : p.x0;
    // leaves all along the branch, denser towards the tip
    const len = Math.abs(tip - base);
    for (let d = 20; d < len; d += rand(14, 24)) {
      const x = base + Math.sign(tip - base) * d;
      const t = d / len;
      leaf(x + rand(-8, 8), p.y - rand(4, 24 + 16 * t), rand(24, 36), false, p);
      // some hang below the branch; only these may overlap the squirrel's
      // layer, as it walks on top of the branch
      if (Math.random() < 0.6) {
        const below = p.y + rand(8, 22 + 18 * t);
        leaf(x + rand(-8, 8), below, rand(22, 34), Math.random() < 0.35, p);
      }
    }
    // a bushy cluster at the tip
    for (let i = 0; i < 7; i++) {
      leaf(tip + rand(-30, 26) * Math.sign(tip - base), p.y + rand(-38, 22), rand(28, 44), false, p);
    }
  }
  // crown at the top of the trunk
  for (let i = 0; i < 12; i++) {
    const a = rand(0, Math.PI * 2), r = rand(0, 48);
    leaf(trunkX + Math.cos(a) * r, tree.top + 10 + Math.sin(a) * r * 0.7, rand(30, 46), false);
  }
  // a few sprigs along the upper trunk
  for (let y = tree.top + 60; y < tree.top + tree.h * 0.6; y += rand(40, 70)) {
    leaf(trunkX + rand(-1, 1) * 22, y, rand(22, 32), false);
  }
}

function spawnFallingLeaf(initial) {
  // in strong wind, leaves also blow in from the upwind side of the screen
  const fromSide = !initial && Math.abs(sky.windX) > 0.4 && Math.random() < 0.5;
  fallingLeaves.push({
    img: pick(LEAVES),
    x: fromSide ? camX + (sky.windX > 0 ? -60 : viewW + 60) : camX + rand(-100, viewW + 300),
    y: initial ? rand(-50, GROUND_Y - 50) : fromSide ? rand(0, GROUND_Y - 120) : rand(-80, -30),
    vy: rand(35, 75),
    vx: rand(-40, -10),
    size: rand(22, 40),
    rot: rand(0, Math.PI * 2),
    spin: rand(-1.5, 1.5),
    phase: Math.random() * 6,
    front: Math.random() < 0.3,
  });
}

// ---------------------------------------------------------------------------
// Game state
// ---------------------------------------------------------------------------
function reset() {
  resetNpcs();
  trees = []; platforms = []; nuts = []; treeLeaves = []; fallingLeaves = [];
  popups = []; particles = [];
  score = 0; nutCount = 0; treesBuilt = 0; camX = 0; umbrellaOpen = 0;
  hunger = 1; hungerWarned = false; gameOverReason = "fall"; brokenBranches = [];

  const first = makeTree("tree-1", 540, 40);
  addTree(first);
  const start = first.platforms.reduce((a, b) => (b.side === "right" && b.y > a.y ? b : a));
  first.entry = start;
  player = {
    x: start.x0 + 70, y: start.y,           // x = body centre, y = feet
    vx: 0, vy: 0,
    onGround: true, ground: start, lastGround: 0,
    facing: 1, squash: 0, runPhase: 0,
  };
  for (let i = 0; i < 4; i++) nextTree();
  resetSky();
  for (let i = 0; i < 14; i++) spawnFallingLeaf(true);
  stateTime = 0;
}

function setState(s) {
  state = s;
  stateTime = 0;
  anyPress = false;
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------
function update(dt) {
  time += dt;
  stateTime += dt;
  updateSky(dt);
  updateNpcs(dt);
  // the umbrella opens and closes with the rain, but not while lying dizzy on
  // the ground: an umbrella she held when she fell just stays lying there
  if (state !== "dizzy") {
    const wantUmbrella = sky.rain > 0.25 ? 1 : 0;
    umbrellaOpen += Math.sign(wantUmbrella - umbrellaOpen) * Math.min(Math.abs(wantUmbrella - umbrellaOpen), dt * 2.5);
  }

  if (state === "title") {
    if (anyPress) { startGame(); }
    updateLeaves(dt);
    return;
  }
  if (state === "dizzy") {
    updateDizzy(dt);
    updateLeaves(dt);
    updateEffects(dt);
    updateBrokenBranches(dt);
    if (stateTime > 1.0 && anyPress) startGame();
    anyPress = false;
    return;
  }
  anyPress = false;

  const p = player;
  // horizontal movement. Hard mode: wind pushes you in the air, and rain makes
  // branches slippery (less grip to speed up or stop)
  const dir = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
  const grip = hard() ? 1 - (1 - RAIN_GRIP) * smoothstep(0.2, 0.6, sky.rain) : 1;
  const accel = p.onGround ? RUN_ACCEL * grip : AIR_ACCEL;
  const push = hard() && !p.onGround ? sky.windX * WIND_PUSH : 0;
  const target = dir * RUN_SPEED + push;
  if (p.vx < target) p.vx = Math.min(target, p.vx + accel * dt);
  else if (p.vx > target) p.vx = Math.max(target, p.vx - accel * dt);
  if (dir) p.facing = dir;

  // jumping with coyote time and buffering
  if (p.onGround) p.lastGround = time;
  const buffered = jumpPressedAt >= 0 && time - jumpPressedAt < JUMP_BUFFER;
  if (buffered && time - p.lastGround < COYOTE) {
    p.vy = -JUMP_V;
    p.onGround = false;
    p.ground = null;
    p.lastGround = -1;
    jumpPressedAt = -1;
    p.squash = -0.25;
    audio.jump();
  }
  if (!keys.jump && p.vy < -200) p.vy *= Math.pow(JUMP_CUT, dt * 30);

  // walking off the end of a branch
  if (p.onGround && p.ground && (p.x + HIT_W / 2 < p.ground.x0 || p.x - HIT_W / 2 > p.ground.x1)) {
    p.onGround = false;
    p.ground = null;
  }

  // gravity + integrate
  if (!p.onGround) p.vy = Math.min(p.vy + GRAVITY * dt, MAX_FALL);
  const prevY = p.y;
  p.x += p.vx * dt;
  p.y += p.vy * dt;

  // can't go back: the left edge of the screen is a wall
  const minX = camX + HIT_W / 2 + 4;
  if (p.x < minX) { p.x = minX; if (p.vx < 0) p.vx = 0; }

  // one-way branch platforms: land only when falling through the top
  if (p.vy >= 0 && !p.onGround) {
    for (const pl of platforms) {
      if (p.x + HIT_W / 2 - 6 < pl.x0 || p.x - HIT_W / 2 + 6 > pl.x1) continue;
      if (prevY <= pl.y + 1 && p.y >= pl.y) {
        p.y = pl.y;
        p.vy = 0;
        p.onGround = true;
        p.ground = pl;
        p.squash = 0.3;
        audio.land();
        dust(p.x, p.y, 5);
        break;
      }
    }
  }

  if (p.onGround && Math.abs(p.vx) > 20) p.runPhase += dt * 14;
  // sliding on a wet branch sprays water
  if (p.onGround && grip < 0.7 && Math.abs(p.vx) > 90 && Math.sign(p.vx) !== dir && Math.random() < dt * 30) {
    particles.push({ x: p.x - Math.sign(p.vx) * 12, y: p.y - 2, vx: -p.vx * rand(0.1, 0.4), vy: rand(-160, -60),
      life: 0.35, t: 0, color: "rgba(140, 170, 220, 0.8)", size: rand(2, 4) });
  }

  // cracked branches give way a moment after you land on them
  if (p.onGround && p.ground && p.ground.fragile && p.ground.crackedAt === undefined) {
    p.ground.crackedAt = time;
    audio.creak();
  }
  for (const pl of platforms) {
    if (pl.crackedAt !== undefined && time - pl.crackedAt > CRACK_TIME) breakBranch(pl);
  }
  updateBrokenBranches(dt);

  // hard mode: hunger drains (faster the longer you play); nuts refill it
  if (hard()) {
    hunger -= dt / HUNGER_TIME * (1 + sky.clock / HUNGER_RAMP);
    if (hunger < 0.25 && !hungerWarned) { hungerWarned = true; showToast("Lískulka má hlad!"); }
    if (hunger > 0.4) hungerWarned = false;
  }
  p.squash *= Math.pow(0.0005, dt);

  // collect nuts
  for (const n of nuts) {
    if (n.taken) continue;
    const ny = n.y + Math.sin(time * 3 + n.phase) * 4;
    if (Math.abs(n.x - p.x) < HIT_W / 2 + NUT_SIZE / 2 - 4 &&
        ny > p.y - HIT_H - NUT_SIZE / 2 + 4 && ny < p.y + NUT_SIZE / 2) {
      n.taken = true;
      score += n.type.points;
      hunger = Math.min(1, hunger + 0.04 + n.type.points * 0.003);
      nutCount++;
      audio.nut(n.type.points);
      popups.push({ x: n.x, y: ny - 10, text: "+" + n.type.points, color: n.type.color, t: 0 });
      for (let i = 0; i < 8; i++) {
        const a = Math.random() * Math.PI * 2;
        particles.push({ x: n.x, y: ny, vx: Math.cos(a) * rand(60, 160), vy: Math.sin(a) * rand(60, 160) - 60,
          life: 0.5, t: 0, color: n.type.color, size: rand(3, 6) });
      }
    }
  }

  // fell to the ground: dizzy, game over
  if (p.y >= GROUND_Y) {
    p.y = GROUND_Y;
    p.vy = -260;            // little bounce
    p.vx *= 0.3;
    dust(p.x, GROUND_Y, 12);
    gameOver("fall");
  } else if (hunger <= 0) {
    // out of strength: the squirrel lets go and drops to the ground
    hunger = 0;
    p.onGround = false;
    p.ground = null;
    gameOver("hunger");
  }

  // camera follows forward only
  const targetCam = p.x - viewW * 0.38;
  if (targetCam > camX) camX += (targetCam - camX) * Math.min(1, dt * 6);

  // stream the world
  while (trees[trees.length - 1].x < camX + viewW + 600) nextTree();
  const forget = camX - 800;
  trees = trees.filter(t => t.x + t.w > forget);
  platforms = platforms.filter(pl => pl.x1 > forget);
  nuts = nuts.filter(n => n.x > forget && !(n.taken));
  treeLeaves = treeLeaves.filter(l => l.x > forget);

  updateLeaves(dt);
  updateEffects(dt);
}

function startGame() {
  reset();
  setState("play");
  jumpPressedAt = -1;
  if (hard()) showToast("Sbírej oříšky, jinak Lískulce dojdou síly!");
}

function gameOver(reason) {
  gameOverReason = reason;
  audio.dizzy();
  if (score > best) {
    best = score;
    try { localStorage.setItem(MODES[mode].record, String(best)); } catch {}
  }
  setState("dizzy");
}

function breakBranch(pl) {
  platforms = platforms.filter(x => x !== pl);
  pl.broken = true;
  if (player.ground === pl) { player.onGround = false; player.ground = null; }
  brokenBranches.push({ pl, x: 0, y: 0, vy: -60, rot: 0, spin: (pl.side === "right" ? 1 : -1) * rand(1.5, 3) });
  // its leaves come down with it
  for (const l of treeLeaves) {
    if (l.platform !== pl) continue;
    fallingLeaves.push({ img: l.img, x: l.x, y: l.y, vy: rand(80, 160), vx: rand(-40, 40), size: l.size,
      rot: l.rot, spin: rand(-3, 3), phase: l.phase, front: l.front });
  }
  treeLeaves = treeLeaves.filter(l => l.platform !== pl);
  // splinters
  const pc = pl.piece;
  for (let i = 0; i < 10; i++) {
    particles.push({ x: pc.x + rand(0, pc.w), y: pc.y + pc.h / 2, vx: rand(-120, 120), vy: rand(-200, -40),
      life: 0.6, t: 0, color: "#8a5a3a", size: rand(2, 5) });
  }
  audio.snap();
}

function updateBrokenBranches(dt) {
  for (const b of brokenBranches) {
    b.vy += GRAVITY * 0.8 * dt;
    b.y += b.vy * dt;
    b.rot += b.spin * dt;
  }
  brokenBranches = brokenBranches.filter(b => b.pl.piece.y + b.y < GROUND_Y + 200);
}

function updateDizzy(dt) {
  const p = player;
  p.vy += GRAVITY * dt;
  p.x += p.vx * dt;
  p.y += p.vy * dt;
  p.vx *= Math.pow(0.05, dt);
  if (p.y >= GROUND_Y) { p.y = GROUND_Y; p.vy = p.vy > 200 ? -p.vy * 0.3 : 0; }
}

function updateLeaves(dt) {
  if (Math.random() < dt * (2.4 + sky.wind * 9)) spawnFallingLeaf(false);
  const wind = sky.windX * 260;
  for (const l of fallingLeaves) {
    l.y += l.vy * (1 + sky.rain * 0.8) * dt;
    l.x += (l.vx + wind + Math.sin(time * 1.7 + l.phase) * 45 * (1 + sky.wind)) * dt;
    l.rot += l.spin * (1 + sky.wind * 3) * dt;
  }
  fallingLeaves = fallingLeaves.filter(l => l.y < GROUND_Y + 10 && l.x > camX - 200 && l.x < camX + viewW + 600);
}

function updateEffects(dt) {
  for (const pu of popups) { pu.t += dt; pu.y -= 50 * dt * 0.9 / (pu.life || 0.9); }
  popups = popups.filter(pu => pu.t < (pu.life || 0.9));
  for (const pa of particles) {
    pa.t += dt;
    pa.vy += 500 * dt;
    pa.x += pa.vx * dt;
    pa.y += pa.vy * dt;
  }
  particles = particles.filter(pa => pa.t < pa.life);
}

function dust(x, y, n) {
  for (let i = 0; i < n; i++) {
    particles.push({ x: x + rand(-15, 15), y, vx: rand(-90, 90), vy: rand(-140, -40),
      life: rand(0.3, 0.5), t: 0, color: "rgba(150,120,90,0.6)", size: rand(3, 7) });
  }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
let paperPattern = null;
function makePaper() {
  // subtle paper grain, generated once
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d");
  g.fillStyle = "#f6e4cc";
  g.fillRect(0, 0, 256, 256);
  const img = g.getImageData(0, 0, 256, 256);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 14;
    img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
  paperPattern = ctx.createPattern(c, "repeat");
}

// deterministic pseudo-random for background shapes
function hash(n) {
  const s = Math.sin(n * 127.1) * 43758.5453;
  return s - Math.floor(s);
}

function drawBackground() {
  ctx.fillStyle = paperPattern;
  ctx.fillRect(0, 0, viewW, VIEW_H);
  // warm autumn haze, stronger towards the horizon
  const haze = ctx.createLinearGradient(0, 0, 0, VIEW_H);
  haze.addColorStop(0, "rgba(250, 214, 165, 0.15)");
  haze.addColorStop(0.7, "rgba(240, 160, 90, 0.3)");
  haze.addColorStop(1, "rgba(220, 130, 70, 0.3)");
  ctx.fillStyle = haze;
  ctx.fillRect(0, 0, viewW, VIEW_H);

  drawSky();
  drawClouds();
  drawBirds();
}

function drawLandscape() {
  // hills in ochre and rust, with a row of distant autumn trees between them
  drawHills(0.25, 520, 70, "rgba(215, 165, 95, 0.5)", 1);
  drawDistantTrees(0.35, 545, 50, 2);
  drawHills(0.5, 580, 50, "rgba(185, 110, 60, 0.45)", 2);
}

function hillHeight(x, par, baseY, amp, seed) {
  const wx = (x + camX * par) / 260;
  const i = Math.floor(wx), f = wx - i;
  const s = f * f * (3 - 2 * f);
  return baseY - (hash(i + seed * 100) * (1 - s) + hash(i + 1 + seed * 100) * s) * amp;
}

function drawHills(par, baseY, amp, color, seed) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, VIEW_H);
  for (let x = 0; x <= viewW + 20; x += 20) ctx.lineTo(x, hillHeight(x, par, baseY, amp, seed));
  ctx.lineTo(viewW, VIEW_H);
  ctx.closePath();
  ctx.fill();
}

const BG_TREES = ["tree-bg-1", "tree-bg-2", "tree-bg-3"];

function drawDistantTrees(par, baseY, amp, seed) {
  // the small background tree drawings, standing on the far hills
  const span = 70;
  const off = camX * par;
  const t0 = Math.floor(off / span) - 1;
  ctx.globalAlpha = 0.7;
  for (let i = t0; i < t0 + viewW / span + 3; i++) {
    if (hash(i + 300) < 0.3) continue;
    const x = i * span - off + hash(i + 7) * 40;
    const ground = hillHeight(x, par, baseY, amp, seed) + 6;
    const img = images[BG_TREES[Math.floor(hash(i + 13) * BG_TREES.length)]];
    const h = 55 + hash(i + 11) * 40, w = h * img.width / img.height;
    ctx.save();
    ctx.translate(x, ground);
    if (hash(i + 17) < 0.5) ctx.scale(-1, 1);   // mirror some for variety
    ctx.drawImage(img, -w / 2, -h, w, h);
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}

function drawGround() {
  ctx.fillStyle = "#7a5638";
  ctx.fillRect(0, GROUND_Y + 14, viewW, VIEW_H);
  ctx.fillStyle = "#b9a04a";
  ctx.fillRect(0, GROUND_Y, viewW, 22);
  // the hand-drawn plants scattered along the grass (some mirrored, varied sizes)
  const span = 52;
  const t0 = Math.floor(camX / span) - 2;
  for (let i = t0; i < t0 + viewW / span + 4; i++) {
    if (hash(i + 21) < 0.3) continue;
    const img = images[GRASS_TUFTS[Math.floor(hash(i + 22) * GRASS_TUFTS.length)]];
    const k = 0.2 + hash(i + 23) * 0.13;
    const w = img.width * k, h = img.height * k;
    const x = i * span - camX + hash(i + 24) * 30;
    ctx.save();
    ctx.translate(x, GROUND_Y + 6 + hash(i + 25) * 6);
    if (hash(i + 26) < 0.5) ctx.scale(-1, 1);
    ctx.drawImage(img, -w / 2, -h, w, h);
    ctx.restore();
  }
  // wet ground is darker
  if (sky.wet > 0.01) {
    // (only onto what is drawn so far: the ground and its grass)
    ctx.globalCompositeOperation = "source-atop";
    ctx.fillStyle = `rgba(45, 30, 15, ${0.2 * sky.wet})`;
    ctx.fillRect(0, GROUND_Y - 60, viewW, VIEW_H);
    ctx.globalCompositeOperation = "source-over";
    drawPuddles();
  }
  // pebbles
  ctx.fillStyle = "rgba(60, 40, 25, 0.35)";
  const p0 = Math.floor(camX / 90);
  for (let i = p0; i < p0 + viewW / 90 + 2; i++) {
    ctx.beginPath();
    ctx.ellipse(i * 90 - camX + hash(i + 3) * 60, GROUND_Y + 30 + hash(i + 5) * 22, 4 + hash(i) * 4, 3, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  // fallen leaves scattered on the grass (decoration only)
  const l0 = Math.floor(camX / 45);
  for (let i = l0; i < l0 + viewW / 45 + 2; i++) {
    if (hash(i + 40) < 0.35) continue;
    const leaf = { img: LEAVES[Math.floor(hash(i + 41) * LEAVES.length)], size: 20 + hash(i + 42) * 14 };
    drawLeaf(leaf, i * 45 - camX + hash(i + 43) * 30, GROUND_Y + 6 + hash(i + 44) * 12, hash(i + 45) * 6.28);
  }
}

// puddles on the grass. Each spot has its own threshold, so puddles appear one
// by one as the ground gets wetter and shrink away one by one as it dries.
function drawPuddles() {
  const span = 150;
  const p0 = Math.floor(camX / span) - 1;
  for (let i = p0; i < p0 + viewW / span + 3; i++) {
    if (hash(i + 60) < 0.3) continue;                      // no puddle here
    const thr = hash(i + 61) * 0.6;
    const f = smoothstep(thr, thr + 0.35, sky.wet);
    if (f < 0.02) continue;
    const x = i * span - camX + hash(i + 62) * 90;
    const y = GROUND_Y + 13 + hash(i + 63) * 12;
    const rx = (28 + hash(i + 64) * 46) * f, ry = rx * 0.24;
    // muddy rim, water, and a pale reflection of the sky
    ctx.fillStyle = "rgba(85, 60, 35, 0.45)";
    ctx.beginPath(); ctx.ellipse(x, y, rx + 4, ry + 2.5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "rgba(110, 140, 175, 0.85)";
    ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "rgba(205, 225, 240, 0.55)";
    ctx.beginPath(); ctx.ellipse(x - rx * 0.2, y - ry * 0.25, rx * 0.55, ry * 0.4, 0, 0, Math.PI * 2); ctx.fill();
    // raindrops ripple the water while it rains
    if (sky.rain > 0.15) {
      ctx.strokeStyle = `rgba(235, 245, 255, ${0.7 * Math.min(1, sky.rain * 1.5)})`;
      ctx.lineWidth = 1.2;
      for (let k = 0; k < 2; k++) {
        const cyc = time * 1.4 + hash(i + 65) * 7 + k * 0.5;
        const n = Math.floor(cyc), t = cyc - n;
        const px = x + (hash(i * 13 + n * 7 + k) - 0.5) * rx * 1.1;
        const py = y + (hash(i * 17 + n * 3 + k) - 0.5) * ry * 0.8;
        const r = 2 + t * Math.min(rx * 0.4, 16);
        ctx.globalAlpha = 1 - t;
        ctx.beginPath(); ctx.ellipse(px, py, r, r * 0.3, 0, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
  }
}

// a tree; cracked branches are cut out of the drawing and drawn as separate
// pieces so they can shake and break off
function drawTree(t) {
  const img = images[t.name];
  const loose = t.platforms.filter(pl => pl.fragile);
  if (!loose.length) {
    ctx.drawImage(img, t.x, t.top, t.w, t.h);
    return;
  }
  ctx.save();
  ctx.beginPath();
  ctx.rect(t.x, t.top, t.w, t.h);
  for (const pl of loose) ctx.rect(pl.piece.x, pl.piece.y, pl.piece.w, pl.piece.h);
  ctx.clip("evenodd");
  ctx.drawImage(img, t.x, t.top, t.w, t.h);
  ctx.restore();
  for (const pl of loose) {
    if (pl.broken) continue;
    const shake = pl.crackedAt === undefined ? 0 : Math.sin(time * 45) * 0.025 * (time - pl.crackedAt) / CRACK_TIME;
    drawBranchPiece(pl, 0, 0, shake);
  }
}

// a branch piece, rotated around where it meets the trunk
function drawBranchPiece(pl, dx, dy, rot) {
  const pc = pl.piece;
  const pivotX = pl.side === "right" ? pc.x : pc.x + pc.w;
  const pivotY = pc.y + pc.h / 2;
  ctx.save();
  ctx.translate(pivotX + dx, pivotY + dy);
  ctx.rotate(rot);
  ctx.translate(-pivotX, -pivotY);
  ctx.drawImage(crackedPieceImage(pl), pc.x, pc.y, pc.w, pc.h);
  ctx.restore();
}

// the cut-out branch with a faded, dry look and a few hairline cracks.
// Cracks are painted "source-atop", so they only land on the wood itself.
// Rendered once per branch at the sprite's resolution.
function crackedPieceImage(pl) {
  if (pl.pieceImage) return pl.pieceImage;
  const pc = pl.piece;
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(pc.sw));
  c.height = Math.max(1, Math.round(pc.sh));
  const g = c.getContext("2d");
  g.filter = "saturate(0.6) brightness(0.92)";   // skipped where unsupported
  g.drawImage(images[pl.tree.name], pc.sx, pc.sy, pc.sw, pc.sh, 0, 0, c.width, c.height);
  g.filter = "none";
  g.globalCompositeOperation = "source-atop";
  const k = c.width / pc.w;                       // sprite px per screen px
  const mid = (pc.by + pc.bh * 0.45 - pc.y) * k;  // middle of the wood
  const len = Math.min(pc.bh * 0.65, 15) * k;
  g.strokeStyle = "rgba(40, 20, 10, 0.65)";
  g.lineWidth = 1.7 * k;
  g.lineJoin = "round";
  g.lineCap = "round";
  g.beginPath();
  for (const f of [0.22, 0.58]) {
    const x = (pl.side === "right" ? f : 1 - f) * c.width;
    g.moveTo(x - 1.5 * k, mid - len / 2);
    g.lineTo(x + 1.5 * k, mid);
    g.lineTo(x - 1 * k, mid + len / 2);
    g.moveTo(x + 1.5 * k, mid);
    g.lineTo(x + 5 * k, mid - len * 0.3);
  }
  g.stroke();
  pl.pieceImage = c;
  return c;
}

function drawBrokenBranches() {
  for (const b of brokenBranches) drawBranchPiece(b.pl, b.x, b.y, b.rot);
}

function drawLeaf(l, x, y, rot) {
  const img = images[l.img];
  const s = l.size / Math.max(img.width, img.height);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.drawImage(img, -img.width * s / 2, -img.height * s / 2, img.width * s, img.height * s);
  ctx.restore();
}

function drawTreeLeaves(front) {
  for (const l of treeLeaves) {
    if (l.front !== front || l.x < camX - 40 || l.x > camX + viewW + 40) continue;
    drawLeaf(l, l.x, l.y, l.rot + Math.sin(time * (2 + sky.wind * 5) + l.phase) * (0.12 + sky.wind * 0.3));
  }
}

function drawFallingLeaves(front) {
  for (const l of fallingLeaves) {
    if (l.front === front) drawLeaf(l, l.x, l.y, l.rot);
  }
}

function drawNuts() {
  for (const n of nuts) {
    if (n.taken) continue;
    const img = images[n.type.img];
    const s = NUT_SIZE / Math.max(img.width, img.height);
    const y = n.y + Math.sin(time * 3 + n.phase) * 4;
    ctx.save();
    ctx.translate(n.x, y);
    ctx.rotate(Math.sin(time * 2 + n.phase) * 0.15);
    ctx.drawImage(img, -img.width * s / 2, -img.height * s / 2, img.width * s, img.height * s);
    ctx.restore();
  }
}

function drawSquirrel() {
  const p = player;
  const img = images.squirrel;
  const w = SQUIRREL_W, h = w * img.height / img.width;
  const flip = p.facing > 0;  // the drawing faces left (tail on the right)
  const dizzy = state === "dizzy";

  let sx = 1 + p.squash * 0.6, sy = 1 - p.squash;
  let rot = 0, bob = 0;
  if (dizzy) {
    rot = Math.sin(stateTime * 5) * 0.08 * Math.max(0, 1 - stateTime * 0.2);
  } else if (!p.onGround) {
    rot = Math.max(-0.35, Math.min(0.35, p.vy / 2600)) * p.facing;
    sy *= 1 + Math.min(Math.abs(p.vy) / 4000, 0.12);
  } else if (Math.abs(p.vx) > 20) {
    bob = -Math.abs(Math.sin(p.runPhase)) * 5;
    rot = Math.sin(p.runPhase) * 0.06;
  }

  ctx.save();
  ctx.translate(p.x, p.y + bob);
  ctx.rotate(rot);
  ctx.scale(flip ? -sx : sx, sy);
  // anchor: bottom of the sprite at the feet, body centre over p.x
  const ox = -SQ_BODY_X * w, oy = -h + 4;
  ctx.drawImage(img, ox, oy, w, h);

  if (umbrellaOpen > 0 && !dizzy) {
    // lean into the run and against the wind; the context is mirrored when
    // facing right, so flip the angle to keep it in screen terms
    const lean = p.vx / RUN_SPEED * 0.18 - sky.windX * 0.3 + Math.sin(time * 3) * 0.04
      + (p.onGround ? 0 : -p.vy / 9000);
    drawUmbrella(ox + SQ_PAW[0] * w, oy + SQ_PAW[1] * h, (flip ? -1 : 1) * (lean - rot), umbrellaOpen);
  }

  if (dizzy) {
    // swirly eyes
    ctx.lineWidth = 1.8;
    ctx.strokeStyle = "#222";
    for (const [ex, ey] of SQ_EYES) {
      const cx = ox + ex * w, cy = oy + ey * h;
      ctx.fillStyle = "#fff";
      ctx.beginPath(); ctx.arc(cx, cy, 6.5, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath();
      for (let a = 0; a < Math.PI * 5; a += 0.25) {
        const r = a / (Math.PI * 5) * 6;
        const ang = a + stateTime * 8;
        const px = cx + Math.cos(ang) * r, py = cy + Math.sin(ang) * r;
        if (a === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
  }
  ctx.restore();

  if (dizzy) drawStars(p.x + (flip ? -1 : 1) * (SQ_HEAD[0] - SQ_BODY_X) * w, p.y - h + SQ_HEAD[1] * h - 8);
  // fell with the umbrella: it lies on the grass next to the squirrel
  // (tipped so the hook and the canopy rim both rest on the ground)
  if (dizzy && umbrellaOpen > 0) drawUmbrella(p.x + p.facing * 40, GROUND_Y + 2, p.facing * 0.65, umbrellaOpen);
}

// umbrella with its grip at (x, y); open 0..1 pops it open with a little bounce
function drawUmbrella(x, y, rot, open) {
  const img = images.umbrella;
  const grip = SPRITE_DATA.umbrella.grip;
  const t = Math.min(1, open);
  const pop = 1 + 1.7 * Math.pow(t - 1, 3) + 0.7 * Math.pow(t - 1, 2);   // ease-out-back
  const w = UMBRELLA_W, h = w * img.height / img.width;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.scale(pop, pop);
  ctx.drawImage(img, -grip[0] * w, -grip[1] * h, w, h);
  ctx.restore();
}

function drawStar(x, y, r, rot) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const rr = i % 2 ? r * 0.45 : r;
    const a = i / 10 * Math.PI * 2 - Math.PI / 2;
    ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fillStyle = "#ffd23f";
  ctx.fill();
  ctx.strokeStyle = "#c98a00";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
}

function drawStars(cx, cy) {
  const n = 5;
  const stars = [];
  for (let i = 0; i < n; i++) {
    const a = stateTime * 3.2 + i / n * Math.PI * 2;
    stars.push({ x: cx + Math.cos(a) * 42, y: cy + Math.sin(a) * 12, depth: Math.sin(a), a });
  }
  stars.sort((a, b) => a.depth - b.depth);
  for (const s of stars) drawStar(s.x, s.y, 8 + s.depth * 2.5, s.a * 2);
}

function drawEffects() {
  for (const pa of particles) {
    ctx.globalAlpha = 1 - pa.t / pa.life;
    ctx.fillStyle = pa.color;
    ctx.beginPath(); ctx.arc(pa.x, pa.y, pa.size, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.textAlign = "center";
  ctx.font = "bold 30px 'Patrick Hand', 'Comic Sans MS', cursive";
  for (const pu of popups) {
    ctx.globalAlpha = 1 - pu.t / (pu.life || 0.9);
    ctx.lineWidth = 5;
    ctx.strokeStyle = "#fff8ec";
    ctx.strokeText(pu.text, pu.x, pu.y);
    ctx.fillStyle = pu.color;
    ctx.fillText(pu.text, pu.x, pu.y);
  }
  ctx.globalAlpha = 1;
}

function text(str, x, y, size, color = "#4a2f1a", align = "center") {
  ctx.font = `${size}px 'Patrick Hand', 'Comic Sans MS', cursive`;
  ctx.textAlign = align;
  ctx.lineWidth = Math.max(4, size / 7);
  ctx.strokeStyle = "#fff8ec";
  ctx.lineJoin = "round";
  ctx.strokeText(str, x, y);
  ctx.fillStyle = color;
  ctx.fillText(str, x, y);
}

// Czech plural: 1 oříšek, 2–4 oříšky, 0 / 5+ oříšků
function nutsLabel(n) {
  const word = n === 1 ? "oříšek" : n >= 2 && n <= 4 ? "oříšky" : "oříšků";
  return `${n} ${word}`;
}

function drawHud() {
  const nutImg = images["nut-1"];
  ctx.drawImage(nutImg, 22, 18, 34, 34 * nutImg.height / nutImg.width);
  text(String(score), 66, 52, 40, "#4a2f1a", "left");
  text(nutsLabel(nutCount), 68, 82, 22, "#7a5a3a", "left");
  text(`Rekord ${best}`, viewW - 24, 46, 26, "#7a5a3a", "right");
  text(MODES[mode].label, viewW - 24, 72, 20, hard() ? "#c0502a" : "#9a7a5a", "right");
  if (audio.muted) text("zvuk vypnut (M)", viewW - 24, 96, 18, "#7a5a3a", "right");
  else if (!music.enabled) text("hudba vypnuta (H)", viewW - 24, 96, 18, "#7a5a3a", "right");
  if (hard() && state !== "title") drawHungerBar(22, 96);
  drawToast();
}

// energy bar: green when full, red and blinking when nearly empty
function drawHungerBar(x, y) {
  const w = 170, h = 16;
  const low = hunger < 0.25;
  if (low && Math.sin(time * 10) < 0) return;
  text("energie", x, y + 13, 18, "#7a5a3a", "left");
  const bx = x + 64;
  ctx.fillStyle = "rgba(255, 248, 236, 0.85)";
  ctx.strokeStyle = "#7a5a3a";
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.roundRect(bx, y, w, h, 7); ctx.fill(); ctx.stroke();
  const r = Math.round(220 - 120 * hunger), g = Math.round(70 + 120 * hunger);
  ctx.fillStyle = `rgb(${r}, ${g}, 60)`;
  if (hunger > 0.01) {
    ctx.beginPath(); ctx.roundRect(bx + 2, y + 2, (w - 4) * hunger, h - 4, 5); ctx.fill();
  }
}

// the two difficulty buttons, centred on y; remembers them for clicks/taps
function drawModeButtons(y) {
  const cx = viewW / 2, w = 250, h = 62, gap = 40;
  modeButtons = [];
  ["easy", "hard"].forEach((m, i) => {
    const x = i === 0 ? cx - gap / 2 - w : cx + gap / 2;
    const on = m === mode;
    modeButtons.push({ mode: m, x, y: y - h / 2, w, h });
    ctx.fillStyle = on ? (m === "hard" ? "#d0582a" : "#e0892f") : "rgba(255, 248, 236, 0.75)";
    ctx.strokeStyle = on ? "#7a3a1a" : "#b09070";
    ctx.lineWidth = on ? 4 : 2;
    ctx.beginPath(); ctx.roundRect(x, y - h / 2, w, h, 18); ctx.fill(); ctx.stroke();
    text(MODES[m].label, x + w / 2, y + 13, 38, on ? "#3a1a08" : "#7a5a3a");
    text(MODES[m].hint, x + w / 2, y + h / 2 + 30, 20, on ? "#6a4a2a" : "#a08a70");
  });
}

function drawTouchHints() {
  if (!isTouch || state !== "play") return;
  ctx.globalAlpha = 0.25;
  ctx.fillStyle = "#4a2f1a";
  const y = VIEW_H - 50;
  const lx = viewW * 0.11, rx = viewW * 0.36, jx = viewW * 0.8;
  ctx.beginPath(); ctx.moveTo(lx - 22, y); ctx.lineTo(lx + 14, y - 24); ctx.lineTo(lx + 14, y + 24); ctx.fill();
  ctx.beginPath(); ctx.moveTo(rx + 22, y); ctx.lineTo(rx - 14, y - 24); ctx.lineTo(rx - 14, y + 24); ctx.fill();
  ctx.beginPath(); ctx.moveTo(jx, y - 26); ctx.lineTo(jx + 26, y + 18); ctx.lineTo(jx - 26, y + 18); ctx.fill();
  ctx.globalAlpha = 1;
}

function drawOverlay() {
  const cx = viewW / 2;
  if (state === "title") {
    ctx.fillStyle = "rgba(255, 248, 236, 0.55)";
    ctx.fillRect(0, 0, viewW, VIEW_H);
    text("Hon na oříšky!", cx, 140, 96, "#d9671c");
    text("s veverkou Lískulkou", cx, 186, 34, "#b0581c");
    text("Pomoz Lískulce skákat ze stromu na strom a sbírat oříšky.", cx, 236, 30);
    text("Nesmí spadnout na zem, jinak se jí zatočí hlava!", cx, 272, 30);
    const controls = isTouch
      ? "Levá strana obrazovky = běh, pravá = skok"
      : "← → / A D  běh      Mezerník / ↑ / W  skok (podrž pro vyšší skok)";
    text(controls, cx, 322, 26, "#7a5a3a");
    if (!isTouch) text("M  zvuk      H  hudba", cx, 354, 22, "#9a7a5a");
    drawModeButtons(430);
    if (Math.sin(time * 4) > -0.3) {
      text(isTouch ? "Klepni na obtížnost a hraj" : "← → obtížnost      mezerník = start", cx, 545, 36, "#4a2f1a");
    }
  } else if (state === "dizzy" && stateTime > 0.8) {
    const a = Math.min(1, (stateTime - 0.8) * 3);
    ctx.globalAlpha = a;
    ctx.fillStyle = "rgba(255, 248, 236, 0.5)";
    ctx.fillRect(0, 0, viewW, VIEW_H);
    text(gameOverReason === "hunger" ? "Lískulce došly síly!" : "Lískulce se točí hlava!", cx, 190, 84, "#d9671c");
    if (gameOverReason === "hunger") text("Příště sbírej víc oříšků.", cx, 236, 28, "#7a5a3a");
    text(`Lískulka nasbírala ${nutsLabel(nutCount)}   •   skóre ${score}`, cx, 290, 40);
    if (score >= best && score > 0) text("Nový rekord!", cx, 336, 34, "#c98a00");
    if (stateTime > 1.0) {
      drawModeButtons(420);
      if (Math.sin(time * 4) > -0.3) {
        text(isTouch ? "Klepni na obtížnost a hraj znovu" : "Mezerník = hrát znovu      ← → obtížnost", cx, 535, 34, "#4a2f1a");
      }
    }
    ctx.globalAlpha = 1;
  }
}

// draw into the offscreen layer, tint what was drawn, then composite it
function drawLayer(draw, tintStrength, light) {
  const transform = mainCtx.getTransform();
  ctx = layerCtx;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, layer.width, layer.height);
  ctx.setTransform(transform);
  draw();
  ctx.globalCompositeOperation = "source-atop";
  tintLayer(tintStrength, light);
  ctx.globalCompositeOperation = "source-over";
  ctx = mainCtx;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(layer, 0, 0);
  ctx.restore();
}

function render() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = "#2b2420";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const offY = (canvas.height - VIEW_H * scale) / 2;
  const offX = (canvas.width - viewW * scale) / 2;
  ctx.setTransform(scale, 0, 0, scale, offX, offY);
  ctx.save();
  ctx.beginPath(); ctx.rect(0, 0, viewW, VIEW_H); ctx.clip();

  drawBackground();
  drawLayer(() => drawLandscape(), 0.85, null);
  const cam = Math.round(camX * 10) / 10;
  drawLayer(() => {
    drawGround();
    ctx.save();
    ctx.translate(-cam, 0);
    drawFallingLeaves(false);
    for (const t of trees) {
      if (t.x > camX + viewW || t.x + t.w < camX) continue;
      drawTree(t);
    }
    drawBrokenBranches();
    drawTreeLeaves(false);
    drawNpcs();
    drawNuts();
    drawSquirrel();
    drawTreeLeaves(true);
    drawEffects();
    drawFallingLeaves(true);
    ctx.restore();
  }, 1, [player.x - cam, player.y - 40]);

  ctx.save();
  ctx.translate(-cam, 0);
  drawNightGlow();
  ctx.restore();
  drawWeatherFront();

  drawHud();
  drawTouchHints();
  drawOverlay();
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------
let last = 0, acc = 0;
function frame(ts) {
  const now = ts / 1000;
  const dt = Math.min(0.1, now - (last || now));
  last = now;
  acc += dt;
  while (acc >= STEP) {
    update(STEP);
    acc -= STEP;
  }
  render();
  requestAnimationFrame(frame);
}

// weather.js and music.js load after this file; wait for them too
const scriptsLoaded = new Promise(resolve => {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", resolve);
  else resolve();
});

Promise.all([loadImages(), scriptsLoaded]).then(() => {
  makePaper();
  time = 0;
  reset();
  setState("title");
  requestAnimationFrame(frame);
}).catch(err => {
  ctx.fillStyle = "#fff";
  ctx.font = "20px sans-serif";
  ctx.fillText(err.message, 20, 40);
});
