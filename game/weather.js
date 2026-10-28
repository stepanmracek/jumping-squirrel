"use strict";

// Day/night cycle and weather. Both run on the game clock, which starts with
// each new game and keeps ticking whether the squirrel moves or not (also
// while it lies dizzy on the ground). Loaded after game.js and uses its globals.

const DAY_SECONDS = 100;         // a full day + night
const DAY_START = 0.3;           // time of day at the start (0.25 = sunrise)
const WEATHER_SECONDS = 25;      // between weather changes
const WEATHER_BLEND = 0.35;      // how fast weather blends into the next (1/s)

const WEATHERS = {
  sunny:  { label: "Slunečno",   dark: "Jasno", clouds: 0.15, gloom: 0,    rain: 0,   wind: 0.15, fog: 0,   lightning: 0 },
  cloudy: { label: "Zataženo",   clouds: 1,    gloom: 0.35, rain: 0,   wind: 0.3,  fog: 0,   lightning: 0 },
  windy:  { label: "Fouká vítr", clouds: 0.6,  gloom: 0.1,  rain: 0,   wind: 1,    fog: 0,   lightning: 0 },
  rain:   { label: "Prší! Lískulka vytahuje deštník.", clouds: 1,    gloom: 0.6,  rain: 0.6, wind: 0.35, fog: 0,   lightning: 0 },
  storm:  { label: "Bouřka! Drž se, Lískulko!", clouds: 1,    gloom: 1,    rain: 1,   wind: 0.85, fog: 0,   lightning: 1 },
  fog:    { label: "Mlha",       clouds: 0.5,  gloom: 0.3,  rain: 0,   wind: 0,    fog: 1,   lightning: 0 },
};
// what can follow what, so a storm builds up instead of appearing from nowhere.
// Rain (or storm) ends up about 27% of the time; a sudden shower can follow sun.
const WEATHER_NEXT = {
  sunny:  ["cloudy", "windy", "fog", "sunny", "rain"],
  cloudy: ["rain", "windy", "sunny", "fog"],
  windy:  ["cloudy", "rain", "sunny"],
  rain:   ["storm", "cloudy", "sunny", "windy"],
  storm:  ["rain", "cloudy", "windy"],
  fog:    ["sunny", "cloudy", "rain"],
};
const WEATHER_KEYS = ["clouds", "gloom", "rain", "wind", "fog", "lightning"];

const sky = {
  clock: 0,            // seconds since the game started
  tod: DAY_START,      // time of day 0..1 (0 = midnight, 0.5 = noon)
  sunHeight: 0,        // -1 midnight .. 1 noon
  night: 0,            // 0 day .. 1 deep night
  dusk: 0,             // peaks at sunrise / sunset
  weather: "sunny",
  slot: -1,
  windDir: 1,
  windX: 0,            // signed, gusty wind strength used by leaves and rain
  cloudDrift: 0,
  wet: 0,              // ground wetness 0..1: puddles grow in rain, dry after
  flash: 0,            // lightning flash brightness
  bolt: null,
  drops: [],
  splashes: [],
  fireflies: [],
  flocks: [],
  nextFlock: 2,        // seconds until the next flock of birds
  toast: null,
  toastQueue: [],
};
for (const k of WEATHER_KEYS) sky[k] = 0;

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function resetSky() {
  sky.clock = 0;
  sky.slot = -1;
  sky.weather = "sunny";
  for (const k of WEATHER_KEYS) sky[k] = WEATHERS.sunny[k];
  sky.windDir = 1;
  sky.flash = 0;
  sky.wet = 0;
  sky.bolt = null;
  sky.drops = [];
  sky.splashes = [];
  sky.fireflies = [];
  sky.flocks = [];
  sky.nextFlock = 2;
  sky.toast = null;
  sky.toastQueue = [];
  updateSky(0);
}

// "Slunečno" makes no sense once the sun is down; clear sky is "Jasno" then
function weatherLabel(name) {
  const w = WEATHERS[name];
  return w.dark && sky.sunHeight < 0.1 ? w.dark : w.label;
}

function showToast(text) {
  if (state !== "play") return;
  sky.toastQueue.push(text);
}

function updateSky(dt) {
  // --- time of day
  if (state !== "title") sky.clock += dt;   // the title screen stays morning
  const prevSun = sky.sunHeight;
  sky.tod = (DAY_START + sky.clock / DAY_SECONDS) % 1;
  sky.sunHeight = Math.sin((sky.tod - 0.25) * Math.PI * 2);
  sky.night = smoothstep(0, -0.5, sky.sunHeight);
  sky.dusk = 1 - smoothstep(0, 0.4, Math.abs(sky.sunHeight - 0.05));
  if (dt > 0) {
    if (prevSun > 0.15 && sky.sunHeight <= 0.15) showToast("Stmívá se…");
    if (prevSun > -0.4 && sky.sunHeight <= -0.4) showToast("Noc");
    if (prevSun < -0.25 && sky.sunHeight >= -0.25) showToast("Svítá");
  }

  // --- weather schedule
  const slot = Math.floor(sky.clock / WEATHER_SECONDS);
  if (slot !== sky.slot) {
    if (sky.slot >= 0) {
      const options = WEATHER_NEXT[sky.weather].filter(w => w !== sky.weather || Math.random() < 0.3);
      const prev = sky.weather;
      sky.weather = pick(options);
      sky.windDir = Math.random() < 0.7 ? 1 : -1;
      if (sky.weather !== prev) showToast(weatherLabel(sky.weather));
    }
    sky.slot = slot;
  }
  const target = WEATHERS[sky.weather];
  const k = 1 - Math.exp(-WEATHER_BLEND * dt);
  for (const key of WEATHER_KEYS) sky[key] += (target[key] - sky[key]) * k;

  const gust = 0.7 + 0.3 * Math.sin(time * 1.3) + 0.15 * Math.sin(time * 3.7);
  sky.windX = sky.wind * sky.windDir * gust;
  sky.cloudDrift += dt * (8 + sky.wind * 70) * sky.windDir;
  // rain soaks the ground within ~6-10 s; it takes ~35 s to dry again
  if (sky.rain > 0.2) sky.wet = Math.min(1, sky.wet + dt * sky.rain / 6);
  else sky.wet = Math.max(0, sky.wet - dt / 35);

  // --- toasts
  if (sky.toast) {
    sky.toast.t += dt;
    if (sky.toast.t > 2.6) sky.toast = null;
  }
  if (!sky.toast && sky.toastQueue.length) sky.toast = { text: sky.toastQueue.shift(), t: 0 };

  updateRain(dt);
  updateLightning(dt);
  updateFireflies(dt);
  updateBirds(dt);
  audio.ambience(sky.rain, sky.wind);
}

function updateRain(dt) {
  const want = Math.round(sky.rain * 260);
  const slant = sky.windX * 0.45;
  while (sky.drops.length < want) {
    sky.drops.push({
      x: rand(-200, viewW + 200),
      y: rand(-VIEW_H, 0),
      v: rand(900, 1250),
      len: rand(14, 24),
      stop: GROUND_Y + rand(0, 40),
    });
  }
  if (sky.drops.length > want) sky.drops.length = want;
  for (const d of sky.drops) {
    d.y += d.v * dt;
    d.x += slant * d.v * dt;
    if (d.y > d.stop) {
      if (Math.random() < 0.5) sky.splashes.push({ x: d.x, y: d.stop, t: 0 });
      d.y = rand(-120, -10);
      d.x = rand(-200, viewW + 200);
    }
  }
  for (const s of sky.splashes) s.t += dt;
  sky.splashes = sky.splashes.filter(s => s.t < 0.25);
}

function updateLightning(dt) {
  sky.flash = Math.max(0, sky.flash - dt * 3);
  if (sky.bolt && (sky.bolt.t += dt) > 0.2) sky.bolt = null;
  if (sky.lightning > 0.5 && Math.random() < dt * 0.25 * sky.lightning) {
    // jagged bolt from the clouds down to the hills
    const pts = [];
    let x = rand(viewW * 0.15, viewW * 0.85), y = 40;
    while (y < 520) {
      pts.push([x, y]);
      x += rand(-40, 40);
      y += rand(30, 60);
    }
    pts.push([x, 540]);
    sky.bolt = { pts, t: 0 };
    sky.flash = 1;
    audio.thunder(rand(0.2, 0.9));
  }
}

function updateFireflies(dt) {
  const want = Math.round(sky.night * (1 - sky.rain) * 22);
  while (sky.fireflies.length < want) {
    sky.fireflies.push({
      x: camX + rand(0, viewW + 200), y: rand(300, GROUND_Y - 10),
      phase: rand(0, 6), speed: rand(0.5, 1.2),
    });
  }
  if (sky.fireflies.length > want) sky.fireflies.length = want;
  for (const f of sky.fireflies) {
    f.x += Math.cos(time * f.speed + f.phase) * 20 * dt + sky.windX * 30 * dt;
    f.y += Math.sin(time * f.speed * 1.3 + f.phase) * 15 * dt;
    if (f.x < camX - 50) { f.x = camX + viewW + rand(0, 200); f.y = rand(300, GROUND_Y - 10); }
  }
}

// birds stay home at night and in bad weather
const BIRD_FLAP = ["bird-1", "bird-2", "bird-3", "bird-2"];

function birdActivity() {
  return (1 - sky.night) * (1 - sky.rain * 0.85) * (1 - sky.fog * 0.6);
}

function spawnFlock() {
  const dir = sky.wind > 0.5 ? sky.windDir : Math.random() < 0.6 ? 1 : -1;
  const n = 1 + Math.floor(Math.random() * 6);
  const size = rand(32, 60);                // smaller = farther away
  const depth = size / 60;
  const birds = [];
  const spacing = size * 1.1;
  for (let i = 0; i < n; i++) {
    // V formation: leader in front, the rest trailing on alternate sides
    const rank = Math.ceil(i / 2), side = i % 2 ? 1 : -1;
    birds.push({
      dx: -dir * rank * spacing + rand(-6, 6),
      dy: side * rank * spacing * 0.45 + rand(-5, 5),
      size: size * rand(0.9, 1.1),
      flap: rand(7, 10),
      phase: rand(0, 4),
    });
  }
  const par = 0.15 + 0.2 * depth;
  const back = n > 1 ? Math.ceil((n - 1) / 2) * spacing : 0;
  sky.flocks.push({
    dir, birds, par,
    x: (dir > 0 ? -80 : viewW + 80) + camX * par,   // sky coordinates
    y: rand(70, 330),
    vx: dir * rand(70, 120) * (0.6 + 0.6 * depth),
    age: 0,
    back,
  });
}

function updateBirds(dt) {
  const act = birdActivity();
  sky.nextFlock -= dt * act;
  if (sky.nextFlock <= 0 && sky.flocks.length < 3 && act > 0.3) {
    spawnFlock();
    sky.nextFlock = rand(5, 12);
  }
  for (const f of sky.flocks) {
    f.age += dt;
    f.x += (f.vx + sky.windX * 40) * dt;
    f.y += Math.sin(f.age * 0.7) * 6 * dt;
  }
  sky.flocks = sky.flocks.filter(f => {
    const sx = f.x - camX * f.par;
    if (f.age > 60) return false;
    return f.dir > 0 ? sx < viewW + 120 + f.back && sx > -400 - f.back
                     : sx > -120 - f.back && sx < viewW + 400 + f.back;
  });
}

function drawBirds() {
  const alpha = 0.75 * (1 - sky.night) * (1 - sky.fog * 0.5);
  if (alpha < 0.02 || !sky.flocks.length) return;
  ctx.globalAlpha = alpha;
  for (const f of sky.flocks) {
    const fx = f.x - camX * f.par;
    for (const b of f.birds) {
      const img = images[BIRD_FLAP[Math.floor(time * b.flap + b.phase) % BIRD_FLAP.length]];
      const w = b.size, h = w * img.height / img.width;
      const x = fx + b.dx, y = f.y + b.dy + Math.sin(time * 2 + b.phase) * 3;
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(f.dir < 0 ? -1 : 1, 1);
      ctx.drawImage(img, -w / 2, -h / 2, w, h);
      ctx.restore();
    }
  }
  ctx.globalAlpha = 1;
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------
const SKY_STARS = Array.from({ length: 90 }, (_, i) => ({
  x: hash(i * 3 + 1), y: hash(i * 3 + 2) * 0.62, r: 0.8 + hash(i * 3 + 3) * 1.8,
}));

// colour overlays on the sky, the sun, moon and stars; drawn before clouds
function drawSky() {
  // the higher the sun, the bluer the sky: deep at the top, paler towards
  // the horizon; grey weather mostly hides it
  const blue = 0.75 * smoothstep(0.25, 0.85, sky.sunHeight) * (1 - 0.7 * Math.min(1, sky.gloom));
  if (blue > 0.01) {
    const g = ctx.createLinearGradient(0, 0, 0, 560);
    g.addColorStop(0, `rgba(95, 160, 225, ${blue})`);
    g.addColorStop(0.6, `rgba(150, 195, 235, ${blue * 0.75})`);
    g.addColorStop(1, `rgba(200, 220, 235, ${blue * 0.35})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, viewW, VIEW_H);
  }
  ctx.fillStyle = `rgba(250, 120, 90, ${0.3 * sky.dusk})`;
  ctx.fillRect(0, 0, viewW, VIEW_H);
  ctx.fillStyle = `rgba(18, 22, 62, ${0.85 * sky.night})`;
  ctx.fillRect(0, 0, viewW, VIEW_H);
  ctx.fillStyle = `rgba(110, 115, 130, ${0.45 * sky.gloom * (1 - sky.night * 0.6)})`;
  ctx.fillRect(0, 0, viewW, VIEW_H);

  const clear = 1 - Math.min(1, sky.clouds * 0.85);
  // stars
  const starA = sky.night * clear;
  if (starA > 0.01) {
    ctx.fillStyle = "#fff8d8";
    for (let i = 0; i < SKY_STARS.length; i++) {
      const s = SKY_STARS[i];
      ctx.globalAlpha = starA * (0.6 + 0.4 * Math.sin(time * 2 + i));
      ctx.beginPath();
      ctx.arc(s.x * viewW, s.y * VIEW_H, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  // sun and moon travel across the sky; both set behind the hills
  const arc = p => [viewW * (0.08 + 0.84 * p), 600 - Math.sin(Math.PI * p) * 470];
  const sunP = (sky.tod - 0.2) / 0.6;
  if (sunP > 0 && sunP < 1) {
    const [x, y] = arc(sunP);
    ctx.globalAlpha = Math.max(0.15, 1 - sky.gloom * 0.85);
    drawSun(x, y);
    ctx.globalAlpha = 1;
  }
  const moonP = (((sky.tod + 0.5) % 1) - 0.2) / 0.6;
  if (moonP > 0 && moonP < 1) {
    const [x, y] = arc(moonP);
    ctx.globalAlpha = Math.max(0.2, 1 - sky.gloom * 0.8) * Math.max(sky.night, 0.25);
    drawMoon(x, y);
    ctx.globalAlpha = 1;
  }
}

function drawSun(x, y) {
  const img = images.sun;
  const size = 180, h = size * img.height / img.width;
  // redder near the horizon (filter is ignored where unsupported)
  const low = smoothstep(0.35, 0, sky.sunHeight);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(Math.sin(time * 0.3) * 0.08);   // rays shimmer a little
  if (low > 0.01) ctx.filter = `hue-rotate(${-30 * low}deg) saturate(${1 + 0.4 * low})`;
  ctx.drawImage(img, -size / 2, -h / 2, size, h);
  ctx.restore();
}

function drawMoon(x, y) {
  const img = images.moon;
  const size = 92, h = size * img.height / img.width;
  ctx.save();
  ctx.translate(x, y);
  const glow = ctx.createRadialGradient(0, 0, 35, 0, 0, 120);
  glow.addColorStop(0, "rgba(255, 245, 200, 0.28)");
  glow.addColorStop(1, "rgba(255, 245, 200, 0)");
  ctx.fillStyle = glow;
  ctx.beginPath(); ctx.arc(0, 0, 120, 0, Math.PI * 2); ctx.fill();
  ctx.drawImage(img, -size / 2, -h / 2, size, h);
  ctx.restore();
}

function drawClouds() {
  // cream on a nice day, grey under rain, dim at night
  const mix = (a, b, t) => Math.round(a + (b - a) * t);
  const dim = 1 - 0.65 * sky.night;
  const g = Math.min(1, sky.gloom);
  const col = (a) => `rgba(${mix(255, 120, g) * dim | 0}, ${mix(246, 124, g) * dim | 0}, ${mix(232, 135, g) * dim | 0}, ${a})`;
  const layers = [
    { par: 0.15, span: 700, y: 70, seed: 0, alpha: 0.8 },
    { par: 0.1, span: 420, y: 30, seed: 900, alpha: 0.9 * smoothstep(0.3, 1, sky.clouds), big: 1.3 },
    { par: 0.2, span: 520, y: 140, seed: 400, alpha: 0.75 * smoothstep(0.5, 1, sky.clouds) },
  ];
  for (const L of layers) {
    if (L.alpha < 0.01) continue;
    ctx.fillStyle = col(L.alpha);
    const off = camX * L.par - sky.cloudDrift * (L.par / 0.15);
    const c0 = Math.floor(off / L.span) - 1;
    for (let i = c0; i < c0 + viewW / L.span + 3; i++) {
      const cx = i * L.span - off + hash(i + L.seed) * 300;
      const cy = L.y + hash(i + 50 + L.seed) * 110;
      const s = L.big || 1;
      ctx.beginPath();
      for (let k = 0; k < 5; k++) {
        // each puff is its own subpath; joining them with lines cuts holes
        const px = cx + k * 38 * s, py = cy + (k % 2) * 8, r = (34 + hash(i * 7 + k + L.seed) * 12) * s;
        ctx.moveTo(px + r, py);
        ctx.arc(px, py, r, 0, Math.PI * 2);
      }
      ctx.fill();
    }
  }
}

// tint applied (source-atop) to an offscreen layer, so only drawn pixels are
// darkened. strength < 1 for far scenery. With a light, a soft circle around
// the squirrel stays brighter at night.
function tintLayer(strength, light) {
  ctx.fillStyle = `rgba(255, 110, 60, ${0.18 * sky.dusk * strength})`;
  ctx.fillRect(0, 0, viewW, VIEW_H);
  ctx.fillStyle = `rgba(80, 88, 105, ${0.35 * sky.gloom * strength})`;
  ctx.fillRect(0, 0, viewW, VIEW_H);
  const a = 0.62 * sky.night * strength;
  if (a <= 0.005) return;
  if (light) {
    const grad = ctx.createRadialGradient(light[0], light[1], 30, light[0], light[1], 320);
    grad.addColorStop(0, `rgba(15, 20, 60, ${a * 0.2})`);
    grad.addColorStop(1, `rgba(15, 20, 60, ${a})`);
    ctx.fillStyle = grad;
  } else {
    ctx.fillStyle = `rgba(15, 20, 60, ${a})`;
  }
  ctx.fillRect(0, 0, viewW, VIEW_H);
}

// glowing things that should not be darkened by the night tint (world coords)
function drawNightGlow() {
  if (sky.night < 0.02) return;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (const n of nuts) {
    if (n.taken || n.x < camX - 40 || n.x > camX + viewW + 40) continue;
    const y = n.y + Math.sin(time * 3 + n.phase) * 4;
    const g = ctx.createRadialGradient(n.x, y, 4, n.x, y, 34);
    g.addColorStop(0, `rgba(255, 190, 90, ${0.45 * sky.night})`);
    g.addColorStop(1, "rgba(255, 190, 90, 0)");
    ctx.fillStyle = g;
    ctx.fillRect(n.x - 34, y - 34, 68, 68);
  }
  for (const f of sky.fireflies) {
    const a = (0.5 + 0.5 * Math.sin(time * 4 + f.phase * 3)) * sky.night;
    const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, 14);
    g.addColorStop(0, `rgba(240, 255, 140, ${a})`);
    g.addColorStop(1, "rgba(240, 255, 140, 0)");
    ctx.fillStyle = g;
    ctx.fillRect(f.x - 14, f.y - 14, 28, 28);
  }
  ctx.restore();
}

// rain, wind streaks, fog and lightning over the whole scene (screen coords)
function drawWeatherFront() {
  if (sky.fog > 0.01) {
    const g = ctx.createLinearGradient(0, 200, 0, VIEW_H);
    g.addColorStop(0, `rgba(232, 228, 222, ${0.1 * sky.fog})`);
    g.addColorStop(1, `rgba(232, 228, 222, ${0.6 * sky.fog})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, viewW, VIEW_H);
    // slow drifting banks
    ctx.fillStyle = `rgba(240, 236, 230, ${0.25 * sky.fog})`;
    for (let i = 0; i < 5; i++) {
      const x = ((i * 380 - camX * 0.6 - time * 12) % (viewW + 600) + viewW + 600) % (viewW + 600) - 300;
      ctx.beginPath();
      ctx.ellipse(x, 470 + hash(i) * 150, 260, 50, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  if (sky.wind > 0.5) {
    // wind streaks
    ctx.strokeStyle = `rgba(255, 255, 255, ${0.5 * (sky.wind - 0.5)})`;
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    for (let i = 0; i < 7; i++) {
      const speed = 700 + hash(i + 70) * 400;
      const x = (((time * speed * sky.windDir + hash(i) * 3000) % (viewW + 400)) + viewW + 400) % (viewW + 400) - 200;
      const y = 80 + hash(i + 80) * 480 + Math.sin(time * 2 + i) * 10;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x - 50 * sky.windDir, y - 8, x - 110 * sky.windDir, y + 2);
      ctx.stroke();
    }
  }

  if (sky.drops.length) {
    const slant = sky.windX * 0.45;
    ctx.strokeStyle = sky.night > 0.5 ? "rgba(170, 190, 225, 0.7)" : "rgba(100, 120, 165, 0.6)";
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    for (const d of sky.drops) {
      ctx.moveTo(d.x, d.y);
      ctx.lineTo(d.x - slant * d.len, d.y - d.len);
    }
    ctx.stroke();
    ctx.strokeStyle = "rgba(170, 190, 225, 0.6)";
    for (const s of sky.splashes) {
      const r = 3 + s.t * 30;
      ctx.globalAlpha = 1 - s.t / 0.25;
      ctx.beginPath();
      ctx.ellipse(s.x, s.y, r, r * 0.35, 0, Math.PI, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  if (sky.bolt) {
    ctx.strokeStyle = "rgba(255, 250, 210, 0.95)";
    ctx.lineWidth = 4;
    ctx.lineJoin = "round";
    ctx.shadowColor = "rgba(255, 255, 220, 0.9)";
    ctx.shadowBlur = 18;
    ctx.beginPath();
    sky.bolt.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.stroke();
    ctx.shadowBlur = 0;
  }
  if (sky.flash > 0) {
    ctx.fillStyle = `rgba(255, 255, 245, ${0.45 * sky.flash})`;
    ctx.fillRect(0, 0, viewW, VIEW_H);
  }
}

function drawToast() {
  const t = sky.toast;
  if (!t || state !== "play") return;
  const a = Math.min(1, t.t * 4, (2.6 - t.t) * 2);
  ctx.globalAlpha = Math.max(0, a);
  text(t.text, viewW / 2, 70 - (1 - Math.min(1, t.t * 4)) * 15, 40, "#6a4a2a");
  ctx.globalAlpha = 1;
}
