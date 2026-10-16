/* ===========================================================================
 * BLACKSITE: LAST SIGNAL  —  js/core/debug.js
 * ---------------------------------------------------------------------------
 * Propósito : consola de depuración y control remoto para el agente `tester`.
 *             Permite operar el juego (mover, mirar, disparar, spawnear
 *             enemigos, cambiar calidad) sin eventos reales de DOM ni Pointer
 *             Lock, además de registrar y ejecutar tests de auto-verificación.
 *             `state()` y `runAll()` JAMÁS lanzan: si un subsistema todavía no
 *             existe devuelven valores por defecto.
 * Depende de: js/core/util.js (BS.Log, BS.Util, BS.Events)
 * Expone    : BS.Debug
 * =========================================================================== */
(function (BS) {
  'use strict';

  var tests = {};
  var order = [];
  var overlayEl = null;
  var captured = false;

  var Debug = {
    enabled: true,
    errors: [],
    fpsCap: 0,
    _lastRunMs: 0,
    _stepCount: 0,

    /* ------------------------------------------------------------------
     * Captura de errores (R16): window.onerror + unhandledrejection + WebGL
     * ------------------------------------------------------------------ */
    captureErrors: function () {
      if (captured) return;
      captured = true;
      Debug._captured = true;

      var push = function (msg, src, line, col, extra) {
        var entry = {
          msg: String(msg === undefined || msg === null ? 'error' : msg),
          src: src ? String(src) : '',
          line: line | 0,
          col: col | 0,
          time: BS.Util.now(),
          extra: extra === undefined ? null : extra
        };
        try { Debug.errors.push(entry); } catch (e) { /* noop */ }
        if (Debug.errors.length > 200) Debug.errors.shift();
        if (BS.Log && BS.Log.error) BS.Log.error('BS.Debug capturó:', entry.msg, entry.src + ':' + entry.line);
      };

      try {
        var prevOnError = window.onerror;
        window.onerror = function (msg, src, line, col, err) {
          push(msg, src, line, col, err && err.stack ? err.stack : null);
          if (typeof prevOnError === 'function') {
            try { return prevOnError.apply(window, arguments); } catch (e) { /* noop */ }
          }
          return false;
        };
      } catch (e) { /* noop */ }

      BS.Util.addListener(window, 'unhandledrejection', function (ev) {
        var r = ev && ev.reason;
        push('unhandledrejection: ' + (r && r.message ? r.message : String(r)),
          r && r.fileName ? r.fileName : '', 0, 0, r && r.stack ? r.stack : null);
      });

      BS.Util.addListener(window, 'error', function (ev) {
        // recursos que no cargan (útil para detectar rutas mal escritas)
        if (ev && ev.target && (ev.target.tagName === 'SCRIPT' || ev.target.tagName === 'IMG')) {
          push('fallo al cargar recurso: ' + (ev.target.src || ev.target.tagName),
            ev.target.src || '', 0, 0, null);
        }
      }, true);

      // Errores de creación de contexto WebGL (fase de captura: no burbujean)
      BS.Util.addListener(document, 'webglcontextcreationerror', function (ev) {
        push('webglcontextcreationerror: ' + ((ev && ev.statusMessage) || 'sin mensaje'), '', 0, 0, null);
      }, true);

      BS.Util.addListener(window, 'webglcontextlost', function () {
        push('webglcontextlost', '', 0, 0, null);
      }, true);
    },

    clearErrors: function () {
      Debug.errors.length = 0;
    },

    /* ------------------------------------------------------------------
     * Registro y ejecución de tests
     * ------------------------------------------------------------------ */
    register: function (id, fn) {
      if (typeof id !== 'string' || typeof fn !== 'function') {
        BS.Log.warn('BS.Debug.register: argumentos inválidos');
        return;
      }
      if (!Object.prototype.hasOwnProperty.call(tests, id)) order.push(id);
      tests[id] = fn;
    },

    unregister: function (id) {
      if (!Object.prototype.hasOwnProperty.call(tests, id)) return false;
      delete tests[id];
      var i = order.indexOf(id);
      if (i >= 0) order.splice(i, 1);
      return true;
    },

    list: function () {
      return order.slice();
    },

    /** Ejecuta un test. Nunca lanza: devuelve siempre {id, ok, result, error}. */
    run: function (id) {
      var out = { id: id, ok: false, result: null, error: null, ms: 0 };
      var fn = Object.prototype.hasOwnProperty.call(tests, id) ? tests[id] : null;
      if (typeof fn !== 'function') {
        out.error = 'test no registrado: ' + id;
        return out;
      }
      var t0 = BS.Util.nowMs();
      try {
        var r = fn();
        if (r && typeof r === 'object' && typeof r.ok === 'boolean') {
          out.result = r;
          out.ok = r.ok;
        } else {
          out.result = r;
          out.ok = true;
        }
      } catch (e) {
        out.ok = false;
        out.error = (e && e.message ? e.message : String(e));
        if (e && e.stack) out.stack = String(e.stack);
        if (BS.Log && BS.Log.error) BS.Log.error('BS.Debug.run("' + id + '") lanzó:', out.error);
      }
      out.ms = Math.round((BS.Util.nowMs() - t0) * 100) / 100;
      return out;
    },

    /** Ejecuta TODOS los tests registrados. Nunca lanza. */
    runAll: function () {
      var t0 = BS.Util.nowMs();
      var results = [];
      var ids = order.slice();
      for (var i = 0; i < ids.length; i++) {
        results.push(Debug.run(ids[i]));
      }
      var failed = 0;
      for (var k = 0; k < results.length; k++) if (!results[k].ok) failed++;
      Debug._lastRunMs = BS.Util.nowMs() - t0;
      if (BS.Log && BS.Log.info) {
        BS.Log.info('BS.Debug.runAll: ' + (results.length - failed) + '/' + results.length +
          ' tests OK en ' + Math.round(Debug._lastRunMs) + ' ms');
      }
      return results;
    },

    /** Resumen compacto de runAll (extra, cómodo para el tester). */
    runAllSummary: function () {
      var res = Debug.runAll();
      var failed = [];
      for (var i = 0; i < res.length; i++) if (!res[i].ok) failed.push(res[i].id);
      return { total: res.length, failed: failed, ok: failed.length === 0, results: res };
    },

    /* ------------------------------------------------------------------
     * Estado y estadísticas (nunca lanzan)
     * ------------------------------------------------------------------ */
    state: function () {
      var out = {
        state: 'boot', hp: 100, ammo: 0, reserve: 0, enemiesAlive: 0,
        wave: -1, fps: 0, drawCalls: 0, tris: 0,
        pos: [0, 0, 0], yaw: 0, pitch: 0
      };
      try {
        var G = BS.Game;
        if (G && G.ctx) {
          var ctx = G.ctx;
          try {
            if (typeof G.getState === 'function') out.state = G.getState();
            else if (typeof G.state === 'string') out.state = G.state;
          } catch (e0) { /* noop */ }

          var p = ctx.player;
          if (p) {
            if (p.health !== undefined) out.hp = p.health;
            if (p.pos) out.pos = [p.pos[0], p.pos[1], p.pos[2]];
            if (typeof p.yaw === 'number') out.yaw = p.yaw;
            if (typeof p.pitch === 'number') out.pitch = p.pitch;
            try {
              var ws = (typeof p.getWeapons === 'function') ? p.getWeapons() : ctx.weapons;
              if (ws && typeof ws.getState === 'function') {
                var st = ws.getState();
                if (st) {
                  out.ammo = st.ammoInMag | 0;
                  out.reserve = st.reserve | 0;
                }
              }
            } catch (e1) { /* noop */ }
          }
          try {
            if (ctx.enemies && typeof ctx.enemies.aliveCount === 'function') {
              out.enemiesAlive = ctx.enemies.aliveCount();
            } else if (ctx.enemies && ctx.enemies.list) {
              out.enemiesAlive = ctx.enemies.list.length;
            }
          } catch (e2) { /* noop */ }
          if (typeof G.currentWave === 'number') out.wave = G.currentWave;
          try {
            if (BS.Renderer && BS.Renderer.stats) {
              out.fps = BS.Renderer.stats.fps || 0;
              out.drawCalls = BS.Renderer.stats.drawCalls || 0;
              out.tris = BS.Renderer.stats.tris || 0;
            }
          } catch (e3) { /* noop */ }
        }
      } catch (e) {
        out.error = (e && e.message) ? e.message : String(e);
      }
      return out;
    },

    stats: function () {
      var out = {
        fps: 0, frameMs: 0, drawCalls: 0, tris: 0, particles: 0, projectiles: 0,
        enemies: 0, quality: 'unknown', resolutionScale: 1, renderer: 'n/a',
        uploads: 0, lights: 0, buildMs: 0
      };
      try {
        var R = BS.Renderer;
        if (R && R.stats) {
          out.fps = R.stats.fps || 0;
          out.frameMs = R.stats.frameMs || 0;
          out.drawCalls = R.stats.drawCalls || 0;
          out.tris = R.stats.tris || 0;
          out.uploads = R.stats.uploadedBytes || 0;
          out.lights = R.stats.dynamicLights || 0;
          out.lightsOn = R.stats.lightsOn || 0;
        }
        if (R) {
          if (typeof R.getResolutionScale === 'function') out.resolutionScale = R.getResolutionScale();
          if (R.quality) out.quality = R.quality;
          if (typeof R.isPostFx === 'function' && R.isPostFx()) out.postFx = true;
        }
        var G = BS.GL;
        if (G && G.caps) {
          out.renderer = G.caps.renderer || 'n/a';
          out.isWebGL2 = !!G.caps.isWebGL2;
          out.isSoftware = !!G.caps.isSoftware;
        }
        var F = BS.FX;
        if (F && typeof F.count === 'function') out.particles = F.count();
        var P = BS.Projectiles;
        if (P && typeof P.count === 'function') out.projectiles = P.count();
        var E = BS.Enemies;
        if (E && typeof E.aliveCount === 'function') out.enemies = E.aliveCount();
        var A = BS.Audio;
        if (A) {
          out.voices = (A.voices && A.voices.length) || 0;
          out.audioState = A.ctx ? A.ctx.state : 'none';
          out.voiceBudget = A.voiceBudget;
        }
        var T = BS.Textures;
        if (T && T.buildMs) out.texturesMs = Math.round(T.buildMs);
      } catch (e) {
        out.error = (e && e.message) ? e.message : String(e);
      }
      return out;
    },

    /* ------------------------------------------------------------------
     * Control remoto
     * ------------------------------------------------------------------ */
    _ctx: function () {
      return (BS.Game && BS.Game.ctx) ? BS.Game.ctx : null;
    },

    _isSimulating: function () {
      try {
        if (BS.Game && typeof BS.Game.getState === 'function') {
          var s = BS.Game.getState();
          return s === 'playing' || s === 'tutorial';
        }
      } catch (e) { /* noop */ }
      return false;
    },

    teleport: function (x, y, z) {
      try {
        var ctx = Debug._ctx();
        if (ctx && ctx.player && ctx.player.pos) {
          ctx.player.pos[0] = x; ctx.player.pos[1] = y; ctx.player.pos[2] = z;
          if (ctx.player.vel) { ctx.player.vel[0] = 0; ctx.player.vel[1] = 0; ctx.player.vel[2] = 0; }
        }
        if (BS.Renderer && BS.Renderer.freeCamera && BS.Renderer.freeCamera.pos && BS.Renderer.freeCamera.enabled) {
          BS.Renderer.freeCamera.pos[0] = x;
          BS.Renderer.freeCamera.pos[1] = y + 1.6;
          BS.Renderer.freeCamera.pos[2] = z;
        }
      } catch (e) {
        BS.Log.error('BS.Debug.teleport:', e && e.message ? e.message : e);
      }
    },

    /** Inyecta un delta de ratón. Si no hay simulación activa lo aplica directo. */
    look: function (dx, dy) {
      try {
        var sens = (BS.Input && typeof BS.Input.getSensitivity === 'function')
          ? BS.Input.getSensitivity() : 0.0022;
        if (BS.Input && typeof BS.Input.simulateMouseDelta === 'function') {
          BS.Input.simulateMouseDelta(dx, dy);
        }
        var ctx = Debug._ctx();
        if (!Debug._isSimulating()) {
          if (ctx && ctx.player) {
            ctx.player.yaw = (ctx.player.yaw || 0) - dx * sens;
            ctx.player.pitch = BS.Math.clamp((ctx.player.pitch || 0) - dy * sens, -1.5, 1.5);
          } else if (BS.Renderer && BS.Renderer.freeCamera) {
            BS.Renderer.freeCamera.yaw -= dx * sens;
            BS.Renderer.freeCamera.pitch = BS.Math.clamp(BS.Renderer.freeCamera.pitch - dy * sens, -1.5, 1.5);
          }
        }
      } catch (e) {
        BS.Log.error('BS.Debug.look:', e && e.message ? e.message : e);
      }
    },

    /** Orienta la cámara hacia un punto del mundo. */
    lookAt: function (x, y, z) {
      try {
        var ctx = Debug._ctx();
        var eye = null, target = null;
        if (ctx && ctx.player && typeof ctx.player.eyePosition === 'function') {
          eye = ctx.player.eyePosition(new Float32Array(3));
        } else if (BS.Renderer && BS.Renderer.camera && BS.Renderer.camera.pos) {
          eye = BS.Renderer.camera.pos;
        }
        if (!eye) return;
        var dx = x - eye[0], dy = y - eye[1], dz = z - eye[2];
        var horiz = Math.sqrt(dx * dx + dz * dz);
        var yaw = Math.atan2(-dx, -dz);
        var pitch = Math.atan2(dy, horiz);
        Debug._setLook(yaw, pitch);
      } catch (e) {
        BS.Log.error('BS.Debug.lookAt:', e && e.message ? e.message : e);
      }
    },

    _setLook: function (yaw, pitch) {
      var ctx = Debug._ctx();
      if (ctx && ctx.player) {
        ctx.player.yaw = yaw;
        ctx.player.pitch = pitch;
      } else if (BS.Renderer && BS.Renderer.freeCamera) {
        BS.Renderer.freeCamera.yaw = yaw;
        BS.Renderer.freeCamera.pitch = pitch;
      }
    },

    key: function (code, down) {
      try {
        if (BS.Input && typeof BS.Input.simulateKey === 'function') {
          BS.Input.simulateKey(code, !!down);
        }
      } catch (e) {
        BS.Log.error('BS.Debug.key:', e && e.message ? e.message : e);
      }
    },

    /** Pulsación completa (down + up) dentro del mismo frame lógico. */
    press: function (code) {
      Debug.key(code, true);
      Debug.key(code, false);
    },

    setGodMode: function (on) {
      try {
        var ctx = Debug._ctx();
        if (ctx && ctx.player) ctx.player.godMode = !!on;
      } catch (e) {
        BS.Log.error('BS.Debug.setGodMode:', e && e.message ? e.message : e);
      }
    },

    setState: function (s) {
      try {
        if (BS.Game && typeof BS.Game.setState === 'function') BS.Game.setState(s);
      } catch (e) {
        BS.Log.error('BS.Debug.setState:', e && e.message ? e.message : e);
      }
    },

    startGame: function () {
      try {
        if (BS.Menu && typeof BS.Menu.hide === 'function') BS.Menu.hide();
        if (BS.Game && typeof BS.Game.start === 'function') { BS.Game.start(); return; }
        if (BS.Game && typeof BS.Game.setState === 'function') BS.Game.setState('playing');
      } catch (e) {
        BS.Log.error('BS.Debug.startGame:', e && e.message ? e.message : e);
      }
    },

    _weapons: function () {
      var ctx = Debug._ctx();
      if (!ctx) return null;
      if (ctx.weapons) return ctx.weapons;
      if (ctx.player && typeof ctx.player.getWeapons === 'function') return ctx.player.getWeapons();
      return null;
    },

    giveWeapon: function (slot) {
      try {
        var ws = Debug._weapons();
        if (ws && typeof ws.giveWeapon === 'function') ws.giveWeapon(slot, true);
      } catch (e) {
        BS.Log.error('BS.Debug.giveWeapon:', e && e.message ? e.message : e);
      }
    },

    giveAmmo: function (slot, amount) {
      try {
        var ws = Debug._weapons();
        if (!ws) return;
        var added = 0;
        if (typeof ws.addReserve === 'function') added = ws.addReserve(slot, amount);
        if (!added && typeof ws.addAmmoToCurrent === 'function') ws.addAmmoToCurrent(amount);
      } catch (e) {
        BS.Log.error('BS.Debug.giveAmmo:', e && e.message ? e.message : e);
      }
    },

    spawnEnemy: function (type, distance, angleDeg) {
      try {
        var ctx = Debug._ctx();
        if (!ctx || !ctx.enemies || typeof ctx.enemies.spawn !== 'function') return null;
        var ang = (angleDeg || 0) * BS.Math.DEG;
        var pos = new Float32Array(3);
        var eye = null;
        if (ctx.player && typeof ctx.player.eyePosition === 'function') eye = ctx.player.eyePosition(new Float32Array(3));
        else if (BS.Renderer && BS.Renderer.camera && BS.Renderer.camera.pos) eye = BS.Renderer.camera.pos;
        if (!eye) eye = new Float32Array([0, 1, 0]);
        var yaw = (ctx.player ? ctx.player.yaw : 0) + ang;
        var d = (distance === undefined || distance === null) ? 8 : distance;
        pos[0] = eye[0] - Math.sin(yaw) * d;
        pos[1] = eye[1];
        pos[2] = eye[2] - Math.cos(yaw) * d;
        return ctx.enemies.spawn(type || 'drone', pos, { aggro: true });
      } catch (e) {
        BS.Log.error('BS.Debug.spawnEnemy:', e && e.message ? e.message : e);
        return null;
      }
    },

    killAllEnemies: function () {
      try {
        var ctx = Debug._ctx();
        if (!ctx || !ctx.enemies) return;
        var list = ctx.enemies.list || [];
        for (var i = list.length - 1; i >= 0; i--) {
          var e = list[i];
          if (!e || !e.alive) continue;
          if (typeof ctx.enemies.damage === 'function') {
            ctx.enemies.damage(e, 99999, {
              point: e.pos ? e.pos.slice(0, 3) : new Float32Array([0, 0, 0]),
              normal: new Float32Array([0, 1, 0]),
              dir: new Float32Array([0, 0, -1]),
              headshot: true, kind: 'debug', source: null
            });
          } else if (e.pos) {
            e.hp = 0;
            e.alive = false;
          }
        }
      } catch (e) {
        BS.Log.error('BS.Debug.killAllEnemies:', e && e.message ? e.message : e);
      }
    },

    clearEnemies: function () {
      try {
        var ctx = Debug._ctx();
        if (ctx && ctx.enemies && typeof ctx.enemies.clear === 'function') ctx.enemies.clear();
      } catch (e) {
        BS.Log.error('BS.Debug.clearEnemies:', e && e.message ? e.message : e);
      }
    },

    startWave: function (index) {
      try {
        var G = BS.Game;
        if (!G) return;
        if (typeof G.spawnWave === 'function') { G.spawnWave(index); return; }
        if (typeof G.startWave === 'function') { G.startWave(index); return; }
        if (typeof G.setCurrentWave === 'function') G.setCurrentWave(index);
      } catch (e) {
        BS.Log.error('BS.Debug.startWave:', e && e.message ? e.message : e);
      }
    },

    setQuality: function (q) {
      try {
        if (q !== 'low' && q !== 'medium' && q !== 'high') return;
        if (BS.Game && typeof BS.Game.applyQuality === 'function') { BS.Game.applyQuality(q); return; }
        var ctx = Debug._ctx();
        if (ctx) ctx.quality = q;
        if (BS.Renderer && typeof BS.Renderer.setQuality === 'function') BS.Renderer.setQuality(q);
        if (BS.Textures && typeof BS.Textures.setTextureSize === 'function') {
          BS.Textures.setTextureSize(q === 'low' ? 128 : (q === 'medium' ? 256 : 512));
        }
        if (BS.FX && typeof BS.FX.setParticleBudget === 'function') {
          BS.FX.setParticleBudget(q === 'low' ? 250 : (q === 'medium' ? 900 : 2000));
        }
        if (BS.Audio && typeof BS.Audio.setVoiceBudget === 'function') {
          BS.Audio.setVoiceBudget(q === 'low' ? 12 : 24);
        }
      } catch (e) {
        BS.Log.error('BS.Debug.setQuality:', e && e.message ? e.message : e);
      }
    },

    setFpsCap: function (n) {
      Debug.fpsCap = Math.max(0, n | 0);
      try {
        if (BS.Game && typeof BS.Game.setFpsCap === 'function') BS.Game.setFpsCap(Debug.fpsCap);
        if (BS.Util && BS.Util.getDOM && BS.Util.getDOM() && BS.Util.getDOM().root) {
          BS.Util.getDOM().root.setAttribute('data-fps-cap', String(Debug.fpsCap));
        }
      } catch (e) { /* noop */ }
    },

    /**
     * Avanza N frames con dt fijo (1/60) SIN requestAnimationFrame.
     * Delega en el lote C si expone un método de paso; si no, usa frame().
     */
    stepFrames: function (n) {
      var steps = Math.max(0, n | 0);
      if (steps === 0) return;
      var G = BS.Game;
      if (!G) return;
      var i;
      try {
        // 1) API explícita del lote C
        if (typeof G.stepFixed === 'function') {
          for (i = 0; i < steps; i++) { G.stepFixed(1 / 60); Debug._stepCount++; }
          return;
        }
        if (typeof G.updateFixed === 'function') {
          for (i = 0; i < steps; i++) { G.updateFixed(1 / 60); Debug._stepCount++; }
          return;
        }
        if (typeof G.stepN === 'function') { G.stepN(steps); Debug._stepCount += steps; return; }
        // 2) ruta de compatibilidad: frame(nowMs, fixedSteps)
        if (typeof G.frame === 'function') {
          G.frame(null, steps);
          Debug._stepCount += steps;
          return;
        }
      } catch (e) {
        BS.Log.error('BS.Debug.stepFrames:', e && e.message ? e.message : e);
      }
    },

    stepCount: function () { return Debug._stepCount; },

    snapshotHud: function () {
      try {
        var ctx = Debug._ctx();
        if (ctx && ctx.hud) {
          if (typeof ctx.hud.snapshot === 'function') return String(ctx.hud.snapshot());
          if (typeof ctx.hud.getText === 'function') return String(ctx.hud.getText());
        }
        var s = Debug.state();
        return 'ESTADO=' + s.state + ' PV=' + Math.round(s.hp) +
          ' MUN=' + s.ammo + '/' + s.reserve +
          ' ENEMIGOS=' + s.enemiesAlive +
          ' OLEADA=' + s.wave +
          ' POS=' + s.pos.map(function (v) { return v.toFixed(1); }).join(',');
      } catch (e) {
        return 'snapshotHud no disponible: ' + (e && e.message ? e.message : e);
      }
    },

    hideUI: function (on) {
      try {
        var d = BS.Util.getDOM();
        var disp = on ? 'none' : '';
        if (d.hudCanvas) d.hudCanvas.style.display = on ? 'none' : 'block';
        if (d.uiLayer) d.uiLayer.style.display = disp;
        if (overlayEl) overlayEl.style.display = disp;
      } catch (e) { /* noop */ }
    },

    showOverlay: function (text) {
      try {
        if (!overlayEl) {
          overlayEl = document.createElement('div');
          overlayEl.id = 'bs-debug-overlay';
          overlayEl.style.position = 'fixed';
          overlayEl.style.left = '8px';
          overlayEl.style.top = '8px';
          overlayEl.style.maxWidth = '46%';
          overlayEl.style.padding = '8px 10px';
          overlayEl.style.background = 'rgba(0,0,0,0.72)';
          overlayEl.style.color = '#7fe7ff';
          overlayEl.style.font = '12px/1.35 Consolas, "Courier New", monospace';
          overlayEl.style.whiteSpace = 'pre-wrap';
          overlayEl.style.zIndex = '9999';
          overlayEl.style.pointerEvents = 'none';
          overlayEl.style.border = '1px solid rgba(127,231,255,0.35)';
          var parent = document.getElementById('bs-root') || document.body || document.documentElement;
          parent.appendChild(overlayEl);
        }
        overlayEl.textContent = String(text === undefined || text === null ? '' : text);
        overlayEl.style.display = text ? 'block' : 'none';
      } catch (e) { /* noop */ }
    },

    hideOverlay: function () {
      try { if (overlayEl) overlayEl.style.display = 'none'; } catch (e) { /* noop */ }
    },

    /** Texto de diagnóstico en una sola llamada (útil para el tester). */
    report: function () {
      var s = Debug.state();
      var st = Debug.stats();
      var lines = [
        'BLACKSITE debug report',
        'estado=' + s.state + '  hp=' + Math.round(s.hp) + '  municion=' + s.ammo + '/' + s.reserve +
        '  enemigos=' + s.enemiesAlive + '  oleada=' + s.wave,
        'fps=' + st.fps.toFixed(1) + '  frameMs=' + st.frameMs.toFixed(2) +
        '  drawCalls=' + st.drawCalls + '  tris=' + st.tris,
        'calidad=' + st.quality + '  resolutionScale=' + st.resolutionScale +
        '  renderer=' + st.renderer + '  webgl2=' + !!st.isWebGL2,
        'pos=' + s.pos.map(function (v) { return v.toFixed(2); }).join(',') +
        '  yaw=' + s.yaw.toFixed(2) + '  pitch=' + s.pitch.toFixed(2),
        'audio=' + st.audioState + '  voces=' + st.voices + '/' + st.voiceBudget +
        '  particulas=' + st.particles,
        'errores capturados=' + Debug.errors.length
      ];
      for (var i = 0; i < Debug.errors.length && i < 5; i++) {
        lines.push('  ! ' + Debug.errors[i].msg + ' @' + Debug.errors[i].src + ':' + Debug.errors[i].line);
      }
      return lines.join('\n');
    }
  };

  BS.Debug = Debug;

  /* Vacía la cola de tests de módulos que cargan ANTES que este (§2.1):
   * util.js deja ahí sus tests math:* porque BS.Debug aún no existía. */
  if (BS._pendingTests && BS._pendingTests.length) {
    for (var pi = 0; pi < BS._pendingTests.length; pi++) {
      Debug.register(BS._pendingTests[pi][0], BS._pendingTests[pi][1]);
    }
    BS._pendingTests.length = 0;
  }

  /* Auto-test del propio módulo: state() y stats() nunca deben lanzar. */
  Debug.register('debug:noThrow', function () {
    var s = Debug.state();
    var st = Debug.stats();
    var rep = Debug.report();
    return {
      ok: !!s && !!st && typeof rep === 'string' && typeof s.hp === 'number',
      state: s.state, hasStats: !!st
    };
  });

})(window.BS = window.BS || {});
