/* ===========================================================================
 * BLACKSITE: LAST SIGNAL  —  js/entities/player.js
 * ---------------------------------------------------------------------------
 * Propósito : jugador en primera persona. Movimiento estilo FPS (WASD, sprint,
 *             agacharse, salto con coyote-time y buffer), mirada con Pointer
 *             Lock, retroceso de cámara, daño/vida con regeneración, y el
 *             WeaponSystem asociado (BS.Weapons.create).
 * Depende de: js/core/util.js, js/core/input.js, js/core/audio.js,
 *             js/world/physics.js, js/entities/weapons.js
 * Expone    : BS.Player = { create(ctx), CONFIG }
 * Notas     : `pos` es el CENTRO del cuerpo (igual que en BS.Physics).
 *             Altura del ojo = pos.y + altura/2 + eyeOffset.
 *             NO llama a Weapons.update(): eso lo hace BS.Game (bucle §5.2).
 * =========================================================================== */
(function (BS) {
  'use strict';

  var M = BS.Math;

  var CONFIG = {
    walkSpeed: 4.4, sprintSpeed: 7.2, crouchSpeed: 2.1,
    accelGround: 60, accelAir: 9, friction: 11,
    gravity: 22, jumpVelocity: 7.4, coyoteTime: 0.10, jumpBuffer: 0.12,
    stepHeight: 0.45, standHeight: 1.85, crouchHeight: 1.1, radius: 0.34,
    eyeOffset: -0.15,
    sprintFovAdd: 6, fovLerpSpeed: 6,
    bobAmp: 0.045, bobSpeedPerMeter: 2.1, landBobDamp: 12,
    maxFallSafe: 9, fallDamagePerUnit: 6,
    invulnTime: 0.4, regenDelay: 6.5, regenRate: 9,
    maxHealth: 100
  };

  function num(v, d) {
    var n = +v;
    return isFinite(n) ? n : d;
  }

  function create(ctx) {
    ctx = ctx || {};

    /* --- estado --------------------------------------------------------- */
    var pos = new Float32Array(3);
    var vel = new Float32Array(3);
    var spawn = (ctx.level && ctx.level.spawns && ctx.level.spawns.player) || null;
    if (spawn && spawn.pos) {
      pos[0] = num(spawn.pos[0], 0);
      pos[1] = num(spawn.pos[1], CONFIG.standHeight * 0.5);
      pos[2] = num(spawn.pos[2], 0);
    } else {
      pos[0] = 0; pos[1] = CONFIG.standHeight * 0.5; pos[2] = 0;
    }

    var yaw = (spawn && spawn.yaw) ? spawn.yaw : 0;
    var pitch = 0;
    var health = CONFIG.maxHealth;
    var maxHealth = CONFIG.maxHealth;
    var armor = 0;
    var godMode = false;
    var isDead = false;
    var curHeight = CONFIG.standHeight;
    var onGround = false;
    var coyote = 0, jumpBuffer = 0, invuln = 0, regenTimer = 0;
    var bobPhase = 0, bobY = 0, landImpact = 0, rollDeg = 0;
    var lastDamageDir = 0, lastDamageTime = -99;
    var speed = 0, state = 'idle';
    var isSprinting = false;
    var recoilPitch = 0, recoilYaw = 0, camShake = 0;
    var stepAccum = 0;
    var throughTime = 0;
    var _onDeath = null;
    var baseFov = (ctx.settings && num(ctx.settings.fov, 78)) || 78;
    var fovCurrent = baseFov;

    /* --- cuerpo físico (comparte el array `pos`) ------------------------ */
    var body = {
      pos: pos,
      vel: vel,
      radius: CONFIG.radius,
      height: curHeight,
      onGround: false,
      gravityScale: 1,
      stepHeight: CONFIG.stepHeight,
      collideFlags: 0,
      ignoreRamp: false
    };

    /* --- armas ---------------------------------------------------------- */
    var weapons = null;
    try {
      if (BS.Weapons && typeof BS.Weapons.create === 'function') weapons = BS.Weapons.create(ctx);
    } catch (e) {
      weapons = null;
      if (BS.Log && BS.Log.error) BS.Log.error('BS.Player: BS.Weapons.create falló:', e && e.message ? e.message : e);
    }

    /* --- utilidades ---------------------------------------------------- */
    function physics() {
      var ph = ctx.physics || BS.Physics;
      return (ph && typeof ph.moveBox === 'function') ? ph : null;
    }

    function level() { return ctx.level || null; }

    function canStand(h) {
      var ph = ctx.physics || BS.Physics;
      var lv = level();
      if (!ph || typeof ph.fits !== 'function' || !lv) return true;
      var feet = pos[1] - curHeight * 0.5;
      var cy = feet + h * 0.5;
      try {
        return ph.fits(lv, pos[0], cy, pos[2], CONFIG.radius, h);
      } catch (e) { return true; }
    }

    function applyHeight(h) {
      if (Math.abs(h - curHeight) < 1e-4) return;
      var feet = pos[1] - curHeight * 0.5;
      curHeight = h;
      pos[1] = feet + h * 0.5;             /* los pies no se mueven */
      body.height = h;
    }

    function audioPlay(name, opts) {
      var A = ctx.audio || BS.Audio;
      if (A && typeof A.play === 'function') {
        try { A.play(name, opts); } catch (e) { /* noop */ }
      }
    }

    function emit(name, payload) {
      var ev = ctx.events || BS.Events;
      if (ev && typeof ev.emit === 'function') {
        try { ev.emit(name, payload); } catch (e) { /* noop */ }
      }
    }

    function addRecoil(kick, yawKick) {
      kick = num(kick, 0); yawKick = num(yawKick, 0);
      pitch = M.clamp(pitch + kick, -1.5, 1.5);
      yaw += yawKick;
      recoilPitch += kick;
      recoilYaw += yawKick;
    }

    function addCameraShake(amount) {
      var a = num(amount, 0);
      camShake += a;
      if (ctx.fx && typeof ctx.fx.screenShake === 'function') {
        try { ctx.fx.screenShake(a, 0.25); } catch (e) { /* noop */ }
      }
    }

    function applyImpulse(v) {
      if (!v) return;
      vel[0] += num(v[0], 0);
      vel[1] += num(v[1], 0);
      vel[2] += num(v[2], 0);
    }

    function damage(amount, sourcePos, kind) {
      var amt = Math.max(0, num(amount, 0));
      if (godMode || isDead || amt <= 0) {
        return { died: false, hp: health, applied: 0 };
      }
      if (invuln > 0) return { died: false, hp: health, applied: 0 };

      /* el blindaje absorbe la mitad del daño recibido */
      if (armor > 0) {
        var absorb = Math.min(armor, amt * 0.5);
        armor -= absorb;
        amt -= absorb;
      }
      if (amt <= 0) return { died: false, hp: health, applied: 0 };

      health -= amt;
      if (health < 0) health = 0;
      invuln = CONFIG.invulnTime;
      regenTimer = 0;
      lastDamageTime = throughTime;
      if (sourcePos) {
        var dx = sourcePos[0] - pos[0], dz = sourcePos[2] - pos[2];
        if (dx * dx + dz * dz > 1e-6) lastDamageDir = Math.atan2(-dx, -dz);
      }
      addCameraShake(Math.min(1, amt / 25));
      emit('player:damage', { amount: amt, kind: kind || 'unknown', hp: health });
      if (health <= 0) {
        isDead = true;
        state = 'dead';
        vel[0] = vel[1] = vel[2] = 0;
        emit('player:died', { pos: [pos[0], pos[1], pos[2]] });
        if (typeof _onDeath === 'function') {
          try { _onDeath(); } catch (e2) { /* noop */ }
        }
      }
      return { died: health <= 0, hp: health, applied: amt };
    }

    function heal(amount) {
      var a = Math.max(0, num(amount, 0));
      if (isDead) return 0;
      var before = health;
      health = Math.min(maxHealth, health + a);
      return health - before;
    }

    function respawn(p, y2) {
      if (p) { pos[0] = num(p[0], pos[0]); pos[1] = num(p[1], pos[1]); pos[2] = num(p[2], pos[2]); }
      yaw = (y2 === undefined || y2 === null) ? yaw : num(y2, yaw);
      pitch = 0;
      vel[0] = vel[1] = vel[2] = 0;
      health = maxHealth;
      armor = 0;
      isDead = false;
      state = 'idle';
      onGround = false;
      body.onGround = false;
      curHeight = CONFIG.standHeight;
      body.height = curHeight;
      invuln = CONFIG.invulnTime;
      regenTimer = 0;
      landImpact = 0;
      recoilPitch = 0; recoilYaw = 0; camShake = 0;
      invuln = CONFIG.invulnTime;
    }

    function eyeHeightH() { return curHeight * 0.5 + CONFIG.eyeOffset; }

    function eyePosition(out) {
      out = out || new Float32Array(3);
      out[0] = pos[0];
      out[1] = pos[1] + eyeHeightH() + bobY - landImpact * 0.10;
      out[2] = pos[2];
      return out;
    }

    function forwardDir(out) {
      return M.v3fromYawPitch(out || new Float32Array(3), yaw, pitch);
    }

    /* --- entrada de armas ---------------------------------------------- */
    function handleWeaponInput() {
      if (!weapons) return;
      var I = BS.Input;
      if (!I) return;
      try {
        if (typeof I.wasPressed === 'function') {
          if (I.wasPressed('KeyR') && typeof weapons.reload === 'function') weapons.reload();
          if (I.wasPressed('Digit1') && typeof weapons.switchTo === 'function') weapons.switchTo(1);
          if (I.wasPressed('Digit2') && typeof weapons.switchTo === 'function') weapons.switchTo(2);
          if (I.wasPressed('Digit3') && typeof weapons.switchTo === 'function') weapons.switchTo(3);
        }
        if (typeof I.consumeWheel === 'function') {
          var w = I.consumeWheel();
          if (w > 0 && typeof weapons.nextWeapon === 'function') weapons.nextWeapon();
          else if (w < 0 && typeof weapons.prevWeapon === 'function') weapons.prevWeapon();
        }
        var held = (typeof I.mouseDown === 'function') ? !!I.mouseDown(0) : false;
        var pressed = (typeof I.mousePressed === 'function') ? !!I.mousePressed(0) : false;
        if (typeof weapons.tryFire === 'function') weapons.tryFire(held, pressed);
      } catch (e) {
        if (BS.Log && BS.Log.error) BS.Log.error('BS.Player: entrada de armas:', e && e.message ? e.message : e);
      }
    }

    /* --- update --------------------------------------------------------- */
    function update(dt) {
      dt = num(dt, 1 / 60);
      if (dt <= 0) return;
      throughTime += dt;

      var I = BS.Input;
      var sens = (I && typeof I.getSensitivity === 'function') ? num(I.getSensitivity(), 0.0022) : 0.0022;
      var invert = (I && typeof I.getInvertY === 'function') ? !!I.getInvertY() : false;

      /* mirar */
      if (I && typeof I.consumeMouseDelta === 'function') {
        var md = I.consumeMouseDelta();
        yaw -= num(md.dx, 0) * sens;
        pitch = M.clamp(pitch - num(md.dy, 0) * sens * (invert ? -1 : 1), -1.5, 1.5);
      }

      /* recuperación del retroceso */
      if (recoilPitch !== 0 || recoilYaw !== 0) {
        var rec = Math.min(1, 8 * dt);
        var dp = recoilPitch * rec, dy2 = recoilYaw * rec;
        pitch = M.clamp(pitch - dp, -1.5, 1.5);
        yaw -= dy2;
        recoilPitch -= dp;
        recoilYaw -= dy2;
        if (Math.abs(recoilPitch) < 1e-4) recoilPitch = 0;
        if (Math.abs(recoilYaw) < 1e-4) recoilYaw = 0;
      }
      if (camShake > 0) camShake = Math.max(0, camShake - dt * 2.5);

      /* temporizadores */
      if (invuln > 0) invuln = Math.max(0, invuln - dt);
      regenTimer += dt;
      if (!isDead && health < maxHealth && regenTimer > CONFIG.regenDelay) {
        health = Math.min(maxHealth, health + CONFIG.regenRate * dt);
      }
      landImpact = landImpact * Math.exp(-CONFIG.landBobDamp * dt);
      if (landImpact < 1e-3) landImpact = 0;

      /* entrada de movimiento */
      var fwd = 0, side = 0, wantJump = false, crouchKey = false, sprintKey = false;
      if (I) {
        if (I.isDown('KeyW')) fwd += 1;
        if (I.isDown('KeyS')) fwd -= 1;
        if (I.isDown('KeyA')) side -= 1;
        if (I.isDown('KeyD')) side += 1;
        crouchKey = !!(I.isDown('ControlLeft') || I.isDown('KeyC'));
        sprintKey = !!I.isDown('ShiftLeft');
        wantJump = (typeof I.wasPressed === 'function') ? I.wasPressed('Space') : false;
        if (I.isDown('Space')) wantJump = true;
      }

      if (isDead) {
        state = 'dead';
        speed = 0;
        body.onGround = onGround;
        handleWeaponInput();
        applyFov(dt);
        return;
      }

      /* agacharse / levantarse (con comprobación de techo) */
      var crouching = crouchKey;
      if (!crouching && curHeight < CONFIG.standHeight) {
        if (!canStand(CONFIG.standHeight)) crouching = true;
      }
      if (crouching && curHeight > CONFIG.crouchHeight) applyHeight(CONFIG.crouchHeight);
      else if (!crouching && curHeight < CONFIG.standHeight) applyHeight(CONFIG.standHeight);
      var wasCrouch = isSprinting || state === 'crouch';
      isSprinting = !!(sprintKey && fwd > 0 && !crouching);
      if (crouching && !wasCrouch && onGround) audioPlay('crouch');

      /* dirección deseada */
      var maxSpeed = crouching ? CONFIG.crouchSpeed : (isSprinting ? CONFIG.sprintSpeed : CONFIG.walkSpeed);
      var sinY = Math.sin(yaw), cosY = Math.cos(yaw);
      var wx = 0, wz = 0;
      var hasInput = (fwd !== 0 || side !== 0);
      if (hasInput) {
        wx = (-sinY * fwd + cosY * side);
        wz = (-cosY * fwd - sinY * side);
        var len = Math.sqrt(wx * wx + wz * wz) || 1;
        wx = wx / len; wz = wz / len;
      }

      var accel = onGround ? CONFIG.accelGround : CONFIG.accelAir;
      if (hasInput) {
        var tx = wx * maxSpeed, tz = wz * maxSpeed;
        var k = accel * dt;
        vel[0] += M.clamp(tx - vel[0], -k, k);
        vel[2] += M.clamp(tz - vel[2], -k, k);
      } else if (onGround) {
        var sp = Math.sqrt(vel[0] * vel[0] + vel[2] * vel[2]);
        if (sp > 1e-4) {
          var ns = Math.max(0, sp - CONFIG.friction * dt);
          vel[0] *= ns / sp; vel[2] *= ns / sp;
        } else { vel[0] = 0; vel[2] = 0; }
      }

      /* salto con coyote-time + buffer */
      if (wantJump) jumpBuffer = CONFIG.jumpBuffer;
      else jumpBuffer = Math.max(0, jumpBuffer - dt);
      if (onGround) coyote = CONFIG.coyoteTime;
      else coyote = Math.max(0, coyote - dt);
      if (jumpBuffer > 0 && coyote > 0) {
        vel[1] = CONFIG.jumpVelocity;
        jumpBuffer = 0;
        coyote = 0;
        onGround = false;
        landImpact = 0;
        audioPlay('jump');
      }

      /* gravedad */
      vel[1] -= CONFIG.gravity * dt;
      if (vel[1] < -45) vel[1] = -45;

      /* desplazamiento físico */
      var vyBefore = vel[1];
      var ph = physics();
      var lv = level();
      var res = null;
      var d = new Float32Array(3);
      d[0] = vel[0] * dt; d[1] = vel[1] * dt; d[2] = vel[2] * dt;

      if (ph && lv) {
        try {
          res = ph.moveBox(lv, body, d, { gravity: 0, stepHeight: CONFIG.stepHeight });
        } catch (e3) {
          res = null;
          if (BS.Log && BS.Log.error) BS.Log.error('BS.Player.moveBox:', e3 && e3.message ? e3.message : e3);
        }
      }
      if (!res) {
        /* sin física: integración mínima y suelo del nivel */
        pos[0] += d[0]; pos[1] += d[1]; pos[2] += d[2];
        var g = -Infinity;
        if (lv && typeof lv.groundHeightAt === 'function') g = lv.groundHeightAt(pos[0], pos[2], pos[1] + 1, 6);
        var feet = pos[1] - curHeight * 0.5;
        if (isFinite(g) && feet <= g + 0.02) {
          pos[1] = g + curHeight * 0.5;
          if (vel[1] < 0) vel[1] = 0;
          onGround = true;
        } else {
          onGround = false;
        }
      } else {
        onGround = !!res.onGround;
        if (res.onGround && vel[1] < 0) vel[1] = 0;
        if (res.hitCeiling && vel[1] > 0) vel[1] = 0;
        if (res.wallHit) {
          if (res.wallNormal[0]) vel[0] = 0;
          if (res.wallNormal[2]) vel[2] = 0;
        }
        if (res.landed) {
          var impact = -vyBefore;
          if (impact > CONFIG.maxFallSafe) {
            damage((impact - CONFIG.maxFallSafe) * CONFIG.fallDamagePerUnit, null, 'fall');
          }
          landImpact = Math.min(1, Math.max(0, impact / 14));
          audioPlay('land', { pos: [pos[0], pos[1], pos[2]] });
        }
      }
      body.onGround = onGround;

      /* velocidad horizontal y pasos */
      speed = Math.sqrt(vel[0] * vel[0] + vel[2] * vel[2]);
      if (onGround && speed > 0.4) {
        stepAccum += speed * dt;
        if (stepAccum > 2.2) {
          stepAccum = 0;
          audioPlay('footstep', { pos: [pos[0], pos[1], pos[2]] });
          emit('noise', { pos: [pos[0], pos[1], pos[2]], radius: 9, tag: 'footstep' });
        }
      } else if (!onGround) {
        stepAccum = 0;
      }

      /* cabeceo */
      bobPhase += speed * CONFIG.bobSpeedPerMeter * dt;
      if (bobPhase > Math.PI * 2000) bobPhase -= Math.PI * 2000;
      bobY = onGround ? Math.sin(bobPhase) * CONFIG.bobAmp * Math.min(1, speed / CONFIG.walkSpeed) : 0;

      /* inclinación al desplazarse de lado */
      var rollTarget = (side !== 0 && onGround) ? (side > 0 ? -2.6 : 2.6) : 0;
      rollDeg = M.damp(rollDeg, rollTarget, 8, dt);

      /* estado */
      if (isDead) state = 'dead';
      else if (!onGround) state = (vel[1] > 0.6) ? 'jump' : 'fall';
      else if (crouching) state = 'crouch';
      else if (speed > CONFIG.sprintSpeed * 0.85) state = 'sprint';
      else if (speed > 0.3) state = 'walk';
      else state = 'idle';

      handleWeaponInput();
      applyFov(dt);
    }

    function applyFov(dt) {
      var target = baseFov + ((isSprinting && speed > CONFIG.walkSpeed * 0.9) ? CONFIG.sprintFovAdd : 0);
      fovCurrent = M.damp(fovCurrent, target, CONFIG.fovLerpSpeed, dt);
      var R = ctx.renderer;
      if (R && typeof R.setFov === 'function') {
        try { R.setFov(fovCurrent); } catch (e) { /* noop */ }
      }
    }

    /* --- objeto público -------------------------------------------------- */
    var player = {
      pos: pos,
      vel: vel,
      yaw: yaw,
      pitch: pitch,
      health: health,
      maxHealth: maxHealth,
      armor: armor,
      state: state,
      isDead: isDead,
      isGrounded: onGround,
      isSprinting: isSprinting,
      isCrouching: false,
      bobPhase: bobPhase,
      landImpact: landImpact,
      rollDeg: rollDeg,
      lastDamageDir: lastDamageDir,
      lastDamageTime: lastDamageTime,
      godMode: godMode,
      speed: speed,
      body: body,
      weapons: weapons,
      CONFIG: CONFIG,

      update: update,
      eyePosition: eyePosition,
      eyeHeight: eyeHeightH,
      forward: forwardDir,
      damage: damage,
      heal: heal,
      setHealth: function (hp) {
        health = M.clamp(num(hp, 0), 0, maxHealth);
        isDead = health <= 0;
        if (isDead) state = 'dead';
      },
      respawn: respawn,
      addRecoil: addRecoil,
      addCameraShake: addCameraShake,
      applyImpulse: applyImpulse,
      getWeapons: function () { return weapons; },
      onDeath: function (cb) { _onDeath = (typeof cb === 'function') ? cb : null; },

      dispose: function () {
        if (weapons && typeof weapons.dispose === 'function') {
          try { weapons.dispose(); } catch (e) { /* noop */ }
        }
      }
    };

    /* sincroniza los campos sueltos con el estado interno tras cada update */
    var baseUpdate = player.update;
    player.update = function (dt) {
      baseUpdate(dt);
      player.yaw = yaw;
      player.pitch = pitch;
      player.health = health;
      player.maxHealth = maxHealth;
      player.armor = armor;
      player.state = state;
      player.isDead = isDead;
      player.isGrounded = onGround;
      player.isSprinting = isSprinting;
      player.isCrouching = curHeight < CONFIG.standHeight - 1e-4;
      player.bobPhase = bobPhase;
      player.landImpact = landImpact;
      player.rollDeg = rollDeg;
      player.lastDamageDir = lastDamageDir;
      player.lastDamageTime = lastDamageTime;
      player.godMode = godMode;
      player.speed = speed;
    };

    /* `godMode` es una propiedad simple: se refleja con un getter/setter */
    try {
      Object.defineProperty(player, 'godMode', {
        enumerable: true,
        get: function () { return godMode; },
        set: function (v) { godMode = !!v; }
      });
      Object.defineProperty(player, 'yaw', {
        enumerable: true,
        get: function () { return yaw; },
        set: function (v) { yaw = num(v, yaw); }
      });
      Object.defineProperty(player, 'pitch', {
        enumerable: true,
        get: function () { return pitch; },
        set: function (v) { pitch = M.clamp(num(v, pitch), -1.5, 1.5); }
      });
      Object.defineProperty(player, 'health', {
        enumerable: true,
        get: function () { return health; },
        set: function (v) { health = M.clamp(num(v, health), 0, maxHealth); }
      });
      Object.defineProperty(player, 'isDead', {
        enumerable: true,
        get: function () { return isDead; },
        set: function (v) { isDead = !!v; }
      });
      Object.defineProperty(player, 'bobPhase', {
        enumerable: true,
        get: function () { return bobPhase; },
        set: function (v) { bobPhase = num(v, bobPhase); }
      });
    } catch (e4) {
      if (BS.Log && BS.Log.warn) BS.Log.warn('BS.Player: defineProperty no disponible');
    }

    player.fov = function () { return fovCurrent; };
    player.setBaseFov = function (f) { baseFov = num(f, baseFov); };

    return player;
  }

  BS.Player = { create: create, CONFIG: CONFIG };

  /* ======================================================================
   * Test: recorrido del nivel real (§4.2) — el nivel debe ser transitable
   * ----------------------------------------------------------------------
   * Usa BS.Level.testLevel() (en caché, sin horno). Recorre `route` con
   * muestreo fino y comprueba: suelo finito, altura ~declarada, peldaños
   * razonables y espacio libre sobre la cabeza.
   * ==================================================================== */
  if (BS.Debug && typeof BS.Debug.register === 'function') {
    BS.Debug.register('player:reachability', function () {
      if (!BS.Level || typeof BS.Level.testLevel !== 'function') {
        return { ok: false, error: 'BS.Level no disponible' };
      }
      var lv = BS.Level.testLevel();
      var route = (lv && lv.route) || [];
      if (route.length < 2) return { ok: false, error: 'ruta vacía' };

      var problems = [];
      var samples = 0;
      var maxStep = 0;
      var lastGround = null;
      var maxGroundErr = 0;
      var headroomFails = 0;

      for (var i = 0; i < route.length - 1; i++) {
        var a = route[i], b = route[i + 1];
        var ax = num(a[0], 0), ay = num(a[1], 0), az = num(a[2], 0);
        var bx = num(b[0], 0), by = num(b[1], 0), bz = num(b[2], 0);
        var dx = bx - ax, dy = by - ay, dz = bz - az;
        var segLen = Math.sqrt(dx * dx + dy * dy + dz * dz);
        var steps = Math.max(1, Math.ceil(segLen / 0.4));
        for (var s = 0; s <= steps; s++) {
          var t = s / steps;
          var x = ax + dx * t, y = ay + dy * t, z = az + dz * t;
          samples++;

          var gi = lv.groundInfoAt(x, z, y + 1.4, 4);
          var gy = gi ? gi.y : -Infinity;
          if (!isFinite(gy)) {
            problems.push('sin suelo en [' + x.toFixed(1) + ',' + z.toFixed(1) + ']');
            if (problems.length > 12) { i = route.length; break; }
            continue;
          }
          var err = Math.abs(gy - y);
          if (err > maxGroundErr) maxGroundErr = err;
          if (err > 0.5) {
            problems.push('suelo ' + gy.toFixed(2) + ' != ruta ' + y.toFixed(2) +
              ' en [' + x.toFixed(1) + ',' + z.toFixed(1) + ']');
            if (problems.length > 12) { i = route.length; break; }
          }
          if (lastGround !== null) {
            var step = gy - lastGround;
            if (step > maxStep) maxStep = step;
            if (step > CONFIG.stepHeight + 0.05) {
              problems.push('escalón de ' + step.toFixed(2) + ' m en [' +
                x.toFixed(1) + ',' + z.toFixed(1) + ']');
              if (problems.length > 12) { i = route.length; break; }
            }
          }
          lastGround = gy;

          /* espacio libre: el cuerpo no debe solapar geometría sólida */
          var min = [x - 0.2, gy + 0.7, z - 0.2];
          var max = [x + 0.2, gy + CONFIG.standHeight - 0.05, z + 0.2];
          var blocked = false;
          try { blocked = lv.overlaps(min, max, true); } catch (e) { blocked = false; }
          if (blocked) {
            headroomFails++;
            if (headroomFails <= 4) {
              problems.push('sin espacio libre en [' + x.toFixed(1) + ',' + z.toFixed(1) + ']');
            }
          }
        }
      }

      var last = route[route.length - 1];
      return {
        ok: problems.length === 0,
        samples: samples,
        problems: problems.slice(0, 12),
        problemCount: problems.length,
        maxGroundError: +maxGroundErr.toFixed(3),
        maxStepUp: +maxStep.toFixed(3),
        stepLimit: CONFIG.stepHeight + 0.05,
        headroomFails: headroomFails,
        endPoint: last ? [+num(last[0], 0).toFixed(1), +num(last[1], 0).toFixed(1), +num(last[2], 0).toFixed(1)] : null,
        routePoints: route.length
      };
    });
  }
})(window.BS = window.BS || {});
