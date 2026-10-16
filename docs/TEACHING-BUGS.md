# DOCUMENTO DIDÁCTICO — ARREGLO DE LOS BUGS DE MENÚ Y POINTER LOCK

**Proyecto:** BLACKSITE: LAST SIGNAL (FPS 3D en WebGL nativo, sin dependencias, se abre con `index.html` por `file://`)
**Nivel:** 2.º de DAW · **Archivos implicados:** `js/ui/menu.js`, `js/ui/style.js`, `js/core/input.js`, `js/core/util.js`, `js/main.js`, `js/game/game.js`, `index.html`

---

## 0. Resumen rápido (qué pasó, en una frase por bug)

| # | Síntoma que reportó el usuario | Causa raíz | Arreglo |
|---|---|---|---|
| 1 | "Le doy clic a los botones y no me lleva a ningún sitio" | El código interno llamaba `S.show/S.hide/…`, pero esas funciones viven en el objeto público `Menu`, no en el estado `S` → `TypeError` | 4 alias `S.show = Menu.show;` en `js/ui/menu.js:700-703` |
| 2 | "Le doy clic para bloquear el ratón y solo dispara" | CSS: `#bs-ui` tiene `pointer-events:none` y el overlay `.bs-click-catch` no lo reactivaba → el clic atravesaba el overlay | `pointer-events:auto;` en `js/ui/style.js:256` |
| 3a | Un solo fallo de Pointer Lock contaba 2-3 veces | La promesa rechazada **y** el evento `pointerlockerror` avisan ambos del mismo intento | Bandera `_failReported` en `js/core/input.js:174` |
| 3b | Reintento de `requestPointerLock()` rechazado siempre | El reintento se hacía **fuera del gesto del usuario** (en el `.catch` de la promesa) | `_rawUnsupported` + **un solo** reintento acotado (`js/core/input.js:250-257`) |
| 3c | El overlay desaparecía aunque el lock fallara | Se ocultaba al pedir el lock, no al confirmarlo | Ocultar solo en `onLockChange` (`js/game/game.js:937`) |
| 3d | Si un script no cargaba: página en negro sin pistas | No había red de seguridad de arranque | Manejador global de `error` en `js/core/util.js:419-494` |

**Analogía de andar por casa:** imagina una casa con dos interruptores. Bug 1 es que el interruptor del salón estaba cableado al *cuadro de la luz* en vez de al *cable* (nombres parecidos, sitios distintos). Bug 2 es que había un cristal invisible delante del interruptor: lo pulsabas y tu dedo atravesaba el cristal hasta el interruptor de al lado. Ninguno de los dos rompía la casa; simplemente "no pasaba nada".

---

## 1. BUG 1 — Ningún botón del menú hacía nada

### 1.1 Síntoma real y cómo se detectó

El usuario hacía clic en JUGAR / TUTORIAL / AJUSTES y no ocurría nada visible: ni cambio de pantalla, ni mensaje. Sin embargo, **la consola del navegador sí tenía la respuesta**:

```
[BS:error] BS.Menu botón: S.hide is not a function
```

Ese texto sale de aquí: `js/ui/menu.js:106` llama a `BS.Log.error(...)` y `js/core/util.js:37` es quien añade el prefijo `[BS:error]` delante de todo lo que se loguea como error.

**Lección de método:** cuando "un botón no hace nada", lo primero NO es mirar el CSS ni el HTML: es abrir la consola (F12). El dato estaba ahí desde el primer minuto.

### 1.2 Causa raíz: dos objetos con nombres parecidos

En `js/ui/menu.js` hay **dos** cosas distintas:

* `S` — el objeto de **estado interno** del módulo (`js/ui/menu.js:49-68`): guarda el DOM construido, la pantalla actual, los callbacks… Es privado, no sale del archivo.
* `Menu` — el objeto **público** (`js/ui/menu.js:506-694`) que se expone como `BS.Menu` (`js/ui/menu.js:705`): aquí viven `Menu.show`, `Menu.hide`, `Menu.showClickCatch`, `Menu.applySettings`…

El código de construcción del DOM, que es código interno, llamaba a funciones con el prefijo equivocado:

```js
// js/ui/menu.js:207-211  (menú principal)
col.appendChild(mkButton('TUTORIAL',  { onClick: function () { S.show('tutorial'); } }));
col.appendChild(mkButton('AJUSTES',   { onClick: function () { S.show('settings'); } }));
```

Y también aquí:

```js
// js/ui/menu.js:497-501
function startGame() {
  S.hide();                       // <-- S.hide NO existe
  if (typeof S.cb.onStart === 'function') { ... }
}
```

`S` nunca tuvo un método `hide` ni `show` ni `showClickCatch` ni `applySettings`. Esas cuatro funciones solo existían como propiedades de `Menu`. Resultado: al pulsar el botón, JavaScript evaluaba `S.hide` → `undefined`, y al intentar invocarlo (`undefined()`) lanzaba:

```
TypeError: S.hide is not a function
```

> **Vocabulario — `TypeError`:** error que lanza JS cuando usas un valor de un tipo que no admite esa operación. El caso típico en DAW es exactamente este: intentar *llamar* a algo que no es una función (`undefined()`, `null()`).

### 1.3 Por qué el error quedaba "silenciado"

Mira `mkButton` (`js/ui/menu.js:97-112`), el helper que crea TODOS los botones:

```js
if (opts.onClick) {
  BS.Util.addListener(b, 'click', function (ev) {
    if (ev && ev.preventDefault) ev.preventDefault();
    if (!S.editable && !opts.alwaysEnabled) return;
    try { opts.onClick(); }                         // <-- aquí explotaba
    catch (e) { BS.Log.error('BS.Menu botón:', e && e.message ? e.message : e); } // <-- y aquí se comía el error
    if (BS.Audio && BS.Audio.play) BS.Audio.play('ui_click');  // <-- esto SÍ se ejecutaba
  });
}
```

Tres consecuencias encadenadas, y las tres importan:

1. **El `try/catch` se traga la excepción.** Un `try/catch` está pensado para que un fallo puntual no tumben toda la interfaz. Eso está bien, pero aquí convierte un *crash* (visible, fácil de encontrar) en un *fallo silencioso* (invisible salvo que abras la consola).
2. **El flujo continúa en la línea siguiente.** El `catch` está *dentro* del handler; cuando atrapa la excepción, la ejecución sigue en `js/ui/menu.js:107` y **suena el "clac" del botón**. Por eso el usuario tenía la sensación de "el botón responde pero no va a ningún sitio": sí respondía acústicamente, pero la acción real se había abortado a medias.
3. **`startGame()` se abortaba en su primera línea.** En JUGAR, `S.hide()` es la línea 497, así que ni siquiera se llegaba a `S.cb.onStart()` (línea 498-500). El juego no arrancaba *por el orden del código*, no porque el juego estuviera roto.

> **Idea clave del bug:** un `try/catch` alrededor de "hacer la acción" no debe ser una manta que oculte el error. En este caso el `catch` *sí* loguea (`BS.Log.error`), así que la información existía… pero nadie miraba la consola y la UI no daba ninguna señal. Lo correcto es loguear SIEMPRE, y en desarrollo mirar ese log de forma activa.

### 1.4 El arreglo: cuatro alias

```js
// js/ui/menu.js:696-703
/* Alias internos: el código de construcción (arriba) invoca S.show/S.hide/
 * S.showClickCatch/S.applySettings, pero la implementación vive en el objeto
 * público Menu. Sin estos alias los botones del menú lanzaban TypeError
 * ("S.hide is not a function") y no hacían nada. Ninguno usa `this`. */
S.show = Menu.show;
S.hide = Menu.hide;
S.showClickCatch = Menu.showClickCatch;
S.applySettings = Menu.applySettings;
```

#### ¿Qué es una "referencia a función"?

En JavaScript las funciones son **valores**, como los números o los strings. Cuando escribes:

```js
S.show = Menu.show;
```

**no** copias el cuerpo de la función: copias la *referencia* (la dirección de memoria) de ese objeto-función. Después de esa línea, `Menu.show` y `S.show` apuntan **al mismo bloque de código**. Es como poner dos accesos directos al mismo programa: no hay dos programas, hay dos nombres.

```js
var a = function () { return 42; };
var b = a;          // b y a: misma función
b === a;            // true
```

#### ¿Por qué es seguro aquí? (el tema de `this`)

Si copias un método y **dentro** usa `this`, al llamarlo por el alias `this` cambia de dueño y puedes romperlo:

```js
var obj = { n: 7, doble: function () { return this.n * 2; } };
var f = obj.doble;
f();            // NaN  ->  this ya NO es obj
```

Aquí no ocurre, porque **ninguno de los cuatro métodos usa `this`**. Trabajan por *closure* (cierran sobre la variable `S` y sobre las funciones del módulo). Compruébalo:

* `Menu.show` (`js/ui/menu.js:532-561`): usa `S.built`, `S.screens`, `S.current`, `refreshAll()`, `BS.Input`… ningún `this`.
* `Menu.hide` (`js/ui/menu.js:563-575`): `S.screens`, `S.showClickCatch(false)`…
* `Menu.showClickCatch` (`js/ui/menu.js:658-663`): `S.clickCatch`…
* `Menu.applySettings` (`js/ui/menu.js:585-598`): `settingsRef()`, `refreshAll()`, `pushLive()`…

Se llamen como `Menu.show()` o como `S.show()`, el comportamiento es idéntico.

> **Detalle fino de orden de carga:** los alias están escritos **al final** del módulo (línea 700), después del literal `Menu` (línea 506). Eso funciona porque las funciones que usan los alias (`buildMain`, `buildPause`…) solo se **ejecutan** dentro de `buildDOM()`, que a su vez se llama desde `Menu.init()`. Para entonces, el módulo ya terminó de evaluarse y los alias ya existen. Regla: *declarar antes de usar* se refiere al momento de la **ejecución**, no al orden de las líneas.

#### Bonus: el bug también afectaba al cierre del overlay

Fíjate en `js/ui/menu.js:573`, dentro de `Menu.hide()`:

```js
S.current = null;
S.showClickCatch(false);   // antes era undefined -> TypeError
```

Estaba dentro de un `try/catch` (línea 564-574) que lo silenciaba, así que el overlay "CLIC PARA BLOQUEAR EL RATÓN" **no se cerraba** al ocultar el menú. El mismo alias lo arregla de paso (línea 702).

### 1.5 Cómo lo habrías detectado antes

1. **Abrir la consola y leer.** `[BS:error] BS.Menu botón: S.hide is not a function` lo señalaba literalmente.
2. **Un test de regresión que pulse los botones** (te lo propongo al final del documento): automatiza "pulso AJUSTES → ¿estoy en `settings`?".
3. **Escribir el nombre completo, no abreviado, en el handler.** `Menu.hide()` en vez de `S.hide()` habría sido imposible de escribir mal sin que el editor te avisara.
4. **Sospechar del "no pasa nada pero suena el clic".** Cuando *parte* de un handler funciona (el audio, línea 107) y otra parte no, casi siempre hay una excepción en medio: busca el `try/catch` de arriba.
5. **Otra causa posible de "no pasa nada":** `js/ui/menu.js:105` hace `if (!S.editable && !opts.alwaysEnabled) return;`. Si algún día los botones se desactivan (`Menu.setEditable(false)`, línea 665), parecerá el mismo síntoma. En la consola: `BS.Menu.state().editable` te lo dice.

---

## 2. BUG 2 — El clic no bloqueaba el ratón (y el arma disparaba sola)

### 2.1 Síntoma real

Aparecía el texto **"CLIC PARA BLOQUEAR EL RATÓN"**, el usuario hacía clic…
y (a) el overlay no reaccionaba, (b) el arma **disparaba**, (c) `requestPointerLock()` no se llamaba nunca.

Un síntoma muy característico: *"el clic se lo come otra cosa"*.

### 2.2 Qué es `pointer-events`

`pointer-events` es la propiedad CSS que decide si un elemento **participa en el *hit-testing*** (la prueba de "¿sobre qué elemento está el ratón?").

* `pointer-events:auto` → el elemento recibe los clics (comportamiento normal).
* `pointer-events:none` → el elemento es **invisible para el ratón**: los eventos de puntero lo atraviesan y van al elemento que hay debajo.

Dos matices que se preguntan mucho en clase:

1. **Es heredable en la práctica.** Si un contenedor tiene `none`, sus hijos heredan `none`… salvo que un hijo vuelva a poner `auto`. Por eso este patrón funciona.
2. **`none` NO oculta nada visualmente.** El overlay se ve perfectamente; simplemente no lo "tocas". Esto es lo que hace el bug tan confuso: lo ves, lo pulsas y no pasa nada.

### 2.3 La cadena de reglas CSS (el diagnóstico real)

En `js/ui/style.js` todo el sistema de capas está montado así:

```css
/* js/ui/style.js:123-125 */
#bs-hud  { ... pointer-events:none; z-index:10 }   /* el HUD nunca debe interceptar clics */
#bs-ui   { ... pointer-events:none; z-index:20 }   /* la capa de UI, por defecto, tampoco */
#bs-ui .bs-overlay { pointer-events:auto }         /* excepción 1 */
```

```css
/* js/ui/style.js:128-132 */
.bs-screen { ... pointer-events:auto; ... }        /* excepción 2: las pantallas de menú SÍ */
```

Es decir: **la capa `#bs-ui` entera es "transparente al ratón"** y solo dos familias de elementos lo reactivan: `.bs-overlay` y `.bs-screen`.

El overlay de captura de clic se crea con la clase `bs-click-catch` (`js/ui/menu.js:134`, y esa clase está definida en `js/ui/style.js:70`):

```css
/* js/ui/style.js:255-257 (ANTES del arreglo: sin pointer-events) */
.bs-click-catch{position:absolute;left:0;top:0;right:0;bottom:0;z-index:30;display:none;
  flex-direction:column;align-items:center;justify-content:center;gap:10px;cursor:pointer;
  background:rgba(2,5,8,.5);color:#d9f6ff;letter-spacing:.22em;font-size:14px;text-align:center}
```

No pertenecía a ninguna de las dos excepciones → **heredaba `pointer-events:none` de `#bs-ui`** → el clic atravesaba el overlay, llegaba al `<canvas>` de debajo y desde ahí subía a `window`, donde `js/core/input.js:65` (`mousedown`) lo registraba como *botón izquierdo* → **el arma disparaba**. El listener del overlay (`js/ui/menu.js:140-149`) nunca se ejecutaba, así que `onRequestLock` (que a su vez llama a `requestPointerLock`) jamás se llamaba. Todo encaja con el reporte del usuario.

### 2.4 Cómo diagnosticarlo en 10 segundos: `document.elementFromPoint`

`document.elementFromPoint(x, y)` responde a la pregunta **"¿qué elemento está en esas coordenadas de la ventana, de los que SÍ reciben punteros?"**. Devuelve el elemento *topmost* en el hit-testing (o `null` si no hay ninguno).

```js
// Pega esto en la consola con el menú/pausa abiertos y el overlay visible:
var x = window.innerWidth / 2, y = window.innerHeight / 2;
var arriba = document.elementFromPoint(x, y);
arriba.id || arriba.className;
// ANTES del arreglo:  "bs-canvas"   <-- el canvas, o sea que el overlay no cuenta
// DESPUÉS:            "bs-click-catch"
```

Complemento perfecto: la propiedad calculada, que te dice el valor **efectivo** tras herencia y cascada (ojo: `getComputedStyle` funciona aunque el elemento esté en `display:none`).

```js
getComputedStyle(document.getElementById('bs-click-catch')).pointerEvents;
// ANTES:  "none"    DESPUÉS:  "auto"
```

Compara con un elemento que sí funcionaba, como una pantalla:

```js
getComputedStyle(document.getElementById('bs-screen-main')).pointerEvents; // "auto"
```

### 2.5 El arreglo

```css
/* js/ui/style.js:255-257 (DESPUÉS) */
.bs-click-catch{position:absolute;left:0;top:0;right:0;bottom:0;z-index:30;display:none;
  flex-direction:column;align-items:center;justify-content:center;gap:10px;cursor:pointer;pointer-events:auto;
  background:rgba(2,5,8,.5);color:#d9f6ff;letter-spacing:.22em;font-size:14px;text-align:center}
```

Una sola declaración (`js/ui/style.js:256`) y el overlay vuelve a ser "tocable".

De hecho `js/ui/style.js:334-335` ya tiene un test de estilo que verifica que las clases obligatorias existen (`'bs-click-catch'` entre ellas); la lección es que *existir* no es lo mismo que *ser funcional*: faltaba comprobar la propiedad.

### 2.6 La API **Pointer Lock**, explicada bien

**Pointer Lock** ("bloqueo del puntero") es una API del navegador que **esconde y captura el cursor** dentro de un elemento (normalmente un `<canvas>`). A partir de ese momento el ratón deja de moverse por la pantalla y el navegador te entrega **los desplazamientos relativos** en cada `mousemove`: `event.movementX` / `event.movementY`. Es la base de cualquier juego en primera persona: sin esto, el puntero toparía con el borde de la ventana.

Piezas de la API:

| Pieza | Qué hace | Dónde está en el proyecto |
|---|---|---|
| `elemento.requestPointerLock(opciones)` | Pide el bloqueo. Devuelve una **promesa** (y además dispara eventos) | `js/core/input.js:234-235` |
| `{ unadjustedMovement: true }` | Pide el movimiento *sin suavizado* del sistema (mejor para apuntar) | `js/core/input.js:234` |
| `document.pointerLockElement` | El elemento bloqueado ahora mismo (`null` si no hay) | `js/core/input.js:151`, `274` |
| evento `pointerlockchange` | Aviso de que el estado cambió → **la fuente de verdad** | `js/core/input.js:71` → `_onLockChange` `150` |
| evento `pointerlockerror` | Aviso de que el intento falló | `js/core/input.js:72` → `_onLockError` `168` |
| `movementX` / `movementY` | Delta del ratón entre `mousemove`s | `js/core/input.js:111` |
| `document.exitPointerLock()` | Suelta el bloqueo (también al pulsar `Escape`) | `js/core/input.js:268-272` |

#### ¿Por qué hace falta un GESTO del usuario?

Por seguridad. Bloquear el ratón es una experiencia "secuestradora": la página controla el cursor y el usuario puede no saber cómo salir. Si una web pudiera activarlo sola, tendrías *clickjacking* (una página tapando el cursor y capturando tus clics sobre otra cosa) y anuncios que secuestran el puntero. Por eso el navegador exige **transient user activation**: la llamada debe ocurrir dentro del procesamiento de un evento real de usuario (un clic, una tecla), y si algún `setTimeout`/`fetch` la retrasa, la activación caduca y la petición se rechaza.

Detalle importantísimo y fuente de bugs sutiles: **un `Promise.then/.catch` es una *microtarea*.** Aunque sea "casi inmediato", ya estás fuera del gesto. Esta frase aparece literalmente en el código del proyecto (`js/core/input.js:251-254`):

> *«NO reintentamos en bucle: una promesa resuelta fuera del gesto sería rechazada igualmente.»*

Otro caso real: tras pulsar `Escape` el navegador impone un **cooldown** (~1 s) en Chrome durante el cual `requestPointerLock()` falla aunque venga de un clic legítimo. Por eso el diseño del proyecto permite reintentar.

#### Flujo correcto completo

```
[usuario hace CLIC en el overlay]
        │
        ▼
js/ui/menu.js:140-149  handler de clic en .bs-click-catch
        │  llamada SÍNCRONA, dentro del gesto ✔
        ▼
js/main.js:137-147  onRequestLock  →  (reanuda el audio) + BS.Input.requestPointerLock()
        │
        ▼
js/core/input.js:216  requestPointerLock()
        ├── pide { unadjustedMovement:true } (o simple si no está soportado)
        ├── promesa .then/.catch
        │
        ▼
evento 'pointerlockchange'  →  js/core/input.js:150 _onLockChange()
        │  document.pointerLockElement === canvas ?  locked = true
        ▼
js/game/game.js:935-945  callback onLockChange(locked)
        └── si locked:  menu.showClickCatch(false)   ← aquí SÍ se quita el overlay
        │
        ▼
js/core/input.js:105-125  _onMouseMove() empieza a usar movementX/movementY
        └── acumula en mouseDX/mouseDY; el juego los consume con consumeMouseDelta()
```

> **Regla de oro:** `requestPointerLock()` es una *petición*; `pointerlockchange` es el *contrato*. Nunca actúes como si el lock estuviera concedido solo porque llamaste a la función.

---

## 3. BUGS EXTRA encontrados durante la verificación

### 3.1 Doble (y triple) conteo de fallos → bandera `_failReported`

**Qué pasaba:** un único intento fallido incrementaba `Input.lockFailures` 2 o 3 veces y mostraba el aviso repetido.

**Por qué:** un fallo se comunica por **dos vías simultáneas**:

* la **promesa rechazada** de `requestPointerLock` → `js/core/input.js:248` (`q.catch(...)` → `onFail` → `_onLockError`);
* el **evento de documento** `pointerlockerror` → `js/core/input.js:72` → `_onLockError`.

Las dos llaman a la misma función de error, así que un solo fallo se contaba dos veces (y si el reintento también fallaba, tres).

**Arreglo** (bandera de "ya avisé en este intento"):

```js
// js/core/input.js:168-184
_onLockError: function (ev) {
  var reason = (ev && ev.type) ? ev.type : 'pointerlockerror';
  if (!Input._failReported) {           // <-- solo se procesa la PRIMERA vez
    Input._failReported = true;
    Input.lastLockError = reason;
    Input.lockFailures++;
    for (var i = 0; i < lockErrSubs.length; i++) { ... }   // avisa a los suscriptores una vez
  }
  Input.locked = false;
  return false;
}
```

Y se **rearma al empezar cada intento nuevo**:

```js
// js/core/input.js:220-222
Input.lockRequests++;
Input.lastLockError = null;
Input._failReported = false;   // un intento = como máximo un fallo reportado
```

> **Concepto general:** esto es un patrón de **"debounce/coalescer" de eventos duplicados**. Aparece mil veces en desarrollo web: `resize`, `scroll`, dobles clics, dobles envíos de formulario. La técnica siempre es la misma: una bandera o un temporizador que absorbe el duplicado.

### 3.2 Reintento asíncrono fuera del gesto del usuario

**Qué pasaba:** si el navegador no soporta `unadjustedMovement`, la primera petición devolvía `NotSupportedError`. El código original reintentaba, pero lo hacía desde el `.catch` de la promesa: **fuera del gesto** → el navegador rechazaba el reintento también, y el usuario veía un error "de ratón" sin haber hecho nada mal.

**Distinción clave que hay que entender:**

* **Rama síncrona** (`js/core/input.js:231-244`): el `requestPointerLock` lanza `TypeError` *cuando el diccionario no está soportado* (navegadores antiguos lo hacen así). Se reintenta **inmediatamente, todavía dentro del gesto** → es legítimo y funciona.
* **Rama asíncrona** (`js/core/input.js:245-261`): el navegador aceptó el diccionario pero devolvió el error por la promesa. Aquí ya has salido del gesto. Reintentar en bucle solo lograría más rechazos y más ruido.

**Arreglo:** marcar el flag y hacer **un único** reintento acotado:

```js
// js/core/input.js:248-260
}).catch(function (err) {
  var name = (err && err.name) || '';
  if (useRaw && !isRetry && name === 'NotSupportedError') {
    Input._rawUnsupported = true;   // los SIGUIENTES gestos irán directos a la variante simple
    ask(false, true);               // un único reintento (isRetry=true evita el bucle)
    return;
  }
  onFail(name || 'rechazado');
});
```

Y la entrada de la función decide el camino sin volver a intentar lo imposible:

```js
// js/core/input.js:264-265
if (Input._rawUnsupported) ask(false, true);
else                       ask(true,  false);
```

El parámetro `isRetry` es lo que garantiza el **límite**: no hay recursión infinita posible. Puedes ver el estado en `BS.Input.debugState().rawUnsupported` (`js/core/input.js:381`).

> **Reflexión de diseño:** un *fallo* tiene dos naturalezas distintas. (A) **Capacidad ausente** (el navegador no soporta X): hay que reaccionar bajando de nivel y recordarlo. (B) **Condición temporal** (cooldown tras `Escape`): hay que dejar que el usuario lo intente otra vez. Mezclarlas produce errores absurdos; separarlas produce este código.

### 3.3 El overlay se ocultaba antes de confirmar el lock

**Antes:** al pulsar el overlay se ocultaba y se pedía el lock "a la vez". Si la petición fallaba (típicamente, cooldown de ~1 s tras `Escape`), el jugador se quedaba **con la partida activa, el overlay fuera y el ratón sin bloquear**: la peor combinación, porque no había forma evidente de volver a intentarlo. (Relacionado con el bug de CSS: incluso sin el fallo de pointer-events, esto era una mala idea.)

**Ahora:** el overlay **solo se retira cuando el navegador confirma**, y mientras siga visible es un "botón gigante" para reintentar:

```js
// js/ui/menu.js:140-149
BS.Util.addListener(S.clickCatch, 'click', function () {
  /* NO ocultamos el overlay aquí: se retira en onLockChange cuando el
   * navegador CONFIRMA el Pointer Lock. Si la petición falla (cooldown
   * tras Escape, etc.) el overlay permanece y el usuario puede reintentar. */
  if (typeof S.cb.onRequestLock === 'function') { ... }
});
```

```js
// js/game/game.js:934-945
BS.Input.onLockChange(function (locked) {
  if (locked) {
    if (ctx.menu && ctx.menu.showClickCatch) ctx.menu.showClickCatch(false); // ahora SÍ
    if (Game.state === STATE.PAUSED && pauseWasLock) Game.resume();
  } else { ... Game.pause('Ratón liberado — pulsa REANUDAR para continuar'); }
});
```

Complemento *hardening* en el mismo overlay (`js/ui/menu.js:150-154`): mientras el overlay está visible, `mousedown`/`mouseup` hacen `stopPropagation()` para que el clic **no llegue a `window`** y no dispare un tiro parásito. Es la otra mitad del bug 2: primero conseguimos que el overlay reciba el clic, y después evitamos que ese mismo clic se propague al sistema de armas.

### 3.4 Red de seguridad global en `js/core/util.js`

**El escenario triste:** un `<script>` con la ruta mal escrita, o un fallo de sintaxis antes de que arranque el juego → página **en negro** con el cursor y cero pistas. El usuario cree que "no funciona" y no hay nada en pantalla que lo explique.

**El arreglo** (`js/core/util.js:419-494`): como `util.js` es el **primer** script de `index.html:15` (y el orden de carga de `index.html:14-37` es obligatorio), es el sitio perfecto para instalar un manejador global **una sola vez**:

```js
// js/core/util.js:481-494
try {
  if (window.addEventListener) {
    window.addEventListener('error', function (ev) {
      try {
        var msg = '';
        if (ev) {
          if (ev.message) msg = String(ev.message);
          else if (ev.target && ev.target.tagName) msg = 'no se pudo cargar un script';
        }
        scheduleBootFailureCheck(msg);
      } catch (e) { /* noop */ }
    }, true);                           // <-- fase de CAPTURA
  }
} catch (e) { /* noop */ }
```

Detalles didácticos importantes:

1. **`true` como tercer argumento = fase de captura.** Los eventos tienen tres fases: *captura* (baja desde `window` hasta el objetivo), *objetivo*, y *burbujeo* (sube de vuelta a `window`). El error de carga de un `<script>` **no burbujea**, así que un listener normal (fase de burbujeo) no lo vería; en captura sí. Esto es un detalle clásico de examen.
2. **`ev.target.tagName`** distingue "no se pudo cargar un recurso" (el target es el `<script>`) de un error de código (donde sí hay `ev.message`).
3. **Es conservador** (documentado en `js/core/util.js:426-431`), y eso es lo profesional. Antes de pintar nada comprueba tres cosas:
   * `window.BS.Main.ready` → si el juego arrancó, no hay nada que avisar (`js/core/util.js:439`);
   * `#bs-root` sin hijos → si ya hay UI construida, tampoco (`js/core/util.js:440-441`);
   * `bootFailShown` → no repite el aviso (`js/core/util.js:437`).
4. **No secuestra el error.** No toca `window.onerror` (que es lo que usa `BS.Debug.captureErrors`, ver `js/core/debug.js:51-52`) ni llama a `preventDefault`, así que la consola sigue mostrando el error original. Una red de seguridad no debe convertirse en una mordaza.
5. **Retardo de 400 ms antes de decidir** (`js/core/util.js:471-479`): `BS.Main.boot()` es síncrono pero corre en `DOMContentLoaded` (`js/main.js:217-225`). Sin esa espera, cualquier error no fatal durante la carga daría un falso "ERROR AL INICIAR".

---

## 4. Cómo depurar esto tú mismo

Guía práctica, en orden. Lo primero SIEMPRE: **F12** (o `Ctrl+Shift+I`) → pestaña **Console**.

### Paso 1 — Leer los errores con el prefijo del juego

Todos los mensajes del motor llevan etiqueta (`js/core/util.js:37-55`): `[BS:error]`, `[BS:warn]`, `[BS:info]`, `[BS:debug]`. En el filtro de la consola escribe:

```
[BS:error]
```

Si no ves nada, sube el nivel de log (por defecto es `2` = warn, `js/core/util.js:29`):

```js
BS.Log.setLevel(4);   // 0=silent 1=error 2=warn 3=info 4=debug
BS.Main.version;      // "1.0.0" si el motor se cargó
```

### Paso 2 — Estado del sistema, de un vistazo

```js
BS.Menu.state();        // { current, built, editable, screens, settings }  (js/ui/menu.js:685)
BS.Input.debugState();  // { locked, keys, lockRequests, lockFailures, lastLockError,
                        //   rawUnsupported, usingMovementXY, ... }        (js/core/input.js:367)
document.pointerLockElement;  // null si el ratón NO está bloqueado
```

Patrón típico de diagnóstico del bug 2:

```js
BS.Input.debugState().lockRequests;   // 0  -> el clic NUNCA llegó a pedir el lock (bug de CSS)
BS.Input.debugState().lockFailures;   // 3  -> se pidió pero el navegador lo rechazó (cooldown/Escape)
```

### Paso 3 — Forzar pantallas a mano (aislar UI de lógica)

```js
BS.Menu.show('settings');   // ¿se ve? -> el DOM y el CSS están bien
BS.Menu.show('main');
BS.Menu.show(null);         // oculta todo
BS.Menu.show('no-existe');  // no hace nada: valida contra SCREENS (js/ui/menu.js:535)
```

Si `BS.Menu.show('settings')` funciona desde la consola pero **no** al pulsar el botón, el problema está en el *handler* (bug 1), no en la UI. Este truco de "probar la misma acción saltándome la capa sospechosa" es oro.

### Paso 4 — La batería de tests automáticos

El motor trae un arnés de tests propio (`BS.Debug`):

```js
BS.Debug.runAllSummary();
// -> { total: N, failed: ['menu:settings', ...], ok: true/false, results: [...] }
```

`runAllSummary` (`js/core/debug.js:160-165`) ejecuta **todos** los tests registrados y te devuelve solo los que fallan; nunca lanza. Para ver el detalle completo, `BS.Debug.runAll()` (`js/core/debug.js:142`). Añadir un test nuevo es siempre el mismo patrón:

```js
BS.Debug.register('mi:test', function () {
  return { ok: true, notas: [] };   // { ok:false, notas:['qué falló'] }
});
```

### Paso 5 — Problemas de CSS / "el clic no llega"

```js
// ¿Qué elemento recibe el clic en este punto?
document.elementFromPoint(400, 300);

// ¿Cuál es el valor REAL de la propiedad (tras herencia y cascada)?
getComputedStyle(document.getElementById('bs-click-catch')).pointerEvents;   // "auto" esperado
getComputedStyle(document.getElementById('bs-click-catch')).display;          // "flex" si el overlay está visible

// ¿Está el overlay "encendido"?
document.getElementById('bs-click-catch').classList.contains('bs-on');
```

Y para saber si un clic llega o no, el clásico *monitor de eventos* (DevTools → pestaña Elements → clic derecho sobre el elemento → **Break on → attribute modifications**, o el `Event Listener Breakpoints` de Sources). Alternativa de una línea en la consola:

```js
window.addEventListener('mousedown', function (e) { console.log('mousedown en', e.target.id || e.target.tagName); }, true);
// Si al pulsar el overlay ves "mousedown en bs-canvas", el overlay NO está recibiendo el clic -> pointer-events.
```

### Paso 6 — Pointer Lock

```js
BS.Input.requestPointerLock();     // pruébalo SIEMPRE desde un clic real, no desde la consola
document.pointerLockElement;       // debe ser el <canvas> si funcionó
BS.Input.isLocked();               // atajo del proyecto (js/core/input.js:274)
```

⚠️ Llamarlo desde la consola de DevTools normalmente **falla**, y es correcto: no hay gesto del usuario. Ese "fallo" te confirma la regla de la sección 2.6.

---

## 5. Preguntas para repasar

**1. ¿Cuál era la diferencia entre `S` y `Menu` en `js/ui/menu.js`, y por qué causó el bug 1?**
`S` es el estado interno privado del módulo (`js/ui/menu.js:49`); `Menu` es el objeto público (`js/ui/menu.js:506`). El código interno llamaba `S.show/S.hide/...`, que no existían → `TypeError`.

**2. ¿Por qué el botón sonaba ("clac") aunque la acción fallara?**
Porque el `try/catch` de `mkButton` (`js/ui/menu.js:106`) atrapa la excepción y el flujo continúa en la línea siguiente (107), que reproduce el sonido de UI. El audio siempre suena; la acción no.

**3. ¿Qué significa "copia una referencia a función" y cuándo es peligroso?**
`S.show = Menu.show` copia el *valor función*, no el cuerpo. Es peligroso si el método usa `this`: cambia el dueño. Aquí es seguro porque ninguno de los cuatro métodos usa `this`.

**4. ¿Por qué un `try/catch` que solo loguea puede empeorar el diagnóstico?**
Porque convierte un *crash* visible en un *fallo silencioso*: el error queda en la consola pero la UI no da ninguna señal, y el usuario cree que "no pasa nada". Mejor: loguear SIEMPRE y cubrir la ruta crítica con un test automático.

**5. ¿Qué es `pointer-events` y cómo se evitó que un elemento visible sea invisible al ratón?**
`pointer-events` decide si un elemento participa en el *hit-testing*. Con `none`, el elemento es invisible al ratón y el evento va al de debajo. Es heredable, así que un hijo debe poner `auto` para "volver a ser tocable" (eso se hizo en `js/ui/style.js:256`).

**6. ¿Qué devuelve `document.elementFromPoint(x, y)` y cómo se usó para diagnosticar el bug 2?**
Devuelve el elemento *topmost* que recibiría el puntero en esas coordenadas. Antes del arreglo devolvía el `<canvas>` en vez de `bs-click-catch`; después, el overlay. Complementario: `getComputedStyle(el).pointerEvents` da el valor efectivo.

**7. ¿Quién confirma que el Pointer Lock está activo: la llamada o un evento?**
Un evento. `requestPointerLock()` devuelve una promesa, pero el estado real se lee en `document.pointerLockElement` y se anuncia con `pointerlockchange`. En `js/core/input.js`, `_onLockChange` (`150`) actualiza `Input.locked` y `js/game/game.js:935-945` decide (ocultar overlay / reanudar / pausar).

**8. ¿Por qué hace falta un gesto del usuario para bloquear el ratón?**
Para evitar *clickjacking* y secuestro del cursor. El navegador exige *transient user activation*: la llamada debe ocurrir en el procesamiento de un evento de usuario. En un `.then/.catch` ya estás fuera del gesto → rechazo.

**9. ¿Por qué un fallo de lock podía contarse 2-3 veces y cómo lo evita `_failReported`?**
Porque el fallo llega por dos vías: el evento `pointerlockerror` (`js/core/input.js:72`) **y** el rechazo de la promesa (`js/core/input.js:248`); ambas llaman a `_onLockError`. `_failReported` (`js/core/input.js:174`) procesa solo la primera y se rearma al inicio de cada intento (`js/core/input.js:222`).

**10. ¿Por qué el listener global de `js/core/util.js` se registra en fase de captura?**
Porque los errores de carga de recursos (`<script>` que no carga) **no burbujean**: solo se pueden interceptar en la fase de captura (`js/core/util.js:492`).

**11. Si llamas a `requestPointerLock()` y lees `document.pointerLockElement` inmediatamente, ¿puede ser `null`?**
Sí. La llamada es asíncrona: el bloqueo se concede después y te enteras por `pointerlockchange`. Ese es el motivo del cambio de la sección 3.3.

---

## 6. Ejercicio propuesto — test de regresión "los botones navegan"

Objetivo: que si alguien vuelve a romper los handlers del menú (o el `pointer-events` del overlay), la suite lo detecte. Añádelo al final de `js/ui/menu.js`, junto al test existente (`js/ui/menu.js:710-761`).

```js
/* Test de regresión: TODOS los botones de navegación del menú deben
 * cambiar de pantalla. Cubre el bug "S.hide is not a function" y, de paso,
 * el CSS del overlay de captura de clic. */
if (BS.Debug && typeof BS.Debug.register === 'function') {
  BS.Debug.register('menu:botones-navegan', function () {
    var ok = true, notas = [];
    try {
      if (!S.built) Menu.init(null);

      // Pulsar un botón POR TEXTO dentro de una pantalla y comprobar destino.
      function pulsa(screenId, texto) {
        var sc = document.getElementById('bs-screen-' + screenId);
        if (!sc) { notas.push('falta pantalla ' + screenId); return false; }
        var bs = sc.querySelectorAll('button');
        for (var i = 0; i < bs.length; i++) {
          if (bs[i].textContent === texto) { bs[i].click(); return true; }
        }
        notas.push('botón "' + texto + '" no encontrado en ' + screenId);
        return false;
      }

      // OJO: no pulsamos JUGAR, porque arranca la partida (efectos colaterales).
      Menu.show('main');
      if (pulsa('main', 'AJUSTES')   && Menu.current() !== 'settings') { ok = false; notas.push('AJUSTES'); }
      Menu.show('main');
      if (pulsa('main', 'CONTROLES') && Menu.current() !== 'controls') { ok = false; notas.push('CONTROLES'); }
      Menu.show('main');
      if (pulsa('main', 'CRÉDITOS')  && Menu.current() !== 'credits')  { ok = false; notas.push('CRÉDITOS'); }

      // El botón VOLVER debe devolvernos a 'main'.
      Menu.show('settings');
      if (pulsa('settings', 'VOLVER') && Menu.current() !== 'main') { ok = false; notas.push('VOLVER'); }

      // Regresión de CSS: el overlay debe RECIBIR clics (bug del pointer-events).
      var cc = document.getElementById('bs-click-catch');
      if (!cc) { ok = false; notas.push('sin overlay'); }
      else if (getComputedStyle(cc).pointerEvents !== 'auto') {
        ok = false; notas.push('overlay con pointer-events≠auto');
      }
    } catch (e) {
      ok = false; notas.push('excepción: ' + (e && e.message ? e.message : e));
    } finally {
      try { Menu.show(null); } catch (e2) { /* noop */ }   // dejar la UI limpia
    }
    return { ok: ok, notas: notas };
  });
}
```

**Por qué este test habría cazado los bugs:**

* Bug 1: `botones[i].click()` dispara el handler; antes del arreglo lanzaba `TypeError` dentro del `try/catch` de `mkButton`, `Menu.current()` no cambiaba → `ok:false, notas:['AJUSTES']`. El test convierte un fallo silencioso en un fallo **detectable**.
* Bug 2 (CSS): `getComputedStyle(cc).pointerEvents` era `"none"` → falla. Y como `getComputedStyle` funciona aunque el overlay esté con `display:none`, el test no necesita mostrarlo.

**Variantes para practicar más:** (a) añade el mismo `querySelectorAll` sobre `#bs-screen-pause`; (b) comprueba `BS.Menu.state().screens.length === 9`; (c) testea el toggle de un ajuste: `pulsa('settings', 'ACTIVADO')` y verifica que `BS.Menu.getSettings().invertY` cambia de valor.

---

## Ideas clave

1. **Un `try/catch` que solo loguea convierte un *crash* visible en un *fallo silencioso*.** El bug 1 es el ejemplo perfecto: la consola decía la verdad, pero nadie la miraba y la UI no daba ninguna señal.
2. **Los nombres de las variables mienten.** Cuatro alias evitan que `S.show` y `Menu.show` se confundan. Regla práctica: si una función vive en un objeto público, llámala por ese objeto (`Menu.hide()`), no por un atajo ambiguo.
3. **CSS controla la *interacción*, no solo el aspecto.** `pointer-events:none` hace que un elemento visible sea invisible al ratón; `document.elementFromPoint()` y `getComputedStyle()` son el microscopio para esto.
4. **Pointer Lock es una petición con gesto obligatorio, confirmada por `pointerlockchange`.** El estado real viene del navegador; nunca lo des por hecho tras llamar a `requestPointerLock()`.
5. **Comprimir eventos duplicados y acotar los reintentos.** `_failReported` (un fallo se cuenta una vez) y `_rawUnsupported + isRetry` (un solo reintento, y nunca fuera del gesto) son dos patrones reutilizables en cualquier proyecto web.
6. **Una red de seguridad, para ser buena, debe ser conservadora.** El aviso global de `js/core/util.js` solo aparece si hay un error, el juego no arrancó, `#bs-root` está vacío y aún no se avisó; y jamás llama a `preventDefault`, para no tapar el error original.

## Para practicar

1. **Test de regresión de navegación:** implementa el test `menu:botones-navegan` de la sección 6 (o mejóralo añadiendo `pause`, `dead` y `victory`), pásalo con `BS.Debug.runAllSummary()` y comprueba que aparece en `results`. Después rompe a propósito una línea (`S.show('tutorial')` → `Tuto.show('tutorial')`) y verifica que el test **falla**: así demuestras que el test sirve de red.
2. **Test de CSS del overlay:** añade al arnés un test que compruebe, usando `getComputedStyle`, que `#bs-ui` es `pointer-events:none` y que `#bs-click-catch`, `#bs-screen-main` y `.bs-overlay` son `auto`. Es la lección del bug 2 convertida en código: *una clase existe* no basta, hay que comprobar que **funciona**.
