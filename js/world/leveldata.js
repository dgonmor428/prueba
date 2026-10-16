/* ===========================================================================
 * BLACKSITE: LAST SIGNAL  —  js/world/leveldata.js
 * ---------------------------------------------------------------------------
 * Propósito : datos declarativos de la misión K-7 (§4.1). NO toca GL: es solo
 *             un modelo de datos legible y editable a mano.
 *             El mapa (6 zonas unidas por pasillos) se construye con funciones
 *             generadoras (room/corridor/pillar/cover/stairs/ramp/console/
 *             shelf/crateStack/pipeRun/lamp/strip/rail/container...) que emiten
 *             brushes; así el nivel es rico y el archivo mantenible.
 * Depende de: nada (solo Math del navegador).
 * Expone    : BS.LevelData { mission, build(), buildStats() }
 * =========================================================================== */
(function (BS) {
  'use strict';

  /* ======================================================================
   * Tablas de estilo
   * ==================================================================== */

  /* Repeticiones de textura por metro, por material (uvScale del brush). */
  var UV = {
    mat_concrete_wall: [0.28, 0.28],
    mat_concrete_floor: [0.22, 0.22],
    mat_metal_panel: [0.4, 0.4],
    mat_metal_floor: [0.33, 0.33],
    mat_ceiling_tile: [0.45, 0.45],
    mat_grate: [0.5, 0.5],
    mat_crate: [0.55, 0.55],
    mat_door: [0.4, 0.4],
    mat_pipe: [0.5, 0.5],
    mat_rust: [0.3, 0.3],
    mat_glass: [0.4, 0.4],
    mat_terminal: [0.4, 0.4],
    mat_strip_cyan: [0.7, 0.7],
    mat_strip_red: [0.7, 0.7],
    mat_beacon: [0.7, 0.7],
    mat_enemy_armor: [1, 1]
  };

  function uvOf(mat) {
    var u = UV[mat];
    return u ? [u[0], u[1]] : [0.35, 0.35];
  }

  /* Materiales (para el informe). §7.4 recomienda ≤ 12; usamos 14. */
  var MATERIALS = [
    'mat_concrete_floor', 'mat_concrete_wall', 'mat_metal_panel', 'mat_metal_floor',
    'mat_ceiling_tile', 'mat_grate', 'mat_crate', 'mat_rust', 'mat_glass',
    'mat_terminal', 'mat_strip_cyan', 'mat_strip_red', 'mat_beacon', 'mat_pipe'
  ];

  /* ======================================================================
   * Estado del constructor (se reinicia en cada buildMission)
   * ==================================================================== */
  var brushes = [];
  var lights = [];
  var stats = { rooms: 0, corridors: 0, props: 0, emissive: 0 };

  function r2(v) { return Math.round(v * 100) / 100; }

  /* Añade un brush sólido axis-aligned. */
  function box(pos, size, mat, o) {
    o = o || {};
    var b = {
      kind: 'box',
      pos: [r2(pos[0]), r2(pos[1]), r2(pos[2])],
      size: [r2(size[0]), r2(size[1]), r2(size[2])],
      mat: mat,
      uv: o.uv || uvOf(mat),
      collide: o.collide !== false,
      visible: o.visible !== false,
      lightMap: o.lightMap !== false,
      emissive: o.emissive || 0,
      rotY: o.rotY || 0,
      prop: !!o.prop
    };
    brushes.push(b);
    return b;
  }

  /* Rampa (cuña). `axis` = lado hacia el que SUBE ('+x','-x','+z','-z'). */
  function wedge(pos, size, axis, mat, o) {
    o = o || {};
    var b = {
      kind: 'wedge',
      pos: [r2(pos[0]), r2(pos[1]), r2(pos[2])],
      size: [r2(size[0]), r2(size[1]), r2(size[2])],
      axis: axis || '+x',
      mat: mat,
      uv: o.uv || uvOf(mat),
      collide: o.collide !== false,
      visible: o.visible !== false,
      lightMap: o.lightMap !== false,
      emissive: o.emissive || 0
    };
    brushes.push(b);
    return b;
  }

  /* Escalera de peldaños (cajas). `axis` = lado hacia el que SUBE. */
  function stairs(pos, size, steps, axis, mat, o) {
    o = o || {};
    var b = {
      kind: 'stair',
      pos: [r2(pos[0]), r2(pos[1]), r2(pos[2])],
      size: [r2(size[0]), r2(size[1]), r2(size[2])],
      steps: steps | 0,
      axis: axis || '+x',
      mat: mat,
      uv: o.uv || uvOf(mat),
      collide: o.collide !== false,
      visible: o.visible !== false,
      lightMap: o.lightMap !== false,
      emissive: o.emissive || 0
    };
    brushes.push(b);
    return b;
  }

  /* Cilindro (tuberías, barriles, núcleo). `axis` = 'x'|'y'|'z'. */
  function cyl(pos, radius, height, segments, axis, mat, o) {
    o = o || {};
    var b = {
      kind: 'cylinder',
      pos: [r2(pos[0]), r2(pos[1]), r2(pos[2])],
      radius: radius,
      height: height,
      size: [radius * 2, height, radius * 2],
      segments: segments | 0 || 10,
      axis: axis || 'y',
      mat: mat,
      uv: o.uv || uvOf(mat),
      collide: o.collide !== false,
      visible: o.visible !== false,
      lightMap: o.lightMap !== false,
      emissive: o.emissive || 0
    };
    brushes.push(b);
    return b;
  }

  /* Objeto decorativo con rotY: no se fusiona, va a `props` con malla propia. */
  function prop(pos, size, rotY, mat, o) {
    o = o || {};
    var b = box(pos, size, mat, o);
    b.prop = true;
    b.rotY = rotY || 0;
    stats.props++;
    return b;
  }

  /* ======================================================================
   * Luces estáticas (se hornean en el color de vértice)
   * ==================================================================== */
  function lamp(pos, color, radius, intensity) {
    lights.push({
      pos: [r2(pos[0]), r2(pos[1]), r2(pos[2])],
      color: [color[0], color[1], color[2]],
      radius: radius || 10,
      intensity: intensity === undefined ? 1 : intensity,
      baked: true
    });
  }

  /* ======================================================================
   * Generadores compuestos
   * ==================================================================== */

  /* Longitudes de segmento de muro (mejor culling por chunk de 12 m). */
  var WALL_SEG = 10;

  /* Muro a lo largo de Z en x = fx. `ops` = huecos [{a0,a1,y0,y1}]. */
  function wallAlongZ(fx, z0, z1, y0, y1, t, mat, ops, o) {
    var segs = splitSegments(z0, z1, ops || []);
    for (var i = 0; i < segs.length; i++) {
      var s = segs[i];
      if (s.opening) {
        if (s.y1 > y0 + 0.01) {
          box([fx, (s.y1 + y1) / 2, (s.a0 + s.a1) / 2],
            [t, y1 - s.y1, s.a1 - s.a0], mat, o);
        }
        if (s.y0 > y0 + 0.01) {
          box([fx, (y0 + s.y0) / 2, (s.a0 + s.a1) / 2],
            [t, s.y0 - y0, s.a1 - s.a0], mat, o);
        }
      } else {
        emitRun('z', fx, s.a0, s.a1, y0, y1, t, mat, o);
      }
    }
  }

  /* Muro a lo largo de X en z = fz. */
  function wallAlongX(fz, x0, x1, y0, y1, t, mat, ops, o) {
    var segs = splitSegments(x0, x1, ops || []);
    for (var i = 0; i < segs.length; i++) {
      var s = segs[i];
      if (s.opening) {
        if (s.y1 > y0 + 0.01) {
          box([(s.a0 + s.a1) / 2, (s.y1 + y1) / 2, fz],
            [s.a1 - s.a0, y1 - s.y1, t], mat, o);
        }
        if (s.y0 > y0 + 0.01) {
          box([(s.a0 + s.a1) / 2, (y0 + s.y0) / 2, fz],
            [s.a1 - s.a0, s.y0 - y0, t], mat, o);
        }
      } else {
        emitRun('x', fz, s.a0, s.a1, y0, y1, t, mat, o);
      }
    }
  }

  /* Emite un tramo de muro partido en segmentos de ≤ WALL_SEG metros. */
  function emitRun(dir, fixed, a0, a1, y0, y1, t, mat, o) {
    if (a1 - a0 < 0.02) return;
    var n = Math.max(1, Math.ceil((a1 - a0) / WALL_SEG));
    var step = (a1 - a0) / n;
    for (var i = 0; i < n; i++) {
      var b0 = a0 + i * step, b1 = b0 + step;
      if (dir === 'z') box([fixed, (y0 + y1) / 2, (b0 + b1) / 2], [t, y1 - y0, b1 - b0], mat, o);
      else box([(b0 + b1) / 2, (y0 + y1) / 2, fixed], [b1 - b0, y1 - y0, t], mat, o);
    }
  }

  /* Convierte [a0,a1] + huecos en una lista de tramos sólidos y dinteles. */
  function splitSegments(a0, a1, ops) {
    var out = [];
    var list = ops.slice().sort(function (p, q) { return p.a0 - q.a0; });
    var c = a0;
    for (var i = 0; i < list.length; i++) {
      var op = list[i];
      var oa0 = Math.max(a0, op.a0), oa1 = Math.min(a1, op.a1);
      if (oa1 <= oa0) continue;
      if (oa0 > c + 0.01) out.push({ a0: c, a1: oa0, opening: false });
      out.push({
        a0: oa0, a1: oa1, opening: true,
        y0: (op.y0 === undefined ? 0 : op.y0),
        y1: (op.y1 === undefined ? 3.9 : op.y1)
      });
      c = Math.max(c, oa1);
    }
    if (c < a1 - 0.01) out.push({ a0: c, a1: a1, opening: false });
    return out;
  }

  /**
   * Sala con suelo, techo y 4 muros.
   * o = { y0, height, t, floor, wall, ceil, noCeil, noWall:{n,s,e,w},
   *       op:{ n:[{a0,a1,y0,y1}], s, e, w } }
   * Convención: n = muro en z = z0 (el de z menor), s = muro en z = z1.
   */
  function room(x0, x1, z0, z1, o) {
    o = o || {};
    var y0 = o.y0 || 0;
    var h = o.height || 6;
    var t = o.t === undefined ? 0.6 : o.t;
    var fm = o.floor || 'mat_concrete_floor';
    var wm = o.wall || 'mat_concrete_wall';
    var cm = o.ceil || 'mat_ceiling_tile';
    var cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    var sx = x1 - x0, sz = z1 - z0;
    var op = o.op || {};
    if (o.noFloor !== true) box([cx, y0 - t / 2, cz], [sx, t, sz], fm);
    if (o.noCeil !== true) box([cx, y0 + h + t / 2, cz], [sx, t, sz], cm);
    var nw = o.noWall || {};
    if (!nw.n) wallAlongX(z0 - t / 2, x0 - t, x1 + t, y0, y0 + h, t, wm, op.n);
    if (!nw.s) wallAlongX(z1 + t / 2, x0 - t, x1 + t, y0, y0 + h, t, wm, op.s);
    if (!nw.w) wallAlongZ(x0 - t / 2, z0 - t, z1 + t, y0, y0 + h, t, wm, op.w);
    if (!nw.e) wallAlongZ(x1 + t / 2, z0 - t, z1 + t, y0, y0 + h, t, wm, op.e);
    stats.rooms++;
    return { x0: x0, x1: x1, z0: z0, z1: z1, y0: y0, h: h };
  }

  /**
   * Pasillo. Los DOS lados largos llevan muro (pueden abrirse con `op`);
   * los extremos llevan tapa salvo que se listen en `open` (por defecto los
   * extremos quedan TAPADOS: hay que abrir explícitamente el que conecta).
   * o = { y0, height, t, floor, wall, ceil, op:{n,s,e,w}, open:['n',...] }
   */
  function corridor(x0, x1, z0, z1, o) {
    o = o || {};
    var y0 = o.y0 || 0;
    var h = o.height || 3.9;
    var t = o.t === undefined ? 0.6 : o.t;
    var alongX = (x1 - x0) > (z1 - z0);
    var fm = o.floor || 'mat_metal_floor';
    var wm = o.wall || 'mat_metal_panel';
    var cm = o.ceil || 'mat_ceiling_tile';
    var cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    var op = o.op || {};
    var open = o.open || [];
    function isOpen(s) { for (var i = 0; i < open.length; i++) if (open[i] === s) return true; return false; }
    var cre = o.collide !== false;

    if (o.noFloor !== true) box([cx, y0 - t / 2, cz], [x1 - x0, t, z1 - z0], fm, { collide: cre });
    /* el techo se ensancha SOLO sobre los muros laterales (no invade zonas vecinas) */
    if (o.noCeil !== true) {
      box([cx, y0 + h + t / 2, cz],
        [x1 - x0 + (alongX ? 0 : t * 2), t, z1 - z0 + (alongX ? t * 2 : 0)], cm, { collide: cre });
    }
    if (alongX) {
      if (o.wallN !== false) wallAlongX(z0 - t / 2, x0 - t * 0.5, x1 + t * 0.5, y0, y0 + h, t, wm, op.n);
      if (o.wallS !== false) wallAlongX(z1 + t / 2, x0 - t * 0.5, x1 + t * 0.5, y0, y0 + h, t, wm, op.s);
      if (!isOpen('w')) wallAlongZ(x0 - t / 2, z0 - t * 0.5, z1 + t * 0.5, y0, y0 + h, t, wm, op.w);
      if (!isOpen('e')) wallAlongZ(x1 + t / 2, z0 - t * 0.5, z1 + t * 0.5, y0, y0 + h, t, wm, op.e);
    } else {
      if (o.wallW !== false) wallAlongZ(x0 - t / 2, z0 - t * 0.5, z1 + t * 0.5, y0, y0 + h, t, wm, op.w);
      if (o.wallE !== false) wallAlongZ(x1 + t / 2, z0 - t * 0.5, z1 + t * 0.5, y0, y0 + h, t, wm, op.e);
      if (!isOpen('n')) wallAlongX(z0 - t / 2, x0 - t * 0.5, x1 + t * 0.5, y0, y0 + h, t, wm, op.n);
      if (!isOpen('s')) wallAlongX(z1 + t / 2, x0 - t * 0.5, x1 + t * 0.5, y0, y0 + h, t, wm, op.s);
    }
    stats.corridors++;
    return { x0: x0, x1: x1, z0: z0, z1: z1, y0: y0, h: h };
  }

  /* Pilar cuadrado. */
  function pillar(x, z, w, h, mat, y0) {
    return box([x, (y0 || 0) + h / 2, z], [w, h, w], mat || 'mat_concrete_wall');
  }

  /* Barandilla de 1.1 m: pasamanos + 2 postes. `dir` 'x'|'z'. */
  function rail(x0, z0, x1, z1, y, mat) {
    mat = mat || 'mat_metal_panel';
    if (x1 - x0 > 0.05) {
      box([(x0 + x1) / 2, y + 1.05, z0], [x1 - x0, 0.1, 0.1], mat);
      box([(x0 + x1) / 2, y + 0.55, z0], [x1 - x0, 0.06, 0.06], mat);
      var n = Math.max(1, Math.round((x1 - x0) / 2.2));
      for (var i = 0; i <= n; i++) {
        var x = x0 + (x1 - x0) * (i / n);
        box([x, y + 0.55, z0], [0.1, 1.1, 0.1], mat);
      }
    } else {
      box([x0, y + 1.05, (z0 + z1) / 2], [0.1, 0.1, z1 - z0], mat);
      box([x0, y + 0.55, (z0 + z1) / 2], [0.06, 0.06, z1 - z0], mat);
      var m = Math.max(1, Math.round((z1 - z0) / 2.2));
      for (var k = 0; k <= m; k++) {
        var z = z0 + (z1 - z0) * (k / m);
        box([x0, y + 0.55, z], [0.1, 1.1, 0.1], mat);
      }
    }
  }

  /* Tira emisiva en el techo o la pared (decorativa, sin colisión). */
  function strip(pos, size, mat, intensity) {
    var b = box(pos, size, mat, { collide: false, emissive: intensity || 1 });
    stats.emissive++;
    return b;
  }

  /* Fluorescente: caja metálica + tira emisiva + luz horneada. */
  function ceilingLamp(x, y, z, color, radius, intensity, len, alongX) {
    len = len || 2.4;
    var size = alongX ? [len, 0.18, 0.34] : [0.34, 0.18, len];
    box([x, y + 0.2, z], [size[0], 0.16, size[2]], 'mat_metal_panel', { collide: false });
    strip([x, y, z], size, color === 'red' ? 'mat_strip_red' : 'mat_strip_cyan', 1);
    var c = (color === 'red') ? [1.0, 0.3, 0.24] : (color === 'warm' ? [1.0, 0.82, 0.6] : [0.55, 0.78, 1.0]);
    lamp([x, y - 0.3, z], c, radius, intensity);
  }

  /* Baliza de emergencia (caja emisiva + luz). */
  function beaconLight(x, y, z, color, radius, intensity) {
    box([x, y, z], [0.4, 0.4, 0.4], 'mat_metal_panel');
    strip([x, y + 0.28, z], [0.34, 0.16, 0.34], color || 'mat_beacon', 1);
    lamp([x, y + 0.3, z], (color === 'mat_strip_red') ? [1.0, 0.25, 0.2] : [1.0, 0.66, 0.25], radius || 7, intensity || 0.8);
  }

  /* Consola: cuerpo, pantalla emisiva, tira inferior y luz. `y0` = suelo donde apoya. */
  function consoleUnit(x, z, rotY, mat, screenMat, y0) {
    y0 = y0 || 0;
    prop([x, y0 + 0.55, z], [2.6, 1.05, 0.95], rotY, mat || 'mat_metal_panel');
    var c = Math.cos(rotY), s = Math.sin(rotY);
    box([x - s * 0.28, y0 + 1.42, z - c * 0.28], [2.3, 1.05, 0.12], screenMat || 'mat_terminal', { emissive: 1, rotY: rotY });
    strip([x - s * 0.5, y0 + 0.12, z - c * 0.5], [2.3, 0.1, 0.5], 'mat_strip_cyan', 1);
    lamp([x - s * 1.2, y0 + 1.5, z - c * 1.2], [0.45, 0.95, 1.0], 6, 0.55);
  }

  /* Estantería industrial: 2 montantes + 4 baldas. */
  function shelfRow(cx, cz, len, alongX, mat, y0) {
    var h = 3.4;
    var d = 1.2;
    y0 = y0 || 0;
    var sx = alongX ? len : d;
    var sz = alongX ? d : len;
    box([cx, y0 + h / 2, cz], [alongX ? 0.22 : d, h, alongX ? d : 0.22], mat, { collide: false });
    for (var i = 1; i <= 4; i++) {
      box([cx, y0 + (h / 4) * i - 0.09, cz], [sx, 0.18, sz], mat);
    }
    /* montantes en los extremos */
    var half = len / 2 - 0.12;
    if (alongX) {
      box([cx - half, y0 + h / 2, cz], [0.2, h, d], mat);
      box([cx + half, y0 + h / 2, cz], [0.2, h, d], mat);
    } else {
      box([cx, y0 + h / 2, cz - half], [d, h, 0.2], mat);
      box([cx, y0 + h / 2, cz + half], [d, h, 0.2], mat);
    }
  }

  /* Pila de cajas (cobertura). */
  function crateStack(x, z, seed, mat) {
    var rng = BS.RNG.create(seed >>> 0);
    var base = mat || 'mat_crate';
    box([x, 0.5, z], [1.1, 1, 1.1], base);
    box([x, 1.5, z], [0.95, 0.9, 0.95], base);
    if (rng() < 0.7) box([x + 0.75, 0.45, z + 0.4], [0.9, 0.9, 0.9], base, { rotY: 0 });
    if (rng() < 0.5) box([x - 0.7, 0.4, z - 0.55], [0.8, 0.8, 0.8], base);
    if (rng() < 0.45) box([x, 2.35, z], [0.8, 0.75, 0.8], base);
  }

  /* Caja de suministros suelta. */
  function crate(x, y, z, s, rotY, mat) {
    s = s || 0.9;
    return prop([x, y + s / 2, z], [s, s, s], rotY || 0, mat || 'mat_crate');
  }

  /* Contenedor de carga (prop rotado). */
  function container(x, z, rotY, mat) {
    var b = prop([x, 1.35, z], [6.1, 2.7, 2.45], rotY, mat || 'mat_rust');
    var c = Math.cos(rotY), s = Math.sin(rotY);
    strip([x + c * 0.2, 2.55, z - s * 0.2], [5.6, 0.12, 2.1], 'mat_strip_cyan', 0.6);
    return b;
  }

  /* Tubería horizontal con soportes. */
  function pipeRun(x0, z0, x1, z1, y, radius) {
    var dx = x1 - x0, dz = z1 - z0;
    var len = Math.sqrt(dx * dx + dz * dz);
    if (len < 0.1) return;
    var alongX = Math.abs(dx) > Math.abs(dz);
    cyl([(x0 + x1) / 2, y, (z0 + z1) / 2], radius || 0.18, len, 8, alongX ? 'x' : 'z', 'mat_pipe', { collide: false });
    var n = Math.max(1, Math.round(len / 6));
    for (var i = 1; i < n; i++) {
      var t = i / n;
      box([x0 + dx * t, y + 0.3, z0 + dz * t], [0.12, 0.6, 0.12], 'mat_pipe', { collide: false });
    }
  }

  /* Rejilla de alcantarilla / trampilla en el suelo (decorativa). */
  function gratePanel(x, z, s, mat) {
    box([x, 0.02, z], [s, 0.06, s], mat || 'mat_grate', { collide: false });
  }

  /* Módulo de ordenador de pared con luz. */
  function wallScreen(x, y, z, w, h, rotY) {
    box([x, y, z], [w, h, 0.18], 'mat_terminal', { emissive: 1, rotY: rotY || 0 });
    lamp([x, y, z + 1.5], [0.4, 0.9, 1.0], 6, 0.5);
  }

  /* ======================================================================
   * Zonas de la misión K-7
   * ----------------------------------------------------------------------
   * Recorrido: VESTÍBULO -> ATRIO -> {CONTROL (E) | ALMACÉN (O)} y ATRIO ->
   * pasillo en L -> REACTOR -> BAHÍA DE LANZAMIENTO (objetivo final).
   * ==================================================================== */
  var Z = {
    vest: { x0: -4, x1: 4, z0: 14, z1: 22, h: 3.6 },
    atrium: { x0: -14, x1: 14, z0: -14, z1: 14, h: 7 },
    corrE: { x0: 14, x1: 30, z0: -2, z1: 2, h: 3.9 },
    ctrl: { x0: 30, x1: 54, z0: -12, z1: 12, h: 6 },
    corrW: { x0: -28, x1: -14, z0: -2, z1: 2, h: 3.9 },
    store: { x0: -52, x1: -28, z0: -12, z1: 12, h: 7 },
    corrL1: { x0: 2, x1: 6, z0: -30, z1: -14, h: 3.9 },
    corrL2: { x0: 6, x1: 34, z0: -30, z1: -26, h: 3.9 },
    react: { x0: 34, x1: 58, z0: -50, z1: -26, h: 9 },
    corrBay: { x0: 58, x1: 72, z0: -46, z1: -42, h: 3.9 },
    bay: { x0: 72, x1: 100, z0: -56, z1: -28, h: 10 }
  };

  /* --- Z1: vestíbulo de acceso (punto de aparición) ------------------- */
  function zoneVestibule() {
    var h = Z.vest.h;
    room(Z.vest.x0, Z.vest.x1, Z.vest.z0, Z.vest.z1, {
      height: h,
      floor: 'mat_metal_floor', wall: 'mat_concrete_wall', ceil: 'mat_ceiling_tile',
      noWall: { n: true }            /* lo cierra el muro sur del atrio */
    });
    ceilingLamp(0, h - 0.22, 18.7, 'cyan', 9.5, 0.95, 2.8, true);
    ceilingLamp(-2.4, h - 0.22, 15.6, 'cyan', 7, 0.7, 1.8, false);
    ceilingLamp(2.4, h - 0.22, 15.6, 'cyan', 7, 0.7, 1.8, false);
    /* puerta blindada de salida, atrancada desde el otro lado */
    prop([0, 1.7, 21.35], [3.6, 3.4, 0.32], 0, 'mat_door');
    box([0, 1.75, 21.05], [3.9, 0.22, 0.16], 'mat_metal_panel');
    strip([0, 3.02, 21.18], [1.9, 0.34, 0.1], 'mat_beacon', 1.1);
    lamp([0, 2.9, 20.4], [1.0, 0.72, 0.32], 6, 0.55);
    wallScreen(-3.36, 2.35, 18.4, 1.5, 1.0, Math.PI / 2);
    wallScreen(3.36, 2.35, 18.4, 1.5, 1.0, -Math.PI / 2);
    strip([-3.7, 0.06, 18], [0.18, 0.08, 15.4], 'mat_strip_cyan', 0.6);
    strip([3.7, 0.06, 18], [0.18, 0.08, 15.4], 'mat_strip_cyan', 0.6);
    gratePanel(0, 19.5, 1.3);
    crate(-3.0, 0, 20.5, 0.85, 0.35);
    crate(3.1, 0, 20.3, 0.8, -0.22);
    box([-3.5, 0.55, 15.6], [0.9, 1.1, 0.9], 'mat_crate');
    pipeRun(-3.5, 14.2, -3.5, 21.4, 3.15, 0.16);
    pipeRun(3.5, 14.2, 3.5, 21.4, 3.15, 0.16);
  }

  /* --- Z2: atrio central (nodo de la instalación) --------------------- */
  function zoneAtrium() {
    var h = Z.atrium.h;
    room(Z.atrium.x0, Z.atrium.x1, Z.atrium.z0, Z.atrium.z1, {
      height: h,
      floor: 'mat_concrete_floor', wall: 'mat_concrete_wall', ceil: 'mat_ceiling_tile',
      op: {
        e: [{ a0: -2, a1: 2, y0: 0, y1: 3.9 }],   /* -> corredor este  */
        w: [{ a0: -2, a1: 2, y0: 0, y1: 3.9 }],   /* -> corredor oeste */
        n: [{ a0: 2, a1: 6, y0: 0, y1: 3.9 }],    /* -> pasillo en L   */
        s: [{ a0: -2, a1: 2, y0: 0, y1: 3.0 }]    /* -> vestíbulo      */
      }
    });

    /* plataforma central de mando, accesible por dos rampas opuestas */
    box([0, 0.55, 0], [8, 1.1, 8], 'mat_metal_floor');
    box([0, 1.12, 0], [7.2, 0.05, 7.2], 'mat_grate', { collide: false });
    wedge([5.5, 0.55, 0], [3, 1.1, 4.2], '-x', 'mat_metal_floor');
    wedge([-5.5, 0.55, 0], [3, 1.1, 4.2], '+x', 'mat_metal_floor');
    rail(-3.5, 3.85, 3.5, 3.85, 1.1);
    rail(-3.5, -3.85, 3.5, -3.85, 1.1);
    consoleUnit(0, -2.4, Math.PI, 'mat_metal_panel', 'mat_terminal', 1.1);
    consoleUnit(-2.6, -2.4, Math.PI, 'mat_metal_panel', 'mat_terminal', 1.1);
    consoleUnit(-7, 13.2, 0, 'mat_metal_panel', 'mat_terminal', 0);
    consoleUnit(-9.6, 13.2, 0, 'mat_metal_panel', 'mat_terminal', 0);
    strip([0, 1.16, 0], [6.2, 0.06, 0.3], 'mat_strip_cyan', 0.8);
    lamp([0, 2.6, 0], [0.4, 0.85, 1.0], 8, 0.6);

    /* entrepiso con escalera (borde oeste en x=6: deja libre el vano norte) */
    box([9.7, 1.7, -10.2], [7.4, 3.4, 6.4], 'mat_metal_floor');
    box([9.7, 3.42, -10.2], [7.2, 0.05, 6.2], 'mat_grate', { collide: false });
    stairs([8.5, 1.7, -3], [3, 3.4, 8], 14, '-z', 'mat_metal_floor');
    rail(6.25, -13.3, 6.25, -7.2, 3.4);
    rail(6.4, -7.1, 6.9, -7.1, 3.4);
    rail(10.2, -7.1, 13.3, -7.1, 3.4);
    strip([9.7, 3.46, -13.1], [6.6, 0.06, 0.22], 'mat_strip_red', 0.7);
    lamp([9.7, 5.4, -10.2], [1.0, 0.45, 0.3], 8, 0.5);
    crateStack(11.6, -8.6, 0x51, 'mat_crate');
    crateStack(12.4, -12.2, 0x77, 'mat_crate');

    /* pilares y cobertura en planta baja */
    pillar(-11.5, -5.5, 1.2, h, 'mat_concrete_wall');
    pillar(11.5, 5.5, 1.2, h, 'mat_concrete_wall');
    pillar(-11.5, 5.5, 1.2, h, 'mat_concrete_wall');
    pillar(11.5, -5.5, 1.2, h, 'mat_concrete_wall');
    crateStack(-11.2, -11.4, 0x11, 'mat_crate');
    crateStack(-9.6, -12.3, 0x22, 'mat_crate');
    crateStack(11.9, 12.2, 0x33, 'mat_crate');
    crateStack(-12.1, 12.1, 0x44, 'mat_crate');
    box([-7.2, 0.5, -12.2], [4.4, 1.0, 1.0], 'mat_rust');
    box([7.4, 0.5, 12.2], [4.4, 1.0, 1.0], 'mat_rust');
    container(10.5, 9.0, 0, 'mat_rust');
    gratePanel(0, 8.6, 1.6);
    gratePanel(0, -8.6, 1.6);

    /* iluminación */
    ceilingLamp(-7, h - 0.25, -7, 'cyan', 13, 0.95, 3.2, true);
    ceilingLamp(7, h - 0.25, 7, 'cyan', 13, 0.95, 3.2, true);
    ceilingLamp(-7, h - 0.25, 7, 'cyan', 11, 0.85, 3.2, true);
    ceilingLamp(7, h - 0.25, -3, 'cyan', 13, 0.9, 3.2, false);
    ceilingLamp(-2.5, h - 0.25, 0, 'warm', 10, 0.6, 2.4, false);
    ceilingLamp(2.5, h - 0.25, 0, 'warm', 10, 0.6, 2.4, false);
    beaconLight(-13.6, 4.6, 6, 'mat_strip_red', 8, 0.85);
    beaconLight(13.6, 4.6, -6, 'mat_strip_red', 8, 0.85);
    beaconLight(-13.6, 4.6, -6, 'mat_strip_red', 8, 0.85);
    beaconLight(13.6, 4.6, 6, 'mat_strip_red', 8, 0.85);
    wallScreen(-13.6, 2.6, 10.5, 2.0, 1.2, Math.PI / 2);
    wallScreen(13.6, 2.6, -10.5, 2.0, 1.2, -Math.PI / 2);
    strip([0, 0.06, 13.2], [3.6, 0.08, 0.2], 'mat_strip_cyan', 0.7);
    strip([0, 0.06, -13.2], [3.6, 0.08, 0.2], 'mat_strip_cyan', 0.7);
  }

  /* --- Adorno común de pasillos: luces, tuberías y guías del suelo ---- */
  function corridorDressing(c, o) {
    o = o || {};
    var h = c.h;
    var alongX = (c.x1 - c.x0) > (c.z1 - c.z0);
    var len = alongX ? (c.x1 - c.x0) : (c.z1 - c.z0);
    var cx = (c.x0 + c.x1) / 2, cz = (c.z0 + c.z1) / 2;
    var n = Math.max(2, Math.round(len / 6));
    var i, t;
    for (i = 0; i < n; i++) {
      t = (i + 0.5) / n;
      if (alongX) ceilingLamp(c.x0 + (c.x1 - c.x0) * t, h - 0.22, cz, o.color || 'cyan', 8, 0.85, 2.2, true);
      else ceilingLamp(cx, h - 0.22, c.z0 + (c.z1 - c.z0) * t, o.color || 'cyan', 8, 0.85, 2.2, false);
    }
    if (alongX) {
      pipeRun(c.x0 + 0.4, c.z0 + 0.45, c.x1 - 0.4, c.z0 + 0.45, h - 0.42, 0.16);
      pipeRun(c.x0 + 0.4, c.z1 - 0.45, c.x1 - 0.4, c.z1 - 0.45, h - 0.58, 0.12);
      strip([cx, 0.06, c.z0 + 0.32], [len - 1.2, 0.08, 0.16], o.strip || 'mat_strip_cyan', 0.6);
      strip([cx, 0.06, c.z1 - 0.32], [len - 1.2, 0.08, 0.16], o.strip || 'mat_strip_cyan', 0.6);
    } else {
      pipeRun(c.x0 + 0.45, c.z0 + 0.4, c.x0 + 0.45, c.z1 - 0.4, h - 0.42, 0.16);
      pipeRun(c.x1 - 0.45, c.z0 + 0.4, c.x1 - 0.45, c.z1 - 0.4, h - 0.58, 0.12);
      strip([c.x0 + 0.32, 0.06, cz], [0.16, 0.08, len - 1.2], o.strip || 'mat_strip_cyan', 0.6);
      strip([c.x1 - 0.32, 0.06, cz], [0.16, 0.08, len - 1.2], o.strip || 'mat_strip_cyan', 0.6);
    }
    if (o.beacon) beaconLight(cx, h - 1.1, cz, 'mat_strip_red', 6, 0.6);
  }

  /* --- Z3/Z5: pasillos de conexión ------------------------------------ */
  function zoneCorridors() {
    var c;
    c = Z.corrE;
    corridor(c.x0, c.x1, c.z0, c.z1, { open: ['w', 'e'] });
    corridorDressing(c, {});
    gratePanel(20, 0, 1.1);
    crate(24.5, 0, 1.35, 0.75, 0.2);
    strip([c.x1 - 0.6, 2.6, 0], [0.14, 0.1, 3.2], 'mat_strip_cyan', 0.8);

    c = Z.corrW;
    corridor(c.x0, c.x1, c.z0, c.z1, { open: ['e', 'w'] });
    corridorDressing(c, {});
    gratePanel(-21, 0, 1.1);
    crate(-26.4, 0, -1.3, 0.8, -0.3);
    strip([c.x0 + 0.6, 2.6, 0], [0.14, 0.1, 3.2], 'mat_strip_cyan', 0.8);

    c = Z.corrL1;                       /* tramo vertical del pasillo en L */
    corridor(c.x0, c.x1, c.z0, c.z1, {
      open: ['s', 'e'],
      op: { e: [{ a0: -30, a1: -26, y0: 0, y1: 3.9 }] }
    });
    corridorDressing(c, {});
    beaconLight(2.6, 2.8, -18, 'mat_strip_red', 6, 0.6);
    beaconLight(5.4, 2.8, -27.5, 'mat_strip_red', 6, 0.6);
    pipeRun(2.35, -29.4, 2.35, -14.4, 0.35, 0.22);
    pipeRun(5.65, -29.4, 5.65, -14.4, 0.35, 0.22);

    c = Z.corrL2;                       /* tramo horizontal del pasillo en L */
    corridor(c.x0, c.x1, c.z0, c.z1, { open: ['w', 'e'] });
    corridorDressing(c, { color: 'warm' });
    gratePanel(14, -28, 1.2);
    crate(20, 0, -26.9, 0.8, 0.4);
    box([26.5, 0.5, -26.8], [1.6, 1.0, 1.2], 'mat_crate');
    strip([30, 3.0, -28], [0.16, 0.1, 3.0], 'mat_strip_red', 0.9);

    c = Z.corrBay;
    corridor(c.x0, c.x1, c.z0, c.z1, { open: ['w', 'e'] });
    corridorDressing(c, { color: 'warm' });
    pipeRun(58.4, -45.5, 71.6, -45.5, 1.1, 0.2);
    pipeRun(58.4, -42.5, 71.6, -42.5, 1.1, 0.2);
    strip([65, 3.0, -44], [0.16, 0.1, 3.4], 'mat_strip_red', 0.9);
  }

  /* --- Z4: sala de control (objetivo "energía") ----------------------- */
  function zoneControl() {
    var c = Z.ctrl, h = c.h;
    var i, x;
    room(c.x0, c.x1, c.z0, c.z1, {
      height: h, floor: 'mat_metal_floor', wall: 'mat_metal_panel', ceil: 'mat_ceiling_tile',
      op: { w: [{ a0: -2, a1: 2, y0: 0, y1: 3.9 }] }
    });

    /* suelo técnico de rejilla del lado norte + guía luminosa */
    box([42, 0.05, -9.6], [22, 0.1, 4.8], 'mat_grate', { collide: false });
    strip([42, 0.13, -11.85], [22, 0.1, 0.22], 'mat_strip_cyan', 0.7);

    /* consola principal de energía (objetivo "power") */
    prop([44, 0.75, -11.0], [4.2, 1.5, 1.1], Math.PI, 'mat_metal_panel');
    box([44, 1.78, -10.85], [3.9, 1.3, 0.14], 'mat_terminal', { emissive: 1 });
    strip([44, 1.44, -10.72], [3.9, 0.1, 0.5], 'mat_strip_red', 1.2);
    lamp([44, 1.95, -10.3], [1.0, 0.45, 0.35], 7, 0.7);
    beaconLight(41.6, 1.1, -10.6, 'mat_strip_red', 5, 0.6);
    beaconLight(46.4, 1.1, -10.6, 'mat_strip_red', 5, 0.6);

    /* bancada de consolas secundarias contra el muro norte */
    var xs = [34, 37.4, 49, 52.4];
    for (i = 0; i < xs.length; i++) consoleUnit(xs[i], -11.2, Math.PI, 'mat_metal_panel', 'mat_terminal', 0);

    /* mesas de operaciones en el centro */
    box([40, 0.38, -3], [6.4, 0.76, 1.7], 'mat_metal_panel');
    box([40, 0.79, -3], [5.9, 0.06, 1.4], 'mat_grate', { collide: false });
    box([40, 0.5, -6.2], [6.4, 1.0, 1.7], 'mat_metal_panel');
    box([40, 1.03, -6.2], [5.9, 0.06, 1.4], 'mat_grate', { collide: false });
    for (i = 0; i < 5; i++) {
      x = 37.6 + i * 1.4;
      box([x, 1.06, -3], [0.72, 0.52, 0.12], 'mat_terminal', { emissive: 1 });
      box([x, 1.26, -6.2], [0.72, 0.52, 0.12], 'mat_terminal', { emissive: 1 });
    }
    consoleUnit(38, -5.6, 0, 'mat_metal_panel', 'mat_terminal', 1.0);
    consoleUnit(44, -5.6, 0, 'mat_metal_panel', 'mat_terminal', 1.0);

    /* armarios de servidores contra el muro sur */
    for (i = 0; i < 7; i++) {
      x = 33 + i * 3.2;
      box([x, 1.05, 11.2], [1.0, 2.1, 1.0], 'mat_metal_panel');
      strip([x, 2.16, 11.2], [0.92, 0.1, 0.92], 'mat_strip_cyan', 0.9);
    }
    lamp([44, 2.4, 11.2], [0.4, 0.8, 1.0], 6, 0.45);

    /* iluminación general y balizas */
    ceilingLamp(34, h - 0.25, -7, 'cyan', 11, 0.9, 3.0, true);
    ceilingLamp(42, h - 0.25, -7, 'cyan', 11, 0.9, 3.0, true);
    ceilingLamp(50, h - 0.25, -7, 'cyan', 11, 0.9, 3.0, true);
    ceilingLamp(34, h - 0.25, 6, 'cyan', 11, 0.85, 3.0, true);
    ceilingLamp(42, h - 0.25, 6, 'cyan', 11, 0.85, 3.0, true);
    ceilingLamp(50, h - 0.25, 6, 'cyan', 11, 0.85, 3.0, true);
    beaconLight(31.2, 3.2, -6, 'mat_strip_red', 7, 0.7);
    beaconLight(31.2, 3.2, 6, 'mat_strip_red', 7, 0.7);
    wallScreen(53.5, 2.6, -4, 2.2, 1.3, -Math.PI / 2);
    wallScreen(53.5, 2.6, 4, 2.2, 1.3, -Math.PI / 2);
  }

  /* --- Z6: almacén (objetivo "arma pesada") --------------------------- */
  function zoneStorage() {
    var c = Z.store, h = c.h;
    var i, zs = [-8, -5, 5, 8];
    room(c.x0, c.x1, c.z0, c.z1, {
      height: h, floor: 'mat_concrete_floor', wall: 'mat_concrete_wall', ceil: 'mat_ceiling_tile',
      op: { e: [{ a0: -2, a1: 2, y0: 0, y1: 3.9 }] }
    });

    /* muelle de carga elevado (1.2 m) con rampa */
    box([-49, 0.6, 0], [6, 1.2, 4.4], 'mat_metal_floor');
    wedge([-44, 0.6, 0], [4, 1.2, 4.4], '-x', 'mat_metal_floor');
    rail(-51.8, 2.25, -46.2, 2.25, 1.2);
    rail(-51.8, -2.25, -46.2, -2.25, 1.2);
    strip([-49, 1.26, 2.0], [5.6, 0.06, 0.2], 'mat_strip_cyan', 0.8);
    box([-49.5, 1.75, -1.4], [3.0, 1.1, 1.1], 'mat_crate');

    /* estanterías industriales (dos bloques con pasillo central) */
    for (i = 0; i < zs.length; i++) {
      shelfRow(-47, zs[i], 6, true, 'mat_metal_panel');
      shelfRow(-37, zs[i], 6, true, 'mat_metal_panel');
    }
    shelfRow(-31, -8.5, 6, false, 'mat_metal_panel');
    shelfRow(-29.8, 3.2, 4, false, 'mat_metal_panel');

    /* carga suelta y contenedores */
    container(-31.5, 8.0, 0, 'mat_rust');
    crateStack(-44.5, 9.0, 0x91, 'mat_crate');
    crateStack(-34, -10.5, 0x92, 'mat_crate');
    crateStack(-29.6, 10.4, 0x93, 'mat_crate');
    crate(-50.0, 0, -3.4, 0.9, 0.3);
    crate(-48.6, 0, -3.4, 0.8, -0.1);
    gratePanel(-43, 4.6, 1.4);
    gratePanel(-33, -2.2, 1.4);

    /* instalación: tuberías, muros con pantallas y luces */
    pipeRun(-51.6, -11.4, -28.6, -11.4, 5.2, 0.2);
    pipeRun(-51.6, 11.4, -28.6, 11.4, 5.2, 0.2);
    pipeRun(-51.6, -11.4, -51.6, 11.4, 4.4, 0.16);
    ceilingLamp(-49, h - 0.3, -8, 'cyan', 12, 0.85, 2.8, false);
    ceilingLamp(-49, h - 0.3, 8, 'cyan', 12, 0.85, 2.8, false);
    ceilingLamp(-39, h - 0.3, 0, 'cyan', 13, 0.95, 2.8, false);
    ceilingLamp(-31, h - 0.3, 0, 'cyan', 12, 0.9, 2.8, false);
    ceilingLamp(-44, h - 0.3, 0, 'warm', 10, 0.6, 2.4, false);
    beaconLight(-28.6, 3.4, -9, 'mat_strip_red', 8, 0.8);
    beaconLight(-28.6, 3.4, 9, 'mat_strip_red', 8, 0.8);
    beaconLight(-50, 3.4, -11.2, 'mat_strip_red', 8, 0.8);
    wallScreen(-51.6, 2.7, -6, 2.4, 1.3, Math.PI / 2);
    wallScreen(-51.6, 2.7, 6, 2.4, 1.3, Math.PI / 2);
  }

  /* --- Z7: reactor (núcleo, pasarela y balizas) ----------------------- */
  function zoneReactor() {
    var c = Z.react, h = c.h;
    var i;
    room(c.x0, c.x1, c.z0, c.z1, {
      height: h, floor: 'mat_metal_floor', wall: 'mat_concrete_wall', ceil: 'mat_ceiling_tile',
      op: {
        w: [{ a0: -30, a1: -26, y0: 0, y1: 3.9 }],
        e: [{ a0: -46, a1: -42, y0: 0, y1: 3.9 }]
      }
    });

    /* basamento y núcleo */
    box([46, 0.5, -38], [8, 1.0, 8], 'mat_metal_floor');
    box([46, 1.02, -38], [7.6, 0.05, 7.6], 'mat_grate', { collide: false });
    wedge([46, 0.5, -32.5], [3, 1.0, 3], '-z', 'mat_metal_floor');
    cyl([46, 5.0, -38], 3.0, 8.0, 14, 'y', 'mat_metal_panel');
    /* franjas emisivas verticales del núcleo */
    strip([46, 5.6, -41.02], [0.6, 5.2, 0.14], 'mat_strip_cyan', 1.3);
    strip([46, 5.6, -34.98], [0.6, 5.2, 0.14], 'mat_strip_cyan', 1.3);
    strip([42.98, 5.6, -38], [0.14, 5.2, 0.6], 'mat_strip_cyan', 1.3);
    strip([49.02, 5.6, -38], [0.14, 5.2, 0.6], 'mat_strip_cyan', 1.3);
    strip([46, 8.9, -38], [2.6, 0.2, 2.6], 'mat_beacon', 1.4);
    lamp([46, 6.2, -38], [0.45, 0.9, 1.0], 22, 1.1);
    lamp([46, 3.4, -38], [1.0, 0.5, 0.35], 12, 0.6);

    /* pasarela elevada (3.6 m) con escalera */
    box([46, 1.8, -45.5], [20, 3.6, 3.0], 'mat_metal_floor');
    box([46, 3.62, -45.5], [19.6, 0.04, 2.8], 'mat_grate', { collide: false });
    stairs([37.5, 1.8, -41], [3, 3.6, 6], 15, '-z', 'mat_metal_floor');
    rail(39.6, -44.05, 55.8, -44.05, 3.6);
    rail(35.8, -44.05, 36.1, -44.05, 3.6);
    rail(36.2, -46.95, 55.8, -46.95, 3.6);
    rail(36.2, -46.9, 36.2, -44.1, 3.6);
    rail(55.8, -46.9, 55.8, -44.1, 3.6);
    strip([46, 3.66, -46.9], [18, 0.06, 0.2], 'mat_strip_red', 0.8);
    box([44, 5.2, -49.6], [3.4, 0.9, 0.2], 'mat_terminal', { emissive: 1 });
    consoleUnit(50, -46.4, Math.PI, 'mat_metal_panel', 'mat_terminal', 3.6);
    lamp([46, 6.4, -45.5], [0.5, 0.85, 1.0], 10, 0.5);
    lamp([38, 5.0, -41], [0.5, 0.85, 1.0], 7, 0.45);

    /* cobertura y carga */
    crateStack(36.5, -29.5, 0xA1, 'mat_crate');
    crateStack(40, -32, 0xA2, 'mat_crate');
    box([52, 0.6, -42.5], [5, 1.2, 1.0], 'mat_rust');
    box([54.5, 0.5, -30], [4, 1.0, 1.0], 'mat_rust');
    box([36.5, 0.55, -37], [1.2, 1.1, 1.2], 'mat_crate');
    gratePanel(46, -28.5, 1.8);

    /* instalación: tuberías, pantallas y balizas */
    pipeRun(34.6, -49.4, 57.4, -49.4, 7.4, 0.24);
    pipeRun(34.6, -26.6, 57.4, -26.6, 7.4, 0.24);
    pipeRun(34.6, -49.4, 34.6, -26.6, 7.4, 0.18);
    pipeRun(57.4, -49.4, 57.4, -26.6, 7.4, 0.18);
    beaconLight(35.2, 4.2, -34, 'mat_strip_red', 9, 0.9);
    beaconLight(56.8, 4.2, -32, 'mat_strip_red', 9, 0.9);
    beaconLight(35.2, 4.2, -46, 'mat_strip_red', 9, 0.9);
    beaconLight(56.8, 4.2, -48, 'mat_strip_red', 9, 0.9);
    ceilingLamp(40, h - 0.3, -32, 'cyan', 14, 0.9, 3.0, true);
    ceilingLamp(52, h - 0.3, -32, 'cyan', 14, 0.9, 3.0, true);
    ceilingLamp(40, h - 0.3, -46, 'cyan', 12, 0.8, 3.0, true);
    ceilingLamp(52, h - 0.3, -46, 'cyan', 12, 0.8, 3.0, true);
    for (i = 0; i < 4; i++) strip([34.6, 1.6 + i * 0.9, -34], [0.16, 0.12, 4.0], 'mat_strip_red', 0.7);
    wallScreen(57.4, 2.8, -36, 2.6, 1.4, -Math.PI / 2);
  }

  /* --- Z8: bahía de lanzamiento (objetivo final) ---------------------- */
  function zoneBay() {
    var c = Z.bay, h = c.h;
    var i;
    room(c.x0, c.x1, c.z0, c.z1, {
      height: h, floor: 'mat_concrete_floor', wall: 'mat_concrete_wall', ceil: 'mat_metal_floor',
      op: { w: [{ a0: -46, a1: -42, y0: 0, y1: 3.9 }] }
    });

    /* plataforma de hormigón y marcas de pista */
    box([86, 0.08, -42], [26, 0.16, 26], 'mat_metal_floor', { collide: false });
    strip([86, 0.18, -29.4], [26, 0.1, 0.3], 'mat_strip_cyan', 0.9);
    for (i = 0; i < 5; i++) gratePanel(74 + i * 6, -55, 1.6);

    /* TORRE DE BALIZA (objetivo "beacon") */
    box([86, 2.5, -42], [3.2, 5.0, 3.2], 'mat_metal_panel');
    box([86, 5.1, -42], [4.0, 0.4, 4.0], 'mat_metal_panel');
    for (i = 0; i < 4; i++) {
      var ox = (i === 0 ? 1.62 : (i === 1 ? -1.62 : 0));
      var oz = (i === 2 ? 1.62 : (i === 3 ? -1.62 : 0));
      strip([86 + ox, 2.6, -42 + oz], [ox === 0 ? 0.5 : 0.14, 4.2, oz === 0 ? 0.5 : 0.14], 'mat_strip_red', 1.1);
    }
    box([86, 5.5, -42], [1.6, 1.0, 1.6], 'mat_pipe');
    strip([86, 6.2, -42], [2.4, 1.0, 2.4], 'mat_beacon', 1.5);
    lamp([86, 6.4, -42], [1.0, 0.35, 0.3], 16, 1.0);
    /* consola de activación en la cara sur de la torre */
    box([86, 0.55, -39.7], [3.0, 1.1, 1.2], 'mat_metal_panel');
    box([86, 1.3, -39.25], [2.6, 0.9, 0.12], 'mat_terminal', { emissive: 1 });
    strip([86, 1.75, -39.7], [2.6, 0.1, 0.9], 'mat_strip_red', 1.3);
    lamp([86, 1.5, -38.9], [1.0, 0.45, 0.35], 6, 0.6);

    /* lanzadera en mantenimiento */
    box([80, 2.6, -49], [14, 5.2, 9.0], 'mat_metal_panel');
    box([80, 5.5, -49], [9.0, 0.8, 6.4], 'mat_metal_panel');
    box([76, 5.8, -47.0], [4.0, 1.2, 3.0], 'mat_metal_panel');
    box([87.4, 2.4, -49], [1.4, 3.2, 3.2], 'mat_metal_panel');
    strip([81, 0.62, -44.42], [9.6, 0.24, 0.16], 'mat_strip_cyan', 0.9);
    strip([81, 4.6, -44.42], [9.6, 0.24, 0.16], 'mat_strip_cyan', 0.9);
    pipeRun(73.4, -54.4, 87.6, -54.4, 5.6, 0.2);

    /* pórtico elevado (gantry) con rampa de acceso */
    box([93.5, 2.0, -35], [11, 4.0, 10], 'mat_metal_floor');
    box([93.5, 4.02, -35], [10.6, 0.05, 9.6], 'mat_grate', { collide: false });
    wedge([86.5, 2.0, -35], [3, 4.0, 4], '+x', 'mat_metal_floor');
    rail(88.2, -39.85, 98.85, -39.85, 4.0);
    rail(88.2, -30.15, 98.85, -30.15, 4.0);
    rail(88.15, -39.85, 88.15, -37.2, 4.0);
    rail(88.15, -32.9, 88.15, -30.15, 4.0);
    rail(98.85, -39.85, 98.85, -30.15, 4.0);
    strip([93.5, 4.06, -40.1], [10.4, 0.06, 0.2], 'mat_strip_cyan', 0.8);
    strip([93.5, 4.06, -30.1], [10.4, 0.06, 0.2], 'mat_strip_cyan', 0.8);
    box([99.6, 5.0, -35], [0.3, 1.4, 3.6], 'mat_terminal', { emissive: 1 });
    consoleUnit(90, -37.5, Math.PI, 'mat_metal_panel', 'mat_terminal', 4.0);
    lamp([93.5, 6.6, -35], [0.5, 0.9, 1.0], 13, 0.65);

    /* carga y cobertura */
    container(78, -30, 0, 'mat_rust');
    container(74.5, -33.5, Math.PI / 2, 'mat_rust');
    crateStack(90, -52, 0xB1, 'mat_crate');
    crateStack(95, -50.5, 0xB2, 'mat_crate');
    crateStack(96, -46, 0xB3, 'mat_crate');
    box([92, 0.6, -29.0], [5, 1.2, 1.0], 'mat_rust');
    box([77, 1.2, -36], [2.4, 2.4, 2.4], 'mat_crate');

    /* instalación y luces */
    pipeRun(72.4, -55.4, 99.6, -55.4, 8.4, 0.26);
    pipeRun(72.4, -28.6, 99.6, -28.6, 8.4, 0.26);
    beaconLight(72.6, 5.0, -54, 'mat_strip_red', 10, 0.9);
    beaconLight(99.4, 5.0, -30, 'mat_strip_red', 10, 0.9);
    beaconLight(72.6, 5.0, -30, 'mat_strip_red', 10, 0.9);
    beaconLight(99.4, 5.0, -54, 'mat_strip_red', 10, 0.9);
    ceilingLamp(80, h - 0.35, -34, 'warm', 16, 0.9, 3.4, true);
    ceilingLamp(80, h - 0.35, -50, 'warm', 14, 0.8, 3.4, true);
    ceilingLamp(94, h - 0.35, -50, 'warm', 14, 0.8, 3.4, true);
    ceilingLamp(94, h - 0.35, -44, 'cyan', 14, 0.85, 3.4, true);
    wallScreen(99.4, 3.0, -44, 2.8, 1.5, -Math.PI / 2);
    wallScreen(99.4, 3.0, -34, 2.8, 1.5, -Math.PI / 2);
    wallScreen(72.6, 3.0, -34, 2.8, 1.5, Math.PI / 2);
  }

  /* ======================================================================
   * Misión K-7
   * ==================================================================== */
  function buildMission() {
    brushes = [];
    lights = [];
    stats = { rooms: 0, corridors: 0, props: 0, emissive: 0 };
/*__ZONAS__*/
    zoneVestibule();
    zoneAtrium();
    zoneCorridors();
    zoneControl();
    zoneStorage();
    zoneReactor();
    zoneBay();
    return assemble();
  }

  function assemble() {
    return {
      id: 'k7',
      name: 'BLACKSITE K-7 — SEÑAL PERDIDA',
      author: 'team',
      version: 1,
      seed: 0xB1AC5E,
      environment: {
        clearColor: [0.02, 0.025, 0.035],
        fog: { color: [0.035, 0.055, 0.075], density: 0.030 },
        /* El ambiente se aplica DOS veces (horneado en nivel + shader): subirlo
         * en los tres sitios (aquí, level.js bakeLights.ambient y renderer.js
         * DEFS.AMBIENT_*) para que valga con y sin `environment`. */
        ambient: { sky: [0.62, 0.70, 0.84], ground: [0.17, 0.18, 0.21] },
        ceilingY: 6.0,
        floorY: 0.0
      },
      welcomeText: 'BLACKSITE K-7 · SUBSISTEMA DE RESCATE EN ESPERA. La instalación ' +
        'está a oscuras: la energía principal se ha perdido y algo se ha despertado ' +
        'en el reactor. Llega al atrio, restaura la energía y activa la baliza.',
      objectivesIntro: [
        { id: 'reach_atrium', label: 'LLEGA AL ATRIO CENTRAL' },
        { id: 'power', label: 'RESTAURA LA ENERGÍA EN LA SALA DE CONTROL' },
        { id: 'beacon', label: 'ACTIVA LA BALIZA DE RESCATE' }
      ],
      brushes: brushes,
      decals: [],
      staticLights: lights,
      entities: {
        playerSpawn: { pos: [0, 0.95, 19], yaw: 0 },
        enemySpawns: [
          /* e1 — dron de reconocimiento en el atrio */
          {
            id: 'e1', type: 'drone', pos: [0, 2.2, -6], yaw: 0, waves: [0, 1, 2, 3],
            patrol: [[0, 2.2, -6], [8, 2.2, -2], [-6, 2.2, 6], [0, 2.2, 5]]
          },
          /* e2 — acechador del almacén */
          {
            id: 'e2', type: 'stalker', pos: [-42, 0.6, -9], yaw: 0, waves: [1, 2, 3],
            patrol: [[-42, 0.6, -9], [-42, 0.6, 9], [-33, 0.6, 1], [-48, 0.6, 3]]
          },
          /* e3 — bruto del reactor */
          {
            id: 'e3', type: 'brute', pos: [38, 1.0, -30], yaw: 0, waves: [2, 3],
            patrol: [[38, 1.0, -30], [54, 1.0, -31], [52, 1.0, -43]]
          },
          /* e4 — EL CELADOR en la bahía (jefe, oleada final) */
          {
            id: 'e4', type: 'brute', pos: [90, 1.0, -48], yaw: 0, waves: [4],
            variant: 'prime', boss: true, aggro: false,
            patrol: [[90, 1.0, -48], [95, 1.0, -42], [82, 1.0, -30]]
          }
        ],
        pickups: [
          { kind: 'ammo_light', pos: [1.6, 0.55, 16.5], waves: [0, 1, 2, 3, 4] },
          { kind: 'ammo_light', pos: [6.0, 0.55, 8.0], waves: [0, 1, 2, 3, 4] },
          { kind: 'ammo_light', pos: [-24, 0.55, 1.0], waves: [1, 2, 3, 4] },
          { kind: 'ammo_light', pos: [20, 0.55, 0], waves: [0, 1, 2, 3, 4] },
          { kind: 'ammo_light', pos: [31, 0.55, -2.0], waves: [0, 1, 2, 3, 4] },
          { kind: 'ammo_heavy', pos: [33.5, 0.55, -6.0], waves: [1, 2, 3, 4] },
          { kind: 'ammo_heavy', pos: [-30, 0.55, -1.0], waves: [2, 3, 4] },
          { kind: 'ammo_cell', pos: [42, 0.55, -30], waves: [2, 3, 4] },
          { kind: 'ammo_cell', pos: [96, 0.55, -43], waves: [3, 4] },
          { kind: 'health_small', pos: [-6.2, 0.55, -10.8], waves: [0, 1, 2, 3, 4] },
          { kind: 'health_small', pos: [52, 0.55, -38], waves: [2, 3, 4] },
          { kind: 'health_small', pos: [66, 0.55, -44], waves: [2, 3, 4] },
          { kind: 'health_large', pos: [46, 0.55, -28], waves: [1, 2, 3, 4] },
          { kind: 'health_large', pos: [76.5, 0.55, -32], waves: [3, 4] },
          { kind: 'weapon_smg', pos: [46, 0.55, -4.0], waves: [1, 2, 3, 4] },
          { kind: 'weapon_breacher', pos: [-41.5, 0.55, 0], waves: [2, 3, 4] }
        ],
        objectives: [
          {
            id: 'reach_atrium', type: 'goto', landmark: 'atrium', radius: 4.5,
            label: 'LLEGA AL ATRIO CENTRAL', requiresWave: 0
          },
          {
            id: 'power', type: 'interact', pos: [44, 1.6, -10.6], radius: 2.6, holdTime: 3.0,
            label: 'RESTAURA LA ENERGÍA EN LA SALA DE CONTROL', requiresWave: 0
          },
          {
            id: 'beacon', type: 'interact', pos: [86, 1.6, -39.4], radius: 2.8, holdTime: 4.0,
            label: 'ACTIVA LA BALIZA DE RESCATE', requiresWave: 4
          }
        ],
        landmarks: [
          { id: 'vestibule', pos: [0, 0, 19], radius: 4, label: 'VESTÍBULO DE ACCESO' },
          { id: 'atrium', pos: [0, 0, 0], radius: 8, label: 'ATRIO' },
          { id: 'junction', pos: [4, 0, -28], radius: 4, label: 'PASILLO EN L' },
          { id: 'control', pos: [42, 0, 0], radius: 7, label: 'SALA DE CONTROL' },
          { id: 'storage', pos: [-40, 0, 0], radius: 7, label: 'ALMACÉN' },
          { id: 'reactor', pos: [46, 0, -38], radius: 9, label: 'REACTOR' },
          { id: 'bay', pos: [86, 0, -42], radius: 9, label: 'BAHÍA DE LANZAMIENTO' }
        ]
      },
      waves: [
        {
          index: 0, label: 'OLEADA 1 — SONDA', spawnDelay: 1.5, betweenDelay: 3, maxAlive: 8,
          enemies: [{ type: 'drone', count: 4 }, { type: 'drone', count: 2, hpMul: 1.25 }],
          spawnPoints: ['e1'], trigger: { objectives: ['reach_atrium'] }
        },
        {
          index: 1, label: 'OLEADA 2 — EMBOSCADA', spawnDelay: 0.9, betweenDelay: 8, maxAlive: 10,
          enemies: [{ type: 'stalker', count: 5 }, { type: 'drone', count: 4 }],
          spawnPoints: ['e1', 'e2'], trigger: { requiresObjectives: ['power'] },
          reward: { pickup: 'weapon_smg', at: [46, 0.55, -4.0] }
        },
        {
          index: 2, label: 'OLEADA 3 — BLINDAJE', spawnDelay: 1.2, betweenDelay: 10, maxAlive: 12,
          enemies: [{ type: 'brute', count: 3 }, { type: 'drone', count: 6 }],
          spawnPoints: ['e1', 'e2', 'e3']
        },
        {
          index: 3, label: 'OLEADA 4 — PURGA', spawnDelay: 0.6, betweenDelay: 10, maxAlive: 18,
          enemies: [
            { type: 'stalker', count: 8 }, { type: 'drone', count: 8 },
            { type: 'brute', count: 1, variant: 'prime', hpMul: 1.6 }
          ],
          spawnPoints: ['e1', 'e2', 'e3']
        },
        {
          index: 4, label: 'OLEADA FINAL — EL CELADOR', spawnDelay: 2.0, betweenDelay: 0, maxAlive: 14,
          boss: true, victoryOnClear: true,
          enemies: [
            { type: 'brute', count: 1, variant: 'prime', hpMul: 3.2 },
            { type: 'drone', count: 6 }, { type: 'stalker', count: 4 }
          ],
          spawnPoints: ['e4'], trigger: { requiresObjectives: ['beacon'] }
        }
      ],
      route: [
        /* pos = [x, y esperada del suelo, z]; y se comprueba con tolerancia */
        [0, 0, 19], [0, 0, 13], [0, 0, 9],
        [8, 0, 6], [8.5, 0.24, 0.6], [8.5, 1.0, -1.9], [8.5, 2.2, -4.0],
        [8.5, 3.4, -7.2], [9.7, 3.4, -10.2], [8.5, 3.4, -7.2],
        [8.5, 1.0, -1.9], [8.5, 0, 1.2], [8, 0, 6],
        [11, 0, 0], [16, 0, 0], [24, 0, 0], [31, 0, 0],
        [31, 0, -8], [46, 0, -8], [44, 0, -9.5],
        [46, 0, -8], [31, 0, -8], [31, 0, 0], [16, 0, 0], [6, 0, 0],
        /* Planta baja: x=8 caía sobre la ESCALERA sólida del atrio
           (stairs x∈[7,10], z∈[-7,1]); la franja libre de ese tramo es x≈6
           (suelo 0.37 por la rampa transitable y después 0.00, sin bloqueos). */
        [6, 0, -6], [0, 0, -6], [-8, 0, -6], [-8, 0, 0],
        [-11, 0, 0], [-16, 0, 0], [-24, 0, 0], [-30, 0, 0],
        [-41.5, 0, 0], [-44, 0.6, 0], [-49, 1.2, 0],
        [-44, 0.6, 0], [-41.5, 0, 0], [-30, 0, 0], [-24, 0, 0],
        [-16, 0, 0], [-11, 0, 0], [-8, 0, 0], [-8, 0, -6], [0, 0, -6], [4, 0, -8],
        [4, 0, -12], [4, 0, -16], [4, 0, -22], [4, 0, -27],
        [10, 0, -28], [20, 0, -28], [30, 0, -28], [36, 0, -28],
        [46, 0, -28], [57, 0, -28], [57, 0, -43],
        [60, 0, -44], [66, 0, -44], [70, 0, -44], [74, 0, -43.5],
        [78, 0, -43.5], [82, 0, -42],
        /* Acceso a la sala de control: hay un PANEL BAJO de metal
           (x∈[84.5,87.5], y∈[0,1.1], z∈[-40.3,-39.1]). El tramo anterior
           [84,0,-39]→[86,0,-38.6] rozaba su esquina (3 cm) y el test de
           transitabilidad lo marcaba como "sin espacio libre". Se entra por
           z=-38.6, que está libre. (Medido en navegador real.) */
        [84, 0, -38.6], [86, 0, -38.6]
      ],
      roomStats: {},
      meta: {}
    };
  }

  /* Copia profunda de estructuras de datos planas (números, arrays, objetos). */
  function deepClone(v) {
    if (v === null || typeof v !== 'object') return v;
    if (v instanceof Array) {
      var a = new Array(v.length);
      for (var i = 0; i < v.length; i++) a[i] = deepClone(v[i]);
      return a;
    }
    var o = {};
    for (var k in v) {
      if (!Object.prototype.hasOwnProperty.call(v, k)) continue;
      o[k] = deepClone(v[k]);
    }
    return o;
  }

  /* Única construcción: el original nunca se muta porque build() clona. */
  var mission = buildMission();
  mission.roomStats = { rooms: stats.rooms, corridors: stats.corridors, props: stats.props, emissive: stats.emissive };

  var LevelData = {
    mission: mission,

    /** Devuelve una COPIA PROFUNDA; el original nunca se muta. */
    build: function () {
      return deepClone(mission);
    },

    /** Informe de tamaño del mapa (para el arnés y los tests). */
    buildStats: function () {
      var byKind = {}, mats = {};
      var list = mission.brushes;
      for (var i = 0; i < list.length; i++) {
        byKind[list[i].kind] = (byKind[list[i].kind] || 0) + 1;
        mats[list[i].mat] = (mats[list[i].mat] || 0) + 1;
      }
      return {
        brushes: list.length,
        byKind: byKind,
        materials: Object.keys(mats).length,
        byMaterial: mats,
        rooms: mission.roomStats.rooms,
        corridors: mission.roomStats.corridors,
        props: mission.roomStats.props,
        emissive: mission.roomStats.emissive,
        staticLights: mission.staticLights.length,
        enemySpawns: (mission.entities.enemySpawns || []).length,
        pickups: (mission.entities.pickups || []).length,
        objectives: (mission.entities.objectives || []).length,
        landmarks: (mission.entities.landmarks || []).length,
        waves: mission.waves.length,
        routePoints: mission.route.length
      };
    }
  };

  BS.LevelData = LevelData;

})(window.BS = window.BS || {});
