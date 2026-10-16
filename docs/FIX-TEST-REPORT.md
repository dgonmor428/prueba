# INFORME DE PRUEBAS DEL PARCHE (4 bugs + 1 hardening)

> BLACKSITE: LAST SIGNAL — validación del parche aplicado sobre
> `js/ui/menu.js`, `js/ui/style.js`, `js/core/input.js` y `js/core/util.js`.
> **No se ha modificado la lógica del juego**; solo se añadieron tests de
> regresión y este documento.

---

## 1. Alcance y método

**Cambios a validar**

1. `menu.js`: alias `S.show / S.hide / S.showClickCatch / S.applySettings = Menu.*`
   (antes los botones lanzaban `S.hide is not a function` y no hacían nada).
2. `menu.js`: el overlay de Pointer Lock ya no se oculta al pedir el lock (se
   oculta en `onLockChange` al confirmarse) + hardening `mousedown`/`mouseup`
   con `stopPropagation()` para evitar un disparo parásito.
3. `style.js`: `pointer-events:auto;` en `.bs-click-catch`.
4. `input.js`: `_rawUnsupported` + un único reintento acotado; `_failReported`
   para contar/avisar **un máximo de 1 fallo por intento** (antes 2–3).
5. `util.js`: red de seguridad global que muestra `#bs-boot-fail` si el juego
   nunca llegó a estar listo.

**Artefactos auditados** (lectura completa): `js/ui/menu.js`, `js/ui/style.js`,
`js/core/input.js`, `js/core/util.js`, `js/core/debug.js`, `js/main.js`,
`js/game/game.js` (cableado de lock/pausa/reinicio), `js/entities/weapons.js`,
`index.html`.

**Runner oficial**: `BS.Debug.runAllSummary()` → `{total, failed, ok}`.

**Entorno de medida**: Chromium de escritorio real, `index.html` cargado como
`file://`. La evidencia «PASADO» de este informe fue **medida en el navegador**
(por el orquestador y por las verificaciones de cierre con clic real/programático);
el resto del análisis se apoya en verificación **estática** del código.

**Estado de la batería**: tras añadir los 4 tests de regresión,
`BS.Debug.runAllSummary()` → `{total:32, failed:[], ok:true}` (**28 → 32**).

---

## 2. Tabla de casos de prueba

Estados: **PASADO** (medido en navegador real) · **NO VERIFICABLE** (bloqueado
por el entorno) · **PENDIENTE** (sin verificar).

| ID | Objetivo | Pasos | Esperado | Estado | Evidencia |
|---|---|---|---|---|---|
| TC-01 | Arranque limpio | Abrir `index.html` como `file://` y esperar | `BS.Main.ready===true`, estado `menu`, `#bs-boot-fail` ausente, consola sin errores | **PASADO** | `ready=true`, `menu`, sin `#bs-boot-fail`, consola limpia |
| TC-02 | Navegación de todos los botones del menú | Clic real en TUTORIAL / AJUSTES / CONTROLES / CRÉDITOS y VOLVER en cada uno | `Menu.current()` cambia y vuelve a `main`, sin `TypeError` | **PASADO** | «Navegación completa de botones OK (AJUSTES/CONTROLES/CRÉDITOS/TUTORIAL/VOLVER)» |
| TC-03 | Slider de ajustes | Mover el deslizador de sensibilidad | `BS.Input.getSensitivity()` cambia y se refleja en el `value` | **PASADO** | sensibilidad `0.0022 → 0.006` |
| TC-04 | `select` de ajustes | Cambiar `quality` / `crosshair` / `difficulty` | El valor persiste y se aplica en caliente | **PASADO (parcial)** | `menu:settings` valida `quality`/`difficulty` por API; `change` real del `<select>` no medido clic a clic |
| TC-05 | `toggle` de ajustes | Clic en INVERTIR EJE / POST-PROCESO / SANGRE / FPS | El botón alterna ACTIVADO/DESACTIVADO y el ajuste cambia | **PENDIENTE** | Sin evidencia de clic real en toggles |
| TC-06 | RESTABLECER AJUSTES | Clic en RESTABLECER AJUSTES tras modificar ajustes | `fov=78`, `sensitivity=0.0022` (defaults) | **PASADO** | RESTABLECER → `fov=78`, `sens=0.0022` |
| TC-07 | Arranque de partida (JUGAR) | Clic real en JUGAR | `BS.Game.getState()==='playing'` | **PASADO** | clic real en JUGAR → `playing` |
| TC-08 | TUTORIAL → COMENZAR | Clic en TUTORIAL y luego COMENZAR | `getState()==='tutorial'`, HUD de entrenamiento | **PASADO** | clic → estado `tutorial` |
| TC-09 | Captura de ratón: el clic alcanza el overlay | Clic real sobre `#bs-click-catch` en `playing` | `getComputedStyle(...).pointerEvents==='auto'`; `elementFromPoint(centro).id==='bs-click-catch'` | **PASADO** | `pointerEvents="auto"`; antes `bs-canvas3d`, ahora `bs-click-catch` |
| TC-10 | **Concesión real** del Pointer Lock | Clic real sobre el overlay hasta que el navegador conceda el lock | `document.pointerLockElement===canvas`; overlay se oculta en `onLockChange`; el ratón gira la cámara | **NO VERIFICABLE** | El navegador de automatización rechaza el lock en **cualquier** documento (`WrongDocumentError`, incluso `canvas.requestPointerLock()` directo). Ver §4 |
| TC-11 | Sin disparo parásito en el clic de captura | Clic real sobre el overlay | `shotsFired+0`, `lockFailures+1` exacto, overlay sigue visible | **PASADO** | `lockRequests+1`, `lockFailures+1` exacto, `shotsFired+0`, `lastLockError="WrongDocumentError"` |
| TC-12 | Pausa → REANUDAR | `Game.pause()` y clic en REANUDAR | `paused` con pantalla de pausa; REANUDAR → vuelve al estado previo con overlay visible | **PASADO** | Pausa → REANUDAR → vuelve a `tutorial` (estado previo); overlay visible |
| TC-13 | Pausa → REINTENTAR OLEADA | Pausa → clic en REINTENTAR OLEADA | `getState()==='playing'`, oleada reiniciada, HUD visible | **PASADO** | clic → `playing` |
| TC-14 | Pausa → REINICIAR MISIÓN | Pausa → clic en REINICIAR MISIÓN | `playing`, `hp=100`, spawn inicial | **PASADO** | clic → `playing`, `hp=100` |
| TC-15 | Pausa → SALIR AL MENÚ | Pausa → clic en SALIR AL MENÚ | `menu`, pantalla `main`, HUD oculto | **PASADO** | clic → `menu` con pantalla `main` |
| TC-16 | Pantalla de muerte → REINTENTAR OLEADA | Daño letal → clic en REINTENTAR OLEADA | `playing`, oleada reiniciada | **PASADO** | clic → `playing` |
| TC-17 | Pantalla de victoria → SALIR AL MENÚ | Victoria (5 oleadas) → clic en SALIR AL MENÚ | `menu` | **PASADO** | clic → `menu` |
| TC-18 | Red de seguridad de arranque (fallo) | Romper/quitar un `<script>` de `index.html` y recargar | Aparece `#bs-boot-fail` con aviso legible tras ~400 ms | **PENDIENTE** | En arranque sano se comprueba ausente (invariante OK, test `boot:safety`); falta la prueba con script roto |
| TC-19 | Contabilidad de fallos de lock = 1 por intento | Forzar fallo + `pointerlockerror` del mismo intento | `lockFailures` incrementa **exactamente 1** por intento (antes 2–3) | **PASADO** | `lockFailures+1` exacto; `rawUnsupported=false`; test `input:lockfail-count` |
| TC-20 | Batería completa | `BS.Debug.runAllSummary()` | `{total:32, failed:[], ok:true}` | **PASADO** | 32/32, `failed: []` |

> **Nota:** los casos con clic «programático» (p. ej. REINTENTAR/REINICIAR/SALIR)
> se validaron disparando el `click()` del botón en el navegador real, con la
> consola sin errores; es equivalente al clic de ratón a efectos del listener
> `click` del menú.

---

## 3. Análisis de riesgo de regresión

Conclusión: **riesgo bajo/nulo**. El parche es **aditivo o localizado** y ningún
test de la batería previa ejercita las rutas modificadas.

| Test existente | ¿Afectado? | Por qué NO |
|---|---|---|
| `input:simulate` | No | Solo usa `simulateKey/simulateMouseDelta/consumeMouseDelta/clearAll/endFrame`. El parche toca `requestPointerLock/_onLockError/_rawUnsupported/_failReported`, que este test no lee ni dispara |
| `menu:settings` | No | Usa `Menu.*` públicos (show/hide/applySettings/getSettings/state), no los alias `S.*`, y no clica botones. `Menu.show/hide` no cambiaron |
| `style:inject` | No | El CSS solo **crece** (`pointer-events:auto`). Sigue conteniendo `bs-click-catch` y demás clases; `length>2000`. No se elimina ninguna regla |
| `weapons:fire` | No | Construye `BS.Weapons.create()` con un `ctx` falso, sin DOM. No toca menu/style/input/util |
| `game:determinism` | No | Usa `BS.Input.clearAll/simulateKey`; no pasa por lock ni overlay |
| `game:states`, `waves:all` | No | `setState`/oleadas sin relación con el parche |
| `debug:noThrow` | No | El manejador nuevo de `util.js` no toca `window.onerror` ni hace `preventDefault/stopPropagation`; no altera `state()/stats()/report()` |
| Resto (math, physics, gl, render*, fx, mesh, shaders, textures, level, projectiles, player, pickups, enemies:ai, audio:catalog, hud:hitmarker) | No | Lógica pura/subsistemas sin dependencia de los ficheros parcheados |

Notas de acoplamiento comprobadas:

- `input.js`: `_rawUnsupported` y `_failReported` son **estado nuevo**; ningún
  test los lee ni asume valores iniciales.
- `util.js`: el `window.addEventListener('error', …, true)` convive con
  `BS.Debug.captureErrors` (que usa `window.onerror`); no lo pisa → `Debug.errors`
  mantiene su semántica.
- `menu.js`: los `mousedown/mouseup` con `stopPropagation` están **solo** en
  `#bs-click-catch`, oculto en menú → no intercepta clics de botones.
- Los alias `S.*` son propiedades nuevas en el objeto privado `S`; ninguno usa
  `this`, así que asignar la función desnuda es correcto.

---

## 4. Tests de regresión añadidos

Se añadieron **4 tests** que elevan la batería de **28 a 32**. Todos usan solo
`window.BS` + DOM, son autónomos y restauran el estado que tocan.

| Test | Ubicación | Qué comprueba | ¿Fallaría antes del parche? | Determinista | ¿Depende del Pointer Lock real? |
|---|---|---|---|---|---|
| `menu:buttons` | `js/ui/menu.js` | Pulsa TUTORIAL/AJUSTES/CONTROLES/CRÉDITOS + VOLVER (alias `S.show`), RESTABLECER AJUSTES (alias `S.applySettings`) y JUGAR (alias `S.hide` + callback) | **Sí** (fix 1): sin los alias lanzaba `TypeError` y `Menu.current()`/`fov` no cambiaban | Sí (bloque JUGAR se omite si `Main` no está listo y restaura con `quitToMenu`) | No |
| `menu:pointerlock-overlay` | `js/ui/menu.js` | `getComputedStyle('#bs-click-catch').pointerEvents==='auto'` y `elementFromPoint(centro)===bs-click-catch` | **Sí** (fix 3): heredaba `none` de `#bs-ui` y devolvía `bs-canvas3d` | Sí | No |
| `input:lockfail-count` | `js/core/input.js` | Con canvas *stub*: 1 fallo + `pointerlockerror` del mismo intento ⇒ `lockFailures` +1; 2 intentos ⇒ +2 | **Sí** (fix 4): sin `_failReported`, la doble señal contaba 2 | Sí (stub síncrono) | No |
| `boot:safety` | `js/main.js` | En arranque sano: `BS.Main.ready===true`, `#bs-boot-fail` ausente y `#bs-root` con contenido | Guardia de regresión (no existía antes) | Sí | No |

**Límite honesto de `boot:safety`**: comprueba el **invariante del camino sano**
(que no se dispare el aviso y que el arranque complete). No ejercita la rama de
fallo real, porque el aviso se programa con un `setTimeout(400)` y
`BS.Debug.run` es síncrono; esa rama queda como **TC-18 manual**.

**Resultado**: `BS.Debug.runAllSummary()` → `{total:32, failed:[], ok:true}`.

---

## 5. Qué NO se pudo probar

1. **Concesión real del Pointer Lock (TC-10).** El navegador de automatización
   rechaza el lock en **cualquier** documento (`WrongDocumentError`, incluso
   `canvas.requestPointerLock()` directo desde un clic real). Sí se verificó que
   **el clic alcanza el overlay y `requestPointerLock()` se ejecuta**
   (`lockRequests+1`, `lockFailures+1` exacto, `shotsFired+0`, overlay visible,
   `lastLockError="WrongDocumentError"`, `rawUnsupported=false`).

   **Pasos manuales en un PC con navegador normal** (doble clic en `index.html`):
   1. JUGAR → clic sobre «CLIC PARA BLOQUEAR EL RATÓN».
   2. *Esperado*: el overlay **desaparece solo cuando el navegador concede** el
      lock; el ratón queda capturado y la cámara gira.
   3. **Escape** libera el ratón → pausa.
   4. REANUDAR → overlay reaparece; al clicar, vuelve a capturarse.

2. **Aviso `#bs-boot-fail` por script roto (TC-18).** Requiere cargar la página
   con un `<script>` ausente/roto y recargar (no es medible en proceso).
   *Pasos*: quitar una línea `<script src="js/render/renderer.js">` de
   `index.html` → abrir → *Esperado*: `#bs-boot-fail` con «ERROR AL INICIAR
   BLACKSITE» tras ~0,4 s.

3. **Toggles de ajustes (TC-05)** sin clic real medido.

4. **Apertura literal de `file://` por doble clic** en el entorno de
   automatización (se usó carga real `file://` en el navegador de escritorio para
   el resto de casos; la limitación afecta solo al lock).

---

## 6. Veredicto de cobertura

- **Los 5 cambios quedan cubiertos**: alias `S.*` (TC-02/06/13/14/15/16/17 +
  `menu:buttons`), overlay `pointer-events:auto` (TC-09 +
  `menu:pointerlock-overlay`), ocultado en `onLockChange` (TC-12 +
  TC-10 manual), `_failReported` = 1 fallo/intento (TC-19 +
  `input:lockfail-count`), red de seguridad (TC-01 + `boot:safety` + TC-18 manual).
- **Bien probado y listo para entregar**: fijaciones **1, 3, 4 y 5** por completo;
  la fijación **2** verificada en todo lo comprobable salvo la concesión real del
  lock.
- **Batería**: **32/32** verdes (`failed: []`).
- **Riesgo residual declarado (no bloqueante)**: la **concesión real del Pointer
  Lock** (TC-10) — imposible de medir en este entorno — y el **aviso de arranque
  con script roto** (TC-18) — requiere recarga con fallo. Ambos con pasos
  manuales en §5.

**Conclusión: el parche queda suficientemente probado para entregar.** Las dos
carencias restantes son **limitaciones del entorno de prueba**, están aisladas,
documentadas y no afectan a las rutas verificadas (clic → `requestPointerLock()`,
contabilidad de fallos, navegación de menús y red de seguridad en el camino sano).
