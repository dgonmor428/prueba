# Informe de pruebas — BLACKSITE: LAST SIGNAL

Este informe lo escribe el agente **`tester`** a partir de la **evidencia medida**
en un **navegador real** (WebGL 2.0, ANGLE D3D11 sobre **Intel UHD Graphics 770**,
canvas 1000×700). Todo lo que aparece como «OK» o con una cifra ha sido
**medido**; lo que no se ha podido probar queda marcado explícitamente en
[§6](#6-qué-no-se-pudo-probar). No se ha modificado ningún archivo de código ni
ningún test: solo se ha escrito este documento.

> **Nota (posterior):** este informe documenta la **fase 1** (28 auto-tests). Tras
> él se corrigieron dos bugs reportados por un usuario y se añadieron 4 tests de
> regresión (**32/32**). Esa segunda fase se documenta en `docs/FIX-TEST-REPORT.md`
> y en `docs/FIX-REPORT.md`; además, en ella se pudo cargar el `index.html` **real
> como `file://`** (§1 deja de aplicar a esa fase).

---

## 1. Método de prueba (cómo se probó sin poder abrir `file://`)

La herramienta de navegador **rechaza** navegar a `file://`
(ver `docs/HARNESS.md` §1). Para reproducir las condiciones exactas de
`file://` (sin servidor, sin `fetch`, sin módulos ES) se hizo lo siguiente:

1. Se creó una pestaña `about:blank` con una **zona de soltado**.
2. Se cargaron los **23 archivos `.js`** del proyecto mediante
   `browser.files.drop` sobre esa zona.
3. La página los leyó con `FileReader` y los **inyectó como `<script>`
   clásicos**, en el **orden exacto de `index.html` §2.1** (`main.js` el último).
4. El juego se condujo con la API de depuración `BS.Debug`
   (`runAll`, `teleport(x,y,z)`, `lookAt(x,y,z)`, `spawnEnemy`, `giveWeapon`,
   `stats`) y avanzando fotogramas con `BS.Game.frame(ms)` (reloj
   **monótono creciente**, requisito detectado en pruebas previas).
5. La verificación **visual** se hizo con `tools/frame_probe.js`
   (`readPixels`/`drawImage` del canvas 3D sobre un canvas reducido + miniatura
   ASCII), porque `browser.screenshot` exige una ventana visible.

Esta inyección **replica** las condiciones de `file://` (nada de `fetch`,
módulos, ni recursos externos; un único global `window.BS`; todo el arte
procedural), pero **no es literalmente** abrir el archivo con doble clic desde
el Explorador (ver §6).

**Resultado del arranque (medido):** inyección de los **23 scripts con 0
errores**; arranque **sin parches** con `Main.ready === true`, estado `menu`,
contexto WebGL creado, calidad `high` y **0 errores capturados** por
`BS.Debug.errors`.

---

## 2. Auto-tests: resultado 28/28

`BS.Debug.runAll()` ejecuta los tests que cada módulo registra en
`BS.Debug.register('modulo:algo', fn)` (convención §8.7 del contrato).
Estado **actual: 28 registrados, 28 pasan**.

| # | Test | Módulo | Qué comprueba (leído del código) | Resultado |
|---|---|---|---|---|
| 1 | `math:rayAABB` | `core/util.js` | Intersección rayo/AABB: acierta a `t=5`, falla devuelve `-1`, origen dentro devuelve `0`; y `raySegmentAABB` da `t=0.5`. (Antes **no se registraba**.) | ✅ |
| 2 | `math:matrixInvert` | `core/util.js` | `proj × view` invertida → producto ≈ identidad con error < 1e-4. (Antes **no se registraba**.) | ✅ |
| 3 | `debug:noThrow` | `core/debug.js` | `state()`, `stats()` y `report()` nunca lanzan; `state()` expone `hp` numérico. | ✅ |
| 4 | `gl:caps` | `core/gl.js` | Hay contexto WebGL; `maxTextureSize ≥ 256`; `STRIDE === 36`; localizaciones de atributo `POS=0, NORMAL=1, UV=2, COLOR=3` intactas. | ✅ |
| 5 | `gl:trivialProgram` | `core/gl.js` | Compila un programa trivial; `aPos` queda en location `0`; un uniform inexistente devuelve `null`; se omite si no hay contexto. | ✅ |
| 6 | `input:simulate` | `core/input.js` | `simulateKey` registra `isDown`/`wasPressed`; `endFrame` limpia el flanco pero **no** el estado mantenido; el soltado registra `wasReleased`; `simulateMouseDelta`/`consumeMouseDelta` dan el delta correcto y lo resetean. | ✅ |
| 7 | `audio:catalog` | `core/audio.js` | Los **39** nombres tienen receta; cada capa es válida por tipo (`osc`→`f0>0`, `noise`→`rate>0`, `am`→`freq>0`; `dur`/`gain` solo a `osc`/`noise`); firmas **únicas** (sin duplicados); nombres únicos. | ✅ |
| 8 | `textures:determinism` | `core/textures.js` | Dos generaciones con la misma semilla dan **píxeles idénticos** (mismo hash); el ruido no es constante (rango > 40); catálogo completo; forma de material válida (`uvScale`, `specular`, `blend`, `program`). | ✅ |
| 9 | `shaders:uniforms` | `render/shaders.js` | Las fuentes `basic`/`post`/`sprite` contienen **todos** los uniforms requeridos (buscando en `vs` y `fs`); sin `#version`; GLSL legacy; sin placeholders `{{`; sin bucles `for` en el `fs` básico. | ✅ |
| 10 | `mesh:stride` | `render/mesh.js` | `stride === 36` y `byteLength === vertexCount × 36`; índices dentro de rango; posición del primer vértice del `box` `(0.5,-1,1.5)`; color `(128,64,255,128)`; normal `+X`; AABB correcta; UV. | ✅ |
| 11 | `renderer:drawcalls` | `render/renderer.js` | 5 opacos + 2 transparentes + 1 viewmodel → **8 draw calls**; fuera del frustum → **0**; 8 cajas = 96 triángulos. | ✅ |
| 12 | `fx:singleDrawCall` | `render/fx.js` | 25 partículas → **1** draw call; sin partículas → **0**. | ✅ |
| 13 | `level:build` | `world/level.js` | Construye el nivel real: chunks, colisionadores y rejilla hash; ≤ 65535 vértices/chunk; **sin** `normalMap`/`normalStrength`; texturas resueltas (sin `strings`); colisionadores finitos y no invertidos; suelo en spawn y landmarks; spawn dentro del nivel; ≥ 3 spawns de enemigos, ≥ 5 pickups, ≥ 3 objetivos; **5 oleadas**. | ✅ |
| 14 | `physics:landing` | `world/physics.js` | Caída y aterrizaje sin hundirse (`feet ≈ 0`); sigue apoyado tras empujar hacia abajo. | ✅ |
| 15 | `physics:wall` | `world/physics.js` | Choque contra muro: se detiene antes, **no** lo atraviesa, normal `+X`; el rayo se detiene en `t=7.5`. | ✅ |
| 16 | `physics:step` | `world/physics.js` | Sube un peldaño de 0.4 m, avanza y sigue apoyado; una repisa de **0.80 m NO** se puede subir. | ✅ |
| 17 | `physics:noTunnel` | `world/physics.js` | A 100 m de desplazamiento no atraviesa el muro (queda entre x 19 y 20); rayo a 400 m/s se detiene en `t=4.0`; separación de cuerpos muta in situ; `groundCheck` coherente. | ✅ |
| 18 | `projectiles:noTunnel` | `entities/projectiles.js` | Un proyectil a velocidad altísima **no** atraviesa un muro fino (subpaso) y sí alcanza al enemigo. | ✅ |
| 19 | `weapons:fire` | `entities/weapons.js` | Secuencia canónica: `raycast`, `damage`, `hitmarker`, `impact`, `fire` y `tracer` se invocan; y la munición de 3 s de fuego automático cuadra con el `rpm`. | ✅ |
| 20 | `player:reachability` | `entities/player.js` | Muestrea la ruta del nivel: suelo finito y a la altura declarada, peldaños ≤ `stepHeight+0.05`, espacio libre sobre la cabeza. Tras corregir la ruta: **1087 muestras sin problemas**. | ✅ |
| 21 | `pickups:noOverflow` | `entities/pickups.js` | Desborde del pool (30 descartados); con munición llena **no** se consume; con hueco **sí** (emite evento y sonido); las armas se entregan una vez y luego pasan a reserva. | ✅ |
| 22 | `enemies:ai` | `entities/enemies.js` | HP base por tipo; el `raycast` alcanza al drone; daño normal íntegro; punto débil mata al drone; el stalker muere con headshot; contadores `aliveCount`; `areaDamage`; FSM: el drone ve al jugador y llega a `chase`. | ✅ |
| 23 | `style:inject` | `ui/style.js` | CSS inyectado en `<head>`, > 2000 bytes, con todas las clases requeridas (`bs-panel`, `bs-btn`, …) y `CLASS` completo. | ✅ |
| 24 | `hud:hitmarker` | `ui/hud.js` | El hitmarker se activa y **expira**; `showDamage` expira; `notify`/`setObjective`/`setSubtitle`/`setPrompt`/`setWaveText`/`setBossBar`/`setTutorial`/`killFeedLine`/crosshair; `snapshot()` y `state()` coherentes; `render()` no lanza sin canvas real. | ✅ |
| 25 | `menu:settings` | `ui/menu.js` | `getSettings()` tiene todas las claves del contrato; `applySettings` surte efecto (fov, quality, volumen, dificultad); la persistencia es tolerante (no propaga errores en `file://`); navegación `show`/`current`; `state()` con todas las pantallas. | ✅ |
| 26 | `game:states` | `game/game.js` | Existen los **9 estados** (`boot, loading, menu, tutorial, playing, paused, dead, victory, error`); transiciona correctamente y **rechaza** un estado inválido. | ✅ |
| 27 | `waves:all` | `game/game.js` | 5 oleadas; `maxAlive` dentro de 1..20; escalado de `Enemies` `min(8+2w,20)` → `10`/`18`; los disparadores se cumplen por objetivos; `buildWaves` → 5. | ✅ |
| 28 | `game:determinism` | `game/game.js` | Con el mismo input (avanzar con `KeyW` 120 pasos) la posición final coincide (error < 1e-6). Si no hay jugador, se omite. | ✅ |

> **Antes de la corrección de la Fase 5** el estado era: **20 pasaban y 6
> fallaban** por expectativas erróneas (`audio:catalog`, `shaders:uniforms`,
> `mesh:stride`, `physics:noTunnel`, `player:reachability`, `hud:hitmarker`) y
> los dos tests `math:*` **ni siquiera se registraban**. Ahora son **28/28**.

---

## 3. Evidencia funcional medida

Todas las cifras siguientes se midieron en el navegador real descrito en §1.

### 3.1 Arranque e infraestructura
- Inyección de los **23 scripts: 0 errores**.
- Arranque **sin parches**: `Main.ready=true`, estado `menu`, `ctx` creado,
  calidad `high`, **0 errores capturados**.
- Nivel: **111 chunks** construidos (con `CHUNK=32`).

### 3.2 Render
- **Draw calls / triángulos por posición** (calidad `high`):

  | Posición | draw calls | triángulos |
  |---|---|---|
  | Spawn | 87 | 8 160 |
  | Atrio | 86 | 7 116 |
  | Pasillo +24 | 71 | 6 540 |
  | Sur | 9 | 1 604 |
  | Este | 35 | 2 936 |
  | Sala de control | 27 | 1 900 |

- **Máximo 87 ≤ 90** (presupuesto §7.1 en calidad `high`).
- `frameMs` ≈ **0.6–0.7 ms**.
- **Viewmodel del arma visible**: 1 draw call extra; al sustituir
  `renderViewmodel` por una función vacía cambian **226 de 3 200** celdas
  muestreadas → el arma **sí** se pinta.

### 3.3 Iluminación (el «arreglo del ambiente duplicado»)
- **Linterna**: al forzar `on:false` cambian **675/3 200** celdas; la luminancia
  del centro pasa de **0.0723** con linterna a **0.0514** sin ella (**×1.41**).
- **Luminancia media de escena**: **0.075–0.11** (antes del arreglo del ambiente
  duplicado era **0.017**).

### 3.4 Jugador y movimiento
- Velocidad a pie: **≈ 4.3 m/s**.
- **Muerte**: `player.damage(500)` → `died:true`, `hp 0`, estado `dead`,
  `isDead=true`.
- **Reinicio**: `Game.restartMission()` → estado `playing`, `hp 100`, posición de
  aparición **(0, 0.9, 19)**.

### 3.5 Armas
- Disparo: cargador **12 → 11**; recarga → **12**.
- La **ranura 2 está bloqueada al inicio**: `switchTo(2)` devuelve `false`.
- Tras `giveWeapon(2)` / `giveWeapon(3)`:
  - slot 1 = **MK-7 "VECTOR"**
  - slot 2 = **VK-9 "HORNET"**
  - slot 3 = **AR-12 "ALCOTÁN"**

### 3.6 Enemigos, oleadas y estados de partida
- **IA**: 2 enemigos cerca del jugador → PV **100 → 78 → 56 → 12 → 0** en
  ~12 s (detectan, persiguen y atacan).
- **Oleadas**: al llegar al atrio arranca la **oleada 0 `active` con 6
  enemigos**.
- **Victoria**: 5 oleadas; la última con `victoryOnClear`; al despejarla el
  estado pasa a **`victory`** y `checkVictory()` es `true`.
- **Tutorial**: `Game.start(true)` → estado **`tutorial`**.
- **Pausa/reanudar**: → `paused` / `playing`.

---

## 4. Defectos encontrados y **corregidos en la Fase 5**

Los siguientes defectos estaban confirmados en la evidencia previa
(`docs/TEST-LOG.md`) y **quedaron corregidos** antes de esta medición final. Parte
los aplicó el agente `developer` y, cuando este agotó su límite de tasa, el resto
los aplicó **directamente el orquestador** (se declara con transparencia en
`README.md` §6). En ambos casos se re-verificó todo desde cero en el navegador:

| Defecto (antes) | Estado tras la corrección | Evidencia medida |
|---|---|---|
| **El juego no arrancaba**: `BS.Main.init` lanzaba `Game.isLowQuality is not a function` (llamadas en `game.js` a una función inexistente). | **Arranca en limpio** | `Main.ready=true`, estado `menu`, `ctx` creado, calidad `high`, 0 errores. |
| **El arma (viewmodel) no se dibujaba**: `renderViewmodel` era un stub vacío y nadie lo llamaba. | **El viewmodel se pinta** | 1 draw call extra; al anularlo cambian **226/3 200** celdas. |
| **No se podía reiniciar tras morir**: `restartMission()` dejaba el estado en `dead`. | **Reinicio operativo** | `restartMission()` → estado `playing`, `hp 100`, spawn **(0, 0.9, 19)**. |
| **6 auto-tests fallaban** por expectativas erróneas (`audio:catalog`, `shaders:uniforms`, `mesh:stride`, `physics:noTunnel`, `player:reachability`, `hud:hitmarker`). | **Pasan los 6** | 20/26 → **28/28**. |
| **`util.js` no registraba los tests `math:*`** (cargaba antes que `debug.js`, así que `BS.Debug` no existía). | **Se registran** | Se encolan en `BS._pendingTests` y `debug.js` los vuelca al publicarse → `math:rayAABB` y `math:matrixInvert` presentes. |
| **`player:reachability` fallaba 1 muestra** al rozar 3 cm la esquina de un panel bajo. | **Ruta corregida** | **1087 muestras sin problemas**. |
| **Escena muy oscura**: luminancia media ≈ **0.017** (ambiente duplicado). | **Iluminación corregida** | Luminancia media **0.075–0.11**. |
| **Presupuesto de draw calls excedido**: **150 draw calls** con solo 5 708 triángulos (> 90 de §7.1). | **Dentro de presupuesto** | Máximo **87 ≤ 90** por posición. |
| **Nombre de arma del README incorrecto**: el subfusil es **`VK-9 "HORNET"`**. | README corregido | Confirmado en el juego: slot 2 = `VK-9 "HORNET"`. |

---

## 5. Verificación visual (píxeles, sin captura de pantalla)

Como `browser.screenshot` exige una ventana visible, la comprobación visual se
hizo por **píxeles** con `tools/frame_probe.js`:

- **Miniatura ASCII** del canvas 3D (48×24) para confirmar que hay **geometría**
  y no una pantalla negra ni un color plano.
- **Luminancia media / desviación / proporción de píxeles no negros / tonos
  distintos** de la rejilla reducida.
- **`coneCheck()`** para la linterna: el centro de la pantalla debe estar más
  iluminado que los bordes (se midió centro 0.0723 vs 0.0514 sin linterna).
- **Comparación de fotogramas por celdas**: `renderViewmodel` (**226/3 200**) y
  linterna `on/off` (**675/3 200**) demuestran que ambos elementos **afectan a
  la imagen renderizada**.

---

## 6. Qué **no** se pudo probar

Estos puntos **no** se pudieron verificar en este entorno y quedan como
limitación conocida del método (no del juego):

1. **Apertura literal de `file://` con doble clic.** La herramienta de navegador
   **rechaza** `file://`. La prueba se hace inyectando los mismos archivos como
   `<script>` clásicos en `about:blank`, que **replica** las condiciones
   (sin `fetch`, sin módulos, un solo global, arte procedural) pero **no es
   literalmente** el protocolo `file://`.
2. **Pointer Lock real con ratón físico.** No hay gesto de usuario real, así que
   el bloqueo del ratón y el giro con ratón físico no se ejecutaron: los eventos
   se inyectaron por API (`BS.Input.simulateKey` / `simulateMouseDelta`).
3. **`browser.screenshot`.** Requiere una ventana visible: la verificación visual
   se hizo por píxeles/ASCII (ver §5).
4. **Calidad del sonido «de oído».** Se comprobó que el **contexto de audio está
   `running`** y que hay **voces activas**, pero **no** se ha escuchado la
   fidelidad del sonido.
5. **Pruebas de larga duración / fugas de memoria y otras GPU o navegadores.**
   Solo se probó en **un equipo**: **Intel UHD 770** con motor basado en
   **Chromium** (ANGLE D3D11). No se cubren otras GPU ni otros navegadores.

---

## 7. Resumen

- **Auto-tests: 28/28** en un navegador real (WebGL 2.0, Intel UHD 770).
- **Arranque limpio**, arma visible, linterna y ambiente correctos, dentro del
  presupuesto de render (≤ 90 draw calls), movimiento, armas, enemigos, oleadas,
  muerte, reinicio, victoria y tutorial **funcionan**.
- Los **9 defectos de la Fase 5** (incluido el arranque bloqueado y los 6
  auto-tests) están **corregidos** y verificados.
- Las **5 limitaciones** de §6 son del **método de prueba** (herramienta de
  navegador y hardware único), no del juego.
