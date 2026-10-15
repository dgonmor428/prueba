# Documento de Arquitectura - generado por el agente architect

Carpeta confirmada vacía. Aquí va el documento de arquitectura completo.

---

# BLACKSITE: LAST SIGNAL — Documento de Arquitectura (v1.0, congelado para implementación)

> Este documento es **el contrato**. Los agentes `developer` de los lotes A/B/C deben implementar exactamente estas firmas. Si algo falta, se **añade en el propio archivo** (o se amplía `BS.Debug`), nunca se renombra ni se cambia una firma ya definida aquí.

---

## 0. Resumen ejecutivo

- **Motor propio WebGL**, ~9.000 LOC repartidas en 22 archivos JS, sin dependencias, sin build, sin `fetch`, sin módulos ES.
- **Todo el DOM y el CSS se crean desde JavaScript** (`BS.Util.ensureDOM()` + `BS.Style.inject()`). Esto es una decisión deliberada: la página queda reducida a `<div id="bs-root">` + etiquetas `<script>`, de modo que el `tester` puede **inyectar el juego inline en `about:blank`** concatenando los JS sin copiar HTML ni CSS, y el resultado es idéntico al de `file://`.
- **Mediador `ctx.combat`** creado por `BS.Game`: armas, enemigos y proyectiles nunca se conocen entre sí; solo hablan con `ctx.combat`, `ctx.fx`, `ctx.audio`, `ctx.level`. Esta es la clave para que 3 developers trabajen en paralelo sin romperse.
- **Formato de vértice único** (pos, normal, uv, color+emissive) + **localizaciones de atributo fijas** → todos los programas comparten layout y el renderer no toca estado de atributos entre draws.
- **Sin shadow maps, sin depth textures, sin AudioWorklet, sin índices de 32 bits** → cero dependencias de extensiones opcionales.

---

## 1. Decisiones técnicas (con justificación)

| Tema | Decisión | Justificación |
|---|---|---|
| Versión WebGL | **Pedir `webgl2`, fallback a `webgl`**; el código solo usa features WebGL1 | WebGL2 es retrocompatible a nivel de shaders (acepta GLSL ES 1.00), así que un único camino de código sirve para ambos. GPU integradas antiguas solo dan WebGL1 y el juego sigue funcionando. |
| Perfil de shaders | **GLSL ES 1.00 sin `#version`** (`attribute`/`varying`/`gl_FragColor`) | Compila en contexto WebGL1 y WebGL2. GLSL ES 3.00 en WebGL1 es imposible y en WebGL2 obliga a `in/out` y `texture()`, duplicando variantes. Riesgo cero. |
| Variantes de shader | 4 programas: `basic`, `basic+VIEWMODEL`, `sprite`, `post`. Macros por concatenación de `#define` antes de compilar | Coste de compilación mínimo (~20 ms), zero branching dinámico en el hot path. |
| Iluminación | **Ambiente hemisférico + linterna spot del jugador + 3 luces puntuales dinámicas + luz "horneada" en el canal R,G,B del color de vértice** | Interiores oscuros de instalación: la linterna es la fuente principal y da el look. Las luces estáticas se hornean en vértices al construir el nivel (0 coste por frame) y eso permite poner **decenas** de fluorescentes/balizas sin coste. Solo 3 luces puntuales se recalculan (muzzle flash, explosiones, balizas cercanas elegidas por el `Renderer`). |
| Sombras | **Ninguna.** Oclusión falsa: AO horneado en el canal A*... ver abajo (AO en RGB, emissive en A) | Shadow maps = framebuffer con depth texture, 2ª pasada, y la mitad de las GPU integradas modestas sufren. El AO horneado + fog + linterna dan profundidad suficiente. |
| Emisivos | **`aColor.a` = máscara emisiva (0..1)** del vértice | Permite que un mismo mesh con un mismo material tenga tiras luminosas, ojos de drones y pantallas brillando, **sin draw calls ni materiales extra**. Elimina ~10 draw calls por nivel. |
| Fog | **Fog exponencial (exp2)** con `uFogColor`/`uFogDensity`, color = color de fondo | Oculta los límites del nivel, aporta atmósfera, y es la técnica más barata posible (2 instrucciones). |
| Colisiones — mundo | **AABB estáticos** en rejilla hash + **un tipo extra de colisionador `ramp`** (analítico) | Nivel construido a base de cajas → AABB es exacto y barato. Solo se permiten `rotY` en props decorativos; para rampas se usa colisión analítica (evita escalones y permite caminar suave). |
| Colisiones — movimiento | **Sweep por ejes: mover X → resolver, mover Z → resolver, mover Y → resolver**, con `stepHeight` 0.45 m | "Move and slide" es robusto, sin tunelado a velocidades de juego (7 m/s y dt ≤ 1/60 → 11 cm/paso), y el step-up permite subir escaleras de peldaños de 0.3 m sin geometría especial. |
| Colisiones — jugador/enemigo | **Caja vertical (AABB dinámico)** de radio 0.35 y altura 1.8/1.05 (crouch), no cilindro | Reutiliza exactamente el mismo solver que el mundo. Un cilindro exigiría analítica distinta y no aporta nada perceptible con bloques de 90°. |
| Entidades dinámicas | AABB por entidad, chequeo directo N² con N ≤ 26 enemigos (676 pares, trivial) + separación simple | Un broadphase para 26 entidades es sobreingeniería. El hash espacial se reserva para los ~600-900 AABB estáticos. |
| Audio | **Web Audio API, 100% procedural**; buses master/SFX/música; atenuación por distancia **manual** + `StereoPannerNode` (NO `PannerNode` HRTF) | HRTF consume CPU notable en iGPU y su comportamiento varía por navegador; la atenuación manual es determinista, testeable y 10× más barata. Fuentes: `OscillatorNode` + `AudioBufferSourceNode` sobre un **único buffer de ruido blanco de 2 s** generado al arrancar (reutilizado con `playbackRate`, filtros y envolventes). Nada de `AudioWorklet` (requiere `addModule(url)` → falla en `file://`), nada de `ScriptProcessor`. |
| Índices | **`Uint16` siempre**, con el nivel troceado en celdas de 12×12 m y máx. 64k vértices por chunk | Evita depender de `OES_element_index_uint`. El troceado además da culling por frustum gratis. |
| Post-proceso | **1 pasada de composición opcional** (vignette, tinte de daño, scanlines, grano) sobre FBO color RGBA8 + renderbuffer de profundidad | No requiere `WEBGL_depth_texture` (que solo es obligatorio si quieres *leer* profundidad). Es conmutable y **se desactiva por defecto si se detecta rasterizador software**. |
| Escalado | `dpr = min(devicePixelRatio, 1.5) × resolutionScale` (`0.5 … 1.0`), ajustable en opciones y por calidad | Control directo del coste de fill-rate, que es el cuello de botella real en iGPU. |
| Escala de calidad | Auto-detección + ajuste manual (`low/medium/high`), ajusta: escala de resolución, luces dinámicas, postFX, anisotropía, partículas máx., tamaño de textura | Permite que funcione aceptablemente incluso bajo SwiftShader (caso probable del navegador de pruebas). |
| Estado del juego | Máquina de estados explícita en `BS.Game` con `switch` y delta **fijo** para física | Ver §5. |

### 1.1 Detección de hardware (concreta)

```
renderer = gl.getParameter(EXT_WEBGL_debug_renderer_info.UNMASKED_RENDERER_WEBGL)  // si existe
isSoftware = /swiftshader|llvmpipe|software|angle \(google, vulkan 1\.\d+\.\d+ \(swiftshader/i.test(renderer)
isWeak     = isSoftware || /intel.*(hd|uhd) graphics (2|3|4|5|6)\d{2}/i.test(renderer)
```
- `isSoftware` → calidad `low` forzada: `resolutionScale=0.6`, `postFx=false`, `MAX_DYNAMIC_LIGHTS=1`, `maxParticles=250`, texturas 128 px, anisotropía off.
- `isWeak` → calidad `medium`.
- Resto → `high`.

---

## 2. Estructura de carpetas, archivos y orden de carga

```
C:\Users\AlumnoT\Downloads\prueba\
│
├─ index.html                      # solo <div id="bs-root"> + script tags + <noscript>
│
├─ sandbox/
│   ├─ sandbox_a.html              # arnés de verificación del LOTE A (cubo texturizado, luces, input, audio)
│   ├─ sandbox_b.html              # arnés del LOTE B (recorrer el nivel, disparar, colisiones)
│   └─ sandbox_c.html              # arnés del LOTE C (juego completo con enemigos y HUD)
│
└─ js/
    ├─ core/
    │   ├─ util.js                 # BS.Math, BS.Util, BS.Events, BS.RNG, BS.Log
    │   ├─ debug.js                # BS.Debug
    │   ├─ gl.js                   # BS.GL
    │   ├─ input.js                # BS.Input
    │   ├─ audio.js                # BS.Audio
    │   └─ textures.js             # BS.Textures
    ├─ render/
    │   ├─ shaders.js              # BS.Shaders (solo strings GLSL)
    │   ├─ mesh.js                 # BS.Mesh (constructor de geometría + formato de vértice)
    │   ├─ renderer.js             # BS.Renderer
    │   └─ fx.js                   # BS.FX (partículas, trazadoras, flashes, luces temporales)
    ├─ world/
    │   ├─ leveldata.js            # BS.LevelData (misión declarativa: brushes, spawns, oleadas)
    │   ├─ level.js                # BS.Level (construcción, chunks, colliders, horneado de luz)
    │   └─ physics.js              # BS.Physics (sweep AABB, rampas, raycast, rayAABB)
    ├─ entities/
    │   ├─ projectiles.js          # BS.Projectiles
    │   ├─ weapons.js              # BS.Weapons
    │   ├─ player.js               # BS.Player
    │   ├─ pickups.js              # BS.Pickups
    │   └─ enemies.js              # BS.Enemies
    ├─ ui/
    │   ├─ style.js                # BS.Style (texto CSS inyectado)
    │   ├─ hud.js                  # BS.HUD (Canvas2D)
    │   └─ menu.js                 # BS.Menu (DOM)
    ├─ game/
    │   └─ game.js                 # BS.Game (máquina de estados, ctx, oleadas, mediador de combate)
    └─ main.js                     # BS.Main (bootstrap)
```

### 2.1 Orden exacto de carga en `index.html` (y en los sandbox y en la inyección inline)

```
 1  js/core/util.js
 2  js/core/debug.js
 3  js/core/gl.js
 4  js/core/input.js
 5  js/core/audio.js
 6  js/core/textures.js
 7  js/render/shaders.js
 8  js/render/mesh.js
 9  js/render/renderer.js
10  js/render/fx.js
11  js/world/leveldata.js
12  js/world/level.js
13  js/world/physics.js
14  js/entities/projectiles.js
15  js/entities/weapons.js
16  js/entities/player.js
17  js/entities/pickups.js
18  js/entities/enemies.js
19  js/ui/style.js
20  js/ui/hud.js
21  js/ui/menu.js
22  js/game/game.js
23  js/main.js            ← último SIEMPRE: llama a BS.Main.boot()
```

`index.html` completo (contrato, no cambiar la forma):

```html
<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,user-scalable=no">
<title>BLACKSITE: LAST SIGNAL</title>
<style>html,body{margin:0;padding:0;height:100%;background:#05070a;overflow:hidden}
#bs-root{position:fixed;inset:0}</style>
</head>
<body>
<div id="bs-root"></div>
<noscript>Necesitas JavaScript activado.</noscript>
<script src="js/core/util.js"></script>
<!-- ... los 22 en el orden de arriba ... -->
<script src="js/main.js"></script>
</body>
</html>
```

---

## 3. Contrato de interfaces módulo a módulo (CONGELADO)

### 3.0 Reglas de estilo obligatorias para TODOS los módulos

```js
/* cada archivo, exactamente esta forma envolvente */
(function (BS) {
  'use strict';
  // ... código ...
  BS.NombreModulo = { /* API pública */ };
})(window.BS = window.BS || {});
```

1. **Namespace raíz único: `window.BS`.** Prohibido cualquier otro global (salvo `BS.Main.boot` que se autoinvoca).
2. **Nada de `let`/`const`/`class` a nivel de archivo fuera del IIFE** (evita colisiones al concatenar archivos inline).
3. **Fábricas, no clases.** Toda entidad se crea con `create()` o `build()` que devuelve un objeto con métodos. Evita `new`, `this` desligado y errores de binding.
4. **Sin `import`, `export`, `type="module"`, `fetch`, `XMLHttpRequest`, `importScripts`.** Únicas excepciones: ninguna.
5. **Sin `console.log` en el hot path.** Usar `BS.Log.debug(...)` que respeta `BS.Log.level`.
6. **Todo `.js` debe ser: `Object` literal de strings + funciones puras + `BS.X`.** Sin efectos colaterales en carga salvo registrar extensiones en `BS.Debug`.
7. Extensiones permitidas a otros lotes: **solo** `BS.Debug.register(id, fn)` y `BS.Events.on(...)`.
8. `BS.Util.ensureDOM()` crea `#bs-root` si no existe y devuelve `{root, canvas3d, hudCanvas, uiLayer}`.

---

### 3.1 `js/core/util.js` → `BS.Math`, `BS.Util`, `BS.Events`, `BS.RNG`, `BS.Log`

```js
BS.Log = {
  level: 2,                 // 0=silent 1=error 2=warn 3=info 4=debug
  setLevel(n), error(...a), warn(...a), info(...a), debug(...a)
}

BS.Util = {
  now(): number,                       // performance.now()/1000, con fallback a Date.now
  ensureDOM(): { root, canvas3d, hudCanvas, uiLayer },   // crea e inserta los 3 si faltan
  makeCanvas(w, h): HTMLCanvasElement,
  addListener(target, type, fn, opts): void,
  clampInt(v, min, max): number,
  padNumber(n, digits): string,
  formatTime(seconds): string,          // "02:13"
  tryLocalStorageGet(key, fallback): any,
  tryLocalStorageSet(key, value): boolean,   // envuelto en try/catch (file:// y contextos opacos)
  loadSettings(): BS.Settings,          // con defaults; nunca lanza
  saveSettings(s): void,
  debounce(fn, ms): function
}

BS.Events = {
  on(name, cb, tag?): number,          // devuelve id de suscripción
  off(name, id): void,
  emit(name, payload): void,
  clear(): void
}
```

**Eventos estándar (canal global, nombres congelados):**
`'noise'` `{pos:[x,y,z], radius:number, tag:'gunshot'|'footstep'|'impact'|'explosion'|'enemy'}` ·
`'enemy:spawned'` `{enemy}` · `'enemy:killed'` `{enemy, byPlayer:bool}` · `'player:damaged'` `{amount, hp, dirAngle}` ·
`'player:healed'` `{amount}` · `'player:died'` · `'weapon:fired'` `{slot, name, ammoInMag}` · `'weapon:reloaded'` `{slot}` ·
`'pickup:collected'` `{kind, amount}` · `'wave:started'` `{index, count}` · `'wave:cleared'` `{index}` ·
`'objective:updated'` `{text, done, total}` · `'game:victory'` `{}` · `'game:state'` `{state}`.

```js
BS.RNG = {
  create(seed): function(): number,    // xorshift32 -> [0,1)
  hash1(n): number, hash2(x, y): number
}

BS.Math = {
  PI, DEG, RAD,
  clamp(v, min, max): number,
  clamp01(v): number,
  lerp(a, b, t): number,
  damp(current, target, lambda, dt): number,
  smoothstep(e0, e1, x): number,
  sign(v): number,
  randRange(a, b): number,          // Math.random
  randInt(a, b): number,            // inclusivo
  gaussian(): number,               // Box-Muller, media 0, sigma 1

  // vectores: Float32Array(3) de 3 componentes
  v3(x=0,y=0,z=0): Float32Array,
  v3set(out,x,y,z): out, v3copy(out,a): out,
  v3add(out,a,b): out, v3sub(out,a,b): out, v3mul(out,a,b): out,
  v3scale(out,a,s): out, v3addScaled(out,a,b,s): out,
  v3dot(a,b): number, v3cross(out,a,b): out,
  v3len(a): number, v3lenSq(a): number, v3dist(a,b): number,
  v3norm(out,a): out, v3negate(out,a): out,
  v3lerp(out,a,b,t): out, v3min(out,a,b): out, v3max(out,a,b): out,
  v3fromYawPitch(out, yaw, pitch): out,      // (0,0,-1) rotado
  v3yawToDir(out, yaw): out,

  // matrices 4x4 column-major, Float32Array(16)
  m4(): Float32Array, m4identity(out): out, m4copy(out,a): out,
  m4multiply(out,a,b): out,
  m4perspective(out, fovyRad, aspect, near, far): out,
  m4ortho(out, l,r,b,t,n,f): out,
  m4lookAt(out, eye, center, up): out,
  m4fromYawPitchPos(out, yaw, pitch, pos): out,   // cámara
  m4invert(out,a): out, m4transpose(out,a): out,
  m4fromPosYawScale(out, pos, yaw, scale): out,   // modelo (escala uniforme)
  m4fromTRS(out, pos, yaw, pitch, roll, scale): out,
  m4transformPoint(out, m, v): out,
  m4transformDir(out, m, v): out,
  m4normalBasis(out3x3, m): Float32Array,          // mat3 para normales (escala uniforme → extrae)

  // AABB  {min:Float32Array(3), max:Float32Array(3)}
  aabb(min, max): AABB,
  aabbFromCenterSize(c, s): AABB,
  aabbFromPoints(points): AABB,
  aabbUnion(out, a, b): out,
  aabbExpand(out, a, amount): out,
  aabbContainsPoint(a, p): bool,
  aabbIntersects(a, b): bool,
  aabbIntersectsAABB(a, b, eps?): bool,
  aabbCenter(out, a): out,
  aabbCopy(out, a): out,
  aabbTransform(out, a, m): out,

  // intersecciones
  rayAABB(origin, dir, min, max, maxT): number,   // t>=0 o -1 si no hay impacto
  raySegmentAABB(p0, p1, min, max): number,       // t en [0,1] o -1
  aabbSweepAABB(aMin, aMax, delta, bMin, bMax): number, // t en [0,1] o -1 (para proyectiles)
  pointInCone(point, apex, dir, cosHalfAngle, range): bool
}
```

---

### 3.2 `js/core/debug.js` → `BS.Debug`

Pensado **para el agente `tester`**: permite operar el juego sin eventos reales de DOM ni Pointer Lock.

```js
BS.Debug = {
  enabled: true,
  errors: [],                       // [{msg, src, line, col, time}]
  captureErrors(): void,            // window.onerror + unhandledrejection + errores WebGL

  register(id: string, fn: function(): any): void,
  run(id: string): any,             // ejecuta el test registrado
  runAll(): {id, ok, result, error}[],   // selfTest agregado

  // --- control remoto (usado por el tester) ---
  state(): { state, hp, ammo, reserve, enemiesAlive, wave, fps, drawCalls, tris, pos:[x,y,z], yaw, pitch },
  stats(): { fps, frameMs, drawCalls, tris, particles, projectiles, enemies, quality, resolutionScale, renderer },
  teleport(x, y, z): void,
  look(dx, dy): void,               // inyecta delta de ratón sin Pointer Lock
  lookAt(x, y, z): void,
  key(code: string, down: boolean): void,   // inyecta tecla directamente en BS.Input
  press(code: string): void,        // down+up en el mismo frame lógico
  setGodMode(on: boolean): void,
  setState(s: string): void,
  startGame(): void,
  giveWeapon(slot: number): void,
  giveAmmo(slot: number, amount: number): void,
  spawnEnemy(type: 'drone'|'stalker'|'brute', distance: number, angleDeg?: number): object,
  killAllEnemies(): void,
  clearEnemies(): void,
  startWave(index: number): void,
  setQuality(q: 'low'|'medium'|'high'): void,
  setFpsCap(n: number): void,       // 0 = sin límite; útil para probar estabilidad de dt
  stepFrames(n: number): void,      // avanza N frames con dt fijo 1/60 sin rAF (determinismo)
  snapshotHud(): string,            // texto del HUD actual
  hideUI(on: boolean): void,
  showOverlay(text): void
}
```
Regla: `BS.Debug.state()` y `runAll()` **nunca lanzan**; capturan y devuelven `{ok:false, error}`.

---

### 3.3 `js/core/gl.js` → `BS.GL`

```js
BS.GL = {
  gl: null,
  Program: { program, uniforms: {}, attributes: {} },   // shape de lo que devuelve createProgram

  ATTR: { POS: 0, NORMAL: 1, UV: 2, COLOR: 3 },          // localizaciones FIJAS (bindAttribLocation)
  PRIORITY: { POSITION: 34962, INDEX: 34963 },
  MASK: { WORLD: 1, ENEMY: 2, PLAYER: 4, PICKUP: 8, PROJECTILE: 16, PROP: 32 },

  init(canvas: HTMLCanvasElement, opts?: {
    antialias?: boolean,  // false por defecto
    alpha?: boolean,      // false
    powerPreference?: 'high-performance'|'default',
    preserveDrawingBuffer?: boolean  // TRUE por defecto (necesario para browser.screenshot fiables)
  }): { ok: boolean, reason?: string },

  // capacidades detectadas
  caps: {
    isWebGL2: bool, maxTextureSize: number, maxFragmentUniformVectors: number,
    maxVertexUniformVectors: number, maxVertexAttribs: number,
    anisoAvailable: bool, maxAniso: number, derivativesAvailable: bool,
    vendor: string, renderer: string, isSoftware: bool, isWeak: bool,
    maxPointSize: number, uintIndex: bool
  },

  // programas
  createProgram(vsSource: string, fsSource: string, defines?: {[k: string]: string|number}): BS.GL.Program,
  useProgram(prog: BS.GL.Program): void,
  currentProgram(): BS.GL.Program,
  disposeProgram(prog): void,

  // uniforms (no-op silencioso si el uniform no existe / no está activo)
  u1f(prog, name, x), u2f(prog, name, x, y), u3f(prog, name, x, y, z), u4f(prog, name, x, y, z, w),
  u1i(prog, name, x), u1fv(prog, name, arr), u2fv(prog, name, arr),
  u3fv(prog, name, arr), u4fv(prog, name, arr), uMat3(prog, name, arr9), uMat4(prog, name, arr16),
  uTex(prog, name, unit: number, texture: WebGLTexture): void,

  // buffers / meshes  (mesh = { vbo, ibo, indexCount, indexType, stride, aabb, attribs:true })
  createMesh(vertexData: Float32Array|Uint8Array, indexData: Uint16Array, aabb: AABB): Mesh,
  createDynamicMesh(maxVertices: number, maxIndices: number, aabb: AABB): { mesh: Mesh, uploadVertex(data, count), uploadIndex(data, count) },
  uploadVertexBuffer(mesh, data, byteLength): void,
  disposeMesh(mesh): void,
  bindMesh(mesh): void,             // programa de atributos fijo (pos/normal/uv/color), sin VAO
  drawMesh(mesh): void,             // drawElements con indexType y indexCount

  // texturas
  createTextureFromCanvas(srcCanvas: HTMLCanvasElement, opts?: {
    mipmaps?: true, wrap?: 'repeat'|'clamp', aniso?: number, srgbLike?: true, flipY?: false
  }): WebGLTexture,
  createTexture2D(w: number, h: number, pixels: Uint8Array|null, opts?): WebGLTexture,
  disposeTexture(tex): void,

  // framebuffers (color RGBA8 + renderbuffer DEPTH_COMPONENT16; NUNCA depth texture)
  createFramebuffer(w: number, h: number, withDepth: boolean): { fbo, colorTex, depthRb, w, h },
  resizeFramebuffer(fb, w, h): void,
  disposeFramebuffer(fb): void,
  bindFramebuffer(fb|null): void,
  blitToScreen(srcTex, dstW, dstH): void,     // quad fullscreen sin shader (solo para depurar)

  // estado (caché interno: evita llamadas redundantes)
  setState(s: {
    depthTest?: bool, depthWrite?: bool, depthFunc?: number,
    cull?: 'back'|'front'|'none', blend?: 'none'|'alpha'|'add'|'multiply',
    clearColor?: [r,g,b,a], viewport?: [x,y,w,h], scissor?: [x,y,w,h]|null
  }): void,
  clear(color: [r,g,b,a]|null, depth: bool): void,

  // contexto perdido
  onContextLost(cb: function(event, info): void): void,
  onContextRestored(cb: function(): void): void,
  isLost(): boolean
}
```

**Contrato de formato de vértice (único para TODO el juego), stride 36 bytes:**

| offset | atributo | tipo GL | localización |
|---|---|---|---|
| 0 | `aPos` | `FLOAT` ×3 | **0** |
| 12 | `aNormal` | `FLOAT` ×3 | **1** |
| 24 | `aUV` | `FLOAT` ×2 | **2** |
| 32 | `aColor` | `UNSIGNED_BYTE` ×4, **normalizado** | **3** |

- `aColor.rgb` = iluminación horneada / AO / tinte de parte.
- `aColor.a` = **máscara emisiva** (0..255 → 0..1).

`BS.Mesh` (en `js/render/mesh.js`) es el **único** productor de datos de vértice:

```js
BS.Mesh = {
  STRIDE: 36,
  create(): Builder,
  toGL(builder, gl?): Mesh,          // sube a GPU y devuelve {vbo, ibo, indexCount, indexType, aabb}
  buildData(builder): { vertices: Float32Array|Uint8Array, indices: Uint16Array, aabb, vertexCount }
}

// Builder
Builder = {
  color: [1,1,1,1],                  // tinte activo (aplica a los vértices que se añadan)
  emissive: 0,                       // 0..1 -> se escribe en aColor.a
  vertexCount: number,
  // primitivas (todas en espacio local, centro en pos)
  box(pos:[x,y,z], size:[w,h,d], uvScale?, rotY?): Builder,
  boxFaces(pos, size, opts:{ uvScale, faces:[bool×6], flipNormals }): Builder,
  wedge(pos, size, axis:'+x'|'-x'|'+z'|'-z', rotY?): Builder,        // rampa triangular
  cylinder(pos, radius, height, segments, axis:'y', capped): Builder,
  sphere(pos, radius, segments, rings): Builder,
  quad(p0, p1, p2, p3, normal, uvScale): Builder,
  stairFlight(pos, size, steps, axis): Builder,                      // escalera como cajas
  tube(pos, size, wallThickness, rotY?): Builder,                    // marco hueco (4 barras)
  extrude2D(profile: [x,y][], thickness, plane:'xy'|'xz'|'zy', pos): Builder,
  addRaw(positions, normals, uvs, colors, indices): Builder,
  translate(dx,dy,dz): Builder, rotY(rad): Builder, scale(s): Builder,
  tag(name): Builder,                 // marca el grupo actual (para asignar material por partes)
  group(name): Builder,               // devuelve sub-builder para un material distinto
  bounds(): AABB
}
```

---

### 3.4 `js/core/input.js` → `BS.Input`

```js
BS.Input = {
  keys: {}, keysPressed: {}, keysReleased: {},
  buttons: {}, buttonsPressed: {},
  mouseDX: 0, mouseDY: 0, wheel: 0,
  locked: false, lastLockError: null,
  sensitivity: 0.0022, invertY: false, rawInput: false,

  init(canvas: HTMLCanvasElement): void,
  isDown(code: string): bool,        // 'KeyW', 'ShiftLeft', 'Space', 'ControlLeft', 'Digit1'
  wasPressed(code: string): bool,    // flanco de subida, se limpia en endFrame()
  wasReleased(code: string): bool,
  mouseDown(btn: number): bool,
  mousePressed(btn: number): bool,
  consumeMouseDelta(): {dx: number, dy: number},   // en píxeles; resetea
  consumeWheel(): number,

  requestPointerLock(): void,        // idempotente; maneja la promesa de Chrome y el error
  exitPointerLock(): void,
  isLocked(): bool,
  onLockChange(cb: function(locked: bool): void): number,
  onLockError(cb: function(err): void): number,

  setSensitivity(v: number): void, getSensitivity(): number, setInvertY(on: bool): void,
  simulateKey(code: string, down: boolean): void,   // para BS.Debug / tester
  simulateMouseDelta(dx: number, dy: number): void,
  clearAll(): void,                  // llamado en blur/pointerlockchange/visibilitychange
  beginFrame(): void,                // no-op reservado
  endFrame(): void                   // limpia wasPressed, wasReleased, mouseDX/DY, wheel
}
```
Teclas usadas (congeladas): `KeyW KeyA KeyS KeyD`, `ShiftLeft`, `ControlLeft` (agacharse; `KeyC` alt), `Space` (salto), `KeyR` (recarga), `KeyE` (interactuar), `Digit1 Digit2 Digit3` / rueda (cambio de arma), `KeyQ` (arma anterior), `Escape`/`KeyP` (pausa — ver §6), `KeyH` (ocultar ayuda), `F1` (overlay de debug), `KeyM` (silenciar).

`preventDefault()` obligatorio en: `Space`, `Tab`, `ArrowUp/Down`, `Slash`, `Quote` (evita scroll/quick-find de Firefox).

---

### 3.5 `js/core/audio.js` → `BS.Audio`

```js
BS.Audio = {
  ctx: AudioContext|null,
  ready: false,
  init(): boolean,                    // crea AudioContext (puede quedar 'suspended')
  resume(): Promise<boolean>,         // DEBE llamarse desde un gesto del usuario
  isRunning(): boolean,
  suspend(): void,
  update(dt: number): void,           // recolecta voces terminadas

  setMasterVolume(v01: number): void, setSfxVolume(v01: number): void, setMusicVolume(v01: number): void,
  getMasterVolume(): number, getSfxVolume(): number, getMusicVolume(): number,
  mute(on: boolean): void,

  setListener(pos: Float32Array, forward: Float32Array, up: Float32Array): void,

  // catálogo procedural
  NAMES: ['pistol','smg','plasma','plasma_impact','shell_drop','empty_click','reload_out','reload_in',
          'hit_world','hit_flesh','hitmarker','kill_confirm','explosion','footstep','land','jump',
          'crouch','pickup_ammo','pickup_health','pickup_weapon','ui_click','ui_hover','ui_denied',
          'door_open','alarm_beep','terminal_on','enemy_alert','enemy_growl','enemy_attack',
          'enemy_death','drone_hover','brute_step','ambient_hum','ambient_wind','alarm_loop',
          'music_menu','music_combat','heartbeat','shield_break'],

  play(name: string, opts?: { pos?: number[], volume?: number, rate?: number,
                              volumeJitter?: number, rateJitter?: number }): Voice|null,
  loop(name: string, opts?: { pos?: number[], volume?: number }): Voice|null,
  stopAll(fadeTime?: number): void,
  stopTag(tag: string): void,
  setVoiceBudget(n: number): void,    // por defecto 24 (12 en calidad low)
  preload(): void                     // genera el buffer de ruido y las tablas de onda
}

Voice = {
  stop(fade?: number): void,
  setPosition(pos: Float32Array): void,
  setVolume(v: number): void,
  setRate(r: number): void,
  isPlaying(): boolean,
  tag: string
}
```
Reglas: nunca se crean `AudioBufferSourceNode` por frame sin límite → `setVoiceBudget`; si se supera, se descarta la voz más lejana o de menor prioridad.

---

### 3.6 `js/core/textures.js` → `BS.Textures`

```js
BS.Textures = {
  canvases: {},        // name -> HTMLCanvasElement (SE CONSERVA para reconstruir tras contextlost)
  lib: {},             // name -> WebGLTexture
  materials: {},       // id -> Material

  init(gl?): void,                 // genera TODO de forma determinista (RNG con semilla fija 0xB1AC)
  rebuild(): void,                 // tras webglcontextrestored: re-sube desde canvases
  get(name: string): WebGLTexture,
  getMaterial(id: string): Material,
  setTextureSize(px: 128|256|512): void,   // calidad

  generateAll(): void,
  // generadores de bajo nivel, expuestos por si algún módulo necesita arte propio:
  valueNoiseCanvas(size, freq, octaves, seed): HTMLCanvasElement,
  fbmCanvas(size, baseFreq, octaves, gain, seed): HTMLCanvasElement,
  normalFromHeight(heightCanvas, strength): HTMLCanvasElement,
  grungeOverlay(canvas, amount, seed): void,
  emissiveMaskCanvas(size, pattern: 'strip'|'dots'|'screen'|'panel', seed): HTMLCanvasElement
}

Material = {
  id: string,
  map: WebGLTexture,
  normalMap: WebGLTexture|null,
  emissiveMap: WebGLTexture|null,
  uvScale: [u, v],
  specular: number,            // 0..1
  normalStrength: number,      // 0..1
  emissive: [r, g, b],         // multiplicado por aColor.a y por emissiveMap
  emissiveIntensity: number,
  blend: 'opaque'|'alpha'|'add'|'multiply',
  depthWrite: bool,
  doubleSided: bool,
  program: 'basic'|'sprite',
  roughnessTint: [r,g,b]       // tinte del env-map falso (hemisférico)
}
```

**Catálogo de materiales/texturas (IDs congelados — los usan `leveldata.js`, armas y enemigos):**

`mat_concrete_wall`, `mat_concrete_floor`, `mat_metal_panel`, `mat_metal_floor`, `mat_ceiling_tile`, `mat_grate`, `mat_crate`, `mat_door`, `mat_pipe`, `mat_rust`, `mat_glass`, `mat_terminal`, `mat_strip_cyan` (emisivo), `mat_strip_red` (emisivo), `mat_beacon` (emisivo), `mat_enemy_armor`, `mat_enemy_shell`, `mat_drone_chassis`, `mat_eye_glow` (emisivo), `mat_gun_metal`, `mat_gun_polymer`, `mat_gun_glow` (emisivo), `mat_bolt_plasma` (emisivo), `mat_pickup_shell`, `mat_particle` (sprite), `mat_tracer` (sprite).

Texturas base: `tex_concrete, tex_concrete_f, tex_metal, tex_metal_f, tex_tiles, tex_grate, tex_crate, tex_door, tex_pipe, tex_rust, tex_glass, tex_terminal, tex_strip, tex_armor, tex_shell, tex_guns, tex_gen` (+ `_n` normalMap y `_e` máscara emisiva donde aplique).

---

### 3.7 `js/render/shaders.js` → `BS.Shaders`

```js
BS.Shaders = {
  MAX_DYNAMIC_LIGHTS: 3,             // 3 en high/medium, 1 en low
  BASIC: { vs: string, fs: string },
  VIEWMODEL: { vs: string, fs: string },
  SPRITE: { vs: string, fs: string },
  POST: { vs: string, fs: string },
  build(name: 'basic'|'viewmodel'|'sprite'|'post', defines?: {[k: string]: string|number}): { vs, fs }
}
```
`build()` hace sustituciones de texto (`{{MAX_DYNAMIC_LIGHTS}}`, `__define__`).

**Uniformes compartidos (nombres EXACTOS, todos los programas `basic`):**
```
uProj        mat4
uView        mat4
uModel       mat4
uCameraPos   vec3
uTime        float
uColorTint   vec4          // multiplica el albedo y aColor.rgb; alpha extra
uMap         sampler2D
uNormalMap   sampler2D
uEmissiveMap sampler2D
uUvScale     vec2
uSpecular    float
uNormalStrength float
uEmissive    vec4          // rgb * uEmissive.w * aColor.a
uAmbientSky  vec3
uAmbientGround vec3
uFogColor    vec3
uFogDensity  float
uLightCount  int
uLightPos[0..2]   vec4     // xyz pos, w radio
uLightColor[0..2] vec4     // rgb color, w intensidad
uFlashPos    vec4          // xyz pos, w alcance
uFlashDir    vec4          // xyz dir, w cosOuter
uFlashColor  vec4          // rgb color, w intensidad
uFlashCosInner float
```
**Prohibido**: bucles con índice no constante. Las 3 luces se **desenrollan** con `if (uLightCount > k) { ... }` e índices `k` literales (0,1,2). Esto compila en cualquier driver GLSL ES 1.00.

`SPRITE` usa: `uProj, uView, uMap, uColorTint, uEmissive, uFogColor, uFogDensity, uCameraPos, uTime`.
`POST` usa: `uTex, uResolution, uVignette, uDamage, uLowHealth, uTime, uNoise`.

---

### 3.8 `js/render/renderer.js` → `BS.Renderer`

```js
BS.Renderer = {
  programs: { basic: Program, viewmodel: Program, sprite: Program, post: Program },
  stats: { drawCalls, tris, frameMs, gpuMs?, particles, submitted, uploadedBytes },

  init(glCtx?, opts?: { postFx?: bool, maxLights?: number }): boolean,
  rebuild(): void,                    // tras contextlost: recompila programas y FBO
  dispose(): void,

  resizeToDisplay(): void,            // usa CSS size + dpr efectivo
  setResolutionScale(s: number): void,   // 0.5..1.0, clampeado
  getResolutionScale(): number,
  setPostFx(on: boolean): void,
  setFov(deg: number): void, getFov(): number,
  setNearFar(near, far): void,
  setAmbient(sky: number[], ground: number[]): void,
  setFog(color: number[], density: number): void,
  setFlashlight(state: { on: bool, pos: Float32Array, dir: Float32Array,
                          color: number[], intensity: number, range: number,
                          cosInner: number, cosOuter: number } | null): void,
  setDynamicLights(list: Array<{ pos: number[], color: number[], radius: number, intensity: number }>): void,
  setMaxDynamicLights(n: number): void,

  // cámara
  camera: { pos: Float32Array, yaw: number, pitch: number, fovY: number, aspect: number, near: number, far: number },
  setCamera(pos: Float32Array, yaw: number, pitch: number, roll?: number): void,
  getViewMatrix(out?: Float32Array): Float32Array,
  getProjectionMatrix(out?: Float32Array): Float32Array,
  getCameraRay(ndcX: number, ndcY: number, outOrigin: Float32Array, outDir: Float32Array): Float32Array,

  // frustum
  updateFrustum(): void,
  isVisible(aabb: AABB): boolean,

  // cola de dibujo
  beginFrame(clearColor: number[]|null): void,
  push(mesh: Mesh, model: Float32Array, material: Material, opts?: DrawOpts): void,
  pushViewmodel(mesh: Mesh, model: Float32Array, material: Material, opts?: DrawOpts): void,
  flush(): void,                      // opacas ordenadas por material.id, luego transparentes back-to-front
  present(): void,                    // post-proceso + fin de frame
  clearDepth(): void,

  // helpers de alto nivel
  drawShadowBlob(pos: Float32Array, radius: number, alpha: number): void,   // quad oscuro en el suelo
  freeCamera: { enabled: false, pos: Float32Array, yaw: number, pitch: number }, // modo espectador (debug)
  setFreeCamera(on: boolean): void
}

DrawOpts = {
  collection?: 'opaque'|'transparent',   // default 'opaque' (o según material.blend)
  tint?: [r,g,b,a],                      // default [1,1,1,1]
  alpha?: number,
  flash?: number,                        // 0..1: tinte blanco/rojo de impacto
  emissiveBoost?: number,
  noFog?: bool,
  sortBias?: number
}
```
**Pase de viewmodel**: `pushViewmodel` acumula en una lista aparte; `flush()` dibuja opacas → transparentes → `gl.clear(DEPTH)` → viewmodel (proyección FOV 55, `uModel` ya en espacio de mundo relativo a la cámara, `near = 0.01`).

---

### 3.9 `js/render/fx.js` → `BS.FX`

```js
BS.FX = {
  init(ctx): void,
  update(dt: number): void,
  beginFrame(): void,
  render(renderer): void,
  reset(): void,
  setParticleBudget(n: number): void,

  impact(pos: Float32Array, normal: Float32Array, kind: 'concrete'|'metal'|'flesh'|'energy'|'glass'|'water'): void,
  spark(pos, normal, count?, opts?: {speed?, spread?, life?, color?, gravity?}): void,
  smoke(pos, count?, opts?: {scale?, life?, color?}): void,
  explosion(pos, radius, color?): void,
  muzzleFlash(pos, dir, scale?): void,
  tracer(from, to, color?, width?, life?): void,
  trail(pos, color?, life?): void,
  blood(pos, dir, count?): void,          // "fluido" negro/cian de la instalación
  shockwave(pos, radius, color?): void,
  tempLight(pos, color, radius, intensity, duration): void,   // alimenta setDynamicLights automáticamente
  screenShake(amount, duration): void,    // expuesto para que el Player lo consuma
  getShake(): {offsetX: number, offsetY: number, roll: number}
}
```
`BS.FX.tempLight` mantiene internamente las luces temporales y `BS.Game` las combina con su propia lista antes de `renderer.setDynamicLights()`.

---

### 3.10 `js/world/leveldata.js` → `BS.LevelData`

```js
BS.LevelData = {
  mission: Mission,          // ver §4 completa
  build(): Mission           // devuelve una copia profunda; nunca muta el original
}
```
Solo datos, cero GL. Debe ser legible y editable sin tocar el motor.

---

### 3.11 `js/world/level.js` → `BS.Level`

```js
BS.Level = {
  build(data: Mission, ctx): Level,
  LEVELS: { 'k7': Mission }     // si se añaden más misiones en el futuro
}

Level = {
  data: Mission,
  chunks: [{ mesh, materialId, material, aabb, opaque: bool }],   // generadas
  colliders: Collider[],                                          // estáticos
  colliderGrid: { cellSize: number, cells: Map|{}, queryAABB(aabb, out): Collider[] },
  collidersAABB: [],                                              // subconjunto tipo 'box' de rápido acceso
  props: [{ mesh, materialId, model, aabb, collider? }],
  spawns: { player: { pos, yaw }, enemies: EnemySpawn[], pickups: PickupSpawn[], objectives: Objective[] },
  lights: StaticLight[],
  navNodes: { pos: Float32Array, links: number[] }[],
  waves: WaveDef[],
  bounds: AABB,
  buildTimeMs: number,
  dispose(): void,
  rebuild(ctx): void,                     // tras contextlost
  queryColliders(aabb, out: Collider[]): Collider[],
  groundHeightAt(x, z, fromY, maxDrop): number,    // -Infinity si no hay suelo
  isInsideLevel(pos): bool,
  landmarks: [{ id, pos, radius, label }]          // para objetivos tipo "llega a"
}
```
`Collider = { type:'box', min:Float32Array, max:Float32Array, mat:string, flags:number } | { type:'ramp', min, max, axis:'+x'|'-x'|'+z'|'-z', y0:number, y1:number, flags:number }`.

---

### 3.12 `js/world/physics.js` → `BS.Physics`

```js
BS.Physics = {
  MASK: { WORLD:1, ENEMY:2, PLAYER:4, PICKUP:8, PROJECTILE:16, PROP:32 },

  // movimiento con sweep por ejes + step-up
  moveBox(level: Level, body: Body, delta: Float32Array, opts?: {
    stepHeight?: number, maxIterations?: number, gravity?: number
  }): MoveResult,

  raycast(level: Level, origin: Float32Array, dir: Float32Array, maxDist: number, mask: number): Hit|null,
  raycastAABBList(items: Array<{ aabb:AABB, ref:any }>, origin, dir, maxDist): Hit|null,
  sphereOverlapList(items, center, radius): any[],
  sweepAABBvsAABB(minA, maxA, minB, maxB, delta): number,

  groundCheck(level, body, epsilon?): boolean,
  resolveOverlaps(level, bodies: Body[], iterations?): void    // separación entre enemigos
}

Body = {
  pos: Float32Array,      // centro del cuerpo
  vel: Float32Array,
  radius: number,
  height: number,         // altura total
  onGround: boolean,
  gravityScale?: number,
  stepHeight?: number,
  collideFlags?: number,
  ignoreRamp?: bool
}

MoveResult = {
  pos: Float32Array,
  onGround: boolean,
  hitCeiling: boolean,
  wallHit: boolean,
  wallNormal: Float32Array,   // normal del último choque lateral
  steppedUp: boolean,
  landed: boolean,            // transición aire->suelo en este paso
  groundNormal: Float32Array
}

Hit = { t:number, point:Float32Array, normal:Float32Array, distance:number, collider:Collider|null, ref:any|null }
```

---

### 3.13 `js/entities/projectiles.js` → `BS.Projectiles`

```js
BS.Projectiles = {
  init(ctx): void,
  update(dt: number): void,
  render(renderer): void,
  reset(): void,
  spawn(def: ProjectileDef): Projectile|null,
  list: Projectile[],
  count(): number,
  setBudget(n: number): void
}

ProjectileDef = {
  pos: Float32Array, vel: Float32Array,
  damage: number, speed: number, life: number,
  radius: number,                     // radio de impacto (esfera-AABB)
  gravity: number,                    // 0 para plasma
  owner: 'player'|'enemy',
  ownerRef: any,
  splash?: { radius: number, damage: number, falloff: 'linear'|'none' },
  homing?: number,                    // 0 = sin guiado (drone: 0.6 suave)
  material: string,                   // 'mat_bolt_plasma' o 'mat_tracer'
  mesh: Mesh,
  color: number[],
  trail?: bool,
  lightRadius?: number
}

Projectile = { pos, vel, def, alive, age, id }
```
Colisión: **subpaso por delta** (`ceil(|delta| / (radius*0.8))`, máx 4) y `BS.Math.raySegmentAABB` contra el mundo y contra enemigos/jugador (`ctx.combat.raycast`).

---

### 3.14 `js/entities/weapons.js` → `BS.Weapons`

```js
BS.Weapons = {
  DEFS: { [slot: number]: WeaponDef },     // 1 = pistol, 2 = smg, 3 = breacher
  create(ctx): WeaponSystem
}

WeaponDef = {
  slot: 1|2|3, id: 'pistol'|'smg'|'breacher',
  name: string,                        // 'MK-7 "VECTOR"'
  ammoType: 'light'|'heavy'|'cell',
  mode: 'semi'|'auto'|'burst',
  burstCount?: number,
  fireKind: 'hitscan'|'projectile',
  damage: number,                      // por perdigón/proyectil
  headshotMul: number,                 // 1.8
  pellets: number,                     // 1 ó 6
  rpm: number,
  magSize: number, reserveMax: number, startReserve: number,
  reloadTime: number, reloadEmptyExtra: number,
  range: number,
  baseSpread: number,                  // grados, con arma parada
  spreadPerShot: number, spreadMax: number, spreadRecover: number,   // grados/s y grados/disparo
  moveSpreadMul: number,           // multiplicador andando
  sprintSpreadMul: number, crouchSpreadMul: number, airSpreadMul: number,
  recoilKick: number, recoilYaw: number, kickRecover: number,
  adsFov?: number,                 // opcional (sin ADS en v1)
  moveSpeedMul: number,            // 1.0 / 0.92 / 0.85
  projectile?: { speed, gravity, splashRadius, splashDamage, radius, color, mesh, life },
  swapTime: number,
  viewmodel: { offset:[x,y,z], scale:number, kickBack:number, kickRot:number, swayAmount:number, bobAmount:number, muzzleOffset:[x,y,z], muzzleFlashScale:number },
  sfx: { fire:string, reload:string, empty:string, impact?:string },
  hudColor: [r,g,b]
}

WeaponSystem = {
  update(dt: number): void,
  tryFire(triggerHeld: boolean, triggerPressedThisFrame: boolean): boolean,
  reload(): boolean,
  switchTo(slot: number): boolean,
  nextWeapon(): void, prevWeapon(): void,
  cancelReload(): void,
  hasWeapon(slot: number): boolean, giveWeapon(slot: number, withAmmo?: bool): void,
  addAmmo(ammoType: string, amount: number): number,     // devuelve lo realmente añadido
  addAmmoToCurrent(amount: number): number,
  addReserve(slot: number, amount: number): number,
  fillAllAmmo(): void,
  reset(): void,

  current: WeaponState,                                    // estado del arma activa
  getState(): WeaponState,
  getSpreadPx(viewportHeight: number): number,             // radio de la mira dinámica en px

  renderViewmodel(renderer, opts: { eyePos, yaw, pitch, roll, bobPhase, speed01, dt }): void,
  muzzleWorldPos(out: Float32Array): Float32Array,
  rebuild(ctx): void, dispose(): void
}

WeaponState = {
  slot:number, id:string, name:string,
  ammoInMag:number, magSize:number, reserve:number, reserveMax:number,
  ammoType:string, isReloading:bool, reloadProgress:number,   // 0..1
  isSwapping:bool, swapProgress:number,
  fireMode:'semi'|'auto', canFire:bool, nextFireAt:number,
  spreadDeg:number, lastShotAt:number,
  unlocked:bool
}
```

**Secuencia canónica de un disparo hitscan (obligatoria para el developer):**
```js
const origin = ctx.player.eyePosition(out0);
const dir = ctx.renderer.getCameraRay(ndcX, ndcY, origin, out1);   // ndcX/Y = spread gaussiano
for (let p = 0; p < def.pellets; p++) {
  const hit = ctx.combat.raycast(origin, dir, def.range,
                BS.Physics.MASK.WORLD | BS.Physics.MASK.ENEMY | BS.Physics.MASK.PROP);
  if (hit.enemy) {
    const headshot = hit.point[1] > hit.enemy.pos[1] + hit.enemy.headY;
    const res = ctx.combat.damage(hit.enemy, def.damage * (headshot ? def.headshotMul : 1),
                  { point: hit.point, normal: hit.normal, dir, headshot, kind:'bullet', source: ctx.player });
    ctx.fx.impact(hit.point, hit.normal, 'flesh');
    ctx.hud.hitmarker(res.killed, headshot);
    ctx.audio.play(res.killed ? 'kill_confirm' : 'hit_flesh', { pos: hit.point });
  } else if (hit.t >= 0) {
    ctx.fx.impact(hit.point, hit.normal, hit.collider && hit.collider.mat === 'mat_metal_panel' ? 'metal' : 'concrete');
    ctx.audio.play('hit_world', { pos: hit.point });
  }
  ctx.fx.tracer(muzzlePos, hit.t >= 0 ? hit.point : addScaled(origin, dir, def.range), def.hudColor);
}
ctx.audio.play(def.sfx.fire, { pos: muzzlePos });
ctx.fx.muzzleFlash(muzzlePos, dir, def.viewmodel.muzzleFlashScale);
ctx.fx.tempLight(muzzlePos, def.hudColor, 6, 1.6, 0.06);
ctx.events.emit('noise', { pos: muzzlePos, radius: 26, tag: 'gunshot' });
ctx.events.emit('weapon:fired', { slot: def.slot, name: def.name, ammoInMag: st.ammoInMag });
```

---

### 3.15 `js/entities/player.js` → `BS.Player`

```js
BS.Player = {
  create(ctx): Player
}

Player = {
  pos: Float32Array, vel: Float32Array, yaw: number, pitch: number,
  health: number, maxHealth: number,           // 100
  armor: number,
  state: 'idle'|'walk'|'sprint'|'crouch'|'jump'|'fall'|'dead',
  isDead: bool, isGrounded: bool, isSprinting: bool, isCrouching: bool,
  bobPhase: number, landImpact: number, rollDeg: number,
  lastDamageDir: number, lastDamageTime: number,
  godMode: bool,
  speed: number,                                // m/s horizontal actual

  update(dt: number): void,
  eyePosition(out?: Float32Array): Float32Array,
  eyeHeight(): number,
  forward(out?: Float32Array): Float32Array,
  damage(amount: number, sourcePos?: Float32Array, kind?: string): { died:bool, hp:number, applied:number },
  heal(amount: number): number,
  setHealth(hp: number): void,
  respawn(pos: Float32Array, yaw: number): void,
  addRecoil(kick: number, yawKick: number): void,
  addCameraShake(amount: number): void,
  applyImpulse(v: Float32Array): void,
  getWeapons(): WeaponSystem,
  onDeath(cb: function(): void): void,

  CONFIG: {
    walkSpeed: 4.4, sprintSpeed: 7.2, crouchSpeed: 2.1,
    accelGround: 60, accelAir: 9, friction: 11,
    gravity: 22, jumpVelocity: 7.4, coyoteTime: 0.10, jumpBuffer: 0.12,
    stepHeight: 0.45, standHeight: 1.85, crouchHeight: 1.1, radius: 0.34,
    eyeOffset: -0.15,                  // respecto al centro
    sprintFovAdd: 6, fovLerpSpeed: 6,
    bobAmp: 0.045, bobSpeedPerMeter: 2.1, landBobDamp: 12,
    maxFallSafe: 9, fallDamagePerUnit: 6,
    invulnTime: 0.4, regenDelay: 6.5, regenRate: 9
  }
}
```
`BS.Player.create(ctx)` crea internamente el `WeaponSystem` vía `BS.Weapons.create(ctx)` y lo expone en `player.weapons`.

---

### 3.16 `js/entities/pickups.js` → `BS.Pickups`

```js
BS.Pickups = {
  init(ctx): void,
  update(dt: number): void,
  render(renderer): void,
  reset(): void,
  spawn(def: PickupDef): Pickup,
  list: Pickup[],

  KINDS: {
    ammo_light:  { ammoType:'light',  amount:24, mesh:'box_small', color:[1,0.85,0.4], sound:'pickup_ammo' },
    ammo_heavy:  { ammoType:'heavy',  amount:18, mesh:'box_small', color:[1,0.6,0.3],  sound:'pickup_ammo' },
    ammo_cell:   { ammoType:'cell',   amount:12, mesh:'box_small', color:[0.4,0.9,1],  sound:'pickup_ammo' },
    health_small:{ heal:25, mesh:'cross',   color:[0.3,1,0.5],  sound:'pickup_health' },
    health_large:{ heal:50, mesh:'cross',   color:[0.3,1,0.5],  sound:'pickup_health' },
    weapon_smg:  { weapon:2, mesh:'gun_rack', color:[0.7,0.8,0.9], sound:'pickup_weapon' },
    weapon_breacher:{ weapon:3, mesh:'gun_rack', color:[0.9,0.5,1], sound:'pickup_weapon' }
  }
}

PickupDef = { kind:string, pos:Float32Array, amount?:number, respawn?:number, static?:bool }
Pickup = { id, kind, pos, aabb, alive, bobPhase, respawnAt, ref }
```
Recogida: AABB del jugador vs AABB del pickup; si `kind` empieza por `weapon_`, `player.getWeapons().giveWeapon(n)`; si es munición y el arma no está desbloqueada, se convierte en reserva genérica; si no se puede recoger (munición llena, vida llena), no se consume.

---

### 3.17 `js/entities/enemies.js` → `BS.Enemies`

```js
BS.Enemies = {
  TYPES: { drone: DroneDef, stalker: StalkerDef, brute: BruteDef },
  init(ctx): void,
  update(dt: number): void,
  render(renderer): void,
  reset(): void,

  spawn(type: 'drone'|'stalker'|'brute', pos: Float32Array, opts?: {
    variant?: 'prime'|null, wave?: number, patrol?: Float32Array[], aggro?: bool, hpMul?: number
  }): Enemy,
  spawnWave(waveIndex: number): number,      // devuelve nº de enemigos creados
  list: Enemy[],
  aliveCount(): number,
  aliveCountOfType(t: string): number,
  clear(): void,

  raycast(origin, dir, maxDist, ignoreEnemy?): { enemy:Enemy, t:number, point:Float32Array,
                                                normal:Float32Array, headshot:bool } | null,
  damage(enemy: Enemy, amount: number, hitInfo: HitInfo): { killed:bool, hp:number, applied:number },
  areaDamage(pos: Float32Array, radius: number, amount: number,
             opts?: { falloff?:'linear'|'none', kind?:string, source?:any }): number,
  getNearest(pos: Float32Array, maxDist: number, filter?): Enemy|null,
  noiseListener(payload: { pos, radius, tag }): void,
  buildMeshes(ctx): void,                    // genera las 3 mallas + sus AABB locales
  rebuild(ctx): void, dispose(): void
}

Enemy = {
  id:number, type:'drone'|'stalker'|'brute', variant:string|null,
  pos:Float32Array, vel:Float32Array, yaw:number, hp:number, maxHp:number,
  radius:number, height:number, headY:number, aabb:AABB,
  alive:bool, state:'idle'|'patrol'|'alert'|'chase'|'attack'|'search'|'stagger'|'dead',
  stateTime:number, target:any|null, lastKnownPos:Float32Array,
  attackCooldown:number, flashTime:number, staggerTime:number, deathTime:number,
  patrol:Float32Array[], patrolIndex:number, stuckTime:number, avoidSign:number,
  meshId:string, damageMul:number,
  update(dt, ctx):void,
  aabbOf(out):AABB,
  canSee(pos):bool
}
```
**Definición de los 3 tipos:**

| | `drone` (WATCHER) | `stalker` (CRAWLER) | `brute` (ENFORCER) |
|---|---|---|---|
| Nombre lore | VIGÍA-7 | SIGILO-9 | EJECUTOR-3 |
| Movimiento | **flotante** (hover, sine vertical), ignora gravedad | terrestre, dashes y salto | terrestre, pasos pesados |
| HP base | 40 | 55 | 220 |
| Radio / altura | 0.45 / 0.6 (centro a 1.9 m del suelo) | 0.4 / 1.1 | 0.7 / 2.3 |
| Velocidad | 2.8 (strafe 3.4) | 5.6 (dash 9.0) | 2.3 |
| Detección visual | 28 m, cono 110° | 20 m, cono 80° | 26 m, cono 60° (pobre) |
| Oído | 14 m | 20 m | 24 m |
| Ataque | proyectil plasma lento (18 dmg, 24 m/s, guiado suave 0.5) | **melé garra** 22 dmg, alcance 2.0, + salto de embestida | **melé slam** 34 dmg, alcance 2.6, + onda expansiva 18 dmg r=3.5 |
| Cadencia | 1 disparo / 1.8 s (2.5 s) | 1.1 s | 2.6 s |
| Comportamiento | orbita a 6–10 m, strafe, se retira si el jugador se acerca < 4 m | embiste en línea recta, rodea por flancos (offset lateral ±35°), salta muros bajos | avanza directo, rompe coberturas bajas (las ignora), se queda quieto al atacar |
| Punto débil | núcleo central (headshot ×2.0) | cabeza (×2.2) | radiador trasero (solo si `dot` por la espalda, ×2.5) |

**FSM común**: `idle → patrol → alert (0.4 s de gruñido) → chase → attack → search (4 s) → patrol`, con transición a `stagger` al recibir daño (0.12 s, interrumpe ataque) y `dead` con animación de colapso/parpadeo (1.2 s) antes de desaparecer.

**Anti-atasco concreto**: si `stuckTime > 0.5 s` (desplazamiento real < 0.15 m en 0.5 s en estado chase), se elige lateral (`avoidSign = ±1`) durante 0.9 s; si sigue atascado tras 2 intentos, `state='search'` 1.5 s y reposiciona. Los drones hacen wall-slide y no se atascan porque ignoran el suelo.

**Escalado por oleada** (`wave` de 1..5): `hp *= 1 + 0.06*(w-1)`, `damageMul = 1 + 0.04*(w-1)`, `speed *= 1 + 0.03*(w-1)`, `attackCooldown *= 1 - 0.05*(w-1)`, `maxAlive = min(8 + 2*w, 20)`.

---

### 3.18 `js/ui/style.js` → `BS.Style`

```js
BS.Style = {
  css: string,                    // TODO el CSS como template string
  inject(): void,                 // crea <style id="bs-style"> en <head> si no existe
  CLASS: { root, canvas, hud, ui, overlay, panel, btn, btnPrimary, slider, row, hidden, ... }
}
```

---

### 3.19 `js/ui/hud.js` → `BS.HUD` (Canvas2D)

```js
BS.HUD = {
  init(ctx): void,
  update(dt: number): void,
  render(dt: number): void,          // dibuja en hudCanvas (2D); en pausa dibuja el último frame + capa de pausa
  resize(): void,
  show(): void, hide(): void, setVisible(on: bool): void,

  hitmarker(killed: bool, headshot: bool): void,
  showDamage(dirAngle: number, amount: number): void,
  notify(text: string, seconds?: number, color?: string): void,
  setObjective(text: string, done?: number, total?: number): void,
  setSubtitle(text: string, seconds?: number): void,
  setPrompt(text: string|null): void,           // "PULSA [E] PARA RESTAURAR ENERGÍA"
  setWaveText(main: string, sub: string, seconds: number): void,
  setLowHealthIndicator(on: bool): void,
  setTutorial(step: number, total: number, text: string, key: string): void,
  setBossBar(label: string, hp01: number): void,
  clearBossBar(): void,
  killFeedLine(text: string, color: string): void,
  showCrosshair(on: bool): void,
  setCrosshairKick(amount: number): void,
  debugOverlay(on: bool): void,                 // F1: fps, drawcalls, tris, pos, estado, enemigos
  setOpacity(a: number): void
}
```

---

### 3.20 `js/ui/menu.js` → `BS.Menu` (DOM)

```js
BS.Menu = {
  init(ctx): void,
  build(): void,                    // crea TODO el DOM dentro de #bs-root
  
  show(screen: 'loading'|'main'|'settings'|'credits'|'tutorial'|'pause'|'dead'|'victory'|'controls'|null): void,
  hide(): void,
  current(): string|null,
  setCallbacks(cb: {
    onStart?(): void, onResume?(): void, onRestartCheckpoint?(): void,
    onRestartMission?(): void, onQuitToMenu?(): void,
    onSettingsChanged?(settings): void, onRequestLock?(): void
  }): void,

  getSettings(): Settings,
  applySettings(s: Settings): void,
  setLoadingProgress(p01: number, label: string): void,
  setDeathInfo(info: { wave:number, kills:number, time:number }): void,
  setVictoryInfo(info: { time:number, kills:number, accuracy:number, headshots:number }): void,
  showMessage(text: string, seconds?: number): void,      // aviso tipo "CLICK PARA BLOQUEAR EL RATÓN"
  setEditable(enabled: bool): void
}

Settings = {
  sensitivity: 0.0022, invertY: false,
  volumeMaster: 0.8, volumeSfx: 0.9, volumeMusic: 0.5,
  fov: 78, resolutionScale: 1.0, quality: 'auto'|'low'|'medium'|'high',
  postFx: true, showFps: false, crosshair: 'dynamic'|'fixed',
  bloodFx: true, screenShake: 1.0, difficulty: 'normal'|'hard'
}
```

---

### 3.21 `js/game/game.js` → `BS.Game`

```js
BS.Game = {
  STATE: { BOOT:'boot', LOADING:'loading', MENU:'menu', TUTORIAL:'tutorial',
           PLAYING:'playing', PAUSED:'paused', DEAD:'dead', VICTORY:'victory' },

  ctx: Ctx,                     // el objeto de contexto compartido
  init(): void,                 // construye ctx y todos los subsistemas
  start(): void,                // → LOADING → TUTORIAL/PLAYING
  setState(s: string): void,
  getState(): string,
  pause(reason?: string): void,
  resume(): void,
  restartCheckpoint(): void,
  restartMission(): void,
  quitToMenu(): void,
  frame(nowMs: number): void,   // el bucle; llamado por rAF (o por BS.Debug.stepFrames)
  onResize(): void,
  onContextLost(ev): void,
  onContextRestored(): void,

  // progresión
  waves: WaveRuntime[],
  currentWave: number,
  kills: number, shotsFired: number, shotsHit: number, headshots: number,
  missionTime: number,
  objectives: ObjectiveState[],
  setObjectiveDone(id: string): void,
  spawnWave(index: number): void,
  onEnemyKilled(enemy, byPlayer): void,
  checkVictory(): boolean,

  // mediador de combate (implementado en game.js, consumido por weapons/enemies/projectiles)
  combat: {
    raycast(origin, dir, maxDist, mask, ignore?): Hit|null,
    damage(target, amount, hitInfo: HitInfo): { killed:boolean, hp:number, applied:number },
    areaDamage(pos, radius, amount, opts?): number,
    noise(pos, radius, tag): void
  }
}
```

**`ctx` (contrato congelado, construido en `BS.Game.init`):**

```js
Ctx = {
  gl,            // BS.GL
  renderer,      // BS.Renderer
  audio,         // BS.Audio
  input,         // BS.Input
  textures,      // BS.Textures
  shaders,       // BS.Shaders
  mesh,          // BS.Mesh
  level,         // Level (ya construido)
  physics,       // BS.Physics
  fx,            // BS.FX
  projectiles,   // BS.Projectiles
  weapons,       // WeaponSystem (creado por Player)
  player,        // Player
  pickups,       // BS.Pickups
  enemies,       // BS.Enemies
  hud,           // BS.HUD
  menu,          // BS.Menu
  debug,         // BS.Debug
  game,          // BS.Game  (asignado al final de init)
  settings,      // Settings (referencia viva; mutarla afecta al juego)
  rng,           // function(): number  (semilla fija)
  events,        // BS.Events
  time,          // segundos simulados desde el inicio de la partida
  frameIndex,    // entero
  quality,       // 'low'|'medium'|'high'
  getQualitySetting(key): any,
  isLowQuality(): bool,
  isWebGL2(): bool
}
```

**Orden de construcción (obligatorio, documentado en el código):**
```
1 BS.GL.init(canvas)                → si falla: BS.Menu.showError y abortar
2 BS.Debug.captureErrors()
3 BS.Textures.init()                → texturas y materiales
4 BS.Renderer.init()                → programas, FBO, cámara
5 BS.Audio.init(); BS.Audio.preload()
6 BS.Input.init(canvas)
7 ctx = { ...llaves de arriba... , combat: <objeto vacío que se rellena ahora>, settings }
8 BS.Style.inject(); BS.Util.ensureDOM()
9 BS.Events.clear()
10 BS.FX.init(ctx)
11 BS.Projectiles.init(ctx)
12 ctx.level = BS.Level.build(BS.LevelData.build(), ctx)
13 BS.Pickups.init(ctx)
14 ctx.player = BS.Player.create(ctx)   // crea ctx.weapons por dentro
15 BS.Enemies.init(ctx)
16 BS.HUD.init(ctx); BS.Menu.init(ctx)
17 ctx.game = BS.Game; rellenar ctx.combat.*
18 wire: eventos de lock, resize, visibilitychange, contextlost
19 BS.Debug.register(...) de cada módulo
```

**`updateFixed(dt)` — orden por paso (dt = 1/60 exacto):**
```
1 ctx.time += dt; ctx.frameIndex++
2 ctx.player.update(dt)          // input → intención → movimiento → colisión → cámara → dispara armas
3 ctx.weapons.update(dt)         // temporizadores, recarga, swap, spread
4 ctx.enemies.update(dt)         // FSM, percepción, movimiento, ataques (llama a ctx.combat)
5 ctx.projectiles.update(dt)
6 ctx.pickups.update(dt)
7 BS.Game.updateWaves(dt)
8 ctx.fx.update(dt)              // partículas/trazadoras (post-movimiento, para que salgan de posiciones finales)
9 ctx.audio.update(dt)
10 ctx.renderer.setCamera(player.eyePosition(), player.yaw, player.pitch, fov)
```
Después del bucle de pasos: `ctx.fx.getShake()` → offset de cámara; `ctx.hud.update(dt)`; render.

---

### 3.22 `js/main.js` → `BS.Main`

```js
BS.Main = {
  boot(): void,          // idempotente; se autoinvoca si document.readyState !== 'loading'
  version: '1.0.0'
}
```
`boot()`: `BS.Style.inject()` → `BS.Util.ensureDOM()` → `BS.Menu.show('loading')` → `BS.Game.init()` → menú principal. No hace nada más.

---

## 4. Modelo de datos del nivel y pipeline de generación

### 4.1 Estructura declarativa (en `leveldata.js`)

```js
Mission = {
  id: 'k7', name: 'BLACKSITE K-7 — SEÑAL PERDIDA',
  author: 'team', version: 1,
  seed: 0xB1AC5E,
  environment: {
    clearColor: [0.02, 0.025, 0.035],
    fog: { color:[0.035, 0.055, 0.075], density: 0.030 },
    ambient: { sky:[0.16,0.19,0.24], ground:[0.05,0.05,0.06] },
    ceilingY: 6.0,                     // techo implícito del nivel
    floorY: 0.0
  },
  welcomeText: '...',
  objectivesIntro: [...],
  
  brushes: [
    // kind: 'box'|'wedge'|'cylinder'|'stair'|'tube'|'deco'
    { kind:'box', pos:[0,-0.5,0], size:[60,1,60], mat:'mat_concrete_floor', uv:[0.35,0.35], collide:true, visible:true, lightMap:true },
    { kind:'box', pos:[-10,3,0], size:[1,7,60], mat:'mat_concrete_wall' },
    { kind:'box', pos:[0,3,-10], size:[1,7,60], mat:'mat_metal_panel', rotY:0 },
    { kind:'wedge', pos:[8,1,4], size:[4,2,4], axis:'+x', mat:'mat_metal_floor' },   // rampa
    { kind:'stair', pos:[12,0,0], size:[3,3,6], steps:8, axis:'+z', mat:'mat_metal_floor' },
    { kind:'cylinder', pos:[0,3,0], radius:0.5, height:6, segments:8, mat:'mat_pipe', collide:true },
    { kind:'box', pos:[5,1.2,-20], size:[3,2.4,0.4], mat:'mat_terminal', emissive:1.0, collide:true },
    { kind:'box', pos:[2,5.9,3], size:[1.6,0.12,4], mat:'mat_strip_cyan', emissive:1.4, collide:false },
    { kind:'deco', pos:[3,0.5,-6], size:[1.2,1,1.2], mat:'mat_crate', rotY:0.4 }     // colisión = AABB envolvente
  ],

  decals: [ { mat:'mat_rust', pos:[..], normal:[..], size:[..] } ],                 // opcional v2

  staticLights: [
    { pos:[3,5.5,-6], color:[0.5,0.85,1.0], radius:11, intensity:1.1, baked:true },
    { pos:[-8,4,12],  color:[1.0,0.35,0.25], radius:9,  intensity:0.9, baked:true, dynamic:false }
  ],

  entities: {
    playerSpawn: { pos:[-24,1.0,24], yaw:2.4 },
    enemySpawns: [
      { id:'e1', type:'drone',   pos:[-10,1.9,0],  waves:[1,2,4], patrol:[[-10,1.9,0],[-4,1.9,-6]] },
      { id:'e2', type:'stalker', pos:[14,0.6,-12], waves:[2,3],   patrol:[[14,0.6,-12],[14,0.6,0]] },
      { id:'e3', type:'brute',   pos:[0,1.2,-40],  waves:[3,5],   patrol:[[0,1.2,-40],[6,1.2,-34]] }
    ],
    pickups: [
      { kind:'ammo_light',   pos:[6,0.6,10] },
      { kind:'weapon_smg',   pos:[22,0.6,0],   waves:[2,3,4,5] },
      { kind:'weapon_breacher', pos:[-30,0.6,-30], waves:[3,4,5] },
      { kind:'health_large', pos:[0,0.6,-18],  waves:[1,2,3,4,5] }
    ],
    objectives: [
      { id:'reach_atrium',   type:'goto',  landmark:'atrium', radius:4, label:'LLEGA AL ATRIO CENTRAL' },
      { id:'power',          type:'interact', pos:[5,1.2,-20], radius:2.2, holdTime:3.0,
        label:'RESTAURA LA ENERGÍA', requiresWave:0 },
      { id:'beacon',         type:'interact', pos:[-30,1.2,-30], radius:2.2, holdTime:4.0,
        label:'ACTIVA EL BALIZA DE RESCATE', requiresWave:4 }
    ],
    landmarks: [
      { id:'atrium', pos:[0,0,0], radius:8, label:'ATRIO' },
      { id:'reactor', pos:[-20,0,-40], radius:9, label:'REACTOR' }
    ]
  },

  waves: [
    { index:0, label:'OLEADA 1 — SONDA', spawnDelay:1.5, betweenDelay:3, maxAlive:8,
      enemies:[{type:'drone', count:6}], spawnPoints:['e1'], trigger:{ objectives:['reach_atrium'] } },
    { index:1, label:'OLEADA 2 — EMBOSCADA', spawnDelay:0.9, betweenDelay:8, maxAlive:10,
      enemies:[{type:'stalker', count:5},{type:'drone', count:4}], spawnPoints:['e1','e2'],
      trigger:{ requiresObjectives:['power'] }, reward:{ pickup:'weapon_smg', at:[22,0.6,0] } },
    { index:2, label:'OLEADA 3 — BLINDAJE', spawnDelay:1.2, betweenDelay:10, maxAlive:12,
      enemies:[{type:'brute', count:3},{type:'drone', count:6}], spawnPoints:['e1','e2','e3'] },
    { index:3, label:'OLEADA 4 — PURGA', spawnDelay:0.6, betweenDelay:10, maxAlive:18,
      enemies:[{type:'stalker', count:8},{type:'drone', count:8},{type:'brute', count:1}], spawnPoints:['e1','e2'] },
    { index:4, label:'OLEADA FINAL — EL CELADOR', spawnDelay:2.0, betweenDelay:0, maxAlive:14, boss:true,
      enemies:[{type:'brute', count:1, variant:'prime', hpMul:3.2},{type:'drone', count:6},{type:'stalker', count:4}],
      spawnPoints:['e3'], trigger:{ requiresObjectives:['beacon'] },
      victoryOnClear:true }
  ]
}
```

Reglas de diseño de la misión (implementadas en `game.js`):
- **5 oleadas**, cada una con `trigger` (objetivos cumplidos). `wave.state ∈ 'pending'|'active'|'cleared'`.
- Victoria clara: al limpiar la oleada 5 (`victoryOnClear`) → `BS.Game.setState('victory')` → pantalla con tiempo, bajas, precisión y headshots.
- Derrota: `player.health <= 0` → `'dead'`; el menú ofrece **REINTENTAR OLEADA** (checkpoint = inicio de oleada) o **REINICIAR MISIÓN**.
- Entre oleadas, 8–10 s de respiro con respawn de pickups y mensaje en HUD.

### 4.2 Pipeline de generación (`BS.Level.build`)

```
1. Validar datos. Calcular bounds.
2. Para cada brush (visible):
     - Construir geometría con BS.Mesh.Builder (rotY sólo en brushes no colisionantes).
     - Calcular UV con brush.uv (escala de repetición por unidad).
3. Horneado de iluminación por vértice:
     - Para cada vértice v con normal n:
         color = ambient(sky/ground por n.y)
         para cada luz estática L dentro de su radio:
             color += L.color * L.intensity * falloff(dist) * max(0, dot(n, dirALuz))
     - AO aproximado: 9 rayos cortos (patrón fijo) contra el hash de AABB (radio 1.6 m),
       factor = 1 - 0.55*oclusión. Coste objetivo < 120 ms.
     - aColor.a = brush.emissive ?? 0 (multiplicado por el patrón del mapa emisivo).
     - Clamp y escribir.
     - límite: si supera 480k vértices totales → aviso BS.Log.warn y simplificación (menos rayos AO).
4. Troceado en chunks: rejilla de 12×12 m. Se agrupa (chunk, material) → un Mesh cada uno.
     Un chunk-material nunca debe superar 65.000 vértices; si lo hace, se subdivide en Z.
5. Colisionadores:
     - box   → { type:'box', min, max, mat, flags:WORLD|PROP }
     - wedge → { type:'ramp', min, max, axis, y0, y1 }
     - stair → N cajas de peldaño (la lógica step-up hace el resto)
     - cylinder → caja envolvente
     - deco con rotY → caja envolvente (documentado en el editor de datos)
6. Rejilla hash: cellSize 4 m; cada celda guarda índices de colliders cuyo AABB la solapa (padding 0.2).
7. Props con malla propia (cajas, barriles, cajas de munición): mallas instanciadas por props separados.
8. navNodes: rejilla de puntos de 3 m en el suelo (muestreo con groundHeightAt + comprobación de espacio),
   enlazados a sus vecinos si el segmento no cruza mundo (raycast). Se usa como fallback de IA.
9. Extraer spawns, landmarks, waves.
10. level.buildTimeMs = ...
```

Coste objetivo de `BS.Level.build`: **< 700 ms** en hardware modesto (con `BS.Menu.setLoadingProgress` informando).

---

## 5. Bucle de juego y máquina de estados

### 5.1 Estados

```
BOOT ──► LOADING ──► MENU ──(Start)──► TUTORIAL ──► PLAYING ◄──┐
                        ▲                    │          │       │
                        │                    └──────────┘       │
                        │                                  (Escape / pointerlockchange)
                        │                                       ▼
                        │                                    PAUSED ──(Resume)──► PLAYING
                        │                                       │
                        └──(Quit to menu)──── DEAD ◄─────────────┘
                                              VICTORY
```
- `PAUSED` se entra **también** automáticamente cuando se pierde el Pointer Lock (escape, alt-tab, `visibilitychange`), que es la única forma fiable de detectarlo en `file://`.
- En `PAUSED/DEAD/VICTORY` **no se avanza la simulación**; solo se renderiza el último estado (o se re-simula el frame con dt=0 para mantener el HUD).
- `TUTORIAL`: mismo estado de juego que `PLAYING` pero con un mapa reducido a la primera sala y carteles guiados; se puede saltar con un botón (`BS.Menu` → `'tutorial'` screen). Duración objetivo: 60–90 s.
- `restartCheckpoint()` reconstruye jugador/armas con el estado al inicio de la oleada actual; `restartMission()` reconstruye también el nivel (o solo `level.resetRuntime()` si no hay destrucción de geometría — en v1 no hay geometría destruible, así que **no se reconstruye el nivel**, solo se resetean entidades y pickups: recarga en < 30 ms).

### 5.2 Frame completo (pseudocódigo exacto)

```js
BS.Main.boot();
// ...
function frame(nowMs) {
  requestAnimationFrame(frame);
  const now = nowMs * 0.001;
  let dt = now - lastTime; lastTime = now;
  if (dt > 0.5) { dt = 0; accumulator = 0; }        // resumen tras pestaña en segundo plano
  dt = Math.min(dt, 1/15);                          // nunca más de 66 ms por frame
  BS.Input.beginFrame();

  if (state === 'playing' || state === 'tutorial') {
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_DT && steps < MAX_STEPS) {   // FIXED_DT = 1/60, MAX_STEPS = 4
      updateFixed(FIXED_DT);
      accumulator -= FIXED_DT;
      steps++;
    }
    if (steps === MAX_STEPS) accumulator = 0;       // evitar "spiral of death"
  } else {
    accumulator = 0;
  }

  renderFrame(dt);          // usa el estado actual, con shake y FX
  BS.Input.endFrame();
}

function renderFrame(dt) {
  renderer.beginFrame(clearColor);
  renderer.setCamera(player.eyePosition(), player.yaw, player.pitch, fovActual);
  renderer.updateFrustum();
  // luces dinámicas: flash + 3 más cercanas relevantes (balizas, explosiones)
  renderer.setDynamicLights(pickLights());
  for (const c of level.chunks) if (renderer.isVisible(c.aabb)) renderer.push(c.mesh, IDENTITY, c.material);
  enemies.render(renderer); pickups.render(renderer); projectiles.render(renderer);
  fx.beginFrame(); fx.render(renderer);              // partículas (transparentes aditivas)
  renderer.flush();                                  // opacas + transparentes + viewmodel
  hud.render(dt);
  renderer.present();                                // postFX (vignette/daño/scanlines) o no-op
}
```

**Delta time y estabilidad**: toda la lógica sensible (física, IA, temporizadores de armas) corre a **paso fijo 1/60 exacto**. `dt` variable solo se usa para cosas cosméticas (partículas, HUD, interpolación de FOV/bob). Con esto, un juego a 30 FPS se comporta igual que a 144 FPS en salto, cadencia y colisiones. `BS.Debug.stepFrames()` usa el mismo camino → el tester obtiene resultados deterministas.

**Sin interpolación de render** en v1 (coste/beneficio bajo con paso fijo a 60 Hz). Se documenta como mejora futura si el tester detecta micro-stutter.

---

## 6. Análisis de riesgos específicos WebGL + file:// (con mitigación concreta)

| # | Riesgo | Probabilidad / impacto | Mitigación concreta (código) |
|---|---|---|---|
| R1 | **Pointer Lock en `file://`** — Chrome lo permite, pero: `requestPointerLock()` devuelve Promise (Chrome ≥113) y puede rechazar; hay *cooldown* de ~1.25 s tras salir con Escape; `pointerlockerror` silencioso; solicitar el lock sin gesto de usuario falla | Alta / Alto | (a) **Nunca** relock automático: siempre por clic explícito en overlay `CLICK PARA CONTINUAR`. (b) Envolver: `try { const p = el.requestPointerLock({unadjustedMovement:true}); if (p && p.catch) p.catch(()=>{ try{ const q=el.requestPointerLock(); if(q&&q.catch) q.catch(()=>onLockFail()); }catch(e){onLockFail();} }); } catch(e) { try{ el.requestPointerLock(); }catch(e2){ onLockFail(); } }`. (c) Escuchar `pointerlockerror` → `BS.Menu.showMessage('Vuelve a hacer clic en unos segundos')`. (d) **No depender de la tecla Escape**: la pausa se dispara en `pointerlockchange` cuando `document.pointerLockElement === null`. (e) Toda lectura de ratón pasa por deltas acumulados en `mousemove` con `movementX/Y` (que siguen funcionando bajo lock), con fallback a `clientX` diff si `movementX` es 0. |
| R2 | **WebGL no disponible** (`getContext` devuelve `null`) | Media / Crítico | `BS.GL.init` prueba `webgl2` → `webgl` → `experimental-webgl`, con `failIfMajorPerformanceCaveat:false`. Si todo falla: `BS.Menu.showError('Tu navegador no soporta WebGL...')` con instrucciones (habilitar aceleración por hardware) y **nada más se ejecuta**. Escuchar `webglcontextcreationerror` para capturar el mensaje del driver. |
| R3 | **Pérdida de contexto** (`webglcontextlost`) por driver inestable/iGPU con poca VRAM | Media / Alto | Escuchar `webglcontextlost` (con `event.preventDefault()`), parar el rAF, congelar estado, mostrar overlay "RESTAURANDO GPU". En `webglcontextrestored`: `BS.Textures.rebuild()` (los canvas 2D se conservan) → `BS.Renderer.rebuild()` (recompila los 4 programas y el FBO) → `each module.rebuild(ctx)` → `BS.Level.rebuild(ctx)` (reconstruye meshes desde los datos, no desde GPU) → reanudar. Todos los módulos que crean recursos GL **deben** exponer `rebuild()` y `dispose()`. |
| R4 | **`performance.now` y pestaña en segundo plano** — rAF se detiene; al volver, `dt` puede ser de minutos | Muy alta / Medio | (a) `visibilitychange` → **pausa automática** y `BS.Input.clearAll()`. (b) `if (dt > 0.5) { dt = 0; accumulator = 0; }`. (c) `dt = min(dt, 1/15)` y `MAX_STEPS = 4` para evitar el *spiral of death*. (d) `lastTime` se refresca siempre, nunca se usa tiempo absoluto para la física. |
| R5 | **Autoplay policy de audio** — `AudioContext` nace `suspended`, sin sonido ni error | Muy alta / Medio | `BS.Audio.init()` crea el contexto; **`resume()` solo en `onclick` real del botón JUGAR y en el clic de bloqueo de ratón**. Si `ctx.state !== 'running'` tras 800 ms, el HUD muestra "🔊 PULSA PARA ACTIVAR EL SONIDO" y el siguiente clic reintenta. `BS.Audio.isRunning()` permite al HUD pintar el aviso. Nunca se usa `AudioWorklet` (requiere `addModule(url)` → bloqueado/incómodo en `file://`) ni `ScriptProcessorNode`. |
| R6 | **Presupuesto de voces de audio y crackling** en CPU modestas | Media / Medio | Buffer de ruido único de 2 s compartido (un solo `AudioBuffer`, 0.35 MB); máx. **24 voces** simultáneas (12 en `low`), con descarte por prioridad/distancia; envolventes cortas (≤ 0.35 s para disparos); `latencyHint:'interactive'`; nunca `ConvolverNode` (reverb por delay+feedback opcional). |
| R7 | **`keydown`/`keyup` imprecisos con Pointer Lock** — `keyup` perdido al perder foco → "tecla pegada" (el jugador anda solo) | Alta / Medio | (a) Usar **`event.code`** (posición física), nunca `event.key` (depende de layout/Shift). (b) `BS.Input.clearAll()` en `blur`, `visibilitychange` (oculto) y `pointerlockchange`. (c) `preventDefault()` en Space/Tab/flechas. (d) Los flancos (`wasPressed`) se limpian en `endFrame()`, nunca en el handler. |
| R8 | **`WEBGL_depth_texture` ausente** (necesario para shadow maps o leer profundidad) | Alta / Nulo (por diseño) | El motor **no usa depth textures**: FBO de post-proceso con `colorTex` RGBA8 + `renderbuffer` `DEPTH_COMPONENT16`. Sin shadow maps. Cero riesgo. |
| R9 | **`OES_element_index_uint` ausente** (no se pueden pasar de 65535 vértices) | Alta / Nulo (por diseño) | Índices `Uint16` **siempre**, y el nivel se trocea en chunks de 12 m para garantizar < 65k vértices por mesh. Además, si `caps.uintIndex` es falso y un chunk excediera, `BS.Level.build` lo subdivide automáticamente. |
| R10 | **`OES_standard_derivatives` ausente** (WebGL1) → no se puede calcular la base tangente en el shader | Media / Bajo | `caps.derivativesAvailable` se consulta al arrancar; si falta, `BS.Textures` deja `normalMap = null` para todos los materiales y `uNormalStrength = 0`, con `#define NO_NORMALMAP`. La iluminación por vértice sigue funcionando. En WebGL2 está siempre disponible. |
| R11 | **`MAX_FRAGMENT_UNIFORM_VECTORS` muy bajo** (mínimo legal = 16) — el shader básico con 3 luces + linterna roza el límite | Baja / Alto | (a) Uniformes **empaquetados en arrays `vec4`** (`uLightPos[i]` = xyz+radio, `uLightColor[i]` = rgb+intensidad) para minimizar el uso de *slots*. (b) Al arrancar: si `caps.maxFragmentUniformVectors < 64` → `setMaxDynamicLights(1)` y `#define NO_NORMALMAP`. Si `< 32` → `setMaxDynamicLights(0)` y solo linterna + horneado. (c) `BS.Debug.stats()` reporta el valor para que el tester lo verifique. |
| R12 | **Límite de tamaño de textura** | Baja / Bajo | Todo el arte es procedural a 128–256 px (muy por debajo del mínimo legal de 2048). Si `caps.maxTextureSize < 256` (imposible en la práctica pero contemplado), `BS.Textures.setTextureSize(128)`. `caps.maxAniso` se usa para fijar el filtrado anisotrópico, limitado a 4. |
| R13 | **High-DPI / devicePixelRatio** — a DPR 2–3 el fill-rate se multiplica x4–x9 con un canvas CSS a pantalla completa | Muy alta / Alto | `dprEfectivo = min(window.devicePixelRatio || 1, 1.5) * resolutionScale`, y en `low` el techo es `min(dpr, 1) * 0.6`. `resizeToDisplay()` recalcula `canvas.width/height` y el `viewport`. Se detecta cambio de DPR con `matchMedia('(resolution: Xdppx)')` re-registrado en cada resize. El autoajuste dinámico baja `resolutionScale` en pasos de 0.1 si el `frameMs` medio de 30 frames supera 22 ms (solo si calidad es `auto`). |
| R14 | **SwiftShader / rasterizador software** (probable en el navegador de pruebas del `tester`) | Alta / Alto | Detección por `UNMASKED_RENDERER_WEBGL` (R1 §1.1) → calidad `low` forzada: `resolutionScale 0.6`, `postFx off`, postFX desactivado, `MAX_DYNAMIC_LIGHTS=1`, presupuesto de partículas 250, anisotropía off, texturas 128. Además `BS.Debug.setQuality()` para forzar en pruebas. **El rAF no se rompe nunca**, aunque baje a 15 FPS: el paso fijo garantiza que el juego siga siendo jugable y determinista. |
| R15 | **`preserveDrawingBuffer`** — las capturas de `browser.screenshot` pueden salir en negro si el buffer se limpia antes de la captura | Alta / Bajo | `BS.GL.init` con `preserveDrawingBuffer: true` por defecto (coste despreciable a estas resoluciones) y `antialias: false`. `BS.Debug.snapshotHud()` complementa la captura visual. |
| R16 | **Errores silenciosos al concatenar inline en `about:blank`** — dos archivos declarando el mismo `const` en el ámbito global, o un `class` duplicado | Media / Crítico | Regla obligatoria §3.0: **todo el código dentro de IIFE**, solo `window.BS` como global, prohibido `class` a nivel de archivo. `BS.Debug.captureErrors()` recoge `window.onerror` y muestra un overlay con archivo/línea → el `tester` lo lee en una sola llamada. |
| R17 | **`localStorage` en `file://` y en `about:blank`** — puede lanzar `SecurityError` | Media / Bajo | `BS.Util.tryLocalStorageGet/Set` envuelven todo en `try/catch` y caen a un objeto en memoria. El juego nunca depende de la persistencia para funcionar. |
| R18 | **Rendimiento de CPU en el horneado** — AO por rayos en JS puede tardar segundos | Media / Medio | Presupuesto medido en `level.buildTimeMs`; `BS.Level.build` reduce automáticamente los rayos de AO (9 → 4 → 0) si el tiempo de horneado supera 80 ms, y muestra progreso en la pantalla de carga. |
| R19 | **Enemigos atravesando el suelo/paredes** por empujes o `dt` grande | Media / Alto | La física de enemigos usa exactamente `BS.Physics.moveBox` (mismo solver que el jugador, sweep por ejes) → sin tunelado. Tope de velocidad (12 m/s) y subpaso si `delta` supera el radio. |
| R20 | **Escalada de memoria** por crear voces/partículas sin reciclar | Media / Medio | Pools fijos: partículas (máx. 2000, reutilización circular), proyectiles (máx. 64), voces (24). Nada de `new` por frame en el hot path. |

---

## 7. Plan de rendimiento

### 7.1 Presupuesto por frame (objetivo 60 FPS en GPU integrada, 1280×720 con `resolutionScale 1.0`)

| Métrica | Presupuesto (high) | Presupuesto (`low`/software) |
|---|---|---|
| Triángulos | ≤ 130.000 | ≤ 55.000 |
| Draw calls | ≤ 90 | ≤ 45 |
| Tiempo de CPU del frame (JS) | ≤ 6 ms | ≤ 12 ms |
| Tiempo de GPU | ≤ 12 ms | ≤ 25 ms |
| Partículas vivas | ≤ 800 | ≤ 250 |
| Proyectiles vivos | ≤ 64 | ≤ 32 |
| Enemigos vivos | ≤ 20 | ≤ 14 |
| Luces dinámicas | 3 + linterna | 1 + linterna |
| Memoria de texturas | ≤ 6 MB | ≤ 2.5 MB |
| Memoria de geometría | ≤ 12 MB | ≤ 8 MB |

### 7.2 Reparto previsto de triángulos

| Elemento | Tris |
|---|---|
| Nivel estático (todo fusionado) | 45.000 – 80.000 |
| Props instanciados (cajas, barriles) | 6.000 |
| Enemigos (20 vivos × 1.200) | 24.000 |
| Viewmodel del arma | 1.500 |
| Partículas/cartuchos (800 quads) | 1.600 |
| Proyectiles (64 × 120) | 7.700 |

### 7.3 Estático vs dinámico

**Estático (nunca se re-sube):** geometría del nivel fusionada por (chunk × material) — horneado de luz, AO y máscara emisiva; props con `rotY` fijo; decorado. Se sube una vez en `build()` y se reconstruye solo tras `contextlost`.

**Dinámico (subida por frame o bajo demanda):**
- Partículas y trazadoras: **un único VBO dinámico** para todas (`DYNAMIC_DRAW`), 4 vértices + 6 índices por partícula, reconstruido con `bufferSubData` una vez por frame → **1 draw call** para todo el sistema de partículas.
- Viewmodel: matriz por frame (uniform), mesh estático.
- Enemigos/props/pickups/proyectiles: mesh estático, solo `uModel` cambia (1 draw call cada uno).
- Vetores de mirada/normales de la cámara: uniforms.

### 7.4 Reglas anti-`draw call`

1. Un mesh por (chunk × material), nunca por brush.
2. Los materiales del nivel se reducen a ≤ 12 en la misión.
3. Los enemigos usan **un solo material** (`mat_enemy_armor`) con variación por color de vértice + máscara emisiva → 1 draw call por enemigo, no 3.
4. Las armas: 1 mesh y 1 material por arma.
5. Las transparentes (cristal, humo, plasma) se agrupan por material y se dibujan de atrás a delante.

### 7.5 Presupuesto de construcción (una sola vez, en la pantalla de carga)

| Fase | Objetivo |
|---|---|
| Texturas procedurales (26 texturas + normales) | ≤ 450 ms |
| Geometría + horneado 1 | ≤ 500 ms |
| Colisionadores + rejilla + navNodes | ≤ 150 ms |
| Compilación de shaders | ≤ 60 ms |
| Mallas de enemigos/armas/pickups | ≤ 120 ms |
| **Total** | **≤ 1.300 ms** |

Medición obligatoria con `BS.Log.info` y expuesta en `BS.Debug.stats()`.

---

## 8. Convenciones obligatorias para los `developer`

1. **No tocar archivos de otro lote.** Si necesitas algo que no existe, añádelo en tu archivo o regístralo en `BS.Debug`.
2. **No cambiar firmas de este documento.** Si crees que una firma es incorrecta, **repórtalo al arquitecto** antes de divergir.
3. Todo recurso GL creado debe tener ruta de `dispose()`/`rebuild()`.
4. Todas las funciones públicas validan `ctx` de forma ligera y no lanzan en el caso normal; los fallos van a `BS.Debug.errors` y a `BS.Log.error`.
5. Nada de `setTimeout`/`setInterval` para lógica de juego (solo para cosas de UI tolerantes). Todo el tiempo viene de `dt`.
6. Números mágicos: fuera de `CONFIG`/`DEFS`/`Mission`. Nada de constantes sueltas en el bucle.
7. Cada módulo registra al menos un test en `BS.Debug.register('modulo:algo', fn)`.
8. Español para texto de UI y comentarios; identificadores en inglés.
9. `sandbox_*.html` correspondiente debe funcionar de verdad y servir para que el `tester` verifique el lote aislado.

---

## Supuestos y preguntas abiertas

**Supuestos (los asumo ciertos salvo que digas lo contrario):**
- El objetivo de FPS es 60 a 1280×720 con calidad automática; por debajo se degrada a 30 con calidad `low`.
- El juego es **monojugador, offline, sin persistencia esencial**; marcador y ajustes en `localStorage` si el navegador lo permite.
- Resolución de referencia del HUD: cualquier viewport ≥ 800×600; por debajo, el HUD escala con un factor.
- Los textos de la UI están en español.
- Un solo nivel (la misión K-7) con 5 oleadas; no hay editor de niveles en v1, pero `leveldata.js` es editable a mano.

**Preguntas abiertas menores (puedo decidirlas yo si no respondes):**
- ¿Tutorial como mapa aparte o como primera fase del nivel K-7? (Propongo: **primera fase del mismo nivel**, sin cambio de mapa.)
- ¿Dificultad seleccionable? (Propongo: `normal`/`hard`; `hard` = +30% HP enemigo, -25% munición, sin regeneración de vida.)
- ¿Regeneración de vida? (Propongo: **sí**, tras 6.5 s sin daño, a 9 PV/s, con tope del 60% del máximo; el resto solo con botiquines.)

---

## Tareas propuestas

> Tres lotes, tres invocaciones del agente `developer`. El **lote B y el C pueden empezar en paralelo con A** si el developer respeta estrictamente las firmas: los `ctx.*` que aún no existen se usan solo dentro de `update()`, nunca en `create()`.

### LOTE A — Núcleo del motor, GL, render y FX
**Archivos exactos:** `js/core/util.js`, `js/core/debug.js`, `js/core/gl.js`, `js/core/input.js`, `js/core/audio.js`, `js/core/textures.js`, `js/render/shaders.js`, `js/render/mesh.js`, `js/render/renderer.js`, `js/render/fx.js`, `sandbox/sandbox_a.html`.
**Depende de:** nada (es la base).
**Debe respetar:** §3.0–§3.9 al detalle, en especial el **formato de vértice de 36 bytes** y las **localizaciones de atributo fijas 0..3**.

Tareas:
1. `util.js`: `BS.Math` completo (v3/m4/aabb/intersecciones/determinismo), `BS.Util`, `BS.Events`, `BS.RNG`, `BS.Log`. **Verificación:** `BS.Debug.runAll()` con tests de `rayAABB`, `m4perspective`, `m4invert` (producto ≈ identidad con error < 1e-4).
2. `debug.js`: `BS.Debug` completo, incluidos `state()`, `look()`, `key()`, `stepFrames()`, `setQuality()`, `runAll()`, `captureErrors()`. **Verificación:** `BS.Debug.state()` devuelve un objeto sin lanzar incluso antes de que exista `BS.Game`.
3. `gl.js`: `BS.GL` con `init`, `createProgram` (introspectivo + `bindAttribLocation`), uniform helpers, meshes, texturas, framebuffers (renderbuffer, nunca depth texture), caché de estado, y los eventos de context lost/restored. **Verificación:** `caps` relleno; `createProgram` con un shader trivial compila.
4. `mesh.js`: `BS.Mesh.Builder` con todas las primitivas (§3.3), respetando stride 36 y escritura de `aColor.rgb/a`. **Verificación:** `BS.Mesh.builder.box(...)` produce `indexCount` y `aabb` correctos; el conteo de vértices coincide con `indices/3`.
5. `shaders.js`: los 4 programas con **nombres de uniform exactos**, luces desenrolladas (sin bucles con índice variable), `aColor.a` como máscara emisiva, fog exp2, iluminación hemisférica, linterna spot con atenuación suave y `smoothstep` de cono. **Verificación:** los 4 compilan en WebGL1 y WebGL2 (probar `BS.GL.caps.isWebGL2` en ambos casos si es posible).
6. `renderer.js`: `BS.Renderer` con `push/flush/present`, culling por frustum, rejilla de ordenación por material, pase de viewmodel con depth clear, postFX opcional, `getCameraRay`, `stats`, auto-ajuste de `resolutionScale`. **Verificación:** `sandbox_a` dibuja ≥ 200 cajas con ≤ 12 draw calls y `stats.drawCalls` correcto.
7. `textures.js`: generación determinista (semilla fija) de las 26 texturas + normales + máscaras emisivas y el catálogo de materiales con IDs congelados. **Verificación:** dos ejecuciones producen canvas idénticos (hash de `getImageData` sobre una muestra de píxeles).
8. `input.js`: teclado/mouse por `code`, Pointer Lock robusto (promesa + fallback + `pointerlockerror`), `simulateKey/simulateMouseDelta`, `clearAll()` en blur/visibility/lockchange. **Verificación:** `BS.Debug.press('KeyW')` mueve al jugador en el lote B.
9. `audio.js`: AudioContext perezoso, buses, catálogo procedural completo (38 nombres), `Voice` con `stop/setPosition/setVolume`, presupuesto de voces, atenuación manual + `StereoPanner`. **Verificación:** `BS.Audio.play('pistol')` tras un gesto devuelve un `Voice` con `isPlaying() === true`; sin gesto, devuelve algo pero el estado del contexto queda `suspended` y se informa.
10. `fx.js`: pool de partículas, quads aditivos en VBO dinámico (**1 draw call**), trazadoras, flashes de boca, impactos por material, `tempLight`, shake. **Verificación:** 600 partículas vivas → `stats.drawCalls` sube exactamente 1.
11. `sandbox_a.html`: escena de prueba con un pasillo de 30 cajas texturizadas, linterna, 3 luces, fog exp2, un cubo con normal map girando, partículas y un botón de audio. Sin `fetch`, sin módulos.
12. **Medición obligatoria** de los tiempos de §7.5 en `sandbox_a` y reportarlos.

### LOTE B — Nivel, física, jugador, armas, proyectiles, pickups
**Archivos exactos:** `js/world/leveldata.js`, `js/world/level.js`, `js/world/physics.js`, `js/entities/player.js`, `js/entities/weapons.js`, `js/entities/projectiles.js`, `js/entities/pickups.js`, `sandbox/sandbox_b.html`.
**Depende de (interfaces de A, ya congeladas):** `BS.Math`/`BS.Util`/`BS.Events`, `BS.GL`, `BS.Mesh`, `BS.Renderer.push/pushViewmodel/setFlashlight/setFog/setAmbient/getCameraRay`, `BS.Textures.getMaterial`, `BS.Input`, `BS.Audio.play/loop/setListener`, `BS.FX.*`, `BS.Debug`.
**Depende de (interfaces de C):** `ctx.combat.raycast/damage/areaDamage/noise`, `ctx.hud.*`, `ctx.menu.*`, `ctx.enemies.raycast`. Todo esto se usa **solo en tiempo de ejecución**, con guardas `if (ctx.X)`.
**Debe respetar:** §3.10–§3.16 y §4 exactos.

Tareas:
1. `physics.js`: `moveBox` con sweep por ejes, step-up 0.45 m, rampas analíticas, suelo/techo, `raycast` contra la rejilla, `raycastAABBList`, `sweepAABBvsAABB`, `resolveOverlaps`. **Verificación (test en `BS.Debug`):** (a) una caja cayendo desde y=10 aterriza en y = suelo exacto ±0.01 y `onGround=true`; (b) caminar contra una pared no atraviesa; (c) subir un peldaño de 0.3 m funciona y uno de 0.6 m no; (d) a 7 m/s con dt 1/60, 100 pasos contra una pared de 0.2 m de grosor → 0 atravesamientos.
2. `leveldata.js`: misión K-7 completa y jugable: ≥ 6 salas conectadas por pasillos, coberturas, 5 oleadas, spawns, pickups, objetivos, landmarks, ~250–500 brushes. **Verificación:** `BS.Level.build` consume los datos sin errores y `level.bounds` es coherente.
3. `level.js`: construcción, troceado en chunks de 12 m, horneado de luz + AO con presupuesto de tiempo, colliders (box/ramp/escaleras), rejilla hash de 4 m, navNodes, `groundHeightAt`, `isInsideLevel`, `rebuild`, `dispose`. **Verificación:** ≤ 65.000 vértices por mesh; `buildTimeMs` ≤ 700 ms; 200 raycasts aleatorios no lanzan y dan resultados coherentes.
4. `player.js`: movimiento completo (WASD, sprint, crouch con altura interpolada, salto con coyote time y jump buffer, bob, land impact, FOV de sprint, roll al desplazarse lateralmente), cámara con Pointer Lock, daño con invulnerabilidad y dirección, curación, muerte, `respawn`, shake, retroceso. **Verificación:** recorrer el nivel entero sin atravesar ni caer; el jugador nunca queda atrapado en las esquinas.
5. `weapons.js`: 3 armas con `DEFS` completos, sistema de spread acumulativo, retroceso, recarga cancelable, cambio de arma con animación, viewmodel procedural (malla propia de cada arma generada con `BS.Mesh`), muzzle flash, cartuchos, hitmarker vía `ctx.hud`. **Verificación:** la secuencia canónica de disparo de §3.14 se ejecuta sin errores; tras 3 s de fuego automático la munición cuadra exactamente con `rpm`.
6. `projectiles.js`: pool de 64, subpaso, colisión con mundo y entidades, splash con caída lineal, guiado suave, rastro, luz temporal. **Verificación:** 40 proyectiles disparados a 40 m/s contra una pared de 0.2 m → 0 atravesamientos; el splash daña a enemigos dentro del radio y no al jugador si está fuera.
7. `pickups.js`: los 7 tipos de `KINDS`, bob y rotación, recogida por AABB, reglas de "no consumir si no aporta", respawn por oleada. **Verificación:** recoger munición llena una reserva parcial y no la desborda.
8. `sandbox_b.html`: recorrer el nivel con la linterna, disparar las 3 armas contra dianas de prueba (cajas con `ctx.debug`), probar pickups y colisiones. Enemigos sustituidos por dianas estáticas simples para no depender del lote C.
9. Reportar a `BS.Debug` los tests: `physics:*`, `level:build`, `weapons:fire`, `projectiles:tunnel`, `player:reachability`.

### LOTE C — Enemigos, HUD, menús, bucle de juego, oleadas, integración
**Archivos exactos:** `js/entities/enemies.js`, `js/ui/style.js`, `js/ui/hud.js`, `js/ui/menu.js`, `js/game/game.js`, `js/main.js`, `index.html`, `sandbox/sandbox_c.html`.
**Depende de (interfaces de A y B, todas congeladas):** todo `BS.*` de §3. Sin excepciones, sin cambios.
**Debe respetar:** §3.17–§3.22, §4.1 (`waves`), §5, §6 y §7.

Tareas:
1. `style.js`: CSS completo (menús, botones, sliders, HUD, overlays, pantallas de muerte/victoria, avisos) inyectado en `<head>`. Estética: monoespaciada, cian/ámbar sobre negro, scanlines sutiles, `user-select:none`.
2. `hud.js`: Canvas2D con salud, munición (cargador/reserva), enemigos restantes, oleada, objetivo actual, mira dinámica, hitmarker, indicador direccional de daño, viñeta de vida baja, kill feed, subtítulos, prompts de interacción, barra de jefe, tutorial paso a paso, overlay F1 de debug. **Verificación:** legible a 1024×768 y a 1920×1080; el hitmarker aparece exactamente en el frame del impacto.
3. `menu.js`: DOM completo (principal, ajustes, controles, tutorial, pausa, muerte, victoria, carga), sliders de sensibilidad/volumen/FOV/escala de resolución, selector de calidad, persistencia con `try/catch`, `showMessage` para errores de pointer lock. **Verificación:** todos los ajustes surten efecto inmediatamente; el menú funciona sin Pointer Lock activo.
4. `enemies.js`: las 3 mallas procedurales, los 3 tipos con sus `DEFS`, FSM completa, percepción (visión por cono + raycast de LOS, oído por eventos `'noise'`), persecución con anti-atasco, ataques (proyectil, garra, slam con onda), daño con `stagger`, muerte con parpadeo y colapso, escalado por oleada, `boss prime`. **Verificación:** spawn de 20 enemigos y el juego se mantiene ≥ 30 FPS en calidad `low`; 5 enemigos en una habitación con un pilar rodean el obstáculo en ≤ 3 s; un enemigo disparado por la espalda se gira.
5. `game.js`: `ctx`, mediador `ctx.combat`, máquina de estados, paso fijo con acumulador, oleadas y objetivos, victoria/derrota, checkpoints, pausa automática por pérdida de pointer lock y por `visibilitychange`, reacciones a context lost, `applySettings` en vivo, `restartCheckpoint/restartMission`. **Verificación:** `BS.Debug.stepFrames(300)` reproduce siempre la misma posición final del jugador con el mismo input simulado.
6. `main.js` + `index.html`: bootstrap, `<div id="bs-root">` + 23 `<script>` en el orden exacto, `<noscript>`.
7. `sandbox_c.html`: juego completo (copia de la estructura de `index.html`).
8. `BS.Debug.register` para: `game:states`, `waves:all`, `enemies:ai`, `hud:hitmarker`, `menu:settings`. `BS.Debug.runAll()` debe devolver todos los tests (A+B+C) en un solo array.
9. Pasar el juego completo al agente `tester` con la lista de comprobaciones: arranque en `file://`, los 9 estados, 5 oleadas hasta victoria, muerte y reinicio, las 3 armas, los 3 enemigos, ajustes, y `BS.Debug.runAll()` sin fallos.

**Orden de entrega recomendado:** A → (B y C en paralelo) → integración y pruebas del `tester` → correcciones.

---

## Decisiones que necesito de ti

1. **Lenguaje y textos:** ¿confirmas interfaz y textos en **español** (con identificadores en inglés), o los quieres en inglés?
2. **Tercer arma:** mi propuesta es **PISTOL (hitscan semi) + SMG (hitscan auto) + «ARC-12 BREACHER» (6 perdigones de plasma por proyectil con salpicadura)**, para que en manos del jugador haya hitscan **y** proyectiles. ¿La apruebas, o prefieres una escopeta hitscan clásica (más sencilla, un poco menos vistosa) o un arma tipo railgun?
3. **Tutorial:** ¿como **primera fase del nivel K-7** (mi propuesta, sin mapa extra) o como pantalla de controles + primera oleada simplificada?
4. **Regeneración de vida:** ¿la apruebas (visible tras 6.5 s sin daño, hasta el 60% del máximo, con botiquines para el resto) o prefieres vida solo por botiquines (más tenso, más castigo al fallar)?
5. **Dificultad:** ¿quieres selector `normal`/`hard` (propuesta), o un único nivel de dificultad fijo?
6. **Presupuesto de la misión:** ¿acepto **~1.3 s de carga inicial** (texturas + nivel + horneado) con pantalla de carga, o prefieres sacrificar calidad (AO horneado apagado, texturas a 128) para bajar de 700 ms?
7. **`resolutionScale` por defecto:** ¿lo dejo en **1.0 con autoajuste dinámico** (mi propuesta), o prefieres arrancar conservador en 0.8 para garantizar el framerate en la máquina de desarrollo?
8. **`preserveDrawingBuffer: true` por defecto:** lo propongo por fiabilidad de las capturas del `tester` (coste mínimo). ¿Alguna objeción?
9. **Post-proceso:** 1 pasada de composición (viñeta + tinte de daño + scanlines + grano) **activada por defecto en calidad `high`/`medium`** y desactivada en `low`/software. ¿De acuerdo, o lo prefieres siempre desactivado por defecto?
10. **Persistencia:** ¿te vale guardar ajustes y mejores puntuaciones en `localStorage` con degradación silenciosa a memoria si el navegador lo bloquea en `file://`?