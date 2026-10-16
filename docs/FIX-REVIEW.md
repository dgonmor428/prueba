# REVISIÓN DEL PARCHE DE BUGS (menú + Pointer Lock)

## Contexto

Proyecto **BLACKSITE: LAST SIGNAL**, FPS 3D WebGL nativo sin dependencias, que se abre con `index.html` como `file://`. Reglas del proyecto: IIFE con único global `window.BS`, `var`, sin `fetch`/XHR/módulos/`class`.

Se revisa un parche que corrige dos bugs reportados por un usuario real y reproducidos con evidencia en navegador de escritorio:

- **BUG 1** — Ningún botón del menú hacía nada. Consola: `[BS:error] BS.Menu botón: S.hide is not a function` / `S.show is not a function`. Causa: el código interno de `menu.js` invocaba `S.show/S.hide/S.showClickCatch/S.applySettings`, que solo existían como métodos del objeto público `Menu`, no en el objeto de estado `S`.
- **BUG 2** — Al hacer clic no se capturaba el ratón, solo se disparaba. Causa: `.bs-click-catch` no reponía `pointer-events:auto` (su padre `#bs-ui` es `pointer-events:none`); el overlay era transparente al ratón (`elementFromPoint(centro)` devolvía `bs-canvas3d`), su handler nunca corría y `requestPointerLock()` no se invocaba.

Archivos implicados: `js/ui/menu.js`, `js/ui/style.js`, `js/core/input.js`, `js/core/util.js` (más el cableado en `js/game/game.js` y `js/main.js`).

## Hallazgos por severidad

No se encontró ningún defecto **bloqueante** ni **mayor**. Los alias de `menu.js` son la corrección correcta y suficiente; `pointer-events:auto` es la corrección mínima correcta del BUG 2; `requestPointerLock` no puede recursar sin fin ni dejar promesas sin `.catch`; la red de seguridad de `util.js` no interfiere con `BS.Debug.captureErrors`.

| Sev. | Archivo:línea | Qué ocurre | Por qué importa | Cómo arreglarlo |
|---|---|---|---|---|
| **Menor** | `js/core/util.js:436-443` + `475-482` | `showBootFailure` podía pintar "#bs-boot-fail" sobre un arranque correcto si ocurría un error no fatal antes de `DOMContentLoaded` y el análisis tardaba >400 ms (`ready===false`, `#bs-root` vacío porque existe pre-creado en `index.html:11`). | Aviso falso a pantalla completa (z-index 99999) sobre un juego que sí arranca. | **Aplicado:** reagendar si `document.readyState === 'loading'` en lugar de avisar. |
| **Menor** | `js/core/input.js:236-248` | El `catch` síncrono de `ask(true,false)` marcaba `_rawUnsupported = true` ante **cualquier** throw, no solo `NotSupportedError`. | Si un navegador compatible lanzara por seguridad/activación (`SecurityError`/`NotAllowedError`), la marca quedaba pegada por error (expuesta en `debugState().rawUnsupported`). | **Aplicado:** marcar solo si el error no es `SecurityError` ni `NotAllowedError`. |
| **Menor** | `js/core/input.js:174-181` + `222` | `_failReported` es un flag único por instancia; con dos peticiones solapadas (dos clics rápidos antes de resolverse la primera) el conteo puede **subcontar** fallos (2 `lockRequests` con 1 `lockFailures`). | Solo afecta a telemetría/toast, no a la funcionalidad. | Afinar el conteo por intento o documentar el subconteo. *(Recomendado, no bloqueante.)* |
| **Sugerencia** | `js/core/input.js` (`_onLockError`) | Terminaba con `return false;`. | Como listener de `addEventListener`, el retorno se ignora: código muerto. | Eliminarlo o usar `ev.preventDefault()` explícito. |
| **Sugerencia** | `js/ui/menu.js:153-155` | El hardening detenía `mousedown`/`mouseup` pero no `wheel`; con el overlay visible la rueda llegaba a `window` y cambiaba de arma. | Comportamiento colateral menor. | **Aplicado:** añadir `wheel` con `stopPropagation()` al overlay. |
| **Sugerencia** | `js/ui/menu.js:140-149` | El overlay ya no se oculta en su propio `click`; depende de `onLockChange` del juego (`game.js:935-937`). | Es la decisión correcta (permite reintentar), pero crea acoplamiento si el juego no está cableado. | Documentarlo (ya comentado) o escuchar `pointerlockchange` como respaldo. No requiere cambio. |

## Verificación de los puntos solicitados

1. **¿`S.show = Menu.show` (alias sin `this`) es seguro?** Sí. `js/ui/menu.js` no contiene ninguna referencia `this.`; los cuatro métodos (`show`, `hide`, `showClickCatch`, `applySettings`) operan sobre `S` y `BS.*`/helpers de módulo. `Menu.hide` invoca internamente `S.showClickCatch(false)` (ya resuelto por alias). Sin regresiones.

2. **¿Los 4 alias son TODOS los métodos llamados como `S.<método>(`?** **Confirmado por grep.** En `menu.js` solo aparecen `S.show`, `S.hide`, `S.showClickCatch`, `S.applySettings` (el resto de coincidencias son falsos positivos: `SCREENS.indexOf`, `SCREENS.slice`). En todo el proyecto, el patrón solo reaparece en falsos positivos (`MATERIAL_IDS.slice`, `CSS.indexOf`, `STATE_VALUES.indexOf`) y en `enemies.js:147` `S.rng ? S.rng() : Math.random()`, donde `S.rng` sí existe en el estado (`enemies.js:124`) y va guardado. **Ningún otro módulo reproduce el bug.** `hud.js`, que también define `var S = {}`, no invoca métodos vía `S.`.

3. **Hardening `stopPropagation` en `mousedown`/`mouseup`: ¿puede impedir algo necesario? ¿Es correcto que el primer clic no dispare?** No impide lo necesario y el primer clic no debe disparar. Los listeners de `BS.Input` están en `window` en fase de burbuja (`input.js:65-66`); el overlay es descendiente de `window`, así que `stopPropagation` impide que el evento llegue a `window` y no se registra el botón (arma no dispara → `shotsFired +0`). **No** bloquea el `click` (evento propio tras `mouseup`, con listener en el propio overlay: `requestPointerLock()` sigue ejecutándose). **No** bloquea `contextmenu` (lo maneja el `preventDefault` global de `input.js:69`). Que el primer clic capture el ratón en lugar de disparar es el comportamiento deseado.

4. **`requestPointerLock`: recursión, promesas sin `.catch`, orden, `_rawUnsupported`.** Recursión **acotada**: `ask` solo se re-invoca con `isRetry=true` (una única vez) en ambas rutas de reintento. **Ninguna promesa queda sin `.catch`**: siempre `q.then(...).catch(...)`; el retorno `undefined` de navegadores antiguos queda cubierto por el guard `if (q && typeof q.then === 'function')` y por el evento `pointerlockerror`. **Orden correcto**: primero `ask(true,false)` (`unadjustedMovement:true`), fallback a la variante simple una sola vez. **`_rawUnsupported` pegajoso**: aceptable (flag de capacidad).

5. **`_onLockError` con `_failReported`: ¿alguna ruta lo deja en `true` y silencia un fallo legítimo posterior?** No en los flujos normales: se resetea al inicio de cada intención real (`input.js:222`), y toda ruta de fallo pasa por `requestPointerLock`, que lo resetea. Único matiz: clics solapados comparten el flag (subconteo descrito como Menor). Dos pulsaciones rápidas normales cuentan 1 fallo cada una.

6. **Red de seguridad de `util.js`: falsos positivos, `captureErrors`, 400 ms, reglas.** Tras la corrección (reagenda mientras `readyState === 'loading'`), ya no hay falso positivo por parse lento; el sondeo está acotado. **No interfiere** con `BS.Debug.captureErrors`, que usa `window.onerror` + su propio listener `error` de captura (`debug.js:52,67`); este añade otro listener de captura sin `preventDefault`/`stopPropagation` y no reasigna `window.onerror`. **Reglas**: sin `fetch`, sin dependencias, sin módulos/`class`, todo `var`, no toca `index.html`.

7. **¿Queda otro sitio con el patrón "método inexistente en el objeto de estado"?** **Refutado:** no se encontró ningún otro módulo con ese patrón (ver punto 2).

## Propuesta de test

Se integra con el sistema existente (`BS.Debug.register`), sin dependencias ni APIs nuevas. El primero cubre el **BUG 1**; el segundo el **BUG 2**. Ambos fueron finalmente implementados (ver apéndice).

### `menu:buttons` (regresión de los alias)

```js
BS.Debug.register('menu:buttons', function () {
  var ok = true, notes = [];
  /* clic programático en los botones por textContent y comprobación de
     Menu.current() tras AJUSTES (settings) y VOLVER (main/pause). */
  return { ok: ok, notes: notes };
});
```

### `menu:pointerlock-overlay` (regresión del BUG 2)

```js
BS.Debug.register('menu:pointerlock-overlay', function () {
  var ok = true, notes = [];
  var cc = document.getElementById('bs-click-catch');
  var pe = cc ? window.getComputedStyle(cc).pointerEvents : '';
  /* pointer-events es una propiedad HEREDADA: sin la regla, el overlay
     heredaría `none` de #bs-ui. Debe valer `auto`. */
  if (pe !== 'auto') { ok = false; notes.push('pointerEvents=' + pe + ' (esperado auto)'); }
  return { ok: ok, notes: notes };
});
```

## Veredicto

**APROBADO.** El parche resuelve ambos bugs en su causa raíz y no introduce regresiones. No hay defectos bloqueantes ni mayores. Las 3 observaciones menores detectadas en la revisión (falso positivo de `util.js`, marca `_rawUnsupported` ante throw síncrono, `stopPropagation` de `wheel`) ya han sido aplicadas y verificadas en el código real (ver apéndice). La propuesta de tests se materializó en 4 tests de regresión.

## Apéndice — Estado final verificado

**Correcciones menores aplicadas (confirmadas en el código):**

1. `js/core/util.js:443` — `showBootFailure` reagenda si `document.readyState === 'loading'` (elimina el falso positivo).
2. `js/core/input.js:243` — el `catch` síncrono solo marca `_rawUnsupported` si el error **no** es `SecurityError`/`NotAllowedError`.
3. `js/ui/menu.js:155` — añadido `wheel` con `stopPropagation()` al overlay.

**Tests de regresión añadidos (28 → 32):**

- `menu:buttons` (`js/ui/menu.js:769`)
- `menu:pointerlock-overlay` (`js/ui/menu.js:821`)
- `input:lockfail-count` (`js/core/input.js:416`)
- `boot:safety` (`js/main.js:237`)

**Verificación en navegador real sobre `index.html` como `file://`:**

- `BS.Main.ready = true`, estado `menu`, sin `#bs-boot-fail`, consola vacía.
- `BS.Debug.runAllSummary()` → `{ total: 32, failed: [], ok: true }`.
- Botones verificados con clic real: **COMENZAR → tutorial**; **REANUDAR → tutorial**; **REINTENTAR OLEADA → playing**; **REINICIAR MISIÓN → playing (hp=100)**; **SALIR AL MENÚ → menu** (pantalla `main`); pantalla de muerte **REINTENTAR OLEADA → playing**; pantalla de victoria **SALIR AL MENÚ → menu**. Navegación AJUSTES/CONTROLES/CRÉDITOS/TUTORIAL/VOLVER y **RESTABLECER AJUSTES** OK.
- Clic real sobre el overlay: `lockRequests +1`, `lockFailures +1` exacto, `shotsFired +0`, overlay permanece visible para reintentar; `lastLockError = "WrongDocumentError"`.

**Limitación declarada:** el navegador de automatización rechaza el Pointer Lock en cualquier documento (`WrongDocumentError` incluso con llamada directa `canvas.requestPointerLock()` desde un clic real), por lo que la **concesión real** del lock no pudo verificarse aquí. Sí se verificó que el clic alcanza el overlay y que `requestPointerLock()` se ejecuta. La ocultación del overlay al concederse el lock queda pendiente de validación manual en un navegador normal.
