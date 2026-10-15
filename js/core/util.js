/* ===========================================================================
 * BLACKSITE: LAST SIGNAL  —  js/core/util.js
 * ---------------------------------------------------------------------------
 * Propósito : utilidades base de todo el motor: registro (BS.Log), utilidades
 *             generales + DOM (BS.Util), bus de eventos (BS.Events), generador
 *             pseudoaleatorio determinista (BS.RNG) y matemáticas completas
 *             (BS.Math: vectores v3, matrices m4 column-major, AABB,
 *             intersecciones rayo/AABB, barrido AABB-AABB y conos).
 * Depende de: nada. Es la base del LOTE A y de todo el proyecto.
 * Expone    : BS.Log, BS.Util, BS.Events, BS.RNG, BS.Math
 * =========================================================================== */
(function (BS) {
  'use strict';

  var AP = Array.prototype;
  var OP = Object.prototype;
  var hasOwn = OP.hasOwnProperty;

  function toArray(args) {
    return AP.slice.call(args);
  }

  /* ======================================================================
   * BS.Log
   * ==================================================================== */
  var con = (typeof console !== 'undefined' && console) ? console : null;

  var Log = {
    level: 2, // 0=silent 1=error 2=warn 3=info 4=debug
    setLevel: function (n) {
      Log.level = (n | 0);
      return Log.level;
    },
    error: function () {
      if (Log.level >= 1) {
        var a = toArray(arguments);
        if (con && con.error) con.error.apply(con, ['[BS:error]'].concat(a));
      }
    },
    warn: function () {
      if (Log.level >= 2) {
        var a = toArray(arguments);
        if (con && con.warn) con.warn.apply(con, ['[BS:warn]'].concat(a));
      }
    },
    info: function () {
      if (Log.level >= 3) {
        var a = toArray(arguments);
        if (con && con.info) con.info.apply(con, ['[BS:info]'].concat(a));
      }
    },
    debug: function () {
      if (Log.level >= 4) {
        var a = toArray(arguments);
        if (con && con.log) con.log.apply(con, ['[BS:debug]'].concat(a));
      }
    }
  };
  BS.Log = Log;

  /* ======================================================================
   * BS.RNG  —  xorshift32 determinista
   * ==================================================================== */
  var RNG = {
    /**
     * Devuelve una función () => [0,1) reproducible a partir de la semilla.
     */
    create: function (seed) {
      var s = (seed | 0) >>> 0;
      if (s === 0) s = 0x9E3779B9; // xorshift no admite semilla 0
      return function () {
        s ^= (s << 13); s >>>= 0;
        s ^= (s >>> 17);
        s ^= (s << 5); s >>>= 0;
        return s / 4294967296;
      };
    },

    /** Hash entero -> [0,1). */
    hash1: function (n) {
      var x = (n | 0) >>> 0;
      x = ((x >>> 16) ^ x) * 0x45d9f3b;
      x = ((x >>> 16) ^ x) * 0x45d9f3b;
      x = (x >>> 16) ^ x;
      return (x >>> 0) / 4294967296;
    },

    /** Hash 2D -> [0,1). */
    hash2: function (x, y) {
      var h = ((x | 0) * 0x27d4eb2d) ^ ((y | 0) * 0x165667b1);
      return RNG.hash1(h);
    },

    /** Hash de cadena -> entero sin signo (para semillas por nombre). */
    hashString: function (str) {
      var h = 0x811C9DC5;
      for (var i = 0; i < str.length; i++) {
        h = (h ^ str.charCodeAt(i)) >>> 0;
        h = (h * 16777619) >>> 0;
      }
      return h >>> 0;
    }
  };
  BS.RNG = RNG;

  /* ======================================================================
   * BS.Events  —  bus global sencillo
   * ==================================================================== */
  var nextSubId = 1;
  var channels = {};

  var Events = {
    on: function (name, cb, tag) {
      if (typeof name !== 'string' || typeof cb !== 'function') return -1;
      var id = nextSubId++;
      if (!hasOwn.call(channels, name)) channels[name] = [];
      channels[name].push({ id: id, cb: cb, tag: tag || null });
      return id;
    },
    off: function (name, id) {
      var list = channels[name];
      if (!list) return;
      for (var i = 0; i < list.length; i++) {
        if (list[i].id === id) { list.splice(i, 1); return; }
      }
    },
    offTag: function (tag) {
      for (var k in channels) {
        if (!hasOwn.call(channels, k)) continue;
        var l = channels[k];
        for (var i = l.length - 1; i >= 0; i--) if (l[i].tag === tag) l.splice(i, 1);
      }
    },
    emit: function (name, payload) {
      var list = channels[name];
      if (!list || list.length === 0) return;
      var copy = list.slice();
      for (var i = 0; i < copy.length; i++) {
        try {
          copy[i].cb(payload, name);
        } catch (e) {
          Log.error('BS.Events: fallo en el handler de "' + name + '"', e && e.message ? e.message : e);
        }
      }
    },
    clear: function () {
      channels = {};
    },
    count: function () {
      var n = 0;
      for (var k in channels) if (hasOwn.call(channels, k)) n += channels[k].length;
      return n;
    }
  };
  BS.Events = Events;

  /* ======================================================================
   * BS.Util
   * ==================================================================== */
  var perf = (typeof performance !== 'undefined' && performance &&
    typeof performance.now === 'function') ? performance : null;

  var memoryStore = {};
  var SETTINGS_KEY = 'bs_settings';
  var _dom = null;

  function settingsDefaults() {
    return {
      sensitivity: 0.0022,
      invertY: false,
      volumeMaster: 0.8,
      volumeSfx: 0.9,
      volumeMusic: 0.5,
      fov: 78,
      resolutionScale: 1.0,
      quality: 'auto',            // 'auto'|'low'|'medium'|'high'
      postFx: true,
      showFps: false,
      crosshair: 'dynamic',       // 'dynamic'|'fixed'
      bloodFx: true,
      screenShake: 1.0,
      difficulty: 'normal',       // 'normal'|'hard'
      fpsCap: 0                   // 0 = sin límite (lo usa BS.Debug.setFpsCap)
    };
  }

  function coerceLike(value, def) {
    if (typeof def === 'number') {
      var n = Number(value);
      if (!isFinite(n)) return def;
      return n;
    }
    if (typeof def === 'boolean') return !!value;
    if (typeof def === 'string') return String(value);
    return value;
  }

  function clampNumber(v, lo, hi) {
    v = Number(v);
    if (!isFinite(v)) return lo;
    if (v < lo) return lo;
    if (v > hi) return hi;
    return v;
  }

  var Util = {
    now: function () {
      return perf ? perf.now() * 0.001 : Date.now() * 0.001;
    },

    /** Milisegundos de reloj monótono (para medir fases de construcción). */
    nowMs: function () {
      return perf ? perf.now() : Date.now();
    },

    makeCanvas: function (w, h) {
      var c = document.createElement('canvas');
      c.width = Math.max(1, w | 0);
      c.height = Math.max(1, h | 0);
      return c;
    },

    addListener: function (target, type, fn, opts) {
      if (!target || typeof target.addEventListener !== 'function') return null;
      try {
        target.addEventListener(type, fn, opts);
      } catch (e) {
        try { target.addEventListener(type, fn, false); } catch (e2) { return null; }
      }
      return function () {
        try { target.removeEventListener(type, fn, opts); } catch (e3) { /* noop */ }
      };
    },

    clampInt: function (v, min, max) {
      v = v | 0;
      if (v < min) return min;
      if (v > max) return max;
      return v;
    },

    padNumber: function (n, digits) {
      digits = digits | 0;
      var s = String(Math.abs(Math.round(n)));
      while (s.length < digits) s = '0' + s;
      return (n < 0 ? '-' : '') + s;
    },

    /** Segundos -> "MM:SS". */
    formatTime: function (seconds) {
      var s = Number(seconds);
      if (!isFinite(s) || s < 0) s = 0;
      var total = Math.floor(s);
      var m = Math.floor(total / 60);
      var sec = total % 60;
      return Util.padNumber(m, 2) + ':' + Util.padNumber(sec, 2);
    },

    /** Crea (si faltan) #bs-root, canvas 3D, canvas HUD y capa UI. */
    ensureDOM: function () {
      if (_dom && _dom.root && _dom.root.isConnected) return _dom;
      var root = document.getElementById('bs-root');
      if (!root) {
        root = document.createElement('div');
        root.id = 'bs-root';
        (document.body || document.documentElement).appendChild(root);
      }

      var c3d = document.getElementById('bs-canvas3d');
      if (!c3d) {
        c3d = document.createElement('canvas');
        c3d.id = 'bs-canvas3d';
        root.appendChild(c3d);
      }
      c3d.style.position = 'absolute';
      c3d.style.left = '0';
      c3d.style.top = '0';
      c3d.style.width = '100%';
      c3d.style.height = '100%';
      c3d.style.display = 'block';
      c3d.style.touchAction = 'none';
      c3d.style.outline = 'none';

      var hud = document.getElementById('bs-hud');
      if (!hud) {
        hud = document.createElement('canvas');
        hud.id = 'bs-hud';
        root.appendChild(hud);
      }
      hud.style.position = 'absolute';
      hud.style.left = '0';
      hud.style.top = '0';
      hud.style.width = '100%';
      hud.style.height = '100%';
      hud.style.display = 'block';
      hud.style.pointerEvents = 'none';

      var ui = document.getElementById('bs-ui');
      if (!ui) {
        ui = document.createElement('div');
        ui.id = 'bs-ui';
        root.appendChild(ui);
      }
      ui.style.position = 'absolute';
      ui.style.left = '0';
      ui.style.top = '0';
      ui.style.width = '100%';
      ui.style.height = '100%';

      if (!root.style.position || root.style.position === 'static') root.style.position = 'fixed';
      if (!root.style.overflow) root.style.overflow = 'hidden';

      _dom = { root: root, canvas3d: c3d, hudCanvas: hud, uiLayer: ui };
      return _dom;
    },

    getDOM: function () {
      return _dom || Util.ensureDOM();
    },

    tryLocalStorageGet: function (key, fallback) {
      try {
        if (typeof localStorage !== 'undefined' && localStorage) {
          var raw = localStorage.getItem(key);
          if (raw === null || raw === undefined) return fallback;
          return JSON.parse(raw);
        }
      } catch (e) {
        Log.debug('localStorage.get bloqueado para "' + key + '"');
      }
      return hasOwn.call(memoryStore, key) ? memoryStore[key] : fallback;
    },

    tryLocalStorageSet: function (key, value) {
      var ok = false;
      try {
        if (typeof localStorage !== 'undefined' && localStorage) {
          localStorage.setItem(key, JSON.stringify(value));
          ok = true;
        }
      } catch (e) {
        Log.debug('localStorage.set bloqueado para "' + key + '"');
      }
      // espejo en memoria: siempre disponible (file:// y contextos opacos)
      try { memoryStore[key] = JSON.parse(JSON.stringify(value)); } catch (e2) { memoryStore[key] = value; }
      return ok;
    },

    loadSettings: function () {
      var def = settingsDefaults();
      var raw = null;
      try { raw = Util.tryLocalStorageGet(SETTINGS_KEY, null); } catch (e) { raw = null; }
      if (raw && typeof raw === 'object') {
        for (var k in def) {
          if (!hasOwn.call(def, k)) continue;
          if (!hasOwn.call(raw, k)) continue;
          var v = raw[k];
          if (v === undefined || v === null) continue;
          def[k] = coerceLike(v, def[k]);
        }
      }
      // cordura de rangos
      def.sensitivity = clampNumber(def.sensitivity, 0.0002, 0.02);
      def.fov = clampNumber(def.fov, 55, 110);
      def.resolutionScale = clampNumber(def.resolutionScale, 0.5, 1.0);
      def.volumeMaster = clampNumber(def.volumeMaster, 0, 1);
      def.volumeSfx = clampNumber(def.volumeSfx, 0, 1);
      def.volumeMusic = clampNumber(def.volumeMusic, 0, 1);
      def.screenShake = clampNumber(def.screenShake, 0, 2);
      def.fpsCap = clampNumber(def.fpsCap, 0, 240);
      if (def.quality !== 'auto' && def.quality !== 'low' &&
        def.quality !== 'medium' && def.quality !== 'high') def.quality = 'auto';
      if (def.difficulty !== 'normal' && def.difficulty !== 'hard') def.difficulty = 'normal';
      if (def.crosshair !== 'dynamic' && def.crosshair !== 'fixed') def.crosshair = 'dynamic';
      return def;
    },

    settingsDefaults: settingsDefaults,

    saveSettings: function (s) {
      if (!s) return;
      Util.tryLocalStorageSet(SETTINGS_KEY, s);
    },

    debounce: function (fn, ms) {
      var timer = null;
      ms = ms || 100;
      return function () {
        var args = toArray(arguments), self = this;
        if (timer !== null) clearTimeout(timer);
        timer = setTimeout(function () {
          timer = null;
          fn.apply(self, args);
        }, ms);
      };
    },

    isPowerOfTwo: function (v) {
      v = v | 0;
      return v > 0 && (v & (v - 1)) === 0;
    },

    nextPowerOfTwo: function (v) {
      var x = 1;
      v = v | 0;
      while (x < v) x <<= 1;
      return x;
    },

    /** Cuenta de elementos de un objeto plano (para los tests). */
    countKeys: function (o) {
      var n = 0;
      if (!o) return 0;
      for (var k in o) if (hasOwn.call(o, k)) n++;
      return n;
    }
  };
  BS.Util = Util;

  /* ======================================================================
   * BS.Math  —  vectores, matrices, AABB e intersecciones
   * ==================================================================== */
  var M = {
    PI: Math.PI,
    DEG: Math.PI / 180,   // multiplicar grados por DEG -> radianes
    RAD: 180 / Math.PI,   // multiplicar radianes por RAD -> grados
    EPS: 1e-6
  };

  /* ---------------------------- escalares ---------------------------- */
  M.clamp = function (v, min, max) {
    return v < min ? min : (v > max ? max : v);
  };
  M.clamp01 = function (v) {
    return v < 0 ? 0 : (v > 1 ? 1 : v);
  };
  M.lerp = function (a, b, t) { return a + (b - a) * t; };
  M.damp = function (current, target, lambda, dt) {
    return target + (current - target) * Math.exp(-lambda * dt);
  };
  M.smoothstep = function (e0, e1, x) {
    if (e1 === e0) return x < e0 ? 0 : 1;
    var t = (x - e0) / (e1 - e0);
    t = t < 0 ? 0 : (t > 1 ? 1 : t);
    return t * t * (3 - 2 * t);
  };
  M.sign = function (v) { return v > 0 ? 1 : (v < 0 ? -1 : 0); };
  M.randRange = function (a, b) { return a + Math.random() * (b - a); };
  M.randInt = function (a, b) { return a + Math.floor(Math.random() * (b - a + 1)); };

  var gaussSpare = null;
  M.gaussian = function () {
    if (gaussSpare !== null) {
      var s = gaussSpare;
      gaussSpare = null;
      return s;
    }
    var u = 0, v = 0, r = 0;
    do {
      u = Math.random() * 2 - 1;
      v = Math.random() * 2 - 1;
      r = u * u + v * v;
    } while (r >= 1 || r === 0);
    var f = Math.sqrt(-2 * Math.log(r) / r);
    gaussSpare = v * f;
    return u * f;
  };

  /* ---------------------------- vectores v3 ---------------------------- */
  M.v3 = function (x, y, z) {
    return new Float32Array([x || 0, y || 0, z || 0]);
  };
  M.v3set = function (o, x, y, z) { o[0] = x; o[1] = y; o[2] = z; return o; };
  M.v3copy = function (o, a) { o[0] = a[0]; o[1] = a[1]; o[2] = a[2]; return o; };
  M.v3add = function (o, a, b) { o[0] = a[0] + b[0]; o[1] = a[1] + b[1]; o[2] = a[2] + b[2]; return o; };
  M.v3sub = function (o, a, b) { o[0] = a[0] - b[0]; o[1] = a[1] - b[1]; o[2] = a[2] - b[2]; return o; };
  M.v3mul = function (o, a, b) { o[0] = a[0] * b[0]; o[1] = a[1] * b[1]; o[2] = a[2] * b[2]; return o; };
  M.v3scale = function (o, a, s) { o[0] = a[0] * s; o[1] = a[1] * s; o[2] = a[2] * s; return o; };
  M.v3addScaled = function (o, a, b, s) {
    o[0] = a[0] + b[0] * s; o[1] = a[1] + b[1] * s; o[2] = a[2] + b[2] * s; return o;
  };
  M.v3dot = function (a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; };
  M.v3cross = function (o, a, b) {
    var ax = a[0], ay = a[1], az = a[2];
    var bx = b[0], by = b[1], bz = b[2];
    o[0] = ay * bz - az * by;
    o[1] = az * bx - ax * bz;
    o[2] = ax * by - ay * bx;
    return o;
  };
  M.v3lenSq = function (a) { return a[0] * a[0] + a[1] * a[1] + a[2] * a[2]; };
  M.v3len = function (a) { return Math.sqrt(M.v3lenSq(a)); };
  M.v3dist = function (a, b) {
    var dx = a[0] - b[0], dy = a[1] - b[1], dz = a[2] - b[2];
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  };
  M.v3distSq = function (a, b) {
    var dx = a[0] - b[0], dy = a[1] - b[1], dz = a[2] - b[2];
    return dx * dx + dy * dy + dz * dz;
  };
  M.v3norm = function (o, a) {
    var l = M.v3len(a);
    if (l < 1e-9) { o[0] = 0; o[1] = 0; o[2] = 0; return o; }
    var inv = 1 / l;
    o[0] = a[0] * inv; o[1] = a[1] * inv; o[2] = a[2] * inv;
    return o;
  };
  M.v3negate = function (o, a) { o[0] = -a[0]; o[1] = -a[1]; o[2] = -a[2]; return o; };
  M.v3lerp = function (o, a, b, t) {
    o[0] = a[0] + (b[0] - a[0]) * t;
    o[1] = a[1] + (b[1] - a[1]) * t;
    o[2] = a[2] + (b[2] - a[2]) * t;
    return o;
  };
  M.v3min = function (o, a, b) {
    o[0] = a[0] < b[0] ? a[0] : b[0];
    o[1] = a[1] < b[1] ? a[1] : b[1];
    o[2] = a[2] < b[2] ? a[2] : b[2];
    return o;
  };
  M.v3max = function (o, a, b) {
    o[0] = a[0] > b[0] ? a[0] : b[0];
    o[1] = a[1] > b[1] ? a[1] : b[1];
    o[2] = a[2] > b[2] ? a[2] : b[2];
    return o;
  };

  /** Dirección de mirada: (0,0,-1) rotado por yaw (Y) y pitch (X). */
  M.v3fromYawPitch = function (o, yaw, pitch) {
    var cy = Math.cos(yaw), sy = Math.sin(yaw);
    var cp = Math.cos(pitch), sp = Math.sin(pitch);
    o[0] = -sy * cp;
    o[1] = sp;
    o[2] = -cy * cp;
    return o;
  };

  /** Dirección horizontal de un yaw. */
  M.v3yawToDir = function (o, yaw) {
    o[0] = -Math.sin(yaw);
    o[1] = 0;
    o[2] = -Math.cos(yaw);
    return o;
  };

  /* ---------------------------- matrices m4 ---------------------------- */
  M.m4 = function () { return new Float32Array(16); };

  M.m4identity = function (o) {
    o[0] = 1; o[1] = 0; o[2] = 0; o[3] = 0;
    o[4] = 0; o[5] = 1; o[6] = 0; o[7] = 0;
    o[8] = 0; o[9] = 0; o[10] = 1; o[11] = 0;
    o[12] = 0; o[13] = 0; o[14] = 0; o[15] = 1;
    return o;
  };

  M.m4copy = function (o, a) {
    for (var i = 0; i < 16; i++) o[i] = a[i];
    return o;
  };

  /** out = a * b  (convención column-major, como gl-matrix). */
  M.m4multiply = function (out, a, b) {
    var a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
    var a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
    var a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
    var a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
    var b0 = b[0], b1 = b[1], b2 = b[2], b3 = b[3];
    out[0] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
    out[1] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
    out[2] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
    out[3] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
    b0 = b[4]; b1 = b[5]; b2 = b[6]; b3 = b[7];
    out[4] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
    out[5] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
    out[6] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
    out[7] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
    b0 = b[8]; b1 = b[9]; b2 = b[10]; b3 = b[11];
    out[8] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
    out[9] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
    out[10] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
    out[11] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
    b0 = b[12]; b1 = b[13]; b2 = b[14]; b3 = b[15];
    out[12] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
    out[13] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
    out[14] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
    out[15] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
    return out;
  };

  M.m4perspective = function (out, fovyRad, aspect, near, far) {
    var f = 1 / Math.tan(fovyRad * 0.5);
    var nf = 1 / (near - far);
    out[0] = f / aspect; out[1] = 0; out[2] = 0; out[3] = 0;
    out[4] = 0; out[5] = f; out[6] = 0; out[7] = 0;
    out[8] = 0; out[9] = 0; out[10] = (far + near) * nf; out[11] = -1;
    out[12] = 0; out[13] = 0; out[14] = 2 * far * near * nf; out[15] = 0;
    return out;
  };

  M.m4ortho = function (out, l, r, b, t, n, f) {
    var lr = 1 / (l - r), bt = 1 / (b - t), nf = 1 / (n - f);
    out[0] = -2 * lr; out[1] = 0; out[2] = 0; out[3] = 0;
    out[4] = 0; out[5] = -2 * bt; out[6] = 0; out[7] = 0;
    out[8] = 0; out[9] = 0; out[10] = 2 * nf; out[11] = 0;
    out[12] = (l + r) * lr; out[13] = (t + b) * bt; out[14] = (f + n) * nf; out[15] = 1;
    return out;
  };

  M.m4lookAt = function (out, eye, center, up) {
    var z0 = eye[0] - center[0], z1 = eye[1] - center[1], z2 = eye[2] - center[2];
    var len = Math.sqrt(z0 * z0 + z1 * z1 + z2 * z2);
    if (len < 1e-9) return M.m4identity(out);
    z0 /= len; z1 /= len; z2 /= len;

    var x0 = up[1] * z2 - up[2] * z1;
    var x1 = up[2] * z0 - up[0] * z2;
    var x2 = up[0] * z1 - up[1] * z0;
    len = Math.sqrt(x0 * x0 + x1 * x1 + x2 * x2);
    if (len < 1e-9) { x0 = 0; x1 = 0; x2 = 0; }
    else { x0 /= len; x1 /= len; x2 /= len; }

    var y0 = z1 * x2 - z2 * x1;
    var y1 = z2 * x0 - z0 * x2;
    var y2 = z0 * x1 - z1 * x0;

    out[0] = x0; out[1] = y0; out[2] = z0; out[3] = 0;
    out[4] = x1; out[5] = y1; out[6] = z1; out[7] = 0;
    out[8] = x2; out[9] = y2; out[10] = z2; out[11] = 0;
    out[12] = -(x0 * eye[0] + x1 * eye[1] + x2 * eye[2]);
    out[13] = -(y0 * eye[0] + y1 * eye[1] + y2 * eye[2]);
    out[14] = -(z0 * eye[0] + z1 * eye[1] + z2 * eye[2]);
    out[15] = 1;
    return out;
  };

  /** Matriz de vista de una cámara FPS (yaw en Y, pitch en X). */
  M.m4fromYawPitchPos = function (out, yaw, pitch, pos) {
    var cy = Math.cos(yaw), sy = Math.sin(yaw);
    var cp = Math.cos(pitch), sp = Math.sin(pitch);

    // base de la cámara en espacio de mundo
    var fx = -sy * cp, fy = sp, fz = -cy * cp;          // forward
    var rx = cy, ry = 0, rz = -sy;                      // right
    var ux = sy * sp, uy = cp, uz = cy * sp;            // up = cross(right, forward)

    var px = pos[0], py = pos[1], pz = pos[2];

    out[0] = rx; out[1] = ux; out[2] = -fx; out[3] = 0;
    out[4] = ry; out[5] = uy; out[6] = -fy; out[7] = 0;
    out[8] = rz; out[9] = uz; out[10] = -fz; out[11] = 0;
    out[12] = -(rx * px + ry * py + rz * pz);
    out[13] = -(ux * px + uy * py + uz * pz);
    out[14] = (fx * px + fy * py + fz * pz);
    out[15] = 1;
    return out;
  };

  M.m4invert = function (out, a) {
    var a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
    var a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
    var a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
    var a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];

    var b00 = a00 * a11 - a01 * a10;
    var b01 = a00 * a12 - a02 * a10;
    var b02 = a00 * a13 - a03 * a10;
    var b03 = a01 * a12 - a02 * a11;
    var b04 = a01 * a13 - a03 * a11;
    var b05 = a02 * a13 - a03 * a12;
    var b06 = a20 * a31 - a21 * a30;
    var b07 = a20 * a32 - a22 * a30;
    var b08 = a20 * a33 - a23 * a30;
    var b09 = a21 * a32 - a22 * a31;
    var b10 = a21 * a33 - a23 * a31;
    var b11 = a22 * a33 - a23 * a32;

    var det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
    if (Math.abs(det) < 1e-12) return M.m4identity(out);
    det = 1.0 / det;

    out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
    out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
    out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
    out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
    out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
    out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
    out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
    out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
    out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
    out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
    out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
    out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
    out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
    out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
    out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
    out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
    return out;
  };

  M.m4transpose = function (out, a) {
    if (out === a) {
      var a01 = a[1], a02 = a[2], a03 = a[3], a12 = a[6], a13 = a[7], a23 = a[11];
      out[1] = a[4]; out[2] = a[8]; out[3] = a[12];
      out[4] = a01; out[6] = a[9]; out[7] = a[13];
      out[8] = a02; out[9] = a12; out[11] = a[14];
      out[12] = a03; out[13] = a13; out[14] = a23;
      return out;
    }
    for (var i = 0; i < 4; i++) {
      for (var j = 0; j < 4; j++) out[i * 4 + j] = a[j * 4 + i];
    }
    return out;
  };

  /** Modelo con escala uniforme (sin rotación). */
  M.m4fromPosYawScale = function (out, pos, yaw, scale) {
    return M.m4fromTRS(out, pos, yaw, 0, 0, scale);
  };

  /** out = T(pos) * Ry(yaw) * Rx(pitch) * Rz(roll) * S(scale). */
  M.m4fromTRS = function (out, pos, yaw, pitch, roll, scale) {
    scale = (scale === undefined || scale === null) ? 1 : scale;
    pitch = pitch || 0;
    roll = roll || 0;
    var cy = Math.cos(yaw), sy = Math.sin(yaw);
    var cp = Math.cos(pitch), sp = Math.sin(pitch);
    var cr = Math.cos(roll), sr = Math.sin(roll);

    var r00 = cy * cr + sy * sp * sr;
    var r01 = -cy * sr + sy * sp * cr;
    var r02 = sy * cp;
    var r10 = cp * sr;
    var r11 = cp * cr;
    var r12 = -sp;
    var r20 = -sy * cr + cy * sp * sr;
    var r21 = sy * sr + cy * sp * cr;
    var r22 = cy * cp;
    var s = scale;

    out[0] = r00 * s; out[1] = r10 * s; out[2] = r20 * s; out[3] = 0;
    out[4] = r01 * s; out[5] = r11 * s; out[6] = r21 * s; out[7] = 0;
    out[8] = r02 * s; out[9] = r12 * s; out[10] = r22 * s; out[11] = 0;
    out[12] = pos[0]; out[13] = pos[1]; out[14] = pos[2]; out[15] = 1;
    return out;
  };

  M.m4transformPoint = function (out, m, v) {
    var x = v[0], y = v[1], z = v[2];
    var w = m[3] * x + m[7] * y + m[11] * z + m[15];
    if (Math.abs(w) < 1e-12) w = 1;
    var iw = 1 / w;
    out[0] = (m[0] * x + m[4] * y + m[8] * z + m[12]) * iw;
    out[1] = (m[1] * x + m[5] * y + m[9] * z + m[13]) * iw;
    out[2] = (m[2] * x + m[6] * y + m[10] * z + m[14]) * iw;
    return out;
  };

  M.m4transformDir = function (out, m, v) {
    var x = v[0], y = v[1], z = v[2];
    out[0] = m[0] * x + m[4] * y + m[8] * z;
    out[1] = m[1] * x + m[5] * y + m[9] * z;
    out[2] = m[2] * x + m[6] * y + m[10] * z;
    return out;
  };

  /** Base 3x3 para normales a partir de la parte superior de una m4. */
  M.m4normalBasis = function (out9, m) {
    var out = out9 || new Float32Array(9);
    var c0 = Math.sqrt(m[0] * m[0] + m[1] * m[1] + m[2] * m[2]) || 1;
    var c1 = Math.sqrt(m[4] * m[4] + m[5] * m[5] + m[6] * m[6]) || 1;
    var c2 = Math.sqrt(m[8] * m[8] + m[9] * m[9] + m[10] * m[10]) || 1;
    out[0] = m[0] / c0; out[1] = m[1] / c0; out[2] = m[2] / c0;
    out[3] = m[4] / c1; out[4] = m[5] / c1; out[5] = m[6] / c1;
    out[6] = m[8] / c2; out[7] = m[9] / c2; out[8] = m[10] / c2;
    return out;
  };

  /** Rayo desde un punto NDC (-1..1) de una cámara FPS. */
  M.cameraRayFromNDC = function (outOrigin, outDir, ndcX, ndcY, pos, yaw, pitch, fovyRad, aspect) {
    var tanHalf = Math.tan(fovyRad * 0.5);
    var cx = ndcX * tanHalf * aspect;
    var cy = ndcY * tanHalf;
    var cz = -1;

    // R = Ry(yaw) * Rx(pitch) aplicado a (cx, cy, cz)
    var cp = Math.cos(pitch), sp = Math.sin(pitch);
    var x1 = cx;
    var y1 = cp * cy - sp * cz;
    var z1 = sp * cy + cp * cz;
    var cyy = Math.cos(yaw), syy = Math.sin(yaw);
    var x2 = cyy * x1 + syy * z1;
    var y2 = y1;
    var z2 = -syy * x1 + cyy * z1;

    var inv = 1 / (Math.sqrt(x2 * x2 + y2 * y2 + z2 * z2) || 1);
    if (outOrigin) { outOrigin[0] = pos[0]; outOrigin[1] = pos[1]; outOrigin[2] = pos[2]; }
    outDir[0] = x2 * inv; outDir[1] = y2 * inv; outDir[2] = z2 * inv;
    return outDir;
  };

  /* ---------------------------- AABB ---------------------------- */
  M.aabb = function (min, max) {
    return {
      min: new Float32Array([min ? min[0] : 0, min ? min[1] : 0, min ? min[2] : 0]),
      max: new Float32Array([max ? max[0] : 0, max ? max[1] : 0, max ? max[2] : 0])
    };
  };

  M.aabbFromCenterSize = function (c, s) {
    var hx = (s[0] || 0) * 0.5, hy = (s[1] || 0) * 0.5, hz = (s[2] || 0) * 0.5;
    return {
      min: new Float32Array([c[0] - hx, c[1] - hy, c[2] - hz]),
      max: new Float32Array([c[0] + hx, c[1] + hy, c[2] + hz])
    };
  };

  M.aabbFromPoints = function (points) {
    var min = new Float32Array([Infinity, Infinity, Infinity]);
    var max = new Float32Array([-Infinity, -Infinity, -Infinity]);
    if (points && points.length) {
      for (var i = 0; i < points.length; i++) {
        var p = points[i];
        if (!p || p.length < 3) continue;
        if (p[0] < min[0]) min[0] = p[0];
        if (p[1] < min[1]) min[1] = p[1];
        if (p[2] < min[2]) min[2] = p[2];
        if (p[0] > max[0]) max[0] = p[0];
        if (p[1] > max[1]) max[1] = p[1];
        if (p[2] > max[2]) max[2] = p[2];
      }
    }
    if (!isFinite(min[0])) { min[0] = min[1] = min[2] = 0; max[0] = max[1] = max[2] = 0; }
    return { min: min, max: max };
  };

  M.aabbUnion = function (out, a, b) {
    out.min[0] = Math.min(a.min[0], b.min[0]);
    out.min[1] = Math.min(a.min[1], b.min[1]);
    out.min[2] = Math.min(a.min[2], b.min[2]);
    out.max[0] = Math.max(a.max[0], b.max[0]);
    out.max[1] = Math.max(a.max[1], b.max[1]);
    out.max[2] = Math.max(a.max[2], b.max[2]);
    return out;
  };

  M.aabbExpand = function (out, a, amount) {
    out.min[0] = a.min[0] - amount;
    out.min[1] = a.min[1] - amount;
    out.min[2] = a.min[2] - amount;
    out.max[0] = a.max[0] + amount;
    out.max[1] = a.max[1] + amount;
    out.max[2] = a.max[2] + amount;
    return out;
  };

  M.aabbContainsPoint = function (a, p) {
    return p[0] >= a.min[0] && p[0] <= a.max[0] &&
      p[1] >= a.min[1] && p[1] <= a.max[1] &&
      p[2] >= a.min[2] && p[2] <= a.max[2];
  };

  M.aabbIntersects = function (a, b) {
    return a.min[0] <= b.max[0] && a.max[0] >= b.min[0] &&
      a.min[1] <= b.max[1] && a.max[1] >= b.min[1] &&
      a.min[2] <= b.max[2] && a.max[2] >= b.min[2];
  };

  M.aabbIntersectsAABB = function (a, b, eps) {
    var e = eps || 0;
    return a.min[0] - e <= b.max[0] && a.max[0] + e >= b.min[0] &&
      a.min[1] - e <= b.max[1] && a.max[1] + e >= b.min[1] &&
      a.min[2] - e <= b.max[2] && a.max[2] + e >= b.min[2];
  };

  M.aabbCenter = function (out, a) {
    out[0] = (a.min[0] + a.max[0]) * 0.5;
    out[1] = (a.min[1] + a.max[1]) * 0.5;
    out[2] = (a.min[2] + a.max[2]) * 0.5;
    return out;
  };

  M.aabbSize = function (out, a) {
    out[0] = a.max[0] - a.min[0];
    out[1] = a.max[1] - a.min[1];
    out[2] = a.max[2] - a.min[2];
    return out;
  };

  M.aabbCopy = function (out, a) {
    out.min[0] = a.min[0]; out.min[1] = a.min[1]; out.min[2] = a.min[2];
    out.max[0] = a.max[0]; out.max[1] = a.max[1]; out.max[2] = a.max[2];
    return out;
  };

  /** AABB envolvente tras una transformación (conservador con rotaciones). */
  M.aabbTransform = function (out, a, m) {
    var min = [Infinity, Infinity, Infinity];
    var max = [-Infinity, -Infinity, -Infinity];
    var p = new Float32Array(3);
    for (var i = 0; i < 8; i++) {
      p[0] = (i & 1) ? a.max[0] : a.min[0];
      p[1] = (i & 2) ? a.max[1] : a.min[1];
      p[2] = (i & 4) ? a.max[2] : a.min[2];
      M.m4transformPoint(p, m, p);
      for (var k = 0; k < 3; k++) {
        if (p[k] < min[k]) min[k] = p[k];
        if (p[k] > max[k]) max[k] = p[k];
      }
    }
    out.min[0] = min[0]; out.min[1] = min[1]; out.min[2] = min[2];
    out.max[0] = max[0]; out.max[1] = max[1]; out.max[2] = max[2];
    return out;
  };

  /* ---------------------------- intersecciones ---------------------------- */

  /**
   * Rayo contra AABB (método de los planos). Devuelve t >= 0 o -1.
   * Si el origen está dentro de la caja devuelve 0.
   */
  M.rayAABB = function (origin, dir, min, max, maxT) {
    var limit = (maxT === undefined || maxT === null) ? Infinity : maxT;
    if (limit < 0) return -1;
    var tmin = 0;
    var tmax = limit;
    for (var i = 0; i < 3; i++) {
      var o = origin[i], d = dir[i];
      if (d > -1e-9 && d < 1e-9) {
        if (o < min[i] || o > max[i]) return -1;
      } else {
        var inv = 1 / d;
        var t1 = (min[i] - o) * inv;
        var t2 = (max[i] - o) * inv;
        if (t1 > t2) { var tmp = t1; t1 = t2; t2 = tmp; }
        if (t1 > tmin) tmin = t1;
        if (t2 < tmax) tmax = t2;
        if (tmin > tmax) return -1;
      }
    }
    if (tmin > limit) return -1;
    return tmin;
  };

  /** Segmento p0->p1 contra AABB. Devuelve t en [0,1] o -1. */
  M.raySegmentAABB = function (p0, p1, min, max) {
    var dx = p1[0] - p0[0], dy = p1[1] - p0[1], dz = p1[2] - p0[2];
    var dir = [dx, dy, dz];
    var t = M.rayAABB(p0, dir, min, max, 1);
    return t;
  };

  /**
   * Barrido de la caja A (con desplazamiento delta) contra la caja B.
   * Devuelve t en [0,1] del primer contacto, o -1.
   */
  M.aabbSweepAABB = function (aMin, aMax, delta, bMin, bMax) {
    var acx = (aMin[0] + aMax[0]) * 0.5;
    var acy = (aMin[1] + aMax[1]) * 0.5;
    var acz = (aMin[2] + aMax[2]) * 0.5;
    var ahx = (aMax[0] - aMin[0]) * 0.5;
    var ahy = (aMax[1] - aMin[1]) * 0.5;
    var ahz = (aMax[2] - aMin[2]) * 0.5;

    var eMin = [bMin[0] - ahx, bMin[1] - ahy, bMin[2] - ahz];
    var eMax = [bMax[0] + ahx, bMax[1] + ahy, bMax[2] + ahz];
    var origin = [acx, acy, acz];

    return M.rayAABB(origin, delta, eMin, eMax, 1);
  };

  /** ¿Está el punto dentro del cono (apex, dir, cosHalfAngle, range)? */
  M.pointInCone = function (point, apex, dir, cosHalfAngle, range) {
    var dx = point[0] - apex[0];
    var dy = point[1] - apex[1];
    var dz = point[2] - apex[2];
    var d2 = dx * dx + dy * dy + dz * dz;
    if (range > 0 && d2 > range * range) return false;
    if (d2 < 1e-8) return true;
    var inv = 1 / Math.sqrt(d2);
    var dot = (dx * dir[0] + dy * dir[1] + dz * dir[2]) * inv;
    return dot >= cosHalfAngle;
  };

  /** Punto más cercano de una recta a un punto; t = proyección. */
  M.closestPointOnRay = function (out, origin, dir, point) {
    var dx = point[0] - origin[0];
    var dy = point[1] - origin[1];
    var dz = point[2] - origin[2];
    var t = dx * dir[0] + dy * dir[1] + dz * dir[2];
    if (t < 0) t = 0;
    out[0] = origin[0] + dir[0] * t;
    out[1] = origin[1] + dir[1] * t;
    out[2] = origin[2] + dir[2] * t;
    return t;
  };

  M.distancePointToSegment = function (p, a, b) {
    var abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2];
    var apx = p[0] - a[0], apy = p[1] - a[1], apz = p[2] - a[2];
    var denom = abx * abx + aby * aby + abz * abz;
    var t = denom > 1e-12 ? (apx * abx + apy * aby + apz * abz) / denom : 0;
    t = t < 0 ? 0 : (t > 1 ? 1 : t);
    var cx = a[0] + abx * t, cy = a[1] + aby * t, cz = a[2] + abz * t;
    var dx = p[0] - cx, dy = p[1] - cy, dz = p[2] - cz;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  };

  BS.Math = M;

  /* ======================================================================
   * Tests de auto-verificación registrados en BS.Debug
   * ==================================================================== */
  /* Los registros se hacen cuando BS.Debug ya existe (orden de carga §2.1). */
  if (BS.Debug && typeof BS.Debug.register === 'function') {
    BS.Debug.register('math:rayAABB', function () {
      var o = new Float32Array([0, 0, 0]);
      var d = new Float32Array([0, 0, 1]);
      var hit = M.rayAABB(o, d, new Float32Array([-1, -1, 5]), new Float32Array([1, 1, 7]), 100);
      var miss = M.rayAABB(o, d, new Float32Array([5, 5, 5]), new Float32Array([6, 6, 7]), 100);
      var inside = M.rayAABB(new Float32Array([0, 0, 6]), d, new Float32Array([-1, -1, 5]), new Float32Array([1, 1, 7]), 100);
      var seg = M.raySegmentAABB(new Float32Array([0, 0, 0]), new Float32Array([0, 0, 10]),
        new Float32Array([-1, -1, 5]), new Float32Array([1, 1, 7]));
      var ok = Math.abs(hit - 5) < 1e-5 && miss === -1 && inside === 0 && Math.abs(seg - 0.5) < 1e-5;
      return { ok: ok, hit: hit, miss: miss, inside: inside, segmentT: seg };
    });

    BS.Debug.register('math:matrixInvert', function () {
      var proj = M.m4perspective(M.m4(), 70 * M.DEG, 16 / 9, 0.05, 400);
      var view = M.m4fromYawPitchPos(M.m4(), 0.9, -0.3, new Float32Array([3, 4, 5]));
      var m = M.m4multiply(M.m4(), proj, view);
      var inv = M.m4invert(M.m4(), m);
      var prod = M.m4multiply(M.m4(), m, inv);
      var maxErr = 0;
      for (var i = 0; i < 16; i++) {
        var expect = (i % 5 === 0) ? 1 : 0;
        var e = Math.abs(prod[i] - expect);
        if (e > maxErr) maxErr = e;
      }
      return { ok: maxErr < 1e-4, maxError: maxErr };
    });
  } else {
    Log.warn('BS.Debug no disponible al cargar util.js: los tests math:* no se registran');
  }

})(window.BS = window.BS || {});
