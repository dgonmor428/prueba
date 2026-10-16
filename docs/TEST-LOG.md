# Registro de pruebas reales — BLACKSITE: LAST SIGNAL

Evidencia recogida por el **orquestador** ejecutando el juego en un **navegador
real** (WebGL 2.0, Intel UHD Graphics 770 vía ANGLE D3D11), no por inspección de
código. Todo lo que aparece aquí como «OK» se ha **medido**; lo que no se ha
podido probar aparece marcado como tal.

> **Nota:** este documento es el registro **histórico** de las primeras fases
> (incluidos los fallos que se encontraron entonces). El informe final
> consolidado y re-verificado **después** de la Fase 5 está en
> **`docs/TEST-REPORT.md`**, y el resumen para el lector en `README.md` §6.

## 1. Método (cómo se ha probado sin poder abrir `file://`)

1. Se carga la lista de archivos del proyecto en una pestaña `about:blank`
   mediante `browser.files.drop` sobre un elemento interactivo (los refs solo se
   asignan a elementos interactivos) y se leen en la página con `FileReader`.
2. Se inyectan como `<script>` clásicos **en el orden exacto de §2.1**.
3. Se conduce el juego con `BS.Debug` (`startGame`, `key`, `press`,
   `simulateMouseButton`, `stepFrames`, `teleport`, `lookAt`, `spawnEnemy`,
   `giveWeapon`, `runAll`) y con `BS.Game.frame(ms)` para forzar fotogramas.
4. Se verifican los píxeles con `tools/frame_probe.js` (`readPixels`/`toDataURL`
   vía un canvas reducido), porque `browser.screenshot` exige que la ventana del
   escritorio esté visible.

Detalle importante del arnés: **`BS.Debug.stepFrames()` simula pero no dibuja**
(los `drawCalls` quedan a 0), y `BS.Game.frame(ms)` exige un reloj
**monótono creciente**: si se repite la misma marca de tiempo, `dt` no avanza y
el jugador no se actualiza. Esto produjo dos **falsos positivos** que se
descartaron (ver §4).

## 2. Resultado: lo que funciona (medido)

| Comprobación | Resultado medido |
|---|---|
| Carga de los 23 scripts | **Sin un solo error de sintaxis**; los 27 namespaces `BS.*` existen |
| Creación de contexto y DOM | 2 canvas, `#bs-root` con 3 hijos |
| Construcción del nivel | 271 chunks, 501 colisionadores, 25 props, **100 luces estáticas**, 7 zonas; límites X −52…100, Z −56…25 |
| Generación de texturas | 134 ms |
| Movimiento a pie | 8,613 m en 120 pasos (2 s) ≈ **4,3 m/s** (coincide con `walkSpeed` 4.4) |
| Suelo | `isGrounded = true`, el jugador se asienta sin caer |
| HUD | Lee estado real: `PV=100/100 MUN=12/60 (MK-7 "VECTOR") ENEM=0 OBJ="LLEGA AL ATRIO CENTRAL"` |
| Audio | Contexto en `running`; se registran voces activas (pasos) |
| Render | **150 draw calls, 5.708 triángulos** por fotograma |
| Linterna (arreglo del lote A) | Centro **4,8×** más brillante que los bordes → cono correcto |
| Disparo (pistola) | 3 disparos, cargador 12 → 9 |
| Disparo (SMG automática) | Vacía el cargador de 24, **33 disparos** acumulados |
| Efectos | 33 partículas activas tras disparar |
| Cambio de arma | `switchTo(2)` → `smg`; `switchTo(3)` → `breacher` |
| Recarga | Cargador 9 → 12, reserva 117 |
| Oleadas | Al llegar al atrio arranca la **oleada 0 con 6 enemigos** |
| Objetivos | Avanza solo: `LLEGA AL ATRIO CENTRAL` → `RESTAURA LA ENERGÍA EN LA SALA DE CONTROL` |
| IA de enemigos | 3 tipos creados (drone/stalker/brute); los 9 vivos atacan: **jugador a 78/100** |
| Muerte de enemigos | Daño aplicado → baja el contador, `kills = 1` |
| **Victoria** | Limpiar las 5 oleadas → estado **`victory`**, **51 bajas** |
| **Tutorial** | `Game.start({tutorial:true})` → estado **`tutorial`** |
| Pausa | `pause()`/`resume()` cambian de estado correctamente |
| **Muerte del jugador** | Daño letal → `hp = 0`, `isDead = true`, estado **`dead`** |
| Auto-tests | **26 registrados, 20 pasan, 6 fallan** |

## 3. Defectos confirmados

### Críticos (bloquean requisitos)
1. **El juego no arranca en limpio.** `BS.Main.init` lanza
   `Game.isLowQuality is not a function`: `game.js:313` y `:1398` llaman a
   `Game.isLowQuality()` y esa función **no existe** (solo existe
   `ctx.isLowQuality` en `game.js:766`). Con un parche en la página el arranque
   completa, lo que demuestra que es el **único** bloqueo de arranque.
2. **El arma no se dibuja.** `game.js:183` declara
   `renderViewmodel: function () { }` como **stub vacío** y nadie llama a
   `weapons.renderViewmodel(...)`. El viewmodel existe en el lote B (el arnés
   `sandbox_b.html` sí lo llama) pero el juego real nunca lo pinta.
3. **No se puede reiniciar tras morir.** `restartMission()` restablece vida,
   bajas y oleada, pero deja el estado en `'dead'`: el botón de la pantalla de
   muerte no vuelve a jugar. Hay que revisar también `restartCheckpoint()`.

### Medios
4. **6 auto-tests fallan**: `audio:catalog`, `shaders:uniforms`, `mesh:stride`,
   `physics:noTunnel`, `player:reachability`, `hud:hitmarker`. En revisión por el
   agente `reviewer` para decidir en cada caso si el error está en el código o en
   la expectativa del test.
5. **`util.js` no registra sus tests `math:*`.** Registra dentro de
   `if (BS.Debug && ...)`, pero `util.js` se carga **antes** que `debug.js`, así
   que la condición es falsa y emite un aviso. Los tests `math:rayAABB` y
   `math:matrixInvert` **no existen** en `runAll()`.
6. **`sandbox_a.html` usa elementos DOM que no existen** (`#hud-panel`,
   `#diag-panel`, `#err`, `#hint`) → `textContent` sobre `null` en tiempo de
   ejecución.

### Bajos / a valorar
7. **La escena es muy oscura**: luminancia media ≈ **0,017** mirando a una pared
   del atrio desde 4 m (máximo 0,25). No es el post-proceso (apagarlo apenas
   cambia: 0,0188). Hay que valorar subir ambiente/linterna, porque en la
   práctica el jugador no distingue la geometría.
8. **150 draw calls** con solo 5.708 triángulos, frente al presupuesto de ≤ 90
   del contrato §7.1 en calidad `high`.
9. El nombre de las armas en el README no coincidía con el implementado: el
   subfusil es **`VK-9 "HORNET"`**, no el propuesto en el documento de
   decisiones. Se corrige en el README.

## 4. Falsos positivos descartados (importante para no corregir lo que no falla)

- **«El disparo no funciona»**: era el arnés. Repetía la misma marca de tiempo en
  `BS.Game.frame()`, así que `dt` no avanzaba y el jugador no se actualizaba.
  Con reloj monótono el disparo funciona.
- **«La recarga no funciona»**: era el arnés. Se probaba recargar con el
  cargador **vacío** (que tarda más) y con solo 90 pasos (1,5 s) la recarga no
  había terminado. Con cargador parcial y tiempo suficiente, funciona.

## 5. Lo que NO se ha podido probar

- **Apertura real desde `file://` con doble clic**: la herramienta de navegador
  rechaza navegar a `file://`. La prueba se hace inyectando los mismos archivos
  como scripts clásicos en `about:blank`, que es equivalente **siempre que** no
  se use `fetch`/`import`/`type="module"` (verificado: no se usa) — pero no es
  literalmente un doble clic.
- **Pointer Lock y captura del ratón**: no hay gesto de usuario real, así que la
  captura del ratón y el giro con el ratón físico no se han podido ejecutar.
- **Captura de pantalla visual**: `browser.screenshot` requiere la ventana del
  escritorio visible. Se ha verificado por píxeles en su lugar.
- **Sonido audible**: se comprueba que el contexto de audio está `running` y que
  hay voces activas, pero no se ha escuchado.
- **Rendimiento sostenido y FPS reales**: el bucle `requestAnimationFrame` no
  corre en una pestaña no visible; los fotogramas se han forzado a mano. Las
  cifras de `fps` del HUD no son fiables en este entorno.
- **Pérdida y restauración de contexto WebGL** (`webglcontextlost`): no se ha
  simulado.
