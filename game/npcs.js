"use strict";

// Forest neighbours: an owl sitting on branches at night and bunnies hopping
// on the ground by day. Pure decoration: no collisions, they only move around
// and make sounds while on screen. They never pop in or out in plain view:
// owls settle on their branch while it is off screen and fly off at dawn;
// bunnies hop in by day and hop away at dusk. Loaded after game.js and
// weather.js.

const OWL_H = 84;                // drawn height
const OWL_CHANCE = 0.25;         // chance a tree gets an owl
const HOOT_TIME = 2.6;           // length of the call (sound, puff, text)
const FLY_OFF_TIME = 1.6;        // an owl caught on screen at dawn flies off
const BUNNY_H = 96;
const HOP_TIME = 0.42;           // seconds per hop
const HOP_DIST = 56;
const HOP_HEIGHT = 36;

let owls = [], bunnies = [], nextBunny = 4;

function resetNpcs() {
  owls = [];
  bunnies = [];
  nextBunny = rand(3, 8);
}

const onScreen = x => x > camX - 40 && x < camX + viewW + 40;

// called once a tree's cracked branches are known; owls avoid those
function maybePlaceOwl(tree) {
  if (Math.random() > OWL_CHANCE) return;
  const trunk = SPRITE_DATA[tree.name].trunk;
  const tx0 = tree.x + tree.w * trunk[0], tx1 = tree.x + tree.w * trunk[1];
  // not on branches so high that the owl would poke out of the top of the screen
  const spots = tree.platforms.filter(pl => !pl.fragile && pl.x1 - pl.x0 > 120 && pl.y > OWL_H + 60);
  if (!spots.length) return;
  const pl = pick(spots);
  // the free part of the branch, beside the trunk
  const lo = pl.side === "right" ? tx1 + 20 : pl.x0 + 25;
  const hi = pl.side === "right" ? pl.x1 - 25 : tx0 - 20;
  if (hi - lo < 30) return;
  const home = lo + (hi - lo) * rand(0.2, 0.6);
  owls.push({
    pl, lo, hi, home, x: home, target: home,
    facing: Math.random() < 0.5 ? 1 : -1,
    wait: rand(1, 4),
    nextHoot: rand(2, 6),
    hoot: 0,                     // > 0 while hooting (puffs up)
    phase: rand(0, 6),
    present: false,              // only there at night
    leaving: 0,                  // > 0 while flying off at dawn
  });
}

function spawnBunny() {
  const dir = Math.random() < 0.5 ? 1 : -1;
  bunnies.push({
    x: camX + viewW + rand(40, 160),
    y: 0,                        // height above the ground while hopping
    dir,
    hopsLeft: 2 + Math.floor(Math.random() * 5),
    hopT: -1,                    // -1 = sitting
    sit: rand(0.3, 1.5),
    squash: 0,
  });
}

function updateNpcs(dt) {
  // owls: only at night. They settle unseen and fly off at dawn.
  for (const o of owls) {
    if (o.pl.broken) continue;
    const seen = onScreen(o.x);
    if (!o.present && sky.night > 0.5 && !seen) o.present = true;
    if (o.present && !o.leaving && sky.night < 0.2) {
      if (seen) o.leaving = 1e-6;
      else o.present = false;
    }
    if (o.leaving) {
      if ((o.leaving += dt) > FLY_OFF_TIME) { o.present = false; o.leaving = 0; }
      continue;
    }
    if (!o.present) continue;
    // shuffle along the branch, turn around, hoot now and then
    if (Math.abs(o.target - o.x) > 1) {
      const step = Math.sign(o.target - o.x) * Math.min(Math.abs(o.target - o.x), 22 * dt);
      o.x += step;
      o.facing = Math.sign(step) || o.facing;
    } else if ((o.wait -= dt) <= 0) {
      o.wait = rand(2, 6);
      if (Math.random() < 0.6) o.target = Math.min(o.hi, Math.max(o.lo, o.home + rand(-35, 35)));
      else o.facing *= -1;
    }
    o.hoot = Math.max(0, o.hoot - dt);
    if (state !== "title" && onScreen(o.x) && (o.nextHoot -= dt) <= 0) {
      o.nextHoot = rand(3, 7);
      o.hoot = HOOT_TIME;
      audio.hoot();
      popups.push({ x: o.x, y: Math.max(40, o.pl.y - OWL_H - 8), text: "hú… hú-hú-húúú", color: "#7a5a3a", t: 0, life: HOOT_TIME });
    }
  }

  // bunnies: only by day (fewer in rain); at dusk they hop away
  const fewer = 1 - 0.7 * sky.rain;
  if (state !== "title" && sky.night < 0.3 && (nextBunny -= dt * fewer) <= 0 && bunnies.length < 2) {
    spawnBunny();
    nextBunny = rand(8, 18);
  }
  for (const b of bunnies) {
    if (sky.night > 0.4 && !b.home) {
      // head for the nearest edge of the screen and keep hopping
      b.home = true;
      b.dir = b.x - camX < viewW / 2 ? -1 : 1;
      b.hopsLeft = 1e9;
    }
    b.squash *= Math.pow(0.001, dt);
    if (b.hopT < 0) {
      if ((b.sit -= dt) > 0) continue;
      if (b.hopsLeft <= 0) {
        b.hopsLeft = 2 + Math.floor(Math.random() * 5);
        if (Math.random() < 0.35) b.dir *= -1;
      }
      b.hopT = 0;
      b.hopsLeft--;
      if (onScreen(b.x) && Math.random() < 0.15) audio.boing();
    }
    b.hopT += dt / HOP_TIME;
    const t = Math.min(b.hopT, 1);
    b.y = 4 * HOP_HEIGHT * t * (1 - t);
    b.x += b.dir * HOP_DIST * dt / HOP_TIME;
    if (b.hopT >= 1) {
      b.hopT = -1;
      b.y = 0;
      b.squash = 0.25;
      b.sit = b.hopsLeft > 0 ? rand(0.05, 0.25) : rand(1, 3);
    }
  }

  const forget = camX - 300;
  owls = owls.filter(o => o.x > forget);
  bunnies = bunnies.filter(b => b.x > forget && b.x < camX + viewW + 900 && !(b.home && !onScreen(b.x)));
}

function drawNpcs() {
  for (const o of owls) {
    if (o.pl.broken || !o.present || !onScreen(o.x)) continue;
    const img = images.owl;
    const h = OWL_H, w = h * img.width / img.height;
    ctx.save();
    if (o.leaving) {
      // flies up and away, wings flapping (a quick squash), fading at the end
      const t = o.leaving / FLY_OFF_TIME;
      ctx.globalAlpha = Math.min(1, (1 - t) * 3);
      ctx.translate(o.x + o.facing * t * t * 300, o.pl.y + 2 - t * 260 - Math.sin(t * Math.PI) * 30);
      ctx.rotate(o.facing * 0.35 * t);
      ctx.scale(o.facing, 1 + 0.15 * Math.sin(time * 30));
    } else {
      const walking = Math.abs(o.target - o.x) > 1;
      const puff = 1 + 0.08 * Math.sin(Math.min(1, o.hoot / HOOT_TIME) * Math.PI);   // puffs up to hoot
      const breathe = 1 + 0.025 * Math.sin(time * 2 + o.phase);
      ctx.translate(o.x, o.pl.y + 2);
      ctx.rotate(walking ? Math.sin(time * 12) * 0.08 : 0);
      ctx.scale(o.facing * puff, breathe * puff);
    }
    ctx.drawImage(img, -w / 2, -h, w, h);
    ctx.restore();
  }
  for (const b of bunnies) {
    if (!onScreen(b.x)) continue;
    const img = images.bunny;
    const h = BUNNY_H, w = h * img.width / img.height;
    const air = b.hopT >= 0;
    const sx = 1 + b.squash * 0.6, sy = (1 - b.squash) * (air ? 1.06 : 1);
    ctx.save();
    ctx.translate(b.x, GROUND_Y + 6 - b.y);
    ctx.rotate(air ? b.dir * 0.12 : 0);
    ctx.scale(b.dir * sx, sy);
    ctx.drawImage(img, -w / 2, -h, w, h);
    ctx.restore();
  }
}
