/* ===========================================================================
 * BLACKSITE: LAST SIGNAL  —  js/core/textures.js
 * ---------------------------------------------------------------------------
 * Propósito : generación 100% procedural (sin recursos externos) y
 *             determinista (BS.RNG con semilla 0xB1AC) de todas las texturas,
 *             mapas de normales y máscaras emisivas, más el catálogo de
 *             materiales con IDs congelados. Los canvas 2D se conservan en
 *             BS.Textures.canvases para poder re-subir tras contextlost.
 * Depende de: js/core/util.js (BS.RNG, BS.Util, BS.Log, BS.Math), js/core/gl.js (BS.GL)
 * Expone    : BS.Textures
 * =========================================================================== */
(function (BS) {
  'use strict';

  var BASE_SEED = 0xB1AC;

  /* IDs congelados (§3.6) */
  var MATERIAL_IDS = [
    'mat_concrete_wall', 'mat_concrete_floor', 'mat_metal_panel', 'mat_metal_floor',
    'mat_ceiling_tile', 'mat_grate', 'mat_crate', 'mat_door', 'mat_pipe', 'mat_rust',
    'mat_glass', 'mat_terminal', 'mat_strip_cyan', 'mat_strip_red', 'mat_beacon',
    'mat_enemy_armor', 'mat_enemy_shell', 'mat_drone_chassis', 'mat_eye_glow',
    'mat_gun_metal', 'mat_gun_polymer', 'mat_gun_glow', 'mat_bolt_plasma',
    'mat_pickup_shell', 'mat_particle', 'mat_tracer'
  ];

  var TEX_NAMES = [
    'tex_concrete', 'tex_concrete_f', 'tex_metal', 'tex_metal_f', 'tex_tiles', 'tex_grate',
    'tex_crate', 'tex_door', 'tex_pipe', 'tex_rust', 'tex_glass', 'tex_terminal', 'tex_strip',
    'tex_armor', 'tex_shell', 'tex_guns', 'tex_gen'
  ];

  /* ----------------------------------------------------------------------
   * Utilidades internas
   * -------------------------------------------------------------------- */
  function makeCanvas(w, h) {
    var c = document.createElement('canvas');
    c.width = w | 0;
    c.height = h | 0;
    return c;
  }

  function ctx2d(canvas) {
    return canvas.getContext('2d');
  }

  function seedOf(name) {
    return (BS.RNG.hashString('bs:' + name) ^ BASE_SEED) >>> 0;
  }

  /** Campo de ruido de valor (bilineal suavizado y repetible). */
  function valueNoiseField(size, freq, rng) {
    freq = Math.max(1, freq | 0);
    var g = new Float32Array(freq * freq);
    for (var i = 0; i < g.length; i++) g[i] = rng();
    var out = new Float32Array(size * size);
    var scale = freq / size;
    for (var y = 0; y < size; y++) {
      var fy = y * scale;
      var y0 = Math.floor(fy);
      var ty = fy - y0;
      var y0m = (y0 % freq) * freq;
      var y1m = ((y0 + 1) % freq) * freq;
      var sy = ty * ty * (3 - 2 * ty);
      for (var x = 0; x < size; x++) {
        var fx = x * scale;
        var x0 = Math.floor(fx);
        var tx = fx - x0;
        var x0m = x0 % freq;
        var x1m = (x0 + 1) % freq;
        var sx = tx * tx * (3 - 2 * tx);
        var v00 = g[y0m + x0m], v10 = g[y0m + x1m];
        var v01 = g[y1m + x0m], v11 = g[y1m + x1m];
        var a = v00 + (v10 - v00) * sx;
        var b = v01 + (v11 - v01) * sx;
        out[y * size + x] = a + (b - a) * sy;
      }
    }
    return out;
  }

  /** Suma de octavas (fBm) normalizada a [0,1]. */
  function fbmField(size, baseFreq, octaves, gain, seed) {
    octaves = Math.max(1, octaves | 0);
    var out = new Float32Array(size * size);
    var amp = 1, total = 0, freq = Math.max(1, baseFreq | 0);
    for (var o = 0; o < octaves; o++) {
      var rng = BS.RNG.create((seed + o * 8191) >>> 0);
      var f = valueNoiseField(size, freq, rng);
      for (var i = 0; i < out.length; i++) out[i] += f[i] * amp;
      total += amp;
      amp *= (gain === undefined ? 0.5 : gain);
      freq = Math.min(2048, freq * 2);
    }
    var inv = total > 0 ? 1 / total : 1;
    for (var k = 0; k < out.length; k++) out[k] *= inv;
    return out;
  }

  /**
   * Convierte un campo [0,1] en canvas RGBA. `fn(v, out)` escribe out[0..3]
   * (se reutiliza el mismo array: cero basura por píxel).
   */
  function fieldToCanvas(size, field, fn) {
    var cv = makeCanvas(size, size);
    var c = ctx2d(cv);
    var img = c.createImageData(size, size);
    var d = img.data;
    var out = [0, 0, 0, 255];
    for (var i = 0; i < size * size; i++) {
      fn(field[i], out, i);
      d[i * 4] = out[0]; d[i * 4 + 1] = out[1]; d[i * 4 + 2] = out[2]; d[i * 4 + 3] = out[3];
    }
    c.putImageData(img, 0, 0);
    return cv;
  }

  function clamp255(v) { return v < 0 ? 0 : (v > 255 ? 255 : v | 0); }

  /** Normal map a partir de un canvas de altura (Sobel). */
  function normalFromHeight(heightCanvas, strength) {
    var size = heightCanvas.width;
    var c = ctx2d(heightCanvas);
    var data = c.getImageData(0, 0, size, size).data;
    var out = makeCanvas(size, size);
    var oc = ctx2d(out);
    var img = oc.createImageData(size, size);
    var d = img.data;
    var s = (strength === undefined ? 1 : strength);
    var at = function (x, y) {
      var xx = (x + size) % size, yy = (y + size) % size;
      var i = (yy * size + xx) * 4;
      return (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) / 255;
    };
    for (var y = 0; y < size; y++) {
      for (var x = 0; x < size; x++) {
        var dx = at(x + 1, y) - at(x - 1, y);
        var dy = at(x, y + 1) - at(x, y - 1);
        var nx = -dx * s * 4;
        var ny = -dy * s * 4;
        var nz = 1;
        var len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
        var i2 = (y * size + x) * 4;
        d[i2] = clamp255((nx / len * 0.5 + 0.5) * 255);
        d[i2 + 1] = clamp255((ny / len * 0.5 + 0.5) * 255);
        d[i2 + 2] = clamp255((nz / len * 0.5 + 0.5) * 255);
        d[i2 + 3] = 255;
      }
    }
    oc.putImageData(img, 0, 0);
    return out;
  }

  /** Manchas de suciedad / óxido sobre un canvas existente (in situ). */
  function grungeOverlay(canvas, amount, seed) {
    var c = ctx2d(canvas);
    var size = canvas.width;
    var rng = BS.RNG.create((seed === undefined ? seedOf('grunge') : seed) >>> 0);
    var n = Math.max(4, Math.floor(size * (amount === undefined ? 0.35 : amount) * 0.6));
    c.save();
    for (var i = 0; i < n; i++) {
      var x = rng() * size, y = rng() * size;
      var r = size * (0.01 + rng() * 0.07);
      var a = 0.04 + rng() * 0.16;
      var g = c.createRadialGradient(x, y, 0, x, y, r);
      var dark = rng() > 0.35;
      g.addColorStop(0, (dark ? 'rgba(0,0,0,' : 'rgba(255,255,255,') + a.toFixed(3) + ')');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = g;
      c.beginPath();
      c.arc(x, y, r, 0, Math.PI * 2);
      c.fill();
    }
    c.restore();
  }

  /** Máscara emisiva (blanco = emite). */
  function emissiveMaskCanvas(size, pattern, seed) {
    var cv = makeCanvas(size, size);
    var c = ctx2d(cv);
    var rng = BS.RNG.create((seed === undefined ? seedOf('emis') : seed) >>> 0);
    c.fillStyle = '#000';
    c.fillRect(0, 0, size, size);
    c.fillStyle = '#fff';
    c.strokeStyle = '#fff';
    var i;
    if (pattern === 'strip') {
      var barH = Math.max(2, Math.floor(size * 0.14));
      c.fillRect(0, Math.floor(size * 0.5 - barH * 0.5), size, barH);
      c.globalAlpha = 0.55;
      for (i = 0; i < size; i += Math.max(3, Math.floor(size / 16))) {
        c.fillRect(i, Math.floor(size * 0.5 - barH * 0.5), 1, barH);
      }
      c.globalAlpha = 1;
    } else if (pattern === 'dots') {
      var step = Math.max(4, Math.floor(size / 12));
      for (var y = step; y < size; y += step) {
        for (var x = step; x < size; x += step) {
          c.beginPath();
          c.arc(x, y, Math.max(1, step * 0.14), 0, Math.PI * 2);
          c.fill();
        }
      }
    } else if (pattern === 'screen') {
      c.fillRect(Math.floor(size * 0.12), Math.floor(size * 0.16), Math.floor(size * 0.76), Math.floor(size * 0.5));
      c.fillStyle = '#000';
      for (i = 0; i < size; i += 3) c.fillRect(0, i, size, 1);
      c.fillStyle = '#fff';
      for (i = 0; i < 6; i++) {
        var ly = Math.floor(size * (0.6 + i * 0.05));
        c.fillRect(Math.floor(size * 0.15), ly, Math.floor(size * (0.2 + rng() * 0.5)), 2);
      }
    } else { // 'panel'
      var pw = Math.max(6, Math.floor(size / 6));
      c.strokeStyle = '#fff';
      c.lineWidth = Math.max(1, size / 128);
      for (i = 0; i <= size; i += pw) {
        c.strokeRect(i + 1, 1, pw - 2, size - 2);
      }
      c.globalAlpha = 0.4;
      for (i = 0; i < 40; i++) {
        c.fillRect(rng() * size, rng() * size, 2, 2);
      }
      c.globalAlpha = 1;
    }
    return cv;
  }

  function valueNoiseCanvas(size, freq, octaves, seed) {
    var rng = BS.RNG.create((seed === undefined ? seedOf('vnoise') : seed) >>> 0);
    var f = valueNoiseField(size, freq, rng);
    return fieldToCanvas(size, f, function (v, o) {
      var g = clamp255(v * 255);
      o[0] = g; o[1] = g; o[2] = g; o[3] = 255;
    });
  }

  function fbmCanvas(size, baseFreq, octaves, gain, seed) {
    var f = fbmField(size, baseFreq, octaves, gain, (seed === undefined ? seedOf('fbm') : seed) >>> 0);
    return fieldToCanvas(size, f, function (v, o) {
      var g = clamp255(v * 255);
      o[0] = g; o[1] = g; o[2] = g; o[3] = 255;
    });
  }

  /* ----------------------------------------------------------------------
   * Generadores concretos por textura
   * -------------------------------------------------------------------- */
  function texConcrete(size, floor) {
    var name = floor ? 'tex_concrete_f' : 'tex_concrete';
    var seed = seedOf(name);
    var f = fbmField(size, floor ? 6 : 5, 4, 0.55, seed);
    var speck = valueNoiseField(size, 32, BS.RNG.create(seed + 77));
    var base = floor ? 0.20 : 0.28;
    var range = floor ? 0.16 : 0.20;
    var cv = fieldToCanvas(size, f, function (v, o, i) {
      var s = speck[i];
      var g = base + (v - 0.5) * range * 2 + (s - 0.5) * 0.06;
      o[0] = clamp255(g * 255 * 0.98);
      o[1] = clamp255(g * 255 * 1.0);
      o[2] = clamp255(g * 255 * 1.06);
      o[3] = 255;
    });
    var c = ctx2d(cv);
    var rng = BS.RNG.create(seed + 3);
    // grietas / desconchones
    c.strokeStyle = 'rgba(0,0,0,0.42)';
    c.lineWidth = Math.max(1, size / 128);
    for (var k = 0; k < (floor ? 16 : 8); k++) {
      var x = rng() * size, y = rng() * size;
      c.beginPath();
      c.moveTo(x, y);
      for (var s2 = 0; s2 < 5; s2++) {
        x += (rng() - 0.5) * size * 0.25;
        y += (rng() - 0.5) * size * 0.25;
        c.lineTo(x, y);
      }
      c.stroke();
    }
    // junta de placas (vertical) para las paredes
    if (!floor) {
      c.fillStyle = 'rgba(0,0,0,0.5)';
      c.fillRect(Math.floor(size * 0.5) - 1, 0, 2, size);
      c.fillStyle = 'rgba(255,255,255,0.05)';
      c.fillRect(Math.floor(size * 0.5) + 1, 0, 1, size);
    } else {
      c.strokeStyle = 'rgba(0,0,0,0.35)';
      c.strokeRect(0.5, 0.5, size - 1, size - 1);
    }
    grungeOverlay(cv, 0.5, seed + 11);
    return cv;
  }

  function texMetal(size, floor) {
    var name = floor ? 'tex_metal_f' : 'tex_metal';
    var seed = seedOf(name);
    var f = fbmField(size, 4, 3, 0.5, seed);
    var brush = valueNoiseField(size, 64, BS.RNG.create(seed + 21));
    var cv = fieldToCanvas(size, f, function (v, o, i) {
      var g = 0.30 + (v - 0.5) * 0.20 + (brush[i] - 0.5) * 0.08;
      o[0] = clamp255(g * 255 * 0.92);
      o[1] = clamp255(g * 255 * 0.96);
      o[2] = clamp255(g * 255 * 1.04);
      o[3] = 255;
    });
    var c = ctx2d(cv);
    c.lineWidth = Math.max(1, size / 128);
    if (floor) {
      // placa diamantada
      var step = Math.max(6, Math.floor(size / 8));
      c.strokeStyle = 'rgba(255,255,255,0.13)';
      c.fillStyle = 'rgba(0,0,0,0.18)';
      for (var y = 0; y < size; y += step) {
        for (var x = 0; x < size; x += step) {
          c.save();
          c.translate(x + step * 0.5, y + step * 0.5);
          c.rotate((((x / step) + (y / step)) % 2) ? 0.6 : -0.6);
          c.fillRect(-step * 0.28, -step * 0.07, step * 0.56, step * 0.14);
          c.strokeRect(-step * 0.28, -step * 0.07, step * 0.56, step * 0.14);
          c.restore();
        }
      }
    } else {
      // paneles remachados
      var pw = Math.floor(size / 2);
      c.strokeStyle = 'rgba(0,0,0,0.55)';
      c.strokeRect(0.5, 0.5, size - 1, size - 1);
      c.beginPath();
      c.moveTo(pw, 0); c.lineTo(pw, size);
      c.moveTo(0, pw); c.lineTo(size, pw);
      c.stroke();
      c.fillStyle = 'rgba(255,255,255,0.10)';
      var r = Math.max(1, size / 64);
      for (var i = 0; i < 8; i++) {
        var ax = (i % 4) * (size / 4) + size / 8;
        var ay = (i < 4 ? 0 : 1) * (size / 2) + size / 4;
        c.beginPath(); c.arc(ax, ay, r, 0, Math.PI * 2); c.fill();
      }
    }
    grungeOverlay(cv, 0.35, seed + 5);
    return cv;
  }

  function texTiles(size) {
    var seed = seedOf('tex_tiles');
    var f = fbmField(size, 8, 3, 0.5, seed);
    var cv = fieldToCanvas(size, f, function (v, o) {
      var g = 0.42 + (v - 0.5) * 0.10;
      o[0] = clamp255(g * 255 * 0.99);
      o[1] = clamp255(g * 255);
      o[2] = clamp255(g * 255 * 1.03);
      o[3] = 255;
    });
    var c = ctx2d(cv);
    var half = size / 2;
    c.fillStyle = 'rgba(0,0,0,0.35)';
    c.fillRect(half - 1, 0, 2, size);
    c.fillRect(0, half - 1, size, 2);
    c.fillStyle = 'rgba(255,255,255,0.06)';
    c.fillRect(half + 1, 0, 1, size);
    c.fillRect(0, half + 1, size, 1);
    var rng = BS.RNG.create(seed + 9);
    c.fillStyle = 'rgba(0,0,0,0.30)';
    var step = Math.max(4, Math.floor(size / 16));
    for (var y = step; y < size; y += step) {
      for (var x = step; x < size; x += step) {
        c.beginPath();
        c.arc(x + rng() * 2, y + rng() * 2, Math.max(1, step * 0.09), 0, Math.PI * 2);
        c.fill();
      }
    }
    grungeOverlay(cv, 0.25, seed + 4);
    return cv;
  }

  function texGrate(size) {
    var seed = seedOf('tex_grate');
    var f = fbmField(size, 6, 3, 0.5, seed);
    var cv = fieldToCanvas(size, f, function (v, o) {
      var g = 0.16 + v * 0.08;
      o[0] = clamp255(g * 255); o[1] = clamp255(g * 255); o[2] = clamp255(g * 255 * 1.05);
      o[3] = 255;
    });
    var c = ctx2d(cv);
    var n = 8;
    var bar = Math.max(2, Math.floor(size / n * 0.42));
    var step2 = Math.floor(size / n);
    c.fillStyle = 'rgba(190,196,205,0.85)';
    for (var i = 0; i < n; i++) {
      c.fillRect(i * step2, 0, bar, size);
      c.fillRect(0, i * step2, size, bar);
    }
    c.fillStyle = 'rgba(0,0,0,0.35)';
    for (var k = 0; k < n; k++) {
      c.fillRect(k * step2 + bar, 0, Math.max(1, bar * 0.3), size);
      c.fillRect(0, k * step2 + bar, size, Math.max(1, bar * 0.3));
    }
    grungeOverlay(cv, 0.4, seed + 2);
    return cv;
  }

  function texCrate(size) {
    var seed = seedOf('tex_crate');
    var f = fbmField(size, 5, 3, 0.55, seed);
    var cv = fieldToCanvas(size, f, function (v, o) {
      var g = 0.26 + (v - 0.5) * 0.16;
      o[0] = clamp255(g * 255 * 1.18);
      o[1] = clamp255(g * 255 * 1.02);
      o[2] = clamp255(g * 255 * 0.78);
      o[3] = 255;
    });
    var c = ctx2d(cv);
    var m = Math.floor(size * 0.09);
    c.strokeStyle = 'rgba(0,0,0,0.5)';
    c.lineWidth = Math.max(1, size / 96);
    c.strokeRect(m, m, size - m * 2, size - m * 2);
    c.beginPath();
    c.moveTo(m, m); c.lineTo(size - m, size - m);
    c.moveTo(size - m, m); c.lineTo(m, size - m);
    c.stroke();
    c.fillStyle = 'rgba(0,0,0,0.22)';
    c.fillRect(0, size - m * 0.8, size, m * 0.8);
    grungeOverlay(cv, 0.4, seed + 6);
    return cv;
  }

  function texDoor(size) {
    var seed = seedOf('tex_door');
    var f = fbmField(size, 4, 3, 0.5, seed);
    var cv = fieldToCanvas(size, f, function (v, o) {
      var g = 0.22 + (v - 0.5) * 0.12;
      o[0] = clamp255(g * 255 * 0.96);
      o[1] = clamp255(g * 255 * 1.0);
      o[2] = clamp255(g * 255 * 1.08);
      o[3] = 255;
    });
    var c = ctx2d(cv);
    c.fillStyle = 'rgba(0,0,0,0.62)';
    c.fillRect(size * 0.5 - 1, 0, 2, size);
    c.strokeRect(1, 1, size - 2, size - 2);
    // franjas de peligro en la base
    var bandY = Math.floor(size * 0.74), bandH = Math.floor(size * 0.14);
    c.save();
    c.beginPath(); c.rect(0, bandY, size, bandH); c.clip();
    c.fillStyle = '#1b1b1b'; c.fillRect(0, bandY, size, bandH);
    c.fillStyle = 'rgba(240,190,40,0.85)';
    for (var x = -bandH; x < size; x += bandH * 1.0) {
      c.beginPath();
      c.moveTo(x, bandY + bandH);
      c.lineTo(x + bandH * 0.5, bandY);
      c.lineTo(x + bandH, bandY);
      c.lineTo(x + bandH * 0.5, bandY + bandH);
      c.closePath();
      c.fill();
    }
    c.restore();
    // mirilla
    c.fillStyle = 'rgba(120,220,255,0.22)';
    c.fillRect(size * 0.34, size * 0.16, size * 0.32, size * 0.2);
    c.strokeStyle = 'rgba(0,0,0,0.7)';
    c.strokeRect(size * 0.34, size * 0.16, size * 0.32, size * 0.2);
    grungeOverlay(cv, 0.35, seed + 8);
    return cv;
  }

  function texPipe(size) {
    var seed = seedOf('tex_pipe');
    var f = fbmField(size, 3, 3, 0.5, seed);
    var cv = fieldToCanvas(size, f, function (v, o, i) {
      var y = Math.floor(i / size) / size;
      var shade = 0.5 + 0.5 * Math.sin(y * Math.PI); // cilindro simulado
      var g = (0.24 + (v - 0.5) * 0.14) * (0.6 + shade * 0.6);
      o[0] = clamp255(g * 255 * 0.9);
      o[1] = clamp255(g * 255 * 0.95);
      o[2] = clamp255(g * 255 * 1.05);
      o[3] = 255;
    });
    var c = ctx2d(cv);
    c.fillStyle = 'rgba(0,0,0,0.4)';
    c.fillRect(0, size * 0.18, size, 2);
    c.fillRect(0, size * 0.82, size, 2);
    c.fillStyle = 'rgba(255,255,255,0.12)';
    c.fillRect(0, size * 0.20, size, 1);
    grungeOverlay(cv, 0.45, seed + 12);
    return cv;
  }

  function texRust(size) {
    var seed = seedOf('tex_rust');
    var f = fbmField(size, 5, 4, 0.55, seed);
    var blotch = valueNoiseField(size, 9, BS.RNG.create(seed + 31));
    var cv = fieldToCanvas(size, f, function (v, o, i) {
      var b = BS.Math.smoothstep(0.48, 0.72, blotch[i]);
      var base = 0.26 + (v - 0.5) * 0.16;
      o[0] = clamp255((base * (1 - b) + 0.42 * b) * 255);
      o[1] = clamp255((base * (1 - b) + 0.20 * b) * 255);
      o[2] = clamp255((base * (1 - b) + 0.08 * b) * 255);
      o[3] = 255;
    });
    grungeOverlay(cv, 0.7, seed + 13);
    return cv;
  }

  function texGlass(size) {
    var cv = makeCanvas(size, size);
    var c = ctx2d(cv);
    var g = c.createLinearGradient(0, 0, size, size);
    g.addColorStop(0, 'rgba(90,140,170,0.55)');
    g.addColorStop(0.5, 'rgba(30,60,80,0.35)');
    g.addColorStop(1, 'rgba(120,190,220,0.5)');
    c.fillStyle = g;
    c.fillRect(0, 0, size, size);
    c.strokeStyle = 'rgba(200,225,240,0.5)';
    c.lineWidth = Math.max(1, size / 64);
    c.strokeRect(size * 0.06, size * 0.06, size * 0.88, size * 0.88);
    c.fillStyle = 'rgba(255,255,255,0.10)';
    c.beginPath();
    c.moveTo(0, size); c.lineTo(size * 0.4, 0); c.lineTo(size * 0.55, 0); c.lineTo(size * 0.15, size);
    c.closePath();
    c.fill();
    return cv;
  }

  function texTerminal(size) {
    var seed = seedOf('tex_terminal');
    var f = fbmField(size, 6, 3, 0.5, seed);
    var cv = fieldToCanvas(size, f, function (v, o) {
      var g = 0.14 + (v - 0.5) * 0.08;
      o[0] = clamp255(g * 255); o[1] = clamp255(g * 255 * 1.05); o[2] = clamp255(g * 255 * 1.15);
      o[3] = 255;
    });
    var c = ctx2d(cv);
    c.fillStyle = 'rgba(10,26,32,0.95)';
    c.fillRect(size * 0.12, size * 0.14, size * 0.76, size * 0.44);
    c.fillStyle = 'rgba(90,220,240,0.75)';
    for (var i = 0; i < 10; i++) {
      var y = size * (0.18 + i * 0.038);
      c.fillRect(size * 0.16, y, size * (0.1 + (i % 5) * 0.11), Math.max(1, size / 128));
    }
    c.fillStyle = 'rgba(255,255,255,0.08)';
    c.fillRect(size * 0.12, size * 0.64, size * 0.76, size * 0.22);
    c.fillStyle = 'rgba(255,90,70,0.7)';
    c.beginPath(); c.arc(size * 0.2, size * 0.75, size * 0.03, 0, Math.PI * 2); c.fill();
    c.fillStyle = 'rgba(90,240,150,0.7)';
    c.beginPath(); c.arc(size * 0.3, size * 0.75, size * 0.03, 0, Math.PI * 2); c.fill();
    grungeOverlay(cv, 0.3, seed + 17);
    return cv;
  }

  function texStrip(size) {
    var seed = seedOf('tex_strip');
    var cv = makeCanvas(size, size);
    var c = ctx2d(cv);
    c.fillStyle = '#101214';
    c.fillRect(0, 0, size, size);
    var barH = Math.floor(size * 0.16);
    var g = c.createLinearGradient(0, size * 0.5 - barH, 0, size * 0.5 + barH);
    g.addColorStop(0, '#0b0d0e');
    g.addColorStop(0.45, '#ffffff');
    g.addColorStop(0.55, '#ffffff');
    g.addColorStop(1, '#0b0d0e');
    c.fillStyle = g;
    c.fillRect(0, Math.floor(size * 0.5 - barH * 0.6), size, Math.floor(barH * 1.2));
    c.fillStyle = 'rgba(0,0,0,0.5)';
    for (var i = 0; i < size; i += Math.max(4, Math.floor(size / 20))) {
      c.fillRect(i, Math.floor(size * 0.5 - barH * 0.6), 1, Math.floor(barH * 1.2));
    }
    grungeOverlay(cv, 0.2, seed + 19);
    return cv;
  }

  function texArmor(size) {
    var seed = seedOf('tex_armor');
    var f = fbmField(size, 6, 4, 0.5, seed);
    var cv = fieldToCanvas(size, f, function (v, o) {
      var g = 0.18 + (v - 0.5) * 0.14;
      o[0] = clamp255(g * 255 * 0.95);
      o[1] = clamp255(g * 255 * 1.0);
      o[2] = clamp255(g * 255 * 1.1);
      o[3] = 255;
    });
    var c = ctx2d(cv);
    var step = Math.max(8, Math.floor(size / 6));
    c.strokeStyle = 'rgba(0,0,0,0.55)';
    c.lineWidth = Math.max(1, size / 128);
    for (var y = 0; y < size + step; y += step) {
      for (var x = 0; x < size + step; x += step) {
        var ox = ((y / step) % 2) ? step * 0.5 : 0;
        c.beginPath();
        for (var k = 0; k <= 6; k++) {
          var a = Math.PI / 3 * k + Math.PI / 6;
          var px = x + ox + Math.cos(a) * step * 0.46;
          var py = y + Math.sin(a) * step * 0.46;
          if (k === 0) c.moveTo(px, py); else c.lineTo(px, py);
        }
        c.closePath();
        c.stroke();
      }
    }
    grungeOverlay(cv, 0.3, seed + 23);
    return cv;
  }

  function texShell(size) {
    var seed = seedOf('tex_shell');
    var cv = makeCanvas(size, size);
    var c = ctx2d(cv);
    c.fillStyle = '#1a1f22';
    c.fillRect(0, 0, size, size);
    var rng = BS.RNG.create(seed);
    for (var i = 0; i < 26; i++) {
      var cx = rng() * size, cy = rng() * size;
      var r = size * (0.05 + rng() * 0.16);
      c.strokeStyle = 'rgba(120,150,160,' + (0.10 + rng() * 0.22).toFixed(2) + ')';
      c.lineWidth = Math.max(1, size / 96);
      for (var k = 0; k < 4; k++) {
        c.beginPath();
        c.arc(cx, cy, r * (1 - k * 0.22), 0.6, Math.PI * 1.6);
        c.stroke();
      }
    }
    grungeOverlay(cv, 0.35, seed + 29);
    return cv;
  }

  function texGuns(size) {
    var seed = seedOf('tex_guns');
    var f = fbmField(size, 8, 3, 0.5, seed);
    var cv = fieldToCanvas(size, f, function (v, o, i) {
      var y = Math.floor(i / size) / size;
      var g = 0.16 + (v - 0.5) * 0.10 + (y < 0.5 ? 0.03 : -0.02);
      o[0] = clamp255(g * 255 * 0.92);
      o[1] = clamp255(g * 255 * 0.95);
      o[2] = clamp255(g * 255 * 1.0);
      o[3] = 255;
    });
    var c = ctx2d(cv);
    c.fillStyle = 'rgba(0,0,0,0.45)';
    for (var i2 = 0; i2 < 8; i2++) c.fillRect(0, size * (0.12 + i2 * 0.1), size, 1);
    c.strokeStyle = 'rgba(255,255,255,0.05)';
    c.strokeRect(0.5, 0.5, size - 1, size - 1);
    grungeOverlay(cv, 0.25, seed + 37);
    return cv;
  }

  function texGen(size) {
    var seed = seedOf('tex_gen');
    var f = fbmField(size, 5, 4, 0.55, seed);
    return fieldToCanvas(size, f, function (v, o) {
      var g = 0.22 + (v - 0.5) * 0.3;
      o[0] = clamp255(g * 255); o[1] = clamp255(g * 255); o[2] = clamp255(g * 255 * 1.05);
      o[3] = 255;
    });
  }

  /* ----------------------------------------------------------------------
   * Catálogo de materiales
   * -------------------------------------------------------------------- */
  function mat(id, mapName, opts) {
    opts = opts || {};
    return {
      id: id,
      map: mapName,
      normalMap: opts.normal || null,
      emissiveMap: opts.emissive || null,
      uvScale: opts.uv || [1, 1],
      specular: (opts.specular === undefined) ? 0.15 : opts.specular,
      normalStrength: (opts.normalStrength === undefined) ? 0.7 : opts.normalStrength,
      emissive: opts.emissiveColor || [0, 0, 0],
      emissiveIntensity: (opts.emissiveIntensity === undefined) ? 1 : opts.emissiveIntensity,
      blend: opts.blend || 'opaque',
      depthWrite: (opts.depthWrite === undefined) ? true : opts.depthWrite,
      doubleSided: !!opts.doubleSided,
      program: opts.program || 'basic',
      roughnessTint: opts.roughnessTint || [1, 1, 1]
    };
  }

  function buildMaterialTable() {
    var T = {};
    T.mat_concrete_wall = mat('mat_concrete_wall', 'tex_concrete', { normal: 'tex_concrete_n', uv: [1, 1], specular: 0.04, normalStrength: 0.6 });
    T.mat_concrete_floor = mat('mat_concrete_floor', 'tex_concrete_f', { normal: 'tex_concrete_f_n', uv: [1, 1], specular: 0.03, normalStrength: 0.7 });
    T.mat_metal_panel = mat('mat_metal_panel', 'tex_metal', { normal: 'tex_metal_n', uv: [1, 1], specular: 0.36, normalStrength: 0.8 });
    T.mat_metal_floor = mat('mat_metal_floor', 'tex_metal_f', { normal: 'tex_metal_f_n', uv: [1, 1], specular: 0.30, normalStrength: 0.9 });
    T.mat_ceiling_tile = mat('mat_ceiling_tile', 'tex_tiles', { normal: 'tex_tiles_n', uv: [1, 1], specular: 0.05, normalStrength: 0.5 });
    T.mat_grate = mat('mat_grate', 'tex_grate', { normal: 'tex_grate_n', uv: [1, 1], specular: 0.22, normalStrength: 0.9 });
    T.mat_crate = mat('mat_crate', 'tex_crate', { normal: 'tex_crate_n', uv: [1, 1], specular: 0.08 });
    T.mat_door = mat('mat_door', 'tex_door', { normal: 'tex_door_n', uv: [1, 1], specular: 0.28 });
    T.mat_pipe = mat('mat_pipe', 'tex_pipe', { normal: 'tex_pipe_n', uv: [1, 1], specular: 0.34 });
    T.mat_rust = mat('mat_rust', 'tex_rust', { normal: 'tex_rust_n', uv: [1, 1], specular: 0.12 });
    T.mat_glass = mat('mat_glass', 'tex_glass', {
      uv: [1, 1], specular: 0.55, blend: 'alpha', depthWrite: false, doubleSided: true,
      emissiveColor: [0.05, 0.10, 0.12], emissiveIntensity: 0.4
    });
    T.mat_terminal = mat('mat_terminal', 'tex_terminal', {
      normal: 'tex_terminal_n', emissive: 'tex_terminal_e', uv: [1, 1], specular: 0.4,
      emissiveColor: [0.35, 0.95, 1.0], emissiveIntensity: 1.2
    });
    T.mat_strip_cyan = mat('mat_strip_cyan', 'tex_strip', {
      emissive: 'tex_strip_e', uv: [1, 1], specular: 0.1,
      emissiveColor: [0.45, 1.0, 1.0], emissiveIntensity: 1.6
    });
    T.mat_strip_red = mat('mat_strip_red', 'tex_strip', {
      emissive: 'tex_strip_e', uv: [1, 1], specular: 0.1,
      emissiveColor: [1.0, 0.22, 0.16], emissiveIntensity: 1.6
    });
    T.mat_beacon = mat('mat_beacon', 'tex_strip', {
      emissive: 'tex_strip_e', uv: [1, 1], specular: 0.1,
      emissiveColor: [1.0, 0.62, 0.16], emissiveIntensity: 1.8
    });
    T.mat_enemy_armor = mat('mat_enemy_armor', 'tex_armor', { normal: 'tex_armor_n', uv: [1, 1], specular: 0.42, normalStrength: 0.85 });
    T.mat_enemy_shell = mat('mat_enemy_shell', 'tex_shell', { uv: [1, 1], specular: 0.2, normalStrength: 0.6 });
    T.mat_drone_chassis = mat('mat_drone_chassis', 'tex_gen', { normal: 'tex_gen_n', uv: [1, 1], specular: 0.4, normalStrength: 0.7 });
    T.mat_eye_glow = mat('mat_eye_glow', 'tex_strip', {
      emissive: 'tex_strip_e', uv: [1, 1],
      emissiveColor: [0.5, 1.0, 0.95], emissiveIntensity: 2.2,
      blend: 'opaque', specular: 0.0
    });
    T.mat_gun_metal = mat('mat_gun_metal', 'tex_guns', { normal: 'tex_guns_n', uv: [1, 1], specular: 0.45, normalStrength: 0.6 });
    T.mat_gun_polymer = mat('mat_gun_polymer', 'tex_gen', { uv: [2, 2], specular: 0.18, emissiveColor: [0, 0, 0] });
    T.mat_gun_glow = mat('mat_gun_glow', 'tex_strip', {
      emissive: 'tex_strip_e', uv: [1, 1],
      emissiveColor: [0.4, 0.9, 1.0], emissiveIntensity: 1.4
    });
    T.mat_bolt_plasma = mat('mat_bolt_plasma', 'tex_strip', {
      emissive: 'tex_strip_e', uv: [1, 1], blend: 'add', depthWrite: false,
      emissiveColor: [0.45, 0.85, 1.0], emissiveIntensity: 2.0
    });
    T.mat_pickup_shell = mat('mat_pickup_shell', 'tex_metal', { normal: 'tex_metal_n', uv: [1, 1], specular: 0.4 });
    T.mat_particle = mat('mat_particle', 'tex_particle', {
      program: 'sprite', blend: 'add', depthWrite: false, doubleSided: true,
      emissiveColor: [1, 1, 1], emissiveIntensity: 1.0, specular: 0.0
    });
    T.mat_tracer = mat('mat_tracer', 'tex_tracer', {
      program: 'sprite', blend: 'add', depthWrite: false, doubleSided: true,
      emissiveColor: [1, 1, 1], emissiveIntensity: 1.0, specular: 0.0
    });
    return T;
  }

  /* ----------------------------------------------------------------------
   * Texturas auxiliares de sprites (partículas y trazadoras)
   * -------------------------------------------------------------------- */
  function particleCanvas(size) {
    var cv = makeCanvas(size, size);
    var c = ctx2d(cv);
    var img = c.createImageData(size, size);
    var d = img.data;
    var half = size / 2;
    for (var y = 0; y < size; y++) {
      for (var x = 0; x < size; x++) {
        var dx = (x + 0.5 - half) / half;
        var dy = (y + 0.5 - half) / half;
        var r = Math.sqrt(dx * dx + dy * dy);
        var a = 1 - BS.Math.smoothstep(0.15, 1.0, r);
        a = a * a * 255;
        var i = (y * size + x) * 4;
        d[i] = 255; d[i + 1] = 255; d[i + 2] = 255; d[i + 3] = clamp255(a);
      }
    }
    c.putImageData(img, 0, 0);
    return cv;
  }

  function tracerCanvas(size) {
    var cv = makeCanvas(size, size);
    var c = ctx2d(cv);
    var img = c.createImageData(size, size);
    var d = img.data;
    for (var y = 0; y < size; y++) {
      var fy = (y + 0.5) / size;
      var aY = 1 - Math.abs(fy - 0.5) * 2;
      aY = aY * aY * aY;
      for (var x = 0; x < size; x++) {
        var fx = (x + 0.5) / size;
        var aX = Math.pow(1 - Math.abs(fx - 0.5) * 2, 1.5);
        var i = (y * size + x) * 4;
        d[i] = 255; d[i + 1] = 255; d[i + 2] = 255;
        d[i + 3] = clamp255(aY * aX * 255);
      }
    }
    c.putImageData(img, 0, 0);
    return cv;
  }

  /* ----------------------------------------------------------------------
   * Módulo
   * -------------------------------------------------------------------- */
  var Textures = {
    canvases: {},
    lib: {},
    materials: {},
    textureSize: 256,
    buildMs: 0,
    buildPhases: {},
    _gl: null,
    MAX_TEXTURE_SIZE: 256,

    init: function (gl) {
      Textures._gl = gl || BS.GL || null;
      var t0 = BS.Util.nowMs();
      Textures.generateAll();
      Textures.buildPhases.canvasMs = BS.Util.nowMs() - t0;

      var t1 = BS.Util.nowMs();
      Textures.uploadAll();
      Textures.buildPhases.uploadMs = BS.Util.nowMs() - t1;

      Textures.buildMs = BS.Util.nowMs() - t0;
      BS.Log.info('BS.Textures.init: ' + Object.keys(Textures.canvases).length + ' canvas, ' +
        Object.keys(Textures.materials).length + ' materiales en ' + Math.round(Textures.buildMs) + ' ms');
    },

    /** Tras webglcontextrestored: re-sube desde los canvas conservados. */
    rebuild: function () {
      Textures._gl = BS.GL || Textures._gl;
      Textures.lib = {};
      Textures.uploadAll();
      // Hallazgo 7 (se resuelve desde aquí, sin tocar gl.js): tras el contexto
      // restaurado, BS.GL._resetCaches() deja `_white` a null y uTex() lo usaría
      // (bindTexture(TEXTURE_2D, null)). El getter público lo recrea de forma
      // perezosa; forzarlo aquí garantiza que ningún sampler quede sin textura.
      // Además, uploadAll deja TODOS los materiales con map resuelto desde su nombre
      // lógico (`_mapName`), así que aquí nunca se pasa null a uTex por material.
      if (BS.GL && typeof BS.GL.getWhiteTexture === 'function') {
        try { BS.GL.getWhiteTexture(); } catch (e) { /* noop */ }
      }
      BS.Log.info('BS.Textures.rebuild: recursos GL reconstruidos');
    },

    setTextureSize: function (px) {
      px = px | 0;
      if (px !== 128 && px !== 256 && px !== 512) {
        // escala al valor permitido más cercano
        px = px <= 160 ? 128 : (px <= 384 ? 256 : 512);
      }
      if (Textures.MAX_TEXTURE_SIZE && px > Textures.MAX_TEXTURE_SIZE) px = Textures.MAX_TEXTURE_SIZE;
      if (px === Textures.textureSize) return;
      Textures.textureSize = px;
      Textures.init(Textures._gl);
    },

    getSize: function () { return Textures.textureSize; },

    /** Genera TODOS los canvas (determinista). */
    generateAll: function () {
      var S = Textures.textureSize;
      var cv = Textures.canvases;
      cv.tex_concrete = texConcrete(S, false);
      cv.tex_concrete_f = texConcrete(S, true);
      cv.tex_metal = texMetal(S, false);
      cv.tex_metal_f = texMetal(S, true);
      cv.tex_tiles = texTiles(S);
      cv.tex_grate = texGrate(S);
      cv.tex_crate = texCrate(S);
      cv.tex_door = texDoor(S);
      cv.tex_pipe = texPipe(S);
      cv.tex_rust = texRust(S);
      cv.tex_glass = texGlass(S);
      cv.tex_terminal = texTerminal(S);
      cv.tex_strip = texStrip(S);
      cv.tex_armor = texArmor(S);
      cv.tex_shell = texShell(S);
      cv.tex_guns = texGuns(S);
      cv.tex_gen = texGen(S);

      // mapas de normales
      cv.tex_concrete_n = normalFromHeight(cv.tex_concrete, 1.0);
      cv.tex_concrete_f_n = normalFromHeight(cv.tex_concrete_f, 1.1);
      cv.tex_metal_n = normalFromHeight(cv.tex_metal, 1.2);
      cv.tex_metal_f_n = normalFromHeight(cv.tex_metal_f, 1.4);
      cv.tex_tiles_n = normalFromHeight(cv.tex_tiles, 0.9);
      cv.tex_grate_n = normalFromHeight(cv.tex_grate, 1.5);
      cv.tex_crate_n = normalFromHeight(cv.tex_crate, 1.0);
      cv.tex_door_n = normalFromHeight(cv.tex_door, 1.0);
      cv.tex_pipe_n = normalFromHeight(cv.tex_pipe, 1.2);
      cv.tex_rust_n = normalFromHeight(cv.tex_rust, 1.3);
      cv.tex_terminal_n = normalFromHeight(cv.tex_terminal, 0.8);
      cv.tex_armor_n = normalFromHeight(cv.tex_armor, 1.2);
      cv.tex_gen_n = normalFromHeight(cv.tex_gen, 1.0);
      cv.tex_guns_n = normalFromHeight(cv.tex_guns, 0.7);

      // máscaras emisivas
      cv.tex_terminal_e = emissiveMaskCanvas(S, 'screen', seedOf('tex_terminal_e'));
      cv.tex_strip_e = emissiveMaskCanvas(S, 'strip', seedOf('tex_strip_e'));

      // sprites
      cv.tex_particle = particleCanvas(64);
      cv.tex_tracer = tracerCanvas(32);

      Textures.materials = buildMaterialTable();
      return cv;
    },

    /** Sube todos los canvas a GPU y resuelve las referencias de los materiales. */
    uploadAll: function () {
      var gl = Textures._gl;
      var mgr = (gl && gl.gl) ? gl : BS.GL;
      var canUpload = !!(mgr && mgr.gl && typeof mgr.createTextureFromCanvas === 'function');
      var aniso = (mgr && mgr.caps && mgr.caps.anisoAvailable) ? Math.min(4, mgr.caps.maxAniso) : 0;
      var names = Object.keys(Textures.canvases);
      for (var i = 0; i < names.length; i++) {
        var n = names[i];
        if (!canUpload) break;
        var isSprite = (n === 'tex_particle' || n === 'tex_tracer');
        var tex = mgr.createTextureFromCanvas(Textures.canvases[n], {
          mipmaps: !isSprite,
          wrap: 'repeat',
          aniso: aniso
        });
        if (tex) Textures.lib[n] = tex;
      }
      // resuelve map/normalMap/emissiveMap de los materiales a objetos WebGLTexture.
      // La PRIMERA pasada guarda los NOMBRES lógicos; rebuild() los reutiliza porque
      // en ese momento `m.map` ya es un WebGLTexture (y `lib[objeto]` sería undefined).
      var ids = Object.keys(Textures.materials);
      for (var k = 0; k < ids.length; k++) {
        var m = Textures.materials[ids[k]];
        if (typeof m.map === 'string') m._mapName = m.map;
        if (typeof m.normalMap === 'string') m._normalName = m.normalMap;
        if (typeof m.emissiveMap === 'string') m._emissiveName = m.emissiveMap;
        m.map = m._mapName ? (Textures.lib[m._mapName] || null) : null;
        m.normalMap = m._normalName ? (Textures.lib[m._normalName] || null) : null;
        m.emissiveMap = m._emissiveName ? (Textures.lib[m._emissiveName] || null) : null;
      }
      // el material de reserva se re-resuelve igual (queda con WebGLTexture o null limpio)
      if (Textures._fallback) {
        var fb = Textures._fallback;
        if (typeof fb.map === 'string') fb._mapName = fb.map;
        fb.map = fb._mapName ? (Textures.lib[fb._mapName] || null) : null;
      }
      return Textures.lib;
    },

    get: function (name) {
      return Textures.lib[name] || null;
    },

    getCanvas: function (name) {
      return Textures.canvases[name] || null;
    },

    getMaterial: function (id) {
      var m = Textures.materials[id];
      if (m) return m;
      // fallback: material genérico (nunca lanza)
      if (!Textures._fallback) {
        Textures._fallback = mat('mat_fallback', 'tex_gen', {
          uv: [1, 1], specular: 0.1, emissiveColor: [1, 0, 1]
        });
        // `map` debe acabar en un WebGLTexture real o en null, NUNCA en el string
        // del nombre (bindTexture(target, '_none') sería un error de WebGL).
        Textures._fallback._mapName = 'tex_gen';
        Textures._fallback.map = Textures.lib.tex_gen || null;
      }
      BS.Log.debug('BS.Textures.getMaterial: id desconocido "' + id + '"');
      return Textures._fallback;
    },

    hasMaterial: function (id) {
      return !!Textures.materials[id];
    },

    listMaterials: function () {
      return MATERIAL_IDS.slice();
    },

    stats: function () {
      return {
        canvases: Object.keys(Textures.canvases).length,
        uploaded: Object.keys(Textures.lib).length,
        materials: Object.keys(Textures.materials).length,
        size: Textures.textureSize,
        buildMs: Math.round(Textures.buildMs),
        phases: Textures.buildPhases
      };
    },

    dispose: function () {
      var mgr = Textures._gl || BS.GL;
      if (mgr && typeof mgr.disposeTexture === 'function') {
        for (var k in Textures.lib) {
          if (Object.prototype.hasOwnProperty.call(Textures.lib, k)) {
            try { mgr.disposeTexture(Textures.lib[k]); } catch (e) { /* noop */ }
          }
        }
      }
      Textures.lib = {};
    },

    /* generadores de bajo nivel (§3.6) */
    valueNoiseCanvas: valueNoiseCanvas,
    fbmCanvas: fbmCanvas,
    normalFromHeight: normalFromHeight,
    grungeOverlay: grungeOverlay,
    emissiveMaskCanvas: emissiveMaskCanvas,
    MATERIAL_IDS: MATERIAL_IDS,
    TEX_NAMES: TEX_NAMES
  };

  BS.Textures = Textures;

  /* ======================================================================
   * Test: determinismo + catálogo completo
   * ==================================================================== */
  if (BS.Debug && typeof BS.Debug.register === 'function') {
    BS.Debug.register('textures:determinism', function () {
      // Si el módulo no se ha inicializado (tester llamando runAll sin juego),
      // se genera el catálogo para que el test siga siendo significativo.
      if (Object.keys(Textures.materials).length === 0) Textures.generateAll();
      // Dos generaciones con la misma semilla deben producir píxeles idénticos.
      var a = fbmCanvas(32, 4, 3, 0.5, 0xB1AC);
      var b = fbmCanvas(32, 4, 3, 0.5, 0xB1AC);
      var ca = ctx2d(a).getImageData(0, 0, 32, 32).data;
      var cb = ctx2d(b).getImageData(0, 0, 32, 32).data;
      var same = true;
      var hashA = 0, hashB = 0;
      for (var i = 0; i < ca.length; i += 4) {
        hashA = (hashA * 31 + ca[i]) >>> 0;
        hashB = (hashB * 31 + cb[i]) >>> 0;
        if (ca[i] !== cb[i]) { same = false; break; }
      }
      // El ruido no debe ser constante (si lo fuera, sería un fallo de generación)
      var minV = 255, maxV = 0;
      for (var k = 0; k < ca.length; k += 4) {
        if (ca[k] < minV) minV = ca[k];
        if (ca[k] > maxV) maxV = ca[k];
      }

      var missing = [];
      for (var m = 0; m < MATERIAL_IDS.length; m++) {
        if (!Textures.materials[MATERIAL_IDS[m]]) missing.push(MATERIAL_IDS[m]);
      }
      var badShape = [];
      var ids = Object.keys(Textures.materials);
      for (var s = 0; s < ids.length; s++) {
        var mat2 = Textures.materials[ids[s]];
        if (typeof mat2.uvScale === 'undefined' || typeof mat2.specular !== 'number' ||
          typeof mat2.blend !== 'string' || typeof mat2.program !== 'string') {
          badShape.push(ids[s]);
        }
      }
      // Nota: `material.map` es la textura WebGL; si no hay contexto, map es null
      // y `_mapName` guarda el nombre lógico (permite verificar sin GPU).
      return {
        ok: same && (maxV - minV) > 40 && missing.length === 0 && badShape.length === 0,
        determinista: same,
        hashA: hashA, hashB: hashB,
        rangoRuido: [minV, maxV],
        materiales: Object.keys(Textures.materials).length,
        faltan: missing,
        formaInvalida: badShape,
        canvasGenerados: Object.keys(Textures.canvases).length,
        subidos: Object.keys(Textures.lib).length,
        tamano: Textures.textureSize
      };
    });
  }

})(window.BS = window.BS || {});
