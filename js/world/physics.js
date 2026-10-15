/* ===========================================================================
 * BLACKSITE: LAST SIGNAL  —  js/world/physics.js
 * ---------------------------------------------------------------------------
 * Propósito : física de cuerpos en caja (AABB) contra la geometría del nivel:
 *             - moveBox(): barrido por ejes (X -> Z -> Y) con step-up, soporte
 *               en rampas y detección de suelo/techo.
 *             - raycast(): rayo contra los colisionadores del mundo (máscara).
 *             - utilidades de solape/barrido para proyectiles y armas.
 *             - resolveOverlaps(): separación entre cuerpos (enemigos).
 * Depende de: js/core/util.js (BS.Math), js/world/level.js (colisionadores).
 * Expone    : BS.Physics
 * Notas     : RAMPS = soporte vertical (nunca bloquean lateralmente).
 *             El algoritmo es de barrido exacto: no hay túnel a alta velocidad.
 *             Reutiliza buffers scratch de módulo: los arrays devueltos por
 *             raycast() son NUEVOS (seguros de guardar), pero no son
 *             reentrantes entre llamadas anidadas.
 * =========================================================================== */
(function (BS) {
  'use strict';

  var M = BS.Math;

  /* --- constantes ------------------------------------------------------ */
  var SKIN = 0.02;              /* separación de seguridad al detenerse */
  var DEFAULT_STEP = 0.45;      /* altura de peldaño por defecto */
  var EPS = 1e-6;
  var MAX_RAY = 512;            /* alcance máximo de un rayo (m) */
  var GATE = 0.03;              /* tolerancia de "a ras" */
  var LIP = 0.06;               /* rebordes más bajos que esto no frenan */

  /* --- máscaras (§3.12) ----------------------------------------------- */
  var MASK = { WORLD: 1, ENEMY: 2, PLAYER: 4, PICKUP: 8, PROJECTILE: 16, PROP: 32 };

  /* --- scratch reutilizado (no reentrante) ---------------------------- */
  var _qOut = [];
  var _bMin = new Float32Array(3);
  var _bMax = new Float32Array(3);
  var _qMin = new Float32Array(3);
  var _qMax = new Float32Array(3);
  var _d3 = new Float32Array(3);
  var _wallNormal = new Float32Array(3);
  var _groundNormal = new Float32Array([0, 1, 0]);
  var _swOut = { blocked: false, collider: null, normal: new Float32Array(3) };
  var _res = {
    pos: null, onGround: false, hitCeiling: false, wallHit: false,
    wallNormal: _wallNormal, steppedUp: false, landed: false,
    groundNormal: _groundNormal, _groundCollider: null
  };

  function num(v, d) {
    var n = +v;
    return isFinite(n) ? n : d;
  }

  /* ======================================================================
   * Consulta de colisionadores (broad phase)
   * ----------------------------------------------------------------------
   * Usa la rejilla hash del nivel si existe; si no (niveles de prueba
   * montados a mano) recorre linealmente `level.colliders`.
   * La rejilla puede devolver colisionadores de relleno: SIEMPRE hay que
   * hacer la comprobación exacta después.
   * ==================================================================== */
  function queryInto(level, min, max, out) {
    out.length = 0;
    if (!level) return out;
    if (level.colliderGrid && typeof level.colliderGrid.query === 'function') {
      level.colliderGrid.query(min, max, out);
      return out;
    }
    var list = level.colliders;
    if (!list) return out;
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      if (max[0] < c.min[0] || min[0] > c.max[0]) continue;
      if (max[1] < c.min[1] || min[1] > c.max[1]) continue;
      if (max[2] < c.min[2] || min[2] > c.max[2]) continue;
      out.push(c);
    }
    return out;
  }

  /* ======================================================================
   * Rampas
   * ==================================================================== */
  /** Altura de la superficie de una rampa en (x,z). Mismo criterio que level.js. */
  function rampSurfaceY(c, x, z) {
    var w = c.max[0] - c.min[0];
    var d = c.max[2] - c.min[2];
    var t;
    if (c.axis === '+x') t = w > 0 ? (x - c.min[0]) / w : 0;
    else if (c.axis === '-x') t = w > 0 ? (c.max[0] - x) / w : 0;
    else if (c.axis === '+z') t = d > 0 ? (z - c.min[2]) / d : 0;
    else t = d > 0 ? (c.max[2] - z) / d : 0;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
    return c.y0 + (c.y1 - c.y0) * t;
  }

  /** Normal (hacia arriba) de la superficie de una rampa. */
  function rampNormal(c, out) {
    var w = c.max[0] - c.min[0];
    var d = c.max[2] - c.min[2];
    var alongX = (c.axis === '+x' || c.axis === '-x');
    var span = alongX ? w : d;
    var s = (c.y1 - c.y0) / Math.max(0.001, span);
    var dir = (c.axis === '+x' || c.axis === '+z') ? 1 : -1;
    out[0] = alongX ? -dir * s : 0;
    out[1] = 1;
    out[2] = alongX ? 0 : -dir * s;
    var l = Math.sqrt(out[0] * out[0] + 1 + out[2] * out[2]);
    out[0] /= l; out[1] /= l; out[2] /= l;
    return out;
  }

  /* ======================================================================
   * Solapes y encaje
   * ==================================================================== */
  /** ¿Cabe el cuerpo (centro cx,cy,cz) sin penetrar ningún sólido (rampas aparte)? */
  function fits(level, cx, cy, cz, r, h) {
    var hy = h * 0.5;
    _bMin[0] = cx - r; _bMin[1] = cy - hy; _bMin[2] = cz - r;
    _bMax[0] = cx + r; _bMax[1] = cy + hy; _bMax[2] = cz + r;
    queryInto(level, _bMin, _bMax, _qOut);
    for (var i = 0; i < _qOut.length; i++) {
      var c = _qOut[i];
      if (c.type === 'ramp') continue;                 /* las rampas no bloquean */
      if (_bMax[0] <= c.min[0] + EPS || _bMin[0] >= c.max[0] - EPS) continue;
      if (_bMax[1] <= c.min[1] + EPS || _bMin[1] >= c.max[1] - EPS) continue;
      if (_bMax[2] <= c.min[2] + EPS || _bMin[2] >= c.max[2] - EPS) continue;
      return false;
    }
    return true;
  }

  /**
   * Saca el cuerpo de cualquier solidez con la que esté penetrando
   * (mínima traslación). Las rampas se ignoran: son suelo, no muro.
   */
  function depenetrate(level, body, r, h) {
    var hy = h * 0.5;
    for (var it = 0; it < 3; it++) {
      var px = body.pos[0], py = body.pos[1], pz = body.pos[2];
      _bMin[0] = px - r; _bMin[1] = py - hy; _bMin[2] = pz - r;
      _bMax[0] = px + r; _bMax[1] = py + hy; _bMax[2] = pz + r;
      queryInto(level, _bMin, _bMax, _qOut);
      var moved = false;
      for (var i = 0; i < _qOut.length; i++) {
        var c = _qOut[i];
        if (c.type === 'ramp') continue;
        var penX = Math.min(_bMax[0], c.max[0]) - Math.max(_bMin[0], c.min[0]);
        if (penX <= EPS) continue;
        var penY = Math.min(_bMax[1], c.max[1]) - Math.max(_bMin[1], c.min[1]);
        if (penY <= EPS) continue;
        var penZ = Math.min(_bMax[2], c.max[2]) - Math.max(_bMin[2], c.min[2]);
        if (penZ <= EPS) continue;
        if (penY <= penX && penY <= penZ) {
          var cy = (c.min[1] + c.max[1]) * 0.5;
          body.pos[1] += (py >= cy ? 1 : -1) * (penY + SKIN);
        } else if (penX <= penZ) {
          var cx = (c.min[0] + c.max[0]) * 0.5;
          body.pos[0] += (px >= cx ? 1 : -1) * (penX + SKIN);
        } else {
          var cz = (c.min[2] + c.max[2]) * 0.5;
          body.pos[2] += (pz >= cz ? 1 : -1) * (penZ + SKIN);
        }
        moved = true;
        break;                                          /* recomputa con la nueva posición */
      }
      if (!moved) break;
    }
  }

  /**
   * Barrido de la AABB del cuerpo por un eje HORIZONTAL (0 = X, 2 = Z).
   * Devuelve el alcance real (m) y rellena `out` (blocked, collider, normal).
   * Las rampas nunca bloquean en horizontal.
   */
  function sweepAxis(level, px, py, pz, r, h, axis, amount, out) {
    out.blocked = false;
    out.collider = null;
    out.t = 1;
    out.normal[0] = 0; out.normal[1] = 0; out.normal[2] = 0;
    if (amount === 0) return 0;

    var hy = h * 0.5;
    _bMin[0] = px - r; _bMin[1] = py - hy; _bMin[2] = pz - r;
    _bMax[0] = px + r; _bMax[1] = py + hy; _bMax[2] = pz + r;
    _d3[0] = 0; _d3[1] = 0; _d3[2] = 0; _d3[axis] = amount;

    var q0x = _bMin[0] + (_d3[0] < 0 ? _d3[0] : 0);
    var q1x = _bMax[0] + (_d3[0] > 0 ? _d3[0] : 0);
    var q0y = _bMin[1] + (_d3[1] < 0 ? _d3[1] : 0);
    var q1y = _bMax[1] + (_d3[1] > 0 ? _d3[1] : 0);
    var q0z = _bMin[2] + (_d3[2] < 0 ? _d3[2] : 0);
    var q1z = _bMax[2] + (_d3[2] > 0 ? _d3[2] : 0);
    _qMin[0] = q0x; _qMin[1] = q0y; _qMin[2] = q0z;
    _qMax[0] = q1x; _qMax[1] = q1y; _qMax[2] = q1z;
    queryInto(level, _qMin, _qMax, _qOut);

    var tBest = 1, best = null;
    for (var i = 0; i < _qOut.length; i++) {
      var c = _qOut[i];
      if (c.type === 'ramp') continue;
      /* un obstáculo por debajo de los pies o por encima de la cabeza no frena */
      if (c.max[1] <= _bMin[1] + LIP) continue;
      if (c.min[1] >= _bMax[1] - SKIN) continue;
      var t = M.aabbSweepAABB(_bMin, _bMax, _d3, c.min, c.max);
      if (t >= 0 && t < tBest) { tBest = t; best = c; }
    }

    if (!best) return amount;

    out.blocked = true;
    out.collider = best;
    out.t = tBest;
    out.normal[axis] = amount > 0 ? -1 : 1;
    var travel = amount * tBest;
    travel += (amount > 0 ? -SKIN : SKIN);
    if (amount > 0 && travel < 0) travel = 0;
    if (amount < 0 && travel > 0) travel = 0;
    return travel;
  }

  /**
   * Soporte más alto bajo el cuerpo en (x,z): devuelve la altura del suelo
   * dentro de la banda [fromFeet - 0.2, fromFeet + maxRise + 0.02].
   * -Infinity si no hay nada.
   */
  function topSupport(level, x, z, fromFeet, maxRise, r) {
    _qMin[0] = x - r; _qMin[1] = fromFeet - 0.2; _qMin[2] = z - r;
    _qMax[0] = x + r; _qMax[1] = fromFeet + maxRise + 0.2; _qMax[2] = z + r;
    queryInto(level, _qMin, _qMax, _qOut);
    var best = -Infinity;
    for (var i = 0; i < _qOut.length; i++) {
      var c = _qOut[i];
      if (!(x + r > c.min[0] && x - r < c.max[0] &&
        z + r > c.min[2] && z - r < c.max[2])) continue;
      var top;
      if (c.type === 'ramp') {
        var sx = x < c.min[0] ? c.min[0] : (x > c.max[0] ? c.max[0] : x);
        var sz = z < c.min[2] ? c.min[2] : (z > c.max[2] ? c.max[2] : z);
        top = rampSurfaceY(c, sx, sz);
      } else {
        top = c.max[1];
      }
      if (top > fromFeet + maxRise + 0.02) continue;
      if (top < fromFeet - 0.2) continue;
      if (top > best) best = top;
    }
    return best;
  }

  /** Eje horizontal: barrido + step-up (levantar y avanzar si cabe). */
  function sweepHorizontal(level, body, axis, amount, r, h, stepH, res) {
    if (amount === 0) return 0;
    var px = body.pos[0], py = body.pos[1], pz = body.pos[2];
    var travel = sweepAxis(level, px, py, pz, r, h, axis, amount, _swOut);

    if (!_swOut.blocked) {
      if (axis === 0) body.pos[0] = px + travel;
      else body.pos[2] = pz + travel;
      return travel;
    }

    /* --- intento de subir un peldaño ---
     * Sólo se avanza un poco más allá del punto de contacto (nunca el delta
     * completo): así no se "salta" un muro alto ni un obstáculo fino. */
    if (stepH > 0) {
      var contact = amount * _swOut.t;                    /* con signo */
      var adv = Math.min(Math.abs(amount - contact), r + 0.05);
      var probe = contact + (amount > 0 ? adv : -adv);
      var nx = px + (axis === 0 ? probe : 0);
      var nz = pz + (axis === 2 ? probe : 0);
      var feet = py - h * 0.5;
      var liftFeet = feet + stepH;
      if (fits(level, nx, liftFeet + h * 0.5, nz, r, h)) {
        var sup = topSupport(level, nx, nz, feet, stepH, r);
        /* debe haber un peldaño REAL (más alto que los pies) */
        if (isFinite(sup) && sup >= feet + 0.02) {
          body.pos[0] = nx;
          body.pos[2] = nz;
          body.pos[1] = sup + h * 0.5;
          res.steppedUp = true;
          return probe;
        }
      }
    }

    /* --- choque real contra un muro --- */
    if (axis === 0) body.pos[0] = px + travel;
    else body.pos[2] = pz + travel;
    res.wallHit = true;
    _wallNormal[0] = 0; _wallNormal[1] = 0; _wallNormal[2] = 0;
    _wallNormal[axis] = amount > 0 ? -1 : 1;
    return travel;
  }

  /**
   * Eje vertical (Y). Resuelve suelo (incluidas rampas), techo y aterrizajes.
   */
  function moveY(level, body, dy, r, h, stepH, res, wasOnGround) {
    var hy = h * 0.5;
    var px = body.pos[0], py = body.pos[1], pz = body.pos[2];
    var ignoreRamp = !!body.ignoreRamp;
    var feet = py - hy;
    var head = py + hy;
    var newFeet = feet + dy;
    var x0 = px - r, x1 = px + r, z0 = pz - r, z1 = pz + r;

    _qMin[0] = x0; _qMin[1] = Math.min(newFeet, feet) - 0.25; _qMin[2] = z0;
    _qMax[0] = x1; _qMax[1] = Math.max(newFeet + h, head) + 0.25; _qMax[2] = z1;
    queryInto(level, _qMin, _qMax, _qOut);

    var supportY = -Infinity, supportCol = null, supportRamp = false;
    var ceilY = Infinity, ceilCol = null;

    for (var i = 0; i < _qOut.length; i++) {
      var c = _qOut[i];
      if (!(x1 > c.min[0] && x0 < c.max[0] && z1 > c.min[2] && z0 < c.max[2])) continue;
      var isRamp = (c.type === 'ramp');
      if (isRamp && ignoreRamp) continue;

      var top;
      if (isRamp) {
        var sx = px < c.min[0] ? c.min[0] : (px > c.max[0] ? c.max[0] : px);
        var sz = pz < c.min[2] ? c.min[2] : (pz > c.max[2] ? c.max[2] : pz);
        top = rampSurfaceY(c, sx, sz);
      } else {
        top = c.max[1];
      }

      if (dy <= 0) {
        /* candidato a suelo: no por encima de la rodilla, no por debajo del destino */
        if (top <= feet + stepH + GATE && top >= newFeet - GATE) {
          if (top > supportY) { supportY = top; supportCol = c; supportRamp = isRamp; }
        }
      }
      if (dy > 0) {
        /* candidato a techo: por encima de los pies y dentro del recorrido */
        if (c.min[1] >= feet + GATE && c.min[1] < newFeet + h + GATE) {
          if (c.min[1] < ceilY) { ceilY = c.min[1]; ceilCol = c; }
        }
      }
    }

    if (dy > 0) {
      if (ceilCol) {
        var newHead = Math.min(head + dy, ceilY);
        body.pos[1] = newHead - hy;
        res.hitCeiling = true;
      } else {
        body.pos[1] = py + dy;
      }
      res.onGround = false;
    } else {
      var targetFeet = newFeet;
      if (supportCol) {
        targetFeet = supportY;
        res.onGround = true;
        if (!wasOnGround) res.landed = true;
        res._groundCollider = supportCol;
        if (supportRamp) rampNormal(supportCol, _groundNormal);
        else { _groundNormal[0] = 0; _groundNormal[1] = 1; _groundNormal[2] = 0; }
      } else {
        res.onGround = false;
      }
      body.pos[1] = targetFeet + hy;
    }
  }

  /* ======================================================================
   * moveBox — API principal
   * ==================================================================== */
  function moveBox(level, body, delta, opts) {
    opts = opts || {};
    var res = _res;
    res.pos = null;
    res.onGround = false;
    res.hitCeiling = false;
    res.wallHit = false;
    res.steppedUp = false;
    res.landed = false;
    res._groundCollider = null;
    _wallNormal[0] = 0; _wallNormal[1] = 0; _wallNormal[2] = 0;
    _groundNormal[0] = 0; _groundNormal[1] = 1; _groundNormal[2] = 0;

    if (!body || !body.pos) return res;

    var r = num(body.radius, 0.35);
    var h = num(body.height, 1.8);
    var stepH = num(opts.stepHeight, num(body.stepHeight, DEFAULT_STEP));
    var grav = (opts.gravity && opts.dt) ? (num(opts.gravity, 0) * num(opts.dt, 0)) : 0;

    var dx = num(delta ? delta[0] : 0, 0);
    var dy = num(delta ? delta[1] : 0, 0) + grav;
    var dz = num(delta ? delta[2] : 0, 0);

    var hasCol = !!(level && (level.colliderGrid || (level.colliders && level.colliders.length)));
    if (!hasCol) {
      body.pos[0] += dx; body.pos[1] += dy; body.pos[2] += dz;
      res.pos = body.pos;
      res.onGround = !!body.onGround;
      return res;
    }

    var wasOnGround = !!body.onGround;

    depenetrate(level, body, r, h);
    sweepHorizontal(level, body, 0, dx, r, h, stepH, res);
    sweepHorizontal(level, body, 2, dz, r, h, stepH, res);
    moveY(level, body, dy, r, h, stepH, res, wasOnGround);

    body.onGround = res.onGround;
    res.pos = body.pos;
    return res;
  }

  /* ======================================================================
   * Rayos
   * ==================================================================== */
  function raycast(level, origin, dir, maxDist, mask) {
    if (!level || !origin || !dir) return null;
    var len = Math.sqrt(dir[0] * dir[0] + dir[1] * dir[1] + dir[2] * dir[2]);
    if (len < 1e-9) return null;
    var inv = 1 / len;
    _d3[0] = dir[0] * inv; _d3[1] = dir[1] * inv; _d3[2] = dir[2] * inv;

    var limit = num(maxDist, MAX_RAY);
    if (limit <= 0) return null;
    if (limit > MAX_RAY) limit = MAX_RAY;

    var ox = origin[0], oy = origin[1], oz = origin[2];
    var ex = ox + _d3[0] * limit, ey = oy + _d3[1] * limit, ez = oz + _d3[2] * limit;
    _qMin[0] = Math.min(ox, ex); _qMin[1] = Math.min(oy, ey); _qMin[2] = Math.min(oz, ez);
    _qMax[0] = Math.max(ox, ex); _qMax[1] = Math.max(oy, ey); _qMax[2] = Math.max(oz, ez);
    queryInto(level, _qMin, _qMax, _qOut);

    var m = (mask === undefined || mask === null) ? (MASK.WORLD | MASK.PROP) : (mask | 0);
    var tBest = Infinity, best = null;
    for (var i = 0; i < _qOut.length; i++) {
      var c = _qOut[i];
      if (m && c.flags && (c.flags & m) === 0) continue;
      var t = M.rayAABB(origin, _d3, c.min, c.max, limit);
      if (t < 0 || t > limit || t >= tBest) continue;
      /* rampas: si el rayo pasa por encima de la superficie, no la alcanza */
      if (c.type === 'ramp') {
        var hx = ox + _d3[0] * t, hz = oz + _d3[2] * t;
        if (oy + _d3[1] * t > rampSurfaceY(c, hx, hz) + 0.001) continue;
      }
      tBest = t; best = c;
    }
    if (!best) return null;

    var px = ox + _d3[0] * tBest, py = oy + _d3[1] * tBest, pz = oz + _d3[2] * tBest;
    var nrm = new Float32Array(3);
    if (best.type === 'ramp') {
      rampNormal(best, nrm);
      if (_d3[1] > 0) { nrm[0] = -nrm[0]; nrm[1] = -nrm[1]; nrm[2] = -nrm[2]; }
    } else {
      var pad = 1e-3;
      if (Math.abs(px - best.min[0]) < pad) nrm[0] = -1;
      else if (Math.abs(px - best.max[0]) < pad) nrm[0] = 1;
      else if (Math.abs(py - best.min[1]) < pad) nrm[1] = -1;
      else if (Math.abs(py - best.max[1]) < pad) nrm[1] = 1;
      else if (Math.abs(pz - best.min[2]) < pad) nrm[2] = -1;
      else nrm[2] = 1;
    }
    return {
      t: tBest,
      distance: tBest,
      point: new Float32Array([px, py, pz]),
      normal: nrm,
      collider: best,
      ref: best
    };
  }

  function raycastAABBList(items, origin, dir, maxDist) {
    if (!items || !items.length || !origin || !dir) return null;
    var len = Math.sqrt(dir[0] * dir[0] + dir[1] * dir[1] + dir[2] * dir[2]);
    if (len < 1e-9) return null;
    var inv = 1 / len;
    _d3[0] = dir[0] * inv; _d3[1] = dir[1] * inv; _d3[2] = dir[2] * inv;
    var limit = num(maxDist, MAX_RAY);

    var tBest = Infinity, best = null;
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (!it || !it.aabb) continue;
      var t = M.rayAABB(origin, _d3, it.aabb.min, it.aabb.max, limit);
      if (t >= 0 && t <= limit && t < tBest) { tBest = t; best = it; }
    }
    if (!best) return null;
    return {
      t: tBest,
      distance: tBest,
      point: new Float32Array([origin[0] + _d3[0] * tBest, origin[1] + _d3[1] * tBest,
        origin[2] + _d3[2] * tBest]),
      normal: new Float32Array([-_d3[0], -_d3[1], -_d3[2]]),
      collider: null,
      ref: (best.ref !== undefined ? best.ref : best)
    };
  }

  function sphereOverlapList(items, center, radius) {
    var out = [];
    if (!items || !center) return out;
    var r = num(radius, 0.5);
    var r2 = r * r;
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (!it || !it.aabb) continue;
      var a = it.aabb;
      var cx = center[0] < a.min[0] ? a.min[0] : (center[0] > a.max[0] ? a.max[0] : center[0]);
      var cy = center[1] < a.min[1] ? a.min[1] : (center[1] > a.max[1] ? a.max[1] : center[1]);
      var cz = center[2] < a.min[2] ? a.min[2] : (center[2] > a.max[2] ? a.max[2] : center[2]);
      var dx = center[0] - cx, dy = center[1] - cy, dz = center[2] - cz;
      if (dx * dx + dy * dy + dz * dz <= r2) out.push(it.ref !== undefined ? it.ref : it);
    }
    return out;
  }

  function sweepAABBvsAABB(minA, maxA, minB, maxB, delta) {
    return M.aabbSweepAABB(minA, maxA, delta, minB, maxB);
  }

  function groundCheck(level, body, epsilon) {
    if (!level || !body || !body.pos) return false;
    var r = num(body.radius, 0.35);
    var h = num(body.height, 1.8);
    var feet = body.pos[1] - h * 0.5;
    var tol = (epsilon === undefined || epsilon === null) ? 0.12 : Math.max(0, num(epsilon, 0.12));
    var top = topSupport(level, body.pos[0], body.pos[2], feet, Math.max(tol, 0.05), r);
    if (!isFinite(top)) return false;
    return top >= feet - tol - 1e-3 && top <= feet + GATE;
  }

  /**
   * Separación entre cuerpos (enemigos). Mutá `body.pos` in situ y no lanza.
   */
  function resolveOverlaps(level, bodies, iterations) {
    if (!bodies || bodies.length < 2) return;
    var iters = (iterations === undefined || iterations === null) ? 2 : (iterations | 0);
    if (iters < 1) iters = 1;
    for (var it = 0; it < iters; it++) {
      for (var i = 0; i < bodies.length; i++) {
        var a = bodies[i];
        if (!a || !a.pos) continue;
        for (var j = i + 1; j < bodies.length; j++) {
          var b = bodies[j];
          if (!b || !b.pos) continue;
          var hh = ((num(a.height, 1.0) + num(b.height, 1.0)) * 0.5);
          if (Math.abs(a.pos[1] - b.pos[1]) > hh) continue;
          var dx = a.pos[0] - b.pos[0], dz = a.pos[2] - b.pos[2];
          var minD = num(a.radius, 0.4) + num(b.radius, 0.4);
          var d2 = dx * dx + dz * dz;
          if (d2 >= minD * minD) continue;
          var d = Math.sqrt(d2);
          var nx, nz;
          if (d < 1e-4) { nx = 1; nz = 0; d = 0; }
          else { nx = dx / d; nz = dz / d; }
          var push = (minD - d) * 0.5 + 0.005;
          a.pos[0] += nx * push; a.pos[2] += nz * push;
          b.pos[0] -= nx * push; b.pos[2] -= nz * push;
        }
      }
    }
  }

  /* ======================================================================
   * API pública
   * ==================================================================== */
  BS.Physics = {
    MASK: MASK,
    SKIN: SKIN,
    STEP_HEIGHT: DEFAULT_STEP,

    moveBox: moveBox,
    raycast: raycast,
    raycastAABBList: raycastAABBList,
    sphereOverlapList: sphereOverlapList,
    sweepAABBvsAABB: sweepAABBvsAABB,
    groundCheck: groundCheck,
    resolveOverlaps: resolveOverlaps,

    /* utilidades expuestas (las usan tests y depuración) */
    rampSurfaceY: rampSurfaceY,
    queryInto: queryInto,
    fits: fits
  };

  /* ======================================================================
   * Nivel mínimo determinista para los tests (sin GPU ni LevelData)
   * ==================================================================== */
  function miniLevel() {
    var cols = [];
    function F(a) { return new Float32Array(a); }
    function box(min, max) {
      cols.push({ type: 'box', min: F(min), max: F(max), mat: 'mat_concrete_wall', flags: 1, _stamp: 0 });
    }
    function ramp(min, max, axis) {
      cols.push({
        type: 'ramp', min: F(min), max: F(max), axis: axis,
        y0: min[1], y1: max[1], mat: 'mat_metal_floor', flags: 1, _stamp: 0
      });
    }
    box([-30, -2, -30], [30, 0, 30]);       /* suelo (top 0) */
    box([3, 0, -2], [5, 0.4, 2]);           /* escalón de 0.40 m */
    box([7.5, 0, -10], [8.5, 3, 10]);       /* muro de 3 m */
    ramp([-6, 0, -6], [-2, 1.0, -2], '-x'); /* rampa: sube hacia -x */
    box([-10, 0, -6], [-6, 1.0, -2]);       /* plataforma (top 1.0) */
    box([10, 2.5, -6], [16, 2.9, 6]);       /* losa baja (techo) */
    box([20, 0, -10], [20.4, 3, 10]);       /* muro fino de 0.40 m */
    box([12, 0, -10], [14, 0.8, 10]);       /* repisa de 0.80 m (demasiado alta) */
    return {
      colliders: cols,
      colliderGrid: null,
      bounds: { min: F([-30, -2, -30]), max: F([30, 3, 30]) }
    };
  }

  function mkBody(x, y, z) {
    return {
      pos: new Float32Array([x, y, z]),
      vel: new Float32Array(3),
      radius: 0.4,
      height: 1.8,
      onGround: false,
      gravityScale: 1,
      stepHeight: DEFAULT_STEP,
      collideFlags: 0,
      ignoreRamp: false
    };
  }

  /* ======================================================================
   * Tests de auto-verificación (§3.12 / §8)
   * ==================================================================== */
  if (BS.Debug && typeof BS.Debug.register === 'function') {

    BS.Debug.register('physics:landing', function () {
      var lv = miniLevel();
      var b = mkBody(0, 5, 15);
      var dt = 1 / 60;
      var landed = false, frames = 0, supportCol = null;
      var d = new Float32Array(3);
      for (var i = 0; i < 400; i++) {
        frames++;
        b.vel[1] -= 22 * dt;
        d[0] = 0; d[1] = b.vel[1] * dt; d[2] = 0;
        var res = moveBox(lv, b, d, { gravity: 0, stepHeight: 0.45 });
        if (res.landed) { landed = true; supportCol = res._groundCollider; break; }
      }
      var feet = b.pos[1] - 0.9;
      /* seguir empujando hacia abajo no debe hundirlo */
      d[0] = 0; d[1] = -0.5; d[2] = 0;
      var res2 = moveBox(lv, b, d, { gravity: 0, stepHeight: 0.45 });
      var feet2 = b.pos[1] - 0.9;
      var ok = landed && b.onGround && Math.abs(feet) < 0.03 &&
        Math.abs(feet2) < 0.03 && !!supportCol;
      return {
        ok: ok,
        frames: frames,
        landed: landed,
        feet: +feet.toFixed(4),
        feetAfterPush: +feet2.toFixed(4),
        onGround: b.onGround,
        hitSupport: !!supportCol
      };
    });

    BS.Debug.register('physics:wall', function () {
      var lv = miniLevel();
      var b = mkBody(0, 0.9, -6);
      var d = new Float32Array([12, 0, 0]);
      var res = moveBox(lv, b, d, { gravity: 0, stepHeight: 0.45 });
      var stoppedBefore = b.pos[0] <= 7.5 - 0.4 + 0.05;
      var notTunnel = b.pos[0] < 8.5;
      var normalOk = Math.abs(res.wallNormal[0] + 1) < 1e-3;
      /* el rayo debe detenerse en la cara -x del muro (t = 7.5) */
      var hit = raycast(lv, new Float32Array([0, 0.9, -6]), new Float32Array([1, 0, 0]), 60, MASK.WORLD);
      var rayOk = !!hit && Math.abs(hit.t - 7.5) < 0.05 && hit.normal[0] < -0.9;
      var ok = res.wallHit && stoppedBefore && notTunnel && normalOk && rayOk;
      return {
        ok: ok,
        wallHit: res.wallHit,
        stoppedX: +b.pos[0].toFixed(4),
        normalX: +res.wallNormal[0].toFixed(3),
        rayT: hit ? +hit.t.toFixed(4) : null,
        rayOk: rayOk
      };
    });

    BS.Debug.register('physics:step', function () {
      var lv = miniLevel();
      var b = mkBody(0, 0.9, 0);
      var d = new Float32Array([4, 0, 0]);
      var res = moveBox(lv, b, d, { gravity: 0, stepHeight: 0.45 });
      var feet = b.pos[1] - 0.9;
      var climbed = Math.abs(feet - 0.4) < 0.05;
      var advanced = b.pos[0] > 3.0;
      var grounded = b.onGround;
      var ok = res.steppedUp && climbed && advanced && grounded;
      /* la repisa de 0.80 m NO debe poder subirse */
      var b2 = mkBody(11, 0.9, 0);
      var r2 = moveBox(lv, b2, new Float32Array([5, 0, 0]), { gravity: 0, stepHeight: 0.45 });
      var blockedHigh = b2.pos[0] < 12.5 && !r2.steppedUp;
      return {
        ok: ok && blockedHigh,
        steppedUp: res.steppedUp,
        feet: +feet.toFixed(4),
        x: +b.pos[0].toFixed(4),
        onGround: grounded,
        blockedHighLedge: blockedHigh
      };
    });

    BS.Debug.register('physics:noTunnel', function () {
      var lv = miniLevel();
      var b = mkBody(16, 0.9, -8);
      var res = moveBox(lv, b, new Float32Array([100, 0, 0]), { gravity: 0, stepHeight: 0.45 });
      /* moveBox devuelve el objeto COMPARTIDO _res: hay más abajo otra llamada
       * a moveBox (bloque b3) que lo machaca antes de que leamos el resultado.
       * Copiamos los campos relevantes a locales justo tras la primera llamada. */
      var wallHit = res.wallHit;
      var before = b.pos[0] < 20.0 && b.pos[0] > 19.0;
      /* rayo a 300 m/s equivalente: tampoco atraviesa */
      var hit = raycast(lv, new Float32Array([16, 0.9, -8]), new Float32Array([1, 0, 0]), 400, MASK.WORLD);
      var rayOk = !!hit && Math.abs(hit.t - 4.0) < 0.05;
      /* separación de cuerpos muta in situ y no lanza */
      var bA = mkBody(0, 0.9, 0), bB = mkBody(0.1, 0.9, 0);
      var before2 = bA.pos[0];
      resolveOverlaps(lv, [bA, bB], 2);
      var separated = Math.abs(bA.pos[0] - bB.pos[0]) > 0.1 && bA.pos[0] !== before2;
      /* groundCheck coherente tras aterrizar */
      var b3 = mkBody(0, 0.9, 15);
      moveBox(lv, b3, new Float32Array([0, -0.1, 0]), { gravity: 0, stepHeight: 0.45 });
      var gc = groundCheck(lv, b3, 0.12);
      var ok = wallHit && before && rayOk && separated && gc;
      return {
        ok: ok,
        wallHit: wallHit,
        stoppedX: +b.pos[0].toFixed(4),
        tunneled: b.pos[0] >= 20.0,
        rayT: hit ? +hit.t.toFixed(4) : null,
        separated: separated,
        groundCheck: gc
      };
    });
  } else if (BS.Log && BS.Log.warn) {
    BS.Log.warn('BS.Debug no disponible al cargar physics.js: los tests physics:* no se registran');
  }

})(window.BS = window.BS || {});
