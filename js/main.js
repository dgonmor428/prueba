/* ===========================================================================
 * BLACKSITE: LAST SIGNAL  —  js/main.js
 * ---------------------------------------------------------------------------
 * Propósito : punto de entrada (§3.22). Se carga SIEMPRE el último en
 *             `index.html` y en los sandbox. Arranca la aplicación:
 *               1) inyecta el estilo (BS.Style.inject) y asegura el DOM,
 *               2) muestra la pantalla de carga (BS.Menu),
 *               3) cablea los callbacks del menú con el juego,
 *               4) construye el juego (BS.Game.init: WebGL, texturas,
 *                  shaders, nivel, jugador, enemigos, HUD...),
 *               5) muestra el menú principal y lanza el bucle rAF.
 * Reglas    : §3.0 (IIFE, solo window.BS, sin class/let/const de archivo, sin
 *             dependencias, sin fetch/módulos), §5 (bucle de juego en rAF).
 *             Todo el arranque es idempotente: llamar dos veces a boot() no
 *             reconstruye nada.
 * Depende de: js/ui/style.js, js/ui/menu.js, js/ui/hud.js, js/game/game.js
 *             (todos a través de window.BS, con guardas).
 * Expone    : BS.Main
 * =========================================================================== */
(function (BS) {
  'use strict';

  var VERSION = '1.0.0';

  /* ======================================================================
   * Estado interno del módulo
   * ==================================================================== */
  var booted = false;       // boot() ya se ejecutó al menos una vez
  var running = false;      // el bucle rAF está activo
  var rafId = 0;
  var lastDraw = 0;         // marca de tiempo del último frame dibujado (límite de FPS)
  var useRaf = (typeof requestAnimationFrame === 'function');

  function logError(where, e) {
    try {
      if (BS.Log && BS.Log.error) BS.Log.error('BS.Main.' + where + ':', e && e.message ? e.message : e);
    } catch (e2) { /* noop */ }
  }

  /* Marca de tiempo en ms con degradación segura (rama setTimeout del bucle). */
  function timeMs() {
    try {
      if (BS.Util && typeof BS.Util.nowMs === 'function') return BS.Util.nowMs();
    } catch (e) { /* noop */ }
    return (new Date()).getTime();
  }

  function call(obj, method, a, b) {
    if (!obj || typeof obj[method] !== 'function') return null;
    try { return obj[method](a, b); } catch (e) { logError(method, e); return null; }
  }

  /* ======================================================================
   * Bucle de juego (§5.2) — un único requestAnimationFrame
   * ==================================================================== */
  function frame(nowMs) {
    if (!running) return;
    if (useRaf) rafId = requestAnimationFrame(frame);
    else rafId = setTimeout(function () { frame(timeMs()); }, 16);

    // Límite opcional de FPS (0 = sin límite). Se salta el frame pero se
    // sigue programando el siguiente para no detener el bucle.
    var cap = 0;
    try { cap = (BS.Game && BS.Game.fpsCap) ? (BS.Game.fpsCap | 0) : 0; } catch (e) { cap = 0; }
    if (cap > 0) {
      var interval = 1000 / cap;
      if (lastDraw > 0 && (nowMs - lastDraw) < (interval - 0.5)) return;
      lastDraw = nowMs;
    }

    try { if (BS.Game && BS.Game.frame) BS.Game.frame(nowMs); }
    catch (e2) { logError('frame', e2); }
  }

  function startLoop() {
    if (running) return;
    running = true;
    lastDraw = 0;
    if (useRaf) rafId = requestAnimationFrame(frame);
    else rafId = setTimeout(function () { frame(timeMs()); }, 16);
  }

  function stopLoop() {
    running = false;
    if (rafId) {
      try {
        if (useRaf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(rafId);
        else if (!useRaf) clearTimeout(rafId);
      } catch (e) { /* noop */ }
      rafId = 0;
    }
  }

  /* ======================================================================
   * Cableado de los callbacks del menú (§3.20) con el juego (§3.21)
   * --------------------------------------------------------------------
   * El menú nunca conoce al juego: sólo invoca estos callbacks.
   * ==================================================================== */
  function wireMenu() {
    if (!BS.Menu || typeof BS.Menu.setCallbacks !== 'function') return;
    BS.Menu.setCallbacks({
      // JUGAR (menú principal)
      onStart: function () {
        if (BS.Game && BS.Game.start) BS.Game.start();
      },
      // COMENZAR (pantalla TUTORIAL): arranca en el estado TUTORIAL guiado
      onStartTutorial: function () {
        if (BS.Game && BS.Game.startTutorial) BS.Game.startTutorial();
        else if (BS.Game && BS.Game.start) BS.Game.start();
      },
      // REANUDAR (pausa)
      onResume: function () {
        if (BS.Game && BS.Game.resume) BS.Game.resume();
      },
      // REINTENTAR OLEADA (pausa / muerte)
      onRestartCheckpoint: function () {
        if (BS.Game && BS.Game.restartCheckpoint) BS.Game.restartCheckpoint();
      },
      // REINICIAR MISIÓN (pausa / muerte / victoria): partida completa de nuevo.
      // Un único camino: Game.restartMission() (resetea estado y vuelve a
      // PLAYING). Game.start() dejaba el estado en 'dead' tras morir.
      onRestartMission: function () {
        if (BS.Game && BS.Game.restartMission) BS.Game.restartMission();
        else if (BS.Game && BS.Game.start) BS.Game.start();
      },
      // SALIR AL MENÚ
      onQuitToMenu: function () {
        if (BS.Game && BS.Game.quitToMenu) BS.Game.quitToMenu();
        else if (BS.Menu && BS.Menu.show) BS.Menu.show('main');
      },
      // Cambios en AJUSTES aplicados en caliente
      onSettingsChanged: function (s) {
        if (BS.Game && BS.Game.applySettings) BS.Game.applySettings(s);
      },
      // El overlay "CLIC PARA BLOQUEAR EL RATÓN" pide el Pointer Lock
      // (R5: aquí, en un gesto real del usuario, es donde se reanuda el audio).
      onRequestLock: function () {
        if (BS.Audio) {
          call(BS.Audio, 'init');
          var pr = call(BS.Audio, 'resume');
          if (pr && typeof pr.catch === 'function') pr.catch(function () { /* noop */ });
        }
        if (BS.Input && BS.Input.requestPointerLock) {
          var p = BS.Input.requestPointerLock();
          if (p && typeof p.catch === 'function') p.catch(function () { /* noop */ });
        }
      }
    });
  }

  /* ======================================================================
   * API pública
   * ==================================================================== */
  var Main = {
    version: VERSION,

    /**
     * Arranca la aplicación completa. Idempotente: sólo hace trabajo la
     * primera vez; las llamadas posteriores devuelven el mismo resultado.
     * @returns {boolean} true si el juego quedó operativo.
     */
    boot: function () {
      if (booted) return !!Main.ready;
      booted = true;

      /* 1. Estilo + DOM (idempotentes) --------------- */
      call(BS.Style, 'inject');
      call(BS.Util, 'ensureDOM');

      /* 2. Pantalla de carga (menú con contexto aún nulo) --------------- */
      call(BS.Menu, 'init', null);
      call(BS.Menu, 'setLoadingProgress', 0.12, 'PREPARANDO MOTOR');
      call(BS.Menu, 'show', 'loading');

      /* 3. Cablear el menú con el juego --------------- */
      wireMenu();

      /* 4. Construir el juego (WebGL, texturas, shaders, nivel...) ------ */
      call(BS.Menu, 'setLoadingProgress', 0.4, 'CONSTRUYENDO INSTALACIÓN K-7');
      var ok = false;
      try {
        ok = !!(BS.Game && typeof BS.Game.init === 'function' && BS.Game.init());
      } catch (e) {
        logError('init', e);
        ok = false;
      }

      if (!ok) {
        // Game.init ya ha mostrado el aviso (WebGL o shaders). Se deja la
        // caja de error visible y NO se arranca el bucle.
        Main.ready = false;
        return false;
      }

      Main.ready = true;

      /* 5. Menú principal + bucle --------------- */
      call(BS.Menu, 'setLoadingProgress', 1, 'LISTO');
      call(BS.Menu, 'show', 'main');
      startLoop();

      try {
        if (BS.Log && BS.Log.info) BS.Log.info('BS.Main.boot OK — BLACKSITE v' + VERSION + ' listo');
      } catch (e2) { /* noop */ }
      return true;
    },

    /** ¿El bucle está activo? */
    isRunning: function () { return running; },

    /** Detiene / reanuda el bucle (útil para depuración y pruebas). */
    stop: function () { stopLoop(); },
    resume: function () { if (Main.ready) startLoop(); },

    /** Arranque diferido: espera al DOM si aún se está analizando. */
    start: function () {
      if (typeof document !== 'undefined' && document.readyState === 'loading') {
        if (BS.Util && BS.Util.addListener) {
          BS.Util.addListener(document, 'DOMContentLoaded', function () { Main.boot(); });
        } else {
          document.addEventListener('DOMContentLoaded', function () { Main.boot(); }, false);
        }
      } else {
        Main.boot();
      }
    },

    ready: false
  };

  BS.Main = Main;

  /* Regresión de la red de seguridad de arranque (js/core/util.js): en un
   * arranque correcto NO debe aparecer #bs-boot-fail y Main debe estar listo.
   * Si BS.Main no existe (arnés parcial) el test se omite, no falla. */
  if (BS.Debug && typeof BS.Debug.register === 'function') {
    BS.Debug.register('boot:safety', function () {
      if (!window.BS || !window.BS.Main) return { ok: true, notas: ['BS.Main ausente: no aplicable'], skipped: true };
      var ok = true, notes = [];
      var box = document.getElementById('bs-boot-fail');
      if (box) { ok = false; notes.push('#bs-boot-fail visible en un arranque correcto'); }
      if (!Main.ready) { ok = false; notes.push('BS.Main.ready=false'); }
      var root = document.getElementById('bs-root');
      if (!root || !root.firstChild) { ok = false; notes.push('#bs-root sin contenido'); }
      return { ok: ok, notas: notes, mainReady: !!Main.ready, bootFail: !!box };
    });
  }

  /* Auto-arranque: main.js se carga el último, pero puede que el parser aún
   * no haya terminado (readyState 'loading'): entonces esperamos a
   * DOMContentLoaded. Nunca lanza. */
  try {
    Main.start();
  } catch (e) {
    logError('start', e);
  }

})(window.BS = window.BS || {});
