/* ===========================================================================
 * BLACKSITE: LAST SIGNAL  —  js/render/renderer.js
 * ---------------------------------------------------------------------------
 * Propósito : renderizador WebGL1 del motor. Compila los 4 programas
 *             (basic / viewmodel / sprite / post) con localizaciones de
 *             atributo fijas, gestiona la cámara FPS, el frustum, la cola de
 *             dibujo (opacas por material → transparentes de atrás a delante →
 *             viewmodel con depth clear), las luces dinámicas desenrolladas,
 *             la linterna spot, el fog, el post-proceso opcional en FBO y el
 *             auto-ajuste de resolución (R13). Nada de depth textures, VAOs ni
 *             instancing: solo features de WebGL1.
 * Depende de: js/core/util.js (BS.Math, BS.Util, BS.Log), js/core/gl.js (BS.GL),
 *             js/render/shaders.js (BS.Shaders), js/render/mesh.js (BS.Mesh)
 * Expone    : BS.Renderer
 * =========================================================================== */
(function (BS) {
  'use strict';

  var M = BS.Math;
  var MAX_LIGHTS = (BS.Shaders && BS.Shaders.MAX_DYNAMIC_LIGHTS) || 3;

  /* Números de configuración (§8: fuera del bucle) */
  var DEFS = {
    MAX_LIGHTS: MAX_LIGHTS,
    NEAR: 0.05, FAR: 400,
    FOV_DEG: 78,
    VM_FOV_DEG: 55, VM_NEAR: 0.01, VM_FAR: 50,
    DPR_CAP: 1.5,          // R13: dpr efectivo máximo
    LOW_DPR_CAP: 1.0,      // en calidad low el techo de dpr es 1
    LOW_SCALE: 0.6,        // escala fija en low/software
    RES_MIN: 0.5, RES_MAX: 1.0,
    AUTO_FRAME_BUDGET: 22, // ms: por encima baja resolutionScale (R13)
    AUTO_WINDOW: 30,       // muestras de la media móvil
    AUTO_STEP: 0.1,
    CLEAR: [0.025, 0.03, 0.038, 1],
    FOG_COLOR: [0.035, 0.04, 0.05],
    FOG_DENSITY: 0.028,
    /* Ambiente hemisférico. OJO: el shader arranca `acc` con esto y luego
     * multiplica por el color de vértice, que YA lleva el ambiente horneado
     * (level.js bakeLights) + las luces estáticas. Es decir, el ambiente entra
     * DOS veces: hay que subirlo/bajarlo en los TRES sitios a la vez
     * (estos DEFS, level.js bakeLights.ambient y leveldata.js environment.ambient),
     * nunca en uno solo. Valores subidos para salir de la escena casi negra
     * (luminancia media medida ≈ 0.017). */
    AMBIENT_SKY: [0.62, 0.70, 0.84],
    AMBIENT_GROUND: [0.17, 0.18, 0.21],
    VIGNETTE: 0.55,
    NOISE: 0.05,
    UNIT_MAP: 0, UNIT_NORMAL: 1, UNIT_EMISSIVE: 2
  };

  var PROGRAM_RANK = { basic: 0, viewmodel: 0, sprite: 1, post: 2 };

  /* ==========================================================================
   * Estado interno
   * ======================================================================== */
  var R = {
    programs: { basic: null, viewmodel: null, sprite: null, post: null },
    ready: false,
    quality: 'auto',
    postFx: true,
    maxLights: MAX_LIGHTS,
    resolutionScale: 1,
    _deviceScale: 1,

    stats: {
      drawCalls: 0, tris: 0, frameMs: 0, gpuMs: 0, particles: 0,
      submitted: 0, uploadedBytes: 0, dynamicLights: 0, lightsOn: 0, fps: 0
    },

    camera: {
      pos: new Float32Array([0, 1.7, 0]),
      yaw: 0, pitch: 0, roll: 0,
      fovY: DEFS.FOV_DEG * (Math.PI / 180),
      aspect: 16 / 9, near: DEFS.NEAR, far: DEFS.FAR
    },

    freeCamera: { enabled: false, pos: new Float32Array([0, 3, 8]), yaw: 0, pitch: -0.15 },

    /* cola de dibujo */
    _opaque: [],
    _transparent: [],
    _viewmodel: [],
    _pool: [],
    _poolIndex: 0,

    /* matrices y frustum */
    _view: M.m4(),
    _proj: M.m4(),
    _projVM: M.m4(),
    _clip: M.m4(),
    _frustum: [null, null, null, null, null, null],
    _frustumValid: false,
    _identity: M.m4identity(M.m4()),

    /* luces y linterna */
    _lights: [],
    _lightPosArr: new Float32Array(MAX_LIGHTS * 4),
    _lightColorArr: new Float32Array(MAX_LIGHTS * 4),
    _lightsActive: 0,
    _flashlight: null,

    /* ambiente / fog / tiempo */
    ambientSky: new Float32Array(DEFS.AMBIENT_SKY),
    ambientGround: new Float32Array(DEFS.AMBIENT_GROUND),
    fogColor: new Float32Array(DEFS.FOG_COLOR),
    fogDensity: DEFS.FOG_DENSITY,
    _time: 0,

    /* post / hud feedback */
    _damage: 0,
    _lowHealth: 0,
    _postQuad: null,
    _fbo: null,
    _canvasW: 1,
    _canvasH: 1,
    _frameStart: 0,
    _frameSamples: new Float32Array(DEFS.AUTO_WINDOW),
    _frameSampleCount: 0,
    _frameSampleIndex: 0,

    /* mesh del blob de sombra */
    _shadowMesh: null,

    _lastProgram: null
  };

  /* ==========================================================================
   * Utilidades internas
   * ======================================================================== */
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  var _centerScratch = new Float32Array(3);

  function canDraw() {
    return !!(BS.GL && BS.GL.gl && R.programs.basic && !BS.GL.isLost());
  }

  function acquire() {
    var i = R._poolIndex++;
    var e = R._pool[i];
    if (!e) {
      e = {
        model: new Float32Array(16),
        worldAabb: { min: new Float32Array(3), max: new Float32Array(3) },
        mesh: null, material: null, program: 'basic',
        tr: 1, tg: 1, tb: 1, ta: 1,
        er: 0, eg: 0, eb: 0, ea: 0,
        sortBias: 0, dist: 0
      };
      R._pool[i] = e;
    }
    return e;
  }

  function aabbCenter(out, aabb) {
    out[0] = (aabb.min[0] + aabb.max[0]) * 0.5;
    out[1] = (aabb.min[1] + aabb.max[1]) * 0.5;
    out[2] = (aabb.min[2] + aabb.max[2]) * 0.5;
    return out;
  }

  function prepareEntry(mesh, model, material, opts, program, forcedCollection) {
    opts = opts || {};
    var e = acquire();
    M.m4copy(e.model, model || R._identity);
    M.aabbTransform(e.worldAabb, mesh.aabb, e.model);

    e.mesh = mesh;
    e.material = material;
    e.program = program || (material.program === 'sprite' ? 'sprite' : 'basic');

    var t = opts.tint;
    var tr = t ? (t[0] === undefined ? 1 : t[0]) : 1;
    var tg = t ? (t[1] === undefined ? 1 : t[1]) : 1;
    var tb = t ? (t[2] === undefined ? 1 : t[2]) : 1;
    var ta = t ? (t[3] === undefined ? 1 : t[3]) : 1;
    if (opts.alpha !== undefined) ta *= opts.alpha;
    var flash = opts.flash || 0;
    if (flash > 0) {
      tr = M.lerp(tr, 1, flash); tg = M.lerp(tg, 1, flash); tb = M.lerp(tb, 1, flash);
    }
    e.tr = tr; e.tg = tg; e.tb = tb; e.ta = ta;

    var em = material.emissive || [0, 0, 0];
    var ei = (material.emissiveIntensity === undefined ? 1 : material.emissiveIntensity);
    if (opts.emissiveBoost) ei *= (1 + opts.emissiveBoost);
    e.er = em[0] || 0; e.eg = em[1] || 0; e.eb = em[2] || 0; e.ea = ei;

    e.sortBias = opts.sortBias || 0;
    aabbCenter(_centerScratch, e.worldAabb);
    e.dist = M.v3distSq(_centerScratch, R.camera.pos);

    var collection = forcedCollection || opts.collection;
    if (!collection) collection = (material.blend && material.blend !== 'opaque') ? 'transparent' : 'opaque';
    if (forcedCollection === 'viewmodel') {
      R._viewmodel.push(e);
    } else if (collection === 'transparent') {
      R._transparent.push(e);
    } else {
      R._opaque.push(e);
    }
    return e;
  }

  /* ==========================================================================
   * Compilación de programas, quad de pantalla y FBO
   * ======================================================================== */
  function buildPrograms() {
    var d = BS.Shaders.defaultDefines(BS.GL.caps, R.quality);
    var b = BS.Shaders.build('basic', d.basic);
    var vm = BS.Shaders.build('viewmodel', d.viewmodel);
    var sp = BS.Shaders.build('sprite', d.sprite);
    var po = BS.Shaders.build('post', d.post);
    // El prefijo #define ya va dentro de las fuentes: createProgram sin defines.
    R.programs.basic = BS.GL.createProgram(b.vs, b.fs, null, null);
    R.programs.viewmodel = BS.GL.createProgram(vm.vs, vm.fs, null, null);
    R.programs.sprite = BS.GL.createProgram(sp.vs, sp.fs, null, null);
    R.programs.post = BS.GL.createProgram(po.vs, po.fs, null, null);
    R.ready = !!R.programs.basic;
  }

  function createPostQuad() {
    var gl = BS.GL.gl;
    if (!gl) return;
    if (R._postQuad) {
      try { gl.deleteBuffer(R._postQuad); } catch (e) { /* noop */ }
    }
    R._postQuad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, R._postQuad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    BS.GL._boundMesh = null;
  }

  function createShadowMesh() {
    if (R._shadowMesh || !BS.Mesh) return;
    var b = BS.Mesh.create();
    // quad de 1x1 en el plano XZ con winding CCW visto desde arriba (normal +Y)
    b.quad([-0.5, 0, 0.5], [0.5, 0, 0.5], [0.5, 0, -0.5], [-0.5, 0, -0.5], [0, 1, 0], [1, 1]);
    R._shadowMesh = BS.Mesh.toGL(b);
  }

  function shadowMaterial() {
    if (!R._shadowMat) {
      R._shadowMat = {
        id: 'mat_bs_shadow', map: null, normalMap: null, emissiveMap: null,
        uvScale: [1, 1], specular: 0, normalStrength: 0,
        emissive: [0, 0, 0], emissiveIntensity: 0,
        blend: 'alpha', depthWrite: false, doubleSided: false,
        program: 'basic'
      };
    }
    return R._shadowMat;
  }

  function ensureFbo() {
    if (!R.postFx || !BS.GL.gl) return;
    var w = R._canvasW, h = R._canvasH;
    if (!R._fbo) {
      R._fbo = BS.GL.createFramebuffer(w, h, true);
    } else {
      BS.GL.resizeFramebuffer(R._fbo, w, h);
    }
  }

  /* ==========================================================================
   * Matrices, frustum y cámara
   * ======================================================================== */
  function computeView() {
    var c = R.camera;
    M.m4fromYawPitchPos(R._view, c.yaw, c.pitch, c.pos);
    if (c.roll) {
      // roll alrededor del eje Z de la cámara: view = Rz(roll) * view
      var cr = Math.cos(c.roll), sr = Math.sin(c.roll);
      var rz = M.m4();
      rz[0] = cr; rz[1] = sr; rz[2] = 0; rz[3] = 0;
      rz[4] = -sr; rz[5] = cr; rz[6] = 0; rz[7] = 0;
      rz[8] = 0; rz[9] = 0; rz[10] = 1; rz[11] = 0;
      rz[12] = 0; rz[13] = 0; rz[14] = 0; rz[15] = 1;
      M.m4multiply(R._view, rz, R._view);
    }
    return R._view;
  }

  function computeProj() {
    var c = R.camera;
    M.m4perspective(R._proj, c.fovY, c.aspect, c.near, c.far);
    M.m4perspective(R._projVM, DEFS.VM_FOV_DEG * (Math.PI / 180), c.aspect, DEFS.VM_NEAR, DEFS.VM_FAR);
    return R._proj;
  }

  function extractPlanes(m) {
    function row(r) { return [m[0 * 4 + r], m[1 * 4 + r], m[2 * 4 + r], m[3 * 4 + r]]; }
    var r0 = row(0), r1 = row(1), r2 = row(2), r3 = row(3);
    var p = R._frustum;
    function set(i, a, b, c, d) {
      var len = Math.sqrt(a * a + b * b + c * c) || 1;
      var arr = p[i] || (p[i] = [0, 0, 0, 0]);
      arr[0] = a / len; arr[1] = b / len; arr[2] = c / len; arr[3] = d / len;
    }
    set(0, r3[0] + r0[0], r3[1] + r0[1], r3[2] + r0[2], r3[3] + r0[3]); // izquierda
    set(1, r3[0] - r0[0], r3[1] - r0[1], r3[2] - r0[2], r3[3] - r0[3]); // derecha
    set(2, r3[0] + r1[0], r3[1] + r1[1], r3[2] + r1[2], r3[3] + r1[3]); // abajo
    set(3, r3[0] - r1[0], r3[1] - r1[1], r3[2] - r1[2], r3[3] - r1[3]); // arriba
    set(4, r3[0] + r2[0], r3[1] + r2[1], r3[2] + r2[2], r3[3] + r2[3]); // cerca
    set(5, r3[0] - r2[0], r3[1] - r2[1], r3[2] - r2[2], r3[3] - r2[3]); // lejos
  }

  function aabbVisible(aabb) {
    if (!R._frustumValid) return true;
    var p = R._frustum;
    for (var i = 0; i < 6; i++) {
      var pl = p[i];
      if (!pl) continue;
      var x = pl[0] >= 0 ? aabb.max[0] : aabb.min[0];
      var y = pl[1] >= 0 ? aabb.max[1] : aabb.min[1];
      var z = pl[2] >= 0 ? aabb.max[2] : aabb.min[2];
      if (pl[0] * x + pl[1] * y + pl[2] * z + pl[3] < 0) return false;
    }
    return true;
  }

  /* ==========================================================================
   * Planificación de la cola (sin GL): reutilizada por flush() y por el test
   * ======================================================================== */
  function collect(src, dst, distanceSort) {
    for (var i = 0; i < src.length; i++) {
      var e = src[i];
      if (!aabbVisible(e.worldAabb)) continue;
      dst.push(e);
    }
    if (distanceSort) {
      dst.sort(function (a, b) { return (b.dist + b.sortBias) - (a.dist + a.sortBias); });
    } else {
      dst.sort(function (a, b) {
        var ra = PROGRAM_RANK[a.program] || 0;
        var rb = PROGRAM_RANK[b.program] || 0;
        if (ra !== rb) return ra - rb;
        var ia = a.material.id || '';
        var ib = b.material.id || '';
        if (ia < ib) return -1;
        if (ia > ib) return 1;
        return (a.sortBias - b.sortBias);
      });
    }
  }

  function prepare() {
    var out = { opaque: [], transparent: [], viewmodel: [], drawCalls: 0, tris: 0 };
    collect(R._opaque, out.opaque, false);
    collect(R._transparent, out.transparent, true);
    collect(R._viewmodel, out.viewmodel, false);
    var i;
    for (i = 0; i < out.opaque.length; i++) out.tris += (out.opaque[i].mesh.indexCount || 0) / 3;
    for (i = 0; i < out.transparent.length; i++) out.tris += (out.transparent[i].mesh.indexCount || 0) / 3;
    for (i = 0; i < out.viewmodel.length; i++) out.tris += (out.viewmodel[i].mesh.indexCount || 0) / 3;
    out.drawCalls = out.opaque.length + out.transparent.length + out.viewmodel.length;
    return out;
  }

  /* ==========================================================================
   * Subida de uniforms
   * ======================================================================== */
  function uploadFrameUniforms(prog, name, proj, view) {
    var G = BS.GL;
    var c = R.camera;
    G.useProgram(prog);
    G.uMat4(prog, 'uProj', proj);
    G.uMat4(prog, 'uView', view);
    G.u3f(prog, 'uCameraPos', c.pos[0], c.pos[1], c.pos[2]);
    G.u1f(prog, 'uTime', R._time);
    G.u3f(prog, 'uFogColor', R.fogColor[0], R.fogColor[1], R.fogColor[2]);
    G.u1f(prog, 'uFogDensity', R.fogDensity);

    if (name === 'basic' || name === 'viewmodel') {
      G.u3f(prog, 'uAmbientSky', R.ambientSky[0], R.ambientSky[1], R.ambientSky[2]);
      G.u3f(prog, 'uAmbientGround', R.ambientGround[0], R.ambientGround[1], R.ambientGround[2]);
      G.u1i(prog, 'uLightCount', R._lightsActive);
      if (R._lightsActive > 0) {
        G.u4fv(prog, 'uLightPos', R._lightPosArr);
        G.u4fv(prog, 'uLightColor', R._lightColorArr);
      }
      var fl = R._flashlight;
      if (fl && fl.on && fl.intensity > 0) {
        G.u4f(prog, 'uFlashPos', fl.pos[0], fl.pos[1], fl.pos[2], fl.range);
        G.u4f(prog, 'uFlashDir', fl.dir[0], fl.dir[1], fl.dir[2], fl.cosOuter);
        G.u4f(prog, 'uFlashColor', fl.color[0], fl.color[1], fl.color[2], fl.intensity);
        G.u1f(prog, 'uFlashCosInner', fl.cosInner);
      } else {
        G.u4f(prog, 'uFlashColor', 0, 0, 0, 0);
      }
    }
  }

  function setPerDraw(prog, name, e) {
    var G = BS.GL;
    var mat = e.material;
    G.u4f(prog, 'uColorTint', e.tr, e.tg, e.tb, e.ta);
    G.uTex(prog, 'uMap', DEFS.UNIT_MAP, mat.map || null);
    G.u4f(prog, 'uEmissive', e.er, e.eg, e.eb, e.ea);
    if (name === 'sprite') return;
    G.uMat4(prog, 'uModel', e.model);
    var uv = mat.uvScale || [1, 1];
    G.u2f(prog, 'uUvScale', uv[0], uv[1]);
    G.uTex(prog, 'uNormalMap', DEFS.UNIT_NORMAL, mat.normalMap || null);
    G.uTex(prog, 'uEmissiveMap', DEFS.UNIT_EMISSIVE, mat.emissiveMap || null);
    G.u1f(prog, 'uSpecular', mat.specular || 0);
    G.u1f(prog, 'uNormalStrength', mat.normalStrength || 0);
  }

  function applyMaterialState(mat, defaultBlend) {
    var blend = (mat.blend && mat.blend !== 'opaque') ? mat.blend : defaultBlend;
    var dw = (mat.blend && mat.blend !== 'opaque') ? (mat.depthWrite !== false) : true;
    BS.GL.setState({
      depthTest: true,
      depthWrite: dw,
      cull: mat.doubleSided ? 'none' : 'back',
      blend: blend
    });
  }

  function drawList(list, proj, view, forceProgram, defaultBlend) {
    var G = BS.GL;
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      var name = forceProgram || e.program;
      var prog = R.programs[name] || R.programs.basic;
      if (!prog) continue;
      if (R._lastProgram !== prog) {
        uploadFrameUniforms(prog, name, proj, view);
        R._lastProgram = prog;
      }
      setPerDraw(prog, name, e);
      applyMaterialState(e.material, defaultBlend || 'none');
      if (G.bindMesh(e.mesh)) G.drawMesh(e.mesh);
    }
  }

  /* ==========================================================================
   * Luces y escalado
   * ======================================================================== */
  function updateLights() {
    var list = R._lights;
    var n = Math.min(list.length, R.maxLights);
    // las más cercanas a la cámara tienen prioridad
    if (list.length > 1) {
      list.sort(function (a, b) {
        return M.v3distSq(a.pos, R.camera.pos) - M.v3distSq(b.pos, R.camera.pos);
      });
    }
    for (var i = 0; i < n; i++) {
      var L = list[i];
      R._lightPosArr[i * 4] = L.pos[0];
      R._lightPosArr[i * 4 + 1] = L.pos[1];
      R._lightPosArr[i * 4 + 2] = L.pos[2];
      R._lightPosArr[i * 4 + 3] = L.radius || 8;
      var col = L.color || [1, 1, 1];
      R._lightColorArr[i * 4] = col[0];
      R._lightColorArr[i * 4 + 1] = col[1];
      R._lightColorArr[i * 4 + 2] = col[2];
      R._lightColorArr[i * 4 + 3] = (L.intensity === undefined ? 1 : L.intensity);
    }
    R._lightsActive = n;
    R.stats.dynamicLights = list.length;
    R.stats.lightsOn = n;
  }

  function effectiveScale() {
    if (R.quality === 'low') return DEFS.LOW_SCALE;
    return R.resolutionScale;
  }

  function updateFps(frameMs) {
    R.stats.frameMs = frameMs;
    var buf = R._frameSamples;
    buf[R._frameSampleIndex] = frameMs;
    R._frameSampleIndex = (R._frameSampleIndex + 1) % DEFS.AUTO_WINDOW;
    if (R._frameSampleCount < DEFS.AUTO_WINDOW) R._frameSampleCount++;
    var sum = 0;
    for (var i = 0; i < R._frameSampleCount; i++) sum += buf[i];
    var avg = R._frameSampleCount ? sum / R._frameSampleCount : frameMs;
    R.stats.fps = frameMs > 0 ? Math.min(999, 1000 / frameMs) : 0;

    if (R.quality === 'auto' && R._frameSampleCount >= DEFS.AUTO_WINDOW &&
      avg > DEFS.AUTO_FRAME_BUDGET && R.resolutionScale > DEFS.RES_MIN) {
      R.resolutionScale = Math.max(DEFS.RES_MIN, R.resolutionScale - DEFS.AUTO_STEP);
      R._frameSampleCount = 0;
      R._frameSampleIndex = 0;
      resize();
    }
  }

  function resize() {
    var G = BS.GL;
    var canvas = (G && G.canvas) || (BS.Util.getDOM && BS.Util.getDOM().canvas3d);
    if (!canvas) return;
    var cssW = canvas.clientWidth || (window.innerWidth | 0) || 1280;
    var cssH = canvas.clientHeight || (window.innerHeight | 0) || 720;
    var winDpr = (window.devicePixelRatio || 1);
    var dprCap = (R.quality === 'low') ? DEFS.LOW_DPR_CAP : DEFS.DPR_CAP;
    var eff = Math.min(winDpr, dprCap) * effectiveScale();
    var w = Math.max(1, Math.round(cssW * eff));
    var h = Math.max(1, Math.round(cssH * eff));
    canvas.width = w;
    canvas.height = h;
    R._canvasW = w;
    R._canvasH = h;
    R.camera.aspect = w / h;
    BS.GL._state.viewport = null;
    if (R.postFx) ensureFbo();
  }

  /* ==========================================================================
   * API pública
   * ======================================================================== */
  var Renderer = {
    programs: R.programs,
    stats: R.stats,
    quality: R.quality,
    camera: R.camera,
    freeCamera: R.freeCamera,

    init: function (glCtx, opts) {
      opts = opts || {};
      try {
        var G = glCtx || BS.GL;
        if (!G || !G.gl) {
          BS.Log.warn('BS.Renderer.init: sin contexto WebGL');
          return false;
        }
        if (opts.quality) R.quality = opts.quality;
        else if (G.caps && G.caps.isSoftware) R.quality = 'low';

        R.postFx = (opts.postFx !== undefined) ? !!opts.postFx : (R.quality !== 'low');
        if (R.quality === 'low') R.postFx = false;
        R.maxLights = Math.min(MAX_LIGHTS, opts.maxLights === undefined ? MAX_LIGHTS : (opts.maxLights | 0));

        R._identity = M.m4identity(M.m4());
        buildPrograms();
        createPostQuad();
        createShadowMesh();

        if (!R.ready) {
          BS.Log.error('BS.Renderer.init: el programa "basic" no compiló');
          return false;
        }

        R._lastProgram = null;
        if (R.quality === 'low') R.resolutionScale = DEFS.LOW_SCALE;
        resize();
        Renderer.updateFrustum();
        Renderer.quality = R.quality;

        BS.GL.onContextRestored(function () { Renderer.rebuild(); });

        BS.Log.info('BS.Renderer.init OK (postFx=' + R.postFx + ', maxLights=' + R.maxLights +
          ', calidad=' + R.quality + ')');
        return true;
      } catch (e) {
        BS.Log.error('BS.Renderer.init:', e && e.message ? e.message : e);
        return false;
      }
    },

    rebuild: function () {
      try {
        R._lastProgram = null;
        R._postQuad = null;
        R._shadowMesh = null;
        R._fbo = null;
        buildPrograms();
        createPostQuad();
        createShadowMesh();
        resize();
        Renderer.updateFrustum();
        BS.Log.info('BS.Renderer.rebuild: programas y FBO reconstruidos');
      } catch (e) {
        BS.Log.error('BS.Renderer.rebuild:', e && e.message ? e.message : e);
      }
    },

    dispose: function () {
      try {
        var gl = BS.GL.gl;
        for (var k in R.programs) {
          if (R.programs[k]) BS.GL.disposeProgram(R.programs[k]);
          R.programs[k] = null;
        }
        if (R._fbo) { BS.GL.disposeFramebuffer(R._fbo); R._fbo = null; }
        if (gl && R._postQuad) { gl.deleteBuffer(R._postQuad); R._postQuad = null; }
        if (R._shadowMesh) { BS.GL.disposeMesh(R._shadowMesh); R._shadowMesh = null; }
        R.ready = false;
      } catch (e) {
        BS.Log.error('BS.Renderer.dispose:', e && e.message ? e.message : e);
      }
    },

    resizeToDisplay: function () {
      resize();
      Renderer.updateFrustum();
    },

    setResolutionScale: function (s) {
      R.resolutionScale = clamp(Number(s) || 1, DEFS.RES_MIN, DEFS.RES_MAX);
      resize();
    },

    getResolutionScale: function () { return R.resolutionScale; },

    setQuality: function (q) {
      if (q !== 'low' && q !== 'medium' && q !== 'high' && q !== 'auto') return;
      /* Si la calidad EFECTIVA no cambia, no hay nada que rehacer. Sin esta
       * salida temprana, Game.applySettings (que se dispara al mover CUALQUIER
       * slider, p. ej. el de volumen) llamaba a applyQuality y este método
       * recompilaba los 4 programas de shader en cada evento: tirones al
       * arrastrar un deslizador. Los programas ya se compilan en init()
       * (línea ~539), así que saltarse el trabajo cuando q es la misma es
       * correcto. */
      if (R.quality === q) return;
      R.quality = q;
      Renderer.quality = q;
      if (q === 'low') {
        R.postFx = false;
        R.maxLights = Math.min(R.maxLights, 1);
      } else if (q === 'high') {
        R.maxLights = MAX_LIGHTS;
      }
      if (canDraw()) {
        R._lastProgram = null;
        buildPrograms();
      }
      resize();
      Renderer.updateFrustum();
    },

    getQuality: function () { return R.quality; },

    setPostFx: function (on) {
      R.postFx = !!on;
      if (R.postFx) ensureFbo();
      else if (R._fbo) { BS.GL.disposeFramebuffer(R._fbo); R._fbo = null; }
    },

    isPostFx: function () { return !!(R.postFx && R._fbo); },

    setFov: function (deg) { R.camera.fovY = clamp(Number(deg) || DEFS.FOV_DEG, 40, 120) * (Math.PI / 180); },
    getFov: function () { return R.camera.fovY * (180 / Math.PI); },

    setNearFar: function (near, far) {
      R.camera.near = Math.max(0.001, Number(near) || DEFS.NEAR);
      R.camera.far = Math.max(R.camera.near + 1, Number(far) || DEFS.FAR);
    },

    setAmbient: function (sky, ground) {
      if (sky) { R.ambientSky[0] = sky[0]; R.ambientSky[1] = sky[1]; R.ambientSky[2] = sky[2]; }
      if (ground) { R.ambientGround[0] = ground[0]; R.ambientGround[1] = ground[1]; R.ambientGround[2] = ground[2]; }
    },

    setFog: function (color, density) {
      if (color) { R.fogColor[0] = color[0]; R.fogColor[1] = color[1]; R.fogColor[2] = color[2]; }
      if (density !== undefined) R.fogDensity = Math.max(0, Number(density) || 0);
    },

    setFlashlight: function (state) {
      if (!state) { R._flashlight = null; return; }
      var pos = state.pos || new Float32Array(3);
      var dir = state.dir || new Float32Array([0, 0, -1]);
      var d = M.v3norm(new Float32Array(3), dir);
      R._flashlight = {
        on: state.on !== false,
        pos: new Float32Array([pos[0], pos[1], pos[2]]),
        dir: d,
        color: state.color || [1, 0.97, 0.9],
        intensity: (state.intensity === undefined ? 1 : state.intensity),
        range: (state.range === undefined ? 18 : state.range),
        cosInner: (state.cosInner === undefined ? 0.94 : state.cosInner),
        cosOuter: (state.cosOuter === undefined ? 0.80 : state.cosOuter)
      };
    },

    setDynamicLights: function (list) {
      R._lights = Array.isArray(list) ? list.slice(0, 16) : [];
    },

    setMaxDynamicLights: function (n) {
      R.maxLights = clamp(n | 0, 0, MAX_LIGHTS);
    },

    setTime: function (t) { R._time = Number(t) || 0; },

    setDamage: function (v) { R._damage = clamp(Number(v) || 0, 0, 1); },
    setLowHealth: function (v) { R._lowHealth = clamp(Number(v) || 0, 0, 1); },

    reportFrameTime: function (ms) { updateFps(Number(ms) || 0); },

    /* -------------------- cámara -------------------- */
    setCamera: function (pos, yaw, pitch, roll) {
      var c = R.camera;
      if (pos) { c.pos[0] = pos[0]; c.pos[1] = pos[1]; c.pos[2] = pos[2]; }
      if (yaw !== undefined) c.yaw = yaw;
      if (pitch !== undefined) c.pitch = clamp(pitch, -1.55, 1.55);
      c.roll = roll || 0;
      R._frustumValid = false;
    },

    getViewMatrix: function (out) {
      computeView();
      if (out) return M.m4copy(out, R._view);
      return R._view;
    },

    getProjectionMatrix: function (out) {
      computeProj();
      if (out) return M.m4copy(out, R._proj);
      return R._proj;
    },

    getCameraRay: function (ndcX, ndcY, outOrigin, outDir) {
      var c = R.camera;
      var dir = outDir || new Float32Array(3);
      M.cameraRayFromNDC(outOrigin, dir, ndcX, ndcY, c.pos, c.yaw, c.pitch, c.fovY, c.aspect);
      return dir;
    },

    /* -------------------- frustum -------------------- */
    updateFrustum: function () {
      computeView();
      computeProj();
      var clip = M.m4multiply(R._clip, R._proj, R._view);
      extractPlanes(clip);
      R._frustumValid = true;
    },

    isVisible: function (aabb) {
      if (!aabb) return true;
      return aabbVisible(aabb);
    },

    /* -------------------- cola de dibujo -------------------- */
    beginFrame: function (clearColor) {
      R._frameStart = BS.Util.nowMs();
      R.stats.drawCalls = 0;
      R.stats.tris = 0;
      R.stats.submitted = 0;
      R.stats.uploadedBytes = 0;
      R._opaque.length = 0;
      R._transparent.length = 0;
      R._viewmodel.length = 0;
      R._poolIndex = 0;
      R._lastProgram = null;

      if (!canDraw()) return;

      if (R.postFx && R._fbo && R._fbo.complete) {
        BS.GL.bindFramebuffer(R._fbo);
        BS.GL.setState({ scissor: null });
        BS.GL.setViewport(0, 0, R._fbo.w, R._fbo.h);
      } else {
        BS.GL.bindFramebuffer(null);
        BS.GL.setViewport(0, 0, R._canvasW, R._canvasH);
      }
      updateLights();
      BS.GL.setState({ depthTest: true, depthWrite: true, cull: 'back', blend: 'none' });
      BS.GL.clear(clearColor || DEFS.CLEAR, true);
    },

    push: function (mesh, model, material, opts) {
      if (!mesh || !material) return;
      prepareEntry(mesh, model, material, opts, null, null);
    },

    pushViewmodel: function (mesh, model, material, opts) {
      if (!mesh || !material) return;
      prepareEntry(mesh, model, material, opts, 'viewmodel', 'viewmodel');
    },

    drawShadowBlob: function (pos, radius, alpha) {
      if (!R._shadowMesh || !pos) return;
      // el mesh de sombra mide 1x1 en XZ: la escala lo dimensiona
      var s = Math.max(0.001, radius) * 2;
      var m = M.m4fromPosYawScale(M.m4(), pos, 0, s);
      m[13] = pos[1] + 0.02;
      prepareEntry(R._shadowMesh, m, shadowMaterial(), {
        collection: 'transparent', tint: [0, 0, 0, 1], alpha: (alpha === undefined ? 0.5 : alpha)
      }, null, null);
    },

    clearDepth: function () {
      if (!canDraw()) return;
      BS.GL.clear(null, true);
    },

    /* Devuelve el plan (opacas/transparentes/viewmodel) sin dibujar. */
    _prepare: function () { return prepare(); },

    flush: function () {
      if (!R._frustumValid) Renderer.updateFrustum();
      updateLights();
      var plan = prepare();
      R.stats.drawCalls = plan.drawCalls;
      R.stats.tris = Math.round(plan.tris);
      R.stats.submitted = R._opaque.length + R._transparent.length + R._viewmodel.length;
      if (!canDraw()) return plan;

      R._lastProgram = null;
      drawList(plan.opaque, R._proj, R._view, null, 'none');
      drawList(plan.transparent, R._proj, R._view, null, 'alpha');

      if (plan.viewmodel.length) {
        BS.GL.clear(null, true);
        BS.GL.setState({ depthTest: true, depthWrite: true, blend: 'none' });
        R._lastProgram = null;
        drawList(plan.viewmodel, R._projVM, R._view, 'viewmodel', 'none');
      }
      return plan;
    },

    present: function () {
      var G = BS.GL;
      var ms = R._frameStart ? (BS.Util.nowMs() - R._frameStart) : 0;
      updateFps(ms);

      if (R.postFx && R._fbo && R._fbo.complete && R.programs.post && G && G.gl && !G.isLost()) {
        var gl = G.gl;
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        G._state.viewport = null;
        G.setViewport(0, 0, R._canvasW, R._canvasH);
        gl.disable(gl.DEPTH_TEST);
        gl.disable(gl.CULL_FACE);
        gl.disable(gl.BLEND);
        G._state.depthTest = false;
        G._state.cull = 'none';
        G._state.blend = 'none';

        var prog = R.programs.post;
        G.useProgram(prog);
        R._lastProgram = null;
        G.uTex(prog, 'uTex', 0, R._fbo.colorTex);
        G.u2f(prog, 'uResolution', R._canvasW, R._canvasH);
        G.u1f(prog, 'uVignette', DEFS.VIGNETTE);
        G.u1f(prog, 'uDamage', R._damage);
        G.u1f(prog, 'uLowHealth', R._lowHealth);
        G.u1f(prog, 'uTime', R._time);
        G.u1f(prog, 'uNoise', DEFS.NOISE);

        gl.bindBuffer(gl.ARRAY_BUFFER, R._postQuad);
        gl.enableVertexAttribArray(BS.GL.ATTR.POS);
        gl.vertexAttribPointer(BS.GL.ATTR.POS, 2, gl.FLOAT, false, 8, 0);
        gl.disableVertexAttribArray(BS.GL.ATTR.NORMAL);
        gl.disableVertexAttribArray(BS.GL.ATTR.UV);
        gl.disableVertexAttribArray(BS.GL.ATTR.COLOR);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        R.stats.drawCalls++;
        BS.GL._drawCalls++;
      }
      // El quad a pantalla completa deja el binding de vertices en estado vec2:
      // invalidar la cache para que el proximo bindMesh reconfigure todo.
      BS.GL._boundMesh = null;
    },

    /* -------------------- cámara libre (debug) -------------------- */
    setFreeCamera: function (on) {
      R.freeCamera.enabled = !!on;
      if (on) {
        R.freeCamera.pos[0] = R.camera.pos[0];
        R.freeCamera.pos[1] = R.camera.pos[1];
        R.freeCamera.pos[2] = R.camera.pos[2];
        R.freeCamera.yaw = R.camera.yaw;
        R.freeCamera.pitch = R.camera.pitch;
      }
    },

    /* -------------------- info -------------------- */
    getStats: function () { return R.stats; },

    reportUpload: function (bytes) { R.stats.uploadedBytes += (bytes | 0); },

    info: function () {
      return {
        ready: R.ready,
        quality: R.quality,
        postFx: !!R.postFx,
        maxLights: R.maxLights,
        resolutionScale: R.resolutionScale,
        canvasSize: [R._canvasW, R._canvasH],
        programs: {
          basic: !!R.programs.basic,
          viewmodel: !!R.programs.viewmodel,
          sprite: !!R.programs.sprite,
          post: !!R.programs.post
        },
        stats: R.stats
      };
    }
  };

  BS.Renderer = Renderer;

  /* ======================================================================
   * Test: reparto en draw calls (agrupación + culling) sin depender de GPU
   * ==================================================================== */
  if (BS.Debug && typeof BS.Debug.register === 'function') {
    BS.Debug.register('renderer:drawcalls', function () {
      if (!BS.Mesh) return { ok: false, error: 'BS.Mesh no disponible' };

      function makeMesh(x) {
        var b = BS.Mesh.create();
        b.box([x, 0, 0], [1, 1, 1], [1, 1]);
        return BS.Mesh.toGL(b);
      }

      // cámara mirando a -Z desde z=6: el origen es visible
      var savedPos = new Float32Array(R.camera.pos);
      var savedYaw = R.camera.yaw, savedPitch = R.camera.pitch;
      Renderer.setCamera(new Float32Array([0, 0, 6]), 0, 0);
      Renderer.updateFrustum();

      // materiales locales (no dependen de que BS.Textures esté inicializado)
      var matOpaque = {
        id: 'test_opaque', program: 'basic', blend: 'opaque', uvScale: [1, 1],
        specular: 0, normalStrength: 0, emissive: [0, 0, 0], emissiveIntensity: 0,
        depthWrite: true, doubleSided: false, map: null, normalMap: null, emissiveMap: null
      };
      var matGlass = {
        id: 'test_alpha', program: 'basic', blend: 'alpha', uvScale: [1, 1],
        specular: 0, normalStrength: 0, emissive: [0, 0, 0], emissiveIntensity: 0,
        depthWrite: false, doubleSided: true, map: null, normalMap: null, emissiveMap: null
      };

      // reset de la cola sin GL
      R._opaque.length = 0; R._transparent.length = 0; R._viewmodel.length = 0; R._poolIndex = 0;

      var m = M.m4identity(M.m4());
      var i;
      for (i = 0; i < 5; i++) Renderer.push(makeMesh(i * 0.1), m, matOpaque);
      for (i = 0; i < 2; i++) Renderer.push(makeMesh(i * 0.1), m, matGlass);
      Renderer.pushViewmodel(makeMesh(0), m, matOpaque);

      var planVisible = Renderer._prepare();
      var okVisible = planVisible.drawCalls === 8 &&
        planVisible.opaque.length === 5 &&
        planVisible.transparent.length === 2 &&
        planVisible.viewmodel.length === 1;

      // cámara muy lejos mirando en sentido contrario: todo culled
      Renderer.setCamera(new Float32Array([1000, 0, 1000]), Math.PI, 0);
      Renderer.updateFrustum();
      var planCulled = Renderer._prepare();
      var okCulled = planCulled.drawCalls === 0;

      // el triángulo total de las 8 piezas (12 tris por caja)
      var trisOk = Math.round(planVisible.tris) === 8 * 12;

      // limpieza para no contaminar fotogramas posteriores
      R._opaque.length = 0; R._transparent.length = 0; R._viewmodel.length = 0; R._poolIndex = 0;
      Renderer.setCamera(savedPos, savedYaw, savedPitch);
      Renderer.updateFrustum();

      return {
        ok: okVisible && okCulled && trisOk,
        drawCallsVisibles: planVisible.drawCalls,
        opacas: planVisible.opaque.length,
        transparentes: planVisible.transparent.length,
        viewmodel: planVisible.viewmodel.length,
        drawCallsTrasCulling: planCulled.drawCalls,
        tris: Math.round(planVisible.tris),
        agrupacionOk: okVisible,
        cullingOk: okCulled,
        trisOk: trisOk
      };
    });
  }

})(window.BS = window.BS || {});
