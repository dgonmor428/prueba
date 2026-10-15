/* ===========================================================================
 * BLACKSITE: LAST SIGNAL  —  js/core/gl.js
 * ---------------------------------------------------------------------------
 * Propósito : capa fina sobre WebGL1/WebGL2 que fija el contrato común de
 *             todo el motor: detección de capacidades, compilación de programas
 *             con `bindAttribLocation` 0..3 ANTES de linkar, helpers de
 *             uniforms que NO lanzan si el uniform no está activo, meshes
 *             (estático y dinámico), texturas desde canvas, framebuffers con
 *             renderbuffer de profundidad (nunca depth texture) y caché de
 *             estado.
 * Depende de: js/core/util.js (BS.Log, BS.Util)
 * Expone    : BS.GL
 *
 * FORMATO DE VÉRTICE ÚNICO (stride 36 bytes) — INTOCABLE:
 *   offset  0 : aPos    FLOAT x3            -> localización 0
 *   offset 12 : aNormal FLOAT x3            -> localización 1
 *   offset 24 : aUV     FLOAT x2            -> localización 2
 *   offset 32 : aColor  UNSIGNED_BYTE x4 (normalizado) -> localización 3
 *               rgb = luz horneada/tinte, a = máscara emisiva 0..1
 * =========================================================================== */
(function (BS) {
  'use strict';

  var STRIDE = 36;

  var GL = {
    gl: null,
    canvas: null,
    Program: { program: null, uniforms: {}, attributes: {} }, // forma de createProgram

    ATTR: { POS: 0, NORMAL: 1, UV: 2, COLOR: 3 },
    STRIDE: STRIDE,
    PRIORITY: { POSITION: 34962, INDEX: 34963 },
    MASK: { WORLD: 1, ENEMY: 2, PLAYER: 4, PICKUP: 8, PROJECTILE: 16, PROP: 32 },

    caps: {
      isWebGL2: false,
      maxTextureSize: 0,
      maxFragmentUniformVectors: 0,
      maxVertexUniformVectors: 0,
      maxVertexAttribs: 0,
      maxRenderbufferSize: 0,
      anisoAvailable: false,
      maxAniso: 1,
      derivativesAvailable: false,
      vendor: '',
      renderer: '',
      rendererRaw: '',
      isSoftware: false,
      isWeak: false,
      maxPointSize: 1,
      uintIndex: false,
      contextName: ''
    },

    creationError: null,

    _anisoExt: null,
    _lost: false,
    _programId: 1,
    _currentProgram: null,
    _boundMesh: null,
    _unitTextures: [],
    _activeUnit: 0,
    _white: null,
    _onLost: [],
    _onRestored: [],
    _vsCount: 0,
    _fsCount: 0,
    _drawCalls: 0,

    _state: {
      depthTest: true,
      depthWrite: true,
      depthFunc: 0,        // se rellena en init (LEQUAL)
      cull: 'none',        // 'back' | 'front' | 'none'
      blend: 'none',       // 'none' | 'alpha' | 'add' | 'multiply'
      clearColor: null,
      viewport: null,
      scissor: null
    },

    /* ==================================================================
     * init
     * ================================================================== */
    init: function (canvas, opts) {
      opts = opts || {};
      GL.canvas = canvas || GL.canvas;
      if (!GL.canvas || typeof GL.canvas.getContext !== 'function') {
        GL.creationError = 'canvas inválido';
        return { ok: false, reason: 'BS.GL.init: canvas inválido' };
      }
      if (GL.gl && !GL._lost) return { ok: true, reason: 'ya inicializado' };

      var attrs = {
        antialias: opts.antialias === true,
        alpha: opts.alpha === true,
        depth: opts.depth !== false,
        stencil: false,
        premultipliedAlpha: true,
        preserveDrawingBuffer: opts.preserveDrawingBuffer !== false,
        powerPreference: opts.powerPreference || 'high-performance',
        failIfMajorPerformanceCaveat: false
      };

      var names = ['webgl2', 'webgl', 'experimental-webgl'];
      var ctx = null, used = '';
      var creationMsg = null;
      var onCreationError = function (ev) {
        creationMsg = (ev && ev.statusMessage) ? ev.statusMessage : 'error desconocido';
      };
      BS.Util.addListener(GL.canvas, 'webglcontextcreationerror', onCreationError, false);

      for (var i = 0; i < names.length; i++) {
        try {
          ctx = GL.canvas.getContext(names[i], attrs);
        } catch (e) {
          ctx = null;
        }
        if (ctx) { used = names[i]; break; }
      }

      if (!ctx) {
        // último intento con atributos mínimos (algunos drivers rechazan combos)
        try { ctx = GL.canvas.getContext('webgl', { preserveDrawingBuffer: true, failIfMajorPerformanceCaveat: false }); } catch (e2) { ctx = null; }
        if (ctx) used = 'webgl(min)';
      }

      if (!ctx) {
        GL.creationError = creationMsg || 'getContext devolvió null';
        BS.Log.error('BS.GL.init: WebGL no disponible (' + GL.creationError + ')');
        return { ok: false, reason: 'WebGL no disponible: ' + GL.creationError };
      }

      GL.gl = ctx;
      GL._lost = false;
      GL.detectCaps(ctx, used);
      GL._resetCaches();

      /* Programas de depuración (blit) se crean bajo demanda */

      // 1x1 blanco opaco: textura por defecto para slots sin mapa
      GL._white = GL.createTexture2D(1, 1, new Uint8Array([255, 255, 255, 255]), { mipmaps: false, wrap: 'clamp' });

      var onLost = function (ev) {
        if (ev && typeof ev.preventDefault === 'function') ev.preventDefault();
        GL._lost = true;
        GL._resetCaches();
        var info = { reason: 'desconocida' };
        try {
          var s = ctx.getParameter ? ctx : null;
          if (s && s.isContextLost && s.isContextLost()) info.reason = 'contexto perdido';
        } catch (e) { /* noop */ }
        BS.Log.warn('BS.GL: contexto WebGL perdido');
        for (var k = 0; k < GL._onLost.length; k++) {
          try { GL._onLost[k](ev, info); } catch (e2) { BS.Log.error('BS.GL onContextLost handler:', e2 && e2.message); }
        }
      };
      var onRestored = function () {
        GL._lost = false;
        GL._resetCaches();
        BS.Log.info('BS.GL: contexto WebGL restaurado');
        for (var k = 0; k < GL._onRestored.length; k++) {
          try { GL._onRestored[k](); } catch (e) { BS.Log.error('BS.GL onContextRestored handler:', e && e.message); }
        }
      };
      BS.Util.addListener(GL.canvas, 'webglcontextlost', onLost, false);
      BS.Util.addListener(GL.canvas, 'webglcontextrestored', onRestored, false);

      BS.Log.info('BS.GL.init OK (' + used + ') renderer="' + GL.caps.renderer + '" soft=' + GL.caps.isSoftware);
      return { ok: true, reason: used };
    },

    /** Detecta capacidades del contexto (§1.1, §6 R10/R11/R12). */
    detectCaps: function (ctx, used) {
      ctx = ctx || GL.gl;
      if (!ctx) return GL.caps;
      var c = GL.caps;
      var gl = ctx;

      c.contextName = used || '';
      c.isWebGL2 = (used === 'webgl2') ||
        (typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext);

      function num(p, def) {
        try { var v = gl.getParameter(p); return (typeof v === 'number') ? v : def; } catch (e) { return def; }
      }

      c.maxTextureSize = num(gl.MAX_TEXTURE_SIZE, 2048);
      c.maxFragmentUniformVectors = num(gl.MAX_FRAGMENT_UNIFORM_VECTORS, 64);
      c.maxVertexUniformVectors = num(gl.MAX_VERTEX_UNIFORM_VECTORS, 128);
      c.maxVertexAttribs = num(gl.MAX_VERTEX_ATTRIBS, 8);
      c.maxRenderbufferSize = num(gl.MAX_RENDERBUFFER_SIZE, c.maxTextureSize);
      c.maxVaryingVectors = num(gl.MAX_VARYING_VECTORS, 8);
      try {
        var pr = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE);
        if (pr && pr.length > 1) c.maxPointSize = pr[1];
      } catch (e0) { /* noop */ }

      var vendor = '', renderer = '';
      try {
        var dbg = gl.getExtension('WEBGL_debug_renderer_info');
        if (dbg) {
          vendor = String(gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) || '');
          renderer = String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || '');
        }
      } catch (e1) { /* noop */ }
      if (!renderer) {
        try { renderer = String(gl.getParameter(gl.RENDERER) || ''); } catch (e2) { renderer = ''; }
      }
      if (!vendor) {
        try { vendor = String(gl.getParameter(gl.VENDOR) || ''); } catch (e3) { vendor = ''; }
      }
      c.vendor = vendor;
      c.renderer = renderer;
      c.rendererRaw = renderer;

      c.isSoftware = /swiftshader|llvmpipe|software|softpipe|mesa offscreen|angle \(google, vulkan 1\.\d+\.\d+ \(swiftshader/i.test(renderer);
      c.isWeak = c.isSoftware || /intel.*(hd|uhd|iris)?\s?graphics\s?(2|3|4|5|6)\d{2}/i.test(renderer) ||
        /mali-4|mali-t|adreno \(tm\) [23]\d\d/i.test(renderer);

      // extensiones
      try {
        c.anisoAvailable = !!(gl.getExtension('EXT_texture_filter_anisotropic') ||
          gl.getExtension('WEBKIT_EXT_texture_filter_anisotropic') ||
          gl.getExtension('MOZ_EXT_texture_filter_anisotropic'));
        GL._anisoExt = gl.getExtension('EXT_texture_filter_anisotropic') ||
          gl.getExtension('WEBKIT_EXT_texture_filter_anisotropic') ||
          gl.getExtension('MOZ_EXT_texture_filter_anisotropic');
        if (GL._anisoExt) {
          c.maxAniso = num(GL._anisoExt.MAX_TEXTURE_MAX_ANISOTROPY_EXT, 1);
        }
      } catch (e4) { c.anisoAvailable = false; GL._anisoExt = null; }

      try {
        c.derivativesAvailable = c.isWebGL2 || !!gl.getExtension('OES_standard_derivatives');
      } catch (e5) { c.derivativesAvailable = c.isWebGL2; }

      try {
        c.uintIndex = c.isWebGL2 || !!gl.getExtension('OES_element_index_uint');
      } catch (e6) { c.uintIndex = c.isWebGL2; }

      if (c.maxTextureSize < 256) c.maxTextureSize = 256;
      return c;
    },

    getExtension: function (name) {
      if (!GL.gl) return null;
      try { return GL.gl.getExtension(name); } catch (e) { return null; }
    },

    _resetCaches: function () {
      GL._currentProgram = null;
      GL._boundMesh = null;
      GL._unitTextures = [];
      GL._activeUnit = 0;
      var s = GL._state;
      s.depthTest = true;
      s.depthWrite = true;
      s.depthFunc = GL.gl ? GL.gl.LEQUAL : 0;
      s.cull = 'none';
      s.blend = 'none';
      s.clearColor = null;
      s.viewport = null;
      s.scissor = null;
      GL._white = null;
    },

    isLost: function () {
      return !!(GL._lost || !GL.gl || (GL.gl && GL.gl.isContextLost && GL.gl.isContextLost()));
    },

    onContextLost: function (cb) {
      if (typeof cb === 'function') GL._onLost.push(cb);
    },

    onContextRestored: function (cb) {
      if (typeof cb === 'function') GL._onRestored.push(cb);
    },

    /* ==================================================================
     * Programas
     * ================================================================== */
    _withDefines: function (source, defines) {
      if (!defines) return source;
      var out = '';
      for (var k in defines) {
        if (!Object.prototype.hasOwnProperty.call(defines, k)) continue;
        var v = defines[k];
        if (v === true) out += '#define ' + k + ' 1\n';
        else if (v === false || v === null) continue;
        else out += '#define ' + k + ' ' + v + '\n';
      }
      return out + source;
    },

    compileShader: function (type, source, label) {
      var gl = GL.gl;
      if (!gl || typeof source !== 'string') return null;
      var sh = gl.createShader(type);
      gl.shaderSource(sh, source);
      gl.compileShader(sh);
      var ok = false;
      try { ok = gl.getShaderParameter(sh, gl.COMPILE_STATUS); } catch (e) { ok = false; }
      if (!ok) {
        var log = '';
        try { log = gl.getShaderInfoLog(sh) || ''; } catch (e2) { log = ''; }
        var lines = source.split('\n');
        var numbered = [];
        for (var i = 0; i < lines.length; i++) numbered.push((i + 1) + ': ' + lines[i]);
        BS.Log.error('BS.GL: fallo al compilar shader ' + (label || '') + '\n' + log + '\n' + numbered.join('\n'));
        try { gl.deleteShader(sh); } catch (e3) { /* noop */ }
        return null;
      }
      if (type === gl.VERTEX_SHADER) GL._vsCount++; else GL._fsCount++;
      return sh;
    },

    /**
     * Compila y linka un programa con localizaciones de atributo FIJAS.
     * bindAttribLocation se llama SIEMPRE antes de linkProgram.
     */
    createProgram: function (vsSource, fsSource, defines, attribBindings) {
      var gl = GL.gl;
      if (!gl) return null;

      var vs = GL.compileShader(gl.VERTEX_SHADER, GL._withDefines(vsSource, defines), 'vertex');
      var fs = GL.compileShader(gl.FRAGMENT_SHADER, GL._withDefines(fsSource, defines), 'fragment');
      if (!vs || !fs) {
        if (vs) { try { gl.deleteShader(vs); } catch (e) { /* noop */ } }
        if (fs) { try { gl.deleteShader(fs); } catch (e) { /* noop */ } }
        return null;
      }

      var prog = gl.createProgram();
      gl.attachShader(prog, vs);
      gl.attachShader(prog, fs);

      // Localizaciones fijas (contrato §3.3) — SIEMPRE antes de linkar
      gl.bindAttribLocation(prog, GL.ATTR.POS, 'aPos');
      gl.bindAttribLocation(prog, GL.ATTR.NORMAL, 'aNormal');
      gl.bindAttribLocation(prog, GL.ATTR.UV, 'aUV');
      gl.bindAttribLocation(prog, GL.ATTR.COLOR, 'aColor');
      if (attribBindings) {
        for (var a in attribBindings) {
          if (Object.prototype.hasOwnProperty.call(attribBindings, a)) {
            gl.bindAttribLocation(prog, attribBindings[a] | 0, a);
          }
        }
      }

      gl.linkProgram(prog);
      var linked = false;
      try { linked = gl.getProgramParameter(prog, gl.LINK_STATUS); } catch (e2) { linked = false; }
      if (!linked) {
        var log = '';
        try { log = gl.getProgramInfoLog(prog) || ''; } catch (e3) { log = ''; }
        BS.Log.error('BS.GL: fallo al linkar programa: ' + log);
        try { gl.deleteProgram(prog); } catch (e4) { /* noop */ }
        try { gl.deleteShader(vs); gl.deleteShader(fs); } catch (e5) { /* noop */ }
        return null;
      }

      gl.detachShader(prog, vs);
      gl.detachShader(prog, fs);
      try { gl.deleteShader(vs); gl.deleteShader(fs); } catch (e6) { /* noop */ }

      // Introspección de uniforms y atributos activos
      var uniforms = {}, attributes = {};
      var n = 0, i;
      try { n = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS) | 0; } catch (e7) { n = 0; }
      for (i = 0; i < n; i++) {
        var info = null;
        try { info = gl.getActiveUniform(prog, i); } catch (e8) { info = null; }
        if (!info || !info.name) continue;
        var loc = null;
        try { loc = gl.getUniformLocation(prog, info.name); } catch (e9) { loc = null; }
        if (loc === null) continue;
        uniforms[info.name] = loc;
        var base = info.name.replace(/\[0\]$/, '');
        if (base !== info.name) uniforms[base] = loc;
      }
      try { n = gl.getProgramParameter(prog, gl.ACTIVE_ATTRIBUTES) | 0; } catch (e10) { n = 0; }
      for (i = 0; i < n; i++) {
        var ai = null;
        try { ai = gl.getActiveAttrib(prog, i); } catch (e11) { ai = null; }
        if (!ai || !ai.name) continue;
        var al = -1;
        try { al = gl.getAttribLocation(prog, ai.name); } catch (e12) { al = -1; }
        attributes[ai.name] = al;
      }

      return {
        id: GL._programId++,
        program: prog,
        uniforms: uniforms,
        attributes: attributes,
        uniformCount: Object.keys ? Object.keys(uniforms).length : 0,
        vsSource: vsSource,
        fsSource: fsSource,
        defines: defines || null,
        label: (defines && defines.LABEL) ? String(defines.LABEL) : ''
      };
    },

    useProgram: function (prog) {
      var gl = GL.gl;
      if (!gl) return;
      var p = prog && prog.program ? prog.program : null;
      if (GL._currentProgram === p) return;
      gl.useProgram(p);
      GL._currentProgram = p;
    },

    currentProgram: function () {
      return GL._currentProgram;
    },

    disposeProgram: function (prog) {
      var gl = GL.gl;
      if (!gl || !prog) return;
      try { gl.deleteProgram(prog.program); } catch (e) { /* noop */ }
      if (GL._currentProgram === prog.program) GL._currentProgram = null;
    },

    /* ==================================================================
     * Helpers de uniforms — no-op silencioso si el uniform no está activo
     * ================================================================== */
    _loc: function (prog, name) {
      if (!prog || !prog.uniforms) return null;
      var l = prog.uniforms[name];
      return (l === undefined) ? null : l;
    },

    u1f: function (p, n, x) { var gl = GL.gl; if (!gl) return; var l = GL._loc(p, n); if (l) gl.uniform1f(l, x); },
    u2f: function (p, n, x, y) { var gl = GL.gl; if (!gl) return; var l = GL._loc(p, n); if (l) gl.uniform2f(l, x, y); },
    u3f: function (p, n, x, y, z) { var gl = GL.gl; if (!gl) return; var l = GL._loc(p, n); if (l) gl.uniform3f(l, x, y, z); },
    u4f: function (p, n, x, y, z, w) { var gl = GL.gl; if (!gl) return; var l = GL._loc(p, n); if (l) gl.uniform4f(l, x, y, z, w); },
    u1i: function (p, n, x) { var gl = GL.gl; if (!gl) return; var l = GL._loc(p, n); if (l) gl.uniform1i(l, x); },
    u1fv: function (p, n, a) { var gl = GL.gl; if (!gl || !a) return; var l = GL._loc(p, n); if (l) gl.uniform1fv(l, a); },
    u2fv: function (p, n, a) { var gl = GL.gl; if (!gl || !a) return; var l = GL._loc(p, n); if (l) gl.uniform2fv(l, a); },
    u3fv: function (p, n, a) { var gl = GL.gl; if (!gl || !a) return; var l = GL._loc(p, n); if (l) gl.uniform3fv(l, a); },
    u4fv: function (p, n, a) { var gl = GL.gl; if (!gl || !a) return; var l = GL._loc(p, n); if (l) gl.uniform4fv(l, a); },
    uMat3: function (p, n, a) { var gl = GL.gl; if (!gl || !a) return; var l = GL._loc(p, n); if (l) gl.uniformMatrix3fv(l, false, a); },
    uMat4: function (p, n, a) { var gl = GL.gl; if (!gl || !a) return; var l = GL._loc(p, n); if (l) gl.uniformMatrix4fv(l, false, a); },

    hasUniform: function (prog, name) {
      return GL._loc(prog, name) !== null;
    },

    /** Asigna textura a una unidad y enlaza el sampler. `texture` null -> blanco. */
    uTex: function (prog, name, unit, texture) {
      var gl = GL.gl;
      if (!gl) return;
      var l = GL._loc(prog, name);
      if (!l) return;
      unit = unit | 0;
      gl.activeTexture(gl.TEXTURE0 + unit);
      GL._activeUnit = unit;
      gl.bindTexture(gl.TEXTURE_2D, texture || GL._white);
      GL._unitTextures[unit] = texture || GL._white;
      gl.uniform1i(l, unit);
    },

    /* ==================================================================
     * Meshes
     * ================================================================== */
    createMesh: function (vertexData, indexData, aabb) {
      var gl = GL.gl;
      if (!gl || !vertexData || !indexData) return null;
      var vbo = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.bufferData(gl.ARRAY_BUFFER, vertexData, gl.STATIC_DRAW);
      var ibo = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indexData, gl.STATIC_DRAW);

      var bytes = vertexData.byteLength;
      var vertexCount = Math.floor(bytes / STRIDE);
      GL._boundMesh = null;

      return {
        vbo: vbo,
        ibo: ibo,
        indexCount: indexData.length,
        indexType: gl.UNSIGNED_SHORT,
        vertexCount: vertexCount,
        stride: STRIDE,
        byteLength: bytes,
        dynamic: false,
        aabb: aabb || BS.Math.aabb([0, 0, 0], [0, 0, 0]),
        attribs: true
      };
    },

    createDynamicMesh: function (maxVertices, maxIndices, aabb) {
      var gl = GL.gl;
      if (!gl) return null;
      maxVertices = Math.max(1, maxVertices | 0);
      maxIndices = Math.max(3, maxIndices | 0);
      var maxBytes = maxVertices * STRIDE;

      var vbo = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.bufferData(gl.ARRAY_BUFFER, maxBytes, gl.DYNAMIC_DRAW);

      var ibo = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, maxIndices * 2, gl.DYNAMIC_DRAW);

      GL._boundMesh = null;

      var mesh = {
        vbo: vbo,
        ibo: ibo,
        indexCount: 0,
        indexType: gl.UNSIGNED_SHORT,
        vertexCount: 0,
        stride: STRIDE,
        byteLength: 0,
        dynamic: true,
        maxVertices: maxVertices,
        maxIndices: maxIndices,
        maxBytes: maxBytes,
        aabb: aabb || BS.Math.aabb([0, 0, 0], [0, 0, 0]),
        attribs: true
      };

      return {
        mesh: mesh,
        uploadVertex: function (data, vertexCount) {
          if (!data) return;
          var count = (vertexCount === undefined || vertexCount === null) ? (data.byteLength / STRIDE) : vertexCount;
          count = Math.min(count | 0, mesh.maxVertices);
          var bytes = count * STRIDE;
          if (bytes <= 0) { mesh.vertexCount = 0; return; }
          gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
          var view = (data.byteLength > bytes && typeof data.subarray === 'function') ? data.subarray(0, bytes) : data;
          gl.bufferSubData(gl.ARRAY_BUFFER, 0, view);
          mesh.vertexCount = count;
          mesh.byteLength = bytes;
          GL._boundMesh = null;
        },
        uploadIndex: function (data, indexCount) {
          if (!data) return;
          var count = (indexCount === undefined || indexCount === null) ? data.length : indexCount;
          count = Math.min(count | 0, mesh.maxIndices);
          if (count <= 0) { mesh.indexCount = 0; return; }
          gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
          var view = (data.length > count && typeof data.subarray === 'function') ? data.subarray(0, count) : data;
          gl.bufferSubData(gl.ELEMENT_ARRAY_BUFFER, 0, view);
          mesh.indexCount = count;
        }
      };
    },

    uploadVertexBuffer: function (mesh, data, byteLength) {
      var gl = GL.gl;
      if (!gl || !mesh || !mesh.vbo || !data) return;
      gl.bindBuffer(gl.ARRAY_BUFFER, mesh.vbo);
      var len = (byteLength === undefined || byteLength === null) ? data.byteLength : byteLength;
      var view = (data.byteLength > len && typeof data.subarray === 'function') ? data.subarray(0, len) : data;
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, view);
      mesh.vertexCount = Math.floor(len / STRIDE);
      mesh.byteLength = len;
      GL._boundMesh = null;
    },

    disposeMesh: function (mesh) {
      var gl = GL.gl;
      if (!gl || !mesh) return;
      try { if (mesh.vbo) gl.deleteBuffer(mesh.vbo); } catch (e) { /* noop */ }
      try { if (mesh.ibo) gl.deleteBuffer(mesh.ibo); } catch (e2) { /* noop */ }
      if (GL._boundMesh === mesh) GL._boundMesh = null;
      mesh.vbo = null;
      mesh.ibo = null;
    },

    /** Enlaza el VBO con el layout fijo (sin VAO: WebGL1 puro). */
    bindMesh: function (mesh) {
      var gl = GL.gl;
      if (!gl || !mesh || !mesh.vbo) return false;
      if (GL._boundMesh === mesh) return true;
      gl.bindBuffer(gl.ARRAY_BUFFER, mesh.vbo);
      gl.enableVertexAttribArray(GL.ATTR.POS);
      gl.vertexAttribPointer(GL.ATTR.POS, 3, gl.FLOAT, false, STRIDE, 0);
      gl.enableVertexAttribArray(GL.ATTR.NORMAL);
      gl.vertexAttribPointer(GL.ATTR.NORMAL, 3, gl.FLOAT, false, STRIDE, 12);
      gl.enableVertexAttribArray(GL.ATTR.UV);
      gl.vertexAttribPointer(GL.ATTR.UV, 2, gl.FLOAT, false, STRIDE, 24);
      gl.enableVertexAttribArray(GL.ATTR.COLOR);
      gl.vertexAttribPointer(GL.ATTR.COLOR, 4, gl.UNSIGNED_BYTE, true, STRIDE, 32);
      GL._boundMesh = mesh;
      return true;
    },

    drawMesh: function (mesh) {
      var gl = GL.gl;
      if (!gl || !mesh || !mesh.ibo || !mesh.indexCount) return 0;
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.ibo);
      gl.drawElements(gl.TRIANGLES, mesh.indexCount, mesh.indexType || gl.UNSIGNED_SHORT, 0);
      GL._drawCalls++;
      return mesh.indexCount / 3;
    },

    /* ==================================================================
     * Texturas
     * ================================================================== */
    createTextureFromCanvas: function (srcCanvas, opts) {
      var gl = GL.gl;
      if (!gl || !srcCanvas) return null;
      opts = opts || {};
      var tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, opts.flipY === true);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, srcCanvas);
      var w = srcCanvas.width | 0, h = srcCanvas.height | 0;
      var pot = BS.Util.isPowerOfTwo(w) && BS.Util.isPowerOfTwo(h);
      var mip = (opts.mipmaps !== false) && pot;
      if (mip) gl.generateMipmap(gl.TEXTURE_2D);
      var wrap = (opts.wrap === 'clamp' || !pot) ? gl.CLAMP_TO_EDGE : gl.REPEAT;
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mip ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
      if (opts.aniso && GL._anisoExt) {
        try {
          gl.texParameterf(gl.TEXTURE_2D, GL._anisoExt.TEXTURE_MAX_ANISOTROPY_EXT,
            Math.max(1, Math.min(opts.aniso, GL.caps.maxAniso)));
        } catch (e) { /* noop */ }
      }
      tex._w = w; tex._h = h;
      GL._unitTextures = [];
      return tex;
    },

    createTexture2D: function (w, h, pixels, opts) {
      var gl = GL.gl;
      if (!gl) return null;
      opts = opts || {};
      w = Math.max(1, w | 0); h = Math.max(1, h | 0);
      var tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      if (pixels) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      var pot = BS.Util.isPowerOfTwo(w) && BS.Util.isPowerOfTwo(h);
      var mip = (opts.mipmaps === true) && pot;
      if (mip) gl.generateMipmap(gl.TEXTURE_2D);
      var wrap = (opts.wrap === 'repeat' && pot) ? gl.REPEAT : gl.CLAMP_TO_EDGE;
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mip ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
      tex._w = w; tex._h = h;
      GL._unitTextures = [];
      return tex;
    },

    disposeTexture: function (tex) {
      var gl = GL.gl;
      if (!gl || !tex) return;
      try { gl.deleteTexture(tex); } catch (e) { /* noop */ }
      GL._unitTextures = [];
      if (GL._white === tex) GL._white = null;
    },

    getWhiteTexture: function () {
      if (!GL._white && GL.gl) {
        GL._white = GL.createTexture2D(1, 1, new Uint8Array([255, 255, 255, 255]), { mipmaps: false, wrap: 'clamp' });
      }
      return GL._white;
    },

    /* ==================================================================
     * Framebuffers (color RGBA8 + renderbuffer DEPTH_COMPONENT16)
     * ================================================================== */
    createFramebuffer: function (w, h, withDepth) {
      var gl = GL.gl;
      if (!gl) return null;
      w = Math.max(1, w | 0); h = Math.max(1, h | 0);

      var colorTex = GL.createTexture2D(w, h, null, { mipmaps: false, wrap: 'clamp' });
      var fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, colorTex, 0);

      var depthRb = null;
      if (withDepth !== false) {
        depthRb = gl.createRenderbuffer();
        gl.bindRenderbuffer(gl.RENDERBUFFER, depthRb);
        gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, w, h);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depthRb);
      }

      var status = -1;
      try { status = gl.checkFramebufferStatus(gl.FRAMEBUFFER); } catch (e) { status = -1; }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);

      if (status !== gl.FRAMEBUFFER_COMPLETE) {
        BS.Log.warn('BS.GL.createFramebuffer: FBO incompleto (status=' + status + '), se degrada a render directo');
        try { gl.deleteFramebuffer(fbo); } catch (e2) { /* noop */ }
        if (colorTex) GL.disposeTexture(colorTex);
        if (depthRb) { try { gl.deleteRenderbuffer(depthRb); } catch (e3) { /* noop */ } }
        return null;
      }
      return { fbo: fbo, colorTex: colorTex, depthRb: depthRb, w: w, h: h, complete: true };
    },

    resizeFramebuffer: function (fb, w, h) {
      var gl = GL.gl;
      if (!gl || !fb) return false;
      w = Math.max(1, w | 0); h = Math.max(1, h | 0);
      if (fb.w === w && fb.h === h) return true;
      try {
        gl.bindTexture(gl.TEXTURE_2D, fb.colorTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.bindFramebuffer(gl.FRAMEBUFFER, fb.fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, fb.colorTex, 0);
        if (fb.depthRb) {
          gl.bindRenderbuffer(gl.RENDERBUFFER, fb.depthRb);
          gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, w, h);
          gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, fb.depthRb);
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        fb.w = w; fb.h = h;
        return true;
      } catch (e) {
        BS.Log.error('BS.GL.resizeFramebuffer:', e && e.message ? e.message : e);
        return false;
      }
    },

    disposeFramebuffer: function (fb) {
      var gl = GL.gl;
      if (!gl || !fb) return;
      try { if (fb.fbo) gl.deleteFramebuffer(fb.fbo); } catch (e) { /* noop */ }
      if (fb.colorTex) GL.disposeTexture(fb.colorTex);
      try { if (fb.depthRb) gl.deleteRenderbuffer(fb.depthRb); } catch (e2) { /* noop */ }
    },

    bindFramebuffer: function (fb) {
      var gl = GL.gl;
      if (!gl) return;
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb ? fb.fbo : null);
    },

    /* ==================================================================
     * Utilidad de depuración: blit de una textura a pantalla
     * ================================================================== */
    _blitProg: null,
    _blitBuf: null,

    _ensureBlit: function () {
      var gl = GL.gl;
      if (!gl || GL._blitProg) return;
      var vs = 'attribute vec2 aQuadP;\nvarying vec2 vUv;\nvoid main(){ vUv = aQuadP*0.5+0.5; gl_Position = vec4(aQuadP,0.0,1.0); }';
      var fs = 'precision mediump float;\nvarying vec2 vUv;\nuniform sampler2D uTex;\nvoid main(){ gl_FragColor = texture2D(uTex, vUv); }';
      var sh = GL.compileShader(gl.VERTEX_SHADER, vs, 'blit-vs');
      var sh2 = GL.compileShader(gl.FRAGMENT_SHADER, fs, 'blit-fs');
      if (!sh || !sh2) return;
      var p = gl.createProgram();
      gl.attachShader(p, sh); gl.attachShader(p, sh2);
      gl.bindAttribLocation(p, 0, 'aQuadP');
      gl.linkProgram(p);
      var ok = false;
      try { ok = gl.getProgramParameter(p, gl.LINK_STATUS); } catch (e) { ok = false; }
      if (!ok) { BS.Log.warn('BS.GL: programa de blit no compiló'); return; }
      gl.detachShader(p, sh); gl.detachShader(p, sh2);
      gl.deleteShader(sh); gl.deleteShader(sh2);
      GL._blitProg = {
        program: p,
        uniforms: { uTex: gl.getUniformLocation(p, 'uTex') },
        attributes: { aQuadP: 0 }
      };
      GL._blitBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, GL._blitBuf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    },

    blitToScreen: function (srcTex, dstW, dstH) {
      var gl = GL.gl;
      if (!gl || !srcTex) return;
      GL._ensureBlit();
      if (!GL._blitProg) return;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      GL._state.viewport = null;
      GL.setViewport(0, 0, dstW, dstH);
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.CULL_FACE);
      gl.disable(gl.BLEND);
      gl.useProgram(GL._blitProg.program);
      gl.bindBuffer(gl.ARRAY_BUFFER, GL._blitBuf);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, srcTex);
      if (GL._blitProg.uniforms.uTex) gl.uniform1i(GL._blitProg.uniforms.uTex, 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    },

    /* ==================================================================
     * Estado con caché
     * ================================================================== */
    setViewport: function (x, y, w, h) {
      var gl = GL.gl;
      if (!gl) return;
      var v = GL._state.viewport;
      if (v && v[0] === x && v[1] === y && v[2] === w && v[3] === h) return;
      gl.viewport(x, y, w, h);
      GL._state.viewport = [x, y, w, h];
    },

    setState: function (s) {
      var gl = GL.gl;
      if (!gl || !s) return;
      var st = GL._state;

      if (s.depthTest !== undefined && s.depthTest !== st.depthTest) {
        if (s.depthTest) gl.enable(gl.DEPTH_TEST); else gl.disable(gl.DEPTH_TEST);
        st.depthTest = !!s.depthTest;
      }
      if (s.depthWrite !== undefined && s.depthWrite !== st.depthWrite) {
        gl.depthMask(!!s.depthWrite);
        st.depthWrite = !!s.depthWrite;
      }
      if (s.depthFunc !== undefined && s.depthFunc !== st.depthFunc) {
        gl.depthFunc(s.depthFunc);
        st.depthFunc = s.depthFunc;
      }
      if (s.cull !== undefined && s.cull !== st.cull) {
        if (s.cull === 'none' || s.cull === null) {
          gl.disable(gl.CULL_FACE);
        } else {
          gl.enable(gl.CULL_FACE);
          gl.cullFace(s.cull === 'front' ? gl.FRONT : gl.BACK);
        }
        st.cull = s.cull;
      }
      if (s.blend !== undefined && s.blend !== st.blend) {
        switch (s.blend) {
          case 'alpha':
            gl.enable(gl.BLEND);
            gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
            break;
          case 'add':
            gl.enable(gl.BLEND);
            gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
            break;
          case 'multiply':
            gl.enable(gl.BLEND);
            gl.blendFunc(gl.DST_COLOR, gl.ZERO);
            break;
          default:
            gl.disable(gl.BLEND);
            break;
        }
        st.blend = s.blend;
      }
      if (s.scissor !== undefined) {
        if (s.scissor === null) {
          if (st.scissor !== null) { gl.disable(gl.SCISSOR_TEST); st.scissor = null; }
        } else {
          gl.enable(gl.SCISSOR_TEST);
          gl.scissor(s.scissor[0], s.scissor[1], s.scissor[2], s.scissor[3]);
          st.scissor = s.scissor.slice ? s.scissor.slice(0, 4) : s.scissor;
        }
      }
      if (s.clearColor !== undefined && s.clearColor !== null) {
        GL.setClearColor(s.clearColor);
      }
    },

    setClearColor: function (c) {
      var gl = GL.gl;
      if (!gl || !c) return;
      var st = GL._state.clearColor;
      if (st && st[0] === c[0] && st[1] === c[1] && st[2] === c[2] && st[3] === c[3]) return;
      gl.clearColor(c[0], c[1], c[2], c[3] === undefined ? 1 : c[3]);
      GL._state.clearColor = [c[0], c[1], c[2], c[3] === undefined ? 1 : c[3]];
    },

    clear: function (color, depth) {
      var gl = GL.gl;
      if (!gl) return;
      var mask = 0;
      if (color) {
        GL.setClearColor(color);
        if (GL._state.depthWrite === false) { gl.depthMask(true); GL._state.depthWrite = true; }
        mask |= gl.COLOR_BUFFER_BIT;
      }
      if (depth) {
        if (GL._state.depthWrite === false) { gl.depthMask(true); GL._state.depthWrite = true; }
        mask |= gl.DEPTH_BUFFER_BIT;
      }
      if (mask) gl.clear(mask);
    },

    /* ==================================================================
     * Info
     * ================================================================== */
    info: function () {
      return {
        context: GL.caps.contextName,
        renderer: GL.caps.renderer,
        vendor: GL.caps.vendor,
        isWebGL2: GL.caps.isWebGL2,
        isSoftware: GL.caps.isSoftware,
        isWeak: GL.caps.isWeak,
        maxTextureSize: GL.caps.maxTextureSize,
        maxFragmentUniformVectors: GL.caps.maxFragmentUniformVectors,
        maxVertexUniformVectors: GL.caps.maxVertexUniformVectors,
        maxVertexAttribs: GL.caps.maxVertexAttribs,
        anisoAvailable: GL.caps.anisoAvailable,
        maxAniso: GL.caps.maxAniso,
        derivativesAvailable: GL.caps.derivativesAvailable,
        uintIndex: GL.caps.uintIndex,
        attrLocations: { aPos: GL.ATTR.POS, aNormal: GL.ATTR.NORMAL, aUV: GL.ATTR.UV, aColor: GL.ATTR.COLOR },
        stride: STRIDE,
        drawCallsTotal: GL._drawCalls
      };
    }
  };

  BS.GL = GL;

  /* ======================================================================
   * Test: caps rellenas y contrato de atributos
   * ==================================================================== */
  if (BS.Debug && typeof BS.Debug.register === 'function') {
    BS.Debug.register('gl:caps', function () {
      var caps = GL.caps;
      var hasContext = !!GL.gl;
      var reasons = [];
      if (!hasContext) reasons.push('sin contexto WebGL (getContext devolvió null)');
      if (hasContext && !(caps.maxTextureSize >= 256)) reasons.push('maxTextureSize sospechoso');
      if (GL.STRIDE !== 36) reasons.push('stride != 36');
      if (GL.ATTR.POS !== 0 || GL.ATTR.NORMAL !== 1 || GL.ATTR.UV !== 2 || GL.ATTR.COLOR !== 3) {
        reasons.push('localizaciones de atributo alteradas');
      }
      return {
        ok: reasons.length === 0,
        reasons: reasons,
        hasContext: hasContext,
        context: caps.contextName,
        renderer: caps.renderer,
        isWebGL2: caps.isWebGL2,
        isSoftware: caps.isSoftware,
        maxTextureSize: caps.maxTextureSize,
        maxFragmentUniformVectors: caps.maxFragmentUniformVectors,
        maxVertexUniformVectors: caps.maxVertexUniformVectors,
        maxVertexAttribs: caps.maxVertexAttribs,
        anisoAvailable: caps.anisoAvailable,
        maxAniso: caps.maxAniso,
        uintIndex: caps.uintIndex,
        stride: STRIDE,
        creationError: GL.creationError
      };
    });

    /* Test opcional: compilar un shader trivial (si hay contexto). */
    BS.Debug.register('gl:trivialProgram', function () {
      if (!GL.gl) return { ok: true, skipped: 'sin contexto WebGL' };
      var vs = 'attribute vec3 aPos; void main(){ gl_Position = vec4(aPos, 1.0); }';
      var fs = 'precision mediump float; void main(){ gl_FragColor = vec4(1.0); }';
      var p = GL.createProgram(vs, fs, { LABEL: '1' });
      if (!p) return { ok: false, error: 'createProgram devolvió null' };
      var posLoc = p.attributes ? p.attributes.aPos : -1;
      var alphaLoc = GL._loc(p, 'uNoExiste');
      GL.disposeProgram(p);
      return {
        ok: posLoc === 0 && alphaLoc === null,
        aPosLocation: posLoc,
        uniformInexistenteDevuelveNull: alphaLoc === null
      };
    });
  }

})(window.BS = window.BS || {});
