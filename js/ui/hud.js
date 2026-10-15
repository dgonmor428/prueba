/* ===========================================================================
 * BLACKSITE: LAST SIGNAL  —  js/ui/hud.js
 * ---------------------------------------------------------------------------
 * Propósito : HUD en Canvas2D (§3.19): salud, munición (cargador/reserva),
 *             enemigos restantes, oleada, objetivo, mira dinámica, hitmarker,
 *             indicador direccional de daño, viñeta de vida baja, kill feed,
 *             subtítulos, prompts de interacción, barra de jefe, tutorial paso
 *             a paso y overlay de depuración (F1). Todo se dibuja por código:
 *             no hay imágenes ni fuentes externas.
 * Reglas    : §3.0 (IIFE, solo window.BS, sin class/let/const de archivo).
 *             Legible a 1024×768 y a 1920×1080 (escala por tamaño de ventana).
 *             Todas las funciones públicas toleran ctx/flujo incompletos.
 * Depende de: js/core/util.js (BS.Util, BS.Math, BS.Log),
 *             js/ui/style.js (BS.Style.CLASS) y, en tiempo de ejecución,
 *             ctx.player, ctx.weapons, ctx.enemies y ctx.game (con guardas).
 * Expone    : BS.HUD
 * =========================================================================== */
(function (BS) {
  'use strict';

  var M = BS.Math;

  /* ======================================================================
   * Colores y números de configuración (fuera del bucle, §8.6)
   * ==================================================================== */
  var COL = {
    cyan: '#7fe7ff',
    cyanDim: 'rgba(127,231,255,0.45)',
    cyanDeep: 'rgba(13,42,53,0.72)',
    amber: '#ffb347',
    amberDim: 'rgba(255,179,71,0.5)',
    red: '#ff5b5b',
    redDim: 'rgba(255,91,91,0.55)',
    green: '#79ffa8',
    ink: '#06121a',
    panel: 'rgba(4,10,14,0.62)',
    panelSolid: 'rgba(4,10,14,0.86)',
    white: '#eafcff',
    textDim: '#6f9aa8'
  };

  var CONFIG = {
    HIT_TIME: 0.28,          // duración del hitmarker (s)
    DAMAGE_TIME: 1.1,        // duración del indicador de daño (s)
    TOAST_TIME: 2.6,         // duración por defecto de los avisos (s)
    SUBTITLE_TIME: 5.0,      // duración de subtítulos (s)
    WAVE_TEXT_TIME: 3.0,     // duración del rótulo de oleada (s)
    KILLFEED_TIME: 4.0,      // duración de una línea de kill feed (s)
    KILLFEED_MAX: 5,
    TOAST_MAX: 3,
    DAMAGE_MAX: 8,
    LOW_HEALTH_FRAC: 0.35,   // por debajo de esto, viñeta roja
    HEALTH_BAR_W: 240,
    AMMO_W: 250,
    BASE_MIN_SIDE: 720,      // lado mínimo de referencia para la escala
    DPR_CAP: 2,
    CROSS_KICK_MAX: 26,      // expansión máxima de la mira por retroceso (px)
    OBJECTIVE_FLASH: 3.0
  };

  /* ======================================================================
   * Estado interno
   * ==================================================================== */
  var S = {
    ctx: null,
    canvas: null,
    g: null,
    dpr: 1,
    W: 1,
    H: 1,
    scale: 1,
    ready: false,
    visible: true,
    opacity: 1,
    time: 0,

    crosshairOn: true,
    crosshairKick: 0,

    hit: { t: 0, killed: false, headshot: false },
    lowHealth: false,
    lowPulse: 0,
    damage: [],
    toasts: [],
    killFeed: [],
    objective: { text: '', done: -1, total: -1, t: 0 },
    subtitle: { text: '', t: 0 },
    prompt: '',
    waveText: { main: '', sub: '', t: 0 },
    tutorial: null,
    boss: null,
    debug: false
  };

  /* ----------------------------------------------------------------------
   * Utilidades de dibujo (todas en px CSS; la escala se aplica por S.scale)
   * -------------------------------------------------------------------- */
  function px(n) { return n * S.scale; }

  function setFont(size, weight) {
    var g = S.g;
    if (!g) return;
    g.font = (weight ? weight + ' ' : '') + Math.round(px(size)) + 'px ' +
      'Consolas,"DejaVu Sans Mono","Liberation Mono","Courier New",monospace';
  }

  function textAt(str, x, y, color, size, align, baseline, weight) {
    var g = S.g;
    if (!g) return;
    g.fillStyle = color || COL.cyan;
    setFont(size || 13, weight);
    g.textAlign = align || 'left';
    g.textBaseline = baseline || 'alphabetic';
    g.fillText(str, x, y);
  }

  function measure(str, size, weight) {
    var g = S.g;
    if (!g) return 0;
    setFont(size || 13, weight);
    return g.measureText(str).width;
  }

  function roundRect(x, y, w, h) {
    var g = S.g;
    g.beginPath();
    g.rect(x, y, w, h);
  }

  function panelBox(x, y, w, h, bg, border) {
    var g = S.g;
    g.fillStyle = bg || COL.panel;
    roundRect(x, y, w, h);
    g.fill();
    if (border) {
      g.strokeStyle = border;
      g.lineWidth = 1;
      roundRect(x + 0.5, y + 0.5, w - 1, h - 1);
      g.stroke();
    }
  }

  /* Esquinas ámbar de un panel (coherentes con BS.Style). */
  function cornerTicks(x, y, w, h, len) {
    var g = S.g;
    len = len || 9;
    g.strokeStyle = COL.amber;
    g.lineWidth = Math.max(1, px(1.5));
    g.beginPath();
    g.moveTo(x, y + len); g.lineTo(x, y); g.lineTo(x + len, y);
    g.moveTo(x + w - len, y); g.lineTo(x + w, y); g.lineTo(x + w, y + len);
    g.moveTo(x, y + h - len); g.lineTo(x, y + h); g.lineTo(x + len, y + h);
    g.moveTo(x + w - len, y + h); g.lineTo(x + w, y + h); g.lineTo(x + w, y + h - len);
    g.stroke();
  }

  /* ----------------------------------------------------------------------
   * Lectura de estado en vivo (todo con guardas; nunca lanza)
   * -------------------------------------------------------------------- */
  function readHealth() {
    var c = S.ctx;
    var hp = 100, maxHp = 100;
    try {
      if (c && c.player) {
        if (typeof c.player.health === 'number') hp = c.player.health;
        if (typeof c.player.maxHealth === 'number' && c.player.maxHealth > 0) maxHp = c.player.maxHealth;
      }
    } catch (e) { /* noop */ }
    return { hp: hp, maxHp: maxHp };
  }

  function readWeapon() {
    var c = S.ctx;
    var out = { name: '', ammo: 0, mag: 0, reserve: 0, reloading: 0, ammoType: '' };
    try {
      var ws = (c && c.weapons) || (c && c.player && c.player.getWeapons && c.player.getWeapons());
      if (ws && typeof ws.getState === 'function') {
        var st = ws.getState();
        if (st) {
          out.name = st.name || st.id || '';
          out.ammo = st.ammoInMag | 0;
          out.mag = st.magSize | 0;
          out.reserve = st.reserve | 0;
          out.ammoType = st.ammoType || '';
          out.reloading = st.isReloading ? (st.reloadProgress || 0) : 0;
        }
      }
    } catch (e) { /* noop */ }
    return out;
  }

  function readGame() {
    var c = S.ctx;
    var out = { enemies: 0, wave: -1, state: '', objectives: null, boss: null };
    try {
      if (c && c.enemies && typeof c.enemies.aliveCount === 'function') out.enemies = c.enemies.aliveCount();
    } catch (e0) { /* noop */ }
    try {
      var G = (c && c.game) || BS.Game;
      if (G) {
        if (typeof G.currentWave === 'number') out.wave = G.currentWave;
        if (typeof G.getState === 'function') out.state = G.getState();
        if (G.objectives) out.objectives = G.objectives;
        if (G.boss) out.boss = G.boss;
      }
    } catch (e1) { /* noop */ }
    return out;
  }

  /* ======================================================================
   * API pública
   * ==================================================================== */
  var HUD = {
    init: function (ctx) {
      S.ctx = ctx || null;
      try {
        var dom = BS.Util.getDOM ? BS.Util.getDOM() : BS.Util.ensureDOM();
        S.canvas = dom && dom.hudCanvas;
        if (S.canvas && typeof S.canvas.getContext === 'function') {
          S.g = S.canvas.getContext('2d');
        }
      } catch (e) {
        BS.Log.error('BS.HUD.init:', e && e.message ? e.message : e);
        S.g = null;
      }
      S.hit.t = 0;
      S.damage.length = 0;
      S.toasts.length = 0;
      S.killFeed.length = 0;
      S.tutorial = null;
      S.boss = null;
      S.ready = true;
      HUD.resize();
      BS.Log.info('BS.HUD.init OK (canvas2d=' + !!S.g + ')');
    },

    update: function (dt) {
      dt = Number(dt) || 0;
      if (dt < 0) dt = 0;
      if (dt > 0.25) dt = 0.25;
      S.time += dt;
      S.lowPulse += dt;

      if (S.hit.t > 0) S.hit.t = Math.max(0, S.hit.t - dt);
      if (S.crosshairKick > 0) S.crosshairKick = Math.max(0, S.crosshairKick - dt * 90);

      var i;
      for (i = S.damage.length - 1; i >= 0; i--) {
        S.damage[i].t -= dt;
        if (S.damage[i].t <= 0) S.damage.splice(i, 1);
      }
      for (i = S.toasts.length - 1; i >= 0; i--) {
        S.toasts[i].t -= dt;
        if (S.toasts[i].t <= 0) S.toasts.splice(i, 1);
      }
      for (i = S.killFeed.length - 1; i >= 0; i--) {
        S.killFeed[i].t -= dt;
        if (S.killFeed[i].t <= 0) S.killFeed.splice(i, 1);
      }
      if (S.subtitle.t > 0) {
        S.subtitle.t -= dt;
        if (S.subtitle.t <= 0) S.subtitle.text = '';
      }
      if (S.waveText.t > 0) S.waveText.t = Math.max(0, S.waveText.t - dt);
      if (S.objective.t > 0) S.objective.t = Math.max(0, S.objective.t - dt);
    },

    render: function () {
      if (!S.ready || !S.g || !S.visible) return;
      var g = S.g;
      try {
        g.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
        g.clearRect(0, 0, S.W, S.H);
        g.globalAlpha = S.opacity;

        var hp = readHealth();
        var wp = readWeapon();
        var gm = readGame();

        if (S.lowHealth || (hp.maxHp > 0 && hp.hp / hp.maxHp <= CONFIG.LOW_HEALTH_FRAC)) {
          drawLowHealthVignette(1 - Math.max(0, hp.hp) / Math.max(1, hp.maxHp));
        }

        drawDamageIndicators();
        if (S.crosshairOn) drawCrosshair(wp, gm);
        drawHealth(hp);
        drawAmmo(wp);
        drawObjective(S.objective);
        if (S.boss) drawBossBar(S.boss);
        drawKillFeed();
        drawTopRight(gm);
        drawToasts();
        drawSubtitle();
        drawPrompt();
        drawWaveText();
        drawTutorial();
        if (S.hit.t > 0) drawHitmarker();
        if (S.debug) drawDebug(gm, hp, wp);

        g.globalAlpha = 1;
      } catch (e) {
        // El HUD nunca debe tumbar el bucle: si algo falla, se informa y sigue.
        BS.Log.error('BS.HUD.render:', e && e.message ? e.message : e);
      }
    },

    resize: function () {
      try {
        if (!S.canvas) {
          var dom = BS.Util.getDOM ? BS.Util.getDOM() : BS.Util.ensureDOM();
          S.canvas = dom && dom.hudCanvas;
        }
        if (!S.canvas) return;
        var cssW = S.canvas.clientWidth || (window.innerWidth | 0) || 1280;
        var cssH = S.canvas.clientHeight || (window.innerHeight | 0) || 720;
        var dpr = Math.min(window.devicePixelRatio || 1, CONFIG.DPR_CAP);
        S.dpr = dpr;
        S.W = Math.max(1, cssW);
        S.H = Math.max(1, cssH);
        S.canvas.width = Math.max(1, Math.round(cssW * dpr));
        S.canvas.height = Math.max(1, Math.round(cssH * dpr));
        var minSide = Math.min(S.W, S.H);
        S.scale = M.clamp(minSide / CONFIG.BASE_MIN_SIDE, 0.8, 1.6);
      } catch (e) {
        BS.Log.error('BS.HUD.resize:', e && e.message ? e.message : e);
      }
    },

    show: function () { HUD.setVisible(true); },
    hide: function () { HUD.setVisible(false); },
    setVisible: function (on) {
      S.visible = !!on;
      try {
        if (S.canvas) S.canvas.style.display = on ? 'block' : 'none';
      } catch (e) { /* noop */ }
    },

    /* ------------------------- eventos del juego ------------------------- */
    hitmarker: function (killed, headshot) {
      S.hit.t = CONFIG.HIT_TIME;
      S.hit.killed = !!killed;
      S.hit.headshot = !!headshot;
    },

    showDamage: function (dirAngle, amount) {
      if (S.damage.length >= CONFIG.DAMAGE_MAX) S.damage.shift();
      S.damage.push({ angle: Number(dirAngle) || 0, amount: Number(amount) || 0, t: CONFIG.DAMAGE_TIME });
    },

    notify: function (text, seconds, color) {
      if (!text) return;
      if (S.toasts.length >= CONFIG.TOAST_MAX) S.toasts.shift();
      S.toasts.push({
        text: String(text),
        t: Number(seconds) > 0 ? Number(seconds) : CONFIG.TOAST_TIME,
        color: color || COL.amber
      });
    },

    setObjective: function (text, done, total) {
      var changed = (S.objective.text !== text);
      S.objective.text = text || '';
      S.objective.done = (done === undefined || done === null) ? -1 : (done | 0);
      S.objective.total = (total === undefined || total === null) ? -1 : (total | 0);
      if (changed) S.objective.t = CONFIG.OBJECTIVE_FLASH;
    },

    setSubtitle: function (text, seconds) {
      S.subtitle.text = text ? String(text) : '';
      S.subtitle.t = text ? (Number(seconds) > 0 ? Number(seconds) : CONFIG.SUBTITLE_TIME) : 0;
    },

    setPrompt: function (text) {
      S.prompt = text ? String(text) : '';
    },

    setWaveText: function (main, sub, seconds) {
      S.waveText.main = main ? String(main) : '';
      S.waveText.sub = sub ? String(sub) : '';
      S.waveText.t = Number(seconds) > 0 ? Number(seconds) : CONFIG.WAVE_TEXT_TIME;
    },

    setLowHealthIndicator: function (on) {
      S.lowHealth = !!on;
    },

    setTutorial: function (step, total, text, key) {
      if (step === null || step === undefined) { S.tutorial = null; return; }
      S.tutorial = {
        step: step | 0,
        total: Math.max(1, total | 0 || 1),
        text: text ? String(text) : '',
        key: key ? String(key) : ''
      };
    },

    setBossBar: function (label, hp01) {
      S.boss = {
        label: label ? String(label) : 'OBJETIVO',
        hp01: M.clamp01(Number(hp01) || 0)
      };
    },

    clearBossBar: function () { S.boss = null; },

    killFeedLine: function (text, color) {
      if (!text) return;
      if (S.killFeed.length >= CONFIG.KILLFEED_MAX) S.killFeed.shift();
      S.killFeed.push({ text: String(text), color: color || COL.cyan, t: CONFIG.KILLFEED_TIME });
    },

    showCrosshair: function (on) { S.crosshairOn = !!on; },

    setCrosshairKick: function (amount) {
      var a = Number(amount) || 0;
      if (a > S.crosshairKick) S.crosshairKick = Math.min(CONFIG.CROSS_KICK_MAX, a);
    },

    debugOverlay: function (on) { S.debug = !!on; },

    setOpacity: function (a) { S.opacity = M.clamp01(Number(a)); },

    /* ------------------- extras para el arnés (BS.Debug) ----------------- */
    snapshot: function () {
      var hp = readHealth(), wp = readWeapon(), gm = readGame();
      var obj = S.objective.text ? (' OBJ="' + S.objective.text + '"') : '';
      return 'HUD estado=' + (gm.state || '?') +
        ' PV=' + Math.round(hp.hp) + '/' + Math.round(hp.maxHp) +
        ' MUN=' + wp.ammo + '/' + wp.reserve + ' (' + (wp.name || '?') + ')' +
        ' ENEM=' + gm.enemies + ' OLEADA=' + gm.wave +
        obj +
        ' hit=' + (S.hit.t > 0 ? 1 : 0) +
        ' dmg=' + S.damage.length +
        ' avisos=' + S.toasts.length;
    },

    state: function () {
      var hp = readHealth(), wp = readWeapon(), gm = readGame();
      return {
        visible: S.visible,
        hp: hp.hp, maxHp: hp.maxHp,
        ammo: wp.ammo, mag: wp.mag, reserve: wp.reserve, weapon: wp.name,
        enemies: gm.enemies, wave: gm.wave,
        objective: S.objective.text,
        hitmarker: S.hit.t > 0, hitKilled: S.hit.killed, hitHeadshot: S.hit.headshot,
        damageIndicators: S.damage.length,
        toasts: S.toasts.length,
        killFeed: S.killFeed.length,
        prompt: S.prompt,
        tutorial: S.tutorial ? (S.tutorial.step + '/' + S.tutorial.total) : null,
        boss: S.boss ? S.boss.label : null,
        lowHealth: S.lowHealth,
        debug: S.debug,
        scale: S.scale, width: S.W, height: S.H
      };
    },

    /* Tabla de configuración (para el tester) */
    CONFIG: CONFIG,
    COL: COL
  };

  /* ======================================================================
   * Dibujantes privados
   * ==================================================================== */

  function drawCrosshair(wp, gm) {
    var g = S.g;
    var cx = S.W * 0.5, cy = S.H * 0.5;
    var spreadPx = px(6);
    try {
      var c = S.ctx;
      var ws = (c && c.weapons) || null;
      if (ws && typeof ws.getSpreadPx === 'function') spreadPx = ws.getSpreadPx(S.H);
    } catch (e) { /* noop */ }
    var gap = spreadPx + S.crosshairKick;
    var len = px(7);
    var th = Math.max(1, px(1.5));

    g.strokeStyle = S.lowHealth ? COL.red : COL.cyan;
    g.lineWidth = th;
    g.beginPath();
    // 4 brazos
    g.moveTo(cx - gap - len, cy); g.lineTo(cx - gap, cy);
    g.moveTo(cx + gap, cy); g.lineTo(cx + gap + len, cy);
    g.moveTo(cx, cy - gap - len); g.lineTo(cx, cy - gap);
    g.moveTo(cx, cy + gap); g.lineTo(cx, cy + gap + len);
    g.stroke();
    // punto central
    g.fillStyle = S.lowHealth ? COL.red : COL.cyan;
    g.fillRect(cx - th * 0.5, cy - th * 0.5, th, th);
  }

  function drawHitmarker() {
    var g = S.g;
    var cx = S.W * 0.5, cy = S.H * 0.5;
    var f = S.hit.t / CONFIG.HIT_TIME;
    var d = px(10) + (1 - f) * px(6);
    var len = px(7);
    g.strokeStyle = S.hit.killed ? COL.red : (S.hit.headshot ? COL.amber : COL.white);
    g.lineWidth = Math.max(1.5, px(2));
    g.globalAlpha = S.opacity * M.clamp01(f * 1.4);
    g.beginPath();
    g.moveTo(cx - d - len, cy - d - len); g.lineTo(cx - d, cy - d);
    g.moveTo(cx + d, cy - d); g.lineTo(cx + d + len, cy - d - len);
    g.moveTo(cx - d - len, cy + d + len); g.lineTo(cx - d, cy + d);
    g.moveTo(cx + d, cy + d); g.lineTo(cx + d + len, cy + d + len);
    g.stroke();
    g.globalAlpha = S.opacity;
  }

  function drawHealth(hp) {
    var g = S.g;
    var w = px(CONFIG.HEALTH_BAR_W);
    var h = px(14);
    var x = px(26);
    var y = S.H - px(46);
    var frac = hp.maxHp > 0 ? M.clamp01(hp.hp / hp.maxHp) : 0;

    textAt('VIDA', x, y - px(6), COL.cyanDim, 11, 'left', 'alphabetic', 'bold');
    panelBox(x, y, w, h, COL.panelSolid, COL.cyanDim);
    g.fillStyle = frac <= CONFIG.LOW_HEALTH_FRAC ? COL.red : COL.cyan;
    g.fillRect(x + 1, y + 1, Math.max(0, (w - 2) * frac), h - 2);
    // marcas de cuarto
    g.strokeStyle = 'rgba(0,0,0,0.45)';
    g.lineWidth = 1;
    for (var i = 1; i < 4; i++) {
      var mx = x + (w / 4) * i;
      g.beginPath(); g.moveTo(mx, y + 1); g.lineTo(mx, y + h - 1); g.stroke();
    }
    textAt(String(Math.max(0, Math.round(hp.hp))), x + w + px(10), y + h - px(2),
      frac <= CONFIG.LOW_HEALTH_FRAC ? COL.red : COL.white, 16, 'left', 'alphabetic', 'bold');
  }

  function drawAmmo(wp) {
    var g = S.g;
    var right = S.W - px(26);
    var y = S.H - px(40);

    if (wp.name) {
      var nw = measure(wp.name.toUpperCase(), 12, 'bold');
      textAt(wp.name.toUpperCase(), right, y - px(22), COL.cyanDim, 12, 'right', 'alphabetic', 'bold');
    }
    var magStr = String(wp.ammo);
    var reserveStr = '/ ' + String(wp.reserve);
    textAt(reserveStr, right, y, COL.cyanDim, 16, 'right', 'alphabetic');
    var reserveW = measure(reserveStr, 16);
    var magColor = (wp.mag > 0 && wp.ammo === 0) ? COL.red : COL.amber;
    textAt(magStr, right - reserveW - px(10), y + px(4), magColor, 30, 'right', 'alphabetic', 'bold');

    if (wp.reloading > 0) {
      var w = px(150), h = px(6);
      var x = S.W - px(26) - w;
      var by = y + px(12);
      panelBox(x, by, w, h, COL.panelSolid, COL.amberDim);
      g.fillStyle = COL.amber;
      g.fillRect(x + 1, by + 1, (w - 2) * M.clamp01(wp.reloading), h - 2);
      textAt('RECARGANDO', x + w * 0.5, by - px(4), COL.amber, 10, 'center');
    }
  }

  function drawObjective(obj) {
    if (!obj || !obj.text) return;
    var color = obj.t > 0 ? COL.amber : COL.cyan;
    var label = obj.text;
    if (obj.total > 0 && obj.done >= 0) label = label + '  [' + obj.done + '/' + obj.total + ']';
    var w = measure(label, 13, 'bold') + px(28);
    var x = S.W * 0.5 - w * 0.5;
    var y = px(18);
    panelBox(x, y, w, px(24), COL.panel, COL.cyanDim);
    textAt(label, S.W * 0.5, y + px(16), color, 13, 'center', 'alphabetic', 'bold');
  }

  function drawBossBar(boss) {
    var g = S.g;
    var w = Math.min(S.W * 0.44, px(560));
    var h = px(12);
    var x = S.W * 0.5 - w * 0.5;
    var y = px(58);
    textAt(boss.label.toUpperCase(), S.W * 0.5, y - px(5), COL.red, 13, 'center', 'alphabetic', 'bold');
    panelBox(x, y, w, h, COL.panelSolid, COL.redDim);
    g.fillStyle = COL.red;
    g.fillRect(x + 1, y + 1, Math.max(0, (w - 2) * boss.hp01), h - 2);
  }

  function drawKillFeed() {
    if (!S.killFeed.length) return;
    var x = px(26);
    var y = px(96);
    for (var i = 0; i < S.killFeed.length; i++) {
      var k = S.killFeed[i];
      var a = M.clamp01(k.t / 0.6);
      S.g.globalAlpha = S.opacity * a;
      textAt(k.text, x, y + i * px(18), k.color, 12, 'left', 'alphabetic');
      S.g.globalAlpha = S.opacity;
    }
  }

  function drawTopRight(gm) {
    var x = S.W - px(26);
    var y = px(28);
    textAt('OLEADA ' + (gm.wave >= 0 ? (gm.wave + 1) : '—'), x, y, COL.amber, 14, 'right', 'alphabetic', 'bold');
    textAt('ENEMIGOS: ' + gm.enemies, x, y + px(20), COL.cyan, 12, 'right', 'alphabetic');
    var G = (S.ctx && S.ctx.game) || BS.Game;
    if (G && typeof G.missionTime === 'number') {
      var t = BS.Util.formatTime ? BS.Util.formatTime(G.missionTime) : String(Math.round(G.missionTime));
      textAt('TIEMPO ' + t, x, y + px(38), COL.cyanDim, 12, 'right', 'alphabetic');
    }
  }

  function drawToasts() {
    if (!S.toasts.length) return;
    var baseY = S.H - px(120);
    for (var i = 0; i < S.toasts.length; i++) {
      var t = S.toasts[i];
      var w = measure(t.text, 13, 'bold') + px(30);
      var x = S.W * 0.5 - w * 0.5;
      var y = baseY - (S.toasts.length - 1 - i) * px(30);
      var a = M.clamp01(t.t / 0.5);
      S.g.globalAlpha = S.opacity * a;
      panelBox(x, y, w, px(24), COL.panelSolid, t.color);
      textAt(t.text, S.W * 0.5, y + px(16), t.color, 13, 'center', 'alphabetic', 'bold');
      S.g.globalAlpha = S.opacity;
    }
  }

  function drawSubtitle() {
    if (!S.subtitle.text) return;
    var w = measure(S.subtitle.text, 13) + px(28);
    var x = S.W * 0.5 - w * 0.5;
    var y = S.H - px(90);
    S.g.globalAlpha = S.opacity * M.clamp01(S.subtitle.t / 0.6);
    panelBox(x, y, w, px(24), COL.panel, COL.cyanDim);
    textAt(S.subtitle.text, S.W * 0.5, y + px(16), COL.white, 13, 'center', 'alphabetic');
    S.g.globalAlpha = S.opacity;
  }

  function drawPrompt() {
    if (!S.prompt) return;
    var w = measure(S.prompt, 14, 'bold') + px(34);
    var x = S.W * 0.5 - w * 0.5;
    var y = S.H * 0.62;
    panelBox(x, y, w, px(28), COL.panelSolid, COL.amber);
    cornerTicks(x, y, w, px(28), px(8));
    textAt(S.prompt, S.W * 0.5, y + px(19), COL.amber, 14, 'center', 'alphabetic', 'bold');
  }

  function drawWaveText() {
    if (!S.waveText.main || S.waveText.t <= 0) return;
    var a = M.clamp01(S.waveText.t / 0.6);
    var y = px(120);
    S.g.globalAlpha = S.opacity * a;
    textAt(S.waveText.main, S.W * 0.5, y, COL.amber, 30, 'center', 'alphabetic', 'bold');
    if (S.waveText.sub) textAt(S.waveText.sub, S.W * 0.5, y + px(24), COL.cyan, 14, 'center', 'alphabetic');
    S.g.globalAlpha = S.opacity;
  }

  function drawTutorial() {
    var tu = S.tutorial;
    if (!tu) return;
    var label = tu.text + (tu.key ? '   [' + tu.key + ']' : '');
    var w = Math.min(S.W * 0.8, measure(label, 13, 'bold') + px(40));
    var x = S.W * 0.5 - w * 0.5;
    var y = S.H - px(160);
    panelBox(x, y, w, px(30), COL.panelSolid, COL.cyan);
    cornerTicks(x, y, w, px(30), px(8));
    textAt('PASO ' + tu.step + '/' + tu.total, x + px(12), y + px(12), COL.cyanDim, 10, 'left');
    textAt(label, S.W * 0.5, y + px(22), COL.white, 13, 'center', 'alphabetic', 'bold');
  }

  function drawDamageIndicators() {
    if (!S.damage.length) return;
    var g = S.g;
    var cx = S.W * 0.5, cy = S.H * 0.5;
    var radius = px(96);
    for (var i = 0; i < S.damage.length; i++) {
      var d = S.damage[i];
      var f = M.clamp01(d.t / CONFIG.DAMAGE_TIME);
      // dirAngle: 0 = frente (-Z); positivo a la derecha
      var ang = -Math.PI * 0.5 + d.angle;
      g.save();
      g.translate(cx, cy);
      g.rotate(ang);
      g.globalAlpha = S.opacity * f;
      g.fillStyle = COL.red;
      var span = px(14);
      g.beginPath();
      g.moveTo(0, -radius - px(16));
      g.lineTo(-span, -radius);
      g.lineTo(span, -radius);
      g.closePath();
      g.fill();
      g.restore();
      g.globalAlpha = S.opacity;
    }
  }

  function drawLowHealthVignette(severity) {
    var g = S.g;
    var pulse = 0.5 + 0.5 * Math.sin(S.lowPulse * 6.0);
    var a = M.clamp01(severity) * (0.28 + 0.22 * pulse);
    if (a <= 0.001) return;
    var grad = g.createRadialGradient(S.W * 0.5, S.H * 0.5, Math.min(S.W, S.H) * 0.28,
      S.W * 0.5, S.H * 0.5, Math.max(S.W, S.H) * 0.62);
    grad.addColorStop(0, 'rgba(120,0,0,0)');
    grad.addColorStop(1, 'rgba(150,10,10,' + a.toFixed(3) + ')');
    g.fillStyle = grad;
    roundRect(0, 0, S.W, S.H);
    g.fill();
  }

  function drawDebug(gm, hp, wp) {
    var st = null;
    try { st = BS.Debug && BS.Debug.stats ? BS.Debug.stats() : null; } catch (e) { st = null; }
    var pos = [0, 0, 0], yaw = 0;
    try {
      if (S.ctx && S.ctx.player && S.ctx.player.pos) {
        pos = [S.ctx.player.pos[0], S.ctx.player.pos[1], S.ctx.player.pos[2]];
        yaw = S.ctx.player.yaw || 0;
      }
    } catch (e2) { /* noop */ }
    var lines = [
      'F1 DEBUG',
      'estado=' + (gm.state || '?') + '  oleada=' + gm.wave + '  enemigos=' + gm.enemies,
      'hp=' + Math.round(hp.hp) + '  arma=' + (wp.name || '?') + '  mun=' + wp.ammo + '/' + wp.reserve,
      'pos=' + pos[0].toFixed(1) + ',' + pos[1].toFixed(1) + ',' + pos[2].toFixed(1) + '  yaw=' + yaw.toFixed(2)
    ];
    if (st) {
      lines.push('fps=' + (st.fps || 0).toFixed(1) + '  frameMs=' + (st.frameMs || 0).toFixed(1));
      lines.push('drawCalls=' + (st.drawCalls || 0) + '  tris=' + (st.tris || 0));
      lines.push('calidad=' + (st.quality || '?') + '  res=' + (st.resolutionScale || 1));
      lines.push('particulas=' + (st.particles || 0) + '  luces=' + (st.lightsOn || 0) + '/' + (st.lights || 0));
    }
    var g = S.g;
    var x = px(14), y = px(14);
    var w = px(230), h = px(14) * lines.length + px(14);
    panelBox(x, y, w, h, 'rgba(0,0,0,0.72)', COL.cyanDim);
    for (var i = 0; i < lines.length; i++) {
      textAt(lines[i], x + px(8), y + px(14) + i * px(14), i === 0 ? COL.amber : COL.cyan, 11, 'left');
    }
  }

  BS.HUD = HUD;

  /* ======================================================================
   * Test: el hitmarker aparece en el frame del impacto y el HUD no lanza
   * (no inicializa el canvas real: solo comprueba el estado interno).
   * ==================================================================== */
  if (BS.Debug && typeof BS.Debug.register === 'function') {
    BS.Debug.register('hud:hitmarker', function () {
      var saved = {
        hit: { t: S.hit.t, killed: S.hit.killed, headshot: S.hit.headshot },
        visible: S.visible, opacity: S.opacity, g: S.g, ready: S.ready
      };
      var ok = true, notes = [];
      try {
        HUD.hitmarker(true, true);
        if (!(S.hit.t > 0 && S.hit.killed && S.hit.headshot)) { ok = false; notes.push('hitmarker no activado'); }

        // HUD.update RECORTA el dt a 0,25 s (protección legítima contra el dt
        // gigante tras alt-tab, ver hud.js). Una sola llamada con
        // HIT_TIME+0.01 (0.29) o DAMAGE_TIME+0.01 (1.11) solo avanzaba 0.25 s,
        // así que no expiraban. Acumulamos varios pasos de 0.25 s hasta
        // superar cada tiempo (sin tocar el recorte del código).
        var tAcc = 0;
        while (tAcc < CONFIG.HIT_TIME + 0.01) { HUD.update(0.25); tAcc += 0.25; }
        if (S.hit.t > 0) { ok = false; notes.push('hitmarker no expiró'); }

        HUD.showDamage(1.0, 20);
        if (S.damage.length !== 1) { ok = false; notes.push('showDamage'); }
        var dAcc = 0;
        while (dAcc < CONFIG.DAMAGE_TIME + 0.01) { HUD.update(0.25); dAcc += 0.25; }
        if (S.damage.length !== 0) { ok = false; notes.push('damage no expiró'); }

        HUD.notify('prueba', 1, '#fff');
        HUD.setObjective('OBJETIVO DE PRUEBA', 1, 3);
        HUD.setSubtitle('subtítulo', 1);
        HUD.setPrompt('PULSA [E]');
        HUD.setWaveText('OLEADA 1', 'SONDA', 1);
        HUD.setBossBar('JEFE', 0.5);
        HUD.setTutorial(1, 3, 'MUEVETE', 'W');
        HUD.killFeedLine('VIGÍA-7 ELIMINADO', '#fff');
        HUD.showCrosshair(true);
        HUD.setCrosshairKick(10);
        HUD.debugOverlay(true);
        HUD.setOpacity(0.9);

        var snap = HUD.snapshot();
        var st = HUD.state();
        if (typeof snap !== 'string' || snap.length === 0) { ok = false; notes.push('snapshot'); }
        if (!st || st.boss !== 'JEFE' || st.tutorial !== '1/3') { ok = false; notes.push('state'); }

        // render() no debe lanzar aunque no haya canvas real (S.g puede ser null)
        HUD.render(0.016);

        HUD.clearBossBar();
        HUD.setTutorial(null);
        HUD.setPrompt(null);
        HUD.debugOverlay(false);
        HUD.setOpacity(1);
      } catch (e) {
        ok = false;
        notes.push('excepción: ' + (e && e.message ? e.message : e));
      } finally {
        S.hit.t = saved.hit.t; S.hit.killed = saved.hit.killed; S.hit.headshot = saved.hit.headshot;
        S.visible = saved.visible; S.opacity = saved.opacity;
        S.g = saved.g; S.ready = saved.ready;
        S.damage.length = 0;
        S.toasts.length = 0;
        S.killFeed.length = 0;
        S.boss = null;
        S.tutorial = null;
      }
      return {
        ok: ok,
        hitTime: S.hit.t,
        notas: notes,
        escala: Math.round(S.scale * 100) / 100,
        viewport: [S.W, S.H]
      };
    });
  }

})(window.BS = window.BS || {});
