"use strict";

// 8-bit background music, synthesized with Web Audio (no audio files).
// An original bouncy tune in C major: pulse-wave lead, triangle oom-pah bass
// and noise drums, with a little swing. At night it switches to a slower,
// softer arrangement of the same tune. Loaded after game.js and weather.js.

const music = (() => {
  // melody: one string per bar, "note:length" in 16th steps, "-" is a rest
  const MELODY = [
    "E5:2 G5:2 C6:2 G5:2 A5:2 G5:2 E5:4",              // C
    "F5:2 A5:2 C6:2 A5:2 G5:3 F5:1 E5:4",              // F
    "D5:2 G5:2 B5:2 G5:2 A5:2 B5:2 C6:2 D6:2",         // G
    "E6:2 C6:2 G5:2 E5:2 C5:4 -:4",                    // C
    "A5:1 -:1 A5:1 -:1 G#5:1 A5:1 C6:2 B5:2 A5:2 E5:4", // Am: cheeky hiccups
    "F5:1 -:1 F5:1 -:1 E5:1 F5:1 A5:2 G5:2 F5:2 C5:4", // F
    "D5:2 F#5:2 A5:2 C6:2 B5:1 C6:1 B5:1 A5:1 G5:4",   // D7
    "G5:1 A5:1 B5:1 D6:1 F6:2 D6:2 B5:2 G5:2 -:4",     // G7, runs back to the top
  ];
  const CHORDS = ["C3", "F2", "G2", "C3", "A2", "F2", "D3", "G2"];
  const STEPS = MELODY.length * 16;

  const midi = name => {
    const m = /^([A-G])(#?)(\d)$/.exec(name);
    const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1]];
    return 12 * (Number(m[3]) + 1) + base + (m[2] ? 1 : 0);
  };
  const freq = n => 440 * Math.pow(2, (n - 69) / 12);

  // lead[step] = { note, len } where a note starts
  const lead = new Array(STEPS).fill(null);
  MELODY.forEach((bar, b) => {
    let step = b * 16;
    for (const tok of bar.split(" ")) {
      const [name, len] = tok.split(":");
      if (name !== "-") lead[step] = { note: midi(name), len: Number(len) };
      step += Number(len);
    }
  });

  let master = null, pulse = null, noiseBuf = null;
  let enabled = true;
  let playing = false;
  let step = 0, nextTime = 0;

  function setup() {
    const ac = audio.ctx;
    master = ac.createGain();
    master.gain.value = 0;
    master.connect(ac.destination);
    // 25% pulse wave: the classic 8-bit lead
    const n = 32, real = new Float32Array(n), imag = new Float32Array(n);
    for (let i = 1; i < n; i++) real[i] = (4 / (i * Math.PI)) * Math.sin(i * Math.PI * 0.25);
    pulse = ac.createPeriodicWave(real, imag);
    noiseBuf = ac.createBuffer(1, ac.sampleRate * 0.5, ac.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }

  function note(t, dur, f, type, vol, slideTo) {
    const ac = audio.ctx;
    const osc = ac.createOscillator();
    if (type === "pulse") osc.setPeriodicWave(pulse); else osc.type = type;
    osc.frequency.setValueAtTime(f, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.setValueAtTime(vol * 0.7, t + Math.min(0.06, dur * 0.5));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  function drum(t, kind, vol) {
    const ac = audio.ctx;
    if (kind === "kick") {
      note(t, 0.12, 150, "sine", vol * 1.6, 45);
      return;
    }
    const src = ac.createBufferSource();
    src.buffer = noiseBuf;
    const filter = ac.createBiquadFilter();
    filter.type = kind === "hat" ? "highpass" : "bandpass";
    filter.frequency.value = kind === "hat" ? 7000 : 1800;
    const g = ac.createGain();
    const dur = kind === "hat" ? 0.04 : 0.12;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter).connect(g).connect(master);
    src.start(t);
    src.stop(t + dur + 0.01);
  }

  function schedule(s, t, sixteenth, night) {
    const bar = Math.floor(s / 16), pos = s % 16;
    const root = midi(CHORDS[bar]);
    const ev = lead[s];
    if (night) {
      // lullaby: lead an octave down on a soft triangle, long bass notes
      if (ev) note(t, ev.len * sixteenth * 1.1, freq(ev.note - 12), "triangle", 0.11);
      if (pos === 0) note(t, 16 * sixteenth, freq(root), "triangle", 0.09);
      if (pos === 8) note(t, 8 * sixteenth, freq(root + 7), "triangle", 0.06);
      if (pos === 4 || pos === 12) drum(t, "hat", 0.012);
      return;
    }
    if (ev) {
      // tiny upward slide into the long notes makes it sound goofy
      const f = freq(ev.note);
      note(t, ev.len * sixteenth * 0.9, f, "pulse", 0.05, ev.len >= 4 ? f * 1.02 : 0);
      // quiet echo a 16th later, like old consoles faking a second voice
      note(t + sixteenth, ev.len * sixteenth * 0.6, f, "pulse", 0.015);
    }
    // oom-pah bass: root, octave, fifth, octave
    if (pos % 2 === 0) {
      const offs = [0, 12, 7, 12][(pos / 2) % 4];
      note(t, sixteenth * 1.7, freq(root + offs), "triangle", 0.12);
    }
    if (pos === 0 || pos === 8 || pos === 10) drum(t, "kick", 0.06);
    if (pos === 4 || pos === 12) drum(t, "snare", 0.05);
    if (pos % 2 === 0) drum(t, "hat", 0.018);
  }

  function tick() {
    if (!audio.ctx || audio.ctx.state !== "running") return;
    if (!master) setup();
    const want = enabled && !audio.muted && state !== "dizzy";
    const ac = audio.ctx;
    master.gain.setTargetAtTime(want ? 1 : 0, ac.currentTime, want ? 0.05 : 0.15);
    if (!want) {
      if (playing && state === "dizzy") step = 0;   // start over on the next game
      playing = false;
      return;
    }
    if (!playing) {
      playing = true;
      nextTime = ac.currentTime + 0.05;
    }
    const night = sky.night > 0.5;
    const sixteenth = 60 / (night ? 104 : 148) / 4;
    while (nextTime < ac.currentTime + 0.15) {
      // swing: delay every second 8th note a little
      const swing = step % 4 === 2 ? sixteenth * 0.3 : 0;
      schedule(step, nextTime + swing, sixteenth, night);
      nextTime += sixteenth;
      step = (step + 1) % STEPS;
    }
  }

  setInterval(tick, 25);

  return {
    toggle() { enabled = !enabled; },
    get enabled() { return enabled; },
  };
})();
