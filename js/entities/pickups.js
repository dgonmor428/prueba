/* ===========================================================================
 * BLACKSITE: LAST SIGNAL  —  js/entities/pickups.js
 * ---------------------------------------------------------------------------
 * Propósito : objetos recogibles (munición, vida y armas). Mallas propias
 *             distintas por forma, balanceo/giro, recogida por AABB del jugador
 *             y regla de "no consumir si no sirve" (munición llena, vida llena,
 *             arma ya en posesión). El respawn entre oleadas lo hace BS.Game
 *             (reset + spawn de la lista de la oleada), así que este módulo NO
 *             se suscribe a 'wave:started' para no duplicar objetos.
 * Depende de: js/core/util.js (BS.Math, BS.Events, BS.Log), js/render/mesh.js,
 *             js/core/textures.js y el `ctx` del juego (player, weapons...).
 * Expone    : BS.Pickups
 * Notas     : §3.16. Todos los usos de ctx.* están protegidos para que el
 *             sandbox del LOTE B funcione sin los módulos del LOTE C.
 * =========================================================================== */
(function (BS) {
  'use strict';

  var M = BS.Math;

  var MAX_PICKUPS = 96;          /* techo de seguridad del pool */
  var RADIUS = 0.42;             /* semiancho XZ de la caja de recogida */
  var HALF_H = 0.45;             /* semialto */

  /* ======================================================================
   * Tipos (§3.16 KINDS)
   * ==================================================================== */
  var KINDS = {
    ammo_light: { ammoType: 'light', amount: 24, mesh: 'box_small', color: [1, 0.85, 0.4], sound: 'pickup_ammo' },
    ammo_heavy: { ammoType: 'heavy', amount: 18, mesh: 'box_small', color: [1, 0.6, 0.3], sound: 'pickup_ammo' },
    ammo_cell: { ammoType: 'cell', amount: 12, mesh: 'box_small', color: [0.4, 0.9, 1], sound: 'pickup_ammo' },
    health_small: { heal: 25, mesh: 'cross', color: [0.3, 1, 0.5], sound: 'pickup_health' },
    health_large: { heal: 50, mesh: 'cross', color: [0.3, 1, 0.5], sound: 'pickup_health' },
    weapon_smg: { weapon: 2, mesh: 'gun_rack', color: [0.7, 0.8, 0.9], sound: 'pickup_weapon' },
    weapon_breacher: { weapon: 3, mesh: 'gun_rack', color: [0.9, 0.5, 1], sound: 'pickup_weapon' }
  };

  function indicatorMaterialId(kind) {
    if (kind.indexOf('health') === 0) return 'mat_beacon';
    if (kind.indexOf('weapon') === 0) return 'mat_strip_red';
    return 'mat_strip_cyan';
  }

  function num(v, d) {
    var n = +v;
    return isFinite(n) ? n : d;
  }
  function aabbOverlap(a, b) {
    return a.min[0] <= b.max[0] && a.max[0] >= b.min[0] &&
      a.min[1] <= b.max[1] && a.max[1] >= b.min[1] &&
      a.min[2] <= b.max[2] && a.max[2] >= b.min[2];
  }

  /* ======================================================================
   * Estado interno
   * ==================================================================== */
  var ctx = {};
  var list = [];
  var nextId = 1;
  var time = 0;
  var dropped = 0;

  var materialCache = {};
  var meshes = null;         /* { box_small, cross, gun_rack, indicator } */

  var _pMin = new Float32Array(3);
  var _pMax = new Float32Array(3);
  var _model = M.m4();

  /* ======================================================================
   * Utilidades protegidas
   * ==================================================================== */
  function emit(name, payload) {
    var ev = ctx.events || BS.Events;
    if (ev && typeof ev.emit === 'function') { try { ev.emit(name, payload); } catch (e) { /* noop */ } }
  }
  function audioPlay(name, pos) {
    if (!name) return;
    var A = ctx.audio || BS.Audio;
    if (A && typeof A.play === 'function') { try { A.play(name, pos ? { pos: pos } : undefined); } catch (e) { /* noop */ } }
  }
  function playerObj() { return ctx.player || null; }
  function weaponsOf() {
    var p = playerObj();
    if (!p) return null;
    if (p.getWeapons) { try { return p.getWeapons(); } catch (e) { /* noop */ } }
    return null;
  }

  function playerAABB(p) {
    var r = 0.34, h = 1.85;
    if (p.body) {
      r = num(p.body.radius, r);
      h = num(p.body.height, h);
    } else if (p.CONFIG) {
      r = num(p.CONFIG.radius, r);
      h = num(p.CONFIG.standHeight, h);
    }
    _pMin[0] = p.pos[0] - r; _pMin[1] = p.pos[1] - h * 0.5; _pMin[2] = p.pos[2] - r;
    _pMax[0] = p.pos[0] + r; _pMax[1] = p.pos[1] + h * 0.5; _pMax[2] = p.pos[2] + r;
    return { min: _pMin, max: _pMax };
  }

  /* ======================================================================
   * Recogida
   * ==================================================================== */
  /* Devuelve { consumed:bool, amount:number } sin tocar el objeto. */
  function tryConsume(p) {
    var def = KINDS[p.kind];
    if (!def) return { consumed: false, amount: 0 };

    /* --- arma --- */
    if (def.weapon !== undefined) {
      var ws = weaponsOf();
      if (!ws) return { consumed: false, amount: 0 };
      if (typeof ws.hasWeapon === 'function' && ws.hasWeapon(def.weapon)) {
        /* ya la tienes: se convierte en munición adicional */
        var extra = (typeof ws.addReserve === 'function') ? ws.addReserve(def.weapon, 40) : 0;
        if (extra > 0) return { consumed: true, amount: extra };
        return { consumed: false, amount: 0 };
      }
      if (typeof ws.giveWeapon === 'function') {
        ws.giveWeapon(def.weapon, true);
        return { consumed: true, amount: 1 };
      }
      return { consumed: false, amount: 0 };
    }

    /* --- munición --- */
    if (def.ammoType) {
      var wsA = weaponsOf();
      if (!wsA || typeof wsA.addAmmo !== 'function') return { consumed: false, amount: 0 };
      var amount = (p.amount !== null && p.amount !== undefined) ? num(p.amount, def.amount) : def.amount;
      var added = 0;
      try { added = wsA.addAmmo(def.ammoType, amount) || 0; } catch (e) { added = 0; }
      if (added > 0) return { consumed: true, amount: added };
      return { consumed: false, amount: 0 };
    }

    /* --- vida --- */
    if (def.heal) {
      var pl = playerObj();
      if (!pl || typeof pl.heal !== 'function') return { consumed: false, amount: 0 };
      var amountH = (p.amount !== null && p.amount !== undefined) ? num(p.amount, def.heal) : def.heal;
      var healed = 0;
      try { healed = pl.heal(amountH) || 0; } catch (e2) { healed = 0; }
      if (healed > 0) return { consumed: true, amount: healed };
      return { consumed: false, amount: 0 };
    }

    return { consumed: false, amount: 0 };
  }

  function collect(p) {
    var res = tryConsume(p);
    if (!res.consumed) return false;
    var def = KINDS[p.kind];
    audioPlay(def.sound, p.pos);
    emit('pickup:collected', { kind: p.kind, amount: res.amount });
    if (p.respawn > 0) {
      p.alive = false;
      p.respawnAt = time + p.respawn;
    } else {
      p.alive = false;
      p.respawnAt = 0;
    }
    return true;
  }

  /* ======================================================================
   * Mallas
   * ==================================================================== */
  function buildMeshes() {
    if (!BS.Mesh || typeof BS.Mesh.create !== 'function') return null;

    function toGL(fn) {
      var b = BS.Mesh.create();
      fn(b);
      try { return BS.Mesh.toGL(b); } catch (e) { return null; }
    }

    var boxSmall = toGL(function (b) {
      b.color = [0.9, 0.9, 0.93];
      b.box([0, 0, 0], [0.46, 0.30, 0.34], [1, 1]);
      b.color = [0.5, 0.5, 0.56];
      b.box([0, 0, 0], [0.50, 0.06, 0.38], [1, 1]);
      b.box([0.16, 0.02, 0], [0.08, 0.24, 0.30], [1, 1]);
    });

    var cross = toGL(function (b) {
      b.color = [0.95, 0.97, 0.95];
      b.box([0, 0, 0], [0.44, 0.16, 0.14], [1, 1]);
      b.box([0, 0, 0], [0.16, 0.44, 0.14], [1, 1]);
      b.box([0, 0, 0], [0.16, 0.16, 0.32], [1, 1]);
    });

    var gunRack = toGL(function (b) {
      b.color = [0.58, 0.60, 0.66];
      b.box([0, -0.16, 0], [0.52, 0.08, 0.32], [1, 1]);
      b.box([0, -0.06, 0], [0.06, 0.22, 0.08], [1, 1]);
      b.color = [0.40, 0.42, 0.47];
      b.box([0, 0.10, 0], [0.46, 0.10, 0.11], [1, 1]);
      b.box([-0.13, 0.03, 0], [0.10, 0.14, 0.09], [1, 1]);
      b.box([0.20, 0.10, 0], [0.10, 0.05, 0.06], [1, 1]);
    });

    var indicator = toGL(function (b) {
      b.color = [1, 1, 1];
      b.emissive = 1;
      b.box([0, 0.26, 0], [0.13, 0.05, 0.13], [1, 1]);
      b.emissive = 0;
    });

    return { box_small: boxSmall, cross: cross, gun_rack: gunRack, indicator: indicator };
  }

  function materialFor(id, emissive) {
    var key = id || 'mat_pickup_shell';
    if (materialCache[key]) return materialCache[key];
    var mat = null;
    var T = BS.Textures;
    if (T && typeof T.getMaterial === 'function') {
      try { mat = T.getMaterial(key); } catch (e) { mat = null; }
    }
    if (!mat) {
      mat = {
        id: key, map: null, normalMap: null, emissiveMap: null,
        uvScale: [1, 1], specular: 0.35, normalStrength: 0,
        emissive: emissive ? [0.5, 0.9, 1.0] : [0, 0, 0], emissiveIntensity: emissive ? 1.4 : 0,
        blend: 'opaque', depthWrite: true, doubleSided: false, program: 'basic'
      };
    }
    materialCache[key] = mat;
    return mat;
  }

  /* ======================================================================
   * API pública
   * ==================================================================== */
  var Pickups = {
    list: list,
    KINDS: KINDS,

    init: function (c) {
      ctx = c || {};
      list.length = 0;
      meshes = buildMeshes();
      nextId = 1;
      time = 0;
      dropped = 0;
      BS.Log.info('BS.Pickups.init OK');
    },

    spawn: function (def) {
      if (!def || !def.kind) return null;
      var kind = KINDS[def.kind];
      if (!kind) {
        BS.Log.warn('BS.Pickups.spawn: kind desconocido "' + def.kind + '"');
        return null;
      }
      if (list.length >= MAX_PICKUPS) { dropped++; return null; }

      var p = {
        id: nextId++,
        kind: def.kind,
        pos: new Float32Array([num(def.pos && def.pos[0], 0), num(def.pos && def.pos[1], 0.5), num(def.pos && def.pos[2], 0)]),
        aabb: { min: new Float32Array(3), max: new Float32Array(3) },
        alive: true,
        bobPhase: Math.random() * Math.PI * 2,
        respawnAt: 0,
        respawn: num(def.respawn, 0),
        amount: (def.amount === undefined ? null : def.amount),
        isStatic: !!def.isStatic,
        ref: def
      };
      p.aabb.min[0] = p.pos[0] - RADIUS; p.aabb.min[1] = p.pos[1] - HALF_H; p.aabb.min[2] = p.pos[2] - RADIUS;
      p.aabb.max[0] = p.pos[0] + RADIUS; p.aabb.max[1] = p.pos[1] + HALF_H; p.aabb.max[2] = p.pos[2] + RADIUS;
      list.push(p);
      return p;
    },

    update: function (dt) {
      dt = num(dt, 1 / 60);
      if (dt <= 0) return;
      time += dt;

      var p = playerObj();
      var pa = p ? playerAABB(p) : null;
      var aliveCount = 0;

      for (var i = 0; i < list.length; i++) {
        var it = list[i];
        if (!it) continue;

        if (!it.alive) {
          if (it.respawnAt > 0 && time >= it.respawnAt) {
            it.alive = true;
            it.respawnAt = 0;
          } else {
            continue;
          }
        }
        aliveCount++;

        if (!it.isStatic) {
          it.bobPhase += dt * 2.2;
          if (it.bobPhase > Math.PI * 2000) it.bobPhase -= Math.PI * 2000;
        }

        if (pa && aabbOverlap(pa, it.aabb)) collect(it);
      }

      return aliveCount;
    },

    render: function (renderer) {
      if (!renderer || typeof renderer.push !== 'function' || !meshes) return;
      var bodyMat = materialFor('mat_pickup_shell', false);
      for (var i = 0; i < list.length; i++) {
        var it = list[i];
        if (!it || !it.alive) continue;
        var kind = KINDS[it.kind];
        if (!kind) continue;
        var body = meshes[kind.mesh] || meshes.box_small;
        if (!body) continue;

        var bob = it.isStatic ? 0 : Math.sin(it.bobPhase) * 0.07;
        var spin = it.isStatic ? 0 : it.bobPhase * 0.7;
        var model = M.m4fromTRS(_model, [it.pos[0], it.pos[1] + bob, it.pos[2]], spin, 0, 0, 1);

        renderer.push(body, model, bodyMat, { tint: kind.color });

        if (meshes.indicator) {
          var indMat = materialFor(indicatorMaterialId(it.kind), true);
          renderer.push(meshes.indicator, model, indMat, { emissiveBoost: 0.5 });
        }
      }
    },

    reset: function () {
      for (var i = 0; i < list.length; i++) {
        if (list[i]) { list[i].alive = false; list[i].respawnAt = 0; }
      }
      list.length = 0;
      time = 0;
      dropped = 0;
    },

    count: function () {
      var n = 0;
      for (var i = 0; i < list.length; i++) if (list[i] && list[i].alive) n++;
      return n;
    },

    rebuild: function (c) {
      if (c) ctx = c;
      materialCache = {};
      disposeMeshes();
      meshes = buildMeshes();
    },

    dispose: function () {
      disposeMeshes();
      meshes = null;
      materialCache = {};
      list.length = 0;
    },

    /* --- diagnóstico --- */
    dropped: function () { return dropped; },
    maxPickups: MAX_PICKUPS
  };

  function disposeMeshes() {
    if (!meshes) return;
    var G = BS.GL;
    if (!G || typeof G.disposeMesh !== 'function') return;
    for (var k in meshes) {
      if (!Object.prototype.hasOwnProperty.call(meshes, k)) continue;
      if (meshes[k]) { try { G.disposeMesh(meshes[k]); } catch (e) { /* noop */ } }
    }
  }

  BS.Pickups = Pickups;

  /* ======================================================================
   * Test: pickups:noOverflow (§3.16)
   * ----------------------------------------------------------------------
   * Comprueba (sin GPU):
   *   - el pool no desborda: N > MAX_PICKUPS deja la lista en el techo;
   *   - no se consume munición si el cargador/reserva está lleno, ni vida si
   *     está al máximo (regla "no consumir si no sirve");
   *   - sí se consume cuando hay hueco, y emite el evento y el sonido;
   *   - las armas se entregan una vez y luego pasan a reserva.
   * ==================================================================== */
  if (BS.Debug && typeof BS.Debug.register === 'function') {
    BS.Debug.register('pickups:noOverflow', function () {
      var events = [];
      var sounds = [];
      var given = [];
      var reserveAdded = 0;

      var ammoRoom = 100;
      var healRoom = 100;

      var ws = {
        hasWeapon: function (slot) { return given.indexOf(slot) >= 0; },
        giveWeapon: function (slot) { given.push(slot); },
        addAmmo: function (type, amount) {
          var add = Math.min(ammoRoom, amount);
          ammoRoom -= add;
          return add;
        },
        addReserve: function (slot, amount) {
          var add = Math.min(ammoRoom, amount);
          ammoRoom -= add;
          reserveAdded += add;
          return add;
        },
        getState: function () { return { ammoInMag: 0, magSize: 1, reserve: ammoRoom, ammoType: 'light', name: 'x', isReloading: false }; }
      };

      var fakePlayer = {
        pos: new Float32Array([0, 0.95, 0]),
        body: { radius: 0.34, height: 1.85 },
        CONFIG: { radius: 0.34, standHeight: 1.85 },
        heal: function (amount) {
          var add = Math.min(healRoom, amount);
          healRoom -= add;
          return add;
        },
        getWeapons: function () { return ws; }
      };

      var c = {
        player: fakePlayer,
        events: BS.Events,
        audio: { play: function (n) { sounds.push(n); } }
      };

      var sub = BS.Events.on('pickup:collected', function (e) { events.push(e); });

      BS.Pickups.init(c);

      /* 1) desborde del pool */
      for (var i = 0; i < BS.Pickups.maxPickups + 30; i++) {
        BS.Pickups.spawn({ kind: 'ammo_light', pos: [0, 0.55, 0] });
      }
      var overflowOk = BS.Pickups.list.length === BS.Pickups.maxPickups &&
        BS.Pickups.dropped() === 30;

      /* 2) munición llena: no se consume */
      BS.Pickups.reset();
      ammoRoom = 0;
      var pFull = BS.Pickups.spawn({ kind: 'ammo_light', pos: [0, 0.55, 0] });
      BS.Pickups.update(1 / 60);
      var noConsumeFull = pFull.alive === true;

      /* 3) vida llena: no se consume */
      healRoom = 0;
      var hFull = BS.Pickups.spawn({ kind: 'health_small', pos: [0, 0.55, 0] });
      BS.Pickups.update(1 / 60);
      var noHealFull = hFull.alive === true;

      /* 4) con hueco: se consume (munición + vida) */
      BS.Pickups.reset();
      ammoRoom = 100; healRoom = 100;
      events.length = 0; sounds.length = 0;
      BS.Pickups.spawn({ kind: 'ammo_heavy', pos: [0, 0.55, 0] });
      BS.Pickups.spawn({ kind: 'health_small', pos: [0, 0.55, 0] });
      BS.Pickups.update(1 / 60);
      var consumedBoth = BS.Pickups.count() === 0 &&
        BS.Pickups.list.length === 2 &&
        BS.Pickups.list[0].alive === false && BS.Pickups.list[1].alive === false &&
        events.length === 2 && sounds.length === 2;

      /* 5) arma: se entrega una vez, la segunda pasa a reserva */
      BS.Pickups.reset();
      ammoRoom = 100;
      given.length = 0; events.length = 0;
      var w1 = BS.Pickups.spawn({ kind: 'weapon_smg', pos: [0, 0.55, 0] });
      BS.Pickups.update(1 / 60);
      var gotWeapon = given.length === 1 && w1.alive === false;
      var w2 = BS.Pickups.spawn({ kind: 'weapon_smg', pos: [0, 0.55, 0] });
      BS.Pickups.update(1 / 60);
      var gotAmmoInstead = given.length === 1 && w2.alive === false && reserveAdded > 0;

      BS.Events.off('pickup:collected', sub);
      BS.Pickups.dispose();

      return {
        ok: overflowOk && noConsumeFull && noHealFull && consumedBoth && gotWeapon && gotAmmoInstead,
        desborde: overflowOk,
        noConsumeMunicionLlena: noConsumeFull,
        noConsumeVidaLlena: noHealFull,
        consumeConHueco: consumedBoth,
        armaEntregada: gotWeapon,
        armaLuegoReserva: gotAmmoInstead,
        maxPickups: BS.Pickups.maxPickups
      };
    });
  }

})(window.BS = window.BS || {});
