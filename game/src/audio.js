// Procedural WebAudio — every sound and every music bed is synthesised, so the
// project ships with zero binary assets and agents can retune the whole soundtrack
// by editing data. Music themes are frame-locked sequences, not files.

const SCALES = {
  meadow: [0, 2, 4, 7, 9, 12, 14, 16],
  cave:   [0, 3, 5, 7, 10, 12, 15, 17],
  factory:[0, 1, 5, 6, 8, 11, 12, 13],
  arena:  [0, 2, 3, 7, 8, 10, 12, 14],
};

export class Audio {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.musicVol = 0.16;
    this.sfxVol = 0.35;
    this._theme = 'meadow';
    this._step = 0;
    this._timer = null;
  }

  _ensure() {
    if (!this.ctx) {
      const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.enabled ? 1 : 0;
      this.master.connect(this.ctx.destination);
      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = this.musicVol;
      this.musicGain.connect(this.master);
      this.sfxGain = this.ctx.createGain();
      this.sfxGain.gain.value = this.sfxVol;
      this.sfxGain.connect(this.master);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  setEnabled(on) {
    this.enabled = on;
    if (this.master) this.master.gain.value = on ? 1 : 0;
  }

  _tone({ freq, dur = 0.12, type = 'square', gain = 1, slide = 0, dest }) {
    const ctx = this._ensure();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    const t = ctx.currentTime;
    osc.frequency.setValueAtTime(freq, t);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(dest ?? this.sfxGain);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  _noise(dur = 0.18, gain = 0.5, freq = 1200) {
    const ctx = this._ensure();
    if (!ctx) return;
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(f).connect(g).connect(this.sfxGain);
    src.start();
  }

  jump()   { this._tone({ freq: 330, slide: 260, dur: 0.12, type: 'square', gain: 0.5 }); }
  dash()   { this._noise(0.16, 0.45, 2400); this._tone({ freq: 520, slide: -300, dur: 0.14, type: 'sawtooth', gain: 0.3 }); }
  // One voice per engine event type. Each is two nodes at most and short, so a
  // frame that drains a handful of events stays cheap; the mapping from event
  // to voice lives in main.js (one event, one call, no inference).
  strike() { this._tone({ freq: 720, slide: -220, dur: 0.09, type: 'triangle', gain: 0.6 }); }
  coin()   { this._tone({ freq: 1046, dur: 0.06, type: 'square', gain: 0.4 }); setTimeout(() => this._tone({ freq: 1568, dur: 0.08, type: 'square', gain: 0.32 }), 55); }
  heal()   { this._tone({ freq: 466, slide: 262, dur: 0.14, type: 'sine', gain: 0.45 }); }
  key()    { this._tone({ freq: 1318, slide: 520, dur: 0.09, type: 'square', gain: 0.3 }); }
  checkpoint() { this._tone({ freq: 587, slide: 392, dur: 0.18, type: 'triangle', gain: 0.45 }); }
  hit()    { this._noise(0.2, 0.55, 420); this._tone({ freq: 160, slide: -80, dur: 0.16, type: 'sawtooth', gain: 0.4 }); }
  kill()   { this._noise(0.12, 0.4, 900); this._tone({ freq: 300, slide: -190, dur: 0.12, type: 'sawtooth', gain: 0.32 }); }
  hurt()   { this._tone({ freq: 220, slide: -160, dur: 0.24, type: 'square', gain: 0.45 }); }
  // A fall is a thud, not a hit: the player should hear the ground, not a blade.
  fell()   { this._tone({ freq: 120, slide: -70, dur: 0.14, type: 'sine', gain: 0.5 }); this._noise(0.06, 0.16, 240); }
  // Locked gate: a dull double clank, so a refused exit reads as "not yet".
  locked() { this._tone({ freq: 150, dur: 0.08, type: 'square', gain: 0.32 }); this._tone({ freq: 98, slide: -18, dur: 0.12, type: 'square', gain: 0.28 }); }
  respawn() { this._tone({ freq: 660, slide: 240, dur: 0.12, type: 'triangle', gain: 0.4 }); }
  win()    { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this._tone({ freq: f, dur: 0.18, type: 'triangle', gain: 0.5 }), i * 110)); }
  lose()   { [392, 330, 262, 196].forEach((f, i) => setTimeout(() => this._tone({ freq: f, dur: 0.22, type: 'sawtooth', gain: 0.35 }), i * 140)); }
  bossWarn() { this._tone({ freq: 84, dur: 0.5, type: 'sawtooth', gain: 0.5 }); }

  startMusic(theme = 'meadow') {
    this._theme = theme;
    if (this._timer) clearInterval(this._timer);
    const scale = SCALES[theme] ?? SCALES.meadow;
    const base = theme === 'cave' ? 98 : theme === 'factory' ? 110 : 130.8;
    this._timer = setInterval(() => {
      if (!this.enabled) return;
      const step = this._step++;
      const deg = scale[step % scale.length];
      const freq = base * Math.pow(2, deg / 12);
      const bar = Math.floor(step / 8) % 4;
      this._tone({ freq, dur: theme === 'arena' ? 0.1 : 0.16, type: bar % 2 ? 'triangle' : 'square', gain: 0.22, dest: this.musicGain });
      if (step % 4 === 0) this._tone({ freq: base / 2, dur: 0.22, type: 'sine', gain: 0.32, dest: this.musicGain });
      if (theme !== 'cave' && step % 2 === 1) this._tone({ freq: base * 2 * Math.pow(2, deg / 12), dur: 0.06, type: 'square', gain: 0.08, dest: this.musicGain });
    }, theme === 'arena' ? 150 : 190);
  }

  stopMusic() {
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
  }
}
