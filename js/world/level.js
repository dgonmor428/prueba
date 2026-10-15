/* ===========================================================================
 * BLACKSITE: LAST SIGNAL  —  js/world/level.js
 * ---------------------------------------------------------------------------
 * Propósito : convierte la misión declarativa (BS.LevelData) en datos de GPU y
 *             de colisión listos para jugar:
 *               1. Trocea la geometría en chunks de 24x24 m agrupados por
 *                  material (un mesh por chunk-material, AABB exacta).
 *               2. Hornea la iluminación estática + un AO de proximidad en el
 *                  color de vértice (aColor.rgb); aColor.a (máscara emisiva) se
 *                  conserva intacta.
 *               3. Sube cada chunk con BS.GL.createMesh (o devuelve un mesh
 *                  "stub" sin GPU, útil para los tests de CPU).
 *               4. Genera los colisionadores (box / ramp / stair / cylinder) y
 *                  una rejilla hash de 4 m para consultas rápidas.
 * Depende de: js/core/util.js, js/core/gl.js, js/core/textures.js,
 *             js/render/mesh.js, js/world/leveldata.js
 * Expone    : BS.Level = { build(data, ctx), LEVELS, testLevel() }
 * Notas     : SIN mapas de normales (normalMap = null y normalStrength = 0).
 *             El detalle visual procede del albedo, la luz horneada por vértice,
 *             los materiales emisivos y la linterna.
 * =========================================================================== */
(function (BS) {
  'use strict';

  /* Lado de la celda de troceado (m). VALOR FINAL = 24 (antes 12).
   * Con 12 m el nivel (~5.700 triángulos) generaba ~271 meshes por
   * (material × celda) → ~150 drawCalls, muy por encima del presupuesto
   * de ≤ 90 de §7.1 en calidad high. Con 24 m el área de celda se
   * cuadruplica y el recuento cae a ~68 meshes, dentro del presupuesto
   * sin necesidad de fusionar (se mantiene el corte por MAX_CHUNK_VERTS). */
  var CHUNK = 24;
  var MAX_CHUNK_VERTS = 60000;    /* margen bajo el límite Uint16 (65535) */
  var GRID_CELL = 4;              /* celda de la rejilla hash (m) */
  var GRID_PAD = 0.25;
  var AO_RADIUS = 1.6;            /* radio del AO de proximidad (m) */
  var AO_STRENGTH = 0.55;
  var BAKE_BUDGET_MS = 120;       /* a partir de aquí el AO se desactiva */
  var MAX_TOTAL_VERTS = 480000;   /* aviso de presupuesto de la §4.2 */

  var FLAG_WORLD = 1;
  var FLAG_PROP = 32;

  /* ======================================================================
   * Materiales saneados
   * ----------------------------------------------------------------------
   * `BS.Textures.getMaterial()` devuelve map/normalMap/emissiveMap como NOMBRE
   * (string) mientras no se haya llamado a uploadAll(); pasar ese string a
   * gl.bindTexture() es un error de WebGL. Aquí se resuelven a WebGLTexture (o
   * null) y se fuerza la ausencia de mapas de normales.
   * ==================================================================== */
  var matCache = {};

  function resolveTex(v) {
    if (!v) return null;
    if (typeof v === 'string') {
      var t = (BS.Textures && typeof BS.Textures.get === 'function') ? BS.Textures.get(v) : null;
      return t || null;
    }
    return v;
  }

  function materialOf(id) {
    var cached = matCache[id];
    if (cached) return cached;
    var src = (BS.Textures && typeof BS.Textures.getMaterial === 'function')
      ? BS.Textures.getMaterial(id) : null;
    var m = {
      id: (src && src.id) || id,
      map: resolveTex(src ? (src.map || src._mapName) : null),
      normalMap: null,
      emissiveMap: resolveTex(src ? (src.emissiveMap || src._emissiveName) : null),
      uvScale: (src && src.uvScale) ? src.uvScale : [1, 1],
      specular: (src && src.specular !== undefined) ? src.specular : 0.1,
      normalStrength: 0,
      emissive: (src && src.emissive) ? src.emissive : [0, 0, 0],
      emissiveIntensity: (src && src.emissiveIntensity !== undefined) ? src.emissiveIntensity : 1,
      blend: (src && src.blend) || 'opaque',
      depthWrite: src ? (src.depthWrite !== false) : true,
      doubleSided: !!(src && src.doubleSided),
      program: (src && src.program) || 'basic'
    };
    matCache[id] = m;
    return m;
  }

  function resetMaterials() { matCache = {}; }

  /* ======================================================================
   * Utilidades geométricas
   * ==================================================================== */
  function brushBounds(b) {
    var p = b.pos;
    if (b.kind === 'cylinder') {
      return {
        min: [p[0] - b.radius, p[1] - b.height * 0.5, p[2] - b.radius],
        max: [p[0] + b.radius, p[1] + b.height * 0.5, p[2] + b.radius]
      };
    }
    var sx = b.size[0] * 0.5, sy = b.size[1] * 0.5, sz = b.size[2] * 0.5;
    var ry = b.rotY || 0;
    if (ry) {
      var c = Math.abs(Math.cos(ry)), s = Math.abs(Math.sin(ry));
      var hx = sx * c + sz * s;
      var hz = sx * s + sz * c;
      return { min: [p[0] - hx, p[1] - sy, p[2] - hz], max: [p[0] + hx, p[1] + sy, p[2] + hz] };
    }
    return {
      min: [p[0] - sx, p[1] - sy, p[2] - sz],
      max: [p[0] + sx, p[1] + sy, p[2] + sz]
    };
  }

  /**
   * Emite la geometría de un brush en el builder activo.
   * `builder.emissive` se fija antes de cada brush y se restaura a 0 después
   * (así la máscara emisiva viaja en aColor.a).
   */
  function emitBrush(builder, b) {
    builder.emissive = b.emissive || 0;
    var uv = b.uv || [0.35, 0.35];
    if (b.kind === 'wedge') {
      builder.wedge(b.pos, b.size, b.axis || '+x', b.rotY || 0);
    } else if (b.kind === 'stair') {
      builder.stairFlight(b.pos, b.size, b.steps, b.axis || '+x');
    } else if (b.kind === 'cylinder') {
      builder.cylinder(b.pos, b.radius, b.height, b.segments, b.axis || 'y', true);
    } else {
      builder.box(b.pos, b.size, uv, b.rotY || 0);
    }
    builder.emissive = 0;
  }

  /* ======================================================================
   * Colisionadores (§3.11 / §4.2 paso 5)
   * ==================================================================== */
  function boxCollider(min, max, mat, flags) {
    return {
      type: 'box',
      min: new Float32Array([min[0], min[1], min[2]]),
      max: new Float32Array([max[0], max[1], max[2]]),
      mat: mat,
      flags: flags,
      _stamp: 0
    };
  }

  function rampCollider(min, max, axis, mat) {
    return {
      type: 'ramp',
      min: new Float32Array([min[0], min[1], min[2]]),
      max: new Float32Array([max[0], max[1], max[2]]),
      axis: axis || '+x',
      y0: min[1],
      y1: max[1],
      mat: mat,
      flags: FLAG_WORLD,
      _stamp: 0
    };
  }

  /* Peldaños: mismas cuentas que BS.Mesh.stairFlight (una caja por escalón). */
  function stairColliders(b, out, flags) {
    var n = Math.max(1, (b.steps | 0) || 4);
    var ax = b.axis || '+x';
    var rise = (ax === '+x' || ax === '-x') ? 0 : 2;
    var lateral = rise === 0 ? 2 : 0;
    var span = b.size[rise], h = b.size[1], depth = b.size[lateral];
    var stepSpan = span / n, stepH = h / n;
    var flip = (ax === '-x' || ax === '-z');
    for (var i = 0; i < n; i++) {
      var t0 = -span * 0.5 + i * stepSpan;
      var hi = -h * 0.5 + (i + 1) * stepH, lo = -h * 0.5;
      var c = t0 + stepSpan * 0.5;
      var sizeArr = [0, 0, 0], posArr = [0, 0, 0];
      sizeArr[rise] = stepSpan;
      posArr[rise] = flip ? -c : c;
      sizeArr[1] = hi - lo;
      posArr[1] = (hi + lo) * 0.5;
      sizeArr[lateral] = depth;
      var min = [
        b.pos[0] + posArr[0] - sizeArr[0] * 0.5,
        b.pos[1] + posArr[1] - sizeArr[1] * 0.5,
        b.pos[2] + posArr[2] - sizeArr[2] * 0.5
      ];
      var max = [
        b.pos[0] + posArr[0] + sizeArr[0] * 0.5,
        b.pos[1] + posArr[1] + sizeArr[1] * 0.5,
        b.pos[2] + posArr[2] + sizeArr[2] * 0.5
      ];
      out.push(boxCollider(min, max, b.mat, flags));
    }
  }

  function collidersFromBrush(b, out) {
    if (b.collide === false) return;
    var flags = b.prop ? (FLAG_WORLD | FLAG_PROP) : FLAG_WORLD;
    var bb = brushBounds(b);
    if (b.kind === 'wedge') {
      out.push(rampCollider(bb.min, bb.max, b.axis, b.mat));
      return;
    }
    if (b.kind === 'stair') {
      stairColliders(b, out, flags);
      return;
    }
    out.push(boxCollider(bb.min, bb.max, b.mat, flags));
  }

  /* ======================================================================
   * Rejilla hash 2D (XZ) de colisionadores
   * ==================================================================== */
  function createGrid(cellSize) {
    var cells = {};
    var stamp = 0;

    function key(ix, iz) { return (ix + 2048) * 8192 + (iz + 2048); }

    return {
      cellSize: cellSize,
      cells: cells,

      insert: function (col) {
        var x0 = Math.floor((col.min[0] - GRID_PAD) / cellSize);
        var x1 = Math.floor((col.max[0] + GRID_PAD) / cellSize);
        var z0 = Math.floor((col.min[2] - GRID_PAD) / cellSize);
        var z1 = Math.floor((col.max[2] + GRID_PAD) / cellSize);
        for (var ix = x0; ix <= x1; ix++) {
          for (var iz = z0; iz <= z1; iz++) {
            var k = key(ix, iz);
            var arr = cells[k];
            if (!arr) arr = cells[k] = [];
            arr.push(col);
          }
        }
      },

      /** Colisionadores que solapan la AABB (filtrado grueso por celdas). */
      query: function (min, max, out) {
        out.length = 0;
        stamp++;
        var x0 = Math.floor((min[0] - GRID_PAD) / cellSize);
        var x1 = Math.floor((max[0] + GRID_PAD) / cellSize);
        var z0 = Math.floor((min[2] - GRID_PAD) / cellSize);
        var z1 = Math.floor((max[2] + GRID_PAD) / cellSize);
        for (var ix = x0; ix <= x1; ix++) {
          for (var iz = z0; iz <= z1; iz++) {
            var arr = cells[key(ix, iz)];
            if (!arr) continue;
            for (var i = 0; i < arr.length; i++) {
              var col = arr[i];
              if (col._stamp === stamp) continue;
              col._stamp = stamp;
              out.push(col);
            }
          }
        }
        return out;
      }
    };
  }

  /* ======================================================================
   * Horneado de luz + AO de proximidad
   * ==================================================================== */
  function bakeLights(vertices, vertexCount, lights, occluders, quality, grid) {
    var f32 = new Float32Array(vertices.buffer, vertices.byteOffset, vertices.byteLength >> 2);
    var sky = bakeLights.ambient.sky;
    var ground = bakeLights.ambient.ground;
    var useAO = (quality !== 'low') && (quality !== 'off') && occluders.length > 0;
    var near = [];
    var i, k, c;

    for (i = 0; i < vertexCount; i++) {
      var f = i * 9;
      var px = f32[f], py = f32[f + 1], pz = f32[f + 2];
      var nx = f32[f + 3], ny = f32[f + 4], nz = f32[f + 5];

      var t01 = ny * 0.5 + 0.5;
      var r = ground[0] + (sky[0] - ground[0]) * t01;
      var g = ground[1] + (sky[1] - ground[1]) * t01;
      var b = ground[2] + (sky[2] - ground[2]) * t01;

      for (k = 0; k < lights.length; k++) {
        var L = lights[k];
        var dx = L.pos[0] - px, dy = L.pos[1] - py, dz = L.pos[2] - pz;
        var d2 = dx * dx + dy * dy + dz * dz;
        var rad = L.radius;
        if (d2 > rad * rad) continue;
        var d = Math.sqrt(d2);
        if (d < 0.05) d = 0.05;
        var att = 1 - d / rad;
        att *= att;
        var ndl = (dx * nx + dy * ny + dz * nz) / d;
        if (ndl < 0) ndl = 0;
        var w = att * (0.22 + 0.78 * ndl) * L.intensity;
        if (w <= 0) continue;
        r += L.color[0] * w;
        g += L.color[1] * w;
        b += L.color[2] * w;
      }

      if (useAO) {
        /* AO de proximidad: oclusión por cajas cercanas en el hemisferio. */
        near.length = 0;
        var qMin = [px - AO_RADIUS, py - AO_RADIUS, pz - AO_RADIUS];
        var qMax = [px + AO_RADIUS, py + AO_RADIUS, pz + AO_RADIUS];
        grid.query(qMin, qMax, near);
        var occ = 0;
        for (k = 0; k < near.length; k++) {
          c = near[k];
          var ex = px < c.min[0] ? c.min[0] : (px > c.max[0] ? c.max[0] : px);
          var ey = py < c.min[1] ? c.min[1] : (py > c.max[1] ? c.max[1] : py);
          var ez = pz < c.min[2] ? c.min[2] : (pz > c.max[2] ? c.max[2] : pz);
          var ox = ex - px, oy = ey - py, oz = ez - pz;
          var od2 = ox * ox + oy * oy + oz * oz;
          if (od2 < 1e-5 || od2 > AO_RADIUS * AO_RADIUS) continue;
          var od = Math.sqrt(od2);
          var dp = (ox * nx + oy * ny + oz * nz) / od;
          if (dp <= 0) continue;
          occ += (1 - od / AO_RADIUS) * dp;
          if (occ > 1) { occ = 1; break; }
        }
        var ao = 1 - AO_STRENGTH * occ;
        r *= ao; g *= ao; b *= ao;
      }

      var bo = i * 36 + 32;
      f32[bo >> 2] = 0; /* no-op de seguridad: evita confundir índices */
      vertices[bo] = r >= 1 ? 255 : (r <= 0 ? 0 : Math.round(r * 255));
      vertices[bo + 1] = g >= 1 ? 255 : (g <= 0 ? 0 : Math.round(g * 255));
      vertices[bo + 2] = b >= 1 ? 255 : (b <= 0 ? 0 : Math.round(b * 255));
      /* vertices[bo + 3] (máscara emisiva) NO se toca */
    }
    return vertexCount;
  }

  /* IMPORTANTE: el ambiente interviene DOS VECES — una aquí (se hornea en
   * aColor.rgb junto con las luces estáticas) y otra en el shader (que arranca
   * `acc` con uAmbientSky/uAmbientGround y compone albedo · vColor.rgb · acc).
   * Por eso hay que subirlo/bajarlo en los TRES sitios a la vez
   * (aquí, leveldata.js §environment.ambient y renderer.js DEFS.AMBIENT_*),
   * nunca en uno solo: al multiplicarse entre sí, subirlo en un único sitio
   * apenas cambia la imagen. Con el albedo (~0.2) valía ~0.018. */
  bakeLights.ambient = { sky: [0.62, 0.70, 0.84], ground: [0.17, 0.18, 0.21] };

  /* ======================================================================
   * Subida a GPU (con stub si no hay contexto)
   * ==================================================================== */
  function uploadMesh(data) {
    var mesh = null;
    if (BS.GL && typeof BS.GL.createMesh === 'function') {
      mesh = BS.GL.createMesh(data.vertices, data.indices, data.aabb);
    }
    if (!mesh) {
      /* Stub sin GPU: mismos campos que BS.Mesh.toGL para que el resto del
       * motor (y los tests) puedan recorrerlo sin contexto. */
      mesh = {
        vbo: null, ibo: null,
        indexCount: data.indexCount,
        vertexCount: data.vertexCount,
        indexType: 5123,
        stride: 36,
        byteLength: data.byteLength,
        aabb: data.aabb,
        attribs: true,
        data: data
      };
    }
    return mesh;
  }

  /* ======================================================================
   * Nivel
   * ==================================================================== */
  function createLevel() {
    var lv = {
      data: null,
      chunks: [],
      props: [],
      colliders: [],
      collidersAABB: [],
      colliderGrid: null,
      spawns: { player: null, enemies: [], pickups: [], objectives: [] },
      lights: [],
      navNodes: [],
      waves: [],
      route: [],
      bounds: { min: new Float32Array(3), max: new Float32Array(3) },
      buildTimeMs: 0,
      buildMs: 0,
      bakeMs: 0,
      bakeQuality: 'high',
      vertexCount: 0,
      triangleCount: 0,
      chunkCount: 0,
      materialCount: 0,

      dispose: dispose,
      rebuild: rebuild,
      queryColliders: queryColliders,
      groundHeightAt: groundHeightAt,
      groundInfoAt: groundInfoAt,
      rampHeightAt: rampHeightAt,
      sampleGround: sampleGround,
      solidAt: solidAt,
      overlaps: overlaps,
      isInsideLevel: isInsideLevel,
      landmarks: [],
      materialOf: materialOf
    };
    return lv;
  }

  /* Scratch de consultas (no reentrante entre llamadas anidadas). */
  var _qOut = [];
  var _qMin = new Float32Array(3);
  var _qMax = new Float32Array(3);
  var _gInfo = { y: -Infinity, collider: null, isRamp: false, normal: new Float32Array([0, 1, 0]) };

  function rampHeightAt(col, x, z) {
    var w = col.max[0] - col.min[0];
    var d = col.max[2] - col.min[2];
    var t;
    if (col.axis === '+x') t = w > 0 ? (x - col.min[0]) / w : 0;
    else if (col.axis === '-x') t = w > 0 ? (col.max[0] - x) / w : 0;
    else if (col.axis === '+z') t = d > 0 ? (z - col.min[2]) / d : 0;
    else t = d > 0 ? (col.max[2] - z) / d : 0;
    if (t < 0) t = 0;
    if (t > 1) t = 1;
    return col.y0 + (col.y1 - col.y0) * t;
  }

  function groundInfoAt(x, z, fromY, maxDrop) {
    if (maxDrop === undefined || maxDrop === null) maxDrop = 4;
    if (!this.colliderGrid) { _gInfo.y = -Infinity; _gInfo.collider = null; return _gInfo; }
    _qMin[0] = x - 0.03; _qMin[1] = fromY - maxDrop - 0.5; _qMin[2] = z - 0.03;
    _qMax[0] = x + 0.03; _qMax[1] = fromY + 0.3; _qMax[2] = z + 0.03;
    this.colliderGrid.query(_qMin, _qMax, _qOut);
    var best = -Infinity, bestCol = null, isRamp = false;
    var ceil = fromY + 0.25;
    var floorLimit = fromY - maxDrop;
    for (var i = 0; i < _qOut.length; i++) {
      var c = _qOut[i];
      if (x < c.min[0] || x > c.max[0] || z < c.min[2] || z > c.max[2]) continue;
      var top = (c.type === 'ramp') ? rampHeightAt(c, x, z) : c.max[1];
      if (top > ceil || top < floorLimit) continue;
      if (top > best) { best = top; bestCol = c; isRamp = (c.type === 'ramp'); }
    }
    _gInfo.y = best;
    _gInfo.collider = bestCol;
    _gInfo.isRamp = isRamp;
    if (bestCol) {
      if (isRamp) {
        var s = (bestCol.y1 - bestCol.y0) / Math.max(0.001, bestCol.max[0] - bestCol.min[0]);
        var dir = (bestCol.axis === '+x' || bestCol.axis === '-z') ? 1 : -1;
        _gInfo.normal[0] = (bestCol.axis === '+x' || bestCol.axis === '-x') ? -dir * s : 0;
        _gInfo.normal[1] = 1;
        _gInfo.normal[2] = (bestCol.axis === '+z' || bestCol.axis === '-z') ? -dir * s : 0;
        var ln = Math.sqrt(_gInfo.normal[0] * _gInfo.normal[0] + 1 + _gInfo.normal[2] * _gInfo.normal[2]);
        _gInfo.normal[0] /= ln; _gInfo.normal[1] /= ln; _gInfo.normal[2] /= ln;
      } else {
        _gInfo.normal[0] = 0; _gInfo.normal[1] = 1; _gInfo.normal[2] = 0;
      }
    }
    return _gInfo;
  }

  function groundHeightAt(x, z, fromY, maxDrop) {
    return groundInfoAt.call(this, x, z, fromY, maxDrop).y;
  }

  function sampleGround(x, z) {
    return groundInfoAt.call(this, x, z, 40, 80).y;
  }

  function queryColliders(aabb, out) {
    out = out || [];
    if (!this.colliderGrid) { out.length = 0; return out; }
    return this.colliderGrid.query(aabb.min, aabb.max, out);
  }

  /** ¿Hay algún colisionador sólido que contenga el punto? */
  function solidAt(x, y, z) {
    if (!this.colliderGrid) return false;
    _qMin[0] = x - 0.01; _qMin[1] = y - 0.01; _qMin[2] = z - 0.01;
    _qMax[0] = x + 0.01; _qMax[1] = y + 0.01; _qMax[2] = z + 0.01;
    this.colliderGrid.query(_qMin, _qMax, _qOut);
    for (var i = 0; i < _qOut.length; i++) {
      var c = _qOut[i];
      if (c.type === 'ramp') continue;
      if (x >= c.min[0] && x <= c.max[0] && y >= c.min[1] && y <= c.max[1] &&
        z >= c.min[2] && z <= c.max[2]) return true;
    }
    return false;
  }

  /** ¿Alguna caja sólida solapa la AABB dada? (los ramps son suelo, no muro) */
  function overlaps(min, max, skipRamps) {
    if (!this.colliderGrid) return false;
    _qMin[0] = min[0]; _qMin[1] = min[1]; _qMin[2] = min[2];
    _qMax[0] = max[0]; _qMax[1] = max[1]; _qMax[2] = max[2];
    this.colliderGrid.query(min, max, _qOut);
    for (var i = 0; i < _qOut.length; i++) {
      var c = _qOut[i];
      if (skipRamps !== false && c.type === 'ramp') continue;
      if (max[0] <= c.min[0] || min[0] >= c.max[0]) continue;
      if (max[1] <= c.min[1] || min[1] >= c.max[1]) continue;
      if (max[2] <= c.min[2] || min[2] >= c.max[2]) continue;
      return true;
    }
    return false;
  }

  function isInsideLevel(pos) {
    var b = this.bounds;
    if (!b || !b.min) return false;
    return pos[0] >= b.min[0] - 2 && pos[0] <= b.max[0] + 2 &&
      pos[1] >= b.min[1] - 4 && pos[1] <= b.max[1] + 4 &&
      pos[2] >= b.min[2] - 2 && pos[2] <= b.max[2] + 2;
  }

  function dispose() {
    var i;
    for (i = 0; i < this.chunks.length; i++) {
      var m = this.chunks[i].mesh;
      if (m && BS.GL && typeof BS.GL.disposeMesh === 'function') BS.GL.disposeMesh(m);
    }
    for (i = 0; i < this.props.length; i++) {
      var pm = this.props[i].mesh;
      if (pm && BS.GL && typeof BS.GL.disposeMesh === 'function') BS.GL.disposeMesh(pm);
    }
  }

  /** Tras pérdida de contexto: vuelve a subir los buffers conservados. */
  function rebuild() {
    var i, c, mesh;
    for (i = 0; i < this.chunks.length; i++) {
      c = this.chunks[i];
      if (!c.data) continue;
      mesh = uploadMesh(c.data);
      if (mesh) c.mesh = mesh;
      c.material = materialOf(c.materialId);
    }
    for (i = 0; i < this.props.length; i++) {
      c = this.props[i];
      if (!c.data) continue;
      mesh = uploadMesh(c.data);
      if (mesh) c.mesh = mesh;
      c.material = materialOf(c.materialId);
    }
    return this;
  }

  /* ======================================================================
   * build(data, ctx)
   * ==================================================================== */
  function build(data, ctx) {
    ctx = ctx || {};
    var t0 = BS.Util.nowMs();
    var lv = createLevel();
    lv.data = data || null;

    if (!data || !data.brushes || !data.brushes.length) {
      BS.Log.warn('BS.Level.build: misión vacía o inválida');
      lv.buildTimeMs = 0;
      lv.buildMs = 0;
      return lv;
    }

    var env = data.environment || {};
    if (env.ambient) {
      if (env.ambient.sky) bakeLights.ambient.sky = env.ambient.sky;
      if (env.ambient.ground) bakeLights.ambient.ground = env.ambient.ground;
    }

    var quality = ctx.bakeQuality || 'high';
    var lights = data.staticLights || [];
    var brushes = data.brushes;
    var i, b, bb;

    /* --- 1. Colisionadores y bounds ------------------------------------- */
    var colliders = lv.colliders;
    var boundsMin = [Infinity, Infinity, Infinity];
    var boundsMax = [-Infinity, -Infinity, -Infinity];
    for (i = 0; i < brushes.length; i++) {
      b = brushes[i];
      bb = brushBounds(b);
      for (var k = 0; k < 3; k++) {
        if (bb.min[k] < boundsMin[k]) boundsMin[k] = bb.min[k];
        if (bb.max[k] > boundsMax[k]) boundsMax[k] = bb.max[k];
      }
      collidersFromBrush(b, colliders);
    }
    lv.bounds.min = new Float32Array(boundsMin);
    lv.bounds.max = new Float32Array(boundsMax);

    var grid = createGrid(GRID_CELL);
    for (i = 0; i < colliders.length; i++) {
      grid.insert(colliders[i]);
      if (colliders[i].type === 'box') lv.collidersAABB.push(colliders[i]);
    }
    lv.colliderGrid = grid;

    /* --- 2. Geometría troceada por (celda, material) --------------------- */
    var groups = {};
    var order = [];
    var totalVerts = 0;
    var bakeState = { ms: 0, degraded: false };

    function groupFor(b, matId) {
      var cx = Math.floor(b.pos[0] / CHUNK);
      var cz = Math.floor(b.pos[2] / CHUNK);
      var key = matId + '|' + cx + '|' + cz;
      var g = groups[key];
      if (!g) {
        g = {
          key: key, matId: matId, cx: cx, cz: cz,
          builder: BS.Mesh.create(), data: null, mesh: null, aabb: null, flushed: false
        };
        groups[key] = g;
        order.push(g);
      }
      return g;
    }

    function flushGroup(g) {
      if (!g || !g.builder || g.builder.vertexCount === 0) return;
      var tBake = BS.Util.nowMs();
      var bd = BS.Mesh.buildData(g.builder);
      if (quality !== 'off') {
        bakeLights(bd.vertices, bd.vertexCount, lights, colliders, quality, grid);
      }
      bakeState.ms += BS.Util.nowMs() - tBake;
      var mesh = uploadMesh(bd);
      var mat = materialOf(g.matId);
      var chunk = {
        mesh: mesh,
        materialId: g.matId,
        material: mat,
        aabb: bd.aabb,
        opaque: (mat.blend || 'opaque') === 'opaque',
        cell: [g.cx, g.cz],
        vertexCount: bd.vertexCount,
        indexCount: bd.indexCount,
        data: bd
      };
      lv.chunks.push(chunk);
      totalVerts += bd.vertexCount;
      g.builder = null;
      g.flushed = true;
      if (!bakeState.degraded && quality === 'high' && bakeState.ms > BAKE_BUDGET_MS) {
        /* Degradación automática: a partir de aquí sin AO (objetivo < 700 ms). */
        bakeState.degraded = true;
        quality = 'low';
        BS.Log.info('BS.Level: horno de luz >' + BAKE_BUDGET_MS + ' ms, AO desactivado');
      }
    }

    for (i = 0; i < brushes.length; i++) {
      b = brushes[i];
      if (b.visible === false) continue;
      /* Los props rotados tienen su MESH PROPIA (bucle de abajo): excluirlos
       * aquí evita duplicar su geometría (se generarían, hornearían, subirían
       * a GPU y dibujarían dos veces). */
      if (b.prop) continue;
      var g = groupFor(b, b.mat);
      emitBrush(g.builder, b);
      if (g.builder.vertexCount >= MAX_CHUNK_VERTS) flushGroup(g);
    }
    for (i = 0; i < order.length; i++) flushGroup(order[i]);

    /* --- 3. Props con rotación: malla propia (AABB envolvente exacta) ---- */
    for (i = 0; i < brushes.length; i++) {
      b = brushes[i];
      if (!b.prop || b.visible === false) continue;
      var pb = BS.Mesh.create();
      emitBrush(pb, b);
      var pd = BS.Mesh.buildData(pb);
      if (quality !== 'off') bakeLights(pd.vertices, pd.vertexCount, lights, colliders, quality, grid);
      var pmesh = uploadMesh(pd);
      var pmat = materialOf(b.mat);
      var pcol = null;
      for (var pc = 0; pc < colliders.length; pc++) {
        if (colliders[pc].mat === b.mat && colliders[pc].flags & FLAG_PROP) { pcol = colliders[pc]; break; }
      }
      lv.props.push({
        mesh: pmesh,
        materialId: b.mat,
        material: pmat,
        model: BS.Math.m4identity(new Float32Array(16)),
        aabb: pd.aabb,
        collider: pcol,
        rotY: b.rotY || 0,
        data: pd
      });
      totalVerts += pd.vertexCount;
    }

    /* --- 4. Spawns, luces, oleadas y landmarks -------------------------- */
    var ents = data.entities || {};
    var spawn = ents.playerSpawn || { pos: [0, 1, 0], yaw: 0 };
    lv.spawns.player = { pos: toF32(spawn.pos), yaw: spawn.yaw || 0 };
    lv.spawns.enemies = (ents.enemySpawns || []).map(function (e) {
      var o = {
        id: e.id, type: e.type, pos: toF32(e.pos), yaw: e.yaw || 0,
        waves: e.waves ? e.waves.slice() : [], variant: e.variant || null,
        boss: !!e.boss, aggro: e.aggro !== false,
        patrol: (e.patrol || []).map(toF32)
      };
      return o;
    });
    lv.spawns.pickups = (ents.pickups || []).map(function (p) {
      return {
        kind: p.kind, pos: toF32(p.pos),
        amount: (p.amount === undefined ? null : p.amount),
        respawn: (p.respawn === undefined ? null : p.respawn),
        isStatic: !!p.isStatic,
        waves: p.waves ? p.waves.slice() : []
      };
    });
    lv.spawns.objectives = (ents.objectives || []).map(function (o) {
      return {
        id: o.id, type: o.type,
        pos: o.pos ? toF32(o.pos) : null,
        landmark: o.landmark || null,
        radius: (o.radius === undefined ? 3 : o.radius),
        holdTime: (o.holdTime === undefined ? 0 : o.holdTime),
        label: o.label || '',
        requiresWave: o.requiresWave || 0
      };
    });
    lv.landmarks = (ents.landmarks || []).map(function (l) {
      return { id: l.id, pos: toF32(l.pos), radius: l.radius || 4, label: l.label || '' };
    });
    lv.lights = lights;
    lv.waves = data.waves || [];
    lv.route = data.route || [];
    lv.environment = env;

    /* --- 5. Cierre y estadísticas --------------------------------------- */
    lv.vertexCount = totalVerts;
    var tris = 0;
    for (i = 0; i < lv.chunks.length; i++) tris += lv.chunks[i].indexCount / 3;
    for (i = 0; i < lv.props.length; i++) tris += lv.props[i].mesh.indexCount / 3;
    lv.triangleCount = Math.round(tris);
    lv.chunkCount = lv.chunks.length;
    var mats = {};
    for (i = 0; i < lv.chunks.length; i++) mats[lv.chunks[i].materialId] = 1;
    lv.materialCount = Object.keys(mats).length;
    lv.bakeQuality = bakeState.degraded ? 'low' : quality;
    lv.bakeMs = Math.round(bakeState.ms);
    lv.buildMs = BS.Util.nowMs() - t0;
    lv.buildTimeMs = lv.buildMs;

    if (totalVerts > MAX_TOTAL_VERTS) {
      BS.Log.warn('BS.Level: ' + totalVerts + ' vértices (presupuesto ' + MAX_TOTAL_VERTS +
        '). Considera simplificar la geometría.');
    }
    BS.Log.info('BS.Level.build: ' + lv.chunkCount + ' chunks, ' + totalVerts + ' vértices, ' +
      Math.round(tris) + ' triángulos, ' + colliders.length + ' colisionadores, ' +
      lv.buildMs + ' ms (horno ' + lv.bakeMs + ' ms, calidad ' + lv.bakeQuality + ')');

    return lv;
  }

  function toF32(a) {
    if (!a) return null;
    if (a instanceof Float32Array) return a;
    return new Float32Array([a[0] || 0, a[1] || 0, a[2] || 0]);
  }

  /* ======================================================================
   * API pública
   * ==================================================================== */
  var Level = {
    build: build,
    LEVELS: {},
    MATERIAL: materialOf,
    resetMaterials: resetMaterials,
    CHUNK_SIZE: CHUNK,
    GRID_CELL: GRID_CELL,

    /** Nivel de pruebas en caché (sin horno) reutilizado por los tests. */
    testLevel: function () {
      if (Level._testLv) return Level._testLv;
      var data = (BS.LevelData && typeof BS.LevelData.build === 'function')
        ? BS.LevelData.build() : null;
      Level._testLv = build(data, { bakeQuality: 'off' });
      return Level._testLv;
    }
  };

  if (BS.LevelData && BS.LevelData.mission) Level.LEVELS.k7 = BS.LevelData.mission;

  BS.Level = Level;

  /* ======================================================================
   * Test: construcción del nivel real (§4) sin GPU
   * ==================================================================== */
  if (BS.Debug && typeof BS.Debug.register === 'function') {
    BS.Debug.register('level:build', function () {
      var problems = [];
      var t0 = BS.Util.nowMs();
      var data = (BS.LevelData && typeof BS.LevelData.build === 'function') ? BS.LevelData.build() : null;
      if (!data || !data.brushes || !data.brushes.length) {
        return { ok: false, error: 'BS.LevelData.build() no devolvió brushes' };
      }
      var lv = build(data, { bakeQuality: 'high' });
      var ms = BS.Util.nowMs() - t0;

      if (!lv.chunks.length) problems.push('sin chunks');
      if (!lv.colliders.length) problems.push('sin colisionadores');
      if (!lv.colliderGrid) problems.push('sin rejilla hash');

      var maxVerts = 0, stringMaps = 0, nonOpaque = 0;
      for (var i = 0; i < lv.chunks.length; i++) {
        var c = lv.chunks[i];
        if (c.vertexCount > maxVerts) maxVerts = c.vertexCount;
        if (c.vertexCount > 65535) problems.push('chunk ' + c.materialId + ' con ' + c.vertexCount + ' vértices');
        if (typeof c.material.map === 'string') stringMaps++;
        if (typeof c.material.normalMap === 'string') stringMaps++;
        if (c.material.normalMap) problems.push('material ' + c.materialId + ' con normalMap (prohibido)');
        if (c.material.normalStrength) problems.push('material ' + c.materialId + ' con normalStrength != 0');
        if (!c.material.blend || c.material.blend === 'opaque') nonOpaque++;
        if (!isFinite(c.aabb.min[0]) || !isFinite(c.aabb.max[0])) problems.push('AABB no finita en ' + c.materialId);
      }
      if (stringMaps) problems.push(stringMaps + ' referencias de textura sin resolver (string)');

      /* colisiones coherentes */
      for (var k = 0; k < lv.colliders.length; k++) {
        var col = lv.colliders[k];
        for (var a = 0; a < 3; a++) {
          if (!isFinite(col.min[a]) || !isFinite(col.max[a])) { problems.push('colisionador no finito'); break; }
          if (col.min[a] > col.max[a]) { problems.push('colisionador invertido'); break; }
        }
      }

      /* el suelo del punto de aparición debe existir y estar a ~0 */
      var sp = lv.spawns.player.pos;
      var gi = lv.groundInfoAt(sp[0], sp[2], sp[1] + 1, 3);
      if (!isFinite(gi.y)) problems.push('sin suelo en el punto de aparición');
      else if (Math.abs(gi.y) > 0.35) problems.push('suelo de aparición a ' + gi.y.toFixed(2));

      /* muestreo de suelo en cada landmark */
      for (var L = 0; L < lv.landmarks.length; L++) {
        var lm = lv.landmarks[L];
        var g2 = lv.groundInfoAt(lm.pos[0], lm.pos[2], lm.pos[1] + 3, 4);
        if (!isFinite(g2.y)) problems.push('sin suelo en el landmark ' + lm.id);
      }

      if (!lv.isInsideLevel(sp)) problems.push('el spawn queda fuera del nivel');
      if (lv.spawns.enemies.length < 3) problems.push('pocos spawns de enemigos');
      if (lv.spawns.pickups.length < 5) problems.push('pocos pickups');
      if (lv.spawns.objectives.length < 3) problems.push('pocos objetivos');
      if (lv.waves.length !== 5) problems.push('se esperaban 5 oleadas, hay ' + lv.waves.length);

      return {
        ok: problems.length === 0,
        problems: problems,
        buildMs: Math.round(ms),
        bakeMs: lv.bakeMs,
        bakeQuality: lv.bakeQuality,
        chunks: lv.chunkCount,
        maxChunkVerts: maxVerts,
        props: lv.props.length,
        colliders: lv.colliders.length,
        gridCells: Object.keys(lv.colliderGrid.cells).length,
        vertices: lv.vertexCount,
        triangles: lv.triangleCount,
        materials: lv.materialCount,
        opaqueChunks: nonOpaque,
        enemies: lv.spawns.enemies.length,
        pickups: lv.spawns.pickups.length,
        objectives: lv.spawns.objectives.length,
        landmarks: lv.landmarks.length,
        waves: lv.waves.length,
        routePoints: lv.route.length
      };
    });
  }
})(window.BS = window.BS || {});
