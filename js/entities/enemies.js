/* ===========================================================================
 * BLACKSITE: LAST SIGNAL  —  js/entities/enemies.js
 * ---------------------------------------------------------------------------
 * Propósito : los tres enemigos de la instalación K-7 (drone VIGÍA-7, stalker
 *             SIGILO-9 y brute EJECUTOR-3) con su geometría procedural, su
 *             máquina de estados completa (idle/patrol/alert/chase/attack/
 *             search/stagger/dead), percepción por visión en cono con LOS y
 *             por oído (evento 'noise'), persecución con anti-atasco, ataques
 *             (proyectil de plasma, garra y slam con onda) y escalado por
 *             oleada. Expone también el raycast de disparos y el reparto de
 *             daño (punto débil incluido) que consume `ctx.combat`.
 * Reglas    : §3.0 (IIFE + solo window.BS), §3.17 exacto, sin normal maps
 *             (normalMap = null, uNormalStrength = 0), 1 mesh por tipo (1 draw
 *             call por enemigo, §7.4.3) con el brillo hecho por máscara
 *             emisiva (aColor.a) en un material clonado con `emissive` no nulo.
 * Depende de: js/core/util.js (BS.Math, BS.Util, BS.Events, BS.Log),
 *             js/core/textures.js (BS.Textures.getMaterial), js/render/mesh.js
 *             (BS.Mesh). El resto de ctx.* se usa SOLO en update()/render(),
 *             siempre con guardas (el LOTE B puede no existir aún).
 * Expone    : BS.Enemies
 * =========================================================================== */
(function (BS) {
  'use strict';

  var M = BS.Math;

  /* ======================================================================
   * Números de configuración (§8: fuera del bucle)
   * ==================================================================== */
  var CONFIG = {
    MAX_DT: 1 / 30,              // tope defensivo por paso (R19)
    DEATH_LINGER: 1.2,           // colapso/parpadeo antes de desaparecer
    FLASH_TIME: 0.12,            // destello al recibir daño
    STAGGER_TIME: 0.12,          // interrupción por daño de umbral
    ALERT_TIME: 0.4,             // "gruñido" antes de perseguir
    SEARCH_TIME: 4.0,            // rastreo tras perder de vista
    LOSE_SIGHT_TIME: 3.5,        // tiempo sin ver al objetivo antes de search
    STUCK_WINDOW: 0.5,           // ventana de medida del atasco (s)
    STUCK_MIN_MOVE: 0.15,        // desplazamiento mínimo en la ventana (m)
    AVOID_TIME: 0.9,             // desvío lateral al detectar atasco (s)
    MAX_AVOID_ATTEMPTS: 2,       // tras N intentos -> search + reposición
    MAX_SPEED: 12,               // tope duro de velocidad (R19)
    FOG_CULL: 92,                // distancia a la que ya no se dibuja
    TURN_RATE: 6.5,              // rad/s de giro hacia el objetivo
    TURN_RATE_ATTACK: 11,        // giro más rápido al atacar
    DRONE_ORBIT: [6, 10],        // radio de órbita del drone
    DRONE_RETREAT: 4.0,          // distancia a la que el drone se retira
    DRONE_ACCEL: 10,
    DRONE_DAMP: 5.5,
    DRONE_HOVER_SINE: 0.16,      // amplitud del vaivén vertical
    DRONE_HOVER_FREQ: 1.6,
    GROUND_ACCEL: 26,
    SEPARATION_ITERATIONS: 2,
    GROUND_SNAP: 0.6,            // red de seguridad contra level.groundHeightAt
    WAVE_HP: 0.06,               // hp *= 1 + 0.06*(w-1)
    WAVE_DAMAGE: 0.04,           // damageMul = 1 + 0.04*(w-1)
    WAVE_SPEED: 0.03,            // speed *= 1 + 0.03*(w-1)
    WAVE_CD: 0.05,               // attackCooldown *= 1 - 0.05*(w-1)
    HARD_HP_MUL: 1.30,           // dificultad 'hard' -> +30 % de vida
    PRIME_HP: 3.2,               // jefe: hpMul por defecto
    PRIME_SCALE: 1.22,
    HEADSHOT_WEAPON_MUL: 1.8     // headshotMul del arma canónica (§3.14)
  };

  /* ======================================================================
   * Definición de los 3 tipos (§3.17). `centerY` = altura del centro sobre
   * el suelo al aparecer (alineado con §4.1).
   * ==================================================================== */
  var DEFS = {
    drone: {
      id: 'drone', name: 'VIGÍA-7', meshId: 'mesh_enemy_drone',
      hp: 40, radius: 0.45, height: 0.6, headY: 0.02, centerY: 1.9,
      speed: 2.8, strafeSpeed: 3.4, hover: true, gravity: 0,
      sight: 28, coneDeg: 110, hearing: 14,
      attack: {
        kind: 'projectile', damage: 18, speed: 24, homing: 0.5,
        cooldown: 1.8, range: 26, life: 4.0, radius: 0.30, lightRadius: 4
      },
      weakMul: 2.0, weak: 'core', staggerMin: 8, damageMul: 1,
      tint: [0.78, 0.86, 0.95], emissive: [0.45, 0.95, 1.0], emissiveIntensity: 1.6,
      materialId: 'mat_drone_chassis', scale: 1
    },
    stalker: {
      id: 'stalker', name: 'SIGILO-9', meshId: 'mesh_enemy_stalker',
      hp: 55, radius: 0.4, height: 1.1, headY: 0.24, centerY: 0.6,
      speed: 5.6, dashSpeed: 9.0, hover: false, gravity: 22,
      sight: 20, coneDeg: 80, hearing: 20,
      attack: {
        kind: 'melee', damage: 22, range: 2.0, cooldown: 1.1,
        windup: 0.16, lunge: 3.4, flankDeg: 35
      },
      weakMul: 2.2, weak: 'head', staggerMin: 12, damageMul: 1,
      tint: [0.86, 0.74, 0.62], emissive: [1.0, 0.50, 0.18], emissiveIntensity: 1.8,
      materialId: 'mat_enemy_shell', scale: 1
    },
    brute: {
      id: 'brute', name: 'EJECUTOR-3', meshId: 'mesh_enemy_brute',
      hp: 220, radius: 0.7, height: 2.3, headY: 0.42, centerY: 1.2,
      speed: 2.3, hover: false, gravity: 22,
      sight: 26, coneDeg: 60, hearing: 24,
      attack: {
        kind: 'slam', damage: 34, range: 2.6, cooldown: 2.6,
        windup: 0.34, waveRadius: 3.5, waveDamage: 18
      },
      weakMul: 2.5, weak: 'radiator', staggerMin: 999, damageMul: 1,
      tint: [0.70, 0.73, 0.79], emissive: [1.0, 0.28, 0.14], emissiveIntensity: 1.7,
      materialId: 'mat_enemy_armor', scale: 1
    }
  };

  var TYPES = { drone: DEFS.drone, stalker: DEFS.stalker, brute: DEFS.brute };
  var TYPE_KEYS = ['drone', 'stalker', 'brute'];

  /* ======================================================================
   * Estado interno del módulo
   * ==================================================================== */
  var S = {
    ctx: null,
    list: [],
    meshes: { drone: null, stalker: null, brute: null },
    materials: { drone: null, stalker: null, brute: null },
    localAabb: { drone: null, stalker: null, brute: null },
    nextId: 1,
    rng: null,
    built: false,
    noiseSub: -1,
    spawned: 0,
    killed: 0
  };

  /* Scratch reutilizado (cero `new` en el hot path, R20) */
  var sc = {
    v: new Float32Array(3),
    v2: new Float32Array(3),
    v3: new Float32Array(3),
    eye: new Float32Array(3),
    toP: new Float32Array(3),
    fwd: new Float32Array(3),
    model: null,
    aabb: null,
    bodies: []
  };

  /* ======================================================================
   * Utilidades internas
   * ==================================================================== */
  function rand() { return S.rng ? S.rng() : Math.random(); }
  function rnd(a, b) { return a + rand() * (b - a); }
  function pick(arr) { return arr[(rand() * arr.length) | 0] || arr[0]; }

  function clampDt(dt) {
    dt = Number(dt) || 0;
    if (dt < 0) dt = 0;
    if (dt > CONFIG.MAX_DT) dt = CONFIG.MAX_DT;
    return dt;
  }

  function ctxOf(c) { return c || S.ctx || null; }

  function vec3(x, y, z) { return new Float32Array([x || 0, y || 0, z || 0]); }

  function aabbOf(e, out) {
    var r = e.radius;
    var hy = e.height * 0.5;
    out = out || e.aabb;
    out.min[0] = e.pos[0] - r; out.min[1] = e.pos[1] - hy; out.min[2] = e.pos[2] - r;
    out.max[0] = e.pos[0] + r; out.max[1] = e.pos[1] + hy; out.max[2] = e.pos[2] + r;
    return out;
  }

  function distSqTo(e, p) {
    var dx = e.pos[0] - p[0], dy = e.pos[1] - p[1], dz = e.pos[2] - p[2];
    return dx * dx + dy * dy + dz * dz;
  }

  function distTo(e, p) { return Math.sqrt(distSqTo(e, p)); }

  /** Suelo bajo el enemigo, con red de seguridad si el nivel no responde. */
  function groundBelow(c, x, z, fromY) {
    var lvl = c && c.level;
    if (lvl && typeof lvl.groundHeightAt === 'function') {
      var g = lvl.groundHeightAt(x, z, fromY, fromY + 40);
      if (isFinite(g)) return g;
    }
    return 0;
  }

  function playerTarget(c) {
    if (!c) return null;
    return c.player || null;
  }

  function playerEye(c, out) {
    var p = playerTarget(c);
    if (!p) return null;
    if (typeof p.eyePosition === 'function') return p.eyePosition(out || vec3(0, 0, 0));
    if (p.pos) { out = out || vec3(0, 0, 0); out[0] = p.pos[0]; out[1] = p.pos[1]; out[2] = p.pos[2]; return out; }
    return null;
  }

  function isPlayerAlive(c) {
    var p = playerTarget(c);
    if (!p) return false;
    if (p.isDead === true) return false;
    if (typeof p.health === 'number' && p.health <= 0) return false;
    return true;
  }

  function emitSound(c, name, pos, opts) {
    if (!c || !c.audio || typeof c.audio.play !== 'function') return;
    try {
      var o = opts ? { pos: pos } : { pos: pos };
      c.audio.play(name, o);
    } catch (e) { /* nunca rompe el juego por audio */ }
  }

  function emit(c, name, payload) {
    if (c && c.events && typeof c.events.emit === 'function') {
      try { c.events.emit(name, payload); } catch (e) { /* noop */ }
    }
  }

  /* ======================================================================
   * Geometría procedural (1 mesh por tipo). El brillo (ojo/núcleo/radiador)
   * se marca con `b.emissive = 1` para escribir aColor.a y lo enciende el
   * material del tipo: 0 draw calls extra (§7.4.3).
   * ==================================================================== */

  /** drone VIGÍA-7: huevo blindado flotante con núcleo-lente frontal. */
  function buildDroneMesh() {
    var b = BS.Mesh.create();

    // casco principal (esfera achatada)
    b.color = [0.66, 0.74, 0.86];
    b.emissive = 0;
    b.sphere([0, 0, 0], 0.28, 12, 8);

    // blindaje superior + quilla
    b.color = [0.56, 0.64, 0.76];
    b.box([0, 0.15, 0.02], [0.46, 0.12, 0.58], [2, 2]);
    b.box([0, -0.20, 0.02], [0.22, 0.14, 0.34], [2, 2]);

    // aletas laterales (montajes de propulsión)
    b.box([-0.33, 0.0, 0.06], [0.20, 0.09, 0.40], [2, 2], 0.30);
    b.box([0.33, 0.0, 0.06], [0.20, 0.09, 0.40], [2, 2], -0.30);
    b.box([-0.33, -0.10, 0.06], [0.10, 0.16, 0.24], [2, 2], 0.30);
    b.box([0.33, -0.10, 0.06], [0.10, 0.16, 0.24], [2, 2], -0.30);

    // soporte del sensor
    b.color = [0.42, 0.48, 0.56];
    b.cylinder([0, -0.26, -0.10], 0.07, 0.20, 8, 'y', true);

    // núcleo-lente (punto débil, emisivo)
    b.color = [1, 1, 1];
    b.emissive = 1;
    b.sphere([0, 0.0, -0.24], 0.115, 10, 6);
    b.box([0, 0.0, -0.30], [0.16, 0.10, 0.06], [2, 2]);
    b.emissive = 0;

    return b;
  }

  /** stalker SIGILO-9: cuadrúpedo rastrero con mandíbulas y ojos emisivos. */
  function buildStalkerMesh() {
    var b = BS.Mesh.create();
    b.emissive = 0;

    // cuerpo bajo y alargado (centro del AABB = y 0; pies en -0.55)
    b.color = [0.62, 0.55, 0.50];
    b.box([0, -0.05, 0.06], [0.44, 0.32, 0.84], [2, 2]);
    // placa dorsal
    b.color = [0.50, 0.44, 0.40];
    b.box([0, 0.12, 0.10], [0.34, 0.10, 0.62], [2, 2]);

    // cuello y cabeza adelantada
    b.box([0, 0.02, -0.40], [0.20, 0.16, 0.22], [2, 2]);
    b.color = [0.66, 0.58, 0.52];
    b.box([0, 0.02, -0.56], [0.30, 0.24, 0.30], [2, 2]);

    // mandíbulas
    b.color = [0.46, 0.40, 0.36];
    b.box([-0.10, -0.04, -0.74], [0.07, 0.08, 0.26], [2, 2]);
    b.box([0.10, -0.04, -0.74], [0.07, 0.08, 0.26], [2, 2]);
    b.box([-0.14, -0.10, -0.60], [0.06, 0.06, 0.20], [2, 2], 0.5);
    b.box([0.14, -0.10, -0.60], [0.06, 0.06, 0.20], [2, 2], -0.5);

    // 4 patas articuladas (fémur + tibia)
    var legX = 0.26, fz = [0.30, -0.26], i;
    b.color = [0.42, 0.38, 0.35];
    for (i = 0; i < 2; i++) {
      var lz = fz[i];
      // lado izquierdo
      b.box([-legX, -0.24, lz], [0.09, 0.26, 0.10], [2, 2], 0.35);
      b.box([-legX - 0.05, -0.44, lz + 0.05], [0.08, 0.24, 0.09], [2, 2], -0.3);
      // lado derecho
      b.box([legX, -0.24, lz], [0.09, 0.26, 0.10], [2, 2], -0.35);
      b.box([legX + 0.05, -0.44, lz + 0.05], [0.08, 0.24, 0.09], [2, 2], 0.3);
    }

    // ojos emisivos (punto débil: cabeza)
    b.color = [1, 1, 1];
    b.emissive = 1;
    b.box([-0.09, 0.08, -0.70], [0.07, 0.05, 0.05], [2, 2]);
    b.box([0.09, 0.08, -0.70], [0.07, 0.05, 0.05], [2, 2]);
    b.emissive = 0;

    return b;
  }

  /** brute EJECUTOR-3: coloso bípedo con brazos pesados y radiador dorsal. */
  function buildBruteMesh() {
    var b = BS.Mesh.create();
    b.emissive = 0;

    // piernas (de -1.15 a -0.15)
    b.color = [0.54, 0.56, 0.62];
    b.box([-0.28, -0.65, 0], [0.30, 1.00, 0.36], [2, 2]);
    b.box([0.28, -0.65, 0], [0.30, 1.00, 0.36], [2, 2]);
    b.box([-0.28, -1.08, -0.04], [0.34, 0.16, 0.48], [2, 2]);
    b.box([0.28, -1.08, -0.04], [0.34, 0.16, 0.48], [2, 2]);

    // torso ancho (de -0.15 a 0.85)
    b.color = [0.62, 0.64, 0.70];
    b.box([0, 0.34, 0], [0.98, 1.02, 0.68], [2, 2]);
    // peto frontal
    b.color = [0.50, 0.52, 0.58];
    b.box([0, 0.36, -0.36], [0.78, 0.80, 0.10], [2, 2]);
    // hombreras
    b.box([-0.64, 0.72, 0], [0.34, 0.32, 0.52], [2, 2]);
    b.box([0.64, 0.72, 0], [0.34, 0.32, 0.52], [2, 2]);

    // brazos pesados (cuelgan hasta -0.35)
    b.color = [0.56, 0.58, 0.64];
    b.box([-0.70, 0.18, 0.02], [0.28, 0.90, 0.30], [2, 2]);
    b.box([0.70, 0.18, 0.02], [0.28, 0.90, 0.30], [2, 2]);
    b.color = [0.46, 0.48, 0.54];
    b.box([-0.70, -0.36, 0.02], [0.34, 0.30, 0.36], [2, 2]);
    b.box([0.70, -0.36, 0.02], [0.34, 0.30, 0.36], [2, 2]);

    // cabeza
    b.color = [0.60, 0.62, 0.68];
    b.box([0, 0.98, -0.02], [0.36, 0.30, 0.36], [2, 2]);

    // visor emisivo frontal
    b.color = [1, 1, 1];
    b.emissive = 1;
    b.box([0, 1.00, -0.21], [0.26, 0.07, 0.05], [2, 2]);
    // radiador dorsal (punto débil: solo por la espalda)
    b.box([0, 0.52, 0.37], [0.62, 0.44, 0.06], [2, 2]);
    b.box([0, 0.30, 0.36], [0.44, 0.10, 0.05], [2, 2]);
    b.emissive = 0;

    return b;
  }

  var MESH_BUILDERS = {
    drone: buildDroneMesh,
    stalker: buildStalkerMesh,
    brute: buildBruteMesh
  };

  /**
   * Material del enemigo: clon del material del catálogo con `emissive` no
   * nulo (el original tiene [0,0,0]) y SIN normal map (§ decisión: enemigos
   * sin normal maps). Conserva el `id` del catálogo para el orden por material.
   */
  function deriveMaterial(type) {
    var d = DEFS[type];
    var base = null;
    try {
      if (BS.Textures && typeof BS.Textures.getMaterial === 'function') {
        base = BS.Textures.getMaterial(d.materialId);
      }
    } catch (e) { base = null; }

    var col = d.emissive;
    return {
      id: base ? base.id : ('mat_enemy_' + type),
      map: base ? base.map : null,
      normalMap: null,
      emissiveMap: base ? base.emissiveMap : null,
      uvScale: (base && base.uvScale) ? base.uvScale : [1, 1],
      specular: base ? base.specular : 0.25,
      normalStrength: 0,
      emissive: [col[0], col[1], col[2]],
      emissiveIntensity: d.emissiveIntensity,
      blend: 'opaque',
      depthWrite: true,
      doubleSided: false,
      program: 'basic',
      roughnessTint: (base && base.roughnessTint) ? base.roughnessTint : [1, 1, 1]
    };
  }

  function buildMeshes(c) {
    if (!BS.Mesh) { BS.Log.warn('BS.Enemies.buildMeshes: BS.Mesh no disponible'); return; }
    for (var i = 0; i < TYPE_KEYS.length; i++) {
      var t = TYPE_KEYS[i];
      var mesh = BS.Mesh.toGL(MESH_BUILDERS[t]());
      S.meshes[t] = mesh;
      S.localAabb[t] = mesh.aabb;
      S.materials[t] = deriveMaterial(t);
    }
    S.built = true;
    BS.Log.info('BS.Enemies.buildMeshes OK (' + TYPE_KEYS.join(', ') + ')');
  }

  /* ======================================================================
   * Creación de enemigos
   * ==================================================================== */
  function normalizePatrol(patrol) {
    var out = [];
    if (!patrol) return out;
    for (var i = 0; i < patrol.length; i++) {
      var p = patrol[i];
      if (!p) continue;
      out.push(new Float32Array([p[0] || 0, p[1] || 0, p[2] || 0]));
    }
    return out;
  }

  function createEnemy(type, pos, opts) {
    opts = opts || {};
    var d = DEFS[type] || DEFS.drone;
    type = DEFS[type] ? type : 'drone';

    var wave = (opts.wave === undefined || opts.wave === null) ? 1 : Math.max(1, opts.wave | 0);
    var wf = wave - 1;
    var hpMul = (opts.hpMul === undefined || opts.hpMul === null) ? 1 : Number(opts.hpMul);
    if (!isFinite(hpMul) || hpMul <= 0) hpMul = 1;

    var hardMul = 1;
    try {
      var st = S.ctx && S.ctx.settings;
      if (st && st.difficulty === 'hard') hardMul = CONFIG.HARD_HP_MUL;
    } catch (e0) { /* noop */ }

    var maxHp = d.hp * (1 + CONFIG.WAVE_HP * wf) * hpMul * hardMul;
    var px = pos ? (pos[0] || 0) : 0;
    var py = pos ? (pos[1] || 0) : d.centerY;
    var pz = pos ? (pos[2] || 0) : 0;

    var e = {
      id: S.nextId++,
      type: type,
      variant: opts.variant || null,
      pos: new Float32Array([px, py, pz]),
      vel: new Float32Array(3),
      delta: new Float32Array(3),
      yaw: (opts.yaw === undefined || opts.yaw === null) ? rand() * Math.PI * 2 : opts.yaw,
      hp: maxHp,
      maxHp: maxHp,
      radius: d.radius,
      height: d.height,
      headY: d.headY,
      aabb: M.aabb([px - d.radius, py - d.height * 0.5, pz - d.radius],
        [px + d.radius, py + d.height * 0.5, pz + d.radius]),
      alive: true,
      state: 'idle',
      stateTime: 0,
      target: null,
      lastKnownPos: new Float32Array([px, py, pz]),
      hearPos: null,
      hearing: d.hearing,
      attackCooldown: rnd(0, d.attack.cooldown * 0.5),
      attackCooldownMax: d.attack.cooldown * Math.max(0.35, 1 - CONFIG.WAVE_CD * wf),
      attackTimer: 0,
      attackFired: false,
      flashTime: 0,
      staggerTime: 0,
      deathTime: 0,
      age: 0,
      speed: d.speed * (1 + CONFIG.WAVE_SPEED * wf),
      damageMul: d.damageMul * (1 + CONFIG.WAVE_DAMAGE * wf),
      patrol: normalizePatrol(opts.patrol),
      patrolIndex: 0,
      stuckTimer: 0,
      stuckAnchor: new Float32Array([px, py, pz]),
      stuckAttempts: 0,
      avoidSign: rand() < 0.5 ? -1 : 1,
      avoidTime: 0,
      losTimer: 0,
      bobPhase: rand() * Math.PI * 2,
      searchTimer: 0,
      meshId: d.meshId,
      scale: (opts.variant === 'prime' ? CONFIG.PRIME_SCALE : 1) * (d.scale || 1),
      body: null,
      aggro: !!opts.aggro
    };

    if (d.hover) e.centerY = d.centerY;
    else e.centerY = d.centerY;

    e.body = {
      pos: e.pos, vel: e.vel,
      radius: e.radius, height: e.height,
      onGround: !!d.hover ? false : true,
      gravityScale: 1,
      stepHeight: 0.45,
      collideFlags: 0,
      ignoreRamp: false
    };

    e.update = function (dt, c) { updateEnemy(e, dt, c); };
    e.aabbOf = function (out) { return aabbOf(e, out); };
    e.canSee = function (p) { return canSee(e, p); };
    aabbOf(e);

    // alerta inmediata si se pide (BS.Debug.spawnEnemy / spawns de oleada listos)
    if (opts.aggro && isPlayerAlive(S.ctx)) setState(e, 'alert');

    S.list.push(e);
    S.spawned++;
    return e;
  }

  function setState(e, s) {
    if (e.state === s) { e.stateTime = 0; return; }
    e.state = s;
    e.stateTime = 0;
    if (s === 'alert') {
      e.attackFired = false;
      emit(S.ctx, 'enemy:alert', { id: e.id, type: e.type, pos: [e.pos[0], e.pos[1], e.pos[2]] });
    } else if (s === 'attack') {
      e.attackTimer = DEFS[e.type].attack.windup || 0.12;
      e.attackFired = false;
    } else if (s === 'search') {
      e.searchTimer = CONFIG.SEARCH_TIME;
      e.stuckAttempts = 0;
    } else if (s === 'dead') {
      e.deathTime = CONFIG.DEATH_LINGER;
    }
  }

  /* ======================================================================
   * Percepción
   * ==================================================================== */
  function hasLOS(c, from, to) {
    if (!c || !c.level || !BS.Physics || typeof BS.Physics.raycast !== 'function') return true;
    var dx = to[0] - from[0], dy = to[1] - from[1], dz = to[2] - from[2];
    var dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dist < 1e-4) return true;
    sc.v[0] = dx / dist; sc.v[1] = dy / dist; sc.v[2] = dz / dist;
    var mask = (BS.Physics.MASK && BS.Physics.MASK.WORLD) || 1;
    var hit = null;
    try { hit = BS.Physics.raycast(c.level, from, sc.v, dist - 0.05, mask); } catch (ex) { hit = null; }
    return !hit || !(hit.t >= 0 && hit.t < dist - 0.05);
  }

  function enemyEye(e, out) {
    out = out || sc.v2;
    out[0] = e.pos[0];
    out[1] = e.pos[1] + e.headY;
    out[2] = e.pos[2];
    return out;
  }

  function canSee(e, pos) {
    if (!pos || !e.alive) return false;
    var c = S.ctx;
    if (!c) return false;
    var d = DEFS[e.type];
    var ex = e.pos[0], ey = e.pos[1] + e.headY, ez = e.pos[2];
    var dx = pos[0] - ex, dy = pos[1] - ey, dz = pos[2] - ez;
    var d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > d.sight * d.sight) return false;
    if (d2 < 1e-6) return true;
    var dist = Math.sqrt(d2);

    // cono horizontal (la vertical no se filtra: los enemigos ven a ras de suelo)
    M.v3yawToDir(sc.fwd, e.yaw);
    var horiz = Math.sqrt(dx * dx + dz * dz);
    if (horiz > 0.05) {
      var dot = (dx * sc.fwd[0] + dz * sc.fwd[2]) / horiz;
      var cosHalf = Math.cos(d.coneDeg * 0.5 * M.DEG);
      if (dot < cosHalf && dist > 3.0) return false; // muy cerca: se detecta igual
    }

    enemyEye(e, sc.v2);
    sc.v3[0] = pos[0]; sc.v3[1] = pos[1]; sc.v3[2] = pos[2];
    return hasLOS(c, sc.v2, sc.v3);
  }

  /** ¿Ve al jugador ahora mismo? Actualiza lastKnownPos si lo ve. */
  function perceive(e, c) {
    if (!isPlayerAlive(c)) return false;
    var eye = playerEye(c, sc.eye);
    if (!eye) return false;
    if (canSee(e, eye)) {
      e.lastKnownPos[0] = eye[0]; e.lastKnownPos[1] = eye[1]; e.lastKnownPos[2] = eye[2];
      e.losTimer = 0;
      return true;
    }
    return false;
  }

  /**
   * Evento 'noise' del bus (§3.17). Se auto-suscribe en init.
   * payload = { pos, radius, tag }
   */
  function handleNoise(payload) {
    if (!payload || !payload.pos) return;
    var c = S.ctx;
    var src = payload.pos;
    var radius = (payload.radius === undefined || payload.radius === null) ? 20 : Number(payload.radius);
    if (!isFinite(radius)) radius = 20;
    for (var i = 0; i < S.list.length; i++) {
      var e = S.list[i];
      if (!e.alive) continue;
      var hear = Math.min(radius, e.hearing);
      var d2 = distSqTo(e, src);
      if (d2 > hear * hear) continue;
      e.hearPos = new Float32Array([src[0], src[1], src[2]]);
      e.lastKnownPos[0] = src[0]; e.lastKnownPos[1] = src[1]; e.lastKnownPos[2] = src[2];
      if (e.state === 'idle' || e.state === 'patrol' || e.state === 'search') {
        setState(e, 'alert');
      } else if (e.state === 'chase') {
        e.losTimer = 0;
      }
    }
  }

  /* ======================================================================
   * Daño al jugador (a través del mediador `ctx.combat` si existe)
   * ==================================================================== */
  function dirFromTo(a, b, out) {
    out = out || sc.v;
    var dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    var l = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (l < 1e-6) { out[0] = 0; out[1] = 0; out[2] = 0; return out; }
    out[0] = dx / l; out[1] = dy / l; out[2] = dz / l;
    return out;
  }

  function hurtPlayer(c, e, amount, kind) {
    var p = playerTarget(c);
    if (!p || p.godMode) return 0;
    var dmg = amount * (e.damageMul || 1);
    var info = {
      point: new Float32Array([e.pos[0], e.pos[1] + e.headY, e.pos[2]]),
      normal: new Float32Array([0, 1, 0]),
      dir: dirFromTo(e.pos, p.pos || e.pos, new Float32Array(3)),
      headshot: false,
      kind: kind || 'melee',
      source: e
    };
    if (c && c.combat && typeof c.combat.damage === 'function') {
      try { var r = c.combat.damage(p, dmg, info); return r && r.applied ? r.applied : dmg; } catch (ex) { /* fallback */ }
    }
    if (typeof p.damage === 'function') {
      try { p.damage(dmg, e.pos, kind || 'melee'); } catch (ex2) { /* noop */ }
    }
    return dmg;
  }

  /* ======================================================================
   * Movimiento y dirección
   * ==================================================================== */
  function dist2D(a, b) {
    var dx = a[0] - b[0], dz = a[2] - b[2];
    return Math.sqrt(dx * dx + dz * dz);
  }

  function angleLerp(cur, want, rate, dt) {
    var d = (want - cur) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    else if (d < -Math.PI) d += Math.PI * 2;
    return cur + d * Math.min(1, rate * dt);
  }

  /** Dirección horizontal deseada hacia (tx,tz) con el desvío anti-atasco. */
  function desiredDir(e, tx, tz, out) {
    var dx = tx - e.pos[0], dz = tz - e.pos[2];
    var l = Math.sqrt(dx * dx + dz * dz);
    if (l < 1e-4) { out[0] = 0; out[1] = 0; return out; }
    dx /= l; dz /= l;
    if (e.avoidTime > 0) {
      var a = e.avoidSign * 0.70; // ~40°
      var ca = Math.cos(a), sa = Math.sin(a);
      var nx = dx * ca - dz * sa;
      var nz = dx * sa + dz * ca;
      dx = nx; dz = nz;
    }
    out[0] = dx; out[1] = dz;
    return out;
  }

  function faceDir(e, dir, dt, rate) {
    if (!dir || (dir[0] === 0 && dir[1] === 0)) return;
    var want = Math.atan2(-dir[0], -dir[1]);
    e.yaw = angleLerp(e.yaw, want, rate, dt);
  }

  function faceTarget(e, dt, c, rate) {
    var p = playerTarget(c);
    var t = p && p.pos ? p.pos : e.lastKnownPos;
    if (!t) return;
    var dx = t[0] - e.pos[0], dz = t[2] - e.pos[2];
    if (dx * dx + dz * dz < 1e-4) return;
    var want = Math.atan2(-dx, -dz);
    e.yaw = angleLerp(e.yaw, want, rate, dt);
  }

  function clampSpeed(e) {
    var vx = e.vel[0], vz = e.vel[2];
    var sq = vx * vx + vz * vz;
    var max = CONFIG.MAX_SPEED;
    if (sq > max * max) {
      var s = max / Math.sqrt(sq);
      e.vel[0] = vx * s; e.vel[2] = vz * s;
    }
    if (e.vel[1] < -CONFIG.MAX_SPEED) e.vel[1] = -CONFIG.MAX_SPEED;
  }

  /** Aplica el desplazamiento con BS.Physics.moveBox; fallback: integración. */
  function moveWithPhysics(e, c, dt) {
    var lvl = c && c.level;
    var step = (e.type === 'brute') ? 0.60 : 0.45;
    if (lvl && BS.Physics && typeof BS.Physics.moveBox === 'function') {
      var res = null;
      try { res = BS.Physics.moveBox(lvl, e.body, e.delta, { gravity: 0, stepHeight: step }); } catch (err) { res = null; }
      if (res) {
        if (res.pos && res.pos !== e.pos) {
          e.pos[0] = res.pos[0]; e.pos[1] = res.pos[1]; e.pos[2] = res.pos[2];
        }
        e.body.onGround = !!res.onGround;
        if (res.onGround) e.vel[1] = 0;
        else if (res.hitCeiling && e.vel[1] > 0) e.vel[1] = 0;
        return res;
      }
    }
    // Fallback (LOTE B ausente): integración simple + clamp de suelo
    e.pos[0] += e.delta[0];
    e.pos[1] += e.delta[1];
    e.pos[2] += e.delta[2];
    if (!DEFS[e.type].hover) {
      var g = groundBelow(c, e.pos[0], e.pos[2], e.pos[1]);
      if (e.pos[1] - e.height * 0.5 <= g + 0.02) {
        e.pos[1] = g + e.height * 0.5;
        e.vel[1] = 0;
        e.body.onGround = true;
      } else {
        e.body.onGround = false;
      }
    }
    return null;
  }

  /** Red de seguridad: nunca atravesar el suelo (§ decisión). */
  function groundClamp(c, e) {
    if (DEFS[e.type].hover) return;
    var g = groundBelow(c, e.pos[0], e.pos[2], e.pos[1]);
    if (!isFinite(g)) return;
    if (e.pos[1] - e.height * 0.5 < g - 0.05) {
      e.pos[1] = g + e.height * 0.5;
      if (e.vel[1] < 0) e.vel[1] = 0;
      e.body.onGround = true;
    }
  }

  /** Enemigo terrestre: acelera hacia (tx,tz) con gravedad propia. */
  function driveGround(e, dt, c, tx, tz) {
    var dir = desiredDir(e, tx, tz, sc.v);
    var sp = e.speed * (e.dashFactor || 1);
    var grav = DEFS[e.type].gravity || 22;

    if (e.body.onGround) e.vel[1] = -2.0; // pegado al suelo (step-down)
    else e.vel[1] -= grav * dt;

    e.vel[0] = M.damp(e.vel[0], dir[0] * sp, CONFIG.GROUND_ACCEL, dt);
    e.vel[2] = M.damp(e.vel[2], dir[1] * sp, CONFIG.GROUND_ACCEL, dt);
    clampSpeed(e);

    e.delta[0] = e.vel[0] * dt;
    e.delta[1] = e.vel[1] * dt;
    e.delta[2] = e.vel[2] * dt;
    moveWithPhysics(e, c, dt);
    groundClamp(c, e);
    faceDir(e, dir, dt, CONFIG.TURN_RATE);
  }

  /** Drone: mantiene la altitud de hover con un vaivén senoidal. */
  function hoverAltitude(e, dt, c) {
    var d = DEFS.drone;
    var g = groundBelow(c, e.pos[0], e.pos[2], e.pos[1] + 1.0);
    var base = (isFinite(g) ? g : 0) + d.centerY;
    var desired = base + Math.sin(e.bobPhase) * CONFIG.DRONE_HOVER_SINE;
    e.vel[1] = 0;
    e.delta[1] = (desired - e.pos[1]) * Math.min(1, CONFIG.DRONE_DAMP * dt);
  }

  function hoverMove(e, dt, c, dx, dz, speed) {
    e.vel[0] = M.damp(e.vel[0], dx * speed, CONFIG.DRONE_ACCEL, dt);
    e.vel[2] = M.damp(e.vel[2], dz * speed, CONFIG.DRONE_ACCEL, dt);
    clampSpeed(e);
    e.delta[0] = e.vel[0] * dt;
    e.delta[2] = e.vel[2] * dt;
    moveWithPhysics(e, c, dt);
  }

  function hoverDrone(e, dt, c, wp) {
    var dx = 0, dz = 0;
    if (wp) {
      var dir = desiredDir(e, wp[0], wp[2], sc.v);
      dx = dir[0]; dz = dir[1];
      faceDir(e, dir, dt, CONFIG.TURN_RATE);
    }
    hoverAltitude(e, dt, c);
    hoverMove(e, dt, c, dx, dz, e.speed);
  }

  function droneChase(e, dt, c, tgt) {
    var d = DEFS.drone;
    var dx = e.pos[0] - tgt[0], dz = e.pos[2] - tgt[2];
    var dist = Math.sqrt(dx * dx + dz * dz) || 0.001;
    var ux = dx / dist, uz = dz / dist;
    var mvx, mvz, speed = e.speed;

    if (dist < CONFIG.DRONE_RETREAT) {
      mvx = ux; mvz = uz;                       // se retira del jugador
    } else if (dist > CONFIG.DRONE_ORBIT[1]) {
      mvx = -ux; mvz = -uz;                     // se acerca
    } else if (dist < CONFIG.DRONE_ORBIT[0]) {
      mvx = ux; mvz = uz;                       // abre distancia
    } else {
      mvx = -uz; mvz = ux;                      // orbita (strafe)
      speed = d.strafeSpeed;
    }
    if (e.avoidTime > 0) {
      var a = e.avoidSign * 0.7, ca = Math.cos(a), sa = Math.sin(a);
      var nx = mvx * ca - mvz * sa, nz = mvx * sa + mvz * ca;
      mvx = nx; mvz = nz;
    }
    hoverAltitude(e, dt, c);
    hoverMove(e, dt, c, mvx, mvz, speed);
    faceTarget(e, dt, c, CONFIG.TURN_RATE);
  }

  function groundChase(e, dt, c, tgt) {
    var d = DEFS[e.type];
    if (e.type === 'stalker') {
      var dx = tgt[0] - e.pos[0], dz = tgt[2] - e.pos[2];
      var dist = Math.sqrt(dx * dx + dz * dz) || 0.001;
      if (dist > 6) {
        e.dashFactor = (d.dashSpeed || d.speed) / d.speed;  // embestida
      } else {
        e.dashFactor = 1;
        // rodeo por flancos (±35°)
        var a = e.avoidSign * (d.attack.flankDeg || 35) * M.DEG;
        var ca = Math.cos(a), sa = Math.sin(a);
        var uxx = dx / dist, uzz = dz / dist;
        var fx = uxx * ca - uzz * sa, fz = uxx * sa + uzz * ca;
        var fx2 = e.pos[0] + fx * dist, fz2 = e.pos[2] + fz * dist;
        driveGround(e, dt, c, fx2, fz2);
        return;
      }
    } else {
      e.dashFactor = 1;
    }
    driveGround(e, dt, c, tgt[0], tgt[2]);
  }

  function updateStuck(e, dt) {
    if (e.state !== 'chase' && e.state !== 'search') {
      e.stuckTimer = 0;
      e.stuckAnchor[0] = e.pos[0];
      e.stuckAnchor[1] = e.pos[1];
      e.stuckAnchor[2] = e.pos[2];
      return;
    }
    if (DEFS[e.type].hover) return; // los drones hacen wall-slide y no se atascan
    e.stuckTimer += dt;
    if (e.stuckTimer < CONFIG.STUCK_WINDOW) return;
    e.stuckTimer = 0;
    var moved = M.v3dist(e.pos, e.stuckAnchor);
    e.stuckAnchor[0] = e.pos[0]; e.stuckAnchor[1] = e.pos[1]; e.stuckAnchor[2] = e.pos[2];
    if (moved < CONFIG.STUCK_MIN_MOVE) {
      e.stuckAttempts++;
      e.avoidSign = -e.avoidSign;
      e.avoidTime = CONFIG.AVOID_TIME;
      if (e.stuckAttempts > CONFIG.MAX_AVOID_ATTEMPTS) {
        e.stuckAttempts = 0;
        e.lastKnownPos[0] = e.pos[0]; e.lastKnownPos[1] = e.pos[1]; e.lastKnownPos[2] = e.pos[2];
        setState(e, 'search');
      }
    } else {
      e.stuckAttempts = 0;
    }
  }

  /* ======================================================================
   * Ataques
   * ==================================================================== */
  function ensureProjMesh() {
    if (S.projMesh || !BS.Mesh) return S.projMesh;
    var b = BS.Mesh.create();
    b.color = [1, 1, 1];
    b.emissive = 1;
    b.sphere([0, 0, 0], 0.16, 8, 6);
    b.emissive = 0;
    S.projMesh = BS.Mesh.toGL(b);
    return S.projMesh;
  }

  function doStrike(e, c) {
    var a = DEFS[e.type].attack;
    var p = playerTarget(c);
    if (!p) return;

    if (a.kind === 'projectile') {
      // Drone: dispara un proyectil de plasma guiado suavemente
      var mx = e.pos[0], my = e.pos[1] + e.headY, mz = e.pos[2];
      M.v3yawToDir(sc.fwd, e.yaw);
      mx += sc.fwd[0] * 0.50; mz += sc.fwd[2] * 0.50;
      var from3 = new Float32Array([mx, my, mz]);
      var to = playerEye(c, sc.eye) || p.pos;
      var dir = dirFromTo(from3, to, new Float32Array(3));
      var spawned = null;
      if (c && c.projectiles && typeof c.projectiles.spawn === 'function') {
        var def = {
          pos: from3,
          vel: new Float32Array([dir[0] * a.speed, dir[1] * a.speed, dir[2] * a.speed]),
          damage: a.damage * (e.damageMul || 1),
          speed: a.speed, life: a.life, radius: a.radius, gravity: 0,
          owner: 'enemy', ownerRef: e, homing: a.homing || 0,
          material: 'mat_bolt_plasma', mesh: ensureProjMesh(),
          color: [0.45, 0.85, 1.0], trail: true, lightRadius: a.lightRadius || 4
        };
        try { spawned = c.projectiles.spawn(def); } catch (ex) { spawned = null; }
      }
      if (c && c.fx) {
        if (c.fx.muzzleFlash) c.fx.muzzleFlash(from3, dir, 0.7);
        if (c.fx.tempLight) c.fx.tempLight(from3, [0.5, 0.9, 1.0], 5, 1.2, 0.08);
      }
      emitSound(c, 'plasma', from3);
      if (!spawned && hasLOS(c, from3, to)) hurtPlayer(c, e, a.damage, 'plasma');
      return;
    }

    var t = p.pos ? p.pos : p;

    if (a.kind === 'melee') {
      var dist = distTo(e, t);
      if (dist <= a.range + 0.6) {
        hurtPlayer(c, e, a.damage, 'melee');
        if (c && c.fx && c.fx.blood && typeof p.damage === 'function') {
          c.fx.blood(t, dirFromTo(e.pos, t, new Float32Array(3)), 8);
        }
      }
      var dd = desiredDir(e, t[0], t[2], sc.v);
      e.vel[0] += dd[0] * (a.lunge || 2);
      e.vel[2] += dd[1] * (a.lunge || 2);
      emitSound(c, 'enemy_attack', e.pos);
      return;
    }

    if (a.kind === 'slam') {
      var dist2 = distTo(e, t);
      if (dist2 <= a.range + 0.7) hurtPlayer(c, e, a.damage, 'slam');
      var cy = Math.max(0, e.pos[1] - e.height * 0.5 + 0.15);
      var center = new Float32Array([e.pos[0], cy, e.pos[2]]);
      var opts = { falloff: 'linear', kind: 'slam', source: e };
      if (c && c.combat && typeof c.combat.areaDamage === 'function') {
        try { c.combat.areaDamage(center, a.waveRadius, a.waveDamage, opts); } catch (ex2) { /* noop */ }
      } else {
        Enemies.areaDamage(center, a.waveRadius, a.waveDamage, opts);
      }
      if (c && c.fx) {
        if (c.fx.explosion) c.fx.explosion(center, a.waveRadius, [1.0, 0.5, 0.2]);
        if (c.fx.shockwave) c.fx.shockwave(center, a.waveRadius * 1.4, [1.0, 0.6, 0.25]);
        if (c.fx.screenShake) c.fx.screenShake(0.9, 0.3);
      }
      emitSound(c, 'explosion', center);
    }
  }

  /* ======================================================================
   * Máquina de estados + actualización por enemigo
   * ==================================================================== */
  function updateAabb(e) { aabbOf(e); }

  function updateEnemy(e, dt, c) {
    c = ctxOf(c);
    dt = clampDt(dt);

    /* --- colapso tras la muerte --- */
    if (!e.alive) {
      e.deathTime -= dt;
      e.stateTime += dt;
      e.yaw += dt * 0.6;
      if (!DEFS[e.type].hover) {
        e.vel[1] -= (DEFS[e.type].gravity || 22) * dt;
        e.delta[0] = 0; e.delta[1] = e.vel[1] * dt; e.delta[2] = 0;
        moveWithPhysics(e, c, dt);
        groundClamp(c, e);
      }
      aabbOf(e);
      return;
    }

    e.age += dt;
    e.stateTime += dt;
    e.bobPhase += dt * (DEFS[e.type].hover ? CONFIG.DRONE_HOVER_FREQ : 1.9);
    if (e.flashTime > 0) e.flashTime -= dt;
    if (e.avoidTime > 0) e.avoidTime -= dt;
    if (e.attackCooldown > 0) e.attackCooldown -= dt;

    if (e.state === 'stagger') {
      e.staggerTime -= dt;
      aabbOf(e);
      if (e.staggerTime <= 0) setState(e, 'chase');
      return;
    }

    var d = DEFS[e.type];
    var sees = perceive(e, c);
    var p = playerTarget(c);
    var pPos = (p && p.pos) ? p.pos : null;

    switch (e.state) {
      /* ------------------------------- idle ------------------------------- */
      case 'idle':
        if (sees) { setState(e, 'alert'); break; }
        if (e.hearPos) { setState(e, 'alert'); break; }
        if (e.patrol.length > 1 && e.stateTime > 1.0) { setState(e, 'patrol'); break; }
        if (d.hover) hoverDrone(e, dt, c, null);
        break;

      /* ------------------------------ patrol ------------------------------ */
      case 'patrol':
        if (sees || e.hearPos) { setState(e, 'alert'); break; }
        var wp = e.patrol[e.patrolIndex] || e.patrol[0];
        if (!wp) { setState(e, 'idle'); break; }
        if (d.hover) hoverDrone(e, dt, c, wp); else driveGround(e, dt, c, wp[0], wp[2]);
        if (dist2D(e.pos, wp) < 1.3) {
          e.patrolIndex = (e.patrolIndex + 1) % e.patrol.length;
        }
        break;

      /* ------------------------------- alert ------------------------------ */
      case 'alert':
        faceTarget(e, dt, c, CONFIG.TURN_RATE);
        if (d.hover) hoverDrone(e, dt, c, null);
        if (e.stateTime >= CONFIG.ALERT_TIME) setState(e, sees || e.aggro ? 'chase' : 'search');
        break;

      /* ------------------------------- chase ------------------------------ */
      case 'chase':
        if (sees) { e.losTimer = 0; e.hearPos = null; e.aggro = true; }
        else {
          e.losTimer += dt;
          if (e.losTimer > CONFIG.LOSE_SIGHT_TIME) { setState(e, 'search'); break; }
        }
        var tgt = pPos || e.lastKnownPos;
        if (d.hover) droneChase(e, dt, c, tgt); else groundChase(e, dt, c, tgt);

        if (e.attackCooldown <= 0 && pPos) {
          var dd = distTo(e, pPos);
          var canAtk = (d.attack.kind === 'projectile')
            ? (sees && dd <= d.attack.range && dd > 1.5)
            : (sees && dd <= d.attack.range + 0.35);
          if (canAtk) { setState(e, 'attack'); break; }
        }
        break;

      /* ------------------------------ attack ------------------------------ */
      case 'attack':
        faceTarget(e, dt, c, CONFIG.TURN_RATE_ATTACK);
        if (d.hover) hoverDrone(e, dt, c, null);
        e.attackTimer -= dt;
        if (e.attackTimer <= 0 && !e.attackFired) {
          e.attackFired = true;
          doStrike(e, c);
        }
        if (e.attackFired && e.attackTimer <= -0.28) {
          e.attackCooldown = e.attackCooldownMax;
          setState(e, 'chase');
        }
        break;

      /* ------------------------------ search ------------------------------ */
      case 'search':
        if (sees) { setState(e, 'chase'); break; }
        e.searchTimer -= dt;
        if (dist2D(e.pos, e.lastKnownPos) > 1.6 && e.searchTimer > 1.0) {
          if (d.hover) hoverDrone(e, dt, c, e.lastKnownPos);
          else driveGround(e, dt, c, e.lastKnownPos[0], e.lastKnownPos[2]);
        } else {
          e.yaw += dt * 1.5 * e.avoidSign;   // observa alrededor
          if (d.hover) hoverDrone(e, dt, c, null);
        }
        if (e.stateTime > CONFIG.SEARCH_TIME) {
          e.hearPos = null;
          setState(e, e.patrol.length > 1 ? 'patrol' : 'idle');
        }
        break;

      default:
        setState(e, 'idle');
        break;
    }

    updateStuck(e, dt);
    aabbOf(e);
  }

  /** Separación entre enemigos (evita apelotonamiento) vía BS.Physics. */
  function separation(c) {
    if (!c || !c.level || !BS.Physics || typeof BS.Physics.resolveOverlaps !== 'function') return;
    var bodies = sc.bodies;
    bodies.length = 0;
    for (var i = 0; i < S.list.length; i++) {
      if (S.list[i].alive) bodies.push(S.list[i].body);
    }
    if (bodies.length < 2) return;
    try { BS.Physics.resolveOverlaps(c.level, bodies, CONFIG.SEPARATION_ITERATIONS); } catch (e) { return; }
    for (var k = 0; k < S.list.length; k++) {
      if (S.list[k].alive) aabbOf(S.list[k]);
    }
  }

  function update(dt) {
    var c = S.ctx;
    dt = clampDt(dt);
    for (var i = 0; i < S.list.length; i++) {
      var e = S.list[i];
      try { e.update(dt, c); }
      catch (err) {
        BS.Log.error('BS.Enemies.update(' + e.type + '#' + e.id + '):', err && err.message ? err.message : err);
      }
    }
    separation(c);
    for (var k = S.list.length - 1; k >= 0; k--) {
      var en = S.list[k];
      if (!en.alive && en.deathTime <= 0) S.list.splice(k, 1);
    }
  }

  /* ======================================================================
   * Render: 1 draw call por enemigo (malla + material del tipo)
   * ==================================================================== */
  function render(renderer) {
    if (!renderer || typeof renderer.push !== 'function') return 0;
    var cam = (renderer.camera && renderer.camera.pos) ? renderer.camera.pos : null;
    var t = (S.ctx && typeof S.ctx.time === 'number') ? S.ctx.time : 0;
    if (!sc.model) sc.model = M.m4();
    if (!sc.posv) sc.posv = new Float32Array(3);
    if (!sc.waabb) sc.waabb = { min: new Float32Array(3), max: new Float32Array(3) };
    var pushed = 0;

    for (var i = 0; i < S.list.length; i++) {
      var e = S.list[i];
      var mesh = S.meshes[e.type];
      var mat = S.materials[e.type];
      if (!mesh || !mat) continue;

      if (cam) {
        var dx = e.pos[0] - cam[0], dy = e.pos[1] - cam[1], dz = e.pos[2] - cam[2];
        if (dx * dx + dy * dy + dz * dz > CONFIG.FOG_CULL * CONFIG.FOG_CULL) continue;
      }

      var lf = e.alive ? 1 : Math.max(0.05, e.deathTime / CONFIG.DEATH_LINGER);
      var scale = (e.scale || 1) * (e.alive ? 1 : (0.80 + 0.20 * lf));
      var py = e.pos[1];
      var pitch = 0, roll = 0;

      if (e.alive) {
        py += DEFS[e.type].hover
          ? Math.sin(e.bobPhase) * 0.045
          : Math.abs(Math.sin(e.bobPhase)) * 0.05;
        roll = Math.sin(e.bobPhase) * 0.045;
        if (e.state === 'attack') pitch = -0.13;
        if (e.state === 'stagger') roll += e.avoidSign * 0.16;
      } else {
        var prog = 1 - lf;
        pitch = -1.35 * prog;
        py -= 0.35 * prog * (e.height * 0.5);
        roll = 0.55 * prog;
      }

      sc.posv[0] = e.pos[0]; sc.posv[1] = py; sc.posv[2] = e.pos[2];
      M.m4fromTRS(sc.model, sc.posv, e.yaw, pitch, roll, scale);

      if (typeof renderer.isVisible === 'function' && S.localAabb[e.type]) {
        M.aabbTransform(sc.waabb, S.localAabb[e.type], sc.model);
        if (!renderer.isVisible(sc.waabb)) continue;
      }

      var d = DEFS[e.type];
      var tint = d.tint;
      var boost = 0.18 + 0.10 * Math.sin(t * 3.0 + e.bobPhase);
      if (e.variant === 'prime') {
        boost += 0.28;
        tint = [Math.min(1, d.tint[0] + 0.14), d.tint[1] * 0.92, d.tint[2] * 0.88];
      }
      var opts = { tint: tint, emissiveBoost: boost };
      if (e.flashTime > 0) opts.flash = 0.7;
      if (e.staggerTime > 0) opts.tint = [1, 1, 1];

      renderer.push(mesh, sc.model, mat, opts);
      pushed++;
    }
    return pushed;
  }

  /* ======================================================================
   * API pública
   * ==================================================================== */
  function forwardOf(e, out) {
    return M.v3yawToDir(out || sc.v3, e.yaw);
  }

  function kill(e, source) {
    e.alive = false;
    e.hp = 0;
    e.vel[0] = 0; e.vel[2] = 0;
    e.avoidTime = 0;
    setState(e, 'dead');
    S.killed++;
    var c = S.ctx;
    var byPlayer = !!(c && (source === c.player || source === 'player'));
    if (c && c.fx) {
      if (c.fx.blood) c.fx.blood([e.pos[0], e.pos[1] + e.headY, e.pos[2]], [0, 1, 0], 14);
      if (c.fx.tempLight) c.fx.tempLight(e.pos, [1.0, 0.45, 0.25], 4, 0.8, 0.25);
    }
    emitSound(c, 'enemy_death', e.pos);
    emit(c, 'enemy:killed', {
      id: e.id, type: e.type, variant: e.variant,
      pos: [e.pos[0], e.pos[1], e.pos[2]], byPlayer: byPlayer
    });
    if (c && c.game && typeof c.game.onEnemyKilled === 'function') {
      try { c.game.onEnemyKilled(e, byPlayer); } catch (ex) { /* noop */ }
    }
  }

  /** Puntos de spawn válidos para una oleada (ids de spawnPoints o todos). */
  function waveSpawnPoints(c, wave) {
    var lvl = c && c.level;
    var all = (lvl && lvl.spawns && lvl.spawns.enemies) || [];
    var ids = wave && wave.spawnPoints;
    var out = [];
    for (var i = 0; i < all.length; i++) {
      if (ids && ids.indexOf(all[i].id) < 0) continue;
      out.push(all[i]);
    }
    return out.length ? out : all.slice();
  }

  function waveDataFor(index) {
    var c = S.ctx;
    var lvl = c && c.level;
    if (lvl && lvl.waves && lvl.waves[index]) return lvl.waves[index];
    if (lvl && lvl.data && lvl.data.waves && lvl.data.waves[index]) return lvl.data.waves[index];
    if (BS.LevelData && BS.LevelData.mission && BS.LevelData.mission.waves) {
      return BS.LevelData.mission.waves[index] || null;
    }
    return null;
  }

  /** Punto alrededor del jugador (fallback si el nivel no tiene spawns). */
  function fallbackSpawnPoint(c, i) {
    var p = c && c.player;
    var base = (p && p.pos) ? p.pos : new Float32Array([0, 0, 0]);
    var a = (i * 2.39996) % (Math.PI * 2);
    var d = 12 + (i % 4) * 2;
    return new Float32Array([
      base[0] - Math.sin(a) * d,
      base[1] + 0.4,
      base[2] - Math.cos(a) * d
    ]);
  }

  var Enemies = {
    TYPES: TYPES,
    TYPE_KEYS: TYPE_KEYS,
    DEFS: DEFS,
    CONFIG: CONFIG,

    /** Referencia VIVA a la lista de enemigos (no reasignar). */
    list: S.list,

    init: function (c) {
      S.ctx = c || null;
      S.list.length = 0;
      S.nextId = 1;
      S.spawned = 0;
      S.killed = 0;
      S.projMesh = null;
      try {
        S.rng = (c && typeof c.rng === 'function') ? c.rng : BS.RNG.create(0xE0E1C7);
      } catch (e0) { S.rng = null; }
      try { buildMeshes(c); ensureProjMesh(); }
      catch (e1) { BS.Log.error('BS.Enemies.init (mallas):', e1 && e1.message ? e1.message : e1); }
      // Auto-suscripción al bus de ruido (el evento lo emiten armas/explosiones)
      try {
        if (c && c.events && typeof c.events.on === 'function' && S.noiseSub < 0) {
          S.noiseSub = c.events.on('noise', handleNoise, 'enemies');
        }
      } catch (e2) { /* noop */ }
      BS.Log.info('BS.Enemies.init OK (' + TYPE_KEYS.length + ' tipos)');
    },

    update: function (dt) { update(dt); },

    render: function (renderer) { return render(renderer); },

    reset: function () {
      S.list.length = 0;
      S.nextId = 1;
      S.spawned = 0;
      S.killed = 0;
    },

    clear: function () { S.list.length = 0; },

    spawn: function (type, pos, opts) {
      try {
        var t = DEFS[type] ? type : 'drone';
        return createEnemy(t, pos, opts);
      } catch (e) {
        BS.Log.error('BS.Enemies.spawn:', e && e.message ? e.message : e);
        return null;
      }
    },

    /**
     * Crea todos los enemigos de una oleada (§4.1). Devuelve el nº creado.
     * `maxAlive` acota el total concurrente (se respeta el presupuesto §7.1).
     */
    spawnWave: function (index) {
      index = Math.max(0, index | 0);
      var c = S.ctx;
      var wave = waveDataFor(index);
      var created = 0;
      try {
        var maxAlive = Enemies.maxAliveForWave(index + 1);
        var pts = wave ? waveSpawnPoints(c, wave) : [];
        var entries = (wave && wave.enemies) ? wave.enemies : null;

        if (!entries || !entries.length) {
          // Fallback: una escuadra mínima para no bloquear la progresión
          var types = ['drone', 'stalker', 'brute'];
          for (var f = 0; f < 6; f++) {
            var ft = types[f % 3];
            var fp = fallbackSpawnPoint(c, f);
            if (wave) fp[1] = (DEFS[ft].centerY || 1.0);
            createEnemy(ft, fp, { wave: index + 1 });
            created++;
          }
          return created;
        }

        var slot = 0;
        for (var i = 0; i < entries.length; i++) {
          var ent = entries[i] || {};
          var d = DEFS[ent.type] || DEFS.drone;
          var count = Math.max(0, ent.count | 0);
          for (var k = 0; k < count && created < maxAlive; k++) {
            var sp = pts.length ? pts[slot % pts.length] : null;
            var pos;
            if (sp && sp.pos) {
              pos = new Float32Array([sp.pos[0], sp.pos[1], sp.pos[2]]);
              // pequeño jitter determinista para no apilarse
              pos[0] += (rand() - 0.5) * 1.6;
              pos[2] += (rand() - 0.5) * 1.6;
            } else {
              pos = fallbackSpawnPoint(c, slot);
              pos[1] = d.centerY;
            }
            if (d.hover) pos[1] = d.centerY;
            createEnemy(ent.type, pos, {
              wave: index + 1,
              variant: ent.variant || null,
              hpMul: (ent.hpMul === undefined ? (ent.variant === 'prime' ? CONFIG.PRIME_HP : 1) : ent.hpMul),
              patrol: (sp && sp.patrol) ? sp.patrol : null,
              aggro: false
            });
            created++;
            slot++;
          }
        }
      } catch (e) {
        BS.Log.error('BS.Enemies.spawnWave(' + index + '):', e && e.message ? e.message : e);
      }
      BS.Log.info('BS.Enemies.spawnWave(' + index + '): ' + created + ' enemigos');
      return created;
    },

    /** maxAlive por oleada (§3.17): min(8 + 2w, 20). */
    maxAliveForWave: function (w) {
      w = Math.max(1, w | 0);
      return Math.min(8 + 2 * w, 20);
    },

    aliveCount: function () {
      var n = 0;
      for (var i = 0; i < S.list.length; i++) if (S.list[i].alive) n++;
      return n;
    },

    aliveCountOfType: function (t) {
      var n = 0;
      for (var i = 0; i < S.list.length; i++) if (S.list[i].alive && S.list[i].type === t) n++;
      return n;
    },

    count: function () { return S.list.length; },

    /* ------------------------- consultas de disparo ------------------------- */
    raycast: function (origin, dir, maxDist, ignoreEnemy) {
      if (!origin || !dir) return null;
      var limit = (maxDist === undefined || maxDist === null) ? 400 : Number(maxDist);
      if (!isFinite(limit) || limit <= 0) return null;
      var best = null, bestT = limit;
      for (var i = 0; i < S.list.length; i++) {
        var e = S.list[i];
        if (!e.alive || e === ignoreEnemy) continue;
        var t = M.rayAABB(origin, dir, e.aabb.min, e.aabb.max, bestT);
        if (t < 0 || t >= bestT - 1e-6) continue;
        bestT = t; best = e;
      }
      if (!best) return null;
      var point = new Float32Array([
        origin[0] + dir[0] * bestT,
        origin[1] + dir[1] * bestT,
        origin[2] + dir[2] * bestT
      ]);
      var n = new Float32Array(3);
      var a = best.aabb;
      var eps = 1e-3;
      if (Math.abs(point[0] - a.min[0]) < eps) n[0] = -1;
      else if (Math.abs(point[0] - a.max[0]) < eps) n[0] = 1;
      else if (Math.abs(point[1] - a.min[1]) < eps) n[1] = -1;
      else if (Math.abs(point[1] - a.max[1]) < eps) n[1] = 1;
      else if (Math.abs(point[2] - a.min[2]) < eps) n[2] = -1;
      else if (Math.abs(point[2] - a.max[2]) < eps) n[2] = 1;
      else n[1] = 1;
      return {
        enemy: best, t: bestT, point: point, normal: n,
        headshot: point[1] > (best.pos[1] + best.headY)
      };
    },

    /**
     * Reparto de daño. `hitInfo.headshot` significa que el ARMA ya multiplicó
     * por su headshotMul (1.8, §3.14); aquí se compensa para llegar al
     * multiplicador de punto débil del diseño (drone 2.0, stalker 2.2,
     * brute 2.5 solo por la espalda). Si se llama con `hitInfo.weak` y sin
     * headshot, se aplica el multiplicador completo (llamada directa).
     */
    damage: function (e, amount, hitInfo) {
      if (!e || !e.alive) return { killed: false, hp: e ? e.hp : 0, applied: 0 };
      var amt = Number(amount);
      if (!isFinite(amt) || amt < 0) amt = 0;
      var info = hitInfo || {};
      var def = DEFS[e.type] || DEFS.drone;

      var weak = false;
      if (e.type === 'brute') {
        if (info.headshot) {
          var f = forwardOf(e, sc.v3);
          if (info.dir) {
            var dot = info.dir[0] * f[0] + info.dir[2] * f[2];
            weak = dot > 0.25;   // dispara en el sentido de la mirada: por la espalda
          } else weak = true;
        }
      } else {
        weak = !!info.headshot;
      }

      var mul = 1;
      if (weak) {
        mul = (info.weak && !info.headshot)
          ? def.weakMul
          : (def.weakMul / CONFIG.HEADSHOT_WEAPON_MUL);
      }

      var applied = amt * mul;
      e.hp -= applied;
      e.flashTime = CONFIG.FLASH_TIME;

      var killed = false;
      if (e.hp <= 0) {
        killed = true;
        kill(e, info.source);
      } else if (amt >= def.staggerMin && e.type !== 'brute') {
        e.staggerTime = CONFIG.STAGGER_TIME;
        setState(e, 'stagger');
      }
      return { killed: killed, hp: e.hp, applied: applied };
    },

    /**
     * Daño en área: siempre a los enemigos (excepto al origen) y al jugador
     * solo si el origen NO es él mismo (§ decisión: el splash propio no se
     * autolesiona). Devuelve el total aplicado a enemigos.
     */
    areaDamage: function (pos, radius, amount, opts) {
      if (!pos) return 0;
      opts = opts || {};
      var r = Number(radius);
      if (!isFinite(r) || r <= 0) r = 0;
      var amt = Number(amount);
      if (!isFinite(amt)) amt = 0;
      var linear = (opts.falloff !== 'none');
      var total = 0;

      for (var i = 0; i < S.list.length; i++) {
        var e = S.list[i];
        if (!e.alive) continue;
        if (opts.source && opts.source === e) continue;
        var reach = r + e.radius;
        var d = M.v3dist(e.pos, pos);
        if (d > reach) continue;
        var f = linear ? Math.max(0, 1 - d / Math.max(0.001, reach)) : 1;
        if (f <= 0) continue;
        var res = Enemies.damage(e, amt * f, {
          point: e.pos, normal: new Float32Array([0, 1, 0]),
          dir: dirFromTo(pos, e.pos, new Float32Array(3)),
          headshot: false, kind: opts.kind || 'splash', source: opts.source
        });
        total += res.applied;
      }

      var c = S.ctx;
      if (c && c.player && opts.source !== c.player) {
        var p = c.player;
        if (!p.godMode && p.pos) {
          var dp = M.v3dist(p.pos, pos);
          var reachP = r + 0.35;
          if (dp <= reachP) {
            var fp = linear ? Math.max(0, 1 - dp / Math.max(0.001, reachP)) : 1;
            var dmgP = amt * fp;
            if (dmgP > 0) {
              if (c.combat && typeof c.combat.damage === 'function') {
                try {
                  c.combat.damage(p, dmgP, {
                    point: p.pos, normal: new Float32Array([0, 1, 0]),
                    dir: dirFromTo(pos, p.pos, new Float32Array(3)),
                    headshot: false, kind: opts.kind || 'splash', source: opts.source
                  });
                } catch (ex) { /* noop */ }
              } else if (typeof p.damage === 'function') {
                try { p.damage(dmgP, pos, opts.kind || 'splash'); } catch (ex2) { /* noop */ }
              }
            }
          }
        }
      }
      return total;
    },

    getNearest: function (pos, maxDist, filter) {
      if (!pos) return null;
      var limit = (maxDist === undefined || maxDist === null) ? Infinity : Number(maxDist);
      var bestD = limit * limit;
      var best = null;
      for (var i = 0; i < S.list.length; i++) {
        var e = S.list[i];
        if (!e.alive) continue;
        if (typeof filter === 'function' && !filter(e)) continue;
        var d2 = distSqTo(e, pos);
        if (d2 < bestD) { bestD = d2; best = e; }
      }
      return best;
    },

    noiseListener: function (payload) { handleNoise(payload); },

    buildMeshes: function (c) { buildMeshes(c); ensureProjMesh(); },

    rebuild: function (c) {
      try {
        for (var i = 0; i < TYPE_KEYS.length; i++) {
          var t = TYPE_KEYS[i];
          if (S.meshes[t] && BS.GL && typeof BS.GL.disposeMesh === 'function') {
            BS.GL.disposeMesh(S.meshes[t]);
          }
          S.meshes[t] = null;
        }
        if (S.projMesh && BS.GL && typeof BS.GL.disposeMesh === 'function') {
          BS.GL.disposeMesh(S.projMesh);
        }
        S.projMesh = null;
        buildMeshes(c || S.ctx);
        ensureProjMesh();
        BS.Log.info('BS.Enemies.rebuild OK');
      } catch (e) {
        BS.Log.error('BS.Enemies.rebuild:', e && e.message ? e.message : e);
      }
    },

    dispose: function () {
      try {
        for (var i = 0; i < TYPE_KEYS.length; i++) {
          var t = TYPE_KEYS[i];
          if (S.meshes[t] && BS.GL && typeof BS.GL.disposeMesh === 'function') BS.GL.disposeMesh(S.meshes[t]);
          S.meshes[t] = null;
        }
        if (S.projMesh && BS.GL && typeof BS.GL.disposeMesh === 'function') BS.GL.disposeMesh(S.projMesh);
        S.projMesh = null;
        S.built = false;
      } catch (e) { /* noop */ }
    },

    /* Diagnóstico (extra para el tester) */
    diagnostics: function () {
      return {
        alive: Enemies.aliveCount(),
        total: S.list.length,
        spawned: S.spawned,
        killed: S.killed,
        built: S.built,
        porTipo: {
          drone: Enemies.aliveCountOfType('drone'),
          stalker: Enemies.aliveCountOfType('stalker'),
          brute: Enemies.aliveCountOfType('brute')
        }
      };
    }
  };

  BS.Enemies = Enemies;

  /* ======================================================================
   * Test: mallas, daño con punto débil, raycast, área y FSM
   * Nunca lanza; restaura el estado del módulo al terminar.
   * ==================================================================== */
  if (BS.Debug && typeof BS.Debug.register === 'function') {
    BS.Debug.register('enemies:ai', function () {
      var savedCtx = S.ctx;
      var savedList = S.list.slice();
      var savedNext = S.nextId;
      var savedRng = S.rng;
      var ok = true;
      var notes = [];

      try {
        var stub = savedCtx || {
          level: null, player: null, settings: { difficulty: 'normal' },
          events: BS.Events, fx: null, audio: null, projectiles: null,
          combat: null, rng: BS.RNG.create(1234), time: 0
        };
        if (!stub.player) {
          stub.player = {
            pos: new Float32Array([0, 1.7, 6]),
            isDead: false, health: 100, godMode: false,
            eyePosition: function (out) {
              out = out || new Float32Array(3);
              out[0] = 0; out[1] = 1.7; out[2] = 6;
              return out;
            },
            damage: function () { return { died: false, hp: 100, applied: 0 }; }
          };
        }
        S.ctx = stub;
        S.rng = BS.RNG.create(0xC0FFEE);
        S.list.length = 0;
        S.nextId = 1;

        // 1) vida base por tipo
        var a = createEnemy('drone', [0, 1.9, 2]);
        var b = createEnemy('stalker', [3, 0.6, 2]);
        var c2 = createEnemy('brute', [-3, 1.2, 2]);
        var hpOk = Math.abs(a.hp - DEFS.drone.hp) < 1e-3 &&
          Math.abs(b.hp - DEFS.stalker.hp) < 1e-3 &&
          Math.abs(c2.hp - DEFS.brute.hp) < 1e-3;
        if (!hpOk) { ok = false; notes.push('hp base incorrecto'); }

        // 2) raycast contra el drone (mira en +z desde z=-5)
        var hit = Enemies.raycast(new Float32Array([0, 1.9, -5]), new Float32Array([0, 0, 1]), 20, null);
        if (!(hit && hit.enemy === a && hit.t > 0)) { ok = false; notes.push('raycast no alcanzó el drone'); }

        // 3) daño normal (sin punto débil): aplica el daño íntegro
        var r1 = Enemies.damage(a, 10, {
          point: a.pos, normal: new Float32Array([0, 1, 0]), dir: new Float32Array([0, 0, 1]),
          headshot: false, kind: 'bullet', source: stub.player
        });
        var dmgOk = Math.abs(r1.applied - 10) < 1e-3 && !r1.killed &&
          Math.abs(a.hp - (DEFS.drone.hp - 10)) < 1e-3;
        if (!dmgOk) { ok = false; notes.push('daño normal incorrecto (' + r1.applied + ')'); }

        // 4) punto débil: el drone muere con daño de arma + headshot
        var r2 = Enemies.damage(a, 30, {
          point: a.pos, normal: new Float32Array([0, 1, 0]), dir: new Float32Array([0, 0, 1]),
          headshot: true, kind: 'bullet', source: stub.player
        });
        if (!(r2.killed && !a.alive)) { ok = false; notes.push('el punto débil no mató al drone'); }

        // 5) el stalker con headshot masivo muere; el brute NO por la espalda con dot frontal
        var r3 = Enemies.damage(b, DEFS.stalker.hp, {
          point: b.pos, normal: new Float32Array([0, 1, 0]), dir: new Float32Array([0, 0, 1]),
          headshot: true, kind: 'bullet', source: stub.player
        });
        if (!r3.killed) { ok = false; notes.push('el stalker no murió'); }

        // 6) contadores
        if (Enemies.aliveCount() !== 1 || Enemies.aliveCountOfType('brute') !== 1) {
          ok = false; notes.push('aliveCount incorrecto (' + Enemies.aliveCount() + ')');
        }

        // 7) área
        var appliedArea = Enemies.areaDamage(new Float32Array([-3, 1.2, 2]), 5, 5,
          { falloff: 'linear', kind: 'test', source: null });
        if (!(appliedArea > 0)) { ok = false; notes.push('areaDamage no aplicó daño'); }

        // 8) FSM: el drone ve al jugador y llega a chase
        var f = createEnemy('drone', [0, 1.9, 2]);
        f.yaw = Math.atan2(-(stub.player.pos[0] - f.pos[0]), -(stub.player.pos[2] - f.pos[2]));
        f.update(1 / 60, stub);
        var alerted = (f.state === 'alert' || f.state === 'chase');
        for (var i = 0; i < 40; i++) f.update(1 / 60, stub);
        var chasing = (f.state === 'chase' || f.state === 'attack');
        if (!(alerted && chasing)) {
          ok = false; notes.push('FSM no llegó a chase (estado=' + f.state + ')');
        }

        // 9) 20 enemigos + 30 pasos sin lanzar
        S.list.length = 0;
        for (var k = 0; k < 20; k++) {
          var tk = TYPE_KEYS[k % 3];
          createEnemy(tk, [(-20 + k * 2), DEFS[tk].centerY, -10]);
        }
        for (var st = 0; st < 30; st++) Enemies.update(1 / 60);
        if (Enemies.count() < 20) { ok = false; notes.push('se perdieron enemigos durante update'); }

        // 10) spawnWave sin datos de nivel no debe lanzar
        if (typeof Enemies.spawnWave(0) !== 'number') { ok = false; notes.push('spawnWave no devolvió número'); }

      } catch (e) {
        ok = false;
        notes.push('excepción: ' + (e && e.message ? e.message : String(e)));
      }

      try {
        S.list.length = 0;
        for (var r = 0; r < savedList.length; r++) S.list.push(savedList[r]);
        S.ctx = savedCtx;
        S.nextId = savedNext;
        S.rng = savedRng;
      } catch (e2) { /* noop */ }

      return {
        ok: ok, notas: notes,
        enemigosRestaurados: S.list.length,
        tipos: TYPE_KEYS.slice(),
        weakMul: { drone: DEFS.drone.weakMul, stalker: DEFS.stalker.weakMul, brute: DEFS.brute.weakMul }
      };
    });
  }

})(window.BS = window.BS || {});
