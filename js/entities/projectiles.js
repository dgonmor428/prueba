/* ===========================================================================
 * BLACKSITE: LAST SIGNAL  —  js/entities/projectiles.js
 * ---------------------------------------------------------------------------
 * Propósito : proyectiles (bolas de plasma del arma de brecha y de los drones).
 *             Pool de tamaño fijo (sin `new` por disparo), subpaso por delta
 *             (`ceil(|delta| / (radius*0.8))`, máx 4) y colisión por segmento
 *             (`BS.Math.raySegmentAABB`) contra el mundo y contra
 *             enemigos/jugador (`ctx.combat.raycast`). Salpicadura con caída
 *             lineal, guiado suave opcional, estela y luz temporal.
 * Depende de: js/core/util.js (BS.Math, BS.Log), js/render/renderer.js,
 *             js/core/textures.js, y el `ctx` del juego (level, combat, fx...).
 * Expone    : BS.Projectiles
 * Notas     : §3.13. Todos los usos de ctx.* están protegidos: el sandbox del
 *             LOTE B no necesita los módulos del LOTE C.
 * =========================================================================== */
(function (BS) {
  'use strict';

  var M = BS.Math;
  var MAX = 64;                 /* tamaño del pool */
  var MAX_SUBSTEPS = 4;
  var MAX_DT = 0.05;

  function num(v, d) {
    var n = +v;
    return isFinite(n) ? n : d;
  }
  function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }

  /* ======================================================================
   * Estado interno
   * ==================================================================== */
  var ctx = {};
  var pool = [];
  var live = [];
  var budget = MAX;
  var nextId = 1;
  var lastSteps = 1;

  var _min = new Float32Array(3);
  var _max = new Float32Array(3);
  var _p0 = new Float32Array(3);
  var _p1 = new Float32Array(3);
  var _dir = new Float32Array(3);
  var _pt = new Float32Array(3);
  var _nrm = new Float32Array(3);
  var _cols = [];

  var materialCache = {};
  var fallbackMesh = null;

  /* ======================================================================
   * Utilidades de contexto (protegidas)
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
  function fxImpact(pos, normal, kind) {
    var F = ctx.fx;
    if (F && typeof F.impact === 'function') { try { F.impact(pos, normal, kind); } catch (e) { /* noop */ } }
  }
  function fxExplosion(pos, radius, color) {
    var F = ctx.fx;
    if (F && typeof F.explosion === 'function') { try { F.explosion(pos, radius, color); } catch (e) { /* noop */ } }
  }
  function fxTrail(pos, color, life) {
    var F = ctx.fx;
    if (F && typeof F.trail === 'function') { try { F.trail(pos, color, life); } catch (e) { /* noop */ } }
  }
  function fxLight(pos, color, radius, intensity, duration) {
    var F = ctx.fx;
    if (F && typeof F.tempLight === 'function') { try { F.tempLight(pos, color, radius, intensity, duration); } catch (e) { /* noop */ } }
  }
  function areaDamage(pos, radius, amount, opts) {
    var C = ctx.combat;
    if (C && typeof C.areaDamage === 'function') { try { return C.areaDamage(pos, radius, amount, opts) || 0; } catch (e) { /* noop */ } }
    if (ctx.enemies && typeof ctx.enemies.areaDamage === 'function') {
      try { return ctx.enemies.areaDamage(pos, radius, amount, opts) || 0; } catch (e2) { /* noop */ }
    }
    return 0;
  }
  function damageTarget(target, amount, info) {
    var C = ctx.combat;
    if (C && typeof C.damage === 'function') { try { return C.damage(target, amount, info) || {}; } catch (e) { /* noop */ } }
    if (ctx.enemies && typeof ctx.enemies.damage === 'function') {
      try { return ctx.enemies.damage(target, amount, info) || {}; } catch (e2) { /* noop */ }
    }
    return {};
  }
  function maskWorld() {
    var P = BS.Physics;
    if (P && P.MASK) return P.MASK.WORLD | P.MASK.PROP;
    return 0;
  }
  function maskEntity() {
    var P = BS.Physics;
    if (P && P.MASK) return P.MASK.ENEMY | P.MASK.PLAYER;
    return 0;
  }

  /* ======================================================================
   * Pool
   * ==================================================================== */
  function ensurePool() {
    if (pool.length) return;
    for (var i = 0; i < MAX; i++) {
      pool.push({
        pos: new Float32Array(3),
        vel: new Float32Array(3),
        def: null, alive: false, age: 0, id: 0, trailAccum: 0
      });
    }
  }

  function freeObject() {
    for (var i = 0; i < pool.length; i++) if (!pool[i].alive) return pool[i];
    return null;
  }

  function removeLive(p) {
    for (var i = 0; i < live.length; i++) {
      if (live[i] === p) { live.splice(i, 1); return; }
    }
  }

  /* ======================================================================
   * Subpasos
   * ==================================================================== */
  function stepsFor(deltaLen, radius) {
    var r = Math.max(0.05, num(radius, 0.28) * 0.8);
    var n = Math.ceil(deltaLen / r);
    if (!(n > 1)) n = 1;
    return Math.min(MAX_SUBSTEPS, n);
  }

  /* ======================================================================
   * Colisión: mundo
   * ==================================================================== */
  function queryNearby(p0, p1, radius) {
    _cols.length = 0;
    var lv = ctx.level;
    if (!lv) return _cols;
    _min[0] = Math.min(p0[0], p1[0]) - radius;
    _min[1] = Math.min(p0[1], p1[1]) - radius;
    _min[2] = Math.min(p0[2], p1[2]) - radius;
    _max[0] = Math.max(p0[0], p1[0]) + radius;
    _max[1] = Math.max(p0[1], p1[1]) + radius;
    _max[2] = Math.max(p0[2], p1[2]) + radius;
    if (typeof lv.queryColliders === 'function') {
      try { return lv.queryColliders({ min: _min, max: _max }, _cols); } catch (e) { /* noop */ }
    }
    if (lv.colliderGrid && typeof lv.colliderGrid.query === 'function') {
      try { lv.colliderGrid.query(_min, _max, _cols); } catch (e2) { /* noop */ }
    }
    return _cols;
  }

  function surferY(c, x, z) {
    if (BS.Physics && typeof BS.Physics.rampSurfaceY === 'function') return BS.Physics.rampSurfaceY(c, x, z);
    if (ctx.level && typeof ctx.level.rampHeightAt === 'function') return ctx.level.rampHeightAt(c, x, z);
    return c.max[1];
  }

  function rayWorld(p0, p1, radius) {
    var lv = ctx.level;
    if (!lv) return null;
    var cols = queryNearby(p0, p1, radius);
    if (!cols || !cols.length) return null;
    var mask = maskWorld();
    var bestT = 2, bestC = null;
    for (var i = 0; i < cols.length; i++) {
      var c = cols[i];
      if (!c || !c.min || !c.max) continue;
      if (mask && c.flags && (c.flags & mask) === 0) continue;
      _min[0] = c.min[0] - radius; _min[1] = c.min[1] - radius; _min[2] = c.min[2] - radius;
      _max[0] = c.max[0] + radius; _max[1] = c.max[1] + radius; _max[2] = c.max[2] + radius;
      var t = M.raySegmentAABB(p0, p1, _min, _max);
      if (t < 0 || t > 1 || t >= bestT) continue;
      if (c.type === 'ramp') {
        var x = p0[0] + (p1[0] - p0[0]) * t;
        var y = p0[1] + (p1[1] - p0[1]) * t;
        var z = p0[2] + (p1[2] - p0[2]) * t;
        if (y > surferY(c, x, z) + radius) continue;   /* pasa por encima de la rampa */
      }
      bestT = t; bestC = c;
    }
    if (!bestC) return null;

    _pt[0] = p0[0] + (p1[0] - p0[0]) * bestT;
    _pt[1] = p0[1] + (p1[1] - p0[1]) * bestT;
    _pt[2] = p0[2] + (p1[2] - p0[2]) * bestT;
    /* normal aproximada por la cara más cercana */
    var pad = 1e-3;
    _nrm[0] = 0; _nrm[1] = 0; _nrm[2] = 0;
    if (bestC.type === 'ramp') {
      _nrm[1] = 1;
    } else if (Math.abs(_pt[0] - bestC.min[0]) < pad) _nrm[0] = -1;
    else if (Math.abs(_pt[0] - bestC.max[0]) < pad) _nrm[0] = 1;
    else if (Math.abs(_pt[1] - bestC.min[1]) < pad) _nrm[1] = -1;
    else if (Math.abs(_pt[1] - bestC.max[1]) < pad) _nrm[1] = 1;
    else if (Math.abs(_pt[2] - bestC.min[2]) < pad) _nrm[2] = -1;
    else _nrm[2] = 1;

    return { t: bestT, point: new Float32Array([_pt[0], _pt[1], _pt[2]]), normal: new Float32Array([_nrm[0], _nrm[1], _nrm[2]]), collider: bestC, enemy: null };
  }

  /* ======================================================================
   * Colisión: enemigos (y jugador para proyectiles enemigos)
   * ==================================================================== */
  function rayEntity(p0, p1, dirUnit, segLen, owner) {
    if (owner === 'enemy') {
      var P = ctx.player;
      if (P && P.pos) {
        var r = 0.4, h = 1.75;
        _min[0] = P.pos[0] - r; _min[1] = P.pos[1] - h * 0.5; _min[2] = P.pos[2] - r;
        _max[0] = P.pos[0] + r; _max[1] = P.pos[1] + h * 0.5; _max[2] = P.pos[2] + r;
        var tp = M.raySegmentAABB(p0, p1, _min, _max);
        if (tp >= 0 && tp <= 1) {
          return {
            t: tp,
            point: new Float32Array([p0[0] + (p1[0] - p0[0]) * tp, p0[1] + (p1[1] - p0[1]) * tp, p0[2] + (p1[2] - p0[2]) * tp]),
            normal: new Float32Array([-dirUnit[0], -dirUnit[1], -dirUnit[2]]),
            collider: null, enemy: P, isPlayer: true
          };
        }
      }
      return null;
    }

    /* proyectiles del jugador: enemigos */
    var C = ctx.combat;
    if (C && typeof C.raycast === 'function') {
      var h = null;
      try { h = C.raycast(p0, dirUnit, segLen, maskEntity(), ctx.player); } catch (e) { h = null; }
      if (h && h.enemy && num(h.t, -1) >= 0 && h.t <= segLen + 1e-6) {
        return {
          t: clamp01(h.t / segLen),
          point: h.point ? new Float32Array(h.point) : new Float32Array(p0),
          normal: h.normal ? new Float32Array(h.normal) : new Float32Array([-dirUnit[0], -dirUnit[1], -dirUnit[2]]),
          collider: null, enemy: h.enemy
        };
      }
      return null;
    }
    if (ctx.enemies && typeof ctx.enemies.raycast === 'function') {
      var e = null;
      try { e = ctx.enemies.raycast(p0, dirUnit, segLen, null); } catch (e2) { e = null; }
      if (e && e.enemy && num(e.t, -1) >= 0 && e.t <= segLen + 1e-6) {
        return {
          t: clamp01(e.t / segLen),
          point: e.point ? new Float32Array(e.point) : new Float32Array(p0),
          normal: new Float32Array([-dirUnit[0], -dirUnit[1], -dirUnit[2]]),
          collider: null, enemy: e.enemy
        };
      }
    }
    return null;
  }

  /* ======================================================================
   * Impacto
   * ==================================================================== */
  function kill(p) {
    p.alive = false;
    p.def = null;
    removeLive(p);
  }

  function impact(p, hit) {
    var def = p.def;
    var pos = hit.point;
    var normal = hit.normal;
    var enemy = hit.enemy;

    if (def.splash && num(def.splash.radius, 0) > 0) {
      areaDamage(pos, def.splash.radius, num(def.splash.damage, def.damage), {
        falloff: def.splash.falloff || 'linear', kind: 'explosion', source: def.ownerRef
      });
      fxExplosion(pos, def.splash.radius, def.color || [1, 0.6, 0.25]);
      audioPlay('explosion', pos);
      emit('noise', { pos: [pos[0], pos[1], pos[2]], radius: 30, tag: 'explosion' });
    } else {
      if (enemy) {
        damageTarget(enemy, num(def.damage, 10), {
          point: pos, normal: normal, dir: p.vel, kind: 'plasma', source: def.ownerRef
        });
        fxImpact(pos, normal, 'flesh');
      } else {
        fxImpact(pos, normal, 'energy');
      }
      audioPlay('plasma_impact', pos);
      emit('noise', { pos: [pos[0], pos[1], pos[2]], radius: 12, tag: 'impact' });
    }
    fxLight(pos, def.color || [0.5, 0.9, 1.0], 4, 1.2, 0.12);
    kill(p);
  }

  /* ======================================================================
   * API pública
   * ==================================================================== */
  var Projectiles = {
    list: live,

    init: function (c) {
      ctx = c || {};
      ensurePool();
      Projectiles.reset();
      BS.Log.info('BS.Projectiles.init OK (pool=' + MAX + ')');
    },

    spawn: function (def) {
      if (!def || !def.pos || !def.vel) return null;
      ensurePool();
      if (live.length >= budget) return null;
      var p = freeObject();
      if (!p) return null;

      p.pos[0] = num(def.pos[0], 0);
      p.pos[1] = num(def.pos[1], 0);
      p.pos[2] = num(def.pos[2], 0);
      p.vel[0] = num(def.vel[0], 0);
      p.vel[1] = num(def.vel[1], 0);
      p.vel[2] = num(def.vel[2], 0);
      p.def = def;
      p.alive = true;
      p.age = 0;
      p.id = nextId++;
      p.trailAccum = 0;
      live.push(p);

      if (num(def.lightRadius, 0) > 0) {
        fxLight(p.pos, def.color || [0.5, 0.9, 1.0], def.lightRadius, 0.9, 0.12);
      }
      return p;
    },

    update: function (dt) {
      ensurePool();
      dt = num(dt, 1 / 60);
      if (dt <= 0) return;
      if (dt > MAX_DT) dt = MAX_DT;

      for (var i = live.length - 1; i >= 0; i--) {
        var p = live[i];
        if (!p || !p.alive) { if (p) removeLive(p); continue; }
        var def = p.def;
        if (!def) { kill(p); continue; }

        p.age += dt;
        if (p.age >= num(def.life, 5)) { kill(p); continue; }

        /* gravedad */
        var g = num(def.gravity, 0);
        if (g !== 0) p.vel[1] -= g * dt;

        /* guiado suave */
        var homing = num(def.homing, 0);
        if (homing > 0) applyHoming(p, homing, dt);

        /* subpaso del delta */
        var dx = p.vel[0] * dt, dy = p.vel[1] * dt, dz = p.vel[2] * dt;
        var deltaLen = Math.sqrt(dx * dx + dy * dy + dz * dz);
        var radius = Math.max(0.05, num(def.radius, 0.28));
        var steps = stepsFor(deltaLen, radius);
        lastSteps = steps;
        var sx = dx / steps, sy = dy / steps, sz = dz / steps;
        var stepLen = deltaLen / steps;

        _p0[0] = p.pos[0]; _p0[1] = p.pos[1]; _p0[2] = p.pos[2];
        _p1[0] = p.pos[0] + sx; _p1[1] = p.pos[1] + sy; _p1[2] = p.pos[2] + sz;

        var dirLen = Math.sqrt(sx * sx + sy * sy + sz * sz);
        if (dirLen > 1e-9) {
          _dir[0] = sx / dirLen; _dir[1] = sy / dirLen; _dir[2] = sz / dirLen;
        } else {
          _dir[0] = 0; _dir[1] = 0; _dir[2] = -1;
        }

        var hitWorld = null, hitEnt = null;
        var dead = false;
        for (var s = 0; s < steps; s++) {
          hitWorld = rayWorld(_p0, _p1, radius);
          hitEnt = rayEntity(_p0, _p1, _dir, stepLen, def.owner);

          var useEnt = false;
          if (hitEnt && (!hitWorld || hitEnt.t <= hitWorld.t)) useEnt = true;

          if (useEnt || hitWorld) {
            impact(p, useEnt ? hitEnt : hitWorld);
            dead = true;
            break;
          }

          _p0[0] = _p1[0]; _p0[1] = _p1[1]; _p0[2] = _p1[2];
          _p1[0] += sx; _p1[1] += sy; _p1[2] += sz;
        }
        if (dead) continue;

        p.pos[0] = _p0[0]; p.pos[1] = _p0[1]; p.pos[2] = _p0[2];

        /* fuera del mundo */
        if (p.pos[1] < -60 || p.age >= num(def.life, 5)) { kill(p); continue; }

        /* estela */
        p.trailAccum += dt;
        if (def.trail && p.trailAccum > 0.02) {
          p.trailAccum = 0;
          fxTrail(p.pos, def.color || [0.5, 0.9, 1.0], 0.18);
        }
        if (num(def.lightRadius, 0) > 0) {
          fxLight(p.pos, def.color || [0.5, 0.9, 1.0], def.lightRadius, 0.8, 0.1);
        }
      }
    },

    render: function (renderer) {
      if (!renderer || typeof renderer.push !== 'function') return;
      ensureFallbackMesh();
      for (var i = 0; i < live.length; i++) {
        var p = live[i];
        if (!p || !p.alive || !p.def) continue;
        var mesh = p.def.mesh || fallbackMesh;
        if (!mesh) continue;
        var mat = materialFor(p.def.material);
        var model = M.m4fromTRS(_model, p.pos, 0, 0, 0, 1);
        renderer.push(mesh, model, mat, { tint: p.def.color || undefined, collection: 'transparent' });
      }
    },

    reset: function () {
      ensurePool();
      for (var i = 0; i < pool.length; i++) { pool[i].alive = false; pool[i].def = null; }
      live.length = 0;
      nextId = 1;
      lastSteps = 1;
    },

    count: function () { return live.length; },

    setBudget: function (n) {
      budget = Math.max(0, Math.min(MAX, n | 0));
      return budget;
    },

    rebuild: function (c) {
      if (c) ctx = c;
      materialCache = {};
      if (fallbackMesh && BS.GL && typeof BS.GL.disposeMesh === 'function') {
        try { BS.GL.disposeMesh(fallbackMesh); } catch (e) { /* noop */ }
      }
      fallbackMesh = null;
    },

    dispose: function () {
      Projectiles.reset();
      if (fallbackMesh && BS.GL && typeof BS.GL.disposeMesh === 'function') {
        try { BS.GL.disposeMesh(fallbackMesh); } catch (e) { /* noop */ }
      }
      fallbackMesh = null;
      materialCache = {};
    },

    /* ayudas internas expuestas para diagnóstico/tests */
    _stepsFor: stepsFor,
    _lastSteps: function () { return lastSteps; }
  };

  var _model = M.m4();

  /* ======================================================================
   * Guiado suave
   * ==================================================================== */
  function applyHoming(p, homing, dt) {
    var def = p.def;
    var target = null;
    if (def.owner === 'enemy' && ctx.player && ctx.player.pos) {
      target = ctx.player.pos;
    } else if (ctx.enemies && typeof ctx.enemies.getNearest === 'function') {
      try {
        var e = ctx.enemies.getNearest(p.pos, 48, null);
        if (e && e.pos && e.alive !== false) target = e.pos;
      } catch (err) { target = null; }
    }
    if (!target) return;
    var tx = target[0] - p.pos[0], ty = target[1] - p.pos[1], tz = target[2] - p.pos[2];
    var tl = Math.sqrt(tx * tx + ty * ty + tz * tz);
    if (tl < 1e-4) return;
    var speed = Math.max(1, M.v3len(p.vel));
    var k = Math.min(1, homing * dt);
    p.vel[0] += ((tx / tl) * speed - p.vel[0]) * k;
    p.vel[1] += ((ty / tl) * speed - p.vel[1]) * k;
    p.vel[2] += ((tz / tl) * speed - p.vel[2]) * k;
  }

  /* ======================================================================
   * Materiales y malla de respaldo
   * ==================================================================== */
  function materialFor(id) {
    var key = id || 'mat_bolt_plasma';
    if (materialCache[key]) return materialCache[key];
    var mat = null;
    var T = BS.Textures;
    if (T && typeof T.getMaterial === 'function') {
      try { mat = T.getMaterial(key); } catch (e) { mat = null; }
    }
    if (!mat) {
      mat = {
        id: key, map: null, normalMap: null, emissiveMap: null,
        uvScale: [1, 1], specular: 0.2, normalStrength: 0,
        emissive: [0.5, 0.9, 1.0], emissiveIntensity: 1.6,
        blend: 'add', depthWrite: false, doubleSided: true, program: 'basic'
      };
    }
    materialCache[key] = mat;
    return mat;
  }

  function ensureFallbackMesh() {
    if (fallbackMesh) return;
    if (!BS.Mesh || typeof BS.Mesh.create !== 'function') return;
    var b = BS.Mesh.create();
    b.color = [0.7, 0.92, 1.0];
    b.emissive = 1;
    b.sphere([0, 0, 0], 0.14, 8, 6);
    b.emissive = 0;
    try { fallbackMesh = BS.Mesh.toGL(b); } catch (e) { fallbackMesh = null; }
  }

  BS.Projectiles = Projectiles;

  /* ======================================================================
   * Test: projectiles:noTunnel (§3.13)
   * ----------------------------------------------------------------------
   * Nivel mínimo con un muro fino y un "enemigo" en la trayectoria. Se lanza
   * un proyectil a velocidad altísima y se comprueba que NO atraviesa el muro
   * (subpaso) y que sí alcanza al enemigo. Todo hermético (sin GPU).
   * ==================================================================== */
  if (BS.Debug && typeof BS.Debug.register === 'function') {
    BS.Debug.register('projectiles:noTunnel', function () {
      /* nivel mínimo: un muro fino y un suelo */
      function makeLevel(wallX, wallW) {
        var wall = {
          type: 'box', mat: 'mat_metal_panel', flags: 1,
          min: new Float32Array([wallX, -1, -1]), max: new Float32Array([wallX + wallW, 3, 1])
        };
        var floor = {
          type: 'box', mat: 'mat_concrete_floor', flags: 1,
          min: new Float32Array([-20, -0.5, -20]), max: new Float32Array([20, 0, 20])
        };
        var cols = [wall, floor];
        return {
          colliders: cols,
          queryColliders: function (aabb, out) {
            out = out || [];
            out.length = 0;
            for (var i = 0; i < cols.length; i++) {
              var c = cols[i];
              if (c.max[0] < aabb.min[0] || c.min[0] > aabb.max[0]) continue;
              if (c.max[1] < aabb.min[1] || c.min[1] > aabb.max[1]) continue;
              if (c.max[2] < aabb.min[2] || c.min[2] > aabb.max[2]) continue;
              out.push(c);
            }
            return out;
          },
          rampHeightAt: function (c) { return c.max[1]; }
        };
      }

      var impacts = [];
      function mkCtx(level, entityHit) {
        return {
          level: level,
          events: BS.Events,
          audio: { play: function () {} },
          fx: {
            impact: function (pos, n, kind) { impacts.push({ pos: [pos[0], pos[1], pos[2]], kind: kind }); },
            explosion: function () {}, trail: function () {}, tempLight: function () {}
          },
          combat: {
            raycast: function (o, d, maxD, mask, ignore) {
              if (!entityHit) return null;
              /* enemigo "caja" en x=2 */
              var t = (2 - o[0]) / (d[0] || 1e-9);
              if (t < 0 || t > maxD) return null;
              return {
                t: t, enemy: entityHit,
                point: new Float32Array([o[0] + d[0] * t, o[1], o[2] + d[2] * t]),
                normal: new Float32Array([-d[0], -d[1], -d[2]])
              };
            },
            areaDamage: function () { return 0; },
            damage: function () { return { killed: false }; }
          }
        };
      }

      function fireOnce(level, entityHit, speed) {
        impacts.length = 0;
        var c = mkCtx(level, entityHit);
        BS.Projectiles.init(c);
        BS.Projectiles.spawn({
          pos: [0, 0.9, 0], vel: [speed, 0, 0],
          damage: 12, speed: speed, life: 5, radius: 0.2, gravity: 0,
          owner: 'player', ownerRef: null,
          material: 'mat_bolt_plasma', color: [0.5, 0.9, 1.0], trail: false
        });
        /* varios pasos, pero con deltas enormes (prueba de túnel) */
        for (var i = 0; i < 4; i++) BS.Projectiles.update(0.05);
        return { alive: BS.Projectiles.count(), impacts: impacts.slice() };
      }

      /* 1) muro fino (0.4 m) a 200 m/s -> delta 10 m/paso */
      var r1 = fireOnce(makeLevel(5, 0.4), null, 200);
      var hitWallA = r1.alive === 0 && r1.impacts.length >= 1 &&
        r1.impacts[0].pos[0] <= 5.4 + 0.25;

      /* 2) muro ultrafino (0.06 m): el segmento debe cazarlo igualmente */
      var r2 = fireOnce(makeLevel(5, 0.06), null, 300);
      var hitWallB = r2.alive === 0 && r2.impacts.length >= 1 &&
        r2.impacts[0].pos[0] <= 5.06 + 0.25;

      /* 3) enemigo en la trayectoria: impacta antes que el muro */
      var dummy = { pos: new Float32Array([2, 0.9, 0]), type: 'drone', alive: true, hp: 40 };
      var r3 = fireOnce(makeLevel(5, 0.4), dummy, 60);
      var hitEnemy = r3.alive === 0 && r3.impacts.length >= 1 && r3.impacts[0].kind === 'flesh';

      /* 4) la fórmula de subpasos respeta el tope de 4 */
      var stepsOk = BS.Projectiles._stepsFor(100, 0.2) === 4 &&
        BS.Projectiles._stepsFor(0.01, 0.2) === 1;

      BS.Projectiles.dispose();

      return {
        ok: hitWallA && hitWallB && hitEnemy && stepsOk,
        muroFino: hitWallA,
        muroUltrafino: hitWallB,
        impactaEnemigo: hitEnemy,
        subpasosOk: stepsOk,
        impactos: { a: r1.impacts.length, b: r2.impacts.length, c: r3.impacts.length }
      };
    });
  }

})(window.BS = window.BS || {});
