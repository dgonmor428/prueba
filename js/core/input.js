/* ===========================================================================
 * BLACKSITE: LAST SIGNAL  —  js/core/input.js
 * ---------------------------------------------------------------------------
 * Propósito : entrada de teclado/ratón con Pointer Lock robusto (R1) y APIs
 *             de inyección sintética para BS.Debug/tester. Usa SIEMPRE
 *             event.code (posición física) y limpia todo en
 *             blur/visibilitychange/pointerlockchange para evitar teclas
 *             "pegadas" (R7).
 * Depende de: js/core/util.js (BS.Log, BS.Util, BS.Events)
 * Expone    : BS.Input
 * =========================================================================== */
(function (BS) {
  'use strict';

  var lockSubs = [];
  var lockErrSubs = [];
  var nextId = 1;

  var Input = {
    keys: {},
    keysPressed: {},
    keysReleased: {},
    buttons: {},
    buttonsPressed: {},
    buttonsReleased: {},
    mouseDX: 0,
    mouseDY: 0,
    wheel: 0,
    mouseX: 0,
    mouseY: 0,

    locked: false,
    lastLockError: null,
    lockRequests: 0,
    lockFailures: 0,

    sensitivity: 0.0022,
    invertY: false,
    rawInput: false,

    _canvas: null,
    _lastClientX: null,
    _lastClientY: null,
    _usingMovement: true,
    _bound: false,

    PREVENT_DEFAULT: {
      Space: 1, Tab: 1, ArrowUp: 1, ArrowDown: 1, ArrowLeft: 1, ArrowRight: 1,
      Slash: 1, Quote: 1, Backslash: 1, F1: 1, F3: 1
    },

    /* ==================================================================
     * init
     * ================================================================== */
    init: function (canvas) {
      Input._canvas = canvas || Input._canvas;
      if (Input._bound) return;
      Input._bound = true;

      BS.Util.addListener(window, 'keydown', Input._onKeyDown, false);
      BS.Util.addListener(window, 'keyup', Input._onKeyUp, false);
      BS.Util.addListener(window, 'mousemove', Input._onMouseMove, false);
      BS.Util.addListener(window, 'mousedown', Input._onMouseDown, false);
      BS.Util.addListener(window, 'mouseup', Input._onMouseUp, false);
      BS.Util.addListener(window, 'wheel', Input._onWheel, { passive: false });
      BS.Util.addListener(window, 'blur', Input._onBlur, false);
      BS.Util.addListener(window, 'contextmenu', function (ev) { ev.preventDefault(); }, false);

      BS.Util.addListener(document, 'pointerlockchange', Input._onLockChange, false);
      BS.Util.addListener(document, 'pointerlockerror', Input._onLockError, false);

      BS.Util.addListener(document, 'visibilitychange', function () {
        if (document.hidden) Input.clearAll();
      }, false);

      BS.Log.debug('BS.Input.init OK');
    },

    /* ==================================================================
     * Handlers
     * ================================================================== */
    _onKeyDown: function (ev) {
      var code = ev.code;
      if (!code) return;
      if (Input.PREVENT_DEFAULT[code]) {
        try { ev.preventDefault(); } catch (e) { /* noop */ }
      }
      if (!Input.keys[code]) Input.keysPressed[code] = true;
      Input.keys[code] = true;
      Input.keysReleased[code] = false;
    },

    _onKeyUp: function (ev) {
      var code = ev.code;
      if (!code) return;
      if (Input.PREVENT_DEFAULT[code]) {
        try { ev.preventDefault(); } catch (e) { /* noop */ }
      }
      if (Input.keys[code]) Input.keysReleased[code] = true;
      Input.keys[code] = false;
    },

    _onMouseMove: function (ev) {
      if (!Input.locked) {
        Input.mouseX = ev.clientX || 0;
        Input.mouseY = ev.clientY || 0;
      }
      var dx = 0, dy = 0;
      var mx = ev.movementX, my = ev.movementY;
      if (typeof mx === 'number' && typeof my === 'number' && (mx !== 0 || my !== 0)) {
        dx = mx; dy = my;
        Input._usingMovement = true;
      } else if (Input.locked && Input._lastClientX !== null) {
        // fallback: algunos navegadores/entornos virtuales no dan movementX
        dx = (ev.clientX || 0) - Input._lastClientX;
        dy = (ev.clientY || 0) - Input._lastClientY;
        Input._usingMovement = false;
      }
      Input._lastClientX = ev.clientX || 0;
      Input._lastClientY = ev.clientY || 0;
      Input.mouseDX += (dx || 0);
      Input.mouseDY += (dy || 0);
    },

    _onMouseDown: function (ev) {
      var b = ev.button | 0;
      if (!Input.buttons[b]) Input.buttonsPressed[b] = true;
      Input.buttons[b] = true;
    },

    _onMouseUp: function (ev) {
      var b = ev.button | 0;
      if (Input.buttons[b]) Input.buttonsReleased[b] = true;
      Input.buttons[b] = false;
    },

    _onWheel: function (ev) {
      try { ev.preventDefault(); } catch (e) { /* noop */ }
      var d = ev.deltaY || 0;
      if (d === 0 && ev.detail) d = ev.detail;
      Input.wheel += (d > 0 ? 1 : (d < 0 ? -1 : 0));
    },

    _onBlur: function () {
      Input.clearAll();
    },

    _onLockChange: function () {
      var el = document.pointerLockElement || document.mozPointerLockElement || null;
      var nowLocked = !!el && el === Input._canvas;
      var changed = (nowLocked !== Input.locked);
      Input.locked = nowLocked;
      Input._lastClientX = null;
      Input._lastClientY = null;
      if (!nowLocked) Input.clearAll();
      Input.mouseDX = 0;
      Input.mouseDY = 0;
      if (changed) {
        for (var i = 0; i < lockSubs.length; i++) {
          try { lockSubs[i].cb(nowLocked); } catch (e) { BS.Log.error('Input.onLockChange handler:', e && e.message); }
        }
        if (nowLocked && BS.Log) BS.Log.debug('BS.Input: Pointer Lock adquirido');
      }
    },

    _onLockError: function (ev) {
      Input.lastLockError = (ev && ev.type) ? ev.type : 'pointerlockerror';
      Input.lockFailures++;
      Input.locked = false;
      for (var i = 0; i < lockErrSubs.length; i++) {
        try { lockErrSubs[i].cb(Input.lastLockError); } catch (e) { BS.Log.error('Input.onLockError handler:', e && e.message); }
      }
      return false;
    },

    /* ==================================================================
     * Consultas
     * ================================================================== */
    isDown: function (code) { return Input.keys[code] === true; },
    wasPressed: function (code) { return Input.keysPressed[code] === true; },
    wasReleased: function (code) { return Input.keysReleased[code] === true; },
    mouseDown: function (btn) { return Input.buttons[btn] === true; },
    mousePressed: function (btn) { return Input.buttonsPressed[btn] === true; },
    mouseReleased: function (btn) { return Input.buttonsReleased[btn] === true; },

    consumeMouseDelta: function () {
      var out = { dx: Input.mouseDX, dy: Input.mouseDY };
      Input.mouseDX = 0;
      Input.mouseDY = 0;
      return out;
    },

    peekMouseDelta: function () {
      return { dx: Input.mouseDX, dy: Input.mouseDY };
    },

    consumeWheel: function () {
      var w = Input.wheel;
      Input.wheel = 0;
      return w;
    },

    /* ==================================================================
     * Pointer Lock robusto (R1)
     * ================================================================== */
    requestPointerLock: function () {
      var el = Input._canvas;
      if (!el) return;
      if (Input.locked || document.pointerLockElement === el) return;
      Input.lockRequests++;
      Input.lastLockError = null;

      var onFail = function (err) {
        Input.lastLockError = err || 'rechazado';
        Input.lockFailures++;
        BS.Log.debug('BS.Input.requestPointerLock rechazado:', Input.lastLockError);
        Input._onLockError({ type: 'request-rejected' });
      };

      try {
        var p = null;
        try {
          p = el.requestPointerLock({ unadjustedMovement: true });
        } catch (e0) {
          p = el.requestPointerLock();
        }
        if (p && typeof p.then === 'function') {
          p.then(function () {
            // el evento pointerlockchange confirma el estado real
          }).catch(function () {
            // fallback: sin unadjustedMovement
            try {
              var q = el.requestPointerLock();
              if (q && typeof q.catch === 'function') q.catch(function () { onFail('reintento rechazado'); });
            } catch (e1) {
              onFail('reintento imposible');
            }
          });
        }
      } catch (e) {
        try {
          var q2 = el.requestPointerLock();
          if (q2 && typeof q2.catch === 'function') q2.catch(function () { onFail('requestPointerLock rechazado'); });
        } catch (e2) {
          onFail('requestPointerLock no disponible');
        }
      }
    },

    exitPointerLock: function () {
      try {
        if (document.exitPointerLock) document.exitPointerLock();
      } catch (e) { /* noop */ }
    },

    isLocked: function () { return !!Input.locked && document.pointerLockElement === Input._canvas; },

    onLockChange: function (cb) {
      var id = nextId++;
      lockSubs.push({ id: id, cb: cb });
      return id;
    },

    onLockError: function (cb) {
      var id = nextId++;
      lockErrSubs.push({ id: id, cb: cb });
      return id;
    },

    /* ==================================================================
     * Ajustes
     * ================================================================== */
    setSensitivity: function (v) {
      v = Number(v);
      if (isFinite(v) && v > 0) Input.sensitivity = v;
    },
    getSensitivity: function () { return Input.sensitivity; },
    setInvertY: function (on) { Input.invertY = !!on; },
    getInvertY: function () { return Input.invertY; },
    setRawInput: function (on) { Input.rawInput = !!on; },

    /* ==================================================================
     * Inyección (BS.Debug / tester). No requiere Pointer Lock.
     * ================================================================== */
    simulateKey: function (code, down) {
      if (typeof code !== 'string' || !code) return;
      if (down) {
        if (!Input.keys[code]) Input.keysPressed[code] = true;
        Input.keys[code] = true;
        Input.keysReleased[code] = false;
      } else {
        if (Input.keys[code]) Input.keysReleased[code] = true;
        Input.keys[code] = false;
      }
    },

    simulateMouseDelta: function (dx, dy) {
      Input.mouseDX += (Number(dx) || 0);
      Input.mouseDY += (Number(dy) || 0);
    },

    simulateMouseButton: function (btn, down) {
      var b = btn | 0;
      if (down) {
        if (!Input.buttons[b]) Input.buttonsPressed[b] = true;
        Input.buttons[b] = true;
      } else {
        if (Input.buttons[b]) Input.buttonsReleased[b] = true;
        Input.buttons[b] = false;
      }
    },

    simulateWheel: function (delta) {
      Input.wheel += (delta > 0 ? 1 : (delta < 0 ? -1 : 0));
    },

    /** Limpia TODO. Obligatorio en blur / visibilitychange / pointerlockchange. */
    clearAll: function () {
      var k;
      for (k in Input.keys) { if (Input.keys[k]) Input.keysReleased[k] = true; }
      Input.keys = {};
      Input.keysPressed = {};
      Input.keysReleased = {};
      Input.buttons = {};
      Input.buttonsPressed = {};
      Input.buttonsReleased = {};
      Input.mouseDX = 0;
      Input.mouseDY = 0;
      Input.wheel = 0;
      Input._lastClientX = null;
      Input._lastClientY = null;
    },

    beginFrame: function () {
      // no-op reservado (el bucle del juego lo llama por contrato)
    },

    endFrame: function () {
      Input.keysPressed = {};
      Input.keysReleased = {};
      Input.buttonsPressed = {};
      Input.buttonsReleased = {};
      Input.mouseDX = 0;
      Input.mouseDY = 0;
      Input.wheel = 0;
    },

    /** Resumen para el HUD de depuración. */
    debugState: function () {
      var held = [];
      for (var k in Input.keys) if (Input.keys[k]) held.push(k);
      return {
        locked: Input.locked,
        keys: held,
        mouseX: Input.mouseX,
        mouseY: Input.mouseY,
        deltasPending: [Input.mouseDX, Input.mouseDY],
        sensitivity: Input.sensitivity,
        lockRequests: Input.lockRequests,
        lockFailures: Input.lockFailures,
        lastLockError: Input.lastLockError,
        usingMovementXY: Input._usingMovement
      };
    }
  };

  BS.Input = Input;

  if (BS.Debug && typeof BS.Debug.register === 'function') {
    BS.Debug.register('input:simulate', function () {
      var ok = true;
      var notes = [];
      Input.simulateKey('KeyW', true);
      if (!Input.isDown('KeyW') || !Input.wasPressed('KeyW')) { ok = false; notes.push('simulateKey(down) no registró'); }
      Input.endFrame();
      if (Input.wasPressed('KeyW')) { ok = false; notes.push('endFrame no limpió el flanco'); }
      if (!Input.isDown('KeyW')) { ok = false; notes.push('endFrame limpió el estado mantenido'); }
      Input.simulateKey('KeyW', false);
      if (Input.isDown('KeyW') || !Input.wasReleased('KeyW')) { ok = false; notes.push('simulateKey(up) no registró'); }
      Input.simulateMouseDelta(5, -3);
      var d = Input.consumeMouseDelta();
      if (d.dx !== 5 || d.dy !== -3) { ok = false; notes.push('delta de ratón incorrecto'); }
      var d2 = Input.consumeMouseDelta();
      if (d2.dx !== 0 || d2.dy !== 0) { ok = false; notes.push('consumeMouseDelta no resetea'); }
      Input.clearAll();
      return { ok: ok, notes: notes, bound: Input._bound };
    });
  }

})(window.BS = window.BS || {});
