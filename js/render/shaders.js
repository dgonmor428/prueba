/* ===========================================================================
 * BLACKSITE: LAST SIGNAL  —  js/render/shaders.js
 * ---------------------------------------------------------------------------
 * Propósito : fuentes GLSL ES 1.00 (sin #version, con attribute/varying/
 *             gl_FragColor) de los 4 programas del motor. Los nombres de los
 *             uniforms son EXACTOS según §3.7. Las luces dinámicas se
 *             DESENROLLAN con `if (uLightCount > k)` e índices literales
 *             porque GLSL ES 1.00 no admite bucles con índice no constante.
 *             Fog exponencial al cuadrado + ambiente hemisférico + linterna
 *             spot con smoothstep + emisivo por `aColor.a`.
 *             El normal map es OPCIONAL y se protege con #define: la base
 *             tangente se aproxima sin dFdx (evita OES_standard_derivatives,
 *             riesgo R10) para funcionar igual en WebGL1 sin extensiones.
 * Depende de: nada (solo strings). Lo consume BS.Renderer.
 * Expone    : BS.Shaders
 * =========================================================================== */
(function (BS) {
  'use strict';

  var MAX_DYNAMIC_LIGHTS = 3;

  var BASIC_VS = [
    'attribute vec3 aPos;',
    'attribute vec3 aNormal;',
    'attribute vec2 aUV;',
    'attribute vec4 aColor;',
    '',
    'uniform mat4 uProj;',
    'uniform mat4 uView;',
    'uniform mat4 uModel;',
    'uniform vec2 uUvScale;',
    '',
    'varying vec3 vNormal;',
    'varying vec3 vWorldPos;',
    'varying vec2 vUV;',
    'varying vec4 vColor;',
    '',
    'void main() {',
    '  vec4 wp = uModel * vec4(aPos, 1.0);',
    '  vWorldPos = wp.xyz;',
    '  vNormal = (uModel * vec4(aNormal, 0.0)).xyz;',
    '  vUV = aUV * uUvScale;',
    '  vColor = aColor;',
    '  gl_Position = uProj * uView * wp;',
    '}'
  ].join('\n');

  /* Bloque de una luz puntual desenrollada (índice literal). */
  function lightBlock(i) {
    return [
      '  if (uLightCount > ' + i + ') {',
      '    vec3 L' + i + ' = uLightPos[' + i + '].xyz - vWorldPos;',
      '    float d' + i + ' = length(L' + i + ');',
      '    L' + i + ' = L' + i + ' / max(d' + i + ', 0.0001);',
      '    float a' + i + ' = 1.0 - clamp(d' + i + ' / max(uLightPos[' + i + '].w, 0.0001), 0.0, 1.0);',
      '    a' + i + ' = a' + i + ' * a' + i + ';',
      '    float ndl' + i + ' = max(dot(N, L' + i + '), 0.0);',
      '    acc += uLightColor[' + i + '].rgb * (uLightColor[' + i + '].w * a' + i + ' * ndl' + i + ');',
      '    if (ndl' + i + ' > 0.0) {',
      '      vec3 H' + i + ' = normalize(L' + i + ' + V);',
      '      specAcc += uLightColor[' + i + '].rgb * (uLightColor[' + i + '].w * a' + i + ' * pow(max(dot(N, H' + i + '), 0.0), 24.0));',
      '    }',
      '  }'
    ].join('\n');
  }

  function lightBlocks(n) {
    var out = [];
    for (var i = 0; i < n; i++) out.push(lightBlock(i));
    return out.join('\n');
  }

  var BASIC_FS = [
    'precision mediump float;',
    '',
    'uniform vec3 uCameraPos;',
    'uniform float uTime;',
    'uniform vec4 uColorTint;',
    'uniform sampler2D uMap;',
    'uniform sampler2D uNormalMap;',
    'uniform sampler2D uEmissiveMap;',
    'uniform float uSpecular;',
    'uniform float uNormalStrength;',
    'uniform vec4 uEmissive;',
    'uniform vec3 uAmbientSky;',
    'uniform vec3 uAmbientGround;',
    'uniform vec3 uFogColor;',
    'uniform float uFogDensity;',
    'uniform int uLightCount;',
    'uniform vec4 uLightPos[{{MAX_DYNAMIC_LIGHTS}}];',
    'uniform vec4 uLightColor[{{MAX_DYNAMIC_LIGHTS}}];',
    'uniform vec4 uFlashPos;',
    'uniform vec4 uFlashDir;',
    'uniform vec4 uFlashColor;',
    'uniform float uFlashCosInner;',
    '',
    'varying vec3 vNormal;',
    'varying vec3 vWorldPos;',
    'varying vec2 vUV;',
    'varying vec4 vColor;',
    '',
    'void main() {',
    '  vec4 albedo = texture2D(uMap, vUV) * uColorTint;',
    '#ifdef ALPHA_TEST',
    '  if (albedo.a < 0.35) discard;',
    '#endif',
    '',
    '  vec3 N = normalize(vNormal);',
    '#ifdef USE_NORMALMAP',
    '  vec3 nmv = texture2D(uNormalMap, vUV).xyz * 2.0 - 1.0;',
    '  vec3 upv = abs(N.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(0.0, 0.0, 1.0);',
    '  vec3 Tv = normalize(cross(upv, N));',
    '  vec3 Bv = cross(N, Tv);',
    '  N = normalize(N + (Tv * nmv.x + Bv * nmv.y) * uNormalStrength);',
    '#endif',
    '',
    '  vec3 V = normalize(uCameraPos - vWorldPos);',
    '',
    '  // ambiente hemisferico: cielo arriba, suelo abajo',
    '  vec3 acc = mix(uAmbientGround, uAmbientSky, N.y * 0.5 + 0.5);',
    '  vec3 specAcc = vec3(0.0);',
    '',
    '  // luces dinamicas desenrolladas (sin bucles de indice no constante)',
    '{{LIGHT_BLOCKS}}',
    '',
    '  // linterna spot del jugador: cono con smoothstep + atenuacion por alcance',
    '  // (uFlashDir.w = cosOuter, uFlashCosInner = cosInner; inner > outer)',
    '  if (uFlashColor.w > 0.0) {',
    '    vec3 FL = uFlashPos.xyz - vWorldPos;',
    '    float fd = length(FL);',
    '    FL = FL / max(fd, 0.0001);',
    '    // dot(-FL, dir) = 1 en el CENTRO del haz; smoothstep(cosOuter, cosInner, .)',
    '    // vale 1 en el centro y 0 fuera (cosInner > cosOuter), asi que NO se invierte.',
    '    float cdot = dot(-FL, uFlashDir.xyz);',
    '    float cone = smoothstep(uFlashDir.w, uFlashCosInner, cdot);',
    '    // nucleo central mas brillante (hotspot) y penumbra suave en el borde',
    '    float core = smoothstep(uFlashDir.w, 1.0, cdot);',
    '    cone = cone * (0.6 + 0.4 * core);',
    '    float fatt = 1.0 - clamp(fd / max(uFlashPos.w, 0.0001), 0.0, 1.0);',
    '    fatt = fatt * fatt;',
    '    float fndl = max(dot(N, FL), 0.0);',
    '    acc += uFlashColor.rgb * (uFlashColor.w * cone * fatt * fndl);',
    '    if (fndl > 0.0) {',
    '      vec3 FH = normalize(FL + V);',
    '      specAcc += uFlashColor.rgb * (uFlashColor.w * cone * fatt * pow(max(dot(N, FH), 0.0), 40.0));',
    '    }',
    '  }',
    '',
    '  // aColor.rgb = luz horneada / AO / tinte de la pieza',
    '  vec3 base = albedo.rgb * vColor.rgb;',
    '  vec3 color = base * acc + specAcc * uSpecular;',
    '',
    '  // emisivo: uEmissive.rgb * uEmissive.a * aColor.a * 2.0',
    '  vec3 em = uEmissive.rgb * uEmissive.a * vColor.a * 2.0;',
    '#ifdef USE_EMISSIVEMAP',
    '  em *= texture2D(uEmissiveMap, vUV).rgb;',
    '#endif',
    '',
    '  // niebla exponencial al cuadrado, aplicada al final al conjunto',
    '  float dist = length(uCameraPos - vWorldPos);',
    '  float fg = dist * uFogDensity;',
    '  float fog = clamp(1.0 - exp(-fg * fg), 0.0, 1.0);',
    '#ifdef NO_FOG',
    '  fog = 0.0;',
    '#endif',
    '  vec3 fogged = mix(color + em, uFogColor, fog);',
    '  // el emisivo emerge parcialmente a traves de la niebla',
    '  fogged += em * fog * 0.5;',
    '',
    '  gl_FragColor = vec4(fogged, albedo.a);',
    '}'
  ].join('\n');

  /* ---------------------------- sprites ---------------------------- */
  var SPRITE_VS = [
    'attribute vec3 aPos;',
    'attribute vec2 aUV;',
    'attribute vec4 aColor;',
    '',
    'uniform mat4 uProj;',
    'uniform mat4 uView;',
    '',
    'varying vec2 vUV;',
    'varying vec4 vColor;',
    'varying vec3 vWorldPos;',
    '',
    'void main() {',
    '  vUV = aUV;',
    '  vColor = aColor;',
    '  vWorldPos = aPos;',
    '  gl_Position = uProj * uView * vec4(aPos, 1.0);',
    '}'
  ].join('\n');

  var SPRITE_FS = [
    'precision mediump float;',
    '',
    'uniform sampler2D uMap;',
    'uniform vec4 uColorTint;',
    'uniform vec4 uEmissive;',
    'uniform vec3 uFogColor;',
    'uniform float uFogDensity;',
    'uniform vec3 uCameraPos;',
    'uniform float uTime;',
    '',
    'varying vec2 vUV;',
    'varying vec4 vColor;',
    'varying vec3 vWorldPos;',
    '',
    'void main() {',
    '  vec4 t = texture2D(uMap, vUV);',
    '  vec3 c = t.rgb * uColorTint.rgb * vColor.rgb * 2.0;',
    '  c += uEmissive.rgb * uEmissive.a * vColor.a;',
    '  float a = t.a * uColorTint.a * max(vColor.a, 0.02);',
    '  float dist = length(uCameraPos - vWorldPos);',
    '  float fg = dist * uFogDensity;',
    '  float fog = clamp(1.0 - exp(-fg * fg), 0.0, 1.0);',
    '  c = mix(c, uFogColor, fog * 0.6);',
    '  gl_FragColor = vec4(c, a);',
    '}'
  ].join('\n');

  /* ------------------------- post-proceso ------------------------- */
  var POST_VS = [
    'attribute vec2 aPos;',
    'varying vec2 vUv;',
    'void main() {',
    '  vUv = aPos * 0.5 + 0.5;',
    '  gl_Position = vec4(aPos, 0.0, 1.0);',
    '}'
  ].join('\n');

  var POST_FS = [
    'precision mediump float;',
    '',
    'uniform sampler2D uTex;',
    'uniform vec2 uResolution;',
    'uniform float uVignette;',
    'uniform float uDamage;',
    'uniform float uLowHealth;',
    'uniform float uTime;',
    'uniform float uNoise;',
    '',
    'varying vec2 vUv;',
    '',
    'void main() {',
    '  vec3 c = texture2D(uTex, vUv).rgb;',
    '  // scanlines',
    '  float sl = 0.94 + 0.06 * sin(vUv.y * uResolution.y * 1.55);',
    '  c *= sl;',
    '  // grano animado determinista',
    '  float g = fract(sin(dot(vUv * uResolution + vec2(uTime * 37.0, uTime * 11.0), vec2(12.9898, 78.233))) * 43758.5453);',
    '  c += (g - 0.5) * uNoise;',
    '  // vineta',
    '  vec2 q = vUv - 0.5;',
    '  float vig = 1.0 - dot(q, q) * uVignette;',
    '  c *= clamp(vig, 0.0, 1.0);',
    '  // tinte de dano',
    '  c = mix(c, vec3(0.72, 0.05, 0.05), clamp(uDamage, 0.0, 1.0) * 0.55);',
    '  // aviso de vida baja en los bordes',
    '  float lp = length(q) * 2.0;',
    '  c = mix(c, vec3(0.62, 0.02, 0.02), clamp(uLowHealth, 0.0, 1.0) * clamp(lp - 0.55, 0.0, 1.0) * 1.4);',
    '  gl_FragColor = vec4(c, 1.0);',
    '}'
  ].join('\n');

  var Shaders = {
    MAX_DYNAMIC_LIGHTS: MAX_DYNAMIC_LIGHTS,

    BASIC: { vs: BASIC_VS, fs: BASIC_FS },
    VIEWMODEL: { vs: BASIC_VS, fs: BASIC_FS },
    SPRITE: { vs: SPRITE_VS, fs: SPRITE_FS },
    POST: { vs: POST_VS, fs: POST_FS },

    /**
     * Devuelve {vs, fs} con los defines aplicados y las sustituciones hechas.
     * `defines` admite además la clave especial MAX_DYNAMIC_LIGHTS (número).
     */
    build: function (name, defines) {
      defines = defines || {};
      var n = defines.MAX_DYNAMIC_LIGHTS;
      if (typeof n !== 'number' || n < 0 || n > MAX_DYNAMIC_LIGHTS) n = MAX_DYNAMIC_LIGHTS;

      var base;
      if (name === 'post') base = Shaders.POST;
      else if (name === 'sprite') base = Shaders.SPRITE;
      else base = Shaders.BASIC; // 'basic' y 'viewmodel' comparten fuente

      var vs = base.vs;
      var fs = base.fs;

      fs = fs.split('{{MAX_DYNAMIC_LIGHTS}}').join(String(n));
      fs = fs.split('{{LIGHT_BLOCKS}}').join(lightBlocks(n));
      vs = vs.split('{{MAX_DYNAMIC_LIGHTS}}').join(String(n));

      var prefix = '';
      for (var k in defines) {
        if (!Object.prototype.hasOwnProperty.call(defines, k)) continue;
        if (k === 'MAX_DYNAMIC_LIGHTS') continue;
        var v = defines[k];
        vs = vs.split('__' + k + '__').join(String(v));
        fs = fs.split('__' + k + '__').join(String(v));
        if (v === true) prefix += '#define ' + k + ' 1\n';
        else if (v === false || v === null || v === undefined) continue;
        else prefix += '#define ' + k + ' ' + v + '\n';
      }

      return { vs: prefix + vs, fs: prefix + fs };
    },

    /** Los 4 conjuntos de defines que usa BS.Renderer (documentado). */
    defaultDefines: function (caps, quality) {
      caps = caps || {};
      var lightCount = MAX_DYNAMIC_LIGHTS;
      if (caps.maxFragmentUniformVectors && caps.maxFragmentUniformVectors < 32) lightCount = 0;
      else if (caps.maxFragmentUniformVectors && caps.maxFragmentUniformVectors < 64) lightCount = 1;
      if (quality === 'low') lightCount = Math.min(lightCount, 1);
      var canNormal = caps.derivativesAvailable !== false; // la aprox. no usa dFdx
      return {
        basic: {
          MAX_DYNAMIC_LIGHTS: lightCount,
          USE_NORMALMAP: canNormal,   // booleano: false => la macro NO se define
          USE_EMISSIVEMAP: true,
          LABEL: 'basic'
        },
        viewmodel: {
          MAX_DYNAMIC_LIGHTS: lightCount,
          USE_NORMALMAP: false,
          USE_EMISSIVEMAP: true,
          NO_FOG: true,
          VIEWMODEL: true,
          LABEL: 'viewmodel'
        },
        sprite: { LABEL: 'sprite' },
        post: { LABEL: 'post' }
      };
    },

    MAX_LIGHTS: MAX_DYNAMIC_LIGHTS
  };

  BS.Shaders = Shaders;

  /* ======================================================================
   * Test: las fuentes son coherentes y los nombres de uniform están presentes
   * ==================================================================== */
  if (BS.Debug && typeof BS.Debug.register === 'function') {
    BS.Debug.register('shaders:uniforms', function () {
      var required = ['uProj', 'uView', 'uModel', 'uCameraPos', 'uTime', 'uColorTint', 'uMap',
        'uNormalMap', 'uEmissiveMap', 'uUvScale', 'uSpecular', 'uNormalStrength', 'uEmissive',
        'uAmbientSky', 'uAmbientGround', 'uFogColor', 'uFogDensity', 'uLightCount',
        'uLightPos', 'uLightColor', 'uFlashPos', 'uFlashDir', 'uFlashColor', 'uFlashCosInner'];
      var b = Shaders.build('basic', { MAX_DYNAMIC_LIGHTS: 3, LABEL: 'test' });
      var missing = [];
      for (var i = 0; i < required.length; i++) {
        /* uProj/uView/uModel/uUvScale son uniforms EXCLUSIVOS del vertex shader
         * (BASIC_VS): hay que buscarlos también en b.vs (la rama de sprite ya
         * lo hacía). Comprobarlos solo en b.fs daba 4 falsos negativos. */
        if (b.fs.indexOf(required[i]) < 0 && b.vs.indexOf(required[i]) < 0) {
          missing.push(required[i]);
        }
      }
      var postRequired = ['uTex', 'uResolution', 'uVignette', 'uDamage', 'uLowHealth', 'uNoise'];
      var p = Shaders.build('post', { LABEL: 'test' });
      var postMissing = [];
      for (var j = 0; j < postRequired.length; j++) {
        if (p.fs.indexOf(postRequired[j]) < 0) postMissing.push(postRequired[j]);
      }
      var sprite = Shaders.build('sprite', { LABEL: 'test' });
      var spriteRequired = ['uProj', 'uView', 'uMap', 'uColorTint', 'uEmissive', 'uFogColor', 'uFogDensity', 'uCameraPos', 'uTime'];
      var spriteMissing = [];
      for (var k = 0; k < spriteRequired.length; k++) {
        if (sprite.fs.indexOf(spriteRequired[k]) < 0 && sprite.vs.indexOf(spriteRequired[k]) < 0) {
          spriteMissing.push(spriteRequired[k]);
        }
      }
      var noVersion = b.vs.indexOf('#version') < 0 && b.fs.indexOf('#version') < 0;
      var usesLegacy = b.fs.indexOf('gl_FragColor') >= 0 && b.vs.indexOf('attribute ') >= 0;
      var noPlaceholders = b.fs.indexOf('{{') < 0 && b.vs.indexOf('{{') < 0;
      // comprobación de que no hay bucles con índice no constante
      var hasLoop = /\bfor\s*\(/.test(b.fs);
      return {
        ok: missing.length === 0 && postMissing.length === 0 && spriteMissing.length === 0 &&
          noVersion && usesLegacy && noPlaceholders && !hasLoop,
        faltanBasico: missing,
        faltanPost: postMissing,
        faltanSprite: spriteMissing,
        sinVersion: noVersion,
        glslLegacy: usesLegacy,
        sinPlaceholders: noPlaceholders,
        sinBucles: !hasLoop,
        tamanoBasicoFs: b.fs.length
      };
    });
  }

})(window.BS = window.BS || {});
