/* ===========================================================================
 * BLACKSITE: LAST SIGNAL  —  js/ui/menu.js
 * ---------------------------------------------------------------------------
 * Propósito : toda la interfaz de menús en DOM (§3.20): principal, ajustes,
 *             controles, créditos, tutorial, pausa, muerte y victoria, más la
 *             pantalla de carga con barra de progreso, los avisos (toasts) y
 *             el overlay de captura de clic para el Pointer Lock.
 *             TODO el DOM se crea desde JS dentro de #bs-ui; no hay HTML suelto.
 * Reglas    : §3.0 (IIFE, solo window.BS, sin class/let/const de archivo, sin
 *             dependencias). Persistencia con BS.Util.tryLocalStorageGet/Set.
 * Depende de: js/core/util.js (BS.Util, BS.Log), js/ui/style.js (BS.Style.CLASS)
 *             y, en tiempo de ejecución, ctx.* (con guardas).
 * Expone    : BS.Menu
 * =========================================================================== */
(function (BS) {
  'use strict';

  var C = (BS.Style && BS.Style.CLASS) || {};

  var SCREENS = ['loading', 'main', 'settings', 'controls', 'credits', 'tutorial',
    'pause', 'dead', 'victory'];

  /* Definición de los ajustes editables (§3.20). */
  var WIDGETS = [
    { section: 'CONTROL', key: 'sensitivity', type: 'range', label: 'SENSIBILIDAD DEL RATÓN', min: 0.0004, max: 0.006, step: 0.0001, fmt: function (v) { return (v * 1000).toFixed(2); } },
    { section: 'CONTROL', key: 'invertY', type: 'toggle', label: 'INVERTIR EJE VERTICAL' },
    { section: 'CONTROL', key: 'fov', type: 'range', label: 'CAMPO DE VISIÓN', min: 55, max: 110, step: 1, fmt: function (v) { return Math.round(v) + '°'; } },

    { section: 'AUDIO', key: 'volumeMaster', type: 'range', label: 'VOLUMEN GENERAL', min: 0, max: 1, step: 0.05, fmt: pct },
    { section: 'AUDIO', key: 'volumeSfx', type: 'range', label: 'EFECTOS', min: 0, max: 1, step: 0.05, fmt: pct },
    { section: 'AUDIO', key: 'volumeMusic', type: 'range', label: 'MÚSICA', min: 0, max: 1, step: 0.05, fmt: pct },

    { section: 'VÍDEO', key: 'quality', type: 'select', label: 'CALIDAD GRÁFICA', options: [['auto', 'AUTO'], ['low', 'BAJA'], ['medium', 'MEDIA'], ['high', 'ALTA']] },
    { section: 'VÍDEO', key: 'resolutionScale', type: 'range', label: 'ESCALA DE RESOLUCIÓN', min: 0.5, max: 1.0, step: 0.05, fmt: pct },
    { section: 'VÍDEO', key: 'postFx', type: 'toggle', label: 'POST-PROCESO (VIÑETA/GRANO)' },
    { section: 'VÍDEO', key: 'showFps', type: 'toggle', label: 'MOSTRAR FPS' },

    { section: 'JUGABILIDAD', key: 'crosshair', type: 'select', label: 'MIRA', options: [['dynamic', 'DINÁMICA'], ['fixed', 'FIJA']] },
    { section: 'JUGABILIDAD', key: 'bloodFx', type: 'toggle', label: 'EFECTOS DE SANGRE' },
    { section: 'JUGABILIDAD', key: 'screenShake', type: 'range', label: 'SACUDIDA DE CÁMARA', min: 0, max: 2, step: 0.1, fmt: function (v) { return Math.round(v * 100) + '%'; } },
    { section: 'JUGABILIDAD', key: 'difficulty', type: 'select', label: 'DIFICULTAD', options: [['normal', 'NORMAL'], ['hard', 'DIFÍCIL']] }
  ];

  function pct(v) { return Math.round((Number(v) || 0) * 100) + '%'; }

  /* ======================================================================
   * Estado interno
   * ==================================================================== */
  var S = {
    ctx: null,
    root: null,
    ui: null,
    built: false,
    current: null,
    cb: {},
    settings: null,
    screens: {},
    widgets: {},
    inputs: [],
    clickCatch: null,
    errorEl: null,
    toastEl: null,
    toastT: 0,
    editable: true,
    deathInfo: null,
    victoryInfo: null,
    progress: 0
  };

  /* ----------------------------------------------------------------------
   * Helpers de DOM
   * -------------------------------------------------------------------- */
  function el(tag, className, text) {
    var e = document.createElement(tag);
    if (className) e.className = className;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }

  function cls() {
    var out = [];
    for (var i = 0; i < arguments.length; i++) if (arguments[i]) out.push(arguments[i]);
    return out.join(' ');
  }

  function settingsRef() {
    if (S.ctx && S.ctx.settings) return S.ctx.settings;
    if (!S.settings) {
      S.settings = (BS.Util && BS.Util.loadSettings) ? BS.Util.loadSettings() : {};
    }
    return S.settings;
  }

  /* ----------------------------------------------------------------------
   * Botones
   * -------------------------------------------------------------------- */
  function mkButton(label, opts) {
    opts = opts || {};
    var b = el('button', cls(C.btn, opts.primary ? C.btnPrimary : null,
      opts.danger ? C.btnDanger : null, opts.small ? C.btnSmall : null), label);
    b.type = 'button';
    if (opts.onClick) {
      BS.Util.addListener(b, 'click', function (ev) {
        if (ev && ev.preventDefault) ev.preventDefault();
        if (!S.editable && !opts.alwaysEnabled) return;
        try { opts.onClick(); } catch (e) { BS.Log.error('BS.Menu botón:', e && e.message ? e.message : e); }
        if (BS.Audio && BS.Audio.play) BS.Audio.play('ui_click');
      });
    }
    S.inputs.push({ el: b, alwaysEnabled: !!opts.alwaysEnabled });
    return b;
  }

  function mkTitleScreen(screenId, title, subtitle) {
    var screen = S.screens[screenId];
    var panel = el('div', C.panel);
    if (title) panel.appendChild(el('h1', C.title, title));
    if (subtitle) panel.appendChild(el('p', C.subtitle, subtitle));
    screen.appendChild(panel);
    return panel;
  }

  /* ======================================================================
   * Construcción del DOM (§3.20 build)
   * ==================================================================== */
  function buildDOM() {
    var dom = BS.Util.ensureDOM();
    S.root = dom.root;
    S.ui = dom.uiLayer;
    // limpiar restos de una construcción previa (idempotencia)
    while (S.ui.firstChild) S.ui.removeChild(S.ui.firstChild);

    // --- overlay de captura de clic (Pointer Lock) ---
    S.clickCatch = el('div', cls(C.clickCatch));
    S.clickCatch.id = 'bs-click-catch';
    var ccTitle = el('div', null, 'CLIC PARA BLOQUEAR EL RATÓN');
    var ccHint = el('div', cls(C.small), 'El ratón debe quedar capturado para apuntar. Pulsa Escape para pausar.');
    S.clickCatch.appendChild(ccTitle);
    S.clickCatch.appendChild(ccHint);
    BS.Util.addListener(S.clickCatch, 'click', function () {
      /* NO ocultamos el overlay aquí: se retira en onLockChange cuando el
       * navegador CONFIRMA el Pointer Lock. Si la petición falla (cooldown
       * tras Escape, etc.) el overlay permanece y el usuario puede reintentar. */
      if (typeof S.cb.onRequestLock === 'function') {
        try { S.cb.onRequestLock(); } catch (e) { /* noop */ }
      } else if (BS.Input && BS.Input.requestPointerLock) {
        try { BS.Input.requestPointerLock(); } catch (e) { /* noop */ }
      }
    });
    /* Hardening: mientras el overlay está visible, el clic sirve SOLO para
     * capturar el ratón; no debe llegar a window (donde BS.Input registraría
     * el botón y el arma dispararía un tiro parásito). */
    BS.Util.addListener(S.clickCatch, 'mousedown', function (ev) { if (ev && ev.stopPropagation) ev.stopPropagation(); });
    BS.Util.addListener(S.clickCatch, 'mouseup', function (ev) { if (ev && ev.stopPropagation) ev.stopPropagation(); });
    BS.Util.addListener(S.clickCatch, 'wheel', function (ev) { if (ev && ev.stopPropagation) ev.stopPropagation(); });
    S.ui.appendChild(S.clickCatch);

    // --- pantallas ---
    for (var i = 0; i < SCREENS.length; i++) {
      var sc = el('div', cls(C.screen));
      sc.id = 'bs-screen-' + SCREENS[i];
      S.screens[SCREENS[i]] = sc;
      S.ui.appendChild(sc);
    }

    buildLoading();
    buildMain();
    buildSettings();
    buildControls();
    buildCredits();
    buildTutorial();
    buildPause();
    buildDead();
    buildVictory();

    // --- avisos (toast) y caja de error ---
    S.toastEl = el('div', cls(C.toast));
    S.toastEl.id = 'bs-toast';
    S.ui.appendChild(S.toastEl);

    S.errorEl = el('div', cls(C.error));
    S.errorEl.id = 'bs-error';
    S.errorEl.style.display = 'none';
    S.ui.appendChild(S.errorEl);

    S.built = true;
  }

  function buildLoading() {
    var sc = S.screens.loading;
    var wrap = el('div', cls(C.loading));
    wrap.appendChild(el('h1', C.logo, 'BLACKSITE: LAST SIGNAL'));
    wrap.appendChild(el('p', C.subtitle, 'SUBSISTEMA DE RESCATE — INSTALACIÓN K-7'));
    var bar = el('div', cls(C.progress));
    var fill = el('div', cls(C.progressFill));
    bar.appendChild(fill);
    wrap.appendChild(bar);
    var label = el('div', cls(C.progressLabel), 'INICIANDO…');
    wrap.appendChild(label);
    sc.appendChild(wrap);
    S.widgets.loadingFill = fill;
    S.widgets.loadingLabel = label;
  }

  function buildMain() {
    var panel = mkTitleScreen('main', 'BLACKSITE: LAST SIGNAL', 'SEÑAL PERDIDA — MISIÓN K-7');
    var col = el('div', C.buttonCol);
    col.appendChild(mkButton('JUGAR', { primary: true, onClick: function () { startGame(); } }));
    col.appendChild(mkButton('TUTORIAL', { onClick: function () { S.show('tutorial'); } }));
    col.appendChild(mkButton('AJUSTES', { onClick: function () { S.show('settings'); } }));
    col.appendChild(mkButton('CONTROLES', { onClick: function () { S.show('controls'); } }));
    col.appendChild(mkButton('CRÉDITOS', { onClick: function () { S.show('credits'); } }));
    panel.appendChild(col);
    var foot = el('div', C.footer, 'Prototipo sin dependencias externas · WebGL nativo · v1.0');
    panel.appendChild(foot);
  }

  function buildSettings() {
    var panel = mkTitleScreen('settings', 'AJUSTES', null);
    panel.classList.add(C.panelWide);
    var twoCol = el('div', C.twoCol);
    var cols = {};

    for (var i = 0; i < WIDGETS.length; i++) {
      var w = WIDGETS[i];
      if (!cols[w.section]) {
        var colBox = el('div');
        colBox.appendChild(el('div', C.sectionTitle, w.section));
        twoCol.appendChild(colBox);
        cols[w.section] = colBox;
      }
      cols[w.section].appendChild(mkWidgetRow(w));
    }
    panel.appendChild(twoCol);

    var col2 = el('div', C.buttonCol);
    col2.appendChild(mkButton('VOLVER', { primary: true, onClick: function () { S.show(returnScreen()); } }));
    col2.appendChild(mkButton('RESTABLECER AJUSTES', { danger: true, onClick: function () {
      var def = (BS.Util && BS.Util.settingsDefaults) ? BS.Util.settingsDefaults() : {};
      S.applySettings(def);
    } }));
    panel.appendChild(col2);
  }

  function mkWidgetRow(w) {
    var row = el('div', C.row);
    row.appendChild(el('div', C.label, w.label));
    var holder;

    if (w.type === 'range') {
      holder = el('input', C.slider);
      holder.type = 'range';
      holder.min = String(w.min);
      holder.max = String(w.max);
      holder.step = String(w.step);
      var val = el('div', C.value, '');
      row.appendChild(holder);
      row.appendChild(val);
      S.widgets[w.key] = { el: holder, val: val, def: w };
      BS.Util.addListener(holder, 'input', function () {
        onSettingChanged(w.key, Number(holder.value));
        val.textContent = w.fmt(Number(holder.value));
      });
      S.inputs.push({ el: holder });
    } else if (w.type === 'toggle') {
      holder = mkButton('', { small: true, alwaysEnabled: true, onClick: function () {
        var v = !settingsRef()[w.key];
        onSettingChanged(w.key, v);
        refreshWidget(w.key);
      } });
      holder.classList.add(C.btnSmall);
      row.appendChild(el('div', C.value, ''));
      row.appendChild(holder);
      S.widgets[w.key] = { el: holder, val: row.lastChild, def: w };
    } else if (w.type === 'select') {
      holder = el('select', C.select);
      for (var k = 0; k < w.options.length; k++) {
        var op = el('option', null, w.options[k][1]);
        op.value = w.options[k][0];
        holder.appendChild(op);
      }
      row.appendChild(holder);
      S.widgets[w.key] = { el: holder, def: w };
      BS.Util.addListener(holder, 'change', function () {
        onSettingChanged(w.key, holder.value);
      });
      S.inputs.push({ el: holder });
    }
    return row;
  }

  function buildControls() {
    var panel = mkTitleScreen('controls', 'CONTROLES', 'TECLADO Y RATÓN');
    var table = el('table', C.table);
    var rows = [
      ['MOVIMIENTO', 'W A S D'],
      ['CORRER', 'MAYÚS (SHIFT)'],
      ['AGACHARSE', 'CTRL'],
      ['SALTAR', 'ESPACIO'],
      ['DISPARAR', 'CLIC IZQUIERDO'],
      ['APUNTAR / RECARGAR', 'R'],
      ['CAMBIAR DE ARMA', '1 2 3  /  RUEDA'],
      ['INTERACTUAR', 'E'],
      ['MAPA / DEPURACIÓN', 'F1'],
      ['PAUSAR', 'ESCAPE (suelta el ratón)']
    ];
    for (var i = 0; i < rows.length; i++) {
      var tr = el('tr');
      tr.appendChild(el('td', null, rows[i][0]));
      var td = el('td');
      td.appendChild(el('span', C.kbd, rows[i][1]));
      tr.appendChild(td);
      table.appendChild(tr);
    }
    panel.appendChild(table);
    var col = el('div', C.buttonCol);
    col.appendChild(mkButton('VOLVER', { primary: true, onClick: function () { S.show(returnScreen()); } }));
    panel.appendChild(col);
  }

  function buildCredits() {
    var panel = mkTitleScreen('credits', 'CRÉDITOS', 'BLACKSITE: LAST SIGNAL');
    var box = el('div', C.credits);
    box.innerHTML = '' +
      '<p><b>MOTOR</b><br>WebGL nativo, sin dependencias externas.<br><i>Todo el arte es procedural.</i></p>' +
      '<p><b>DISEÑO DE MISIÓN</b><br>Instalación K-7 · 5 oleadas · 3 amenazas</p>' +
      '<p><b>EQUIPO</b><br>arnés de verificación y pruebas por lotes (A · B · C)</p>' +
      '<p><b>GRACIAS POR JUGAR</b></p>';
    panel.appendChild(box);
    var col = el('div', C.buttonCol);
    col.appendChild(mkButton('VOLVER', { primary: true, onClick: function () { S.show(returnScreen()); } }));
    panel.appendChild(col);
  }

  function buildTutorial() {
    var panel = mkTitleScreen('tutorial', 'ENTRENAMIENTO', 'PRIMEROS PASOS EN LA INSTALACIÓN');
    var box = el('div', C.credits);
    box.innerHTML = '' +
      '<p>1. Muévete con <i>W A S D</i> y mira con el ratón.</p>' +
      '<p>2. Mantén <i>MAYÚS</i> para correr y <i>CTRL</i> para agacharte.</p>' +
      '<p>3. Dispara con el <i>CLIC IZQUIERDO</i>; recarga con <i>R</i>.</p>' +
      '<p>4. Pulsa <i>E</i> en las consolas para completar objetivos.</p>' +
      '<p>5. Elimina a los anfitriones y alcanza la baliza de rescate.</p>';
    panel.appendChild(box);
    var col = el('div', C.buttonCol);
    col.appendChild(mkButton('COMENZAR', { primary: true, onClick: function () {
      S.hide();
      if (typeof S.cb.onStartTutorial === 'function') { try { S.cb.onStartTutorial(); } catch (e) { /* noop */ } }
      else if (typeof S.cb.onStart === 'function') { try { S.cb.onStart(); } catch (e) { /* noop */ } }
      else startGame();
    } }));
    col.appendChild(mkButton('VOLVER', { onClick: function () { S.show(returnScreen()); } }));
    panel.appendChild(col);
  }

  function buildPause() {
    var panel = mkTitleScreen('pause', 'PAUSA', null);
    S.widgets.pauseSub = el('p', C.subtitle, '');
    panel.appendChild(S.widgets.pauseSub);
    var col = el('div', C.buttonCol);
    col.appendChild(mkButton('REANUDAR', { primary: true, onClick: function () {
      S.hide();
      if (typeof S.cb.onResume === 'function') S.cb.onResume();
    } }));
    col.appendChild(mkButton('AJUSTES', { onClick: function () { S.show('settings'); } }));
    col.appendChild(mkButton('REINTENTAR OLEADA', { onClick: function () {
      S.hide();
      if (typeof S.cb.onRestartCheckpoint === 'function') S.cb.onRestartCheckpoint();
    } }));
    col.appendChild(mkButton('REINICIAR MISIÓN', { onClick: function () {
      S.hide();
      if (typeof S.cb.onRestartMission === 'function') S.cb.onRestartMission();
    } }));
    col.appendChild(mkButton('SALIR AL MENÚ', { danger: true, onClick: function () {
      if (typeof S.cb.onQuitToMenu === 'function') S.cb.onQuitToMenu();
      else S.show('main');
    } }));
    panel.appendChild(col);
  }

  function buildDead() {
    var panel = mkTitleScreen('dead', 'HAS CAÍDO', 'LA SEÑAL SE DESVANECE…');
    var grid = el('div', C.statsGrid);
    S.widgets.deadWave = statRow(grid, 'OLEADA ALCANZADA');
    S.widgets.deadKills = statRow(grid, 'BAJAS');
    S.widgets.deadTime = statRow(grid, 'TIEMPO');
    panel.appendChild(grid);
    var col = el('div', C.buttonCol);
    col.appendChild(mkButton('REINTENTAR OLEADA', { primary: true, onClick: function () {
      S.hide();
      if (typeof S.cb.onRestartCheckpoint === 'function') S.cb.onRestartCheckpoint();
    } }));
    col.appendChild(mkButton('REINICIAR MISIÓN', { onClick: function () {
      S.hide();
      if (typeof S.cb.onRestartMission === 'function') S.cb.onRestartMission();
    } }));
    col.appendChild(mkButton('SALIR AL MENÚ', { danger: true, onClick: function () {
      if (typeof S.cb.onQuitToMenu === 'function') S.cb.onQuitToMenu();
      else S.show('main');
    } }));
    panel.appendChild(col);
  }

  function buildVictory() {
    var panel = mkTitleScreen('victory', 'SEÑAL ENVIADA', 'EL EQUIPO DE RESCATE HA RECIBIDO TU LLAMADA');
    var grid = el('div', C.statsGrid);
    S.widgets.winTime = statRow(grid, 'TIEMPO TOTAL');
    S.widgets.winKills = statRow(grid, 'BAJAS');
    S.widgets.winAcc = statRow(grid, 'PRECISIÓN');
    S.widgets.winHead = statRow(grid, 'DISPAROS A LA CABEZA');
    panel.appendChild(grid);
    var col = el('div', C.buttonCol);
    col.appendChild(mkButton('REINICIAR MISIÓN', { primary: true, onClick: function () {
      S.hide();
      if (typeof S.cb.onRestartMission === 'function') S.cb.onRestartMission();
    } }));
    col.appendChild(mkButton('SALIR AL MENÚ', { danger: true, onClick: function () {
      if (typeof S.cb.onQuitToMenu === 'function') S.cb.onQuitToMenu();
      else S.show('main');
    } }));
    panel.appendChild(col);
  }

  function statRow(grid, label) {
    grid.appendChild(el('div', C.statRow, label));
    var v = el('div', C.statValue, '—');
    grid.appendChild(v);
    return v;
  }

  /* ----------------------------------------------------------------------
   * Cambio de ajustes
   * -------------------------------------------------------------------- */
  function onSettingChanged(key, value) {
    var s = settingsRef();
    s[key] = value;
    refreshWidget(key);
    pushLive(s, key);
    if (BS.Util && BS.Util.saveSettings) BS.Util.saveSettings(s);
    if (typeof S.cb.onSettingsChanged === 'function') {
      try { S.cb.onSettingsChanged(s); } catch (e) { BS.Log.error('Menu.onSettingsChanged:', e && e.message ? e.message : e); }
    }
  }

  /* Aplica los ajustes a los subsistemas vivos para efecto inmediato. */
  function pushLive(s, key) {
    try {
      if (!s) return;
      var all = !key;
      if (key === 'sensitivity' || all) { if (BS.Input && BS.Input.setSensitivity) BS.Input.setSensitivity(s.sensitivity); }
      if (key === 'invertY' || all) { if (BS.Input && BS.Input.setInvertY) BS.Input.setInvertY(s.invertY); }
      if (key === 'volumeMaster' || all) { if (BS.Audio && BS.Audio.setMasterVolume) BS.Audio.setMasterVolume(s.volumeMaster); }
      if (key === 'volumeSfx' || all) { if (BS.Audio && BS.Audio.setSfxVolume) BS.Audio.setSfxVolume(s.volumeSfx); }
      if (key === 'volumeMusic' || all) { if (BS.Audio && BS.Audio.setMusicVolume) BS.Audio.setMusicVolume(s.volumeMusic); }
      if ((key === 'fov' || all) && BS.Renderer && BS.Renderer.setFov) BS.Renderer.setFov(s.fov);
      if ((key === 'postFx' || all) && BS.Renderer && typeof BS.Renderer.setPostFx === 'function') {
        if (BS.Renderer.getQuality && BS.Renderer.getQuality() === 'low') BS.Renderer.setPostFx(false);
        else BS.Renderer.setPostFx(!!s.postFx);
      }
      if ((key === 'resolutionScale' || all) && BS.Renderer && BS.Renderer.setResolutionScale) {
        if (!(BS.Renderer.getQuality && BS.Renderer.getQuality() === 'low')) BS.Renderer.setResolutionScale(s.resolutionScale);
      }
    } catch (e) { /* noop */ }
  }

  function refreshWidget(key) {
    var w = S.widgets[key];
    if (!w || !w.def) return;
    var s = settingsRef();
    var v = s[key];
    var def = w.def;
    if (def.type === 'range' && w.el) {
      w.el.value = String(v);
      if (w.val) w.val.textContent = def.fmt(Number(v));
    } else if (def.type === 'toggle' && w.el) {
      var on = !!v;
      w.el.textContent = on ? 'ACTIVADO' : 'DESACTIVADO';
      if (on) w.el.classList.add(C.btnActive); else w.el.classList.remove(C.btnActive);
      if (w.val) w.val.textContent = on ? 'SÍ' : 'NO';
    } else if (def.type === 'select' && w.el) {
      w.el.value = String(v);
    }
  }

  function refreshAll() {
    for (var i = 0; i < WIDGETS.length; i++) refreshWidget(WIDGETS[i].key);
  }

  /* ----------------------------------------------------------------------
   * Navegación
   * -------------------------------------------------------------------- */
  function returnScreen() {
    return (S.ctx && S.ctx.game && S.ctx.game.getState && S.ctx.game.getState() === 'paused')
      ? 'pause' : 'main';
  }

  function startGame() {
    S.hide();
    if (typeof S.cb.onStart === 'function') {
      try { S.cb.onStart(); } catch (e) { BS.Log.error('Menu.onStart:', e && e.message ? e.message : e); }
    }
  }

  /* ======================================================================
   * API pública
   * ==================================================================== */
  var Menu = {
    SCREENS: SCREENS,
    WIDGETS: WIDGETS,

    init: function (ctx) {
      S.ctx = ctx || null;
      if (ctx && ctx.settings) S.settings = ctx.settings;
      if (!S.built) {
        try { buildDOM(); }
        catch (e) {
          BS.Log.error('BS.Menu.build:', e && e.message ? e.message : e);
          S.built = false;
        }
      }
      settingsRef();
      // El <style> debe existir antes de mostrar pantallas legibles.
      if (BS.Style && BS.Style.inject) BS.Style.inject();
      refreshAll();
      BS.Log.info('BS.Menu.init OK (pantallas=' + SCREENS.length + ')');
    },

    build: function () {
      if (!S.built) buildDOM();
      refreshAll();
    },

    show: function (screen) {
      if (!S.built) { try { buildDOM(); } catch (e) { return; } }
      if (screen === null || screen === undefined) { S.hide(); return; }
      if (SCREENS.indexOf(screen) < 0) return;
      for (var i = 0; i < SCREENS.length; i++) {
        var sc = S.screens[SCREENS[i]];
        if (!sc) continue;
        if (SCREENS[i] === screen) {
          sc.classList.add(C.on);
          sc.classList.remove(C.hidden);
          sc.style.display = '';
        } else {
          sc.classList.remove(C.on);
          sc.classList.add(C.hidden);
          sc.style.display = 'none';
        }
      }
      // Navegación con ratón solo fuera de la partida: liberar el puntero.
      S.current = screen;
      if (screen !== 'loading') {
        try { if (BS.Input && BS.Input.isLocked && BS.Input.isLocked() && screen !== 'pause') BS.Input.exitPointerLock(); } catch (e) { /* noop */ }
      }
      if (screen === 'pause') {
        var sub = S.widgets.pauseSub;
        if (sub && S.ctx && S.ctx.game && typeof S.ctx.game.pauseReason === 'string' && S.ctx.game.pauseReason) {
          sub.textContent = S.ctx.game.pauseReason;
        }
      }
      refreshAll();
    },

    hide: function () {
      try {
        for (var i = 0; i < SCREENS.length; i++) {
          var sc = S.screens[SCREENS[i]];
          if (!sc) continue;
          sc.classList.remove(C.on);
          sc.classList.add(C.hidden);
          sc.style.display = 'none';
        }
        S.current = null;
        S.showClickCatch(false);
      } catch (e) { /* noop */ }
    },

    current: function () { return S.current; },

    setCallbacks: function (cb) {
      S.cb = cb || {};
    },

    getSettings: function () { return settingsRef(); },

    applySettings: function (s) {
      if (!s) return;
      var ref = settingsRef();
      for (var k in s) {
        if (!Object.prototype.hasOwnProperty.call(s, k)) continue;
        ref[k] = s[k];
      }
      refreshAll();
      pushLive(ref, null);
      if (BS.Util && BS.Util.saveSettings) BS.Util.saveSettings(ref);
      if (typeof S.cb.onSettingsChanged === 'function') {
        try { S.cb.onSettingsChanged(ref); } catch (e) { /* noop */ }
      }
    },

    setLoadingProgress: function (p01, label) {
      var p = Math.max(0, Math.min(1, Number(p01) || 0));
      S.progress = p;
      var fill = S.widgets.loadingFill;
      if (fill) fill.style.width = Math.round(p * 100) + '%';
      var lab = S.widgets.loadingLabel;
      if (lab) lab.textContent = (label ? String(label) : 'CARGANDO') + '  ' + Math.round(p * 100) + '%';
    },

    setDeathInfo: function (info) {
      S.deathInfo = info || {};
      function set(w, v) { if (w) w.textContent = v; }
      var t = (S.deathInfo.time !== undefined) ? BS.Util.formatTime(S.deathInfo.time) : '—';
      set(S.widgets.deadWave, (S.deathInfo.wave >= 0 ? String((S.deathInfo.wave | 0) + 1) : '—'));
      set(S.widgets.deadKills, String(S.deathInfo.kills | 0));
      set(S.widgets.deadTime, t);
    },

    setVictoryInfo: function (info) {
      S.victoryInfo = info || {};
      function set(w, v) { if (w) w.textContent = v; }
      set(S.widgets.winTime, (S.victoryInfo.time !== undefined) ? BS.Util.formatTime(S.victoryInfo.time) : '—');
      set(S.widgets.winKills, String(S.victoryInfo.kills | 0));
      var acc = Number(S.victoryInfo.accuracy) || 0;
      set(S.widgets.winAcc, Math.round(acc * 100) + '%');
      set(S.widgets.winHead, String(S.victoryInfo.headshots | 0));
    },

    showMessage: function (text, seconds) {
      if (!S.toastEl) return;
      S.toastEl.textContent = String(text === undefined || text === null ? '' : text);
      S.toastEl.classList.add(C.on);
      S.toastT = Number(seconds) > 0 ? Number(seconds) : 3.0;
    },

    /** Aviso persistente de error (fallo de WebGL, etc.). */
    showError: function (text) {
      try {
        if (!S.built) buildDOM();
        if (!S.errorEl) return;
        S.errorEl.innerHTML = '';
        S.errorEl.appendChild(el('h2', null, 'ERROR FATAL'));
        var pre = el('div');
        pre.textContent = String(text === undefined || text === null ? 'Error desconocido' : text);
        S.errorEl.appendChild(pre);
        var hint = el('div', cls(C.small), 'Recarga la página tras habilitar la aceleración por hardware.');
        hint.style.marginTop = '10px';
        S.errorEl.appendChild(hint);
        S.errorEl.style.display = 'block';
        Menu.hide();
      } catch (e) { /* noop */ }
    },

    hideError: function () {
      try { if (S.errorEl) S.errorEl.style.display = 'none'; } catch (e) { /* noop */ }
    },

    /** Overlay "CLIC PARA BLOQUEAR EL RATÓN" (extra para el bucle de juego). */
    showClickCatch: function (on, text) {
      if (!S.clickCatch) return;
      if (text && S.clickCatch.firstChild) S.clickCatch.firstChild.textContent = String(text);
      if (on) S.clickCatch.classList.add(C.on);
      else S.clickCatch.classList.remove(C.on);
    },

    setEditable: function (enabled) {
      S.editable = !!enabled;
      for (var i = 0; i < S.inputs.length; i++) {
        var it = S.inputs[i];
        if (!it || !it.el) continue;
        if (it.alwaysEnabled) continue;
        it.el.disabled = !S.editable;
        if (S.editable) it.el.classList.remove(C.disabled);
        else it.el.classList.add(C.disabled);
      }
    },

    /** Tic de la UI: apaga el aviso cuando expira (independiente del HUD). */
    update: function (dt) {
      if (S.toastT > 0) {
        S.toastT -= Number(dt) || 0;
        if (S.toastT <= 0 && S.toastEl) S.toastEl.classList.remove(C.on);
      }
    },

    state: function () {
      return {
        current: S.current,
        built: S.built,
        editable: S.editable,
        screens: SCREENS.slice(),
        settings: settingsRef()
      };
    }
  };

  /* Alias internos: el código de construcción (arriba) invoca S.show/S.hide/
   * S.showClickCatch/S.applySettings, pero la implementación vive en el objeto
   * público Menu. Sin estos alias los botones del menú lanzaban TypeError
   * ("S.hide is not a function") y no hacían nada. Ninguno usa `this`. */
  S.show = Menu.show;
  S.hide = Menu.hide;
  S.showClickCatch = Menu.showClickCatch;
  S.applySettings = Menu.applySettings;

  BS.Menu = Menu;

  /* ======================================================================
   * Test: construcción y ajustes con efecto + persistencia tolerante
   * ==================================================================== */
  if (BS.Debug && typeof BS.Debug.register === 'function') {
    BS.Debug.register('menu:settings', function () {
      var before = Menu.getSettings();
      var saved = {};
      for (var k in before) if (Object.prototype.hasOwnProperty.call(before, k)) saved[k] = before[k];
      var ok = true, notes = [];

      try {
        if (!S.built) Menu.init(null);
        if (!S.built) { ok = false; notes.push('build fallido'); }

        // getSettings siempre devuelve un objeto con las claves del contrato
        var need = ['sensitivity', 'invertY', 'volumeMaster', 'volumeSfx', 'volumeMusic',
          'fov', 'resolutionScale', 'quality', 'postFx', 'showFps', 'crosshair',
          'bloodFx', 'screenShake', 'difficulty'];
        var s0 = Menu.getSettings();
        for (var i = 0; i < need.length; i++) {
          if (!(need[i] in s0)) { ok = false; notes.push('falta ajuste ' + need[i]); }
        }

        // applySettings surte efecto inmediato en la referencia viva
        Menu.applySettings({ fov: 91, quality: 'medium', volumeMaster: 0.42, difficulty: 'hard' });
        var s1 = Menu.getSettings();
        if (s1.fov !== 91) { ok = false; notes.push('fov no aplicado'); }
        if (s1.quality !== 'medium') { ok = false; notes.push('quality no aplicada'); }
        if (Math.abs(s1.volumeMaster - 0.42) > 1e-6) { ok = false; notes.push('volumen no aplicado'); }
        if (s1.difficulty !== 'hard') { ok = false; notes.push('dificultad no aplicada'); }

        // persistencia tolerante (file:// puede lanzar: no debe propagarse)
        if (BS.Util && BS.Util.saveSettings) BS.Util.saveSettings(s1);

        // navegación sin Pointer Lock
        Menu.show('settings');
        if (Menu.current() !== 'settings') { ok = false; notes.push('show(settings)'); }
        Menu.show('main');
        if (Menu.current() !== 'main') { ok = false; notes.push('show(main)'); }
        Menu.showMessage('prueba', 1);
        Menu.update(2);
        var st = Menu.state();
        if (!st || st.screens.length !== SCREENS.length) { ok = false; notes.push('state'); }
      } catch (e) {
        ok = false;
        notes.push('excepción: ' + (e && e.message ? e.message : e));
      } finally {
        // restaurar ajustes originales
        Menu.applySettings(saved);
        try { Menu.show(null); } catch (e2) { /* noop */ }
      }

      return { ok: ok, notas: notes, pantallas: SCREENS.length, ajustes: Object.keys(Menu.getSettings()).length };
    });

    /* ==================================================================
     * Regresión del BUG del menú: los botones invocaban S.show/S.hide/
     * S.applySettings, que NO existían en S; el TypeError quedaba silenciado
     * por el try/catch de mkButton y la pantalla no cambiaba. Restaura el
     * estado al terminar para no alterar la sesión del jugador.
     * ================================================================== */
    BS.Debug.register('menu:buttons', function () {
      var ok = true, notes = [];
      var saved = {}, savedCurrent = 'main';
      try {
        if (!S.built) Menu.init(S.ctx);
        var s0 = Menu.getSettings();
        for (var k in s0) if (Object.prototype.hasOwnProperty.call(s0, k)) saved[k] = s0[k];
        var stc = Menu.state();
        savedCurrent = stc ? stc.current : 'main';

        var clickIn = function (screenId, text) {
          var sc = document.getElementById('bs-screen-' + screenId);
          if (!sc) { notes.push('sin pantalla ' + screenId); return false; }
          var bs = sc.querySelectorAll('button');
          for (var i = 0; i < bs.length; i++) {
            if ((bs[i].textContent || '').replace(/\s+/g, ' ').trim() === text) { bs[i].click(); return true; }
          }
          notes.push('botón ' + screenId + '/' + text + ' no encontrado');
          return false;
        };
        var expect = function (screen) {
          if (Menu.current() !== screen) { ok = false; notes.push('esperaba ' + screen + ', quedó ' + Menu.current()); }
        };

        // S.show(...) — antes: "S.show is not a function".
        Menu.show('main'); expect('main');
        if (clickIn('main', 'TUTORIAL')) expect('tutorial');
        if (clickIn('tutorial', 'VOLVER')) expect('main');
        if (clickIn('main', 'AJUSTES')) expect('settings');
        // S.applySettings(...) — antes: "S.applySettings is not a function".
        Menu.applySettings({ fov: 97 });
        if (clickIn('settings', 'RESTABLECER AJUSTES')) {
          var def = (BS.Util && BS.Util.settingsDefaults) ? BS.Util.settingsDefaults() : null;
          if (Menu.getSettings().fov === 97 && (!def || def.fov !== 97)) { ok = false; notes.push('RESTABLECER no repuso fov'); }
        }
        if (clickIn('settings', 'VOLVER')) expect('main');
        // S.hide() — antes: "S.hide is not a function".
        Menu.show(null);
        if (Menu.current() !== null) { ok = false; notes.push('show(null) no ocultó (S.hide)'); }
      } catch (e) {
        ok = false; notes.push('excepción: ' + (e && e.message ? e.message : e));
      }
      try { Menu.applySettings(saved); } catch (e1) { /* noop */ }
      try { Menu.show(savedCurrent === undefined ? 'main' : savedCurrent); } catch (e2) { /* noop */ }
      return { ok: ok, notas: notes };
    });

    /* ==================================================================
     * Regresión del BUG del Pointer Lock: el overlay debía recibir clics.
     * #bs-ui es pointer-events:none; el overlay no lo reactivaba y el clic
     * atravesaba hasta el canvas, así que requestPointerLock() no se llamaba.
     * ================================================================== */
    BS.Debug.register('menu:pointerlock-overlay', function () {
      var ok = true, notes = [];
      var savedCurrent = 'main', wasVisible = false;
      try {
        if (!S.built) Menu.init(S.ctx);
        var cc = document.getElementById('bs-click-catch');
        if (!cc) { ok = false; notes.push('no existe #bs-click-catch'); }
        else {
          var cs0 = null;
          try { cs0 = getComputedStyle(cc); } catch (e0) { /* noop */ }
          wasVisible = !!(cs0 && cs0.display !== 'none');
          var pe = cs0 ? cs0.pointerEvents : '';
          if (pe !== 'auto') { ok = false; notes.push('pointer-events=' + pe + ' (esperado auto)'); }

          var stc = Menu.state();
          savedCurrent = stc ? stc.current : 'main';
          Menu.show(null);                         // el overlay debe quedar arriba
          Menu.showClickCatch(true, 'TEST POINTER LOCK');
          var cx = Math.floor((window.innerWidth || 800) / 2);
          var cy = Math.floor((window.innerHeight || 600) / 2);
          var hit = null;
          try { hit = document.elementFromPoint(cx, cy); } catch (e1) { /* noop */ }
          var id = hit ? (hit.id || '') : '';
          if (id !== 'bs-click-catch') { ok = false; notes.push('elementFromPoint=' + (id || 'null')); }
          Menu.showClickCatch(wasVisible);
        }
      } catch (e) {
        ok = false; notes.push('excepción: ' + (e && e.message ? e.message : e));
      }
      try { Menu.show(savedCurrent === undefined ? 'main' : savedCurrent); } catch (e2) { /* noop */ }
      return { ok: ok, notas: notes };
    });
  }

})(window.BS = window.BS || {});
