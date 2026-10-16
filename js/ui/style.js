/* ===========================================================================
 * BLACKSITE: LAST SIGNAL  —  js/ui/style.js
 * ---------------------------------------------------------------------------
 * Propósito : TODO el CSS del juego, como una única cadena, inyectada en
 *             <head> dentro de <style id="bs-style">. Estética de la ficción:
 *             monoespaciada, cian/ámbar sobre negro, scanlines sutiles, bordes
 *             con esquinas marcadas, sin fuentes externas (pila del sistema) y
 *             sin `user-select`. No hay ninguna hoja de estilos en el HTML: el
 *             juego se ve igual en `file://` y en una inyección inline.
 * Depende de: js/core/util.js (BS.Log)
 * Expone    : BS.Style
 * =========================================================================== */
(function (BS) {
  'use strict';

  /* ----------------------------------------------------------------------
   * Nombres de clase (contrato §3.18). Se exponen en BS.Style.CLASS para que
   * menu.js/hud.js no escriban literales de cadena sueltos.
   * -------------------------------------------------------------------- */
  var CLASS = {
    root: 'bs-root',
    canvas: 'bs-canvas',
    hud: 'bs-hud',
    ui: 'bs-ui',
    overlay: 'bs-overlay',
    screen: 'bs-screen',
    on: 'bs-on',
    panel: 'bs-panel',
    panelWide: 'bs-panel-wide',
    btn: 'bs-btn',
    btnPrimary: 'bs-btn-primary',
    btnDanger: 'bs-btn-danger',
    btnSmall: 'bs-btn-small',
    btnActive: 'bs-btn-active',
    slider: 'bs-slider',
    row: 'bs-row',
    label: 'bs-label',
    value: 'bs-value',
    hidden: 'bs-hidden',
    disabled: 'bs-disabled',
    title: 'bs-title',
    subtitle: 'bs-subtitle',
    sectionTitle: 'bs-section-title',
    list: 'bs-list',
    table: 'bs-table',
    kbd: 'bs-kbd',
    bar: 'bs-bar',
    barFill: 'bs-bar-fill',
    barAmber: 'bs-bar-amber',
    toast: 'bs-toast',
    error: 'bs-error',
    warning: 'bs-warning',
    small: 'bs-small',
    credits: 'bs-credits',
    twoCol: 'bs-two-col',
    footer: 'bs-footer',
    hint: 'bs-hint',
    danger: 'bs-danger',
    ok: 'bs-ok',
    amber: 'bs-amber',
    score: 'bs-score',
    loading: 'bs-loading',
    progress: 'bs-progress',
    progressFill: 'bs-progress-fill',
    progressLabel: 'bs-progress-label',
    statsGrid: 'bs-stats-grid',
    statRow: 'bs-stat-row',
    statValue: 'bs-stat-value',
    buttonCol: 'bs-btn-col',
    clickCatch: 'bs-click-catch',
    select: 'bs-select',
    scroll: 'bs-scroll',
    badge: 'bs-badge',
    keyHint: 'bs-key-hint',
    logo: 'bs-logo',
    gridBg: 'bs-grid-bg'
  };

  /* ----------------------------------------------------------------------
   * Hoja de estilos completa.
   * -------------------------------------------------------------------- */
  var C = [];
  function add(s) { C.push(s); }

  add('/* BLACKSITE: LAST SIGNAL — hoja de estilos generada por JS.Style */');
  add(':root{');
  add('  --bs-cyan:#7fe7ff;');
  add('  --bs-cyan-dim:#3d8fa6;');
  add('  --bs-cyan-deep:#0d2a35;');
  add('  --bs-amber:#ffb347;');
  add('  --bs-amber-dim:#a8712b;');
  add('  --bs-red:#ff5b5b;');
  add('  --bs-red-dim:#7d2626;');
  add('  --bs-green:#79ffa8;');
  add('  --bs-bg:#05070a;');
  add('  --bs-ink:#0a1a22;');
  add('  --bs-text:#9fe9ff;');
  add('  --bs-text-dim:#6f9aa8;');
  add('  --bs-panel-bg:rgba(6,14,19,.94);');
  add('  --bs-mono:Consolas,"DejaVu Sans Mono","Liberation Mono","Courier New",ui-monospace,monospace;');
  add('}');

  /* ------------------------------- raíz ------------------------------- */
  add('html,body{margin:0;padding:0;height:100%;background:var(--bs-bg);overflow:hidden}');
  add('#' + CLASS.root + '{position:fixed;inset:0;overflow:hidden;background:#020406;');
  add('  font-family:var(--bs-mono);font-size:13px;line-height:1.4;color:var(--bs-text);');
  add('  cursor:default;-webkit-user-select:none;-moz-user-select:none;-ms-user-select:none;user-select:none;');
  add('  -webkit-tap-highlight-color:transparent;');
  add('}');
  add('#' + CLASS.root + ' *{box-sizing:border-box;font-family:inherit}');

  /* Scanlines sutiles + viñeta estática por encima de TODO (nunca capturan clics). */
  add('#' + CLASS.root + '::after{content:"";position:absolute;left:0;top:0;right:0;bottom:0;');
  add('  pointer-events:none;z-index:90;opacity:.35;');
  add('  background:repeating-linear-gradient(to bottom,rgba(200,240,255,.05) 0 1px,rgba(0,0,0,0) 1px 3px);');
  add('}');
  add('#' + CLASS.root + '::before{content:"";position:absolute;left:0;top:0;right:0;bottom:0;');
  add('  pointer-events:none;z-index:89;');
  add('  background:radial-gradient(ellipse at center,rgba(0,0,0,0) 45%,rgba(0,0,0,.55) 100%);');
  add('}');

  add('#' + CLASS.canvas + '{position:absolute;left:0;top:0;width:100%;height:100%;display:block;touch-action:none;outline:none}');
  add('#' + CLASS.hud + '{position:absolute;left:0;top:0;width:100%;height:100%;display:block;pointer-events:none;z-index:10}');
  add('#' + CLASS.ui + '{position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:20}');
  add('#' + CLASS.ui + ' .' + CLASS.overlay + '{pointer-events:auto}');

  /* ------------------------------ pantallas ------------------------------ */
  add('.' + CLASS.screen + '{position:absolute;left:0;top:0;right:0;bottom:0;display:none;');
  add('  flex-direction:column;align-items:center;justify-content:center;z-index:40;');
  add('  pointer-events:auto;padding:18px;overflow:auto;');
  add('  background:radial-gradient(ellipse at 50% 40%,rgba(8,22,30,.88),rgba(2,4,6,.97) 70%);');
  add('}');
  add('.' + CLASS.screen + '.' + CLASS.on + '{display:flex}');
  add('.' + CLASS.screen + '.' + CLASS.hidden + '{display:none}');

  /* -------------------------------- paneles ------------------------------ */
  add('.' + CLASS.panel + '{position:relative;background:var(--bs-panel-bg);');
  add('  border:1px solid rgba(127,231,255,.38);padding:24px 28px;width:min(620px,94vw);');
  add('  max-height:88vh;overflow:auto;box-shadow:inset 0 0 0 1px rgba(0,0,0,.6),0 14px 50px rgba(0,0,0,.65);');
  add('}');
  add('.' + CLASS.panelWide + '{width:min(860px,96vw)}');
  add('.' + CLASS.panel + '::before{content:"";position:absolute;left:-1px;top:-1px;width:16px;height:16px;');
  add('  border-top:2px solid var(--bs-amber);border-left:2px solid var(--bs-amber);pointer-events:none}');
  add('.' + CLASS.panel + '::after{content:"";position:absolute;right:-1px;bottom:-1px;width:16px;height:16px;');
  add('  border-bottom:2px solid var(--bs-amber);border-right:2px solid var(--bs-amber);pointer-events:none}');
  add('.' + CLASS.scroll + '{overflow:auto}');

  /* -------------------------------- textos ------------------------------- */
  add('.' + CLASS.title + '{margin:0 0 4px;font-size:clamp(22px,3.2vw,38px);letter-spacing:.22em;');
  add('  text-align:center;color:#e8fbff;text-shadow:0 0 14px rgba(127,231,255,.55),0 0 3px rgba(127,231,255,.9);');
  add('  text-transform:uppercase;font-weight:700}');
  add('.' + CLASS.logo + '{font-size:clamp(18px,2.4vw,26px);letter-spacing:.34em;color:var(--bs-amber);');
  add('  text-align:center;text-shadow:0 0 10px rgba(255,179,71,.5);text-transform:uppercase;margin:0}');
  add('.' + CLASS.subtitle + '{margin:0 0 22px;font-size:11px;letter-spacing:.3em;text-align:center;');
  add('  color:var(--bs-text-dim);text-transform:uppercase}');
  add('.' + CLASS.sectionTitle + '{margin:18px 0 8px;font-size:11px;letter-spacing:.24em;');
  add('  color:var(--bs-amber);text-transform:uppercase;border-bottom:1px dashed rgba(255,179,71,.3);padding-bottom:4px}');
  add('.' + CLASS.small + '{font-size:11px;color:var(--bs-text-dim)}');
  add('.' + CLASS.hint + '{margin-top:16px;font-size:11px;letter-spacing:.12em;color:var(--bs-text-dim);text-align:center}');
  add('.' + CLASS.footer + '{margin-top:18px;font-size:10px;letter-spacing:.2em;color:#4d6b76;text-align:center}');
  add('.' + CLASS.danger + '{color:var(--bs-red)}');
  add('.' + CLASS.ok + '{color:var(--bs-green)}');
  add('.' + CLASS.amber + '{color:var(--bs-amber)}');
  add('.' + CLASS.score + '{color:var(--bs-amber);font-variant-numeric:tabular-nums}');
  add('.' + CLASS.hidden + '{display:none !important}');

  /* -------------------------------- botones ------------------------------ */
  add('.' + CLASS.btn + '{display:block;width:100%;margin:7px 0;padding:10px 16px;cursor:pointer;');
  add('  font-family:inherit;font-size:13px;letter-spacing:.18em;text-transform:uppercase;text-align:center;');
  add('  color:var(--bs-ink);background:linear-gradient(180deg,#8feaff,#3fb6d6);border:1px solid #a9f0ff;');
  add('  transition:background .12s linear,box-shadow .12s linear,color .12s linear}');
  add('.' + CLASS.btn + ':hover{background:linear-gradient(180deg,#c8f7ff,#66d8f2);');
  add('  box-shadow:0 0 0 1px rgba(214,247,255,.6),0 0 16px rgba(127,231,255,.35)}');
  add('.' + CLASS.btn + ':active{transform:translateY(1px)}');
  add('.' + CLASS.btn + ':focus{outline:1px dotted var(--bs-amber);outline-offset:2px}');
  add('.' + CLASS.btn + '.' + CLASS.btnPrimary + '{background:linear-gradient(180deg,#ffd79a,#e0a03c);border-color:#ffe1b4;color:#1d1206}');
  add('.' + CLASS.btn + '.' + CLASS.btnPrimary + ':hover{background:linear-gradient(180deg,#ffe9c2,#f0b455)}');
  add('.' + CLASS.btn + '.' + CLASS.btnDanger + '{background:linear-gradient(180deg,#ff9a9a,#c93b3b);border-color:#ffb8b8;color:#1c0505}');
  add('.' + CLASS.btn + '.' + CLASS.btnDanger + ':hover{background:linear-gradient(180deg,#ffbdbd,#dc4f4f)}');
  add('.' + CLASS.btn + '.' + CLASS.btnActive + '{background:linear-gradient(180deg,#2c6f83,#16404e);color:#d8f8ff;border-color:var(--bs-cyan)}');
  add('.' + CLASS.btnSmall + '{width:auto;padding:4px 10px;margin:0;font-size:11px;letter-spacing:.1em}');
  add('.' + CLASS.btn + '.' + CLASS.disabled + ',.' + CLASS.btn + '[disabled]{background:#122029;color:#4f6d78;');
  add('  border-color:#26454f;cursor:not-allowed;box-shadow:none;transform:none}');
  add('.' + CLASS.buttonCol + '{display:flex;flex-direction:column;align-items:stretch;gap:0;margin-top:8px}');

  /* --------------------------------- filas ------------------------------- */
  add('.' + CLASS.row + '{display:flex;align-items:center;gap:12px;padding:6px 0;border-bottom:1px solid rgba(127,231,255,.07)}');
  add('.' + CLASS.label + '{flex:1 1 auto;font-size:12px;letter-spacing:.06em;color:#c6ecf8}');
  add('.' + CLASS.value + '{flex:0 0 86px;text-align:right;font-size:12px;color:var(--bs-amber);font-variant-numeric:tabular-nums}');
  add('.' + CLASS.twoCol + '{display:grid;grid-template-columns:1fr 1fr;gap:0 22px}');
  add('@media (max-width:620px){.' + CLASS.twoCol + '{grid-template-columns:1fr}}');

  /* -------------------------------- controles ---------------------------- */
  add('.' + CLASS.slider + '{-webkit-appearance:none;appearance:none;flex:0 0 190px;height:14px;background:transparent;cursor:pointer;outline:none}');
  add('.' + CLASS.slider + '::-webkit-slider-runnable-track{height:5px;background:linear-gradient(90deg,var(--bs-cyan),#123642);border:1px solid #35616e}');
  add('.' + CLASS.slider + '::-webkit-slider-thumb{-webkit-appearance:none;width:10px;height:16px;margin-top:-6px;background:var(--bs-amber);border:1px solid #ffe1b4}');
  add('.' + CLASS.slider + '::-moz-range-track{height:5px;background:linear-gradient(90deg,var(--bs-cyan),#123642);border:1px solid #35616e}');
  add('.' + CLASS.slider + '::-moz-range-thumb{width:10px;height:16px;background:var(--bs-amber);border:1px solid #ffe1b4;border-radius:0}');
  add('.' + CLASS.slider + ':focus{outline:1px dotted var(--bs-amber);outline-offset:3px}');
  add('.' + CLASS.select + '{font-family:inherit;font-size:12px;color:var(--bs-text);background:#081820;');
  add('  border:1px solid #35616e;padding:4px 8px;cursor:pointer;min-width:110px}');
  add('.' + CLASS.select + ':focus{outline:1px dotted var(--bs-amber)}');

  /* barra de progreso (carga y barras genéricas) */
  add('.' + CLASS.bar + '{position:relative;flex:0 0 150px;height:8px;background:#08181f;border:1px solid #35616e;overflow:hidden}');
  add('.' + CLASS.barFill + '{position:absolute;left:0;top:0;bottom:0;width:0%;');
  add('  background:linear-gradient(90deg,#1e7891,#8feaff);transition:width .12s linear}');
  add('.' + CLASS.barAmber + ' .' + CLASS.barFill + '{background:linear-gradient(90deg,#8a5a1c,#ffd79a)}');

  add('.' + CLASS.progress + '{position:relative;width:min(420px,80vw);height:12px;background:#07141a;border:1px solid #35616e;overflow:hidden}');
  add('.' + CLASS.progress + '::after{content:"";position:absolute;inset:0;pointer-events:none;');
  add('  background:repeating-linear-gradient(90deg,rgba(255,255,255,.06) 0 2px,rgba(0,0,0,0) 2px 7px)}');
  add('.' + CLASS.progressFill + '{position:absolute;left:0;top:0;bottom:0;width:0%;');
  add('  background:linear-gradient(90deg,#2a7f99,#a9f0ff);transition:width .16s linear}');
  add('.' + CLASS.progressLabel + '{margin-top:9px;font-size:11px;letter-spacing:.2em;color:var(--bs-text-dim);text-align:center}');
  add('.' + CLASS.loading + '{display:flex;flex-direction:column;align-items:center;gap:6px}');

  /* -------------------------------- tablas ------------------------------- */
  add('.' + CLASS.table + '{width:100%;border-collapse:collapse;font-size:12px}');
  add('.' + CLASS.table + ' td{padding:4px 8px;border-bottom:1px dashed rgba(127,231,255,.14);vertical-align:middle}');
  add('.' + CLASS.table + ' td:first-child{color:#c6ecf8}');
  add('.' + CLASS.table + ' td:last-child{text-align:right;color:var(--bs-amber);white-space:nowrap}');
  add('.' + CLASS.kbd + '{display:inline-block;min-width:24px;padding:1px 7px;margin:0 2px;text-align:center;');
  add('  border:1px solid #4d7f8f;background:#0b1b22;color:#ddf8ff;font-size:11px;letter-spacing:.08em}');
  add('.' + CLASS.keyHint + '{color:var(--bs-cyan);font-size:12px;letter-spacing:.1em}');
  add('.' + CLASS.badge + '{display:inline-block;padding:1px 7px;margin-left:6px;font-size:10px;letter-spacing:.1em;');
  add('  border:1px solid var(--bs-amber);color:var(--bs-amber);text-transform:uppercase}');

  /* ------------------------------ estadísticas --------------------------- */
  add('.' + CLASS.statsGrid + '{display:grid;grid-template-columns:1fr auto;gap:5px 22px;margin:12px 0 6px;font-size:13px}');
  add('.' + CLASS.statRow + '{color:#c6ecf8;letter-spacing:.1em}');
  add('.' + CLASS.statValue + '{text-align:right;color:var(--bs-amber);font-variant-numeric:tabular-nums}');

  /* -------------------------------- créditos ---------------------------- */
  add('.' + CLASS.credits + '{font-size:12px;line-height:1.75;color:#a9d8e6;text-align:center}');
  add('.' + CLASS.credits + ' b{color:var(--bs-amber);letter-spacing:.1em}');
  add('.' + CLASS.credits + ' i{color:var(--bs-cyan);font-style:normal}');

  /* -------------------------------- avisos ------------------------------ */
  add('.' + CLASS.toast + '{position:absolute;left:50%;bottom:78px;transform:translateX(-50%);');
  add('  padding:9px 16px;max-width:80vw;text-align:center;font-size:13px;letter-spacing:.1em;');
  add('  background:rgba(4,10,14,.9);border-left:3px solid var(--bs-amber);color:#ffe9c2;');
  add('  z-index:70;pointer-events:none;opacity:0;transition:opacity .18s linear}');
  add('.' + CLASS.toast + '.' + CLASS.on + '{opacity:1}');
  add('.' + CLASS.warning + '{border-left-color:var(--bs-red);color:#ffd6d6}');

  add('.' + CLASS.error + '{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);');
  add('  z-index:80;width:min(680px,92vw);padding:22px 26px;background:rgba(14,4,6,.96);');
  add('  border:1px solid var(--bs-red);color:#ffdada;pointer-events:auto;white-space:pre-wrap;');
  add('  font-size:12px;line-height:1.6}');
  add('.' + CLASS.error + ' h2{margin:0 0 10px;font-size:14px;letter-spacing:.2em;color:var(--bs-red);text-transform:uppercase}');
  add('.' + CLASS.error + ' code{color:var(--bs-amber);font-size:11px}');

  /* --------------------- captura de clic para el Pointer Lock ------------ */
  add('.' + CLASS.clickCatch + '{position:absolute;left:0;top:0;right:0;bottom:0;z-index:30;display:none;');
  add('  flex-direction:column;align-items:center;justify-content:center;gap:10px;cursor:pointer;pointer-events:auto;');
  add('  background:rgba(2,5,8,.5);color:#d9f6ff;letter-spacing:.22em;font-size:14px;text-align:center}');
  add('.' + CLASS.clickCatch + '.' + CLASS.on + '{display:flex}');
  add('.' + CLASS.clickCatch + ' .' + CLASS.small + '{letter-spacing:.1em}');

  var CSS = C.join('\n');

  /* ----------------------------------------------------------------------
   * API pública
   * -------------------------------------------------------------------- */
  var Style = {
    css: CSS,
    CLASS: CLASS,
    STYLE_ID: 'bs-style',

    /** Inyecta (o actualiza) el <style id="bs-style"> en <head>. Idempotente. */
    inject: function () {
      try {
        var doc = document;
        var el = doc.getElementById(Style.STYLE_ID);
        if (!el) {
          el = doc.createElement('style');
          el.id = Style.STYLE_ID;
          el.type = 'text/css';
          var head = doc.head || doc.getElementsByTagName('head')[0] || doc.documentElement;
          if (head && head.appendChild) head.appendChild(el);
        }
        if (el.textContent !== CSS) el.textContent = CSS;
        return el;
      } catch (e) {
        if (BS.Log) BS.Log.error('BS.Style.inject:', e && e.message ? e.message : e);
        return null;
      }
    },

    /** Quita la hoja (solo para pruebas de reconstrucción). */
    remove: function () {
      try {
        var el = document.getElementById(Style.STYLE_ID);
        if (el && el.parentNode) el.parentNode.removeChild(el);
      } catch (e) { /* noop */ }
    },

    isInjected: function () {
      try { return !!document.getElementById(Style.STYLE_ID); } catch (e) { return false; }
    },

    /** Devuelve una cadena "a b c" con las clases pedidas (ignora vacías). */
    classes: function () {
      var out = [];
      for (var i = 0; i < arguments.length; i++) {
        var a = arguments[i];
        if (!a) continue;
        if (Array.isArray(a)) {
          for (var k = 0; k < a.length; k++) if (a[k]) out.push(a[k]);
        } else out.push(a);
      }
      return out.join(' ');
    },

    /** Añade las clases base que necesitan los elementos creados por menu.js. */
    applyBase: function (el, role) {
      if (!el) return el;
      if (role === 'screen') el.className = CLASS.screen;
      else if (role === 'panel') el.className = CLASS.panel;
      else if (role === 'btn') el.className = CLASS.btn;
      return el;
    }
  };

  BS.Style = Style;

  /* ======================================================================
   * Test: la hoja se inyecta y contiene las reglas clave
   * ==================================================================== */
  if (BS.Debug && typeof BS.Debug.register === 'function') {
    BS.Debug.register('style:inject', function () {
      var el = Style.inject();
      var needed = ['bs-screen', 'bs-panel', 'bs-btn', 'bs-slider', 'bs-progress',
        'bs-error', 'bs-toast', 'bs-click-catch', 'bs-kbd', 'bs-stats-grid',
        'user-select:none'];
      var missing = [];
      for (var i = 0; i < needed.length; i++) {
        if (CSS.indexOf(needed[i]) < 0) missing.push(needed[i]);
      }
      var inHead = false;
      try {
        inHead = !!(el && el.parentNode && (el.parentNode === document.head ||
          el.parentNode.nodeName === 'HEAD'));
      } catch (e) { inHead = false; }
      var cls = Style.CLASS;
      var clsOk = !!(cls.panel && cls.btn && cls.slider && cls.row && cls.hidden && cls.root);
      return {
        ok: !!el && !!CSS && CSS.length > 2000 && missing.length === 0 && inHead && clsOk,
        bytes: CSS.length,
        inyectadoEnHead: inHead,
        faltan: missing,
        tieneCLASS: clsOk
      };
    });
  }

})(window.BS = window.BS || {});
