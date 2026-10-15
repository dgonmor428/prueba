/* ===========================================================================
 * BLACKSITE: LAST SIGNAL  —  js/core/audio.js
 * ---------------------------------------------------------------------------
 * Propósito : audio 100% procedural (Web Audio API). Sin ficheros: un único
 *             AudioBuffer de ruido blanco compartido + osciladores + filtros
 *             biquad + envolventes + playbackRate. Buses master/sfx/música,
 *             atenuación por distancia MANUAL + StereoPannerNode (sin HRTF),
 *             presupuesto de voces y catálogo de 39 sonidos con nombre.
 *             Ninguna llamada lanza: si no hay AudioContext o está `suspended`
 *             devuelve null (política de autoplay, R5).
 * Depende de: js/core/util.js (BS.Log, BS.Util, BS.RNG)
 * Expone    : BS.Audio
 * =========================================================================== */
(function (BS) {
  'use strict';

  var NAMES = [
    'pistol', 'smg', 'plasma', 'plasma_impact', 'shell_drop', 'empty_click', 'reload_out', 'reload_in',
    'hit_world', 'hit_flesh', 'hitmarker', 'kill_confirm', 'explosion', 'footstep', 'land', 'jump',
    'crouch', 'pickup_ammo', 'pickup_health', 'pickup_weapon', 'ui_click', 'ui_hover', 'ui_denied',
    'door_open', 'alarm_beep', 'terminal_on', 'enemy_alert', 'enemy_growl', 'enemy_attack',
    'enemy_death', 'drone_hover', 'brute_step', 'ambient_hum', 'ambient_wind', 'alarm_loop',
    'music_menu', 'music_combat', 'heartbeat', 'shield_break'
  ];

  /* ----------------------------------------------------------------------
   * Catálogo procedural. Cada receta = capas que se suman.
   *   k:'osc'   -> OscillatorNode (w, f0->f1)
   *   k:'noise' -> AudioBufferSourceNode sobre el buffer de ruido (rate)
   *   k:'am'    -> modulador de amplitud (LFO) sobre la ganancia de la voz
   * Campos comunes: gain, dur, delay, atk, sus (sostener en vez de decaer),
   *                 pan, filt/fc0/fc1/q.
   * -------------------------------------------------------------------- */
  var RECIPES = {
    pistol: {
      bus: 'sfx', tag: 'weapon', gain: 1.0, layers: [
        { k: 'osc', w: 'triangle', f0: 330, f1: 70, dur: 0.11, gain: 0.50, atk: 0.001 },
        { k: 'noise', rate: 1.45, dur: 0.10, gain: 0.55, filt: 'lowpass', fc0: 2600, fc1: 400, q: 1.1 }
      ]
    },
    smg: {
      bus: 'sfx', tag: 'weapon', gain: 0.95, layers: [
        { k: 'osc', w: 'square', f0: 480, f1: 120, dur: 0.055, gain: 0.34, atk: 0.001 },
        { k: 'noise', rate: 1.85, dur: 0.05, gain: 0.45, filt: 'lowpass', fc0: 3800, fc1: 700, q: 0.9 }
      ]
    },
    plasma: {
      bus: 'sfx', tag: 'weapon', gain: 1.0, layers: [
        { k: 'osc', w: 'sawtooth', f0: 1250, f1: 260, dur: 0.22, gain: 0.26, filt: 'bandpass', fc0: 1800, fc1: 520, q: 6 },
        { k: 'noise', rate: 0.7, dur: 0.18, gain: 0.20, filt: 'bandpass', fc0: 900, fc1: 220, q: 4 }
      ]
    },
    plasma_impact: {
      bus: 'sfx', tag: 'impact', gain: 1.0, layers: [
        { k: 'noise', rate: 0.9, dur: 0.30, gain: 0.40, filt: 'bandpass', fc0: 400, fc1: 2400, q: 4 },
        { k: 'osc', w: 'sine', f0: 180, f1: 60, dur: 0.30, gain: 0.30 }
      ]
    },
    shell_drop: {
      bus: 'sfx', tag: 'weapon', gain: 1.0, layers: [
        { k: 'osc', w: 'triangle', f0: 2400, f1: 1800, dur: 0.04, gain: 0.12 },
        { k: 'osc', w: 'triangle', f0: 1700, f1: 1200, dur: 0.05, gain: 0.10, delay: 0.09 }
      ]
    },
    empty_click: {
      bus: 'sfx', tag: 'weapon', gain: 1.0, layers: [
        { k: 'osc', w: 'square', f0: 1500, f1: 900, dur: 0.03, gain: 0.18 },
        { k: 'noise', rate: 2.0, dur: 0.02, gain: 0.20, filt: 'highpass', fc0: 3000, q: 0.7 }
      ]
    },
    reload_out: {
      bus: 'sfx', tag: 'weapon', gain: 1.0, layers: [
        { k: 'noise', rate: 1.2, dur: 0.10, gain: 0.25, filt: 'bandpass', fc0: 1200, fc1: 700, q: 3 },
        { k: 'osc', w: 'triangle', f0: 700, f1: 500, dur: 0.07, gain: 0.15, delay: 0.02 }
      ]
    },
    reload_in: {
      bus: 'sfx', tag: 'weapon', gain: 1.0, layers: [
        { k: 'noise', rate: 1.0, dur: 0.11, gain: 0.28, filt: 'bandpass', fc0: 900, fc1: 600, q: 3 },
        { k: 'osc', w: 'square', f0: 420, f1: 300, dur: 0.09, gain: 0.20, delay: 0.01 }
      ]
    },
    hit_world: {
      bus: 'sfx', tag: 'impact', gain: 1.0, layers: [
        { k: 'noise', rate: 1.6, dur: 0.07, gain: 0.35, filt: 'bandpass', fc0: 1400, fc1: 600, q: 2 },
        { k: 'osc', w: 'sine', f0: 200, f1: 90, dur: 0.06, gain: 0.20 }
      ]
    },
    hit_flesh: {
      bus: 'sfx', tag: 'impact', gain: 1.0, layers: [
        { k: 'noise', rate: 0.5, dur: 0.15, gain: 0.40, filt: 'lowpass', fc0: 700, fc1: 220, q: 1 },
        { k: 'osc', w: 'sine', f0: 140, f1: 70, dur: 0.16, gain: 0.35 }
      ]
    },
    hitmarker: {
      bus: 'sfx', tag: 'ui', gain: 1.0, layers: [
        { k: 'osc', w: 'sine', f0: 1600, f1: 1600, dur: 0.045, gain: 0.30 },
        { k: 'osc', w: 'sine', f0: 2400, f1: 2400, dur: 0.03, gain: 0.14, delay: 0.01 }
      ]
    },
    kill_confirm: {
      bus: 'sfx', tag: 'ui', gain: 1.0, layers: [
        { k: 'osc', w: 'square', f0: 660, f1: 660, dur: 0.06, gain: 0.22 },
        { k: 'osc', w: 'square', f0: 990, f1: 990, dur: 0.10, gain: 0.22, delay: 0.06 }
      ]
    },
    explosion: {
      bus: 'sfx', tag: 'explosion', gain: 1.0, layers: [
        { k: 'noise', rate: 0.35, dur: 1.00, gain: 0.80, filt: 'lowpass', fc0: 1200, fc1: 120, q: 1 },
        { k: 'osc', w: 'sine', f0: 90, f1: 35, dur: 0.90, gain: 0.50 },
        { k: 'osc', w: 'sawtooth', f0: 160, f1: 50, dur: 0.50, gain: 0.25, filt: 'lowpass', fc0: 900, fc1: 200, q: 1 }
      ]
    },
    footstep: {
      bus: 'sfx', tag: 'footstep', gain: 1.0, layers: [
        { k: 'noise', rate: 1.3, dur: 0.09, gain: 0.30, filt: 'lowpass', fc0: 900, fc1: 280, q: 1 },
        { k: 'osc', w: 'sine', f0: 110, f1: 60, dur: 0.07, gain: 0.16 }
      ]
    },
    land: {
      bus: 'sfx', tag: 'footstep', gain: 1.0, layers: [
        { k: 'noise', rate: 0.8, dur: 0.22, gain: 0.50, filt: 'lowpass', fc0: 500, fc1: 160, q: 1 },
        { k: 'osc', w: 'sine', f0: 130, f1: 50, dur: 0.25, gain: 0.40 }
      ]
    },
    jump: {
      bus: 'sfx', tag: 'footstep', gain: 1.0, layers: [
        { k: 'noise', rate: 1.1, dur: 0.12, gain: 0.18, filt: 'highpass', fc0: 500, fc1: 1400, q: 0.8 },
        { k: 'osc', w: 'triangle', f0: 300, f1: 520, dur: 0.10, gain: 0.10 }
      ]
    },
    crouch: {
      bus: 'sfx', tag: 'footstep', gain: 1.0, layers: [
        { k: 'noise', rate: 0.6, dur: 0.16, gain: 0.18, filt: 'lowpass', fc0: 600, fc1: 260, q: 1 }
      ]
    },
    pickup_ammo: {
      bus: 'sfx', tag: 'pickup', gain: 1.0, layers: [
        { k: 'osc', w: 'square', f0: 700, f1: 900, dur: 0.05, gain: 0.20 },
        { k: 'osc', w: 'square', f0: 1200, f1: 1200, dur: 0.05, gain: 0.18, delay: 0.05 },
        { k: 'noise', rate: 1.5, dur: 0.03, gain: 0.15, filt: 'highpass', fc0: 2500, q: 0.7 }
      ]
    },
    pickup_health: {
      bus: 'sfx', tag: 'pickup', gain: 1.0, layers: [
        { k: 'osc', w: 'sine', f0: 520, f1: 520, dur: 0.10, gain: 0.22 },
        { k: 'osc', w: 'sine', f0: 780, f1: 780, dur: 0.14, gain: 0.20, delay: 0.07 }
      ]
    },
    pickup_weapon: {
      bus: 'sfx', tag: 'pickup', gain: 1.0, layers: [
        { k: 'noise', rate: 1.1, dur: 0.08, gain: 0.30, filt: 'bandpass', fc0: 1800, fc1: 900, q: 2 },
        { k: 'osc', w: 'square', f0: 400, f1: 800, dur: 0.16, gain: 0.22, delay: 0.04 }
      ]
    },
    ui_click: {
      bus: 'sfx', tag: 'ui', gain: 1.0, layers: [
        { k: 'osc', w: 'sine', f0: 1250, f1: 1250, dur: 0.035, gain: 0.22 }
      ]
    },
    ui_hover: {
      bus: 'sfx', tag: 'ui', gain: 1.0, layers: [
        { k: 'osc', w: 'sine', f0: 2000, f1: 2000, dur: 0.022, gain: 0.10 }
      ]
    },
    ui_denied: {
      bus: 'sfx', tag: 'ui', gain: 1.0, layers: [
        { k: 'osc', w: 'sawtooth', f0: 260, f1: 150, dur: 0.16, gain: 0.20, filt: 'lowpass', fc0: 1400, q: 1 },
        { k: 'noise', rate: 0.6, dur: 0.10, gain: 0.12, filt: 'lowpass', fc0: 800, q: 1 }
      ]
    },
    door_open: {
      bus: 'sfx', tag: 'world', gain: 1.0, layers: [
        { k: 'noise', rate: 0.45, dur: 0.80, gain: 0.35, filt: 'lowpass', fc0: 500, fc1: 180, q: 1 },
        { k: 'osc', w: 'sawtooth', f0: 70, f1: 48, dur: 0.70, gain: 0.22, filt: 'lowpass', fc0: 300, q: 2 }
      ]
    },
    alarm_beep: {
      bus: 'sfx', tag: 'world', gain: 1.0, layers: [
        { k: 'osc', w: 'square', f0: 900, f1: 900, dur: 0.14, gain: 0.25 },
        { k: 'osc', w: 'square', f0: 900, f1: 900, dur: 0.14, gain: 0.25, delay: 0.26 }
      ]
    },
    terminal_on: {
      bus: 'sfx', tag: 'world', gain: 1.0, layers: [
        { k: 'osc', w: 'sine', f0: 220, f1: 1100, dur: 0.35, gain: 0.18 },
        { k: 'noise', rate: 0.9, dur: 0.30, gain: 0.12, filt: 'highpass', fc0: 1200, fc1: 3000, q: 0.8 }
      ]
    },
    enemy_alert: {
      bus: 'sfx', tag: 'enemy', gain: 1.0, layers: [
        { k: 'osc', w: 'sawtooth', f0: 160, f1: 420, dur: 0.35, gain: 0.26, filt: 'bandpass', fc0: 700, fc1: 1400, q: 5 }
      ]
    },
    enemy_growl: {
      bus: 'sfx', tag: 'enemy', gain: 1.0, layers: [
        { k: 'osc', w: 'sawtooth', f0: 85, f1: 70, dur: 0.55, gain: 0.30, filt: 'lowpass', fc0: 420, fc1: 220, q: 3 },
        { k: 'noise', rate: 0.3, dur: 0.50, gain: 0.14, filt: 'lowpass', fc0: 300, q: 1 }
      ]
    },
    enemy_attack: {
      bus: 'sfx', tag: 'enemy', gain: 1.0, layers: [
        { k: 'osc', w: 'sawtooth', f0: 700, f1: 180, dur: 0.30, gain: 0.30, filt: 'lowpass', fc0: 2200, fc1: 600, q: 2 },
        { k: 'noise', rate: 1.2, dur: 0.22, gain: 0.22, filt: 'bandpass', fc0: 1600, fc1: 500, q: 2 }
      ]
    },
    enemy_death: {
      bus: 'sfx', tag: 'enemy', gain: 1.0, layers: [
        { k: 'osc', w: 'sawtooth', f0: 420, f1: 60, dur: 0.80, gain: 0.30, filt: 'lowpass', fc0: 1800, fc1: 300, q: 2 },
        { k: 'noise', rate: 0.6, dur: 0.70, gain: 0.25, filt: 'lowpass', fc0: 1200, fc1: 200, q: 1 }
      ]
    },
    drone_hover: {
      bus: 'sfx', tag: 'ambient', gain: 0.9, loop: true, layers: [
        { k: 'osc', w: 'triangle', f0: 118, f1: 118, dur: 1.0, gain: 0.22, sus: true, filt: 'lowpass', fc0: 600, q: 1 },
        { k: 'osc', w: 'sine', f0: 236, f1: 239, detune: 6, dur: 1.0, gain: 0.10, sus: true },
        { k: 'am', w: 'sine', freq: 7.5, depth: 0.35 }
      ]
    },
    brute_step: {
      bus: 'sfx', tag: 'footstep', gain: 1.0, layers: [
        { k: 'noise', rate: 0.4, dur: 0.30, gain: 0.55, filt: 'lowpass', fc0: 320, fc1: 90, q: 1 },
        { k: 'osc', w: 'sine', f0: 70, f1: 40, dur: 0.34, gain: 0.45 }
      ]
    },
    ambient_hum: {
      bus: 'sfx', tag: 'ambient', gain: 0.6, loop: true, layers: [
        { k: 'osc', w: 'sine', f0: 55, f1: 55, dur: 4.0, gain: 0.12, sus: true },
        { k: 'osc', w: 'sine', f0: 110.5, f1: 110.5, dur: 4.0, gain: 0.06, sus: true },
        { k: 'am', w: 'sine', freq: 0.13, depth: 0.20 }
      ]
    },
    ambient_wind: {
      bus: 'sfx', tag: 'ambient', gain: 0.7, loop: true, layers: [
        { k: 'noise', rate: 0.22, dur: 6.0, gain: 0.18, sus: true, filt: 'lowpass', fc0: 500, fc1: 900, q: 0.8 },
        { k: 'am', w: 'sine', freq: 0.09, depth: 0.45 }
      ]
    },
    alarm_loop: {
      bus: 'sfx', tag: 'alarm', gain: 0.8, loop: true, layers: [
        { k: 'osc', w: 'square', f0: 780, f1: 780, dur: 4.0, gain: 0.12, sus: true },
        { k: 'osc', w: 'sine', f0: 520, f1: 520, dur: 4.0, gain: 0.06, sus: true },
        { k: 'am', w: 'square', freq: 2.0, depth: 0.5 }
      ]
    },
    music_menu: {
      bus: 'music', tag: 'music', gain: 1.0, loop: true, layers: [
        { k: 'osc', w: 'sine', f0: 110, f1: 110, dur: 4.0, gain: 0.12, sus: true },
        { k: 'osc', w: 'sine', f0: 164.8, f1: 164.8, detune: 4, dur: 4.0, gain: 0.09, sus: true },
        { k: 'osc', w: 'triangle', f0: 220, f1: 220, dur: 4.0, gain: 0.05, sus: true },
        { k: 'am', w: 'sine', freq: 0.15, depth: 0.25 }
      ]
    },
    music_combat: {
      bus: 'music', tag: 'music', gain: 1.0, loop: true, layers: [
        { k: 'osc', w: 'sawtooth', f0: 82.4, f1: 82.4, dur: 4.0, gain: 0.11, sus: true, filt: 'lowpass', fc0: 600, q: 2 },
        { k: 'osc', w: 'square', f0: 123.5, f1: 123.5, dur: 4.0, gain: 0.06, sus: true, filt: 'lowpass', fc0: 900, q: 1 },
        { k: 'noise', rate: 0.5, dur: 4.0, gain: 0.05, sus: true, filt: 'bandpass', fc0: 300, q: 1 },
        { k: 'am', w: 'square', freq: 2.2, depth: 0.40 }
      ]
    },
    heartbeat: {
      bus: 'sfx', tag: 'ui', gain: 1.0, layers: [
        { k: 'osc', w: 'sine', f0: 62, f1: 40, dur: 0.18, gain: 0.50 },
        { k: 'osc', w: 'sine', f0: 55, f1: 38, dur: 0.22, gain: 0.35, delay: 0.28 }
      ]
    },
    shield_break: {
      bus: 'sfx', tag: 'impact', gain: 1.0, layers: [
        { k: 'noise', rate: 1.0, dur: 0.35, gain: 0.35, filt: 'highpass', fc0: 2500, fc1: 5000, q: 0.8 },
        { k: 'osc', w: 'triangle', f0: 1800, f1: 3200, dur: 0.30, gain: 0.20 },
        { k: 'osc', w: 'square', f0: 900, f1: 200, dur: 0.25, gain: 0.15 }
      ]
    }
  };

  var Audio = {
    ctx: null,
    ready: false,
    noiseBuffer: null,
    voices: [],
    voiceBudget: 24,
    muted: false,
    masterGain: null,
    sfxGain: null,
    musicGain: null,
    masterVolume: 0.8,
    sfxVolume: 0.9,
    musicVolume: 0.5,
    lastPlayError: null,
    NAMES: NAMES,
    RECIPES: RECIPES,

    listener: {
      pos: new Float32Array([0, 0, 0]),
      forward: new Float32Array([0, 0, -1]),
      up: new Float32Array([0, 1, 0]),
      right: new Float32Array([1, 0, 0]),
      set: false
    },

    /* ==================================================================
     * Ciclo de vida
     * ================================================================== */
    init: function () {
      if (Audio.ctx) { Audio.ready = true; return true; }
      var AC = (typeof window !== 'undefined') ? (window.AudioContext || window.webkitAudioContext) : null;
      if (!AC) {
        Audio.lastPlayError = 'AudioContext no disponible';
        BS.Log.warn('BS.Audio.init: AudioContext no disponible');
        return false;
      }
      try {
        try {
          Audio.ctx = new AC({ latencyHint: 'interactive' });
        } catch (e0) {
          Audio.ctx = new AC();
        }
      } catch (e) {
        Audio.lastPlayError = 'no se pudo crear AudioContext: ' + (e && e.message ? e.message : e);
        BS.Log.warn('BS.Audio.init: ' + Audio.lastPlayError);
        return false;
      }
      try {
        var c = Audio.ctx;
        Audio.masterGain = c.createGain();
        var comp = null;
        try { comp = c.createDynamicsCompressor(); } catch (e1) { comp = null; }
        if (comp) {
          comp.threshold.value = -8;
          comp.knee.value = 12;
          comp.ratio.value = 6;
          comp.attack.value = 0.004;
          comp.release.value = 0.18;
          Audio.masterGain.connect(comp);
          comp.connect(c.destination);
        } else {
          Audio.masterGain.connect(c.destination);
        }
        Audio.sfxGain = c.createGain();
        Audio.musicGain = c.createGain();
        Audio.sfxGain.connect(Audio.masterGain);
        Audio.musicGain.connect(Audio.masterGain);
        Audio._applyVolumes();
        Audio.ready = true;
      } catch (e2) {
        BS.Log.error('BS.Audio.init: fallo al montar los buses', e2 && e2.message);
        Audio.ready = false;
        return false;
      }
      BS.Log.info('BS.Audio.init OK (estado=' + Audio.ctx.state + ')');
      return true;
    },

    /** Solo desde un gesto del usuario. */
    resume: function () {
      try {
        if (!Audio.ctx) { if (!Audio.init()) return Promise.resolve(false); }
        if (Audio.ctx.state === 'running') return Promise.resolve(true);
        var p = null;
        try { p = Audio.ctx.resume(); } catch (e0) { p = null; }
        if (p && typeof p.then === 'function') {
          return p.then(function () { return Audio.ctx.state === 'running'; })
            .catch(function (e) {
              Audio.lastPlayError = 'resume rechazado: ' + (e && e.message ? e.message : e);
              return false;
            });
        }
        return Promise.resolve(Audio.ctx.state === 'running');
      } catch (e) {
        Audio.lastPlayError = String(e && e.message ? e.message : e);
        return Promise.resolve(false);
      }
    },

    isRunning: function () {
      return !!(Audio.ctx && Audio.ctx.state === 'running');
    },

    suspend: function () {
      try { if (Audio.ctx && Audio.ctx.suspend) Audio.ctx.suspend(); } catch (e) { /* noop */ }
    },

    /** Genera el buffer de ruido blanco compartido de 2 s (0.35 MB). */
    preload: function () {
      if (!Audio.init()) return;
      if (Audio.noiseBuffer) return;
      try {
        var c = Audio.ctx;
        var sr = c.sampleRate || 44100;
        var len = Math.floor(sr * 2);
        var buf = c.createBuffer(1, len, sr);
        var d = buf.getChannelData(0);
        var rng = BS.RNG.create(0x51A7E);
        for (var i = 0; i < len; i++) d[i] = rng() * 2 - 1;
        Audio.noiseBuffer = buf;
      } catch (e) {
        BS.Log.warn('BS.Audio.preload: no se pudo generar el buffer de ruido');
      }
    },

    /* ==================================================================
     * Volúmenes y buses
     * ================================================================== */
    _applyVolumes: function () {
      var m = Audio.muted ? 0 : Audio.masterVolume;
      try {
        if (Audio.masterGain) Audio.masterGain.gain.value = m;
        if (Audio.sfxGain) Audio.sfxGain.gain.value = Audio.sfxVolume;
        if (Audio.musicGain) Audio.musicGain.gain.value = Audio.musicVolume;
      } catch (e) { /* noop */ }
    },

    setMasterVolume: function (v) { Audio.masterVolume = BS.Math ? BS.Math.clamp01(Number(v) || 0) : (Number(v) || 0); Audio._applyVolumes(); },
    setSfxVolume: function (v) { Audio.sfxVolume = BS.Math ? BS.Math.clamp01(Number(v) || 0) : (Number(v) || 0); Audio._applyVolumes(); },
    setMusicVolume: function (v) { Audio.musicVolume = BS.Math ? BS.Math.clamp01(Number(v) || 0) : (Number(v) || 0); Audio._applyVolumes(); },
    getMasterVolume: function () { return Audio.masterVolume; },
    getSfxVolume: function () { return Audio.sfxVolume; },
    getMusicVolume: function () { return Audio.musicVolume; },
    mute: function (on) { Audio.muted = !!on; Audio._applyVolumes(); },
    isMuted: function () { return Audio.muted; },

    setVoiceBudget: function (n) {
      Audio.voiceBudget = Math.max(1, n | 0);
    },

    /* ==================================================================
     * Escucha (atenuación manual + StereoPanner)
     * ================================================================== */
    setListener: function (pos, forward, up) {
      var L = Audio.listener;
      if (pos) { L.pos[0] = pos[0]; L.pos[1] = pos[1]; L.pos[2] = pos[2]; L.set = true; }
      if (forward && (forward[0] || forward[1] || forward[2])) {
        L.forward[0] = forward[0]; L.forward[1] = forward[1]; L.forward[2] = forward[2];
        var fl = Math.sqrt(forward[0] * forward[0] + forward[1] * forward[1] + forward[2] * forward[2]) || 1;
        L.forward[0] /= fl; L.forward[1] /= fl; L.forward[2] /= fl;
      }
      if (up) { L.up[0] = up[0]; L.up[1] = up[1]; L.up[2] = up[2]; }
      // right = normalize(cross(forward, up))
      var rx = L.forward[1] * L.up[2] - L.forward[2] * L.up[1];
      var ry = L.forward[2] * L.up[0] - L.forward[0] * L.up[2];
      var rz = L.forward[0] * L.up[1] - L.forward[1] * L.up[0];
      var rl = Math.sqrt(rx * rx + ry * ry + rz * rz) || 1;
      L.right[0] = rx / rl; L.right[1] = ry / rl; L.right[2] = rz / rl;
    },

    /** Ganancia y paneo manuales para una posición concreta. */
    _spatial: function (pos) {
      var L = Audio.listener;
      var dx = pos[0] - L.pos[0], dy = pos[1] - L.pos[1], dz = pos[2] - L.pos[2];
      var dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      var att = 1 / (1 + (dist / 7) * (dist / 7));
      if (dist > 48) att = 0;
      var pan = 0;
      if (dist > 0.001) {
        var inv = 1 / dist;
        pan = (dx * inv) * L.right[0] + (dy * inv) * L.right[1] + (dz * inv) * L.right[2];
        if (pan > 1) pan = 1; else if (pan < -1) pan = -1;
      }
      return { gain: att, pan: pan, distance: dist };
    },

    /* ==================================================================
     * Reproducción
     * ================================================================== */
    play: function (name, opts) {
      Audio.lastPlayError = null;
      try {
        var recipe = RECIPES[name];
        if (!recipe) { Audio.lastPlayError = 'sonido desconocido: ' + name; return null; }
        if (!Audio.ctx) { Audio.lastPlayError = 'sin AudioContext'; return null; }
        if (Audio.ctx.state !== 'running') { Audio.lastPlayError = 'contexto ' + Audio.ctx.state; return null; }
        return Audio._build(recipe, name, opts || {}, false);
      } catch (e) {
        Audio.lastPlayError = (e && e.message) ? e.message : String(e);
        BS.Log.error('BS.Audio.play("' + name + '"):', Audio.lastPlayError);
        return null;
      }
    },

    loop: function (name, opts) {
      var recipe = RECIPES[name];
      if (!recipe) { Audio.lastPlayError = 'sonido desconocido: ' + name; return null; }
      if (!Audio.ctx || Audio.ctx.state !== 'running') { Audio.lastPlayError = 'contexto no operativo'; return null; }
      try {
        return Audio._build(recipe, name, opts || {}, true);
      } catch (e) {
        Audio.lastPlayError = (e && e.message) ? e.message : String(e);
        BS.Log.error('BS.Audio.loop("' + name + '"):', Audio.lastPlayError);
        return null;
      }
    },

    _build: function (recipe, name, opts, forceLoop) {
      var c = Audio.ctx;
      var t0 = c.currentTime + 0.001;
      var bus = (recipe.bus === 'music') ? Audio.musicGain : Audio.sfxGain;
      if (!bus) return null;

      var looping = forceLoop || recipe.loop === true;

      // --- presión de presupuesto de voces (R6, R20)
      if (Audio.voices.length >= Audio.voiceBudget) {
        var worstIdx = -1, worstScore = Infinity;
        for (var i = 0; i < Audio.voices.length; i++) {
          var v = Audio.voices[i];
          if (v.tag === 'music') continue;
          var score = v._effGain;
          if (score < worstScore) { worstScore = score; worstIdx = i; }
        }
        if (worstIdx < 0) { Audio.lastPlayError = 'presupuesto de voces lleno'; return null; }
        Audio.voices[worstIdx].stop(0.03);
      }

      var vol = (opts.volume === undefined) ? 1 : Number(opts.volume);
      if (!isFinite(vol)) vol = 1;
      if (opts.volumeJitter) vol *= (1 + (Math.random() * 2 - 1) * opts.volumeJitter);
      var rate = (opts.rate === undefined) ? 1 : Number(opts.rate);
      if (!isFinite(rate) || rate <= 0) rate = 1;
      if (opts.rateJitter) rate *= (1 + (Math.random() * 2 - 1) * opts.rateJitter);
      rate *= (recipe.rate || 1);

      var spatial = !!(opts.pos && opts.pos.length >= 3);
      var pos = spatial ? new Float32Array([opts.pos[0], opts.pos[1], opts.pos[2]]) : null;

      var baseGain = (recipe.gain === undefined ? 1 : recipe.gain) * vol;
      var spatialInfo = spatial ? Audio._spatial(pos) : { gain: 1, pan: 0, distance: 0 };
      var effGain = baseGain * spatialInfo.gain;

      // --- nodos del bus de la voz
      var voiceGain = c.createGain();
      voiceGain.gain.value = effGain;

      var panner = null;
      if (typeof c.createStereoPanner === 'function') {
        try { panner = c.createStereoPanner(); } catch (e0) { panner = null; }
      }
      if (panner) {
        panner.pan.value = spatialInfo.pan;
        voiceGain.connect(panner);
        panner.connect(bus);
      } else {
        voiceGain.connect(bus);
      }

      var voice = {
        tag: opts.tag || recipe.tag || name,
        name: name,
        bus: recipe.bus === 'music' ? 'music' : 'sfx',
        loop: looping,
        spatial: spatial,
        pos: pos,
        volume: vol,
        rate: rate,
        baseGain: baseGain,
        _effGain: effGain,
        _spatialSomeone: spatial,
        _gain: voiceGain,
        _panner: panner,
        _srcs: [],
        _lfoOsc: null,
        _lfoGain: null,
        _stopped: false,
        startTime: t0,
        endTime: looping ? Infinity : t0,
        spatial_info: spatialInfo,

        isPlaying: function () {
          if (voice._stopped) return false;
          if (voice.loop) return true;
          return Audio.ctx ? (Audio.ctx.currentTime < voice.endTime) : false;
        },

        setVolume: function (v) {
          voice.volume = Math.max(0, Number(v) || 0);
          var g = voice.baseGain * (voice.volume / (opts.volume || 1)) * (voice._spatialSomeone ? voice.spatial_info.gain : 1);
          try {
            voice._gain.gain.setTargetAtTime(g, Audio.ctx.currentTime, 0.02);
          } catch (e) { try { voice._gain.gain.value = g; } catch (e2) { /* noop */ } }
          voice._effGain = g;
        },

        setPosition: function (p) {
          if (!p) return;
          voice.spatial = true;
          voice._spatialSomeone = true;
          if (!voice.pos) voice.pos = new Float32Array(3);
          voice.pos[0] = p[0]; voice.pos[1] = p[1]; voice.pos[2] = p[2];
          var s = Audio._spatial(voice.pos);
          voice.spatial_info = s;
          voice._effGain = voice.baseGain * s.gain;
          try {
            voice._gain.gain.setTargetAtTime(voice._effGain, Audio.ctx.currentTime, 0.03);
            if (voice._panner) voice._panner.pan.setTargetAtTime(s.pan, Audio.ctx.currentTime, 0.03);
          } catch (e) { /* noop */ }
        },

        setRate: function (r) {
          r = Number(r) || 1;
          for (var i = 0; i < voice._srcs.length; i++) {
            var s = voice._srcs[i];
            try {
              if (s.playbackRate) s.playbackRate.value = s._baseRate * r;
            } catch (e) { /* noop */ }
          }
          if (voice._oscs) {
            for (var k = 0; k < voice._oscs.length; k++) {
              try {
                voice._oscs[k].detune.value = 1200 * Math.log(r) / Math.LN2;
              } catch (e2) { /* noop */ }
            }
          }
        },

        stop: function (fade) {
          if (voice._stopped) return;
          voice._stopped = true;
          var f = (fade === undefined || fade === null) ? 0.05 : Math.max(0, fade);
          var now = Audio.ctx ? Audio.ctx.currentTime : 0;
          try {
            voice._gain.gain.cancelScheduledValues(now);
            voice._gain.gain.setValueAtTime(Math.max(0.0001, voice._gain.gain.value), now);
            voice._gain.gain.exponentialRampToValueAtTime(0.0001, now + Math.max(0.005, f));
          } catch (e) { /* noop */ }
          for (var i = 0; i < voice._srcs.length; i++) {
            try { voice._srcs[i].stop(now + Math.max(0.01, f) + 0.01); } catch (e2) { /* noop */ }
          }
          if (voice._oscs) {
            for (var k = 0; k < voice._oscs.length; k++) {
              try { voice._oscs[k].stop(now + Math.max(0.01, f) + 0.01); } catch (e3) { /* noop */ }
            }
          }
          if (voice._lfoOsc) { try { voice._lfoOsc.stop(now + Math.max(0.01, f) + 0.01); } catch (e4) { /* noop */ } }
        }
      };

      voice._oscs = [];

      var maxEnd = t0 + 0.05;
      var layers = recipe.layers || [];
      for (var li = 0; li < layers.length; li++) {
        var end = Audio._buildLayer(c, layers[li], t0, voiceGain, voice, rate, looping);
        if (end > maxEnd) maxEnd = end;
      }
      voice.endTime = looping ? Infinity : maxEnd;
      voice._effGain = effGain;

      Audio.voices.push(voice);
      return voice;
    },

    _buildLayer: function (c, L, t0, voiceGain, voice, rate, looping) {
      var delay = L.delay || 0;
      var dur = L.dur || 0.2;
      var atk = (L.atk === undefined) ? 0.002 : L.atk;
      var gain = (L.gain === undefined) ? 0.2 : L.gain;
      var start = t0 + delay;

      // --- modulador de amplitud: no es una fuente, actúa sobre voiceGain.gain
      if (L.k === 'am') {
        try {
          var lfo = c.createOscillator();
          lfo.type = L.w || 'sine';
          lfo.frequency.value = L.freq || 2;
          var lg = c.createGain();
          lg.gain.value = (L.depth || 0.5);
          lfo.connect(lg);
          lg.connect(voiceGain.gain);
          lfo.start(t0);
          voice._lfoOsc = lfo;
          voice._lfoGain = lg;
        } catch (e) { /* noop */ }
        return t0 + 4.0;
      }

      var src = null;
      if (L.k === 'noise') {
        Audio.preload();
        if (!Audio.noiseBuffer) return t0 + dur;
        src = c.createBufferSource();
        src.buffer = Audio.noiseBuffer;
        src.loop = true;
        var br = (L.rate || 1) * rate;
        src._baseRate = br;
        src.playbackRate.value = br;
        // desplazamiento aleatorio dentro del buffer para variar el grano
        try {
          var offset = Math.random() * 1.5;
          src.start(start, offset);
        } catch (e2) {
          try { src.start(start); } catch (e3) { return t0 + dur; }
        }
      } else {
        src = c.createOscillator();
        src.type = L.w || 'sine';
        src.frequency.value = Math.max(0.01, L.f0 || 440);
        if (L.detune) src.detune.value = L.detune;
        if (L.f1 !== undefined && L.f1 !== null && Math.abs(L.f1 - L.f0) > 0.001) {
          var f1 = Math.max(0.01, L.f1);
          try {
            src.frequency.exponentialRampToValueAtTime(f1, start + dur);
          } catch (e4) {
            try { src.frequency.linearRampToValueAtTime(f1, start + dur); } catch (e5) { /* noop */ }
          }
        }
        try { src.start(start); } catch (e6) { return t0 + dur; }
        voice._oscs.push(src);
      }

      var chain = src;

      if (L.filt) {
        try {
          var bq = c.createBiquadFilter();
          bq.type = L.filt;
          bq.frequency.value = Math.max(20, L.fc0 || 1000);
          bq.Q.value = (L.q === undefined) ? 1 : L.q;
          if (L.fc1 !== undefined && L.fc1 !== null) {
            try {
              bq.frequency.exponentialRampToValueAtTime(Math.max(20, L.fc1), start + dur);
            } catch (e7) { /* noop */ }
          }
          chain.connect(bq);
          chain = bq;
        } catch (e8) { /* noop */ }
      }

      var env = c.createGain();
      env.gain.value = 0.0001;
      try {
        env.gain.setValueAtTime(0.0001, start);
        env.gain.linearRampToValueAtTime(Math.max(0.0002, gain), start + Math.max(0.0005, atk));
        if (L.sus || looping) {
          // sostener: el corte lo hace Voice.stop()
        } else {
          env.gain.exponentialRampToValueAtTime(0.0001, start + Math.max(atk + 0.005, dur));
        }
      } catch (e9) { /* noop */ }
      chain.connect(env);
      env.connect(voiceGain);

      voice._srcs.push(src);
      return start + dur;
    },

    /* ==================================================================
     * Mantenimiento
     * ================================================================== */
    update: function (dt) {
      if (!Audio.voices.length) return;
      var now = Audio.ctx ? Audio.ctx.currentTime : 0;
      for (var i = Audio.voices.length - 1; i >= 0; i--) {
        var v = Audio.voices[i];
        var alive = false;
        if (!v._stopped) {
          alive = v.loop ? true : (now < v.endTime + 0.05);
          // actualización espacial de voces en movimiento
          if (alive && v.spatial && v.pos) {
            var s = Audio._spatial(v.pos);
            if (Math.abs(s.gain - v.spatial_info.gain) > 0.02 || Math.abs(s.pan - v.spatial_info.pan) > 0.05) {
              v.spatial_info = s;
              v._effGain = v.baseGain * s.gain;
              try {
                v._gain.gain.setTargetAtTime(v._effGain, now, 0.05);
                if (v._panner) v._panner.pan.setTargetAtTime(s.pan, now, 0.05);
              } catch (e) { /* noop */ }
            }
          }
        }
        if (!alive) {
          try { if (v._panner) v._panner.disconnect(); } catch (e1) { /* noop */ }
          try { v._gain.disconnect(); } catch (e2) { /* noop */ }
          Audio.voices.splice(i, 1);
        }
      }
    },

    stopAll: function (fadeTime) {
      var f = (fadeTime === undefined) ? 0.08 : fadeTime;
      for (var i = Audio.voices.length - 1; i >= 0; i--) {
        try { Audio.voices[i].stop(f); } catch (e) { /* noop */ }
      }
    },

    stopTag: function (tag) {
      for (var i = Audio.voices.length - 1; i >= 0; i--) {
        var v = Audio.voices[i];
        if (v.tag === tag || v.name === tag) {
          try { v.stop(0.06); } catch (e) { /* noop */ }
        }
      }
    },

    /** Reinicia todo (cambio de misión / checkpoint). */
    reset: function () {
      Audio.stopAll(0.02);
      Audio.voices.length = 0;
    },

    /** Firma identificable de una receta (para depuración y tests). */
    signature: function (name) {
      var r = RECIPES[name];
      if (!r) return null;
      var parts = [r.bus, (r.layers || []).length];
      for (var i = 0; i < r.layers.length; i++) {
        var L = r.layers[i];
        parts.push([L.k, L.w || '', L.f0 || 0, L.f1 || 0, L.freq || 0, L.dur || 0, L.gain || 0,
          L.filt || '', L.fc0 || 0, L.fc1 || 0, L.rate || 0].join(':'));
      }
      return parts.join('|');
    },

    diagnostics: function () {
      return {
        hasContext: !!Audio.ctx,
        state: Audio.ctx ? Audio.ctx.state : 'none',
        ready: Audio.ready,
        voices: Audio.voices.length,
        budget: Audio.voiceBudget,
        noiseBufferSeconds: Audio.noiseBuffer ? Audio.noiseBuffer.duration : 0,
        master: Audio.masterVolume, sfx: Audio.sfxVolume, music: Audio.musicVolume,
        muted: Audio.muted,
        lastError: Audio.lastPlayError
      };
    }
  };

  BS.Audio = Audio;

  /* ======================================================================
   * Test: catálogo completo (39 nombres), recetas válidas y distintas
   * ==================================================================== */
  if (BS.Debug && typeof BS.Debug.register === 'function') {
    BS.Debug.register('audio:catalog', function () {
      var missing = [];
      var invalid = [];
      var sigs = {};
      var dup = [];
      for (var i = 0; i < NAMES.length; i++) {
        var n = NAMES[i];
        var r = RECIPES[n];
        if (!r) { missing.push(n); continue; }
        if (!r.layers || !r.layers.length) { invalid.push(n + ' (sin capas)'); continue; }
        for (var k = 0; k < r.layers.length; k++) {
          var L = r.layers[k];
          if (L.k !== 'osc' && L.k !== 'noise' && L.k !== 'am') { invalid.push(n + ' capa ' + k + ' tipo ' + L.k); continue; }
          if (L.k === 'osc' && !(L.f0 > 0)) invalid.push(n + ' capa ' + k + ' sin f0');
          if (L.k === 'noise' && !(L.rate > 0)) invalid.push(n + ' capa ' + k + ' sin rate');
          if (L.k === 'am' && !(L.freq > 0)) invalid.push(n + ' capa ' + k + ' sin freq');
          /* Las capas 'am' son moduladores de amplitud: solo llevan w/freq/depth
           * (_buildLayer las trata aparte) y NO usan dur ni gain. Exigir
           * dur/gain solo a osc/noise, igual que f0/rate/freq se exigen por tipo. */
          if (L.k !== 'am' && !(L.dur > 0)) invalid.push(n + ' capa ' + k + ' sin dur');
          if (L.k !== 'am' && !(L.gain > 0)) invalid.push(n + ' capa ' + k + ' sin gain');
        }
        var sig = Audio.signature(n);
        if (sigs[sig]) dup.push(n + '==' + sigs[sig]);
        sigs[sig] = n;
      }
      var namesUnique = true;
      for (var a = 0; a < NAMES.length; a++) {
        for (var b = a + 1; b < NAMES.length; b++) if (NAMES[a] === NAMES[b]) namesUnique = false;
      }
      return {
        ok: missing.length === 0 && invalid.length === 0 && dup.length === 0 && namesUnique,
        count: NAMES.length,
        recipes: Object.keys(RECIPES).length,
        missing: missing,
        invalid: invalid,
        duplicados: dup,
        unicos: namesUnique,
        context: Audio.ctx ? Audio.ctx.state : 'sin contexto (no creado aún)'
      };
    });
  }

})(window.BS = window.BS || {});
