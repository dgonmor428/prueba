# REVISIÓN — BLACKSITE: LAST SIGNAL

- **Fecha:** 2026-10-16
- **Revisor:** agente `reviewer` (revisión de solo lectura, sin ejecución de pruebas).
- **Alcance:** correcciones de Fase 5 en `js/game/game.js`, `js/render/renderer.js`,
  `js/world/level.js`, `js/world/leveldata.js`, `js/core/util.js`, `js/core/debug.js`,
  y coherencia con `js/entities/weapons.js`, `js/ui/menu.js`, `js/main.js`,
  `sandbox/sandbox_a.html` y las expectativas de test de los 5 módulos.
- **Método:** lectura directa de código + `git status` (solo lectura). No se ejecutaron
  tests ni se modificó ningún archivo durante la revisión.

> **Nota de coordinación:** el `reviewer` (como el resto de subagentes) no tiene permiso de
> escritura, así que entregó el informe al orquestador, que lo ha guardado aquí respetando su
> contenido. Las rutas de fichero del informe original que estaban mal citadas
> (`js/audio/audio.js`, `js/physics/physics.js`) se han corregido a las reales
> (`js/core/audio.js`, `js/world/physics.js`). Al final hay un **apéndice** con el estado
> después de aplicar las correcciones post-revisión (M1, B2, B3).

---

## 1. Veredicto

**SIN DEFECTOS CRÍTICOS.** Las cinco correcciones de Fase 5 son correctas, están
bien ubicadas y no introducen regresiones lógicas observables por lectura.

Queda **1 hallazgo de severidad MEDIA** (recompilación de shaders redundante al
mover sliders de audio) y **5 hallazgos de severidad BAJA** (deuda técnica / cosmética).
Ninguno bloquea la entrega.

---

## 2. Verificación de las 5 correcciones exigidas

### (a) `Game.isLowQuality` defensivo — OK
- `js/game/game.js:1511` define `isLowQuality: function () { return !!(Game.ctx && Game.ctx.quality === 'low'); }`.
- Usos: `js/game/game.js:313` (dentro de `resolveQuality`) y `:1420` (`applySettings`).
- Antes de la corrección, `qualityValue` invocaba `Game.isLowQuality` inexistente y
  `applySettings` reventaba con `isLowQuality is not a function`, silenciado por el
  `catch` de `:1434`. Ahora es defensivo (`Game.ctx` puede ser `null`) y está capturado
  también por el try/catch del llamador. **Correcto.**

### (b) `renderViewmodel` antes de `R.flush()` — OK
- `js/game/game.js:1380-1387` encola el viewmodel tras mundo/enemigos/pickups/proyectiles/FX.
- `R.flush()` en `:1389` es quien ejecuta el pase de viewmodel
  (`js/render/renderer.js:788-807`), con la limpieza de depth previa.
- `R.present()` en `:1391` va después. El comentario `:1376-1379` documenta el motivo.
  **Orden correcto; sin regresión.**

### (c) `quality === 'auto'` con `resolveQuality` no rompe `applyQuality` — OK
- `resolveQuality` (`js/game/game.js:305-323`) nunca devuelve `'auto'`: pliega el
  ajuste del usuario con la detección de GPU y devuelve `'low' | 'medium' | 'high'`.
- `applyQuality` valida la entrada en `:1438` (`if (q !== 'low' && q !== 'medium' && q !== 'high') return;`),
  por lo que un `'auto'` colado no corrompe `ctx.quality`.
- `applySettings:1433` llama `Game.applyQuality(resolveQuality(t2))`; el comentario
  `:1427-1432` documenta que ignorar `auto` congelaba la calidad y contaminaba
  `ctx.quality` con el valor temporal del test `menu:settings`. **Correcto.**

### (d) `if (b.prop) continue;` no elimina geometría — OK
- `js/world/level.js:667`: la condición del bucle de construcción de chunks es la
  complementaria exacta de la del bucle de props (`:674-699`). Todo bloque `prop`
  se omite en un bucle y se recoge en el otro: nada se pierde ni se duplica.
  **Correcto.**

### (e) Vaciar `BS._pendingTests` no duplica tests — OK
- `js/core/util.js:1048-1049` encola en `BS._pendingTests`.
- `js/core/debug.js:652-656` registra cada pendiente y hace `BS._pendingTests.length = 0`.
- `Debug.register` (`js/core/debug.js:92-99`) deduplica por id: solo hace `order.push(id)`
  si el id no existía; `tests[id] = fn` sobrescribe. Un doble registro no duplica
  la entrada en el orden de ejecución. **Correcto.**
- Recuento total: 28 registros, coherente con el «28/28» reportado.

### Ajustes de expectativas de test (verificados, correctos)

| Módulo | Evidencia | Comprobación |
|---|---|---|
| audio | `js/core/audio.js` (`_buildLayer` y test `audio:catalog`) | las capas `k:'am'` no llevan `dur`/`gain` |
| shaders | `js/render/shaders.js:349-362` | los `uniform` de vertex y fragment son coherentes |
| mesh | `js/render/mesh.js:763-773` | `aabb.min[0]` es `-1.0` (no `-1.5`) |
| physics | `js/world/physics.js` (`moveBox` devuelve `_res` compartido) | copiar campos antes de la siguiente llamada |
| hud | `js/ui/hud.js:760-766` | `HUD.update` recorta `dt` a 0.25 s; el test debe acumular |

---

## 3. Hallazgos

### M1 — MEDIO · Recompilación de shaders innecesaria en cada evento de slider
- **Ubicación:** `js/game/game.js:1433` → `applyQuality:1437-1455` → `js/render/renderer.js:610-626`.
- **Qué ocurre:** `applySettings` llama **incondicionalmente** a `Game.applyQuality(resolveQuality(t2))`.
  `applyQuality` asigna `ctx.quality = q` y llama `renderer.setQuality(q)` **aunque la calidad
  no haya cambiado**. `Renderer.setQuality` no hace *early-return*: en `js/render/renderer.js:620-623`
  ejecuta `R._lastProgram = null; buildPrograms();`, que **recompila los 4 programas de shader**,
  más `resize()` y `updateFrustum()`.
- **Por qué importa:** los sliders del menú (`js/ui/menu.js`) emiten `onSettingsChanged` en cada
  evento `input` (arrastre continuo). Ajustar **el volumen** dispara, sin necesidad,
  `setFov` + `applyQuality` → recompilación de shaders por frame de arrastre. En GPU débil esto
  produce tirones perceptibles. No es corrupción de estado, pero es un coste real evitable y el
  efecto es *global* (cualquier ajuste, no solo los de calidad).
- **Cómo arreglarlo (recomendado):** *early-return en `Renderer.setQuality`*:
  `if (R.quality === q) return;` al entrar. Es la corrección mínima y localizada; el resto de
  `applyQuality` sigue reaplicando postFx/lights/texturas.

### B1 — BAJO · `applyQuality` redundante en el arranque
- **Ubicación:** `js/game/game.js:719`, `:766`, `:823`.
- **Qué ocurre:** en init se resuelve `q` (`:719`), se define `ctx.isLowQuality` (`:766`) y
  en `:823` se vuelve a llamar `if (ctx.settings.quality === 'auto') Game.applyQuality(q);`.
  Con `quality='auto'` los shaders pueden construirse hasta **3 veces** en el arranque.
- **Por qué importa:** solo coste de arranque (ms), sin efecto funcional.

### B2 — BAJO · `vmKick` amortiguado dos veces (retroceso ~2× más rápido)
- **Ubicación:** `js/entities/weapons.js:674-678` y `:790-793`.
- **Qué ocurre:** el valor de *kick* se decae tanto en `update` como dentro de `renderViewmodel`.
- **Por qué importa:** puramente cosmético; la animación de retroceso se siente más seca.
- **Arreglo:** decidir un único punto de amortiguación (normalmente `update`) y dejar
  `renderViewmodel` como consumidor de solo lectura.

### B3 — BAJO · Cabecera de `level.js` desactualizada
- **Ubicación:** `js/world/level.js:6` decía «chunks de 24x24 m»; `:33` define `var CHUNK = 32;`.
- **Por qué importa:** documentación engañosa para quien calcule límites/navegación.
- **Arreglo:** actualizar el comentario a 32x32 m.

### B4 — BAJO · Presupuesto de draw calls al límite
- **Ubicación:** `js/world/level.js:667-699` (props → 1 draw call cada uno).
- **Qué ocurre:** el conteo observado 87/90 deja un margen de solo 3 draw calls.
- **Por qué importa:** cualquier prop adicional romperá el presupuesto; conviene
  instanciar o agrupar props antes de seguir poblando el nivel.

### B5 — BAJO · `Debug.setQuality` no sincroniza `settings.quality`
- **Ubicación:** `js/core/debug.js:501-520`; contraste con `js/game/game.js:1400-1435`.
- **Qué ocurre:** `Debug.setQuality` cambia `ctx.quality` (vía `Game.applyQuality`)
  pero **no** actualiza `settings.quality`. El siguiente `applySettings` recalcula con
  `resolveQuality(t2)` y revierte el cambio.
- **Por qué importa:** la herramienta de depuración parece «no hacer nada» de forma diferida;
  puede confundir en sesiones de ajuste. Es una herramienta de test, no afecta al jugador.

---

## 4. Casos límite y seguridad (revisados, sin hallazgos)

- **Entradas nulas/vacías:** `applySettings` retorna si `!ctx`; `applyQuality` retorna si `!ctx`;
  `isLowQuality` tolera `Game.ctx` nulo; `register` valida tipos (`debug.js:93`).
- **`for (var k in s)` en `applySettings`:** protegido con `hasOwnProperty`. Correcto frente a
  prototipos contaminados.
- **Inyección:** no se detecta interpolación de datos de usuario en DOM/HTML ni en comandos;
  los textos de HUD se escriben con `textContent`/propiedades, no con `innerHTML` construido.
- **Secretos:** no hay claves ni tokens en el código revisado.
- **Concurrencia:** el motor es mono-hilo (rAF); sin condiciones de carrera relevantes. El único
  estado compartido mutable es `BS._pendingTests`, consumido y vaciado en el mismo *tick* de
  publicación.
- **Red:** no aplica; el proyecto no realiza E/S de red.

---

## 5. Cobertura de pruebas (qué falta)

- No existe prueba que verifique **M1** (contar invocaciones a `buildPrograms`).
- No hay prueba del camino «slider movido durante arrastre continuo».
- No hay prueba de que `Debug.setQuality` sobreviva a un `applySettings` posterior (B5).
- El resto de puntos (a)–(e) sí tienen cobertura indirecta vía los 28 tests registrados y los
  ajustes de expectativas verificados en la tabla de §2.

---

## 6. Riesgos residuales (estado tras el apéndice)

1. **M1** — *resuelto* (véase apéndice).
2. **B2, B3** — *resueltos* (véase apéndice).
3. **B4**: presupuesto de draw calls con margen de 3 — el primer prop extra lo excede.
4. **B1, B5**: deuda técnica de bajo impacto, documentada y no bloqueante.

---

## 7. Archivos revisados

- `js/game/game.js`, `js/render/renderer.js`, `js/world/level.js`, `js/world/leveldata.js`
- `js/core/util.js`, `js/core/debug.js`
- `js/entities/weapons.js` (contexto de (b)), `js/ui/menu.js`, `js/main.js`
- `sandbox/sandbox_a.html`
- Expectativas de test en los 5 módulos (audio, shaders, mesh, physics, hud).

**Estado de `git status` en el momento de la revisión (solo lectura):**
`M js/core/debug.js`, `M js/core/util.js`, `M js/game/game.js`, `M js/world/level.js`,
`M js/world/leveldata.js`, `M sandbox/sandbox_a.html`, `?? docs/TEST-REPORT.md`.

---

## Apéndice (orquestador) — correcciones aplicadas tras la revisión

Estas tres correcciones se aplicaron **después** del informe anterior. Las hicieron el
orquestador y el desarrollador, no el `reviewer`, y se declaran aquí para no atribuir al
`reviewer` un estado del código que no revisó.

| ID | Severidad | Estado | Cambio aplicado |
|---|---|---|---|
| **M1** | MEDIO | **Corregido** | `js/render/renderer.js`: `setQuality` hace *early-return* `if (R.quality === q) return;`. Mover un slider (p. ej. volumen) ya **no** recompila los shaders. Verificado: los programas se compilan en `init()` (`renderer.js:539`), así que saltarse el trabajo con la misma calidad es seguro. |
| **B2** | BAJO | **Corregido** | `js/entities/weapons.js`: se eliminó la amortiguación duplicada de `vmKick` de `renderViewmodel`; ahora solo decae en `update(dt)`. El `renderViewmodel` pasó a ser de solo lectura (no muta estado de simulación). |
| **B3** | BAJO | **Corregido** | `js/world/level.js`: la cabecera dice ahora «chunks de 32x32 m», coherente con `var CHUNK = 32`. |

**Siguen abiertos (deuda técnica consciente y no bloqueante):**
- **B1** — doble/triple `applyQuality` en el arranque: coste de milisegundos, sin efecto funcional.
  No se tocó para no alterar el orden de inicialización verificado.
- **B4** — margen de 3 draw calls (87/90). Documentado en `README.md` y `docs/TEST-REPORT.md`
  como límite a vigilar antes de añadir props.
- **B5** — `Debug.setQuality` es un *override* efímero: es una herramienta de pruebas, no afecta
  al jugador.

Ninguno de los tres abiertos afecta a la jugabilidad ni al arranque, y los tres están
verificados como de severidad BAJA por el propio `reviewer`.
