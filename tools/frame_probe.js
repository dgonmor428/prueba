/*
 * BLACKSITE: LAST SIGNAL — herramienta de verificación de fotograma.
 *
 * NO forma parte del juego. Solo lo inyecta el agente `tester` (o el
 * orquestador) en la página de pruebas para poder comprobar, sin capturas de
 * pantalla, que el render produce una imagen real y coherente.
 *
 * Se apoya en `preserveDrawingBuffer: true`, que el motor activa a propósito.
 *
 * Uso típico desde `browser.evaluate`:
 *   PROBE.init(48, 24);            // elige el canvas 3D y prepara la rejilla
 *   PROBE.stats()                  // {nonBlack, meanLum, stdLum, distinct, ...}
 *   PROBE.ascii()                  // miniatura ASCII legible en texto
 *   PROBE.coneCheck()              // luminancia centro vs bordes (linterna)
 *   PROBE.strip()                  // una línea: resumen numérico
 */
window.PROBE = (function () {
  'use strict';

  var _canvas = null;   // canvas 3D del juego
  var _small = null;    // canvas 2D reducido para muestrear
  var _sctx = null;
  var _cols = 48;
  var _rows = 24;
  var _lum = null;      // Float32Array(_cols*_rows), luminancia 0..1
  var _lastErr = null;

  /**
   * Elige el canvas 3D (WebGL) y no el de HUD (2D).
   *
   * Discriminador fiable: un canvas solo puede tener UN tipo de contexto. Si
   * `getContext('2d')` devuelve un objeto es porque es el canvas 2D del HUD; si
   * devuelve `null` es porque ya tiene un contexto WebGL. Se elige el de mayor
   * área entre los candidatos WebGL.
   */
  function pickCanvas() {
    var list = document.getElementsByTagName('canvas');
    var best = null, bestArea = -1, fallback = null, fbArea = -1;
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      var area = (c.width || 0) * (c.height || 0);
      if (area > fbArea) { fbArea = area; fallback = c; }
      var ctx2d = null;
      try { ctx2d = c.getContext('2d'); } catch (e) { ctx2d = 'throw'; }
      if (ctx2d === null && area > bestArea) { bestArea = area; best = c; }
    }
    return best || fallback;
  }

  function init(cols, rows) {
    _cols = cols || 48;
    _rows = rows || 24;
    _lastErr = null;
    try {
      _canvas = pickCanvas();
      if (!_canvas) { _lastErr = 'no hay <canvas> en el documento'; return false; }
      _small = document.createElement('canvas');
      _small.width = _cols;
      _small.height = _rows;
      _sctx = _small.getContext('2d', { willReadFrequently: true });
      if (!_sctx) { _lastErr = 'no se pudo crear el contexto 2D'; return false; }
      _sctx.imageSmoothingEnabled = true;
      _lum = new Float32Array(_cols * _rows);
      return true;
    } catch (e) {
      _lastErr = String(e);
      return false;
    }
  }

  /** Copia el canvas 3D a la rejilla reducida y calcula la luminancia. */
  function sample() {
    if (!_sctx || !_canvas) init(_cols, _rows);
    if (!_sctx || !_canvas) return false;
    try {
      _sctx.clearRect(0, 0, _cols, _rows);
      _sctx.drawImage(_canvas, 0, 0, _canvas.width, _canvas.height, 0, 0, _cols, _rows);
      var d = _sctx.getImageData(0, 0, _cols, _rows).data;
      for (var i = 0, p = 0; i < _lum.length; i++, p += 4) {
        _lum[i] = (0.2126 * d[p] + 0.7152 * d[p + 1] + 0.0722 * d[p + 2]) / 255;
      }
      return true;
    } catch (e) {
      _lastErr = String(e);
      return false;
    }
  }

  function stats() {
    if (!sample()) return { ok: false, error: _lastErr };
    var n = _lum.length;
    var sum = 0, sum2 = 0, nonBlack = 0, bright = 0;
    var min = 1, max = 0;
    var buckets = new Array(16);
    for (var b = 0; b < 16; b++) buckets[b] = 0;
    for (var i = 0; i < n; i++) {
      var v = _lum[i];
      sum += v; sum2 += v * v;
      if (v > 0.02) nonBlack++;
      if (v > 0.35) bright++;
      if (v < min) min = v;
      if (v > max) max = v;
      buckets[Math.min(15, (v * 16) | 0)]++;
    }
    var mean = sum / n;
    var variance = Math.max(0, sum2 / n - mean * mean);
    var distinct = 0;
    for (var k = 0; k < 16; k++) if (buckets[k] > 0) distinct++;
    return {
      ok: true,
      canvas: _canvas ? (_canvas.width + 'x' + _canvas.height) : 'none',
      pixels: n,
      meanLum: +mean.toFixed(4),
      stdLum: +Math.sqrt(variance).toFixed(4),
      minLum: +min.toFixed(4),
      maxLum: +max.toFixed(4),
      nonBlackPct: +((100 * nonBlack) / n).toFixed(1),
      brightPct: +((100 * bright) / n).toFixed(1),
      distinctTones: distinct,
      histogram: buckets
    };
  }

  /** Miniatura ASCII legible en texto: " .:-=+*#%@" */
  function ascii() {
    if (!_lum) return '(sin datos: llama antes a PROBE.init)';
    if (_lastErr && !_sctx) return '(error: ' + _lastErr + ')';
    var ramp = ' .:-=+*#%@';
    var out = '';
    for (var y = 0; y < _rows; y++) {
      var line = '';
      for (var x = 0; x < _cols; x++) {
        var v = _lum[y * _cols + x];
        var idx = Math.max(0, Math.min(ramp.length - 1, Math.round(v * (ramp.length - 1) * 1.15)));
        line += ramp.charAt(idx);
      }
      out += line + '\n';
    }
    return out;
  }

  /** Luminancia media en una región normalizada [0..1]x[0..1]. */
  function regionMean(u0, v0, u1, v1) {
    if (!_lum) sample();
    var x0 = Math.max(0, Math.floor(u0 * _cols)), x1 = Math.min(_cols, Math.ceil(u1 * _cols));
    var y0 = Math.max(0, Math.floor(v0 * _rows)), y1 = Math.min(_rows, Math.ceil(v1 * _rows));
    var s = 0, n = 0;
    for (var y = y0; y < y1; y++) for (var x = x0; x < x1; x++) { s += _lum[y * _cols + x]; n++; }
    return n ? s / n : 0;
  }

  /**
   * Prueba específica de la LINTERNA: el centro de la pantalla (donde apunta la
   * mira) debe estar MÁS iluminado que los bordes si el cono está bien.
   * Devuelve `ok:true` si centro > bordes con margen suficiente.
   */
  function coneCheck() {
    if (!sample()) return { ok: false, error: _lastErr };
    var centre = regionMean(0.42, 0.42, 0.58, 0.58);
    var topEdge = regionMean(0.00, 0.00, 1.00, 0.12);
    var bottomEdge = regionMean(0.00, 0.88, 1.00, 1.00);
    var leftEdge = regionMean(0.00, 0.00, 0.12, 1.00);
    var rightEdge = regionMean(0.88, 0.00, 1.00, 1.00);
    var edges = (topEdge + bottomEdge + leftEdge + rightEdge) / 4;
    return {
      ok: centre > edges + 0.02,
      centre: +centre.toFixed(4),
      edges: +edges.toFixed(4),
      ratio: +(centre / Math.max(0.0001, edges)).toFixed(3),
      detail: { top: +topEdge.toFixed(4), bottom: +bottomEdge.toFixed(4), left: +leftEdge.toFixed(4), right: +rightEdge.toFixed(4) }
    };
  }

  /** Color exacto de un píxel del canvas 3D, en coordenadas normalizadas. */
  function pixel(u, v) {
    if (!_canvas) init();
    if (!_canvas) return null;
    var x = Math.max(0, Math.min(_canvas.width - 1, Math.round(u * _canvas.width)));
    var y = Math.max(0, Math.min(_canvas.height - 1, Math.round(v * _canvas.height)));
    var t = document.createElement('canvas');
    t.width = 1; t.height = 1;
    var c = t.getContext('2d', { willReadFrequently: true });
    c.drawImage(_canvas, x, y, 1, 1, 0, 0, 1, 1);
    var d = c.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2], d[3]];
  }

  function strip() {
    var s = stats();
    if (!s.ok) return 'PROBE error: ' + s.error;
    return s.canvas + ' mean=' + s.meanLum + ' std=' + s.stdLum +
      ' nonBlack=' + s.nonBlackPct + '% bright=' + s.brightPct + '% tones=' + s.distinctTones;
  }

  function lastError() { return _lastErr; }

  return {
    init: init, sample: sample, stats: stats, ascii: ascii,
    coneCheck: coneCheck, regionMean: regionMean, pixel: pixel,
    strip: strip, lastError: lastError,
    get cols() { return _cols; },
    get rows() { return _rows; },
    get canvas() { return _canvas; }
  };
})();
