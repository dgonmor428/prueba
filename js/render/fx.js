/* ===========================================================================
 * BLACKSITE: LAST SIGNAL  —  js/render/fx.js
 * ---------------------------------------------------------------------------
 * Propósito : sistema de efectos (partículas, trazadoras, humo, explosiones,
 *             destellos de boca, ondas de choque, luces temporales y sacudida
 *             de pantalla). TODOS los quads (partículas y trazadoras) viven en
 *             UN ÚNICO mesh dinámico y se dibujan en 1 sola draw call (§7.3):
 *             el billboard se calcula en CPU con los ejes de la matriz de
 *             vista y se vuelca con bufferSubData una vez por frame.
 *             Pools circulares de tamaño fijo (R20): cero `new` en el hot path.
 * Depende de: js/core/util.js (BS.Math, BS.Util, BS.Log), js/core/gl.js (BS.GL),
 *             js/core/textures.js (textura de partícula), js/render/renderer.js
 *             (solo la vista, vía renderer.getViewMatrix())
 * Expone    : BS.FX
 * =========================================================================== */
(function (BS) {
  'use strict';

  var M = BS.Math;
  var STRIDE = 36;
  var MAX_PARTICLES = 2000;      // techo absoluto del pool (R20)
  var DEFAULT_BUDGET = 900;      // partículas vivas objetivo (calidad media)
  var MAX_TEMP_LIGHTS = 8;

  var IDENTITY = M.m4identity(M.m4());

  function c255(v) {
    v = (v === undefined ? 1 : v) * 255;
    return v < 0 ? 0 : (v > 255 ? 255 : v | 0);
  }
  function rnd(a, b) { return a + Math.random() * (b - a); }

  /* ==========================================================================
   * Estado interno
   * ======================================================================== */
  var parts = [];          // pool de partículas (objetos reutilizados)
  var cursor = 0;
  var alive = 0;
  var budget = DEFAULT_BUDGET;
  var poolReady = false;

  var dyn = null;          // resultado de BS.GL.createDynamicMesh
  var mesh = null;         // dyn.mesh (o stub sin GL)
  var vbuf = null;         // ArrayBuffer de vértices
  var f32 = null;
  var u8 = null;
  var idx = null;
  var buffersReady = false;

  var lights = [];         // luces temporales
  var lightCount = 0;

  var shakeAmount = 0;
  var shakeLife = 0;
  var shakeMax = 1;
  var shakePhase = 0;

  var fxMaterial = null;
  var stubMesh = null;
  var pushesThisFrame = 0;

  /* ejes de la cámara reutilizados cada frame */
  var axRight = new Float32Array(3);
  var axUp = new Float32Array([0, 1, 0]);
  var axFwd = new Float32Array([0, 0, -1]);
  var tmpSide = new Float32Array(3);
  var tmpDir = new Float32Array(3);
  var minB = new Float32Array([1e9, 1e9, 1e9]);
  var maxB = new Float32Array([-1e9, -1e9, -1e9]);

  /* ==========================================================================
   * Inicialización perezosa
   * ======================================================================== */
  function ensurePool() {
    if (poolReady) return;
    for (var i = 0; i < MAX_PARTICLES; i++) {
      parts.push({
        alive: false, kind: 0,
        x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
        life: 0, maxLife: 1,
        size0: 0.1, size1: 0.1,
        r: 255, g: 255, b: 255, a0: 255, a1: 0,
        gravity: 0, drag: 0,
        dirx: 1, diry: 0, dirz: 0, halfLen: 0.2, width: 0.02
      });
    }
    poolReady = true;
  }

  function ensureBuffers() {
    if (buffersReady) return;
    vbuf = new ArrayBuffer(MAX_PARTICLES * 4 * STRIDE);
    f32 = new Float32Array(vbuf);
    u8 = new Uint8Array(vbuf);
    idx = new Uint16Array(MAX_PARTICLES * 6);
    buffersReady = true;
  }

  function ensureDyn() {
    if (dyn || !(BS.GL && BS.GL.gl && BS.GL.createDynamicMesh)) return;
    dyn = BS.GL.createDynamicMesh(MAX_PARTICLES * 4, MAX_PARTICLES * 6);
    if (dyn) mesh = dyn.mesh;
  }

  function material() {
    if (fxMaterial) return fxMaterial;
    var tex = (BS.Textures && typeof BS.Textures.get === 'function') ? BS.Textures.get('tex_particle') : null;
    fxMaterial = {
      id: 'mat_fx_particle',
      map: tex || null, normalMap: null, emissiveMap: null,
      uvScale: [1, 1], specular: 0, normalStrength: 0,
      emissive: [0, 0, 0], emissiveIntensity: 0,
      blend: 'add', depthWrite: false, doubleSided: true,
      program: 'sprite'
    };
    return fxMaterial;
  }

  function getStubMesh() {
    if (!stubMesh) {
      stubMesh = {
        vbo: null, ibo: null, indexCount: 6, indexType: 5123,
        vertexCount: 4, stride: STRIDE, dynamic: true,
        aabb: { min: new Float32Array([-1e4, -1e4, -1e4]), max: new Float32Array([1e4, 1e4, 1e4]) },
        attribs: true, stub: true
      };
    }
    return stubMesh;
  }

  function ensureAll() {
    ensurePool();
    ensureBuffers();
    ensureDyn();
  }

  /* ==========================================================================
   * Spawn / integración
   * ======================================================================== */
  function spawn() {
    ensurePool();
    if (alive >= budget) return null;
    var p = parts[cursor];
    cursor = (cursor + 1) % MAX_PARTICLES;
    if (!p.alive) alive++;
    p.alive = true;
    p.kind = 0;
    p.x = 0; p.y = 0; p.z = 0;
    p.vx = 0; p.vy = 0; p.vz = 0;
    p.life = 0.5; p.maxLife = 0.5;
    p.size0 = 0.1; p.size1 = 0.1;
    p.r = 255; p.g = 255; p.b = 255;
    p.a0 = 255; p.a1 = 0;
    p.gravity = 0; p.drag = 0;
    p.dirx = 1; p.diry = 0; p.dirz = 0;
    p.halfLen = 0.2; p.width = 0.02;
    return p;
  }

  /* ==========================================================================
   * Construcción de la geometría (billboards en CPU) y subida
   * ======================================================================== */
  function writeVertex(vi, x, y, z, u, v, r, g, b, a) {
    var f = vi * 9;
    f32[f] = x; f32[f + 1] = y; f32[f + 2] = z;
    f32[f + 3] = 0; f32[f + 4] = 0; f32[f + 5] = 0; // normal no usada por sprite
    f32[f + 6] = u; f32[f + 7] = v;
    var o = vi * STRIDE + 32;
    u8[o] = r; u8[o + 1] = g; u8[o + 2] = b; u8[o + 3] = a;
  }

  function updateAxes(renderer) {
    var v = null;
    if (renderer && typeof renderer.getViewMatrix === 'function') v = renderer.getViewMatrix();
    if (v && v.length >= 16) {
      axRight[0] = v[0]; axRight[1] = v[4]; axRight[2] = v[8];
      axUp[0] = v[1]; axUp[1] = v[5]; axUp[2] = v[9];
      axFwd[0] = -v[2]; axFwd[1] = -v[6]; axFwd[2] = -v[10];
    } else {
      axRight[0] = 1; axRight[1] = 0; axRight[2] = 0;
      axUp[0] = 0; axUp[1] = 1; axUp[2] = 0;
      axFwd[0] = 0; axFwd[1] = 0; axFwd[2] = -1;
    }
  }

  function buildGeometry() {
    var count = 0;
    minB[0] = minB[1] = minB[2] = 1e9;
    maxB[0] = maxB[1] = maxB[2] = -1e9;

    for (var i = 0; i < MAX_PARTICLES; i++) {
      var p = parts[i];
      if (!p.alive || p.life <= 0) continue;

      var frac = 1 - (p.life / (p.maxLife || 1)); // 0 al nacer, 1 al morir
      if (frac < 0) frac = 0; if (frac > 1) frac = 1;
      var size = p.size0 + (p.size1 - p.size0) * frac;
      var a = Math.round(p.a0 + (p.a1 - p.a0) * frac);
      if (a < 0) a = 0; if (a > 255) a = 255;
      var base = count * 4;

      if (p.kind === 1) {
        // trazadora: quad estirado a lo largo de p.dir, orientado hacia la cámara
        tmpDir[0] = p.dirx; tmpDir[1] = p.diry; tmpDir[2] = p.dirz;
        M.v3cross(tmpSide, tmpDir, axFwd);
        if (M.v3lenSq(tmpSide) < 1e-8) { tmpSide[0] = axRight[0]; tmpSide[1] = axRight[1]; tmpSide[2] = axRight[2]; }
        else M.v3norm(tmpSide, tmpSide);
        var hx = tmpDir[0] * p.halfLen, hy = tmpDir[1] * p.halfLen, hz = tmpDir[2] * p.halfLen;
        var sx = tmpSide[0] * p.width, sy = tmpSide[1] * p.width, sz = tmpSide[2] * p.width;
        writeVertex(base, p.x - hx - sx, p.y - hy - sy, p.z - hz - sz, 0, 0, p.r, p.g, p.b, a);
        writeVertex(base + 1, p.x + hx - sx, p.y + hy - sy, p.z + hz - sz, 1, 0, p.r, p.g, p.b, a);
        writeVertex(base + 2, p.x + hx + sx, p.y + hy + sy, p.z + hz + sz, 1, 1, p.r, p.g, p.b, a);
        writeVertex(base + 3, p.x - hx + sx, p.y - hy + sy, p.z - hz + sz, 0, 1, p.r, p.g, p.b, a);
      } else {
        // billboard orientado a la cámara
        var rx = axRight[0] * size, ry = axRight[1] * size, rz = axRight[2] * size;
        var ux = axUp[0] * size, uy = axUp[1] * size, uz = axUp[2] * size;
        writeVertex(base, p.x - rx - ux, p.y - ry - uy, p.z - rz - uz, 0, 0, p.r, p.g, p.b, a);
        writeVertex(base + 1, p.x + rx - ux, p.y + ry - uy, p.z + rz - uz, 1, 0, p.r, p.g, p.b, a);
        writeVertex(base + 2, p.x + rx + ux, p.y + ry + uy, p.z + rz + uz, 1, 1, p.r, p.g, p.b, a);
        writeVertex(base + 3, p.x - rx + ux, p.y - ry + uy, p.z - rz + uz, 0, 1, p.r, p.g, p.b, a);
      }

      var io = count * 6;
      idx[io] = base; idx[io + 1] = base + 1; idx[io + 2] = base + 2;
      idx[io + 3] = base; idx[io + 4] = base + 2; idx[io + 5] = base + 3;

      if (p.x < minB[0]) minB[0] = p.x;
      if (p.y < minB[1]) minB[1] = p.y;
      if (p.z < minB[2]) minB[2] = p.z;
      if (p.x > maxB[0]) maxB[0] = p.x;
      if (p.y > maxB[1]) maxB[1] = p.y;
      if (p.z > maxB[2]) maxB[2] = p.z;

      count++;
    }
    return count;
  }

  function uploadGeometry() {
    if (!dyn) return;
    var vertexCount = buildGeometry();
    var indexCount = vertexCount * 6;
    if (vertexCount === 0) {
      mesh.indexCount = 0;
      mesh.vertexCount = 0;
      return;
    }
    if (mesh) {
      mesh.aabb.min[0] = minB[0] - 1; mesh.aabb.min[1] = minB[1] - 1; mesh.aabb.min[2] = minB[2] - 1;
      mesh.aabb.max[0] = maxB[0] + 1; mesh.aabb.max[1] = maxB[1] + 1; mesh.aabb.max[2] = maxB[2] + 1;
    }
    dyn.uploadVertex(u8, vertexCount * 4);
    dyn.uploadIndex(idx, indexCount);
    if (BS.Renderer && typeof BS.Renderer.reportUpload === 'function') {
      BS.Renderer.reportUpload(vertexCount * 4 * STRIDE + indexCount * 2);
    }
  }

  /* ==========================================================================
   * API pública
   * ======================================================================== */
  var FX = {
    init: function (ctx) {
      ctx = ctx || {};
      FX._ctx = ctx;
      FX._renderer = ctx.renderer || null;
      ensurePool();
      ensureBuffers();
      ensureDyn();
      FX.reset();
      BS.Log.info('BS.FX.init OK (presupuesto=' + budget + ', modo=' + (dyn ? 'dinámico' : 'stub') + ')');
    },

    update: function (dt) {
      ensurePool();
      dt = Number(dt) || 0;
      if (dt < 0) dt = 0;
      if (dt > 0.1) dt = 0.1;
      var i, p;
      for (i = 0; i < MAX_PARTICLES; i++) {
        p = parts[i];
        if (!p.alive) continue;
        p.life -= dt;
        if (p.life <= 0) { p.alive = false; alive--; continue; }
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.z += p.vz * dt;
        p.vy += p.gravity * dt;
        if (p.drag > 0) {
          var d = 1 - Math.min(1, p.drag * dt);
          p.vx *= d; p.vy *= d; p.vz *= d;
        }
      }
      if (alive < 0) alive = 0;

      // luces temporales
      for (i = lightCount - 1; i >= 0; i--) {
        lights[i].life -= dt;
        if (lights[i].life <= 0) {
          lights[i] = lights[lightCount - 1];
          lights.pop();
          lightCount--;
        }
      }

      // sacudida
      shakePhase += dt;
      if (shakeLife > 0) {
        shakeLife -= dt;
        if (shakeLife <= 0) { shakeLife = 0; shakeAmount = 0; }
      }
    },

    beginFrame: function () {
      pushesThisFrame = 0;
    },

    /**
     * Dibuja todas las partículas vivas en UNA sola draw call.
     * Devuelve el número de draw calls emitidas (0 o 1).
     */
    render: function (renderer) {
      ensureAll();
      pushesThisFrame = 0;
      if (!renderer || alive <= 0) return 0;
      updateAxes(renderer);
      uploadGeometry();

      var useMesh = mesh || getStubMesh();
      if (dyn && mesh && mesh.indexCount === 0) return 0;
      if (typeof renderer.push === 'function') {
        renderer.push(useMesh, IDENTITY, material(), { collection: 'transparent' });
        pushesThisFrame = 1;
      }
      return pushesThisFrame;
    },

    reset: function () {
      ensurePool();
      for (var i = 0; i < MAX_PARTICLES; i++) parts[i].alive = false;
      alive = 0;
      cursor = 0;
      lights.length = 0;
      lightCount = 0;
      shakeAmount = 0; shakeLife = 0; shakePhase = 0;
      pushesThisFrame = 0;
    },

    dispose: function () {
      if (dyn && dyn.mesh && BS.GL && typeof BS.GL.disposeMesh === 'function') {
        BS.GL.disposeMesh(dyn.mesh);
      }
      dyn = null; mesh = null;
      buffersReady = false;
      FX.reset();
    },

    setParticleBudget: function (n) {
      budget = Math.max(0, Math.min(MAX_PARTICLES, n | 0));
      return budget;
    },

    getParticleBudget: function () { return budget; },

    count: function () { return alive; },

    /* -------- plan de draw calls (sin GL): lo usa el test -------- */
    _planDrawCalls: function () { return alive > 0 ? 1 : 0; },

    /* ======================================================================
     * Efectos concretos
     * ==================================================================== */

    /** Impacto en superficie: chispas + polvo + luz breve según el material. */
    impact: function (pos, normal, kind) {
      if (!pos) return;
      ensureAll();
      var n = normal || [0, 1, 0];
      var i, p;
      var col, dust, sparks, speed;
      switch (kind) {
        case 'metal': col = [1.0, 0.82, 0.42]; dust = [0.5, 0.48, 0.45]; sparks = 12; speed = 3.2; break;
        case 'flesh': col = [0.16, 0.42, 0.42]; dust = [0.08, 0.20, 0.20]; sparks = 9; speed = 2.0; break;
        case 'energy': col = [0.4, 0.9, 1.0]; dust = [0.2, 0.5, 0.6]; sparks = 10; speed = 2.6; break;
        case 'glass': col = [0.85, 0.95, 1.0]; dust = [0.6, 0.7, 0.8]; sparks = 10; speed = 3.0; break;
        case 'water': col = [0.4, 0.65, 0.9]; dust = [0.3, 0.5, 0.7]; sparks = 8; speed = 2.2; break;
        default: col = [1.0, 0.75, 0.4]; dust = [0.45, 0.43, 0.4]; sparks = 9; speed = 2.8; break; // concrete
      }
      for (i = 0; i < sparks; i++) {
        p = spawn(); if (!p) break;
        p.x = pos[0]; p.y = pos[1]; p.z = pos[2];
        p.vx = (n[0] + rnd(-0.7, 0.7)) * speed * rnd(0.4, 1.2);
        p.vy = (n[1] + rnd(-0.4, 0.9)) * speed * rnd(0.4, 1.2);
        p.vz = (n[2] + rnd(-0.7, 0.7)) * speed * rnd(0.4, 1.2);
        p.life = rnd(0.12, 0.35); p.maxLife = p.life;
        p.size0 = 0.035; p.size1 = 0.004;
        p.r = c255(col[0]); p.g = c255(col[1]); p.b = c255(col[2]);
        p.a0 = 255; p.a1 = 0;
        p.gravity = -7; p.drag = 3;
      }
      for (i = 0; i < 4; i++) {
        p = spawn(); if (!p) break;
        p.x = pos[0]; p.y = pos[1] + 0.05; p.z = pos[2];
        p.vx = (n[0] + rnd(-0.5, 0.5)) * 0.7;
        p.vy = rnd(0.3, 0.9);
        p.vz = (n[2] + rnd(-0.5, 0.5)) * 0.7;
        p.life = rnd(0.4, 0.9); p.maxLife = p.life;
        p.size0 = 0.12; p.size1 = 0.5;
        p.r = c255(dust[0]); p.g = c255(dust[1]); p.b = c255(dust[2]);
        p.a0 = 110; p.a1 = 0;
        p.gravity = 0.5; p.drag = 1.4;
      }
      FX.tempLight(pos, col, 4.5, 0.55, 0.09);
      if (kind === 'metal' || kind === 'energy') FX.screenShake(0.35, 0.08);
    },

    /** Chispas dirigidas. */
    spark: function (pos, normal, count, opts) {
      if (!pos) return;
      ensureAll();
      opts = opts || {};
      var n = normal || [0, 1, 0];
      var num = (count === undefined || count === null) ? 8 : (count | 0);
      var speed = opts.speed === undefined ? 3.0 : opts.speed;
      var spread = opts.spread === undefined ? 0.7 : opts.spread;
      var life = opts.life === undefined ? 0.3 : opts.life;
      var col = opts.color || [1.0, 0.8, 0.4];
      var grav = opts.gravity === undefined ? -7 : opts.gravity;
      var p;
      for (var i = 0; i < num; i++) {
        p = spawn(); if (!p) break;
        p.x = pos[0]; p.y = pos[1]; p.z = pos[2];
        p.vx = (n[0] + rnd(-spread, spread)) * speed * rnd(0.5, 1.3);
        p.vy = (n[1] + rnd(-spread, spread)) * speed * rnd(0.5, 1.3);
        p.vz = (n[2] + rnd(-spread, spread)) * speed * rnd(0.5, 1.3);
        p.life = life * rnd(0.6, 1.3); p.maxLife = p.life;
        p.size0 = 0.04; p.size1 = 0.004;
        p.r = c255(col[0]); p.g = c255(col[1]); p.b = c255(col[2]);
        p.a0 = 255; p.a1 = 0;
        p.gravity = grav; p.drag = 2.5;
      }
    },

    /** Humo: partículas grandes que crecen y suben lentamente. */
    smoke: function (pos, count, opts) {
      if (!pos) return;
      ensureAll();
      opts = opts || {};
      var num = (count === undefined || count === null) ? 6 : (count | 0);
      var scale = opts.scale === undefined ? 0.4 : opts.scale;
      var life = opts.life === undefined ? 1.4 : opts.life;
      var col = opts.color || [0.32, 0.32, 0.34];
      var p;
      for (var i = 0; i < num; i++) {
        p = spawn(); if (!p) break;
        p.x = pos[0] + rnd(-0.2, 0.2);
        p.y = pos[1] + rnd(0.0, 0.3);
        p.z = pos[2] + rnd(-0.2, 0.2);
        p.vx = rnd(-0.35, 0.35);
        p.vy = rnd(0.4, 1.1);
        p.vz = rnd(-0.35, 0.35);
        p.life = life * rnd(0.7, 1.3); p.maxLife = p.life;
        p.size0 = scale * 0.4; p.size1 = scale * 1.6;
        p.r = c255(col[0]); p.g = c255(col[1]); p.b = c255(col[2]);
        p.a0 = 130; p.a1 = 0;
        p.gravity = 0.3; p.drag = 0.9;
      }
    },

    /** Explosión: chispas radiales + humo + onda de choque + luz + sacudida. */
    explosion: function (pos, radius, color) {
      if (!pos) return;
      ensureAll();
      radius = radius || 4;
      var col = color || [1.0, 0.55, 0.2];
      var p;
      for (var i = 0; i < 34; i++) {
        p = spawn(); if (!p) break;
        var dx = rnd(-1, 1), dy = rnd(-0.4, 1), dz = rnd(-1, 1);
        var l = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
        var s = radius * rnd(0.6, 1.4);
        p.x = pos[0]; p.y = pos[1]; p.z = pos[2];
        p.vx = dx / l * s; p.vy = dy / l * s; p.vz = dz / l * s;
        p.life = rnd(0.25, 0.6); p.maxLife = p.life;
        p.size0 = 0.14; p.size1 = 0.02;
        p.r = c255(col[0]); p.g = c255(col[1]); p.b = c255(col[2]);
        p.a0 = 255; p.a1 = 0;
        p.gravity = -6; p.drag = 2.2;
      }
      FX.smoke(pos, 12, { scale: radius * 0.18, life: 1.8, color: [0.25, 0.24, 0.23] });
      FX.shockwave(pos, radius * 1.6, col);
      FX.tempLight(pos, col, radius * 2.2, 1.6, 0.32);
      FX.screenShake(1.0, 0.35);
    },

    /** Destello de boca de arma. */
    muzzleFlash: function (pos, dir, scale) {
      if (!pos) return;
      ensureAll();
      var d = dir || [0, 0, -1];
      var s = scale === undefined ? 1 : scale;
      var p = spawn();
      if (p) {
        p.x = pos[0]; p.y = pos[1]; p.z = pos[2];
        p.vx = 0; p.vy = 0; p.vz = 0;
        p.life = 0.05; p.maxLife = 0.05;
        p.size0 = 0.28 * s; p.size1 = 0.05 * s;
        p.r = 255; p.g = 225; p.b = 150;
        p.a0 = 255; p.a1 = 0;
        p.gravity = 0; p.drag = 0;
      }
      // lengüeta corta en la dirección del disparo
      if (d) {
        var pr = spawn();
        if (pr) {
          pr.kind = 1;
          pr.x = pos[0] + d[0] * 0.15 * s;
          pr.y = pos[1] + d[1] * 0.15 * s;
          pr.z = pos[2] + d[2] * 0.15 * s;
          var dl = Math.sqrt(d[0] * d[0] + d[1] * d[1] + d[2] * d[2]) || 1;
          pr.dirx = d[0] / dl; pr.diry = d[1] / dl; pr.dirz = d[2] / dl;
          pr.halfLen = 0.18 * s; pr.width = 0.06 * s;
          pr.life = 0.06; pr.maxLife = 0.06;
          pr.r = 255; pr.g = 210; pr.b = 130;
          pr.a0 = 255; pr.a1 = 0;
        }
      }
      FX.tempLight(pos, [1.0, 0.72, 0.35], 6, 1.1, 0.06);
    },

    /** Trazadora entre dos puntos (quad estirado). */
    tracer: function (from, to, color, width, life) {
      if (!from || !to) return;
      ensureAll();
      var col = color || [1.0, 0.9, 0.55];
      var dx = to[0] - from[0], dy = to[1] - from[1], dz = to[2] - from[2];
      var len = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (len < 1e-4) return;
      var p = spawn();
      if (!p) return;
      p.kind = 1;
      p.x = (from[0] + to[0]) * 0.5;
      p.y = (from[1] + to[1]) * 0.5;
      p.z = (from[2] + to[2]) * 0.5;
      p.dirx = dx / len; p.diry = dy / len; p.dirz = dz / len;
      p.halfLen = len * 0.5;
      p.width = width === undefined ? 0.02 : width;
      p.life = life === undefined ? 0.06 : life; p.maxLife = p.life;
      p.r = c255(col[0]); p.g = c255(col[1]); p.b = c255(col[2]);
      p.a0 = 255; p.a1 = 0;
    },

    /** Rastro pequeño (estelas de proyectil, chispas brillantes). */
    trail: function (pos, color, life) {
      if (!pos) return;
      ensureAll();
      var col = color || [0.5, 0.9, 1.0];
      var p = spawn();
      if (!p) return;
      p.x = pos[0]; p.y = pos[1]; p.z = pos[2];
      p.vx = rnd(-0.1, 0.1); p.vy = rnd(-0.1, 0.1); p.vz = rnd(-0.1, 0.1);
      p.life = life === undefined ? 0.25 : life; p.maxLife = p.life;
      p.size0 = 0.06; p.size1 = 0.01;
      p.r = c255(col[0]); p.g = c255(col[1]); p.b = c255(col[2]);
      p.a0 = 220; p.a1 = 0;
    },

    /** Fluido negro/cian de la instalación. */
    blood: function (pos, dir, count) {
      if (!pos) return;
      ensureAll();
      var d = dir || [0, 1, 0];
      var num = (count === undefined || count === null) ? 10 : (count | 0);
      var p;
      for (var i = 0; i < num; i++) {
        p = spawn(); if (!p) break;
        p.x = pos[0]; p.y = pos[1]; p.z = pos[2];
        p.vx = (d[0] + rnd(-0.6, 0.6)) * rnd(1.0, 3.0);
        p.vy = (d[1] + rnd(-0.2, 0.8)) * rnd(1.0, 3.0);
        p.vz = (d[2] + rnd(-0.6, 0.6)) * rnd(1.0, 3.0);
        p.life = rnd(0.3, 0.7); p.maxLife = p.life;
        p.size0 = 0.06; p.size1 = 0.02;
        p.r = c255(0.06); p.g = c255(0.22); p.b = c255(0.24);
        p.a0 = 220; p.a1 = 0;
        p.gravity = -9; p.drag = 1.5;
      }
    },

    /** Onda de choque expansiva. */
    shockwave: function (pos, radius, color) {
      if (!pos) return;
      ensureAll();
      var col = color || [1.0, 0.6, 0.25];
      var p = spawn();
      if (!p) return;
      p.x = pos[0]; p.y = pos[1] + 0.1; p.z = pos[2];
      p.life = 0.4; p.maxLife = 0.4;
      p.size0 = 0.2; p.size1 = radius || 3;
      p.r = c255(col[0]); p.g = c255(col[1]); p.b = c255(col[2]);
      p.a0 = 200; p.a1 = 0;
    },

    /** Luz temporal (se combina con las dinámicas antes de setDynamicLights). */
    tempLight: function (pos, color, radius, intensity, duration) {
      if (!pos) return null;
      var L = {
        pos: new Float32Array([pos[0], pos[1], pos[2]]),
        color: color ? [color[0], color[1], color[2]] : [1, 1, 1],
        radius: radius || 6,
        intensity: intensity === undefined ? 1 : intensity,
        life: duration === undefined ? 0.25 : duration,
        maxLife: duration === undefined ? 0.25 : duration
      };
      if (lightCount >= MAX_TEMP_LIGHTS) {
        // sustituye la más antigua (la de mayor vida consumida)
        var worst = 0, worstLeft = Infinity;
        for (var i = 0; i < lightCount; i++) {
          if (lights[i].life < worstLeft) { worstLeft = lights[i].life; worst = i; }
        }
        lights[worst] = L;
      } else {
        lights[lightCount++] = L;
      }
      return L;
    },

    /** Lista de luces temporales vivas, con intensidad atenuada por su vida. */
    getLights: function () {
      var out = [];
      for (var i = 0; i < lightCount; i++) {
        var L = lights[i];
        var f = L.maxLife > 0 ? Math.max(0, L.life / L.maxLife) : 0;
        out.push({ pos: L.pos, color: L.color, radius: L.radius, intensity: L.intensity * f });
      }
      return out;
    },

    lightCount: function () { return lightCount; },

    screenShake: function (amount, duration) {
      amount = Number(amount) || 0;
      duration = Number(duration) || 0;
      if (amount <= 0 || duration <= 0) return;
      shakeAmount = Math.max(shakeAmount, amount);
      shakeLife = Math.max(shakeLife, duration);
      shakeMax = Math.max(shakeMax, duration);
    },

    getShake: function () {
      if (shakeLife <= 0 || shakeAmount <= 0) return { offsetX: 0, offsetY: 0, roll: 0 };
      var f = shakeMax > 0 ? shakeLife / shakeMax : 0;
      var amp = shakeAmount * f * f;
      var t = shakePhase;
      return {
        offsetX: Math.sin(t * 37.0) * amp * 0.06,
        offsetY: Math.cos(t * 53.0) * amp * 0.06,
        roll: Math.sin(t * 29.0) * amp * 0.02
      };
    },

    diagnostics: function () {
      return {
        alive: alive,
        budget: budget,
        max: MAX_PARTICLES,
        lights: lightCount,
        shakeAmount: shakeAmount,
        shakeLife: shakeLife,
        mode: dyn ? 'dynamic' : 'stub',
        pushesThisFrame: pushesThisFrame
      };
    }
  };

  BS.FX = FX;

  /* ======================================================================
   * Test: todas las partículas en una sola draw call
   * ==================================================================== */
  if (BS.Debug && typeof BS.Debug.register === 'function') {
    BS.Debug.register('fx:singleDrawCall', function () {
      var fake = { pushes: 0, push: function () { this.pushes++; } };
      FX.reset();
      FX.beginFrame();
      for (var i = 0; i < 25; i++) FX.spark([i * 0.2, 1, 0], [0, 1, 0], 4, { speed: 1, life: 0.5 });
      var generated = FX.count();
      var withParticles = FX.render(fake);

      FX.reset();
      FX.beginFrame();
      var fake2 = { pushes: 0, push: function () { this.pushes++; } };
      var withoutParticles = FX.render(fake2);

      FX.reset();
      var ok = generated > 0 &&
        withParticles === 1 && fake.pushes === 1 &&
        withoutParticles === 0 && fake2.pushes === 0;

      return {
        ok: ok,
        particulasGeneradas: generated,
        drawCallsConParticulas: fake.pushes,
        drawCallsSinParticulas: fake2.pushes,
        planConParticulas: 1,
        planSinParticulas: FX._planDrawCalls(),
        modo: dyn ? 'dynamic' : 'stub'
      };
    });
  }

})(window.BS = window.BS || {});
