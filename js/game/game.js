/* ===========================================================================
 * BLACKSITE: LAST SIGNAL  —  js/game/game.js
 * ---------------------------------------------------------------------------
 * Propósito : el corazón del juego (§3.21). Construye el `ctx` compartido en
 *             el orden obligatorio, implementa el mediador de combate
 *             (`ctx.combat`), la máquina de estados (9 estados), el bucle de
 *             paso fijo (dt = 1/60, máx. 4 pasos), la progresión por oleadas y
 *             objetivos, la victoria y la derrota, los checkpoints y la pausa
 *             automática por pérdida de Pointer Lock o visibilidad.
 * Reglas    : §3.0 (IIFE, solo window.BS, sin class/let/const de archivo),
 *             §5 (bucle), §6 (mitigaciones), §7 (rendimiento).
 *             El LOTE B puede no existir todavía: todos los subsistemas se
 *             consultan con guardas y hay *fallbacks* mínimos para que el juego
 *             nunca se rompa y `BS.Debug.runAll()` no lance.
 * Depende de: todo BS.* de §3 (A y B), siempre con guardas.
 * Expone    : BS.Game
 * =========================================================================== */
(function (BS) {
  'use strict';

  var M = BS.Math;

  /* ======================================================================
   * Constantes (§8.6: nada de números sueltos en el bucle)
   * ==================================================================== */
  var FIXED_DT = 1 / 60;
  var MAX_STEPS = 4;
  var DT_MAX_FRAME = 1 / 15;
  var MAX_FRAME_GAP = 0.5;
  var SEED = 0xB1AC5E;

  /* 9 estados del juego (§3.21 + 'error' para el fallo fatal de WebGL). */
  var STATE = {
    BOOT: 'boot',
    LOADING: 'loading',
    MENU: 'menu',
    TUTORIAL: 'tutorial',
    PLAYING: 'playing',
    PAUSED: 'paused',
    DEAD: 'dead',
    VICTORY: 'victory',
    ERROR: 'error'
  };
  var STATE_VALUES = ['boot', 'loading', 'menu', 'tutorial', 'playing', 'paused', 'dead', 'victory', 'error'];

  var CONFIG = {
    INTERACT_KEY: 'KeyE',
    INTERACT_PROMPT: 'MANTÉN [E] PARA INTERACTUAR',
    WAVE_GAP_DEFAULT: 8,
    TUTORIAL_TIMEOUT: 95,
    TUTORIAL_MOVE_DIST: 2.0,
    FALLBACK_SPAWN: { pos: [-24, 1.0, 24], yaw: 2.4 },
    LIGHT_BUDGET_LOW: 1,
    LIGHT_BUDGET_HIGH: 3
  };

  /* --- Datos de reserva (§4.1) por si el LOTE B aún no ha aterrizado. --- */
  var DEFAULT_WAVES = [
    { index: 0, label: 'OLEADA 1 — SONDA', spawnDelay: 1.5, betweenDelay: 3, maxAlive: 8,
      enemies: [{ type: 'drone', count: 6 }], spawnPoints: ['e1'], trigger: { objectives: ['reach_atrium'] } },
    { index: 1, label: 'OLEADA 2 — EMBOSCADA', spawnDelay: 0.9, betweenDelay: 8, maxAlive: 10,
      enemies: [{ type: 'stalker', count: 5 }, { type: 'drone', count: 4 }], spawnPoints: ['e1', 'e2'],
      trigger: { requiresObjectives: ['power'] }, reward: { pickup: 'weapon_smg', at: [6, 0.6, -6] } },
    { index: 2, label: 'OLEADA 3 — BLINDAJE', spawnDelay: 1.2, betweenDelay: 10, maxAlive: 12,
      enemies: [{ type: 'brute', count: 3 }, { type: 'drone', count: 6 }], spawnPoints: ['e1', 'e2', 'e3'] },
    { index: 3, label: 'OLEADA 4 — PURGA', spawnDelay: 0.6, betweenDelay: 10, maxAlive: 18,
      enemies: [{ type: 'stalker', count: 8 }, { type: 'drone', count: 8 }, { type: 'brute', count: 1 }],
      spawnPoints: ['e1', 'e2'] },
    { index: 4, label: 'OLEADA FINAL — EL CELADOR', spawnDelay: 2.0, betweenDelay: 0, maxAlive: 14, boss: true,
      enemies: [{ type: 'brute', count: 1, variant: 'prime', hpMul: 3.2 },
        { type: 'drone', count: 6 }, { type: 'stalker', count: 4 }],
      spawnPoints: ['e3'], trigger: { requiresObjectives: ['beacon'] }, victoryOnClear: true }
  ];

  var DEFAULT_LANDMARKS = [
    { id: 'atrium', pos: [0, 0, 0], radius: 8, label: 'ATRIO' },
    { id: 'reactor', pos: [0, 0, -20], radius: 9, label: 'REACTOR' }
  ];

  var DEFAULT_ENEMY_SPAWNS = [
    { id: 'e1', type: 'drone', pos: [8, 1.9, 4], waves: [1, 2, 3, 4, 5], patrol: [[8, 1.9, 4], [4, 1.9, -4]] },
    { id: 'e2', type: 'stalker', pos: [-8, 0.6, 4], waves: [2, 3, 4, 5], patrol: [[-8, 0.6, 4], [-8, 0.6, -6]] },
    { id: 'e3', type: 'brute', pos: [0, 1.2, -14], waves: [3, 4, 5], patrol: [[0, 1.2, -14], [6, 1.2, -10]] }
  ];

  var DEFAULT_OBJECTIVES = [
    { id: 'reach_atrium', type: 'goto', landmark: 'atrium', radius: 4, label: 'LLEGA AL ATRIO CENTRAL' },
    { id: 'power', type: 'interact', pos: [6, 1.2, -6], radius: 2.2, holdTime: 3.0, label: 'RESTAURA LA ENERGÍA', requiresWave: 0 },
    { id: 'beacon', type: 'interact', pos: [-6, 1.2, -6], radius: 2.2, holdTime: 4.0, label: 'ACTIVA LA BALIZA DE RESCATE', requiresWave: 4 }
  ];

  /* ======================================================================
   * Estado interno del módulo (no se expone)
   * ==================================================================== */
  var acc = 0;
  var lastTime = 0;
  var ready = false;
  var waveBetween = 0;
  var pauseWasLock = false;
  var contextLost = false;
  var IDENTITY = null;
  var camPos = new Float32Array(3);
  var tmpDir = new Float32Array(3);
  var flashPos = new Float32Array(3);
  var tmpV = new Float32Array(3);
  var tutTime = 0;
  var tutStep = 0;
  var tutStart = new Float32Array(3);
  var loggedErrors = {};

  function logOnce(key, e) {
    if (loggedErrors[key]) return;
    loggedErrors[key] = true;
    BS.Log.error('BS.Game(' + key + '):', e && e.message ? e.message : e);
  }

  function emit(name, payload) {
    try { if (BS.Events && BS.Events.emit) BS.Events.emit(name, payload); } catch (e) { /* noop */ }
  }

  function call(obj, method, a, b, c, d) {
    if (!obj || typeof obj[method] !== 'function') return null;
    try { return obj[method](a, b, c, d); }
    catch (e) { logOnce(method, e); return null; }
  }

  /* ======================================================================
   * Fallbacks mínimos (solo se usan si el LOTE B no está disponible)
   * ==================================================================== */
  function makeFallbackLevel(mission) {
    var waves = (mission && mission.waves && mission.waves.length) ? mission.waves : DEFAULT_WAVES;
    var objectives = (mission && mission.entities && mission.entities.objectives && mission.entities.objectives.length)
      ? mission.entities.objectives : DEFAULT_OBJECTIVES;
    var landmarks = (mission && mission.entities && mission.entities.landmarks && mission.entities.landmarks.length)
      ? mission.entities.landmarks : DEFAULT_LANDMARKS;
    var enemySpawns = (mission && mission.entities && mission.entities.enemySpawns && mission.entities.enemySpawns.length)
      ? mission.entities.enemySpawns : DEFAULT_ENEMY_SPAWNS;
    var pickups = (mission && mission.entities && mission.entities.pickups) ? mission.entities.pickups : [];
    var spawn = (mission && mission.entities && mission.entities.playerSpawn) ? mission.entities.playerSpawn : CONFIG.FALLBACK_SPAWN;

    return {
      data: mission || { id: 'fallback', environment: {}, waves: waves },
      fallback: true,
      chunks: [],
      colliders: [],
      colliderGrid: null,
      collidersAABB: [],
      props: [],
      spawns: { player: spawn, enemies: enemySpawns, pickups: pickups, objectives: objectives },
      lights: [],
      navNodes: [],
      waves: waves,
      landmarks: landmarks,
      bounds: { min: new Float32Array([-60, 0, -60]), max: new Float32Array([60, 16, 60]) },
      buildTimeMs: 0,
      dispose: function () { },
      rebuild: function () { },
      queryColliders: function (aabb, out) { return out || []; },
      groundHeightAt: function () { return 0; },
      isInsideLevel: function () { return true; }
    };
  }

  function makeFallbackWeapons() {
    return {
      update: function () { },
      tryFire: function () { return false; },
      reload: function () { return false; },
      switchTo: function () { return false; },
      nextWeapon: function () { },
      prevWeapon: function () { },
      cancelReload: function () { },
      hasWeapon: function () { return false; },
      giveWeapon: function () { },
      addAmmo: function () { return 0; },
      addAmmoToCurrent: function () { return 0; },
      addReserve: function () { return 0; },
      fillAllAmmo: function () { },
      reset: function () { },
      current: null,
      getState: function () { return { ammoInMag: 0, magSize: 0, reserve: 0, name: '—', ammoType: '', isReloading: false }; },
      getSpreadPx: function () { return 6; },
      renderViewmodel: function () { },
      muzzleWorldPos: function (out) { return out || new Float32Array(3); },
      rebuild: function () { },
      dispose: function () { }
    };
  }

  function makeFallbackPlayer(ctx) {
    var P = {
      pos: new Float32Array([0, 1.0, 8]),
      vel: new Float32Array(3),
      yaw: Math.PI, pitch: 0,
      health: 100, maxHealth: 100, armor: 0,
      state: 'idle', isDead: false, isGrounded: true,
      isSprinting: false, isCrouching: false,
      bobPhase: 0, landImpact: 0, rollDeg: 0,
      lastDamageDir: 0, lastDamageTime: -99,
      godMode: false, speed: 0, _onDeath: null,
      fallback: true,

      update: function (dt) {
        var sens = (BS.Input && BS.Input.getSensitivity) ? BS.Input.getSensitivity() : 0.0022;
        var md = (BS.Input && BS.Input.consumeMouseDelta) ? BS.Input.consumeMouseDelta() : { dx: 0, dy: 0 };
        var invert = (BS.Input && BS.Input.getInvertY) ? BS.Input.getInvertY() : false;
        P.yaw -= md.dx * sens;
        P.pitch = M.clamp(P.pitch - md.dy * sens * (invert ? -1 : 1), -1.5, 1.5);

        var fwd = 0, side = 0;
        if (BS.Input) {
          if (BS.Input.isDown('KeyW')) fwd += 1;
          if (BS.Input.isDown('KeyS')) fwd -= 1;
          if (BS.Input.isDown('KeyA')) side -= 1;
          if (BS.Input.isDown('KeyD')) side += 1;
        }
        var crouch = BS.Input && BS.Input.isDown('ControlLeft');
        P.isCrouching = !!crouch;
        P.isSprinting = !!(BS.Input && BS.Input.isDown('ShiftLeft') && fwd > 0 && !crouch);
        var spd = crouch ? 2.1 : (P.isSprinting ? 7.2 : 4.4);

        var sinY = Math.sin(P.yaw), cosY = Math.cos(P.yaw);
        var wx = 0, wz = 0;
        if (fwd || side) {
          wx = (-sinY * fwd + cosY * side);
          wz = (-cosY * fwd - sinY * side);
          var len = Math.sqrt(wx * wx + wz * wz) || 1;
          wx = wx / len * spd; wz = wz / len * spd;
        }
        P.vel[0] = wx; P.vel[2] = wz;
        // integración simple + gravedad con groundHeightAt
        var ground = 0;
        if (ctx.level && typeof ctx.level.groundHeightAt === 'function') {
          var g = ctx.level.groundHeightAt(P.pos[0], P.pos[2], P.pos[1] + 1, 200);
          if (isFinite(g)) ground = g;
        }
        P.vel[1] -= 22 * dt;
        P.pos[0] += P.vel[0] * dt;
        P.pos[1] += P.vel[1] * dt;
        P.pos[2] += P.vel[2] * dt;
        if (P.pos[1] <= ground) { P.pos[1] = ground; P.vel[1] = 0; P.isGrounded = true; }
        else P.isGrounded = false;
        P.speed = Math.sqrt(P.vel[0] * P.vel[0] + P.vel[2] * P.vel[2]);
        P.state = P.isDead ? 'dead' : (P.speed > 6 ? 'sprint' : (P.speed > 0.2 ? 'walk' : 'idle'));
        P.bobPhase += P.speed * dt;
      },
      eyePosition: function (out) {
        out = out || new Float32Array(3);
        out[0] = P.pos[0];
        out[1] = P.pos[1] + (P.isCrouching ? 1.1 : 1.55);
        out[2] = P.pos[2];
        return out;
      },
      eyeHeight: function () { return P.isCrouching ? 1.1 : 1.55; },
      forward: function (out) { return M.v3fromYawPitch(out || new Float32Array(3), P.yaw, P.pitch); },
      damage: function (amount, sourcePos, kind) {
        if (P.godMode || P.isDead) return { died: false, hp: P.health, applied: 0 };
        var amt = Number(amount) || 0;
        P.health = Math.max(0, P.health - amt);
        if (P.health <= 0) { P.isDead = true; P.state = 'dead'; if (typeof P._onDeath === 'function') { try { P._onDeath(); } catch (e) { } } }
        return { died: P.health <= 0, hp: P.health, applied: amt };
      },
      heal: function (amount) { var a = Math.max(0, Number(amount) || 0); P.health = Math.min(P.maxHealth, P.health + a); return a; },
      setHealth: function (hp) { P.health = M.clamp(Number(hp) || 0, 0, P.maxHealth); P.isDead = P.health <= 0; },
      respawn: function (pos, yaw) {
        if (pos) M.v3copy(P.pos, pos);
        P.yaw = (yaw === undefined || yaw === null) ? P.yaw : yaw;
        P.pitch = 0; P.vel[0] = P.vel[1] = P.vel[2] = 0;
        P.health = P.maxHealth; P.isDead = false; P.state = 'idle';
      },
      addRecoil: function () { }, addCameraShake: function () { }, applyImpulse: function () { },
      getWeapons: function () { return ctx.weapons || null; },
      onDeath: function (cb) { P._onDeath = cb; }
    };
    return P;
  }

  function makeFallbackProjectiles() {
    return {
      list: [], update: function () { }, render: function () { }, reset: function () { },
      spawn: function () { return null; }, count: function () { return 0; }, setBudget: function () { }
    };
  }

  function makeFallbackPickups() {
    return {
      list: [], update: function () { }, render: function () { }, reset: function () { },
      spawn: function () { return null; }, KINDS: {}
    };
  }

  /* ======================================================================
   * Calidad
   * ==================================================================== */
  function autoQuality() {
    try {
      var caps = BS.GL && BS.GL.caps;
      if (!caps) return 'medium';
      if (caps.isSoftware) return 'low';
      if (caps.isWeak) return 'medium';
      return 'high';
    } catch (e) { return 'medium'; }
  }

  function resolveQuality(settings) {
    var q = settings && settings.quality;
    if (q === 'low' || q === 'medium' || q === 'high') return q;
    return autoQuality();
  }

  function qualityValue(key) {
    var ctx = Game.ctx;
    var low = Game.isLowQuality();
    switch (key) {
      case 'postFx': return low ? false : !!(ctx && ctx.settings && ctx.settings.postFx);
      case 'resolutionScale': return low ? 0.6 : ((ctx && ctx.settings) ? ctx.settings.resolutionScale : 1.0);
      case 'maxDynamicLights': return low ? CONFIG.LIGHT_BUDGET_LOW : CONFIG.LIGHT_BUDGET_HIGH;
      case 'particleBudget': return low ? 250 : (ctx && ctx.quality === 'medium' ? 900 : 2000);
      case 'textureSize': return low ? 128 : (ctx && ctx.quality === 'medium' ? 256 : 512);
      case 'voiceBudget': return low ? 12 : 24;
      default: return ctx && ctx.settings ? ctx.settings[key] : undefined;
    }
  }

  /* ======================================================================
   * Medio ambiente del nivel -> renderer
   * ==================================================================== */
  function applyEnvironment(ctx) {
    var env = (ctx.level && ctx.level.data && ctx.level.data.environment) || null;
    var R = ctx.renderer;
    if (!R) return;
    try {
      if (env) {
        if (env.ambient) R.setAmbient(env.ambient.sky, env.ambient.ground);
        if (env.fog) R.setFog(env.fog.color, env.fog.density);
      }
      R.setFov(ctx.settings.fov);
      R.setNearFar(0.05, 400);
      R.setMaxDynamicLights(qualityValue('maxDynamicLights'));
    } catch (e) { logOnce('environment', e); }
  }

  function clearColorOf(ctx) {
    try {
      var c = ctx.level && ctx.level.data && ctx.level.data.environment && ctx.level.data.environment.clearColor;
      if (c) return [c[0], c[1], c[2], 1];
    } catch (e) { /* noop */ }
    return [0.02, 0.025, 0.035, 1];
  }

  /* ======================================================================
   * Objetivos, oleadas y checkpoints
   * ==================================================================== */
  function findLandmark(ctx, id) {
    try {
      var lm = ctx.level && ctx.level.landmarks;
      if (!lm) return null;
      for (var i = 0; i < lm.length; i++) if (lm[i] && lm[i].id === id) return lm[i];
    } catch (e) { /* noop */ }
    return null;
  }

  function buildObjectives(ctx) {
    var defs = null;
    try {
      if (ctx.level && ctx.level.spawns && ctx.level.spawns.objectives && ctx.level.spawns.objectives.length) {
        defs = ctx.level.spawns.objectives;
      }
    } catch (e) { defs = null; }
    if (!defs || !defs.length) defs = DEFAULT_OBJECTIVES;

    var out = [];
    for (var i = 0; i < defs.length; i++) {
      var d = defs[i] || {};
      var pos = null, landmark = null;
      var lm = d.landmark ? findLandmark(ctx, d.landmark) : null;
      if (lm) {
        landmark = { id: lm.id, pos: new Float32Array([lm.pos[0], lm.pos[1], lm.pos[2]]) };
        pos = new Float32Array([lm.pos[0], lm.pos[1], lm.pos[2]]);
      } else if (d.pos) {
        pos = new Float32Array([d.pos[0], d.pos[1], d.pos[2]]);
      }
      out.push({
        id: d.id || ('obj' + i),
        label: d.label || d.id || ('OBJETIVO ' + (i + 1)),
        type: d.type || 'goto',
        radius: (d.radius === undefined ? 3 : d.radius),
        holdTime: (d.holdTime === undefined ? 3 : d.holdTime),
        requiresWave: d.requiresWave | 0,
        pos: pos, landmark: landmark,
        done: false, hold: 0
      });
    }
    return out;
  }

  function buildWaves(ctx) {
    var defs = null;
    try { defs = ctx.level && ctx.level.waves; } catch (e) { defs = null; }
    if (!defs || !defs.length) {
      try { defs = (ctx.level && ctx.level.data && ctx.level.data.waves) || null; } catch (e2) { defs = null; }
    }
    if (!defs || !defs.length) {
      try { defs = (BS.LevelData && BS.LevelData.mission && BS.LevelData.mission.waves); } catch (e3) { defs = null; }
    }
    if (!defs || !defs.length) defs = DEFAULT_WAVES;

    var out = [];
    for (var i = 0; i < defs.length; i++) {
      out.push({ index: i, def: defs[i] || {}, state: 'pending', spawned: 0, label: (defs[i] && defs[i].label) || ('OLEADA ' + (i + 1)) });
    }
    return out;
  }

  function isObjectiveDone(id) {
    var list = Game.objectives || [];
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === id) return !!list[i].done;
    return false;
  }

  function waveTriggerMet(w) {
    if (!w) return false;
    var tr = w.def && w.def.trigger;
    if (!tr) return true;
    var i;
    if (tr.objectives && tr.objectives.length) {
      for (i = 0; i < tr.objectives.length; i++) if (!isObjectiveDone(tr.objectives[i])) return false;
    }
    if (tr.requiresObjectives && tr.requiresObjectives.length) {
      for (i = 0; i < tr.requiresObjectives.length; i++) if (!isObjectiveDone(tr.requiresObjectives[i])) return false;
    }
    return true;
  }

  function nextPendingIndex() {
    var w = Game.waves || [];
    for (var i = 0; i < w.length; i++) {
      if (!w[i] || w[i].state !== 'pending') continue;
      var ok = true;
      for (var j = 0; j < i; j++) if (!w[j] || w[j].state !== 'cleared') { ok = false; break; }
      return ok ? i : -1;
    }
    return -1;
  }

  function aliveCount() {
    try {
      if (Game.ctx && Game.ctx.enemies && typeof Game.ctx.enemies.aliveCount === 'function') return Game.ctx.enemies.aliveCount() | 0;
      if (Game.ctx && Game.ctx.enemies && Game.ctx.enemies.list) {
        var n = 0, l = Game.ctx.enemies.list;
        for (var i = 0; i < l.length; i++) if (l[i] && l[i].alive) n++;
        return n;
      }
    } catch (e) { /* noop */ }
    return 0;
  }

  function refreshObjectiveHud() {
    var list = Game.objectives || [];
    var done = 0, current = null;
    for (var i = 0; i < list.length; i++) {
      if (list[i].done) done++;
      else if (!current) current = list[i];
    }
    var text = current ? current.label : 'TODAS LAS TAREAS COMPLETADAS';
    call(Game.ctx && Game.ctx.hud, 'setObjective', text, done, list.length);
    emit('objective:updated', { text: text, done: done, total: list.length });
  }

  function updateObjectives(dt) {
    var list = Game.objectives || [];
    var ctx = Game.ctx;
    var promptShown = false;
    for (var i = 0; i < list.length; i++) {
      var o = list[i];
      if (o.done) continue;
      if (o.requiresWave && Game.currentWave >= 0 && Game.currentWave < o.requiresWave) continue;
      var p = ctx.player;
      if (!p || !p.pos) continue;
      var target = o.pos;
      if (o.landmark && o.landmark.pos) target = o.landmark.pos;
      if (!target) continue;
      var dx = p.pos[0] - target[0];
      var dz = p.pos[2] - target[2];
      var dy = p.pos[1] - target[1];
      var d2 = dx * dx + dy * dy + dz * dz;
      var r = o.radius || 3;
      if (d2 > r * r) continue;

      if (o.type === 'interact') {
        promptShown = true;
        call(ctx.hud, 'setPrompt', 'MANTÉN [' + keyLabel(CONFIG.INTERACT_KEY) + '] — ' + o.label);
        var held = BS.Input && BS.Input.isDown(CONFIG.INTERACT_KEY);
        if (held) {
          o.hold += dt;
          if (o.hold >= o.holdTime) { Game.setObjectiveDone(o.id, true); }
        } else {
          o.hold = Math.max(0, o.hold - dt * 2);
        }
      } else {
        // goto
        Game.setObjectiveDone(o.id, true);
      }
    }
    if (!promptShown && !suspendedPrompt) call(ctx.hud, 'setPrompt', null);
  }

  function keyLabel(code) {
    if (code === 'KeyE') return 'E';
    if (code && code.indexOf('Key') === 0) return code.slice(3);
    return code;
  }

  var suspendedPrompt = false;

  function updateWaves(dt) {
    updateObjectives(dt);
    if (!ready) return;

    var w = Game.waves || [];
    // ¿Se ha limpiado la oleada activa?
    if (Game.currentWave >= 0) {
      var cur = w[Game.currentWave];
      if (cur && cur.state === 'active' && aliveCount() <= 0) {
        cur.state = 'cleared';
        emit('wave:cleared', { index: Game.currentWave });
        call(Game.ctx && Game.ctx.hud, 'notify', cur.label + ' SUPERADA', 2.6, '#79ffa8');
        if (cur.def && cur.def.victoryOnClear) { Game.victory(); return; }
        // Red de seguridad: si ya no queda ninguna oleada pendiente, victoria.
        if (Game.checkVictory()) { Game.victory(); return; }
        waveBetween = (cur.def && cur.def.betweenDelay) ? cur.def.betweenDelay : CONFIG.WAVE_GAP_DEFAULT;
        Game.currentWave = -1;
      }
    }

    if (waveBetween > 0) {
      waveBetween -= dt;
      if (waveBetween < 0) waveBetween = 0;
      return;
    }
    if (Game.currentWave >= 0) return;

    var idx = nextPendingIndex();
    if (idx < 0) return;
    if (!waveTriggerMet(w[idx])) return;
    Game.spawnWave(idx);
  }

  function updateBossBar() {
    var ctx = Game.ctx;
    var list = (ctx && ctx.enemies && ctx.enemies.list) || null;
    var boss = null;
    if (list) {
      for (var i = 0; i < list.length; i++) {
        var e = list[i];
        if (e && e.alive && e.variant === 'prime') { boss = e; break; }
      }
    }
    if (boss) {
      var hp01 = boss.maxHp > 0 ? Math.max(0, boss.hp / boss.maxHp) : 0;
      var name = (boss.type === 'brute' ? 'EL CELADOR' : 'PRIME');
      Game.boss = { label: name, hp01: hp01 };
      call(ctx.hud, 'setBossBar', name, hp01);
    } else if (Game.boss) {
      Game.boss = null;
      call(ctx.hud, 'clearBossBar');
    }
  }

  function respawnPickups(waveIndex) {
    var ctx = Game.ctx;
    if (!ctx || !ctx.pickups) return;
    try {
      call(ctx.pickups, 'reset');
      var list = (ctx.level && ctx.level.spawns && ctx.level.spawns.pickups) || [];
      for (var i = 0; i < list.length; i++) {
        var d = list[i];
        if (d && d.waves && d.waves.indexOf(waveIndex + 1) < 0) continue;
        call(ctx.pickups, 'spawn', d);
      }
    } catch (e) { logOnce('pickups', e); }
  }

  /* ======================================================================
   * Cámara / audio
   * ==================================================================== */
  function updateCamera() {
    var ctx = Game.ctx;
    if (!ctx || !ctx.renderer) return;
    var p = ctx.player;
    var pos = null, yaw = 0, pitch = 0;
    if (p && typeof p.eyePosition === 'function') {
      pos = p.eyePosition(camPos);
      yaw = p.yaw || 0;
      pitch = p.pitch || 0;
    } else if (ctx.renderer.camera) {
      pos = ctx.renderer.camera.pos; yaw = ctx.renderer.camera.yaw; pitch = ctx.renderer.camera.pitch;
    }
    if (pos) call(ctx.renderer, 'setCamera', pos, yaw, pitch, 0);
  }

  function updateAudioListener() {
    var ctx = Game.ctx;
    if (!ctx || !ctx.audio || typeof ctx.audio.setListener !== 'function') return;
    var p = ctx.player;
    if (!p) return;
    try {
      var eye = (typeof p.eyePosition === 'function') ? p.eyePosition(tmpV) : p.pos;
      var fwd = M.v3fromYawPitch(tmpDir, p.yaw || 0, p.pitch || 0);
      ctx.audio.setListener(eye, fwd, [0, 1, 0]);
    } catch (e) { /* noop */ }
  }

  /* ======================================================================
   * Tutorial (scripted, no bloqueante)
   * ==================================================================== */
  var TUT_STEPS = [
    { text: 'MUÉVETE POR LA INSTALACIÓN', key: 'W A S D', done: function (ctx) { return M.v3dist(ctx.player.pos, tutStart) > CONFIG.TUTORIAL_MOVE_DIST; } },
    { text: 'APUNTA Y DISPARA', key: 'CLIC IZQUIERDO', done: function () { return Game.shotsFired > 0; } },
    { text: 'CÚMPLE EL PRIMER OBJETIVO', key: 'E', done: function () { return isObjectiveDone('reach_atrium') || Game.objectivesDoneCount() > 0; } }
  ];

  function updateTutorial(dt) {
    if (Game.state !== STATE.TUTORIAL) return;
    var ctx = Game.ctx;
    tutTime += dt;
    var step = TUT_STEPS[tutStep];
    if (step && step.done(ctx)) {
      tutStep++;
      if (tutStep >= TUT_STEPS.length) {
        call(ctx && ctx.hud, 'setTutorial', null);
        call(ctx && ctx.hud, 'notify', 'ENTRENAMIENTO COMPLETADO', 2.5, '#79ffa8');
        Game.setState(STATE.PLAYING);
        return;
      }
    }
    if (tutStep < TUT_STEPS.length) {
      var s = TUT_STEPS[tutStep];
      call(ctx && ctx.hud, 'setTutorial', tutStep + 1, TUT_STEPS.length, s.text, s.key);
    }
    if (tutTime > CONFIG.TUTORIAL_TIMEOUT) {
      call(ctx && ctx.hud, 'setTutorial', null);
      Game.setState(STATE.PLAYING);
    }
  }

  /* ======================================================================
   * Muerte / victoria
   * ==================================================================== */
  function checkDeath() {
    if (Game.state !== STATE.PLAYING && Game.state !== STATE.TUTORIAL) return;
    var p = Game.ctx && Game.ctx.player;
    if (!p) return;
    var dead = p.isDead === true || (typeof p.health === 'number' && p.health <= 0);
    if (dead) Game.die();
  }

  /* ======================================================================
   * Objeto público
   * ==================================================================== */
  var Game = {
    STATE: STATE,
    STATE_VALUES: STATE_VALUES,
    CONFIG: CONFIG,
    ctx: null,
    state: STATE.BOOT,
    ready: false,
    _wasTutorial: false,
    _debugOn: false,

    // progresión
    waves: [],
    currentWave: -1,
    kills: 0,
    shotsFired: 0,
    shotsHit: 0,
    headshots: 0,
    missionTime: 0,
    objectives: [],
    boss: null,
    pauseReason: '',
    fpsCap: 0,

    /* ------------------------------------------------------------------
     * init(): construye ctx y todos los subsistemas en el orden obligatorio
     * ------------------------------------------------------------------ */
    init: function () {
      if (ready) return true;
      var dom = BS.Util.ensureDOM();
      var canvas = dom.canvas3d;
      if (BS.Style && BS.Style.inject) BS.Style.inject();

      /* 1. Contexto WebGL */
      var glRes = null;
      try { glRes = BS.GL.init(canvas, { antialias: false, alpha: false, preserveDrawingBuffer: true }); }
      catch (e) { glRes = null; }
      if (!glRes || !glRes.ok) {
        Game.state = STATE.ERROR;
        try {
          if (BS.Menu && BS.Menu.init) BS.Menu.init(null);
          if (BS.Menu && BS.Menu.showError) {
            BS.Menu.showError('No se ha podido crear el contexto WebGL.\n\n' +
              (glRes && glRes.reason ? glRes.reason : 'getContext devolvió null') +
              '\n\nComprueba que la aceleración por hardware del navegador esté activada.');
          }
        } catch (e2) { /* noop */ }
        return false;
      }

      /* 2. Captura de errores */
      if (BS.Debug && BS.Debug.captureErrors) BS.Debug.captureErrors();

      /* 3. Texturas */
      call(BS.Textures, 'init', BS.GL);

      var settings = (BS.Util.loadSettings) ? BS.Util.loadSettings() : {};

      /* 4. Renderer */
      var q = resolveQuality(settings);
      var rendererOk = call(BS.Renderer, 'init', BS.GL, {
        quality: q,
        postFx: (q !== 'low') && !!settings.postFx
      });
      if (!rendererOk) {
        Game.state = STATE.ERROR;
        try { if (BS.Menu && BS.Menu.showError) BS.Menu.showError('Los shaders no han compilado. Revisa la consola.'); } catch (e3) { }
        return false;
      }

      /* 5. Audio */
      call(BS.Audio, 'init');
      call(BS.Audio, 'preload');

      /* 6. Input */
      call(BS.Input, 'init', canvas);

      /* 7. ctx */
      var ctx = {
        gl: BS.GL,
        renderer: BS.Renderer,
        audio: BS.Audio,
        input: BS.Input,
        textures: BS.Textures,
        shaders: BS.Shaders,
        mesh: BS.Mesh,
        level: null,
        physics: BS.Physics,
        fx: BS.FX,
        projectiles: BS.Projectiles,
        weapons: null,
        player: null,
        pickups: BS.Pickups,
        enemies: BS.Enemies,
        hud: BS.HUD,
        menu: BS.Menu,
        debug: BS.Debug,
        game: Game,
        settings: settings,
        rng: null,
        events: BS.Events,
        time: 0,
        frameIndex: 0,
        quality: q
      };
      ctx.getQualitySetting = qualityValue;
      ctx.isLowQuality = function () { return ctx.quality === 'low'; };
      ctx.isWebGL2 = function () { return !!(BS.GL && BS.GL.caps && BS.GL.caps.isWebGL2); };
      ctx.rng = (BS.RNG && BS.RNG.create) ? BS.RNG.create(SEED) : function () { return 0.5; };
      Game.ctx = ctx;

      /* 8. Estilo y DOM ya asegurados */
      if (BS.Style && BS.Style.inject) BS.Style.inject();
      BS.Util.ensureDOM();

      /* 9. Bus de eventos limpio antes de que los módulos se suscriban */
      if (BS.Events && BS.Events.clear) BS.Events.clear();

      /* 10. FX */
      call(BS.FX, 'init', ctx);
      call(BS.FX, 'setParticleBudget', qualityValue('particleBudget'));

      /* 11. Proyectiles */
      call(ctx.projectiles, 'init', ctx);

      /* 12. Nivel */
      var mission = null;
      try { mission = (BS.LevelData && BS.LevelData.build) ? BS.LevelData.build() : null; } catch (e4) { mission = null; }
      var level = null;
      try { if (BS.Level && BS.Level.build) level = BS.Level.build(mission, ctx); } catch (e5) { logOnce('level', e5); level = null; }
      ctx.level = level || makeFallbackLevel(mission);
      Game.levelFallback = !!ctx.level.fallback;

      /* 13. Pickups */
      call(ctx.pickups, 'init', ctx);

      /* 14. Jugador (crea ctx.weapons por dentro) */
      var player = null;
      try { if (BS.Player && BS.Player.create) player = BS.Player.create(ctx); } catch (e6) { logOnce('player', e6); player = null; }
      if (!player) player = makeFallbackPlayer(ctx);
      ctx.player = player;
      var ws = null;
      try { ws = (typeof player.getWeapons === 'function') ? player.getWeapons() : null; } catch (e7) { ws = null; }
      ctx.weapons = ws || makeFallbackWeapons();
      if (!ctx.projectiles) ctx.projectiles = makeFallbackProjectiles();
      if (!ctx.pickups) ctx.pickups = makeFallbackPickups();

      /* 15. Enemigos */
      call(ctx.enemies, 'init', ctx);

      /* 16. HUD y menús */
      call(ctx.hud, 'init', ctx);
      if (ctx.menu && ctx.menu.init) ctx.menu.init(ctx);

      /* 17. ctx.game + mediador de combate */
      Game.fillCombat(ctx);

      /* 18. Cableado de eventos */
      Game.wire(ctx);

      /* 19. Ajustes iniciales */
      applyEnvironment(ctx);
      Game.applySettings(settings);
      if (ctx.settings.quality === 'auto') Game.applyQuality(q);

      /* Datos de progresión */
      Game.objectives = buildObjectives(ctx);
      Game.waves = buildWaves(ctx);
      Game.currentWave = -1;
      waveBetween = 0;
      IDENTITY = M.m4identity(M.m4());

      // Visibilidad inicial del HUD
      call(ctx.hud, 'setVisible', false);
      call(ctx.hud, 'showCrosshair', true);

      ready = true;
      Game.ready = true;
      Game.state = STATE.MENU;
      BS.Log.info('BS.Game.init OK (nivel=' + (ctx.level.fallback ? 'fallback' : 'real') +
        ', oleadas=' + Game.waves.length + ', objetivos=' + Game.objectives.length + ')');
      return true;
    },

    /* ------------------------------------------------------------------
     * Mediador de combate (consumido por armas/enemigos/proyectiles)
     * ------------------------------------------------------------------ */
    fillCombat: function (ctx) {
      ctx.combat = ctx.combat || {};
      ctx.combat.raycast = function (origin, dir, maxDist, mask, ignore) {
        var best = null;
        if (!origin || !dir) return null;
        var limit = (maxDist === undefined || maxDist === null) ? 400 : Number(maxDist);
        if (!isFinite(limit) || limit <= 0) return null;

        // mundo + props
        try {
          if (ctx.physics && ctx.level && typeof ctx.physics.raycast === 'function') {
            var h = ctx.physics.raycast(ctx.level, origin, dir, limit, mask);
            if (h && typeof h.distance === 'number' && h.distance >= 0 && h.t >= -1) {
              best = {
                t: (h.t === undefined ? h.distance : h.t),
                point: h.point, normal: h.normal,
                distance: h.distance, collider: h.collider || null, ref: h.ref || null,
                enemy: null, headshot: false
              };
            } else if (h && h.point && isFinite(h.t) && h.t >= 0) {
              best = {
                t: h.t, point: h.point, normal: h.normal, distance: h.t,
                collider: h.collider || null, ref: h.ref || null, enemy: null, headshot: false
              };
            }
          }
        } catch (e) { logOnce('combat.world', e); }

        // enemigos
        try {
          if (ctx.enemies && typeof ctx.enemies.raycast === 'function') {
            var lim = best ? best.t : limit;
            var eh = ctx.enemies.raycast(origin, dir, lim, ignore);
            if (eh && (!best || eh.t < best.t)) {
              best = {
                t: eh.t, point: eh.point, normal: eh.normal, distance: eh.t,
                collider: null, ref: eh.enemy, enemy: eh.enemy, headshot: !!eh.headshot
              };
            }
          }
        } catch (e2) { logOnce('combat.enemies', e2); }

        return best;
      };

      ctx.combat.damage = function (target, amount, hitInfo) {
        if (!target) return { killed: false, hp: 0, applied: 0 };
        // jugador
        if (target === ctx.player && typeof target.damage === 'function') {
          var srcPos = hitInfo && hitInfo.point ? hitInfo.point : null;
          var kind = hitInfo && hitInfo.kind ? hitInfo.kind : 'unknown';
          var r = target.damage(amount, srcPos, kind);
          r = r || {};
          return { killed: !!r.died, hp: (typeof r.hp === 'number' ? r.hp : target.health), applied: r.applied || 0 };
        }
        // enemigo (los enemigos notifican la muerte por sí mismos)
        if (ctx.enemies && typeof ctx.enemies.damage === 'function' && target.type && target.alive !== undefined) {
          var er = call(ctx.enemies, 'damage', target, amount, hitInfo);
          if (er) return { killed: !!er.killed, hp: (typeof er.hp === 'number' ? er.hp : target.hp), applied: er.applied || 0 };
          return { killed: false, hp: target.hp, applied: 0 };
        }
        // genérico
        var amt = Number(amount) || 0;
        if (typeof target.hp === 'number') target.hp -= amt;
        return { killed: false, hp: target.hp, applied: amt };
      };

      ctx.combat.areaDamage = function (pos, radius, amount, opts) {
        if (ctx.enemies && typeof ctx.enemies.areaDamage === 'function') {
          var r = call(ctx.enemies, 'areaDamage', pos, radius, amount, opts);
          return (typeof r === 'number') ? r : 0;
        }
        return 0;
      };

      ctx.combat.noise = function (pos, radius, tag) {
        emit('noise', { pos: pos, radius: radius, tag: tag || 'impact' });
      };
    },

    /* ------------------------------------------------------------------
     * Cableado de eventos (§3.21 paso 18)
     * ------------------------------------------------------------------ */
    wire: function (ctx) {
      var add = BS.Util.addListener;

      // Pointer Lock
      if (BS.Input && BS.Input.onLockChange) {
        BS.Input.onLockChange(function (locked) {
          if (locked) {
            if (ctx.menu && ctx.menu.showClickCatch) ctx.menu.showClickCatch(false);
            if (Game.state === STATE.PAUSED && pauseWasLock) Game.resume();
          } else {
            if (Game.state === STATE.PLAYING || Game.state === STATE.TUTORIAL) {
              pauseWasLock = true;
              Game.pause('Ratón liberado — pulsa REANUDAR para continuar');
            }
          }
        });
      }
      if (BS.Input && BS.Input.onLockError) {
        BS.Input.onLockError(function () {
          if (ctx.menu && ctx.menu.showMessage) ctx.menu.showMessage('No se pudo capturar el ratón. Vuelve a hacer clic en unos segundos.');
        });
      }

      // Visibilidad (R4)
      if (add && typeof document !== 'undefined') {
        add(document, 'visibilitychange', function () {
          try {
            if (document.hidden) {
              if (BS.Input && BS.Input.clearAll) BS.Input.clearAll();
              if (Game.state === STATE.PLAYING || Game.state === STATE.TUTORIAL) {
                pauseWasLock = false;
                Game.pause('Pestaña en segundo plano');
              }
            }
          } catch (e) { /* noop */ }
        });
      }

      // Resize
      if (add) add(window, 'resize', function () { Game.onResize(); });

      // Contexto GL
      if (BS.GL && BS.GL.onContextLost) BS.GL.onContextLost(function (ev) { Game.onContextLost(ev); });
      if (BS.GL && BS.GL.onContextRestored) BS.GL.onContextRestored(function () { Game.onContextRestored(); });

      // Teclado global (F1 = overlay de depuración)
      if (add) {
        add(window, 'keydown', function (ev) {
          if (!ev || !ev.code) return;
          if (ev.code === 'F1') {
            Game._debugOn = !Game._debugOn;
            if (ctx.hud && ctx.hud.debugOverlay) ctx.hud.debugOverlay(Game._debugOn);
            if (ev.preventDefault) ev.preventDefault();
          }
        });
      }

      // Telemetría de disparo para precisión
      if (BS.Events && BS.Events.on) {
        BS.Events.on('weapon:fired', function () { Game.shotsFired++; }, 'game');
      }
    },

    /* ------------------------------------------------------------------
     * start() — de menú a partida
     * ------------------------------------------------------------------ */
    start: function (opts) {
      if (!ready) {
        if (!Game.init()) return false;
      }
      call(BS.Audio, 'init');
      call(BS.Audio, 'resume');
      Game.restartMission();
      // `opts` puede ser `true` o `{tutorial:true}` para arrancar en TUTORIAL.
      var asTutorial = !!(opts === true || (opts && opts.tutorial));
      Game._wasTutorial = asTutorial;
      Game.setState(asTutorial ? STATE.TUTORIAL : STATE.PLAYING);
      call(Game.ctx && Game.ctx.hud, 'setVisible', true);
      if (Game.ctx && Game.ctx.menu) {
        Game.ctx.menu.hide();
        if (BS.Input && !BS.Input.isLocked() && Game.ctx.menu.showClickCatch) {
          Game.ctx.menu.showClickCatch(true, 'CLIC PARA BLOQUEAR EL RATÓN');
        }
      }
      if (asTutorial) {
        call(Game.ctx && Game.ctx.hud, 'setTutorial', 1, TUT_STEPS.length, TUT_STEPS[0].text, TUT_STEPS[0].key);
        call(Game.ctx && Game.ctx.hud, 'notify', 'ENTRENAMIENTO — PRIMEROS PASOS', 3.0, '#ffb347');
      } else {
        call(Game.ctx && Game.ctx.hud, 'notify', 'MISIÓN K-7 — SEÑAL PERDIDA INICIADA', 3.0);
      }
      return true;
    },

    /** Arranca la misión directamente en modo entrenamiento (estado TUTORIAL). */
    startTutorial: function () { return Game.start({ tutorial: true }); },

    setState: function (s) {
      if (STATE_VALUES.indexOf(s) < 0) return Game.state;
      Game.state = s;
      emit('game:state', { state: s });
      return s;
    },

    getState: function () { return Game.state; },

    pause: function (reason) {
      if (Game.state !== STATE.PLAYING && Game.state !== STATE.TUTORIAL) return;
      Game._wasTutorial = (Game.state === STATE.TUTORIAL);
      Game.pauseReason = reason || '';
      Game.setState(STATE.PAUSED);
      acc = 0;
      if (BS.Input && BS.Input.clearAll) BS.Input.clearAll();
      if (Game.ctx && Game.ctx.menu) Game.ctx.menu.show('pause');
    },

    resume: function () {
      if (Game.state !== STATE.PAUSED) return;
      pauseWasLock = false;
      var back = (Game._wasTutorial && tutStep < TUT_STEPS.length) ? STATE.TUTORIAL : STATE.PLAYING;
      Game.setState(back);
      if (Game.ctx && Game.ctx.menu) {
        Game.ctx.menu.hide();
        if (BS.Input && !BS.Input.isLocked() && Game.ctx.menu.showClickCatch) {
          Game.ctx.menu.showClickCatch(true, 'CLIC PARA CONTINUAR');
        }
      }
    },

    restartCheckpoint: function () {
      var ctx = Game.ctx;
      if (!ctx) return;
      var wave = Game.currentWave;
      call(ctx.enemies, 'clear');
      call(ctx.projectiles, 'reset');
      if (ctx.fx) call(ctx.fx, 'reset');
      var spawn = (ctx.level && ctx.level.spawns && ctx.level.spawns.player) || CONFIG.FALLBACK_SPAWN;
      var pos = new Float32Array([spawn.pos[0], spawn.pos[1], spawn.pos[2]]);
      var p = ctx.player;
      if (p) {
        if (typeof p.respawn === 'function') call(p, 'respawn', pos, spawn.yaw);
        else { M.v3copy(p.pos, pos); if (typeof p.setHealth === 'function') p.setHealth(p.maxHealth || 100); p.isDead = false; }
      }
      call(ctx.weapons, 'reset');
      call(ctx.hud, 'clearBossBar');
      Game.boss = null;
      Game.setState(STATE.PLAYING);
      if (ctx.menu) ctx.menu.hide();
      if (wave >= 0) Game.spawnWave(wave);
      else if (Game.waves[0]) Game.spawnWave(0);
      call(ctx.hud, 'setVisible', true);
      call(ctx.hud, 'notify', 'OLEADA REINICIADA', 2.0, '#ffb347');
    },

    restartMission: function () {
      var ctx = Game.ctx;
      if (!ctx) return;
      call(ctx.enemies, 'reset');
      call(ctx.projectiles, 'reset');
      if (ctx.fx) call(ctx.fx, 'reset');
      call(ctx.weapons, 'fillAllAmmo');
      call(ctx.weapons, 'reset');

      // oleadas y objetivos a cero
      for (var i = 0; i < Game.waves.length; i++) {
        Game.waves[i].state = 'pending';
        Game.waves[i].spawned = 0;
      }
      Game.objectives = buildObjectives(ctx);
      Game.currentWave = -1;
      waveBetween = 0;
      Game.kills = 0; Game.shotsFired = 0; Game.shotsHit = 0; Game.headshots = 0;
      Game.missionTime = 0;
      Game.boss = null;
      ctx.time = 0;
      ctx.frameIndex = 0;
      call(ctx.hud, 'clearBossBar');

      // jugador al inicio
      var spawn = (ctx.level && ctx.level.spawns && ctx.level.spawns.player) || CONFIG.FALLBACK_SPAWN;
      var pos = new Float32Array([spawn.pos[0], spawn.pos[1], spawn.pos[2]]);
      var p = ctx.player;
      if (p) {
        if (typeof p.respawn === 'function') call(p, 'respawn', pos, spawn.yaw);
        else { M.v3copy(p.pos, pos); p.isDead = false; }
        if (typeof p.setHealth === 'function') p.setHealth(p.maxHealth || 100);
      }
      respawnPickups(0);
      refreshObjectiveHud();
      tutStep = 0; tutTime = 0;
      if (p && p.pos) M.v3copy(tutStart, p.pos);

      /* Volver a jugar: sin esto el estado se queda en 'dead' (o el que fuese)
       * y el botón "REINICIAR MISIÓN" de la pantalla de muerte no reanuda la
       * partida. Limpiamos también el input acumulado y mostramos el HUD. */
      Game.setState(STATE.PLAYING);
      acc = 0;
      if (BS.Input && BS.Input.clearAll) BS.Input.clearAll();
      call(ctx.hud, 'setVisible', true);
      if (ctx.menu) ctx.menu.hide();
    },

    quitToMenu: function () {
      Game.setState(STATE.MENU);
      if (BS.Input && BS.Input.exitPointerLock) BS.Input.exitPointerLock();
      if (BS.Input && BS.Input.clearAll) BS.Input.clearAll();
      var ctx = Game.ctx;
      if (ctx) {
        call(ctx.enemies, 'clear');
        call(ctx.projectiles, 'reset');
        call(ctx.hud, 'setVisible', false);
        if (ctx.menu) ctx.menu.show('main');
      }
      if (BS.Audio && BS.Audio.stopAll) BS.Audio.stopAll(0.3);
    },

    /* ------------------------------------------------------------------
     * Progresión
     * ------------------------------------------------------------------ */
    setObjectiveDone: function (id, byGame) {
      var list = Game.objectives || [];
      for (var i = 0; i < list.length; i++) {
        if (list[i].id !== id || list[i].done) continue;
        list[i].done = true;
        list[i].hold = list[i].holdTime;
        refreshObjectiveHud();
        call(Game.ctx && Game.ctx.hud, 'notify', 'OBJETIVO CUMPLIDO: ' + list[i].label, 3.0, '#79ffa8');
        call(Game.ctx && Game.ctx.hud, 'setPrompt', null);
        emit('objective:updated', { text: list[i].label, done: 1, total: 1, id: id });
        break;
      }
    },

    objectivesDoneCount: function () {
      var list = Game.objectives || [], n = 0;
      for (var i = 0; i < list.length; i++) if (list[i].done) n++;
      return n;
    },

    spawnWave: function (index) {
      index = index | 0;
      var w = Game.waves[index];
      if (!w) return 0;
      var count = 0;
      var ctx = Game.ctx;
      if (ctx && ctx.enemies && typeof ctx.enemies.spawnWave === 'function') {
        count = call(ctx.enemies, 'spawnWave', index) | 0;
      }
      w.state = 'active';
      w.spawned = count;
      Game.currentWave = index;
      waveBetween = 0;
      respawnPickups(index);
      call(ctx && ctx.hud, 'setWaveText', w.label, count + ' ANFITRIONES', 3.2);
      emit('wave:started', { index: index, count: count });
      BS.Log.info('BS.Game.spawnWave(' + index + '): ' + count + ' enemigos');
      return count;
    },

    onEnemyKilled: function (enemy, byPlayer) {
      Game.kills++;
      var name = '';
      try { name = (BS.Enemies && BS.Enemies.DEFS && BS.Enemies.DEFS[enemy.type] && BS.Enemies.DEFS[enemy.type].name) || enemy.type; }
      catch (e) { name = enemy && enemy.type ? enemy.type : 'ANFITRIÓN'; }
      if (enemy && enemy.variant === 'prime') {
        name = name + ' [JEFE]';
        call(Game.ctx && Game.ctx.hud, 'clearBossBar');
        Game.boss = null;
      }
      call(Game.ctx && Game.ctx.hud, 'killFeedLine',
        (byPlayer ? '' : '· ') + name.toUpperCase() + ' ELIMINADO', byPlayer ? '#7fe7ff' : '#6f9aa8');
    },

    checkVictory: function () {
      var w = Game.waves || [];
      if (!w.length) return false;
      for (var i = 0; i < w.length; i++) if (w[i].state !== 'cleared') return false;
      return true;
    },

    victory: function () {
      if (Game.state === STATE.VICTORY) return;
      Game.setState(STATE.VICTORY);
      acc = 0;
      if (BS.Input && BS.Input.exitPointerLock) BS.Input.exitPointerLock();
      var acc01 = Game.shotsFired > 0 ? (Game.shotsHit / Game.shotsFired) : 0;
      var ctx = Game.ctx;
      if (ctx && ctx.menu) {
        if (ctx.menu.setVictoryInfo) ctx.menu.setVictoryInfo({ time: Game.missionTime, kills: Game.kills, accuracy: acc01, headshots: Game.headshots });
        ctx.menu.show('victory');
      }
      if (ctx && ctx.hud) { call(ctx.hud, 'setVisible', false); }
      if (BS.Audio && BS.Audio.play) call(BS.Audio, 'play', 'kill_confirm');
      emit('game:victory', {});
    },

    die: function () {
      if (Game.state === STATE.DEAD || Game.state === STATE.VICTORY) return;
      Game.setState(STATE.DEAD);
      acc = 0;
      if (BS.Input && BS.Input.exitPointerLock) BS.Input.exitPointerLock();
      var ctx = Game.ctx;
      if (ctx && ctx.menu) {
        if (ctx.menu.setDeathInfo) ctx.menu.setDeathInfo({ wave: Game.currentWave, kills: Game.kills, time: Game.missionTime });
        ctx.menu.show('dead');
      }
      if (BS.Audio && BS.Audio.play) call(BS.Audio, 'play', 'heartbeat');
    },

    /* ------------------------------------------------------------------
     * Paso de simulación (§3.21 updateFixed)
     * ------------------------------------------------------------------ */
    updateFixed: function (dt) {
      var ctx = Game.ctx;
      if (!ctx) return;
      dt = Number(dt) || FIXED_DT;

      try {
        ctx.time += dt;
        ctx.frameIndex = (ctx.frameIndex | 0) + 1;
        Game.missionTime += dt;

        if (ctx.player && typeof ctx.player.update === 'function') ctx.player.update(dt);
        if (ctx.weapons && typeof ctx.weapons.update === 'function') ctx.weapons.update(dt);
        if (ctx.enemies && typeof ctx.enemies.update === 'function') ctx.enemies.update(dt);
        if (ctx.projectiles && typeof ctx.projectiles.update === 'function') ctx.projectiles.update(dt);
        if (ctx.pickups && typeof ctx.pickups.update === 'function') ctx.pickups.update(dt);

        updateWaves(dt);
        updateTutorial(dt);
        updateBossBar();

        if (ctx.fx && typeof ctx.fx.update === 'function') ctx.fx.update(dt);
        if (ctx.audio && typeof ctx.audio.update === 'function') ctx.audio.update(dt);

        updateAudioListener();
        updateCamera();
        checkDeath();
      } catch (e) {
        logOnce('updateFixed', e);
      }
    },

    /** Paso de simulación aislado (preferido por BS.Debug.stepFrames). */
    stepFixed: function (dt) { Game.updateFixed(typeof dt === 'number' && isFinite(dt) ? dt : FIXED_DT); },

    /* ------------------------------------------------------------------
     * Bucle principal (§5.2)
     * ------------------------------------------------------------------ */
    frame: function (nowMs, injectedSteps) {
      var ctx = Game.ctx;
      if (!ctx) return;
      var now = (typeof nowMs === 'number' && isFinite(nowMs)) ? nowMs * 0.001 : BS.Util.now();
      var dt = now - lastTime;
      lastTime = now;
      if (!(dt >= 0) || dt > MAX_FRAME_GAP) { dt = 0; acc = 0; }
      dt = Math.min(dt, DT_MAX_FRAME);

      try { if (BS.Input && BS.Input.beginFrame) BS.Input.beginFrame(); } catch (e) { /* noop */ }

      var simulating = (Game.state === STATE.PLAYING || Game.state === STATE.TUTORIAL);
      if (simulating) {
        if (injectedSteps) {
          for (var s = 0; s < injectedSteps; s++) Game.updateFixed(FIXED_DT);
          acc = 0;
        } else {
          acc += dt;
          var steps = 0;
          while (acc >= FIXED_DT && steps < MAX_STEPS) {
            Game.updateFixed(FIXED_DT);
            acc -= FIXED_DT;
            steps++;
          }
          if (steps === MAX_STEPS) acc = 0;   // evitar "spiral of death"
        }
      } else {
        acc = 0;
      }

      try { if (ctx.menu && ctx.menu.update) ctx.menu.update(dt); } catch (e2) { /* noop */ }
      try { if (ctx.hud && ctx.hud.update) ctx.hud.update(dt); } catch (e3) { /* noop */ }

      Game.renderFrame(dt);

      try { if (BS.Input && BS.Input.endFrame) BS.Input.endFrame(); } catch (e4) { /* noop */ }
    },

    renderFrame: function (dt) {
      var ctx = Game.ctx;
      if (!ctx || !ctx.renderer) return;
      var R = ctx.renderer;
      try {
        R.setTime(ctx.time);
        var shake = null;
        if (ctx.fx && typeof ctx.fx.getShake === 'function') shake = call(ctx.fx, 'getShake');
        var p = ctx.player;
        var yaw = 0, pitch = 0, roll = 0;
        var pos = camPos;
        if (p && typeof p.eyePosition === 'function') {
          p.eyePosition(pos);
          yaw = p.yaw || 0; pitch = p.pitch || 0;
        } else if (R.camera && R.camera.pos) {
          pos = R.camera.pos; yaw = R.camera.yaw; pitch = R.camera.pitch;
        }
        var shakeScale = (ctx.settings ? Number(ctx.settings.screenShake) : 1) || 0;
        if (shake && shakeScale > 0) {
          pos[0] += shake.offsetX * shakeScale;
          pos[1] += shake.offsetY * shakeScale;
          roll = shake.roll * shakeScale;
        }

        R.beginFrame(clearColorOf(ctx));
        R.setCamera(pos, yaw, pitch, roll);
        R.updateFrustum();

        // linterna + luces
        var dir = M.v3fromYawPitch(tmpDir, yaw, pitch);
        flashPos[0] = pos[0] + dir[0] * 0.2;
        flashPos[1] = pos[1] + dir[1] * 0.2;
        flashPos[2] = pos[2] + dir[2] * 0.2;
        R.setFlashlight({
          on: true, pos: flashPos, dir: dir, color: [1.0, 0.97, 0.9],
          intensity: 1.15, range: 22, cosInner: 0.94, cosOuter: 0.78
        });
        var lights = [];
        if (ctx.fx && typeof ctx.fx.getLights === 'function') lights = call(ctx.fx, 'getLights') || [];
        R.setDynamicLights(lights);

        // nivel (chunks)
        var chunks = (ctx.level && ctx.level.chunks) || [];
        for (var i = 0; i < chunks.length; i++) {
          var c = chunks[i];
          if (c && c.mesh && R.isVisible(c.aabb)) R.push(c.mesh, IDENTITY, c.material);
        }
        // props con malla propia
        var props = (ctx.level && ctx.level.props) || [];
        for (var k = 0; k < props.length; k++) {
          var pr = props[k];
          if (pr && pr.mesh && R.isVisible(pr.aabb)) R.push(pr.mesh, pr.model || IDENTITY, pr.material);
        }

        if (ctx.enemies && typeof ctx.enemies.render === 'function') ctx.enemies.render(R);
        if (ctx.pickups && typeof ctx.pickups.render === 'function') ctx.pickups.render(R);
        if (ctx.projectiles && typeof ctx.projectiles.render === 'function') ctx.projectiles.render(R);

        if (ctx.fx) { call(ctx.fx, 'beginFrame'); call(ctx.fx, 'render', R); }

        /* Viewmodel del arma: debe encolarse DESPUÉS del mundo/enemigos/pickups/
         * proyectiles/FX y ANTES de R.flush(), porque es flush() quien ejecuta
         * el pase de viewmodel (limpieza de depth previa). Después de flush()
         * ya no hay pase, solo present(). */
        if (ctx.weapons && typeof ctx.weapons.renderViewmodel === 'function') {
          ctx.weapons.renderViewmodel(R, {
            eyePos: pos, yaw: yaw, pitch: pitch, roll: roll,
            bobPhase: (p && p.bobPhase) || 0,
            speed01: (p && p.speed) ? Math.min(1, p.speed / 4.4) : 0,
            dt: dt
          });
        }

        R.flush();
        if (ctx.hud && typeof ctx.hud.render === 'function') ctx.hud.render(dt);
        R.present();
      } catch (e) {
        logOnce('renderFrame', e);
      }
    },

    /* ------------------------------------------------------------------
     * Ajustes y calidad
     * ------------------------------------------------------------------ */
    applySettings: function (s) {
      var ctx = Game.ctx;
      if (!ctx) return;
      if (s) {
        var t = ctx.settings;
        for (var k in s) if (Object.prototype.hasOwnProperty.call(s, k)) t[k] = s[k];
      }
      var t2 = ctx.settings;
      try {
        if (BS.Input) {
          if (BS.Input.setSensitivity) BS.Input.setSensitivity(t2.sensitivity);
          if (BS.Input.setInvertY) BS.Input.setInvertY(t2.invertY);
        }
        if (BS.Audio) {
          if (BS.Audio.setMasterVolume) BS.Audio.setMasterVolume(t2.volumeMaster);
          if (BS.Audio.setSfxVolume) BS.Audio.setSfxVolume(t2.volumeSfx);
          if (BS.Audio.setMusicVolume) BS.Audio.setMusicVolume(t2.volumeMusic);
        }
        if (ctx.renderer) {
          if (ctx.renderer.setFov) ctx.renderer.setFov(t2.fov);
          var low = Game.isLowQuality();
          if (ctx.renderer.setPostFx) ctx.renderer.setPostFx(low ? false : !!t2.postFx);
          if (ctx.renderer.setResolutionScale && !low) ctx.renderer.setResolutionScale(t2.resolutionScale);
        }
        if (BS.FX && BS.FX.setParticleBudget) BS.FX.setParticleBudget(qualityValue('particleBudget'));
        if (ctx.hud && ctx.hud.showCrosshair) ctx.hud.showCrosshair(t2.crosshair !== 'none');
        if (BS.Util.saveSettings) BS.Util.saveSettings(t2);
        /* quality='auto' NO se ignora: se re-resuelve con el hardware actual
         * (resolveQuality pliega el ajuste del usuario y la detección de GPU).
         * Ignorarlo dejaba la calidad congelada en el valor anterior: elegir
         * AUTO en el menú no volvía a 'high'/'medium'/'low' según la máquina,
         * y el test menu:settings (que restaura quality='auto') contaminaba
         * ctx.quality con su 'medium' temporal. */
        Game.applyQuality(resolveQuality(t2));
      } catch (e) { logOnce('applySettings', e); }
    },

    applyQuality: function (q) {
      if (q !== 'low' && q !== 'medium' && q !== 'high') return;
      var ctx = Game.ctx;
      if (!ctx) { return; }
      ctx.quality = q;
      try {
        if (ctx.renderer) {
          if (ctx.renderer.setQuality) ctx.renderer.setQuality(q);
          if (ctx.renderer.setPostFx) ctx.renderer.setPostFx(q === 'low' ? false : !!(ctx.settings && ctx.settings.postFx));
          if (ctx.renderer.setMaxDynamicLights) ctx.renderer.setMaxDynamicLights(q === 'low' ? CONFIG.LIGHT_BUDGET_LOW : CONFIG.LIGHT_BUDGET_HIGH);
          if (ctx.renderer.setResolutionScale && q !== 'low') ctx.renderer.setResolutionScale(ctx.settings ? ctx.settings.resolutionScale : 1.0);
        }
        if (BS.Textures && BS.Textures.setTextureSize) BS.Textures.setTextureSize(qualityValue('textureSize'));
        if (BS.FX && BS.FX.setParticleBudget) BS.FX.setParticleBudget(qualityValue('particleBudget'));
        if (BS.Audio && BS.Audio.setVoiceBudget) BS.Audio.setVoiceBudget(qualityValue('voiceBudget'));
      } catch (e) { logOnce('applyQuality', e); }
      emit('quality:changed', { quality: q });
      return q;
    },

    setFpsCap: function (n) { Game.fpsCap = Math.max(0, n | 0); },

    /* ------------------------------------------------------------------
     * Resize y contexto perdido
     * ------------------------------------------------------------------ */
    onResize: function () {
      var ctx = Game.ctx;
      if (!ctx) return;
      call(ctx.renderer, 'resizeToDisplay');
      call(ctx.hud, 'resize');
    },

    onContextLost: function () {
      contextLost = true;
      acc = 0;
      if (Game.state === STATE.PLAYING || Game.state === STATE.TUTORIAL) {
        pauseWasLock = false;
        Game.pause('Contexto WebGL perdido — restaurando GPU');
      }
      if (Game.ctx && Game.ctx.menu) Game.ctx.menu.showMessage('RESTAURANDO GPU…', 30);
    },

    onContextRestored: function () {
      var ctx = Game.ctx;
      contextLost = false;
      try {
        call(BS.Textures, 'rebuild');
        call(ctx && ctx.renderer, 'rebuild');
        if (ctx && ctx.level && typeof ctx.level.rebuild === 'function') ctx.level.rebuild(ctx);
        if (ctx && ctx.enemies && typeof ctx.enemies.rebuild === 'function') ctx.enemies.rebuild(ctx);
        if (ctx && ctx.pickups && typeof ctx.pickups.rebuild === 'function') ctx.pickups.rebuild(ctx);
        if (BS.FX && typeof BS.FX.dispose === 'function') { /* la reconstrucción de FX es perezosa */ }
        if (ctx && ctx.weapons && typeof ctx.weapons.rebuild === 'function') ctx.weapons.rebuild(ctx);
        if (ctx && ctx.projectiles && typeof ctx.projectiles.rebuild === 'function') ctx.projectiles.rebuild(ctx);
      } catch (e) { logOnce('contextRestored', e); }
      if (ctx && ctx.menu) ctx.menu.showMessage('GPU RESTAURADA', 2.0);
    },

    /* ------------------------------------------------------------------
     * Diagnóstico
     * ------------------------------------------------------------------ */
    isContextLost: function () { return contextLost; },
    missionOf: function () { return Game.ctx && Game.ctx.level ? Game.ctx.level.data : null; },
    waveState: function (i) {
      var w = Game.waves[i | 0];
      return w ? w.state : null;
    },
    accuracy: function () { return Game.shotsFired > 0 ? (Game.shotsHit / Game.shotsFired) : 0; },

    /* ¿La calidad EFECTIVA es 'low'? Usa ctx.quality ya resuelto por
     * resolveQuality (ajuste del usuario + detección automática), nunca el
     * ajuste crudo de settings.quality, que podría seguir en 'auto' y dejar
     * sin efecto la degradación en rasterizador software. Lo usan
     * qualityValue() y applySettings(). */
    isLowQuality: function () { return !!(Game.ctx && Game.ctx.quality === 'low'); }
  };

  /* Los campos game.shotsHit los incrementan las armas; aquí se exponen con
   * un contador propio en caso de que el LOTE B no esté presente. */
  Game.shotsHitGetter = function () { return Game.shotsHit; };

  BS.Game = Game;

  /* ======================================================================
   * Tests registrados (§8.7)
   * ==================================================================== */

  /* --- game:states: la máquina tiene los 9 estados y transiciona --- */
  if (BS.Debug && typeof BS.Debug.register === 'function') {
    BS.Debug.register('game:states', function () {
      var ok = true, notes = [];
      var saved = Game.state;
      try {
        var need = ['boot', 'loading', 'menu', 'tutorial', 'playing', 'paused', 'dead', 'victory', 'error'];
        for (var i = 0; i < need.length; i++) {
          if (STATE_VALUES.indexOf(need[i]) < 0) { ok = false; notes.push('falta estado ' + need[i]); }
        }
        if (Object.keys(STATE).length !== need.length) { ok = false; notes.push('STATE tiene ' + Object.keys(STATE).length + ' claves'); }

        // transiciones válidas
        Game.setState('playing');
        if (Game.getState() !== 'playing') { ok = false; notes.push('setState(playing)'); }
        Game.setState('paused');
        if (Game.getState() !== 'paused') { ok = false; notes.push('setState(paused)'); }
        Game.setState('inventado');
        if (Game.getState() !== 'paused') { ok = false; notes.push('aceptó un estado inválido'); }
      } catch (e) {
        ok = false; notes.push('excepción: ' + (e && e.message ? e.message : e));
      } finally {
        Game.state = saved;
      }
      return { ok: ok, notas: notes, estados: STATE_VALUES.length, actual: Game.state };
    });

    /* --- waves:all: 5 oleadas, escalado y disparadores --- */
    BS.Debug.register('waves:all', function () {
      var ok = true, notes = [];
      try {
        var waves = DEFAULT_WAVES;
        if (waves.length !== 5) { ok = false; notes.push('DEFAULT_WAVES=' + waves.length); }
        // los maxAlive respetan el presupuesto del presupuesto de enemigos vivos (≤20)
        for (var i = 0; i < waves.length; i++) {
          var ma = waves[i].maxAlive | 0;
          if (ma < 1 || ma > 20) { ok = false; notes.push('maxAlive oleada ' + i + '=' + ma); }
        }
        // la escalada de maxAlive de Enemies es min(8+2w,20)
        if (BS.Enemies && BS.Enemies.maxAliveForWave) {
          var m1 = BS.Enemies.maxAliveForWave(1), m5 = BS.Enemies.maxAliveForWave(5);
          if (m1 !== 10 || m5 !== 18) { ok = false; notes.push('maxAliveForWave ' + m1 + '/' + m5); }
        }
        // los disparadores se cumplen en función de los objetivos
        var savedObj = Game.objectives;
        Game.objectives = [
          { id: 'reach_atrium', done: true },
          { id: 'power', done: false },
          { id: 'beacon', done: false }
        ];
        if (!waveTriggerMet({ def: { trigger: { objectives: ['reach_atrium'] } } })) { ok = false; notes.push('trigger objectives'); }
        if (waveTriggerMet({ def: { trigger: { requiresObjectives: ['beacon'] } } })) { ok = false; notes.push('requiresObjectives no aplicado'); }
        if (!waveTriggerMet({ def: {} })) { ok = false; notes.push('sin trigger debería estar listo'); }
        Game.objectives = savedObj;

        // construcción de runtime de oleadas
        var rt = buildWaves({ level: { waves: DEFAULT_WAVES } });
        if (rt.length !== 5) { ok = false; notes.push('buildWaves=' + rt.length); }
      } catch (e) {
        ok = false; notes.push('excepción: ' + (e && e.message ? e.message : e));
      }
      return { ok: ok, notas: notes, oleadas: DEFAULT_WAVES.length };
    });

    /* --- game:determinism: mismo input → misma posición final --- */
    BS.Debug.register('game:determinism', function () {
      var ctx = Game.ctx;
      if (!ctx || !ctx.player || !ctx.player.pos) {
        return { ok: true, skipped: 'sin jugador (LOTE B no cargado)', determinista: null };
      }
      var ok = true, notes = [];
      var p = ctx.player;

      // --- guardar estado que vamos a tocar ---
      var sv = {
        pos: new Float32Array([p.pos[0], p.pos[1], p.pos[2]]),
        vel: p.vel ? new Float32Array([p.vel[0], p.vel[1], p.vel[2]]) : null,
        yaw: p.yaw, pitch: p.pitch, health: p.health, isDead: p.isDead, godMode: p.godMode,
        state: Game.state, currentWave: Game.currentWave, missionTime: Game.missionTime,
        waveStates: []
      };
      for (var i = 0; i < Game.waves.length; i++) sv.waveStates.push(Game.waves[i].state);
      var enemies = (ctx.enemies && ctx.enemies.list) ? ctx.enemies.list : null;
      var savedEnemies = enemies ? enemies.slice() : null;

      function runOnce() {
        if (enemies) enemies.length = 0;                       // congelar IA
        for (var j = 0; j < Game.waves.length; j++) Game.waves[j].state = 'cleared';
        Game.currentWave = -1;
        call(ctx.projectiles, 'reset');
        p.pos[0] = 0; p.pos[1] = 1.0; p.pos[2] = 0;
        if (p.vel) { p.vel[0] = 0; p.vel[1] = 0; p.vel[2] = 0; }
        p.yaw = 0; p.pitch = 0; p.isDead = false; p.godMode = true;
        if (typeof p.setHealth === 'function') p.setHealth(100);
        if (BS.Input) { BS.Input.clearAll(); BS.Input.simulateKey('KeyW', true); }
        for (var k = 0; k < 120; k++) Game.updateFixed(FIXED_DT);
        var out = [p.pos[0], p.pos[1], p.pos[2]];
        if (BS.Input) BS.Input.clearAll();
        return out;
      }

      var err = 0;
      try {
        var a = runOnce();
        var b = runOnce();
        for (var m = 0; m < 3; m++) err = Math.max(err, Math.abs(a[m] - b[m]));
        if (!(err < 1e-6)) { ok = false; notes.push('divergencia=' + err.toExponential(2)); }
      } catch (e) {
        ok = false; notes.push('excepción: ' + (e && e.message ? e.message : e));
      } finally {
        // --- restaurar todo ---
        p.pos[0] = sv.pos[0]; p.pos[1] = sv.pos[1]; p.pos[2] = sv.pos[2];
        if (p.vel && sv.vel) { p.vel[0] = sv.vel[0]; p.vel[1] = sv.vel[1]; p.vel[2] = sv.vel[2]; }
        p.yaw = sv.yaw; p.pitch = sv.pitch; p.isDead = sv.isDead; p.godMode = sv.godMode;
        if (typeof p.setHealth === 'function') p.setHealth(sv.health);
        Game.state = sv.state; Game.missionTime = sv.missionTime;
        for (var n = 0; n < Game.waves.length; n++) Game.waves[n].state = sv.waveStates[n];
        Game.currentWave = sv.currentWave;
        if (enemies && savedEnemies) { enemies.length = 0; for (var q = 0; q < savedEnemies.length; q++) enemies.push(savedEnemies[q]); }
        else if (enemies) enemies.length = 0;
      }
      return { ok: ok, notas: notes, errorMax: err };
    });
  }

})(window.BS = window.BS || {});
