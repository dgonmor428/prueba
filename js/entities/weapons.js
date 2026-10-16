/* ===========================================================================
 * BLACKSITE: LAST SIGNAL  —  js/entities/weapons.js
 * ---------------------------------------------------------------------------
 * Propósito : sistema de armas del jugador. Tres armas con DEFS completos,
 *             spread acumulativo, retroceso, recarga cancelable, cambio de
 *             arma con animación, viewmodel procedural (malla propia generada
 *             con BS.Mesh), destello de boca, cartuchos y hitmarker vía HUD.
 * Depende de: js/core/util.js (BS.Math, BS.Events, BS.Log), js/render/mesh.js
 *             (BS.Mesh), js/render/renderer.js (BS.Renderer), js/core/textures.js
 *             (BS.Textures) y, en tiempo de ejecución, el `ctx` del juego
 *             (player, renderer, combat, hud, enemies, projectiles, fx, audio).
 * Expone    : BS.Weapons = { DEFS, create(ctx) }
 * Notas     : §3.14. La secuencia canónica de disparo hitscan se implementa
 *             tal cual, con TODOS los usos de ctx.* protegidos para que el
 *             sandbox del LOTE B funcione sin los módulos del LOTE C.
 *             NO llama a Player.update() ni a Physics.moveBox(): el jugador y
 *             BS.Game son quienes orquestan.
 * =========================================================================== */
(function (BS) {
  'use strict';

  var M = BS.Math;
  var DEG = Math.PI / 180;

  /* ======================================================================
   * Definición de las tres armas (§3.14 WeaponDef)
   * ==================================================================== */
  var DEFS = {
    /* 1 — pistola: precisión, disparo semiautomático, munición ligera. */
    1: {
      slot: 1, id: 'pistol', name: 'MK-7 "VECTOR"',
      ammoType: 'light', mode: 'semi', fireKind: 'hitscan',
      damage: 26, headshotMul: 1.8, pellets: 1, rpm: 320,
      magSize: 12, reserveMax: 120, startReserve: 60,
      reloadTime: 1.25, reloadEmptyExtra: 0.35, range: 90,
      baseSpread: 0.35, spreadPerShot: 0.9, spreadMax: 3.2, spreadRecover: 6.5,
      moveSpreadMul: 1.6, sprintSpreadMul: 2.6, crouchSpreadMul: 0.55, airSpreadMul: 2.2,
      recoilKick: 0.016, recoilYaw: 0.006, kickRecover: 9,
      moveSpeedMul: 1.0, swapTime: 0.45,
      viewmodel: {
        offset: [0.17, -0.16, -0.30], scale: 1.0,
        kickBack: 0.05, kickRot: 0.10, swayAmount: 0.02, bobAmount: 0.012,
        muzzleOffset: [0.17, -0.10, -0.62], muzzleFlashScale: 0.85
      },
      sfx: { fire: 'pistol', reload: 'reload_in', empty: 'empty_click', impact: 'hit_world' },
      hudColor: [1.0, 0.85, 0.4]
    },

    /* 2 — subfusil: automático, cadencia alta, poco daño por disparo. */
    2: {
      slot: 2, id: 'smg', name: 'VK-9 "HORNET"',
      ammoType: 'heavy', mode: 'auto', fireKind: 'hitscan',
      damage: 15, headshotMul: 1.7, pellets: 1, rpm: 760,
      magSize: 30, reserveMax: 240, startReserve: 120,
      reloadTime: 1.9, reloadEmptyExtra: 0.5, range: 70,
      baseSpread: 0.6, spreadPerShot: 0.55, spreadMax: 4.5, spreadRecover: 5.5,
      moveSpreadMul: 1.5, sprintSpreadMul: 2.4, crouchSpreadMul: 0.6, airSpreadMul: 2.0,
      recoilKick: 0.010, recoilYaw: 0.0045, kickRecover: 11,
      moveSpeedMul: 0.92, swapTime: 0.5,
      viewmodel: {
        offset: [0.16, -0.17, -0.34], scale: 1.0,
        kickBack: 0.035, kickRot: 0.07, swayAmount: 0.028, bobAmount: 0.016,
        muzzleOffset: [0.16, -0.11, -0.78], muzzleFlashScale: 0.8
      },
      sfx: { fire: 'smg', reload: 'reload_in', empty: 'empty_click', impact: 'hit_world' },
      hudColor: [0.9, 0.95, 1.0]
    },

    /* 3 — arma de brecha: lanza proyectiles con salpicadura amplia. */
    3: {
      slot: 3, id: 'breacher', name: 'AR-12 "ALCOTÁN"',
      ammoType: 'cell', mode: 'semi', fireKind: 'projectile',
      damage: 20, headshotMul: 1.5, pellets: 1, rpm: 90,
      magSize: 6, reserveMax: 30, startReserve: 12,
      reloadTime: 2.3, reloadEmptyExtra: 0.6, range: 60,
      baseSpread: 0.5, spreadPerShot: 1.4, spreadMax: 4.0, spreadRecover: 8,
      moveSpreadMul: 1.4, sprintSpreadMul: 2.2, crouchSpreadMul: 0.7, airSpreadMul: 1.8,
      recoilKick: 0.030, recoilYaw: 0.008, kickRecover: 6,
      moveSpeedMul: 0.85, swapTime: 0.7,
      projectile: {
        speed: 28, gravity: 12, splashRadius: 3.2, splashDamage: 65,
        radius: 0.28, life: 5, damage: 20, color: [0.55, 0.85, 1.0]
      },
      viewmodel: {
        offset: [0.15, -0.18, -0.32], scale: 1.0,
        kickBack: 0.09, kickRot: 0.16, swayAmount: 0.03, bobAmount: 0.02,
        muzzleOffset: [0.15, -0.10, -0.72], muzzleFlashScale: 1.15
      },
      sfx: { fire: 'plasma', reload: 'reload_in', empty: 'empty_click', impact: 'hit_world' },
      hudColor: [0.5, 0.85, 1.0]
    }
  };

  function num(v, d) {
    var n = +v;
    return isFinite(n) ? n : d;
  }

  /* ======================================================================
   * Material de respaldo (si BS.Textures todavía no está listo)
   * ==================================================================== */
  function fallbackMaterial(id, emissive) {
    return {
      id: id || 'mat_bs_fallback',
      map: null, normalMap: null, emissiveMap: null,
      uvScale: [1, 1], specular: emissive ? 0.2 : 0.4, normalStrength: 0,
      emissive: emissive ? [0.5, 0.85, 1] : [0, 0, 0], emissiveIntensity: emissive ? 1.2 : 0,
      blend: 'opaque', depthWrite: true, doubleSided: false, program: 'basic'
    };
  }

  function materialOf(id, emissive) {
    var T = BS.Textures;
    if (T && typeof T.getMaterial === 'function') {
      try {
        var m = T.getMaterial(id);
        if (m) return m;
      } catch (e) { /* noop */ }
    }
    return fallbackMaterial(id, emissive);
  }

  /* ======================================================================
   * Mallas del viewmodel (procedurales, sin dependencias externas)
   * ==================================================================== */
  function buildPistol(b) {
    b.color = [0.82, 0.84, 0.88];
    b.box([0, 0, -0.20], [0.070, 0.095, 0.34], [1, 1]);   // corredera
    b.box([0, -0.055, -0.02], [0.062, 0.055, 0.16], [1, 1]); // armazón
    b.color = [0.35, 0.36, 0.40];
    b.box([0, -0.135, 0.045], [0.055, 0.15, 0.075], [1, 1]);  // empuñadura
    b.box([0, -0.145, 0.045], [0.06, 0.02, 0.08], [1, 1]);    // base del cargador
    b.color = [0.55, 0.57, 0.62];
    b.box([0, 0.012, -0.40], [0.032, 0.034, 0.14], [1, 1]);   // cañón
    b.box([0, -0.06, -0.10], [0.020, 0.05, 0.04], [1, 1]);    // guardamonte
    b.color = [0.9, 0.9, 0.95];
    b.box([0, 0.058, -0.12], [0.014, 0.014, 0.16], [1, 1]);   // mira superior
  }

  function buildSmg(b) {
    b.color = [0.74, 0.77, 0.82];
    b.box([0, 0, -0.30], [0.072, 0.105, 0.52], [1, 1]);       // cuerpo
    b.color = [0.36, 0.38, 0.42];
    b.box([0, -0.145, 0.02], [0.052, 0.20, 0.085], [1, 1]);   // cargador
    b.box([0, -0.05, 0.20], [0.05, 0.075, 0.20], [1, 1], 0);  // culata
    b.box([0, -0.11, -0.06], [0.052, 0.135, 0.075], [1, 1]);  // empuñadura
    b.color = [0.55, 0.58, 0.63];
    b.box([0, 0.012, -0.62], [0.030, 0.032, 0.30], [1, 1]);   // cañón
    b.box([0, -0.075, -0.42], [0.045, 0.06, 0.13], [1, 1]);   // guardamanos
    b.color = [0.9, 0.9, 0.95];
    b.box([0, 0.066, -0.20], [0.014, 0.016, 0.24], [1, 1]);   // riel/ mira
  }

  function buildBreacher(b) {
    b.color = [0.66, 0.70, 0.76];
    b.box([0, 0, -0.26], [0.10, 0.12, 0.44], [1, 1]);         // caja gruesa
    b.color = [0.40, 0.42, 0.46];
    b.box([0, -0.11, 0.02], [0.075, 0.17, 0.10], [1, 1]);     // empuñadura
    b.box([0, 0.02, 0.06], [0.085, 0.09, 0.16], [1, 1]);      // culata maciza
    b.color = [0.58, 0.61, 0.66];
    b.box([0, 0.01, -0.55], [0.07, 0.07, 0.22], [1, 1]);      // racimo de barril
    b.box([0, 0.01, -0.70], [0.085, 0.085, 0.06], [1, 1]);    // boca ancha
    b.box([0, -0.085, -0.46], [0.06, 0.07, 0.14], [1, 1]);    // bomba/ depósito
  }

  function buildGlowBreacher(b) {
    b.color = [1, 1, 1];
    b.emissive = 1;
    b.box([0, 0.075, -0.34], [0.03, 0.012, 0.10], [1, 1]);    // testigo superior
    b.box([0, 0.02, -0.735], [0.05, 0.05, 0.012], [1, 1]);    // anillo de boca
    b.emissive = 0;
  }

  function buildViewmodel(cfgId) {
    if (!BS.Mesh || typeof BS.Mesh.create !== 'function') return { main: null, glow: null };
    var b = BS.Mesh.create();
    if (cfgId === 'pistol') buildPistol(b);
    else if (cfgId === 'smg') buildSmg(b);
    else buildBreacher(b);
    var main = null, glow = null;
    try { main = BS.Mesh.toGL(b); } catch (e) { main = null; }
    if (cfgId === 'breacher') {
      var gb = BS.Mesh.create();
      buildGlowBreacher(gb);
      try { glow = BS.Mesh.toGL(gb); } catch (e2) { glow = null; }
    }
    return { main: main, glow: glow };
  }

  function buildProjectileMesh() {
    if (!BS.Mesh || typeof BS.Mesh.create !== 'function') return null;
    var b = BS.Mesh.create();
    b.color = [0.75, 0.92, 1.0];
    b.emissive = 1;
    b.sphere([0, 0, 0], 0.12, 8, 6);
    b.emissive = 0;
    try { return BS.Mesh.toGL(b); } catch (e) { return null; }
  }

  /* ======================================================================
   * create(ctx) -> WeaponSystem
   * ==================================================================== */
  function create(ctx) {
    ctx = ctx || {};

    /* ---- estado de la máquina de armas ---- */
    var time = 0;
    var currentSlot = 1;
    var slotStates = {};
    var current = null;
    var emptyClickAt = -99;
    var vmKick = 0;

    /* buffers de trabajo reutilizados (sin `new` en el hot path) */
    var _origin = new Float32Array(3);
    var _dir = new Float32Array(3);
    var _muzzle = new Float32Array(3);
    var _camPos = new Float32Array(3);
    var _end = new Float32Array(3);
    var _eye = new Float32Array(3);

    /* viewmodels y materiales */
    var viewmodels = {};
    var materials = {};

    function level() { return ctx.level || null; }

    function player() { return ctx.player || null; }

    function maskWorld() {
      var P = BS.Physics;
      if (P && P.MASK) return P.MASK.WORLD | P.MASK.ENEMY | P.MASK.PROP;
      return 0;
    }

    function emit(name, payload) {
      var ev = ctx.events || BS.Events;
      if (ev && typeof ev.emit === 'function') {
        try { ev.emit(name, payload); } catch (e) { /* noop */ }
      }
    }

    function audioPlay(name, pos) {
      if (!name) return;
      var A = ctx.audio || BS.Audio;
      if (A && typeof A.play === 'function') {
        try { A.play(name, pos ? { pos: pos } : undefined); } catch (e) { /* noop */ }
      }
    }

    /* ---- efectos (protegidos) ---- */
    function fxImpact(pos, normal, kind) {
      var F = ctx.fx;
      if (F && typeof F.impact === 'function') { try { F.impact(pos, normal, kind); } catch (e) { /* noop */ } }
    }
    function fxTracer(from, to, color, width, life) {
      var F = ctx.fx;
      if (F && typeof F.tracer === 'function') { try { F.tracer(from, to, color, width, life); } catch (e) { /* noop */ } }
    }
    function fxMuzzle(pos, dir, scale) {
      var F = ctx.fx;
      if (F && typeof F.muzzleFlash === 'function') { try { F.muzzleFlash(pos, dir, scale); } catch (e) { /* noop */ } }
    }
    function fxLight(pos, color, radius, intensity, duration) {
      var F = ctx.fx;
      if (F && typeof F.tempLight === 'function') { try { F.tempLight(pos, color, radius, intensity, duration); } catch (e) { /* noop */ } }
    }
    function hudHitmarker(killed, headshot) {
      var H = ctx.hud;
      if (H && typeof H.hitmarker === 'function') { try { H.hitmarker(killed, headshot); } catch (e) { /* noop */ } }
    }

    /* ---- mediadores de combate (con respaldo a BS.Physics) ---- */
    function raycastCombat(origin, dir, range, mask) {
      var C = ctx.combat;
      if (C && typeof C.raycast === 'function') {
        try { return C.raycast(origin, dir, range, mask); } catch (e) { /* cae al respaldo */ }
      }
      var P = ctx.physics || BS.Physics;
      var lv = level();
      if (P && lv && typeof P.raycast === 'function') {
        try {
          var h = P.raycast(lv, origin, dir, range, mask);
          if (h) {
            return {
              t: h.t, point: h.point, normal: h.normal, distance: h.distance,
              collider: h.collider || null, ref: h.ref || null, enemy: null, headshot: false
            };
          }
        } catch (e2) { /* noop */ }
      }
      return null;
    }

    function damageTarget(target, amount, info) {
      var C = ctx.combat;
      if (C && typeof C.damage === 'function') {
        try { return C.damage(target, amount, info) || {}; } catch (e) { /* noop */ }
      }
      if (ctx.enemies && typeof ctx.enemies.damage === 'function') {
        try { return ctx.enemies.damage(target, amount, info) || {}; } catch (e2) { /* noop */ }
      }
      return { killed: false, hp: 0, applied: 0 };
    }

    /* ==================================================================
     * Estados por ranura
     * ================================================================ */
    function makeState(def, unlocked, withAmmo) {
      return {
        slot: def.slot, id: def.id, name: def.name,
        ammoInMag: withAmmo ? def.magSize : 0,
        magSize: def.magSize,
        reserve: withAmmo ? def.startReserve : 0,
        reserveMax: def.reserveMax,
        ammoType: def.ammoType,
        isReloading: false, reloadProgress: 0, reloadElapsed: 0, reloadDuration: 0,
        isSwapping: false, swapProgress: 0, swapElapsed: 0, swapDuration: 0,
        fireMode: (def.mode === 'auto') ? 'auto' : 'semi',
        canFire: false, nextFireAt: 0,
        spreadDeg: def.baseSpread, spreadAccum: 0, lastShotAt: -99,
        unlocked: !!unlocked
      };
    }

    function reset() {
      slotStates = {};
      for (var s = 1; s <= 3; s++) {
        var def = DEFS[s];
        if (!def) continue;
        slotStates[s] = makeState(def, s === 1, s === 1);
      }
      currentSlot = 1;
      current = slotStates[1];
      time = 0;
      vmKick = 0;
      emptyClickAt = -99;
      if (current) current.nextFireAt = 0;
    }

    /* ==================================================================
     * Cambio de arma / recarga
     * ================================================================ */
    function hasWeapon(slot) {
      var st = slotStates[slot];
      return !!(st && st.unlocked);
    }

    function switchTo(slot) {
      slot = slot | 0;
      var st = slotStates[slot];
      if (!st || !st.unlocked) return false;
      if (slot === currentSlot && !(current && current.isSwapping)) {
        /* re-pulsar el arma actual cancela la recarga */
        cancelReload();
        return true;
      }
      var def = DEFS[slot];
      /* al cambiar se cancela la recarga y se reinicia la animación de subida */
      st.isReloading = false; st.reloadProgress = 0; st.reloadElapsed = 0;
      st.isSwapping = true; st.swapElapsed = 0; st.swapProgress = 0;
      st.swapDuration = def.swapTime || 0.4;
      st.spreadAccum = 0;
      currentSlot = slot;
      current = st;
      audioPlay(def.sfx ? def.sfx.reload : null, null);
      return true;
    }

    function unlockedSlots() {
      var out = [];
      for (var s = 1; s <= 3; s++) if (slotStates[s] && slotStates[s].unlocked) out.push(s);
      return out;
    }

    function nextWeapon() {
      var list = unlockedSlots();
      if (list.length < 2) return;
      var i = list.indexOf(currentSlot);
      switchTo(list[(i + 1) % list.length]);
    }

    function prevWeapon() {
      var list = unlockedSlots();
      if (list.length < 2) return;
      var i = list.indexOf(currentSlot);
      switchTo(list[(i - 1 + list.length) % list.length]);
    }

    function cancelReload() {
      if (current && current.isReloading) {
        current.isReloading = false;
        current.reloadProgress = 0;
        current.reloadElapsed = 0;
        audioPlay('reload_out', null);
      }
    }

    function reload() {
      var st = current;
      if (!st || !st.unlocked) return false;
      if (st.isReloading || st.isSwapping) return false;
      if (st.ammoInMag >= st.magSize) return false;
      if (st.reserve <= 0) { audioPlay('empty_click', null); return false; }
      var def = DEFS[st.slot];
      st.isReloading = true;
      st.reloadElapsed = 0;
      st.reloadProgress = 0;
      st.reloadDuration = (def.reloadTime || 1.5) + ((st.ammoInMag <= 0) ? (def.reloadEmptyExtra || 0) : 0);
      audioPlay(def.sfx ? def.sfx.reload : 'reload_in', null);
      return true;
    }

    function finishReload(def, st) {
      st.isReloading = false;
      st.reloadProgress = 0;
      st.reloadElapsed = 0;
      var need = st.magSize - st.ammoInMag;
      var take = Math.min(need, st.reserve);
      st.ammoInMag += take;
      st.reserve -= take;
      emit('weapon:reloaded', { slot: st.slot });
    }

    /* ==================================================================
     * Puntería y spread
     * ================================================================ */
    function spreadMultiplier(def) {
      var p = player();
      if (!p) return 1;
      if (!p.isGrounded) return def.airSpreadMul;
      if (p.isSprinting) return def.sprintSpreadMul;
      if (p.isCrouching) return def.crouchSpreadMul;
      if (num(p.speed, 0) > 0.6) return def.moveSpreadMul;
      return 1;
    }

    function computeSpread(def, st) {
      var s = def.baseSpread * spreadMultiplier(def) + st.spreadAccum;
      return s > def.spreadMax ? def.spreadMax : s;
    }

    function playerEye(out) {
      var p = player();
      if (p && typeof p.eyePosition === 'function') {
        try { return p.eyePosition(out); } catch (e) { /* noop */ }
      }
      out[0] = 0; out[1] = 1.55; out[2] = 0;
      return out;
    }

    function aimDir(def, st, out) {
      var spreadRad = num(st.spreadDeg, def.baseSpread) * DEG;
      var gx = M.gaussian() * 0.5, gy = M.gaussian() * 0.5;
      var angX = gx * spreadRad, angY = gy * spreadRad;

      var R = ctx.renderer;
      if (R && typeof R.getCameraRay === 'function') {
        var fov = 78 * DEG, aspect = 16 / 9;
        if (typeof R.getFov === 'function') fov = num(R.getFov(), 78) * DEG;
        if (R.camera && num(R.camera.aspect, 0) > 0) aspect = R.camera.aspect;
        var tanHalf = Math.tan(fov * 0.5) || 0.7;
        var ndcX = Math.tan(angX) / (tanHalf * aspect);
        var ndcY = Math.tan(angY) / tanHalf;
        try { R.getCameraRay(ndcX, ndcY, _camPos, out); return out; } catch (e) { /* cae al respaldo */ }
      }

      var p = player();
      var yaw = p && isFinite(p.yaw) ? p.yaw : 0;
      var pitch = p && isFinite(p.pitch) ? p.pitch : 0;
      return M.v3fromYawPitch(out, yaw + angX, M.clamp(pitch + angY, -1.5, 1.5));
    }

    function muzzleWorldPos(out) {
      out = out || new Float32Array(3);
      var def = DEFS[currentSlot];
      if (!def) return out;
      var mo = def.viewmodel.muzzleOffset;
      var p = player();
      var yaw = p && isFinite(p.yaw) ? p.yaw : 0;
      var pitch = p && isFinite(p.pitch) ? p.pitch : 0;
      var eye = playerEye(_eye);
      var cy = Math.cos(yaw), sy = Math.sin(yaw);
      var cp = Math.cos(pitch), sp = Math.sin(pitch);
      var fx = -sy * cp, fy = sp, fz = -cy * cp;
      var rx = cy, ry = 0, rz = -sy;
      var ux = sy * sp, uy = cp, uz = cy * sp;
      out[0] = eye[0] + rx * mo[0] + ux * mo[1] + fx * mo[2];
      out[1] = eye[1] + ry * mo[0] + uy * mo[1] + fy * mo[2];
      out[2] = eye[2] + rz * mo[0] + uz * mo[1] + fz * mo[2];
      return out;
    }

    /* ==================================================================
     * Disparo
     * ================================================================ */
    function fireHitscan(def, st) {
      var origin = playerEye(_origin);
      var pellets = Math.max(1, def.pellets | 0);
      var mask = maskWorld();
      var muzzle = muzzleWorldPos(_muzzle);
      var lastDir = _dir;

      for (var p = 0; p < pellets; p++) {
        var dir = aimDir(def, st, _dir);
        lastDir = dir;
        var hit = raycastCombat(origin, dir, def.range, mask);
        var end = _end;

        if (hit) {
          if (hit.enemy) {
            /* headshot: el punto de impacto supera la línea de cabeza */
            var headshot = false;
            var e = hit.enemy;
            if (hit.point && e && e.pos && e.headY !== undefined) {
              headshot = hit.point[1] > (e.pos[1] + num(e.headY, 0));
            }
            var dmg = def.damage * (headshot ? def.headshotMul : 1);
            var res = damageTarget(e, dmg, {
              point: hit.point, normal: hit.normal, dir: dir,
              headshot: headshot, kind: 'bullet', source: player()
            });
            fxImpact(hit.point, hit.normal, 'flesh');
            hudHitmarker(!!res.killed, headshot);
            audioPlay(res.killed ? 'kill_confirm' : 'hit_flesh', hit.point);
            end = hit.point;
          } else if (hit.t >= 0) {
            var kind = (hit.collider && hit.collider.mat === 'mat_metal_panel') ? 'metal' : 'concrete';
            fxImpact(hit.point, hit.normal, kind);
            audioPlay('hit_world', hit.point);
            end = hit.point;
          } else {
            M.v3addScaled(_end, origin, dir, def.range);
            end = _end;
          }
        } else {
          M.v3addScaled(_end, origin, dir, def.range);
          end = _end;
        }
        fxTracer(muzzle, end, def.hudColor, 0.018, 0.05);
      }

      audioPlay(def.sfx.fire, muzzle);
      fxMuzzle(muzzle, lastDir, def.viewmodel.muzzleFlashScale);
      fxLight(muzzle, def.hudColor, 6, 1.6, 0.06);
      audioPlay('shell_drop', null);
      emit('noise', { pos: [muzzle[0], muzzle[1], muzzle[2]], radius: 26, tag: 'gunshot' });
      emit('weapon:fired', { slot: def.slot, name: def.name, ammoInMag: st.ammoInMag });
    }

    function fireProjectile(def, st) {
      var origin = playerEye(_origin);
      var dir = aimDir(def, st, _dir);
      var muzzle = muzzleWorldPos(_muzzle);
      var pd = def.projectile || {};
      var P = ctx.projectiles;

      if (P && typeof P.spawn === 'function') {
        var speed = num(pd.speed, 28);
        var vel = new Float32Array([dir[0] * speed, dir[1] * speed + 1.1, dir[2] * speed]);
        try {
          P.spawn({
            pos: new Float32Array([muzzle[0], muzzle[1], muzzle[2]]),
            vel: vel,
            damage: num(pd.damage, def.damage),
            speed: speed,
            life: num(pd.life, 5),
            radius: num(pd.radius, 0.28),
            gravity: num(pd.gravity, 12),
            owner: 'player', ownerRef: player(),
            splash: (num(pd.splashRadius, 0) > 0)
              ? { radius: pd.splashRadius, damage: num(pd.splashDamage, def.damage), falloff: 'linear' }
              : null,
            homing: 0,
            material: 'mat_bolt_plasma',
            mesh: pd.mesh || null,
            color: pd.color || def.hudColor,
            trail: true,
            lightRadius: 4
          });
        } catch (e) { /* noop */ }
      }

      audioPlay(def.sfx.fire, muzzle);
      fxMuzzle(muzzle, dir, def.viewmodel.muzzleFlashScale);
      fxLight(muzzle, def.hudColor, 5, 1.4, 0.08);
      emit('noise', { pos: [muzzle[0], muzzle[1], muzzle[2]], radius: 26, tag: 'gunshot' });
      emit('weapon:fired', { slot: def.slot, name: def.name, ammoInMag: st.ammoInMag });
    }

    function fireWeapon(def, st) {
      st.ammoInMag--;
      st.lastShotAt = time;
      st.nextFireAt = time + 60 / num(def.rpm, 400);
      st.spreadAccum = Math.min(def.spreadMax, st.spreadAccum + def.spreadPerShot);
      st.spreadDeg = computeSpread(def, st);

      if (def.fireKind === 'projectile') fireProjectile(def, st);
      else fireHitscan(def, st);

      var p = player();
      if (p && typeof p.addRecoil === 'function') {
        var yk = def.recoilYaw * (Math.random() < 0.5 ? -1 : 1);
        try { p.addRecoil(def.recoilKick, yk); } catch (e) { /* noop */ }
      }
      vmKick = 1;
      st.canFire = false;
    }

    function tryFire(triggerHeld, triggerPressedThisFrame) {
      var st = current;
      if (!st || !st.unlocked) return false;
      var def = DEFS[st.slot];
      if (!def) return false;
      if (st.isSwapping || st.isReloading) return false;

      var wantFire = (def.mode === 'auto')
        ? (!!triggerHeld || !!triggerPressedThisFrame)
        : !!triggerPressedThisFrame;
      if (!wantFire) return false;

      if (time < st.nextFireAt) return false;

      if (st.ammoInMag <= 0) {
        if (time - emptyClickAt > 0.35) {
          emptyClickAt = time;
          audioPlay(def.sfx.empty || 'empty_click', null);
        }
        if (st.reserve > 0) reload();
        return false;
      }

      fireWeapon(def, st);
      return true;
    }

    /* ==================================================================
     * update(dt) — SOLO temporizadores. BS.Game lo llama por frame.
     * ================================================================ */
    function update(dt) {
      dt = num(dt, 1 / 60);
      if (dt <= 0) return;
      time += dt;

      var def = DEFS[currentSlot];
      var st = current;
      if (!def || !st) return;

      /* cambio de arma */
      if (st.isSwapping) {
        st.swapElapsed += dt;
        st.swapProgress = st.swapDuration > 0 ? Math.min(1, st.swapElapsed / st.swapDuration) : 1;
        if (st.swapElapsed >= st.swapDuration) {
          st.isSwapping = false;
          st.swapProgress = 0;
          st.swapElapsed = 0;
          st.nextFireAt = Math.max(st.nextFireAt, time);
        }
      }

      /* recarga */
      if (st.isReloading) {
        st.reloadElapsed += dt;
        st.reloadProgress = st.reloadDuration > 0 ? Math.min(1, st.reloadElapsed / st.reloadDuration) : 1;
        if (st.reloadElapsed >= st.reloadDuration) finishReload(def, st);
      }

      /* recuperación del spread */
      if (st.spreadAccum > 0) {
        st.spreadAccum = Math.max(0, st.spreadAccum - def.spreadRecover * dt);
      }
      st.spreadDeg = computeSpread(def, st);

      /* retroceso visual del viewmodel */
      if (vmKick > 0) {
        vmKick = M.damp(vmKick, 0, def.kickRecover || 10, dt);
        if (vmKick < 1e-3) vmKick = 0;
      }

      st.canFire = st.unlocked && !st.isReloading && !st.isSwapping &&
        st.ammoInMag > 0 && time >= st.nextFireAt;
    }

    /* ==================================================================
     * Munición
     * ================================================================ */
    function addReserve(slot, amount) {
      var st = slotStates[slot | 0];
      if (!st) return 0;
      var amt = Math.max(0, Math.round(num(amount, 0)));
      var space = st.reserveMax - st.reserve;
      if (space <= 0) return 0;
      var add = Math.min(space, amt);
      st.reserve += add;
      return add;
    }

    function addAmmoToCurrent(amount) {
      if (!current) return 0;
      return addReserve(current.slot, amount);
    }

    function addAmmo(ammoType, amount) {
      if (!ammoType) return 0;
      var st = current;
      /* preferencia: el arma activa si comparte tipo */
      if (st && st.ammoType === ammoType && st.unlocked) return addReserve(st.slot, amount);
      for (var s = 1; s <= 3; s++) {
        var c = slotStates[s];
        if (c && c.unlocked && c.ammoType === ammoType) return addReserve(s, amount);
      }
      /* si no hay arma de ese tipo, se convierte en reserva genérica del arma activa */
      if (st && st.unlocked) return addReserve(st.slot, amount);
      return 0;
    }

    function fillAllAmmo() {
      for (var s = 1; s <= 3; s++) {
        var st = slotStates[s];
        if (!st || !st.unlocked) continue;
        st.ammoInMag = st.magSize;
        st.reserve = st.reserveMax;
      }
    }

    function giveWeapon(slot, withAmmo) {
      slot = slot | 0;
      var def = DEFS[slot];
      if (!def) return;
      var st = slotStates[slot];
      if (!st) { st = slotStates[slot] = makeState(def, true, withAmmo !== false); }
      else {
        st.unlocked = true;
        if (withAmmo !== false) {
          st.ammoInMag = def.magSize;
          if (st.reserve <= 0) st.reserve = def.startReserve;
        }
      }
      switchTo(slot);
    }

    /* ==================================================================
     * Estado para el HUD
     * ================================================================ */
    function getState() { return current; }

    function getSpreadPx(viewportHeight) {
      var st = current;
      if (!st) return 8;
      var h = num(viewportHeight, 720);
      var R = ctx.renderer;
      var fov = 78 * DEG;
      if (R && typeof R.getFov === 'function') fov = num(R.getFov(), 78) * DEG;
      var tanHalf = Math.tan(fov * 0.5) || 0.7;
      var px = (h * 0.5) * Math.tan(num(st.spreadDeg, 0) * DEG) / tanHalf;
      return Math.max(6, px);
    }

    /* ==================================================================
     * Viewmodel
     * ================================================================ */
    var _vmModel = M.m4();

    function ensureMaterials(def) {
      if (!materials[def.id]) {
        materials[def.id] = materialOf('mat_gun_metal', false);
        materials[def.id + '_glow'] = materialOf('mat_gun_glow', true);
      }
    }

    function renderViewmodel(renderer, opts) {
      if (!renderer || typeof renderer.pushViewmodel !== 'function') return;
      var def = DEFS[currentSlot];
      var st = current;
      if (!def || !st) return;
      var vm = viewmodels[def.id];
      if (!vm || !vm.main) return;
      ensureMaterials(def);

      opts = opts || {};
      var vmd = def.viewmodel;
      var eye = opts.eyePos || playerEye(_eye);
      var yaw = (opts.yaw !== undefined) ? num(opts.yaw, 0) : (player() ? num(player().yaw, 0) : 0);
      var pitch = (opts.pitch !== undefined) ? num(opts.pitch, 0) : (player() ? num(player().pitch, 0) : 0);
      var roll = num(opts.roll, 0);
      var bobPhase = num(opts.bobPhase, 0);
      var speed01 = M.clamp01(num(opts.speed01, 0));
      var dt = num(opts.dt, 1 / 60);

      /* NOTA: vmKick NO se amortigua aquí. Ya lo hace update(dt) (paso fijo de
       * simulación). Antes estaba duplicado en este método, así que el retroceso
       * se recuperaba ~2× más rápido de lo previsto (doble amortiguación con el
       * mismo factor). El render no debe mutar estado de simulación. `dt` queda
       * como parámetro de la firma por compatibilidad (el balanceo de más abajo
       * usa bobPhase/speed01, no dt). */
      void dt;

      /* base de la cámara en mundo */
      var cy = Math.cos(yaw), sy = Math.sin(yaw);
      var cp = Math.cos(pitch), sp = Math.sin(pitch);
      var fx = -sy * cp, fy = sp, fz = -cy * cp;
      var rx = cy, ry = 0, rz = -sy;
      var ux = sy * sp, uy = cp, uz = cy * sp;

      /* balanceo + subida durante el cambio de arma */
      var bobX = Math.sin(bobPhase) * vmd.bobAmount * speed01;
      var bobY = Math.abs(Math.cos(bobPhase)) * vmd.bobAmount * 0.8 * speed01;
      var swapDrop = st.isSwapping ? (1 - Math.abs(st.swapProgress * 2 - 1)) : 0;

      var ox = vmd.offset[0] + bobX;
      var oy = vmd.offset[1] + bobY - swapDrop * 0.35;
      var oz = vmd.offset[2] + vmKick * vmd.kickBack;

      var px = eye[0] + rx * ox + ux * oy + fx * oz;
      var py = eye[1] + ry * ox + uy * oy + fy * oz;
      var pz = eye[2] + rz * ox + uz * oy + fz * oz;

      var kickPitch = pitch - vmKick * vmd.kickRot;
      M.m4fromTRS(_vmModel, [px, py, pz], yaw, kickPitch, roll + vmKick * 0.03, vmd.scale);

      renderer.pushViewmodel(vm.main, _vmModel, materials[def.id], {});
      if (vm.glow) {
        renderer.pushViewmodel(vm.glow, _vmModel, materials[def.id + '_glow'], { emissiveBoost: 0.4 });
      }
    }

    /* ==================================================================
     * Recursos
     * ================================================================ */
    function buildResources() {
      viewmodels = {};
      materials = {};
      for (var s = 1; s <= 3; s++) {
        var def = DEFS[s];
        if (!def) continue;
        viewmodels[def.id] = buildViewmodel(def.id);
      }
      /* malla del proyectil del arma de brecha */
      if (DEFS[3] && DEFS[3].projectile) {
        DEFS[3].projectile.mesh = buildProjectileMesh();
      }
    }

    function disposeMeshes() {
      var G = BS.GL;
      if (!G || typeof G.disposeMesh !== 'function') return;
      for (var id in viewmodels) {
        if (!Object.prototype.hasOwnProperty.call(viewmodels, id)) continue;
        var vm = viewmodels[id];
        if (vm && vm.main) { try { G.disposeMesh(vm.main); } catch (e) { /* noop */ } }
        if (vm && vm.glow) { try { G.disposeMesh(vm.glow); } catch (e2) { /* noop */ } }
      }
      if (DEFS[3] && DEFS[3].projectile && DEFS[3].projectile.mesh) {
        try { G.disposeMesh(DEFS[3].projectile.mesh); } catch (e3) { /* noop */ }
        DEFS[3].projectile.mesh = null;
      }
    }

    function dispose() { disposeMeshes(); viewmodels = {}; materials = {}; }

    function rebuild(c) {
      if (c) ctx = c;
      disposeMeshes();
      buildResources();
    }

    /* ---- arranque ---- */
    reset();
    buildResources();

    var system = {
      update: update,
      tryFire: tryFire,
      reload: reload,
      switchTo: switchTo,
      nextWeapon: nextWeapon,
      prevWeapon: prevWeapon,
      cancelReload: cancelReload,
      hasWeapon: hasWeapon,
      giveWeapon: giveWeapon,
      addAmmo: addAmmo,
      addAmmoToCurrent: addAmmoToCurrent,
      addReserve: addReserve,
      fillAllAmmo: fillAllAmmo,
      reset: reset,

      getState: getState,
      getSpreadPx: getSpreadPx,

      renderViewmodel: renderViewmodel,
      muzzleWorldPos: muzzleWorldPos,
      rebuild: rebuild,
      dispose: dispose,

      /* ayudas usadas por el HUD / sandbox (no contradicen §3.14) */
      getSlot: function () { return currentSlot; },
      getDef: function (slot) { return DEFS[slot | 0] || null; },
      isReloading: function () { return !!(current && current.isReloading); },
      isSwapping: function () { return !!(current && current.isSwapping); },
      time: function () { return time; }
    };

    /* `current` es una referencia viva; se expone como propiedad. */
    try {
      Object.defineProperty(system, 'current', {
        enumerable: true,
        configurable: true,
        get: function () { return current; }
      });
    } catch (e) {
      system.current = current;
    }

    return system;
  }

  BS.Weapons = { DEFS: DEFS, create: create };

  /* ======================================================================
   * Test: weapons:fire (§3.14)
   * ----------------------------------------------------------------------
   * A) la secuencia canónica de disparo hitscan se ejecuta sin errores y
   *    llama a combate/HUD/FX/audio.
   * B) tras 3 s de fuego automático la munición consumida cuadra con el rpm.
   * ==================================================================== */
  if (BS.Debug && typeof BS.Debug.register === 'function') {
    BS.Debug.register('weapons:fire', function () {
      var M2 = BS.Math;

      function fakePlayer() {
        return {
          pos: new Float32Array([0, 0.95, 0]),
          yaw: 0, pitch: 0,
          isSprinting: false, isCrouching: false, isGrounded: true, speed: 0,
          eyePosition: function (out) {
            out = out || new Float32Array(3);
            out[0] = 0; out[1] = 1.55; out[2] = 0;
            return out;
          },
          forward: function (out) {
            return M2.v3fromYawPitch(out || new Float32Array(3), this.yaw, this.pitch);
          },
          addRecoil: function () { /* noop */ }
        };
      }

      /* ---------- A: secuencia canónica ---------- */
      var calls = { raycast: 0, damage: 0, hitmarker: 0, impact: 0, fire: 0, tracer: 0 };
      var enemy = { pos: new Float32Array([0, 1, -5]), headY: 0.5, hp: 100, type: 'drone', alive: true };
      var ctxA = {
        player: fakePlayer(), renderer: null, level: null, physics: null,
        combat: {
          raycast: function () {
            calls.raycast++;
            return {
              t: 5, distance: 5,
              point: new Float32Array([0, 1.0, -5]), normal: new Float32Array([0, 0, 1]),
              collider: { mat: 'mat_metal_panel' }, ref: null, enemy: enemy, headshot: false
            };
          },
          damage: function (t, amt) { calls.damage++; return { killed: false, hp: 100 - amt, applied: amt }; }
        },
        hud: { hitmarker: function () { calls.hitmarker++; } },
        enemies: { damage: function () { return { killed: false, hp: 1, applied: 1 }; } },
        fx: {
          impact: function () { calls.impact++; },
          tracer: function () { calls.tracer++; },
          muzzleFlash: function () {}, tempLight: function () {}, screenShake: function () {}
        },
        audio: { play: function (n) { if (n === 'pistol') calls.fire++; } },
        events: BS.Events,
        settings: { fov: 78 }
      };

      var wsA = BS.Weapons.create(ctxA);
      var fired = wsA.tryFire(false, true);
      var partA = fired === true && calls.raycast >= 1 && calls.damage === 1 &&
        calls.hitmarker === 1 && calls.impact >= 1 && calls.fire === 1 && calls.tracer >= 1;
      wsA.dispose();

      /* ---------- B: cadencia automática ---------- */
      var ctxB = {
        player: fakePlayer(), renderer: null, level: null, physics: null,
        combat: { raycast: function () { return null; }, damage: function () { return {}; } },
        fx: { impact: function () {}, tracer: function () {}, muzzleFlash: function () {}, tempLight: function () {} },
        audio: { play: function () {} },
        events: BS.Events
      };
      var wsB = BS.Weapons.create(ctxB);
      wsB.giveWeapon(2, true);
      wsB.switchTo(2);
      wsB.update(0.6);                 /* completa el cambio de arma */
      var stB = wsB.current;
      stB.magSize = 200;
      stB.ammoInMag = 200;
      stB.nextFireAt = 0;
      stB.isSwapping = false;

      var dtB = 1 / 240, frames = 720;
      var defB = BS.Weapons.DEFS[2];
      var interval = 60 / defB.rpm;
      var step = Math.ceil(interval / dtB);
      var expected = 1 + Math.floor((frames - 1) / step);

      var shots = 0;
      var sub = BS.Events.on('weapon:fired', function () { shots++; });
      for (var i = 0; i < frames; i++) {
        wsB.update(dtB);
        wsB.tryFire(true, false);
      }
      BS.Events.off('weapon:fired', sub);

      var consumed = 200 - stB.ammoInMag;
      var measuredRpm = (shots / (frames * dtB)) * 60;
      var partB = (shots === expected) && (consumed === shots) &&
        (Math.abs(measuredRpm - defB.rpm) < 1);
      wsB.dispose();

      return {
        ok: partA && partB,
        secuenciaCanonica: partA,
        llamadas: calls,
        disparos3s: shots,
        esperado: expected,
        municionConsumida: consumed,
        rpmMedido: Math.round(measuredRpm * 10) / 10,
        rpmDeclarado: defB.rpm
      };
    });
  }

})(window.BS = window.BS || {});
