/* ===========================================================================
 * BLACKSITE: LAST SIGNAL  —  js/render/mesh.js
 * ---------------------------------------------------------------------------
 * Propósito : único productor de datos de vértice del motor. Escribe el
 *             formato interleaved de 36 bytes:
 *               0..11  aPos    float32 x3
 *              12..23  aNormal float32 x3
 *              24..31  aUV     float32 x2
 *              32..35  aColor  uint8 x4 (rgb = luz/tinte, a = máscara emisiva)
 *             Incluye todas las primitivas (box, boxFaces, wedge, cylinder,
 *             sphere, quad, stairFlight, tube, extrude2D, addRaw) y las
 *             transformaciones acumulables translate/rotY/scale, más tag() y
 *             group() para asignar material por partes.
 * Depende de: js/core/util.js (BS.Math, BS.Log), js/core/gl.js (BS.GL)
 * Expone    : BS.Mesh
 * =========================================================================== */
(function (BS) {
  'use strict';

  var STRIDE = 36;
  var MAX_VERTS = 65535;   // índices Uint16 (R9)

  function M() { return BS.Math; }

  /* ----------------------------------------------------------------------
   * Buffers crecientes
   * -------------------------------------------------------------------- */
  function newBuffers(cap) {
    cap = Math.max(64, cap | 0);
    return {
      cap: cap,
      pos: new Float32Array(cap * 3),
      nrm: new Float32Array(cap * 3),
      uv: new Float32Array(cap * 2),
      col: new Uint8Array(cap * 4),
      count: 0,
      icap: Math.max(192, cap * 3),
      idx: new Uint16Array(Math.max(192, cap * 3)),
      icount: 0,
      overflow: false
    };
  }

  function ensureVerts(b, extra) {
    var need = b.count + extra;
    if (need <= b.cap) return true;
    if (need > MAX_VERTS) return false;
    var cap = b.cap;
    while (cap < need) cap *= 2;
    var pos = new Float32Array(cap * 3); pos.set(b.pos); b.pos = pos;
    var nrm = new Float32Array(cap * 3); nrm.set(b.nrm); b.nrm = nrm;
    var uv = new Float32Array(cap * 2); uv.set(b.uv); b.uv = uv;
    var col = new Uint8Array(cap * 4); col.set(b.col); b.col = col;
    b.cap = cap;
    return true;
  }

  function ensureIdx(b, extra) {
    var need = b.icount + extra;
    if (need <= b.icap) return true;
    var cap = b.icap;
    while (cap < need) cap *= 2;
    var idx = new Uint16Array(cap);
    idx.set(b.idx.subarray(0, b.icount));
    b.idx = idx;
    b.icap = cap;
    return true;
  }

  function clamp255(v) {
    // Math.round (NO truncamiento con |0): 0.5 * 255 = 127.5 -> 128, que es la
    // expectativa del test `mesh:stride`. Cubre negativos y NaN de forma segura.
    v = Math.round(v);
    if (!(v > 0)) return 0;
    return v > 255 ? 255 : v;
  }

  /* Escribe un vértice aplicando la transformación activa. Devuelve el índice. */
  function emit(b, st, col, em, x, y, z, nx, ny, nz, u, v) {
    if (b.count >= MAX_VERTS) {
      if (!b.overflow) {
        b.overflow = true;
        BS.Log.error('BS.Mesh: superados ' + MAX_VERTS + ' vértices (índices Uint16). ' +
          'Divide la geometría en chunks menores (12x12 m).');
      }
      return -1;
    }
    if (!ensureVerts(b, 1)) {
      if (!b.overflow) {
        b.overflow = true;
        BS.Log.error('BS.Mesh: límite de ' + MAX_VERTS + ' vértices alcanzado');
      }
      return -1;
    }

    var s = st.s, c = st.cos, sn = st.sin;

    // posición: escala -> rotación en Y -> traslación
    var vx = x * s, vy = y * s, vz = z * s;
    var rx = vx * c + vz * sn;
    var rz = -vx * sn + vz * c;

    // normal: solo rotación (la escala uniforme no cambia la dirección)
    var anx = nx * c + nz * sn;
    var anz = -nx * sn + nz * c;

    var i = b.count;
    var i3 = i * 3, i2 = i * 2, i4 = i * 4;
    b.pos[i3] = rx + st.tx;
    b.pos[i3 + 1] = vy + st.ty;
    b.pos[i3 + 2] = rz + st.tz;
    b.nrm[i3] = anx;
    b.nrm[i3 + 1] = ny;
    b.nrm[i3 + 2] = anz;
    b.uv[i2] = u;
    b.uv[i2 + 1] = v;
    b.col[i4] = clamp255(col[0] * 255);
    b.col[i4 + 1] = clamp255(col[1] * 255);
    b.col[i4 + 2] = clamp255(col[2] * 255);
    b.col[i4 + 3] = clamp255(em * 255);
    b.count++;
    return i;
  }

  function pushIndex(b, i) {
    if (i < 0) return;
    if (!ensureIdx(b, 1)) return;
    b.idx[b.icount++] = i;
  }

  /* ----------------------------------------------------------------------
   * Fábrica de builders (todo por closures: sin `this` desligado)
   * -------------------------------------------------------------------- */
  function makeBuilder(buf, st, parts, name, color, emissive) {
    var b = {
      color: color || [1, 1, 1, 1],
      emissive: emissive || 0,
      _colorRef: color || [1, 1, 1, 1],
      _emissiveRef: [0],
      _buf: buf,
      _st: st,
      _parts: parts,
      _name: name || 'default',
      overflow: false,
      primitiveCount: 0
    };
    b._emissiveRef[0] = emissive || 0;

    function curColor() { return b.color; }
    // Lee SIEMPRE `b.emissive` (no `_emissiveRef`, que nunca se sincronizaba) para
    // que `builder.emissive = 1` surta efecto inmediato. Se clampa a 0..1 y `emit`
    // lo escala a 0..255 al escribir el byte de aColor.a.
    function curEm() {
      var e = +b.emissive;
      if (!(e > 0)) return 0;
      return e > 1 ? 1 : e;
    }

    /* ---------------- vértices ---------------- */
    function vertex(x, y, z, nx, ny, nz, u, v) {
      return emit(buf, st, curColor(), curEm(), x, y, z, nx, ny, nz, u, v);
    }

    function tri(p0, p1, p2, uv0, uv1, uv2, nrm) {
      var n = nrm;
      if (!n) {
        var ax = p1[0] - p0[0], ay = p1[1] - p0[1], az = p1[2] - p0[2];
        var bx = p2[0] - p0[0], by = p2[1] - p0[1], bz = p2[2] - p0[2];
        var cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx;
        var len = Math.sqrt(cx * cx + cy * cy + cz * cz) || 1;
        n = [cx / len, cy / len, cz / len];
      }
      var i0 = vertex(p0[0], p0[1], p0[2], n[0], n[1], n[2], uv0[0], uv0[1]);
      var i1 = vertex(p1[0], p1[1], p1[2], n[0], n[1], n[2], uv1[0], uv1[1]);
      var i2 = vertex(p2[0], p2[1], p2[2], n[0], n[1], n[2], uv2[0], uv2[1]);
      pushIndex(buf, i0); pushIndex(buf, i1); pushIndex(buf, i2);
      b.primitiveCount++;
      return (i0 >= 0 && i1 >= 0 && i2 >= 0);
    }

    function quad(p0, p1, p2, p3, uv0, uv1, uv2, uv3, nrm) {
      var n = nrm;
      if (!n) {
        var ax = p1[0] - p0[0], ay = p1[1] - p0[1], az = p1[2] - p0[2];
        var bx = p3[0] - p0[0], by = p3[1] - p0[1], bz = p3[2] - p0[2];
        var cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx;
        var len = Math.sqrt(cx * cx + cy * cy + cz * cz) || 1;
        n = [cx / len, cy / len, cz / len];
      }
      var i0 = vertex(p0[0], p0[1], p0[2], n[0], n[1], n[2], uv0[0], uv0[1]);
      var i1 = vertex(p1[0], p1[1], p1[2], n[0], n[1], n[2], uv1[0], uv1[1]);
      var i2 = vertex(p2[0], p2[1], p2[2], n[0], n[1], n[2], uv2[0], uv2[1]);
      var i3 = vertex(p3[0], p3[1], p3[2], n[0], n[1], n[2], uv3[0], uv3[1]);
      pushIndex(buf, i0); pushIndex(buf, i1); pushIndex(buf, i2);
      pushIndex(buf, i0); pushIndex(buf, i2); pushIndex(buf, i3);
      b.primitiveCount++;
      return (i0 >= 0 && i1 >= 0 && i2 >= 0 && i3 >= 0);
    }

    /* ---------------- primitivas ---------------- */
    function box(pos, size, uvScale, rotY) {
      var hx = (size[0] || 0) * 0.5, hy = (size[1] || 0) * 0.5, hz = (size[2] || 0) * 0.5;
      var px = pos[0] || 0, py = pos[1] || 0, pz = pos[2] || 0;
      var us = uvScale ? uvScale[0] : 1;
      var vs = uvScale ? uvScale[1] : 1;
      var ry = rotY || 0;
      var c = Math.cos(ry), s = Math.sin(ry);

      function P(lx, ly, lz) { return [px + lx * c + lz * s, py + ly, pz - lx * s + lz * c]; }
      function N(nx, ny, nz) { return [nx * c + nz * s, ny, -nx * s + nz * c]; }
      function U(u, v) { return [u, v]; }

      // +X
      quad(P(hx, -hy, hz), P(hx, -hy, -hz), P(hx, hy, -hz), P(hx, hy, hz),
        U(0, 0), U(2 * hz * us, 0), U(2 * hz * us, 2 * hy * vs), U(0, 2 * hy * vs), N(1, 0, 0));
      // -X
      quad(P(-hx, -hy, -hz), P(-hx, -hy, hz), P(-hx, hy, hz), P(-hx, hy, -hz),
        U(0, 0), U(2 * hz * us, 0), U(2 * hz * us, 2 * hy * vs), U(0, 2 * hy * vs), N(-1, 0, 0));
      // +Y
      quad(P(-hx, hy, hz), P(hx, hy, hz), P(hx, hy, -hz), P(-hx, hy, -hz),
        U(0, 0), U(2 * hx * us, 0), U(2 * hx * us, 2 * hz * vs), U(0, 2 * hz * vs), N(0, 1, 0));
      // -Y
      quad(P(-hx, -hy, -hz), P(hx, -hy, -hz), P(hx, -hy, hz), P(-hx, -hy, hz),
        U(0, 0), U(2 * hx * us, 0), U(2 * hx * us, 2 * hz * vs), U(0, 2 * hz * vs), N(0, -1, 0));
      // +Z
      quad(P(-hx, -hy, hz), P(hx, -hy, hz), P(hx, hy, hz), P(-hx, hy, hz),
        U(0, 0), U(2 * hx * us, 0), U(2 * hx * us, 2 * hy * vs), U(0, 2 * hy * vs), N(0, 0, 1));
      // -Z
      quad(P(hx, -hy, -hz), P(-hx, -hy, -hz), P(-hx, hy, -hz), P(hx, hy, -hz),
        U(0, 0), U(2 * hx * us, 0), U(2 * hx * us, 2 * hy * vs), U(0, 2 * hy * vs), N(0, 0, -1));
      return b;
    }

    function boxFaces(pos, size, opts) {
      opts = opts || {};
      var faces = opts.faces || [true, true, true, true, true, true];
      var flip = !!opts.flipNormals;
      var hx = (size[0] || 0) * 0.5, hy = (size[1] || 0) * 0.5, hz = (size[2] || 0) * 0.5;
      var px = pos[0] || 0, py = pos[1] || 0, pz = pos[2] || 0;
      var us = opts.uvScale ? opts.uvScale[0] : 1;
      var vs = opts.uvScale ? opts.uvScale[1] : 1;
      var ry = opts.rotY || 0;
      var c = Math.cos(ry), s = Math.sin(ry);
      function P(lx, ly, lz) { return [px + lx * c + lz * s, py + ly, pz - lx * s + lz * c]; }
      function N(nx, ny, nz) {
        var f = flip ? -1 : 1;
        return [nx * f * c + nz * f * s, ny * f, -nx * f * s + nz * f * c];
      }
      function U(u, v) { return [u, v]; }
      if (faces[0]) quad(P(hx, -hy, hz), P(hx, -hy, -hz), P(hx, hy, -hz), P(hx, hy, hz), U(0, 0), U(2 * hz * us, 0), U(2 * hz * us, 2 * hy * vs), U(0, 2 * hy * vs), N(1, 0, 0));
      if (faces[1]) quad(P(-hx, -hy, -hz), P(-hx, -hy, hz), P(-hx, hy, hz), P(-hx, hy, -hz), U(0, 0), U(2 * hz * us, 0), U(2 * hz * us, 2 * hy * vs), U(0, 2 * hy * vs), N(-1, 0, 0));
      if (faces[2]) quad(P(-hx, hy, hz), P(hx, hy, hz), P(hx, hy, -hz), P(-hx, hy, -hz), U(0, 0), U(2 * hx * us, 0), U(2 * hx * us, 2 * hz * vs), U(0, 2 * hz * vs), N(0, 1, 0));
      if (faces[3]) quad(P(-hx, -hy, -hz), P(hx, -hy, -hz), P(hx, -hy, hz), P(-hx, -hy, hz), U(0, 0), U(2 * hx * us, 0), U(2 * hx * us, 2 * hz * vs), U(0, 2 * hz * vs), N(0, -1, 0));
      if (faces[4]) quad(P(-hx, -hy, hz), P(hx, -hy, hz), P(hx, hy, hz), P(-hx, hy, hz), U(0, 0), U(2 * hx * us, 0), U(2 * hx * us, 2 * hy * vs), U(0, 2 * hy * vs), N(0, 0, 1));
      if (faces[5]) quad(P(hx, -hy, -hz), P(-hx, -hy, -hz), P(-hx, hy, -hz), P(hx, hy, -hz), U(0, 0), U(2 * hx * us, 0), U(2 * hx * us, 2 * hy * vs), U(0, 2 * hy * vs), N(0, 0, -1));
      return b;
    }

    /**
     * Rampa triangular. `axis` = lado hacia el que SUBE.
     * Se construye para '+x' y se rota para el resto de ejes.
     */
    function wedge(pos, size, axis, rotY) {
      var ax = axis || '+x';
      var rise = 0, lateral = 2;
      var mapFn;
      if (ax === '+x') { rise = 0; lateral = 2; mapFn = function (x, y, z) { return [x, y, z]; }; }
      else if (ax === '-x') { rise = 0; lateral = 2; mapFn = function (x, y, z) { return [-x, y, -z]; }; }
      else if (ax === '+z') { rise = 2; lateral = 0; mapFn = function (x, y, z) { return [-z, y, x]; }; }
      else { rise = 2; lateral = 0; mapFn = function (x, y, z) { return [z, y, -x]; }; }

      var w = size[rise] || 1;
      var h = size[1] || 1;
      var d = size[lateral] || 1;
      var hw = w * 0.5, hh = h * 0.5, hd = d * 0.5;
      var px = pos[0] || 0, py = pos[1] || 0, pz = pos[2] || 0;
      var ry = rotY || 0;
      var c = Math.cos(ry), s = Math.sin(ry);

      function W(lx, ly, lz) {
        var m = mapFn(lx, ly, lz);
        return [px + m[0] * c + m[2] * s, py + m[1], pz - m[0] * s + m[2] * c];
      }
      function WN(nx, ny, nz) {
        var m = mapFn(nx, ny, nz);
        return [m[0] * c + m[2] * s, m[1], -m[0] * s + m[2] * c];
      }

      var slopeLen = Math.sqrt(w * w + h * h);
      var nSlope = WN(-h / slopeLen, w / slopeLen, 0);

      // base (y = -hh)
      quad(W(-hw, -hh, -hd), W(hw, -hh, -hd), W(hw, -hh, hd), W(-hw, -hh, hd),
        [0, 0], [w, 0], [w, d], [0, d], WN(0, -1, 0));
      // pared vertical del lado alto (x = +hw)
      quad(W(hw, -hh, hd), W(hw, -hh, -hd), W(hw, hh, -hd), W(hw, hh, hd),
        [0, 0], [d, 0], [d, h], [0, h], WN(1, 0, 0));
      // rampa
      quad(W(-hw, -hh, hd), W(hw, hh, hd), W(hw, hh, -hd), W(-hw, -hh, -hd),
        [0, 0], [slopeLen, 0], [slopeLen, d], [0, d], nSlope);
      // laterales triangulares
      tri(W(-hw, -hh, hd), W(hw, -hh, hd), W(hw, hh, hd), [0, 0], [w, 0], [w, h], WN(0, 0, 1));
      tri(W(hw, -hh, -hd), W(-hw, -hh, -hd), W(hw, hh, -hd), [0, 0], [w, 0], [w, h], WN(0, 0, -1));
      return b;
    }

    function cylinder(pos, radius, height, segments, axis, capped) {
      var seg = Math.max(3, segments | 0 || 8);
      var ax = axis || 'y';
      var r = radius || 1, h = height || 1;
      var hh = h * 0.5;
      var px = pos[0] || 0, py = pos[1] || 0, pz = pos[2] || 0;
      var doCaps = capped !== false;
      var i, a0, a1, c0, s0, c1, s1;

      function place(u, v, w) {
        if (ax === 'x') return [px + w, py + u, pz + v];
        if (ax === 'z') return [px + u, py + v, pz + w];
        return [px + u, py + w, pz + v];
      }
      function nrmPlace(nu, nv, nw) {
        if (ax === 'x') return [nw, nu, nv];
        if (ax === 'z') return [nu, nv, nw];
        return [nu, nw, nv];
      }

      for (i = 0; i < seg; i++) {
        a0 = (i / seg) * Math.PI * 2;
        a1 = ((i + 1) / seg) * Math.PI * 2;
        c0 = Math.cos(a0); s0 = Math.sin(a0);
        c1 = Math.cos(a1); s1 = Math.sin(a1);
        var p0 = place(c0 * r, s0 * r, -hh);
        var p1 = place(c1 * r, s1 * r, -hh);
        var p2 = place(c1 * r, s1 * r, hh);
        var p3 = place(c0 * r, s0 * r, hh);
        var n0 = nrmPlace(c0, s0, 0);
        var n1 = nrmPlace(c1, s1, 0);
        var nMid = nrmPlace((c0 + c1) * 0.5, (s0 + s1) * 0.5, 0);
        var nl = Math.sqrt(nMid[0] * nMid[0] + nMid[1] * nMid[1] + nMid[2] * nMid[2]) || 1;
        nMid = [nMid[0] / nl, nMid[1] / nl, nMid[2] / nl];
        var u0 = (i / seg), u1 = ((i + 1) / seg);
        quad(p0, p1, p2, p3, [u0, 0], [u1, 0], [u1, h], [u0, h], nMid);
        if (doCaps) {
          var cTop = place(0, 0, hh);
          var cBot = place(0, 0, -hh);
          var nTop = nrmPlace(0, 0, 1);
          var nBot = nrmPlace(0, 0, -1);
          tri(cTop, p1, p2, [0.5, 0.5], [u0, 0.5], [u1, 0.5], nTop);
          tri(p0, cBot, p1, [u0, 0.5], [0.5, 0.5], [u1, 0.5], nBot);
        }
      }
      return b;
    }

    function sphere(pos, radius, segments, rings) {
      var seg = Math.max(3, segments | 0 || 12);
      var rg = Math.max(2, rings | 0 || 8);
      var r = radius || 1;
      var px = pos[0] || 0, py = pos[1] || 0, pz = pos[2] || 0;
      var i, j;
      for (j = 0; j < rg; j++) {
        var phi0 = (j / rg) * Math.PI;
        var phi1 = ((j + 1) / rg) * Math.PI;
        for (i = 0; i < seg; i++) {
          var t0 = (i / seg) * Math.PI * 2;
          var t1 = ((i + 1) / seg) * Math.PI * 2;
          var p00 = [px + Math.sin(phi0) * Math.cos(t0) * r, py + Math.cos(phi0) * r, pz + Math.sin(phi0) * Math.sin(t0) * r];
          var p10 = [px + Math.sin(phi0) * Math.cos(t1) * r, py + Math.cos(phi0) * r, pz + Math.sin(phi0) * Math.sin(t1) * r];
          var p11 = [px + Math.sin(phi1) * Math.cos(t1) * r, py + Math.cos(phi1) * r, pz + Math.sin(phi1) * Math.sin(t1) * r];
          var p01 = [px + Math.sin(phi1) * Math.cos(t0) * r, py + Math.cos(phi1) * r, pz + Math.sin(phi1) * Math.sin(t0) * r];
          var n00 = [(p00[0] - px) / r, (p00[1] - py) / r, (p00[2] - pz) / r];
          var n10 = [(p10[0] - px) / r, (p10[1] - py) / r, (p10[2] - pz) / r];
          var n11 = [(p11[0] - px) / r, (p11[1] - py) / r, (p11[2] - pz) / r];
          var n01 = [(p01[0] - px) / r, (p01[1] - py) / r, (p01[2] - pz) / r];
          var u0 = i / seg, u1 = (i + 1) / seg;
          var v0 = 1 - j / rg, v1 = 1 - (j + 1) / rg;
          // los polos degeneran en un triángulo
          if (j === 0) {
            tri(p00, p11, p01, [u0, v0], [u1, v1], [u0, v1], n01);
          } else if (j === rg - 1) {
            tri(p00, p10, p01, [u0, v0], [u1, v0], [u0, v1], n00);
          } else {
            var i0 = vertex(p00[0], p00[1], p00[2], n00[0], n00[1], n00[2], u0, v0);
            var i1 = vertex(p10[0], p10[1], p10[2], n10[0], n10[1], n10[2], u1, v0);
            var i2 = vertex(p11[0], p11[1], p11[2], n11[0], n11[1], n11[2], u1, v1);
            var i3 = vertex(p01[0], p01[1], p01[2], n01[0], n01[1], n01[2], u0, v1);
            pushIndex(buf, i0); pushIndex(buf, i1); pushIndex(buf, i2);
            pushIndex(buf, i0); pushIndex(buf, i2); pushIndex(buf, i3);
            b.primitiveCount++;
          }
        }
      }
      return b;
    }

    function quadPrim(p0, p1, p2, p3, normal, uvScale) {
      var us = uvScale ? uvScale[0] : 1;
      var vs = uvScale ? uvScale[1] : 1;
      var n = normal;
      if (!n) {
        var ax = p1[0] - p0[0], ay = p1[1] - p0[1], az = p1[2] - p0[2];
        var bx = p3[0] - p0[0], by = p3[1] - p0[1], bz = p3[2] - p0[2];
        var cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx;
        var len = Math.sqrt(cx * cx + cy * cy + cz * cz) || 1;
        n = [cx / len, cy / len, cz / len];
      }
      var w = Math.sqrt((p1[0] - p0[0]) * (p1[0] - p0[0]) + (p1[1] - p0[1]) * (p1[1] - p0[1]) + (p1[2] - p0[2]) * (p1[2] - p0[2]));
      var h = Math.sqrt((p3[0] - p0[0]) * (p3[0] - p0[0]) + (p3[1] - p0[1]) * (p3[1] - p0[1]) + (p3[2] - p0[2]) * (p3[2] - p0[2]));
      return quad(p0, p1, p2, p3, [0, 0], [w * us, 0], [w * us, h * vs], [0, h * vs], n);
    }

    function stairFlight(pos, size, steps, axis) {
      var n = Math.max(1, steps | 0 || 4);
      var ax = axis || '+x';
      var rise = (ax === '+x' || ax === '-x') ? 0 : 2;
      var lateral = rise === 0 ? 2 : 0;
      var span = size[rise] || 3;
      var h = size[1] || 2;
      var depth = size[lateral] || 2;
      var stepSpan = span / n;
      var stepH = h / n;
      var px = pos[0] || 0, py = pos[1] || 0, pz = pos[2] || 0;
      var flip = (ax === '-x' || ax === '-z');

      for (var i = 0; i < n; i++) {
        var t0 = -span * 0.5 + i * stepSpan;
        var hi = -h * 0.5 + (i + 1) * stepH;
        var lo = -h * 0.5;
        var c = (t0 + stepSpan * 0.5);
        var sizeArr = [0, 0, 0];
        var posArr = [0, 0, 0];
        if (!flip) {
          sizeArr[rise] = stepSpan;
          posArr[rise] = c;
        } else {
          sizeArr[rise] = stepSpan;
          posArr[rise] = -c;
        }
        sizeArr[1] = hi - lo;
        sizeArr[lateral] = depth;
        posArr[1] = (hi + lo) * 0.5;
        box([px + posArr[0], py + posArr[1], pz + posArr[2]], sizeArr, [1, 1]);
      }
      return b;
    }

    function tube(pos, size, wallThickness, rotY) {
      var w = size[0] || 1, h = size[1] || 1, d = size[2] || 1;
      var t = wallThickness || Math.min(w, h) * 0.15;
      var px = pos[0] || 0, py = pos[1] || 0, pz = pos[2] || 0;
      // 4 barras que forman un marco hueco en el plano XY
      box([px, py + (h - t) * 0.5, pz], [w, t, d], [1, 1], rotY);          // superior
      box([px, py - (h - t) * 0.5, pz], [w, t, d], [1, 1], rotY);          // inferior
      box([px - (w - t) * 0.5, py, pz], [t, h - t * 2, d], [1, 1], rotY);  // izquierda
      box([px + (w - t) * 0.5, py, pz], [t, h - t * 2, d], [1, 1], rotY);  // derecha
      return b;
    }

    function extrude2D(profile, thickness, plane, pos) {
      var pl = plane || 'xy';
      var th = thickness || 0.2;
      var px = pos ? (pos[0] || 0) : 0;
      var py = pos ? (pos[1] || 0) : 0;
      var pz = pos ? (pos[2] || 0) : 0;
      if (!profile || profile.length < 3) return b;

      function to3(a, b, depth) {
        if (pl === 'xz') return [px + a, py + depth, pz + b];
        if (pl === 'zy') return [px + depth, py + b, pz + a];
        return [px + a, py + b, pz + depth]; // 'xy'
      }
      var front = [], back = [], i;
      for (i = 0; i < profile.length; i++) {
        front.push(to3(profile[i][0], profile[i][1], th * 0.5));
        back.push(to3(profile[i][0], profile[i][1], -th * 0.5));
      }
      var nFront = (pl === 'xy') ? [0, 0, 1] : (pl === 'xz' ? [0, 1, 0] : [1, 0, 0]);
      var nBack = [-nFront[0], -nFront[1], -nFront[2]];
      // tapas (abanico; se asume perfil convexo)
      for (i = 1; i < front.length - 1; i++) {
        tri(front[0], front[i], front[i + 1], [0, 0], [1, 0], [1, 1], nFront);
        tri(back[0], back[i + 1], back[i], [0, 0], [1, 1], [1, 0], nBack);
      }
      // laterales
      for (i = 0; i < front.length; i++) {
        var j = (i + 1) % front.length;
        quad(front[i], front[j], back[j], back[i], [0, 0], [1, 0], [1, 1], [0, 1]);
      }
      return b;
    }

    /**
     * Añade geometría cruda. `positions` es un array plano xyz.
     * `colors`: o bien 4 números (tinte único) o un array plano por vértice.
     */
    function addRaw(positions, normals, uvs, colors, indices) {
      if (!positions || positions.length < 3) return b;
      var vcount = Math.floor(positions.length / 3);
      var perVertexColor = (colors && colors.length >= vcount * 4) ? colors : null;
      var singleColor = null;
      if (colors && colors.length >= 4 && colors.length < vcount * 4) {
        singleColor = [colors[0], colors[1], colors[2], colors.length >= 4 ? colors[3] : 1];
      }
      var savedColor = b.color;
      var base = buf.count;
      for (var i = 0; i < vcount; i++) {
        var nx = normals ? (normals[i * 3] || 0) : 0;
        var ny = normals ? (normals[i * 3 + 1] || 0) : 0;
        var nz = normals ? (normals[i * 3 + 2] || 0) : 0;
        var u = uvs ? (uvs[i * 2] || 0) : 0;
        var v = uvs ? (uvs[i * 2 + 1] || 0) : 0;
        if (perVertexColor) {
          b.color = [perVertexColor[i * 4], perVertexColor[i * 4 + 1], perVertexColor[i * 4 + 2]];
        } else if (singleColor) {
          b.color = [singleColor[0], singleColor[1], singleColor[2]];
        }
        vertex(positions[i * 3] || 0, positions[i * 3 + 1] || 0, positions[i * 3 + 2] || 0,
          nx, ny, nz, u, v);
      }
      b.color = savedColor;
      if (indices && indices.length) {
        for (var k = 0; k < indices.length; k++) pushIndex(buf, base + (indices[k] | 0));
      } else {
        // sin índices: se asume triángulo a triángulo en orden
        for (var t = 0; t + 2 < vcount; t += 3) {
          pushIndex(buf, base + t); pushIndex(buf, base + t + 1); pushIndex(buf, base + t + 2);
        }
      }
      return b;
    }

    /* ---------------- transformaciones ---------------- */
    function translate(dx, dy, dz) {
      st.tx += (dx || 0); st.ty += (dy || 0); st.tz += (dz || 0);
      return b;
    }
    function rotY(rad) {
      st.rot += (rad || 0);
      st.cos = Math.cos(st.rot); st.sin = Math.sin(st.rot);
      return b;
    }
    function scaleBy(s) {
      if (typeof s === 'number' && isFinite(s) && s !== 0) st.s *= s;
      return b;
    }

    /* ---------------- grupos / tags ---------------- */
    function closePart() {
      var p = parts[parts.length - 1];
      if (p && p.end < 0) p.end = buf.count;
    }
    function tag(name) {
      closePart();
      b._name = name || 'part';
      parts.push({ name: b._name, start: buf.count, end: -1 });
      return b;
    }
    function group(name) {
      closePart();
      var childSt = {
        tx: st.tx, ty: st.ty, tz: st.tz,
        rot: st.rot, cos: st.cos, sin: st.sin, s: st.s
      };
      parts.push({ name: name || 'group', start: buf.count, end: -1, group: true });
      return makeBuilder(buf, childSt, parts, name || 'group', [1, 1, 1, 1], 0);
    }

    function bounds() {
      var mn = [Infinity, Infinity, Infinity];
      var mx = [-Infinity, -Infinity, -Infinity];
      for (var i = 0; i < buf.count; i++) {
        for (var k = 0; k < 3; k++) {
          var v = buf.pos[i * 3 + k];
          if (v < mn[k]) mn[k] = v;
          if (v > mx[k]) mx[k] = v;
        }
      }
      if (!isFinite(mn[0])) { mn = [0, 0, 0]; mx = [0, 0, 0]; }
      return { min: new Float32Array(mn), max: new Float32Array(mx) };
    }

    function clear() {
      buf.count = 0;
      buf.icount = 0;
      buf.overflow = false;
      parts.length = 0;
      parts.push({ name: 'default', start: 0, end: -1 });
      b.overflow = false;
      b.primitiveCount = 0;
      return b;
    }

    /* API pública del builder */
    b.box = box;
    b.boxFaces = boxFaces;
    b.wedge = wedge;
    b.cylinder = cylinder;
    b.sphere = sphere;
    b.quad = quadPrim;
    b.stairFlight = stairFlight;
    b.tube = tube;
    b.extrude2D = extrude2D;
    b.addRaw = addRaw;
    b.translate = translate;
    b.rotY = rotY;
    b.scale = scaleBy;
    b.tag = tag;
    b.group = group;
    b.bounds = bounds;
    b.clear = clear;

    Object.defineProperty(b, 'vertexCount', {
      get: function () { return buf.count; },
      enumerable: true
    });
    Object.defineProperty(b, 'indexCount', {
      get: function () { return buf.icount; },
      enumerable: true
    });
    Object.defineProperty(b, 'parts', {
      get: function () { return parts; },
      enumerable: true
    });
    Object.defineProperty(b, 'overflowed', {
      get: function () { return buf.overflow; },
      enumerable: true
    });

    b.colorArray = b.color; // compatibilidad de lectura
    return b;
  }

  /* ----------------------------------------------------------------------
   * Interleaving -> Uint8Array de 36 bytes por vértice
   * -------------------------------------------------------------------- */
  function buildData(builder) {
    var buf = builder._buf;
    // cierra la última parte abierta
    var last = builder._parts[builder._parts.length - 1];
    if (last && last.end < 0) last.end = buf.count;

    var count = buf.count;
    var bytes = count * STRIDE;
    var arrayBuf = new ArrayBuffer(bytes);
    var f32 = new Float32Array(arrayBuf);
    var u8 = new Uint8Array(arrayBuf);

    for (var i = 0; i < count; i++) {
      var f = i * 9;
      var p3 = i * 3, p2 = i * 2, p4 = i * 4;
      f32[f] = buf.pos[p3];
      f32[f + 1] = buf.pos[p3 + 1];
      f32[f + 2] = buf.pos[p3 + 2];
      f32[f + 3] = buf.nrm[p3];
      f32[f + 4] = buf.nrm[p3 + 1];
      f32[f + 5] = buf.nrm[p3 + 2];
      f32[f + 6] = buf.uv[p2];
      f32[f + 7] = buf.uv[p2 + 1];
      // offset 32: 4 bytes de color (f32[8] NO debe escribirse: se solapa con aColor)
      var bo = i * STRIDE + 32;
      u8[bo] = buf.col[p4];
      u8[bo + 1] = buf.col[p4 + 1];
      u8[bo + 2] = buf.col[p4 + 2];
      u8[bo + 3] = buf.col[p4 + 3];
    }

    var indices = new Uint16Array(buf.icount);
    for (var k = 0; k < buf.icount; k++) indices[k] = buf.idx[k];

    // AABB
    var mn = [Infinity, Infinity, Infinity];
    var mx = [-Infinity, -Infinity, -Infinity];
    for (var v = 0; v < count; v++) {
      for (var c = 0; c < 3; c++) {
        var val = buf.pos[v * 3 + c];
        if (val < mn[c]) mn[c] = val;
        if (val > mx[c]) mx[c] = val;
      }
    }
    if (!isFinite(mn[0])) { mn = [0, 0, 0]; mx = [0, 0, 0]; }

    return {
      vertices: u8,
      indices: indices,
      vertexCount: count,
      indexCount: buf.icount,
      byteLength: bytes,
      stride: STRIDE,
      aabb: { min: new Float32Array(mn), max: new Float32Array(mx) },
      parts: builder._parts,
      overflowed: buf.overflow
    };
  }

  var Mesh = {
    STRIDE: STRIDE,
    MAX_VERTICES: MAX_VERTS,

    /** Crea un builder nuevo (formato de 36 bytes). */
    create: function () {
      var buf = newBuffers(256);
      var st = { tx: 0, ty: 0, tz: 0, rot: 0, cos: 1, sin: 0, s: 1 };
      var parts = [{ name: 'default', start: 0, end: -1 }];
      return makeBuilder(buf, st, parts, 'default', [1, 1, 1, 1], 0);
    },

    buildData: buildData,

    /** Sube el builder a GPU. */
    toGL: function (builder, gl) {
      var data = buildData(builder);
      var mgr = gl || BS.GL;
      if (!mgr || typeof mgr.createMesh !== 'function' || !mgr.gl) {
        // sin contexto: se devuelve el dato sin GPU (útil para tests)
        return {
          vbo: null, ibo: null,
          indexCount: data.indexCount,
          vertexCount: data.vertexCount,
          indexType: 5123, stride: STRIDE,
          aabb: data.aabb, attribs: true, data: data
        };
      }
      var mesh = mgr.createMesh(data.vertices, data.indices, data.aabb);
      return mesh;
    },

    /** Utilidad: construye y sube en un solo paso. */
    buildToGL: function (fn) {
      var b = Mesh.create();
      if (typeof fn === 'function') fn(b);
      return { builder: b, mesh: Mesh.toGL(b) };
    },

    dispose: function (mesh) {
      if (mesh && BS.GL && typeof BS.GL.disposeMesh === 'function') BS.GL.disposeMesh(mesh);
    }
  };

  BS.Mesh = Mesh;

  /* ======================================================================
   * Test: formato de 36 bytes, primitivas e integridad de índices
   * ==================================================================== */
  if (BS.Debug && typeof BS.Debug.register === 'function') {
    BS.Debug.register('mesh:stride', function () {
      var b = Mesh.create();
      b.color = [0.5, 0.25, 1.0];
      b.emissive = 0.5;
      b.box([0, 0, 0], [1, 2, 3], [1, 1]);
      b.emissive = 0;
      b.wedge([3, 1, 0], [2, 2, 2], '+x');
      b.stairFlight([0, 1, 5], [2, 2, 2], 3, '+z');
      b.cylinder([6, 0, 0], 0.5, 2, 8, 'y', true);
      b.sphere([9, 0, 0], 0.5, 8, 6);
      var data = Mesh.buildData(b);

      var strideOk = data.stride === 36 && (data.byteLength === data.vertexCount * 36);
      var countOk = data.vertexCount === b.vertexCount;
      var indexRangeOk = true;
      for (var i = 0; i < data.indices.length; i++) {
        if (data.indices[i] >= data.vertexCount) { indexRangeOk = false; break; }
      }
      // lectura de color del primer vértice (offset 32) y de la posición (offset 0)
      // box() emite la cara +X PRIMERO: primer vértice (0.5,-1,1.5), normal (1,0,0).
      var f32 = new Float32Array(data.vertices.buffer, 0, 8);
      var posOk = Math.abs(f32[0] - 0.5) < 1e-5 && Math.abs(f32[1] - (-1)) < 1e-5 && Math.abs(f32[2] - 1.5) < 1e-5;
      var r = data.vertices[32], g = data.vertices[33], bl = data.vertices[34], a = data.vertices[35];
      var colorOk = r === 128 && g === 64 && bl === 255 && a === 128;
      // la normal del primer vértice es la de la cara +X (1,0,0); el mínimo X
      // real del conjunto lo fija stairFlight en -1.0 (no -1.5, que era el
      // borde del box).
      var normalOk = Math.abs(f32[3] - 1) < 1e-5 && Math.abs(f32[4]) < 1e-5 && Math.abs(f32[5]) < 1e-5;
      var aabbOk = Math.abs(data.aabb.min[0] - (-1.0)) < 1e-4 && data.aabb.max[0] > 8;

      var uvOk = Math.abs(f32[6]) < 1e-5; // primera UV del primer vértice

      return {
        ok: strideOk && countOk && indexRangeOk && posOk && colorOk && normalOk && aabbOk && uvOk,
        stride: data.stride,
        byteLength: data.byteLength,
        vertexCount: data.vertexCount,
        indexCount: data.indexCount,
        tris: data.indexCount / 3,
        vertsCoinciden: countOk,
        indicesValidos: indexRangeOk,
        posicionOk: posOk,
        colorOk: colorOk,
        normalOk: normalOk,
        uvOk: uvOk,
        aabbOk: aabbOk,
        aabbMin: [data.aabb.min[0], data.aabb.min[1], data.aabb.min[2]],
        aabbMax: [data.aabb.max[0], data.aabb.max[1], data.aabb.max[2]],
        partes: b.parts.length
      };
    });
  }

})(window.BS = window.BS || {});
