# INFORME DE CORRECCIÓN — BUGS REPORTADOS POR EL USUARIO

> **BLACKSITE: LAST SIGNAL** — Corrección de los dos fallos reales reportados al
> jugar (`index.html` «no funciona» y el clic «no bloquea el ratón, solo dispara»),
> más los bugs extra encontrados durante la verificación.
>
> Este informe **consolida** el trabajo de los cinco agentes. Los documentos de
> detalle son: `docs/FIX-REVIEW.md` (revisión), `docs/FIX-TEST-REPORT.md`
> (pruebas) y `docs/TEACHING-BUGS.md` (explicación didáctica).

---

## 1. Resumen

| # | Síntoma reportado por el usuario | Causa raíz | Arreglo | Archivo |
|---|---|---|---|---|
| **BUG 1** | «el index.html no funciona, le doy clic y no me lleva a ningún lugar» | El código interno de `menu.js` llamaba a `S.show/S.hide/S.showClickCatch/S.applySettings`, que **no existían** en el objeto de estado `S` (solo en el objeto público `Menu`). Cada clic lanzaba `TypeError` **silenciado** por el `try/catch` de `mkButton`, así que no ocurría nada. | 4 alias `S.show = Menu.show;` … | `js/ui/menu.js` |
| **BUG 2** | «le doy clic para bloquear el ratón y no hace nada, solo dispara» | `.bs-click-catch` no reponía `pointer-events:auto`, y su padre `#bs-ui` es `pointer-events:none`. El overlay «CLIC PARA BLOQUEAR EL RATÓN» era **transparente al ratón**: el clic lo atravesaba hasta el `canvas`, disparaba el arma y `requestPointerLock()` **nunca se llamaba**. | `pointer-events:auto;` en la regla | `js/ui/style.js` |
| BUG 3 (extra) | Un solo fallo de Pointer Lock se contaba 2–3 veces y duplicaba el aviso | El fallo llega por dos vías (promesa rechazada **y** evento `pointerlockerror`) y ambas llamaban a `_onLockError`. | Bandera `_failReported` (un fallo por intento) | `js/core/input.js` |
| BUG 4 (extra) | El reintento de `requestPointerLock()` fallaba siempre en equipos sin `unadjustedMovement` | El reintento se hacía **asíncronamente** (`.catch`), fuera del gesto del usuario → rechazado. | `_rawUnsupported` + un único reintento acotado por `isRetry` | `js/core/input.js` |
| BUG 5 (extra) | Al fallar el lock, el overlay desaparecía y no se podía reintentar | El overlay se ocultaba al **pedir** el lock, no al **confirmarse**. | No ocultar hasta `onLockChange` + `stopPropagation` de `mousedown`/`mouseup`/`wheel` para no disparar un tiro parásito | `js/ui/menu.js` |
| BUG 6 (extra) | Si un `<script>` no cargaba: página en negro sin ninguna pista | No había red de seguridad de arranque. | Manejador global `error` (fase de captura) que muestra `#bs-boot-fail` solo si el juego nunca llegó a estar listo | `js/core/util.js` |

**Por qué la verificación anterior no los detectó:** los testes previos conducían el
juego por su **API de depuración** (`BS.Game.start()`, `BS.Debug.*`), nunca por la
**ruta real del usuario** (doble clic en `index.html` → clic en los botones → clic
para capturar el ratón). El BUG 1 vivía en esa ruta; el BUG 2 era un fallo de CSS
solo observable con un clic real.

---

## 2. Cómo se reprodujeron y arreglaron

### BUG 1 — el menú no respondía

Evidencia en el `index.html` real cargado como `file://`:

```
[BS:error] BS.Menu botón: S.hide is not a function
```

Un clic **real** (CDP) sobre `JUGAR` llegaba al botón (`window-click` sobre
`BUTTON "JUGAR"`) pero el estado seguía en `menu`. Arreglo aplicado en
`js/ui/menu.js` (entre el cierre del objeto `Menu` y `BS.Menu = Menu;`):

```js
S.show = Menu.show;
S.hide = Menu.hide;
S.showClickCatch = Menu.showClickCatch;
S.applySettings = Menu.applySettings;
```

El grep confirmó que esos **cuatro** son todos los métodos invocados como
`S.<método>(`, y que ninguno usa `this` (por eso el alias es seguro).

### BUG 2 — el clic no capturaba el ratón

Evidencia en el navegador real, con el overlay visible:

- `getComputedStyle(#bs-click-catch).pointerEvents === "none"` (heredado de `#bs-ui`).
- `document.elementFromPoint(centro).id === "bs-canvas3d"` (el clic atravesaba el overlay).

Arreglo en `js/ui/style.js` (regla `.bs-click-catch`): añadir `pointer-events:auto;`.

### Bugs extra

Descritos en la tabla de §1. El detalle técnico completo está en
`docs/TEACHING-BUGS.md` §3 y `docs/FIX-REVIEW.md`.

---

## 3. Verificación (navegador real, `index.html` cargado como `file://`)

En esta fase se consiguió **cargar el `index.html` real como `file://`** en el
navegador de escritorio (con sus `<script src>` relativos reales), algo que el
método anterior (inyección en `about:blank`) no cubría. Mediciones:

| Comprobación | Resultado |
|---|---|
| Arranque | `BS.Main.ready=true`, estado `menu`, **sin** `#bs-boot-fail`, consola vacía |
| `getComputedStyle(#bs-click-catch).pointerEvents` | `"auto"` |
| `elementFromPoint(centro)` con el overlay visible | `"bs-click-catch"` (antes `bs-canvas3d`) |
| Clic **real** en JUGAR | estado `playing` (antes quedaba en `menu`) |
| Navegación del menú | AJUSTES→`settings`, CONTROLES, CRÉDITOS, TUTORIAL, VOLVER: **todos OK** |
| Slider de sensibilidad | `0.0022 → 0.006` |
| RESTABLECER AJUSTES | `fov=78`, `sens=0.0022` |
| Clic **real** sobre el overlay | `lockRequests +1`, `lockFailures +1` **exacto**, `shotsFired +0`, overlay **sigue visible** |
| Pausa → REANUDAR | `paused` → vuelve al estado previo (`tutorial`) con overlay |
| Pausa → REINTENTAR OLEADA | `playing` |
| Pausa → REINICIAR MISIÓN | `playing`, **hp=100** |
| Pausa → SALIR AL MENÚ | `menu` (pantalla `main`) |
| Pantalla de muerte → REINTENTAR OLEADA | `playing` |
| Pantalla de victoria → SALIR AL MENÚ | `menu` |
| Batería automática | `BS.Debug.runAllSummary()` → **`{total:32, failed:[], ok:true}`** (28 → 32) |

### 3.1 Tests de regresión añadidos (28 → 32)

| Test | Cubre | Dónde |
|---|---|---|
| `menu:buttons` | BUG 1: pulsar botones y comprobar `Menu.current()` + `RESTABLECER` (`S.applySettings`) + `Menu.show(null)` (`S.hide`) | `js/ui/menu.js` |
| `menu:pointerlock-overlay` | BUG 2: `pointer-events==='auto'` y `elementFromPoint` sobre el overlay | `js/ui/menu.js` |
| `input:lockfail-count` | BUG 3: un intento fallido cuenta **1** (no 2–3) | `js/core/input.js` |
| `boot:safety` | BUG 6: en un arranque correcto no hay `#bs-boot-fail` y `Main.ready` es `true` | `js/main.js` |

---

## 4. Limitaciones (honestas)

- **Concesión real del Pointer Lock:** el navegador de automatización **rechaza**
  el Pointer Lock en cualquier documento (`WrongDocumentError`, incluso para una
  llamada directa `canvas.requestPointerLock()` desde un clic real). Por tanto
  **no se pudo verificar aquí** que el navegador *conceda* el lock ni que el
  overlay se oculte al concederse. Lo que **sí** se verificó es que el clic ahora
  **alcanza** el overlay y que `requestPointerLock()` **se ejecuta** (antes nunca
  se ejecutaba). La comprobación manual en un navegador normal queda pendiente.
- Sigue sin probarse «de oído» la calidad del sonido, la fuga de memoria en
  sesiones largas y el comportamiento en otras GPU/navegadores (medido en Intel
  UHD 770 / motor Chromium).

---

## 5. Qué hizo cada agente

| Agente | Aportación en esta corrección |
|---|---|
| `architect` | Analizó los dos bugs, propuso el arreglo mínimo de cada uno, enumeró riesgos y diseñó el plan de pruebas (incluida la decisión de no ocultar el overlay hasta `onLockChange`). |
| `developer` | Aplicó el parche de los 5 cambios (alias, overlay CSS, `requestPointerLock`, `_failReported`, red de seguridad) y lo verificó en un Chrome real. |
| `reviewer` | Revisó el parche: veredicto **APROBADO** sin bloqueantes; 3 hallazgos menores (todos aplicados). → `docs/FIX-REVIEW.md` |
| `tester` | Diseñó la matriz de casos, el análisis de regresión y los 4 tests de regresión; validó la cobertura. → `docs/FIX-TEST-REPORT.md` |
| `teacher` | Redactó la explicación didáctica (bugs, CSS `pointer-events`, Pointer Lock, depuración, repaso). → `docs/TEACHING-BUGS.md` |

**Transparencia:** el orquestador aplicó directamente las 3 correcciones menores
del reviewer y los 4 tests de regresión, y ejecutó toda la verificación de
navegador. Los subagentes `reviewer` y `teacher` **no** pudieron escribir sus
archivos (permiso denegado), así que el orquestador guardó sus documentos
íntegros en `docs/`. El subagente `developer` y el `tester` **sí** pudieron
escribir en disco.
