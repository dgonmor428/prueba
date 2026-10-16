
# BLACKSITE: LAST SIGNAL — Guía didáctica del código

> Documento para 2.º de DAW. Explica **cómo está hecho** el juego leyendo el código real del repositorio.
> Todas las referencias son del tipo `archivo.js:línea`. Si abres el fichero en tu editor y vas a esa línea, verás exactamente lo que se comenta aquí.

---

## 0. Antes de empezar: qué es este documento y qué no es

Este no es un manual de usuario. Es un **paseo guiado por el código** de un juego 3D que corre en el navegador. Vamos a ver:

1. cómo se arranca una aplicación WebGL "a mano", sin frameworks;
2. cómo se organiza un proyecto grande en muchos ficheros que se comunican entre sí;
3. conceptos de gráficos 3D, física y audio explicados con el código que los implementa.

Nivel de partida: saber HTML/CSS/JS básico y haber visto algo de programación orientada a objetos o al menos funciones y objetos. **No** hace falta saber WebGL ni álgebra lineal: lo iremos introduciendo.

---

## 1. Visión de conjunto

### Analogía

Imagina un **edificio de oficinas prefabricado**: no se construye desde cero en la obra, sino que llegan módulos ya montados y se enganchan entre sí en un orden concreto (primero la estructura, luego la fontanería, luego la electricidad). Si enganchas los módulos en otro orden, la electricidad no llega.

Este proyecto es igual: son **23 ficheros de JavaScript que son 23 módulos independientes**, y **el orden en que se cargan es obligatorio** porque cada uno se "engancha" al anterior a través de una única variable global llamada `BS`.

### Qué es BLACKSITE: LAST SIGNAL

Un FPS (juego de disparos en primera persona) 3D en WebGL que se ejecuta abriendo `index.html` con doble clic, sin servidor. Sus tres restricciones de diseño explican **casi todas** las decisiones del código:

| Restricción | Qué implica en el código |
|---|---|
| Funciona en `file://` (doble clic) | **Nada de `fetch()`** (bloqueado por CORS), nada de módulos ES (`import`/`export` con `file://` falla). Todo se carga con `<script src>`. |
| Sin dependencias externas | No hay Three.js, no hay jQuery, no hay bundler. Las texturas, los sonidos y las mallas geométricas **se generan por código** (procedurales). |
| Un solo `window.BS` | Cada fichero es una función que se ejecuta inmediatamente y añade su API a `window.BS`. Se evita contaminar el ámbito global con cientos de variables. |

### Mapa de módulos

Cada fichero expone una "cajita" con nombre dentro de `BS`. Estas son las 15 cajitas y su responsabilidad:

| Fichero | Expone | Responsabilidad en una frase |
|---|---|---|
| `js/core/util.js` | `BS.Util`, `BS.Math`, `BS.Log`, `BS.RNG` | Utilidades: vectores/matrices, aleatorio con semilla, log, localStorage seguro, DOM |
| `js/core/debug.js` | `BS.Debug` | Ejecuta auto-tests y volcados de diagnóstico |
| `js/core/gl.js` | `BS.GL` | Envoltorio alrededor de WebGL: contexto, shaders, buffers, texturas |
| `js/core/input.js` | `BS.Input` | Teclado, ratón, Pointer Lock |
| `js/core/audio.js` | `BS.Audio` | 39 sonidos sintetizados con Web Audio API |
| `js/core/textures.js` | `BS.Textures` | Texturas y normal maps dibujados en un `<canvas>` 2D |
| `js/render/shaders.js` | `BS.Shaders` | Código GLSL de los 4 programas gráficos |
| `js/render/mesh.js` | `BS.Mesh` | Construye los arrays de vértices (formato de 36 bytes) |
| `js/render/renderer.js` | `BS.Renderer` | Decide qué se dibuja y en qué orden; estadísticas de FPS |
| `js/render/fx.js` | `BS.FX` | Partículas, chispas, humo, sacudida de cámara |
| `js/world/leveldata.js` | `BS.LevelData` | La misión **como datos** (salas, luces, enemigos...) |
| `js/world/level.js` | `BS.Level` | Convierte esos datos en geometría + colisionadores |
| `js/world/physics.js` | `BS.Physics` | Colisiones de cajas, gravedad, escalones, rayos |
| `js/entities/*.js` | `BS.Weapons`, `BS.Enemies`, `BS.Player`, `BS.Projectiles`, `BS.Pickups` | Jugador, armas, enemigos, disparos, objetos recogibles |
| `js/ui/*.js` | `BS.Style`, `BS.HUD`, `BS.Menu` | HUD (mira, vida, munición) y menús |
| `js/game/game.js` | `BS.Game` | El "director de orquesta": estados, oleadas, objetivos |
| `js/main.js` | `BS.Main` | Punto de entrada; arranca todo |

> **Vocabulario — API:** Application Programming Interface, "interfaz de programación". Es el conjunto de funciones y datos que un módulo ofrece a los demás. `BS.Physics.moveBox(...)` es parte de la API de `physics.js`. Si trabajas con PHP, `mysqli_query()` es parte de la API de MySQLi.

**Ideas clave**

- El proyecto es un **conjunto de módulos acoplados por un único objeto global `BS`**, no por `import`/`export`.
- Las restricciones de `file://` y "sin dependencias" son decisiones conscientes, no limitaciones accidentales.
- Cada fichero JS equivale aproximadamente a una "clase de servicio" en una arquitectura por capas.

**Para practicar**

1. Abre `docs/ARCHITECTURE.md` y localiza la sección de "§3.x". Esas secciones (§3.12, §3.17...) son las **especificaciones** que el código referencia continuamente en los comentarios. Busca en el código al menos tres apariciones de `§3.` y comprueba si el comentario coincide con lo que hace el código.

---

## 2. Arranque: `index.html` y `main.js`

### Analogía

`index.html` es el **cuadro de interruptores de la casa**: no hace nada por sí mismo, solo dice qué cables van a qué aparato y en qué orden se encienden. `main.js` es el que **pulsa el interruptor general**.

### 2.1 `index.html`: tres líneas que lo explican casi todo

```html
index.html:11  <div id="bs-root"></div>
```

Todo el juego (el `<canvas>` de WebGL, el HUD, los menús) se inyecta **dentro de ese `div`**. Fíjate en que el HTML está prácticamente vacío: no hay `<canvas>`, no hay botones, no hay nada.

```html
index.html:14  <!-- Orden de carga OBLIGATORIO (§2.1). No reordenar. main.js SIEMPRE el último. -->
index.html:15  <script src="js/core/util.js"></script>
...
index.html:37  <script src="js/main.js"></script>
```

Son **23 etiquetas `<script>` clásicas** (sin `type="module"`). Eso significa que el navegador las ejecuta **en orden, una detrás de otra, de forma síncrona**: cuando empieza a ejecutarse `debug.js`, ya se ha ejecutado entero `util.js`.

El orden real (agrupado por capas) es:

1. **Núcleo**: `util` → `debug` → `gl` → `input` → `audio` → `textures`
2. **Render**: `shaders` → `mesh` → `renderer` → `fx`
3. **Mundo**: `leveldata` → `level` → `physics`
4. **Entidades**: `projectiles` → `weapons` → `player` → `pickups` → `enemies`
5. **Interfaz**: `style` → `hud` → `menu`
6. **Orquestación**: `game` → `main`

Y no es capricho: `renderer.js` usa `BS.Shaders` y `BS.Mesh`, así que necesita que esos ya existan. Por eso los scripts van de "abajo hacia arriba" en la pila de dependencias.

> **Vocabulario — script clásico:** `<script src="x.js">` sin `type="module"`. A diferencia de los módulos ES, no aísla el código en su propio ámbito: comparte el ámbito global y se evalúa en orden.

### 2.2 `main.js`: el interruptor general

`main.js` es el último en cargar y lo primero que hace es... **no hacer nada todavía**, porque el HTML puede no haber terminado de analizarse:

```js
main.js:216    start: function () {
main.js:217      if (typeof document !== 'undefined' && document.readyState === 'loading') {
main.js:219          BS.Util.addListener(document, 'DOMContentLoaded', function () { Main.boot(); });
main.js:223      } else {
main.js:224        Main.boot();
main.js:225      }
main.js:226    },
```

Y justo al final del fichero se auto-arranca:

```js
main.js:236  try {
main.js:237    Main.start();
main.js:238  } catch (e) {
main.js:239    logError('start', e);
main.js:240  }
```

Ese `try/catch` alrededor del arranque es un patrón que verás **constantemente** en este proyecto: *ninguna función de arranque debe poder tumbar la página*. Si algo falla, se registra el error y se sigue.

> **Vocabulario — `DOMContentLoaded`:** evento que dispara el navegador cuando el HTML ya está "leído" y se puede buscar elementos con `document.querySelector`. Es el equivalente al `$(document).ready()` de jQuery.

### 2.3 `boot()`: cinco pasos numerados

```js
main.js:162    boot: function () {
main.js:163      if (booted) return !!Main.ready;   // idempotente
main.js:164      booted = true;
```

Ese `if (booted)` es lo que hace la función **idempotente**: llamarla dos veces no reconstruye el juego (que sería lentísimo y duplicaría el canvas). Es como el botón de "guardar" que se desactiva mientras guarda.

Los cinco pasos están comentados en el propio código:

```js
main.js:167      call(BS.Style, 'inject');          // 1. CSS y estructura DOM
main.js:168      call(BS.Util, 'ensureDOM');
main.js:171      call(BS.Menu, 'init', null);        // 2. pantalla de carga
main.js:176      wireMenu();                          // 3. cablear menú <-> juego
main.js:179      call(BS.Menu, 'setLoadingProgress', 0.4, 'CONSTRUYENDO INSTALACIÓN K-7');
main.js:182      ok = !!(BS.Game && typeof BS.Game.init === 'function' && BS.Game.init());
main.js:199      call(BS.Menu, 'show', 'main');       // 5. menú principal + bucle
main.js:200      startLoop();
```

Dos detalles interesantes:

- Las llamadas se hacen con un ayudante `call()` en lugar de invocar directamente:
  ```js
  main.js:48   function call(obj, method, a, b) {
  main.js:49     if (!obj || typeof obj[method] !== 'function') return null;
  main.js:50     try { return obj[method](a, b); } catch (e) { logError(method, e); return null; }
  main.js:51   }
  ```
  Es defensivo **de verdad**: comprueba que el módulo existe *y* que el método es una función, *y* captura cualquier excepción. Esto permite que si un fichero no se ha cargado, el juego arranque a medias en vez de morir en blanco.
- La pantalla de carga no es decorativa: los porcentajes (`0.12`, `0.4`, `1`) se van mostrando **mientras** se ejecutan trabajos largos (crear texturas, hornear el nivel), así que el usuario ve progreso en vez de una pantalla congelada.

### 2.4 `wireMenu()`: el menú no conoce al juego

```js
main.js:99   function wireMenu() {
main.js:100    if (!BS.Menu || typeof BS.Menu.setCallbacks !== 'function') return;
main.js:101    BS.Menu.setCallbacks({
main.js:103      onStart: function () {
main.js:104        if (BS.Game && BS.Game.start) BS.Game.start();
main.js:105      },
```

El módulo de menús **no sabe nada** de cómo funciona el juego. Solo tiene una lista de "botones" con nombre (`onStart`, `onResume`, `onRestartMission`, `onQuitToMenu`...) y `main.js` es quien les asigna cuerpo.

> **Vocabulario — hook / callback:** un hueco que se deja preparado para que otro módulo lo rellene. Aquí, `Menu.setCallbacks({...})` es un conjunto de *hooks*: el menú llama a `onStart()` cuando el usuario pulsa JUGAR, y quien lo haya rellenado decide qué pasa. Es el mismo concepto que un *listener* de eventos en JavaScript o un *middleware* en Express (aunque el middleware suele además poder continuar o cortar la cadena).

Un caso que da mucha información sobre cómo funciona el navegador:

```js
main.js:137      onRequestLock: function () {
main.js:138        if (BS.Audio) {
main.js:139          call(BS.Audio, 'init');
main.js:140          var pr = call(BS.Audio, 'resume');
```

Este callback se dispara cuando el usuario hace **clic** en el overlay "CLIC PARA BLOQUEAR EL RATÓN". Aquí, y solo aquí, se crea/reanuda el audio. ¿Por qué? Porque los navegadores modernos no permiten reproducir sonido hasta que el usuario interactúa (política de *autoplay*). Es una restricción del navegador que condiciona el diseño.

**Ideas clave**

- Todo el HTML es un `div` vacío; **la interfaz se construye desde JavaScript**.
- El orden de `<script src>` es la "inyección de dependencias" de este proyecto: no hay cargador de módulos.
- `main.js` solo orquesta: no implementa nada del juego, solo llama a `Boot` de cada módulo en orden.
- El patrón `call(obj, 'metodo', ...)` evita que un módulo ausente rompa toda la aplicación.

**Para practicar**

1. En `index.html`, intercambia `js/core/gl.js` y `js/render/renderer.js` (pon el renderer antes) y abre el juego. Observa qué error aparece en la consola (F12). Vuelve a dejarlo como estaba.
2. Busca en `js/` todas las apariciones de `BS.Menu.setCallbacks` y `setCallbacks`. Enumera los nombres de los hooks que existen.

---

## 3. El bucle de juego y la máquina de estados

### Analogía

Un juego es como una **película proyectada fotograma a fotograma**: nadie mueve los objetos en tiempo real, lo que se hace es recalcular la escena y volver a pintarla ~60 veces por segundo. El "bucle de juego" es ese proyector. Y la "máquina de estados" es el **semáforo** que decide qué fotogramas se proyectan: no es lo mismo el menú que una partida en curso.

### 3.1 ¿Con `requestAnimationFrame` o con `setTimeout`?

```js
main.js:32   var useRaf = (typeof requestAnimationFrame === 'function');
main.js:56   function frame(nowMs) {
main.js:57     if (!running) return;
main.js:58     if (useRaf) rafId = requestAnimationFrame(frame);
main.js:59     else rafId = setTimeout(function () { frame(timeMs()); }, 16);
```

- **`requestAnimationFrame`** (rAF) es una función del navegador que le dice: "llámame antes de pintar el siguiente fotograma". Se sincroniza con la pantalla (normalmente 60 Hz) y se **pausa** si la pestaña deja de estar visible. Es el estándar para animaciones y juegos.
- **`setTimeout(…, 16)`** es el plan B: se usa si el navegador no tiene rAF (muy antiguo o entorno de pruebas).

Fíjate en el detalle importante: **la siguiente llamada se programa al principio**, no al final. Así, si el trabajo de este fotograma lanza una excepción, el bucle no se detiene:

```js
main.js:71     try { if (BS.Game && BS.Game.frame) BS.Game.frame(nowMs); }
main.js:72     catch (e2) { logError('frame', e2); }
```

### 3.2 El límite de FPS (la "red de seguridad")

```js
main.js:63     var cap = 0;
main.js:64     try { cap = (BS.Game && BS.Game.fpsCap) ? (BS.Game.fpsCap | 0) : 0; } catch (e) { cap = 0; }
main.js:65     if (cap > 0) {
main.js:66       var interval = 1000 / cap;
main.js:67       if (lastDraw > 0 && (nowMs - lastDraw) < (interval - 0.5)) return;
main.js:68       lastDraw = nowMs;
main.js:69     }
```

Si quieres 30 FPS, el intervalo es `1000/30 = 33.3 ms`. Si desde el último dibujado no han pasado 33 ms, se sale del fotograma sin dibujar nada (`return`). El `- 0.5` es una tolerancia para no perder fotogramas por redondeos.

### 3.3 La máquina de estados

```js
game.js:33   var STATE = {
game.js:34     BOOT: 'boot',
game.js:35     LOADING: 'loading',
game.js:36     MENU: 'menu',
game.js:37     TUTORIAL: 'tutorial',
game.js:38     PLAYING: 'playing',
game.js:39     PAUSED: 'paused',
game.js:40     DEAD: 'dead',
game.js:41     VICTORY: 'victory',
game.js:42     ERROR: 'error'
game.js:43   };
```

Nueve estados. **Todo** el comportamiento del juego depende de en cuál estés: en `MENU` solo se dibuja el fondo, en `PAUSED` se congela la simulación, en `ERROR` se muestra un aviso de WebGL no soportado.

> **Vocabulario — máquina de estados (FSM):** modelo donde la aplicación está siempre en *un* estado de un conjunto finito, y solo cambia de estado mediante transiciones definidas. Se usa muchísimo: pasarelas de pago, control de vuelos, carritos de la compra. `Game.setState(STATE.PLAYING)` (definido en `game.js:1026`) es el único punto de transición.

### 3.4 Paso fijo: por qué la física no usa el tiempo real

```js
game.js:26   var FIXED_DT = 1 / 60;      // duración de un tick lógico: 16.67 ms
game.js:27   var MAX_STEPS = 4;
game.js:28   var DT_MAX_FRAME = 1 / 15;
game.js:29   var MAX_FRAME_GAP = 0.5;
```

Aquí está la idea más importante de todo el bucle, y es la que se pregunta en las entrevistas:

```js
game.js:1294        } else {
game.js:1295          acc += dt;
game.js:1296          var steps = 0;
game.js:1297          while (acc >= FIXED_DT && steps < MAX_STEPS) {
game.js:1298            Game.updateFixed(FIXED_DT);
game.js:1299            acc -= FIXED_DT;
game.js:1300            steps++;
game.js:1301          }
game.js:1302          if (steps === MAX_STEPS) acc = 0;   // evitar "spiral of death"
game.js:1303        }
```

Se llama **paso fijo con acumulador**:

1. Llega un fotograma con un tiempo transcurrido `dt` (variable, porque la máquina del jugador puede tener sobrecarga).
2. Ese tiempo se **acumula** en `acc`.
3. Se ejecutan tantos "ticks" de simulación de duración exacta `FIXED_DT` como quepan en el acumulador.

¿Por qué? Porque si la física usara un `dt` variable, un fotograma lento haría que un enemigo atravesase una pared (túnel), y dos jugadores con ordenadores distintos tendrían físicas distintas. Con paso fijo, **la simulación es determinista**: mismo número de ticks ⇒ mismo resultado.

`MAX_STEPS = 4` y el `acc = 0` final son la **"spiral of death"**: si el juego va tan lento que no le da tiempo a simular, no queremos acumular deuda infinita y entrar en bucle ("no consigo ir rápido porque voy lento"). Se descarta el tiempo sobrante y se acepta que el juego va en cámara lenta, pero avanza.

### 3.5 El tick y el fotograma no son lo mismo

- `updateFixed(dt)` (`game.js:1241`): **simulación**. Mueve jugador, armas, enemigos, proyectiles, pickups, oleadas, cámara. Puede ejecutarse 0, 1, 2, 3 o 4 veces por fotograma.
- `frame(dt)` (`game.js:1278`): **presentación**. Ejecuta los ticks que toque, actualiza menú y HUD, y dibuja una sola vez.

```js
game.js:1289      var simulating = (Game.state === STATE.PLAYING || Game.state === STATE.TUTORIAL);
game.js:1290      if (simulating) { ... }
game.js:1304      } else {
game.js:1305        acc = 0;      // en menú/pausa no se acumula tiempo
game.js:1306      }
```

Ese `acc = 0` del `else` es clave: si estás 5 minutos en el menú de pausa y vuelves, no quieres que el juego simule 18.000 ticks de golpe. Al no acumular, al reanudar empiezas limpio.

### 3.6 `restartMission()`: el bug clásico que el comentario documenta

```js
game.js:1121        /* Volver a jugar: sin esto el estado se queda en 'dead' (o el que fuese)
game.js:1122         * y el botón "REINICIAR MISIÓN" de la pantalla de muerte no reanuda la
game.js:1123         * partida. Limpiamos también el input acumulado y mostramos el HUD. */
game.js:1124        Game.setState(STATE.PLAYING);
game.js:1125        acc = 0;
game.js:1126        if (BS.Input && BS.Input.clearAll) BS.Input.clearAll();
game.js:1127        call(ctx.hud, 'setVisible', true);
game.js:1128        if (ctx.menu) ctx.menu.hide();
```

Lección práctica: **reiniciar una partida no es "volver a llamar a start"**. Hay que devolver el estado a `PLAYING`, vaciar el acumulador de tiempo, limpiar las teclas que se quedaron "pulsadas" en el buffer y volver a mostrar el HUD. En el comentario de `main.js:122` se ve que antes se llamaba a `Game.start()` y eso dejaba el juego muerto.

**Ideas clave**

- El bucle usa `requestAnimationFrame` con plan B de `setTimeout`, y se reprograma **al principio** del fotograma.
- Simulación **a paso fijo** (`1/60 s`) + presentación variable: determinismo y estabilidad.
- `MAX_STEPS` + `acc = 0` evitan la "spiral of death" (deuda de tiempo ilimitada).
- Los 9 estados concentran toda la lógica de "qué se puede hacer ahora".
- Reiniciar no es re-arrancar: hay que resetear estado, acumulador, input y UI.

**Para practicar**

1. En `game.js:26`, cambia `FIXED_DT` a `1 / 10` (10 ticks por segundo) y juega. Describe qué se siente raro y por qué (piensa en el movimiento de la cámara, que se interpola en la presentación).
2. Añade un `console.log(steps)` en `game.js:1301` y observa en la consola de F12 cuántos ticks se ejecutan por fotograma cuando el juego va fluido y cuando abres otra pestaña pesada.

---

## 4. WebGL "a pelo": `gl.js` y `shaders.js`

### Analogía

WebGL es como una **imprenta industrial**: tú no dibujas píxeles, le entregas planchas (los *buffers* de vértices) y ella imprime la tirada. `gl.js` es el operario que habla con la imprenta, y `shaders.js` son las **recetas de tinta**: pequeños programas que dicen cómo calcular el color de cada píxel.

### 4.1 Qué es WebGL, en una frase

Es una API de JavaScript para dibujar gráficos 3D acelerados por GPU. Es de **muy bajo nivel**: tú le das triángulos en arrays de bytes y él los pinta. No hay "objetos 3D", no hay "cámara", no hay "luces": todo eso lo construye el programador (y aquí lo construye este proyecto).

> **Vocabulario — framework:** conjunto de código que aporta la estructura y las decisiones por ti (Angular, Laravel, Unity). Este proyecto **no usa ninguno**: usa la API del navegador directamente. Por eso es un buen ejercicio de lectura, porque no hay "magia" escondida.

> **Vocabulario — shader / programa:** un *shader* es un programa que se ejecuta en la GPU. Hay dos tipos: el **vertex shader** (se ejecuta una vez por vértice) y el **fragment shader** (una vez por píxel). Un par de shaders compilados y enlazados forman un **programa**.

### 4.2 El "contrato de vértice": el corazón de `gl.js`

```js
gl.js:6  *             con `bindAttribLocation` 0..3 ANTES de linkar, helpers de
gl.js:15  *   offset  0 : aPos    FLOAT x3            -> localización 0
gl.js:18  *   offset 32 : aColor  UNSIGNED_BYTE x4 (normalizado) -> localización 3
```

Cada vértice ocupa **36 bytes** con este reparto:

| Offset (bytes) | Atributo | Tipo | Localización |
|---|---|---|---|
| 0 | `aPos` (posición x,y,z) | 3 × float32 (4 B) = 12 B | 0 |
| 12 | `aNormal` (normal x,y,z) | 3 × float32 = 12 B | 1 |
| 24 | `aUV` (coordenadas de textura u,v) | 2 × float32 = 8 B | 2 |
| 32 | `aColor` (RGBA) | 4 × uint8 = 4 B | 3 |
| | | **36 B** | |

A esto se le llama **formato intercalado** (*interleaved*): en lugar de tener cuatro arrays separados (uno de posiciones, otro de normales...), se tiene **un único array donde los datos de cada vértice van juntos**. Es más rápido para la GPU porque lee memoria de forma secuencial.

La implementación de la lectura es esta:

```js
gl.js:580    bindMesh: function (mesh) {
gl.js:583      if (GL._boundMesh === mesh) return true;      // ya está enlazado: no repitas trabajo
gl.js:584      gl.bindBuffer(gl.ARRAY_BUFFER, mesh.vbo);
gl.js:585      gl.enableVertexAttribArray(GL.ATTR.POS);
gl.js:586      gl.vertexAttribPointer(GL.ATTR.POS, 3, gl.FLOAT, false, STRIDE, 0);
gl.js:588      gl.vertexAttribPointer(GL.ATTR.NORMAL, 3, gl.FLOAT, false, STRIDE, 12);
gl.js:590      gl.vertexAttribPointer(GL.ATTR.UV, 2, gl.FLOAT, false, STRIDE, 24);
gl.js:592      gl.vertexAttribPointer(GL.ATTR.COLOR, 4, gl.UNSIGNED_BYTE, true, STRIDE, 32);
gl.js:593      GL._boundMesh = mesh;
```

`vertexAttribPointer(localización, nºComponentes, tipo, normalizar, STRIDE, offset)` se lee así: *"para el atributo 0, lee 3 floats, sin normalizar, saltando 36 bytes entre vértices, empezando en el byte 0"*. El **STRIDE** (36) es la clave del formato intercalado: le dice a la GPU "cada cuántos bytes empieza un vértice nuevo".

Y dos detalles de rendimiento:

- **`GL._boundMesh === mesh` (línea 583):** reconfigurar los punteros de atributos es caro. Si ya está el mismo mesh enlazado, no se hace nada.
- **Dibujado con índices:**
  ```js
  gl.js:601      gl.drawElements(gl.TRIANGLES, mesh.indexCount, mesh.indexType || gl.UNSIGNED_SHORT, 0);
  ```
  En lugar de repetir vértices, se tiene un array de **índices** que dice "triángulo 1 = vértices 0, 5, 6". Un cubo pasa de 36 vértices a 8 vértices + 36 índices.

### 4.3 `bindAttribLocation`: el detalle que rompe WebGL1 en móviles

```js
gl.js:321    * bindAttribLocation se llama SIEMPRE antes de linkProgram.
gl.js:340    gl.bindAttribLocation(prog, GL.ATTR.POS, 'aPos');
gl.js:341    gl.bindAttribLocation(prog, GL.ATTR.NORMAL, 'aNormal');
gl.js:342    gl.bindAttribLocation(prog, GL.ATTR.UV, 'aUV');
gl.js:343    gl.bindAttribLocation(prog, GL.ATTR.COLOR, 'aColor');
```

Normalmente, tras compilar un shader, el driver decide en qué "ranura" (localización) va cada atributo, y tú preguntas cuál te tocó. El problema: **cada driver puede asignar ranuras distintas**, y en algunos móviles el de la posición acababa en la ranura 5 en vez de la 0, rompiendo el formato fijo de 36 bytes.

La solución (usada aquí) es **forzar** las localizaciones **antes** de enlazar el programa. Así el offset 0 es siempre la posición, en cualquier dispositivo.

### 4.4 Los shaders son cadenas de texto

`shaders.js` no contiene ficheros `.glsl`: contiene **arrays de strings unidos con `\n`**:

```js
shaders.js:22  var BASIC_VS = [
shaders.js:23    'attribute vec3 aPos;',
shaders.js:24    'attribute vec3 aNormal;',
shaders.js:25    'attribute vec2 aUV;',
shaders.js:26    'attribute vec4 aColor;',
shaders.js:38    'void main() {',
shaders.js:39    '  vec4 wp = uModel * vec4(aPos, 1.0);',
shaders.js:44    '  gl_Position = uProj * uView * wp;',
shaders.js:45    '}'
shaders.js:46  ].join('\n');
```

Es GLSL ES 1.00 (el "lenguaje de shaders" de WebGL1): sin `#version`, con `attribute`/`varying` en vez de `in`/`out`, y `gl_Position`/`gl_FragColor` como salidas fijas.

**Por qué se escribe en español y con comentarios al lado:** porque es mucho más fácil de leer y de depurar que un fichero externo, y porque así todo el proyecto sigue siendo autocontenido en `file://`.

Hay una limitación del lenguaje que obliga a un truco peculiar:

```js
shaders.js:51    '  if (uLightCount > ' + i + ') {',
shaders.js:57    '    float ndl' + i + ' = max(dot(N, L' + i + '), 0.0);',
shaders.js:61    '  specAcc += uLightColor[' + i + '].rgb * (... pow(max(dot(N, H' + i + '), 0.0), 24.0));',
```

GLSL ES 1.00 **no permite bucles cuyo índice no sea constante** (`for (int i = 0; i < uLightCount; i++)` es ilegal si `uLightCount` es un uniform). Solución: se **desenrolla** el bucle generando código en JavaScript, tres veces (una por luz, `MAX_DYNAMIC_LIGHTS = 3` en la línea 20). Es un ejemplo estupendo de *code generation*.

> **Vocabulario — uniform / attribute / varying:** `attribute` es un dato que llega **desde el buffer, por vértice** (posición, normal). `uniform` es un valor **global igual para todos los vértices** del dibujado (la matriz de proyección, el color de la niebla). `varying` es una variable que el vertex shader **transmite interpolada** al fragment shader.

**Ideas clave**

- Sin framework: WebGL directo, con un envoltorio (`BS.GL`) que fija un **formato de vértice único de 36 bytes**.
- `bindAttribLocation` **antes** de `linkProgram` es lo que hace que el formato funcione en todos los dispositivos.
- El dibujado es **indexado** (`drawElements`) y con caché de estado (`_boundMesh`) para reducir trabajo.
- Los shaders son **strings GLSL ES 1.00**, y las luces se **desenrollan** porque el lenguaje no admite bucles con índice uniforme.

**Para practicar**

1. Copia el array `BASIC_VS` de `shaders.js:22-46` en un bloc de notas, quita los `'` y las comas, y únelo mentalmente línea a línea. Escribe en español qué hace cada línea.
2. En `gl.js`, busca todas las apariciones de `_boundMesh` y explica por qué si se dibujan 100 objetos con el mismo mesh se evita reconfigurar atributos 100 veces.

---

## 5. Geometría: `mesh.js`

### Analogía

Si `gl.js` es la imprenta, `mesh.js` es el **carpintero**: fabrica las planchas (los arrays de bytes) a partir de figuras geométricas. No dibuja nada; solo construye datos.

### 5.1 Constantes

```js
mesh.js:20   var STRIDE = 36;
mesh.js:21   var MAX_VERTS = 65535;   // índices Uint16 (R9)
```

`MAX_VERTS = 65535` no es un número arbitrario: es el máximo que se puede representar con un entero de 16 bits **sin signo** (`Uint16`, 0..65535). Si los índices se guardan como `Uint16Array`, no puedes indexar más allá de 65.535. El "R9" del comentario remite a un *riesgo identificado* en la documentación del proyecto: "usar `Uint32` para índices no está garantizado en WebGL1 sin la extensión `OES_element_index_uint`".

Y en `gl.js` se comprueba precisamente eso:

```js
gl.js:240        c.uintIndex = c.isWebGL2 || !!gl.getExtension('OES_element_index_uint');
```

Es decir: el código **se adapta** a lo que soporte el navegador en vez de asumirlo.

### 5.2 `emit()`: escribir un vértice

```js
mesh.js:79   function emit(b, st, col, em, x, y, z, nx, ny, nz, u, v) {
mesh.js:80     if (b.count >= MAX_VERTS) {
mesh.js:83       BS.Log.error('BS.Mesh: superados ' + MAX_VERTS + ' vértices (índices Uint16). ' + ...
```

`emit` ("emitir") escribe exactamente los 36 bytes que `gl.js:580-594` espera leer. Los parámetros son: el builder, el estado (material, luz), el color, la emisión, la posición, la normal y las coordenadas UV.

Y `buildData()` cierra el círculo convirtiendo los arrays de JavaScript en `Float32Array`/`Uint16Array` listos para subir a la GPU:

```js
mesh.js:636  function buildData(builder) {
mesh.js:643    var bytes = count * STRIDE;
mesh.js:660      var bo = i * STRIDE + 32;     // el color, en el byte 32
mesh.js:688      stride: STRIDE,
```

Fíjate en `660: i * STRIDE + 32`: para el vértice `i`, el color empieza en el byte `i*36 + 32`. Es **exactamente** la aritmética que refleja el `vertexAttribPointer(..., 32)` de `gl.js:592`. Si cambiaras uno de los dos, el juego mostraría colores corruptos: ese es el acoplamiento oculto típico de la programación de bajo nivel (y el motivo por el que el "contrato" está documentado en el encabezado de `gl.js`).

**Ideas clave**

- Toda la geometría del juego se **genera por código**: no hay ficheros `.obj`/`.gltf`.
- El límite de 65.535 vértices viene del tipo `Uint16` de los índices, y el código lo comprueba en vez de asumirlo.
- El formato de 36 bytes es un **contrato** compartido entre `mesh.js` (escritura) y `gl.js` (lectura); romperlo da corrupción visual.

**Para practicar**

1. Calcula a mano el tamaño en bytes de 10.000 vértices con este formato (`10.000 × 36`). Compara con lo que daría un formato *no* intercalado que usara `float32` para el color (`10.000 × (12+12+8+16)`).

---

## 6. El nivel: de datos a mundo

### Analogía

Es la diferencia entre el **plano de un arquitecto** y **el edificio construido**. `leveldata.js` es el plano (papel, coordenadas, "aquí va una sala de 12×8"); `level.js` es el albañil que levanta la geometría, calcula la iluminación y deja los "muros invisibles" para las colisiones.

### 6.1 La misión es un objeto de datos

```js
leveldata.js:899  function buildMission() {
leveldata.js:900    brushes = [];
leveldata.js:901    lights = [];
leveldata.js:902    stats = { rooms: 0, corridors: 0, props: 0, emissive: 0 };
leveldata.js:903  /*__ZONAS__*/
leveldata.js:904    zoneVestibule();
leveldata.js:905    zoneAtrium();
leveldata.js:906    zoneCorridors();
leveldata.js:907    zoneControl();
leveldata.js:908    zoneStorage();
leveldata.js:909    zoneReactor();
leveldata.js:910    zoneBay();
leveldata.js:911    return assemble();
leveldata.js:912  }
```

Ocho funciones de zona (`zoneX()`) que **van rellenando** los arrays globales `brushes` (volúmenes sólidos) y `lights`. Y `/*__ZONAS__*/` (línea 903) es un **marcador** que sugiere que este fichero se generó o se modifica con herramientas; fíjate en que es un buen punto de anclaje para los ejercicios de "añadir una sala".

`assemble()` empaqueta todo el nivel en un único objeto:

```js
leveldata.js:914  function assemble() {
leveldata.js:915    return {
leveldata.js:916      id: 'k7',
leveldata.js:917      name: 'BLACKSITE K-7 — SEÑAL PERDIDA',
leveldata.js:920      seed: 0xB1AC5E,
leveldata.js:921      environment: {
leveldata.js:922        clearColor: [0.02, 0.025, 0.035],
leveldata.js:923        fog: { color: [0.035, 0.055, 0.075], density: 0.030 },
leveldata.js:927        ambient: { sky: [0.62, 0.70, 0.84], ground: [0.17, 0.18, 0.21] },
leveldata.js:934      objectivesIntro: [
leveldata.js:935        { id: 'reach_atrium', label: 'LLEGA AL ATRIO CENTRAL' },
```

`seed: 0xB1AC5E` es la "semilla" del generador aleatorio: un número que, usado con un RNG determinista, produce **siempre la misma secuencia** de valores. Por eso el juego es reproducible (mismo nivel, mismas variaciones de textura) aunque haya aleatoriedad.

> **Vocabulario — datos vs. código (data-driven design):** cuanto más describe el comportamiento con *datos* y menos con *código*, más fácil es añadir contenido sin tocar la lógica. Aquí, "añadir una sala" es añadir una llamada a función que mete datos en un array.

Hay un comentario que merece pararse a leer:

```js
leveldata.js:924        /* El ambiente se aplica DOS veces (horneado en nivel + shader): subirlo
leveldata.js:925         * en los tres sitios (aquí, level.js bakeLights.ambient y renderer.js
leveldata.js:926         * DEFS.AMBIENT_*) para que valga con y sin `environment`. */
```

Traducido: la luz ambiental se aplica en el **vértice** (horneada, al construir el nivel) y otra vez en el **fragment shader**. Por eso, si quieres cambiar el ambiente, hay que tocar **tres sitios** o el resultado no será coherente. Es un ejemplo real de duplicación de una constante de configuración, y el comentario es la "documentación viva" que lo evita convertir en un bug.

### 6.2 La clonación defensiva

```js
leveldata.js:1079  function deepClone(v) {
leveldata.js:1089      o[k] = deepClone(v[k]);
leveldata.js:1103      return deepClone(mission);
```

`build()` devuelve una **copia profunda** de la misión. ¿Por qué? Porque si devolviera siempre el mismo objeto, cualquier módulo que lo modificara (por ejemplo, marcando una zona como "visitada") corrompería el original y la segunda partida saldría distinta. Es el mismo motivo por el que en PHP se usa `clone` o por el que en Java se copian los DTOs.

> **Repaso de vocabulario: copia superficial vs. profunda.** Una copia superficial copia el objeto pero **comparte** los objetos anidados: modificar `copia.environment.ambient` modificaría también el original. Una copia profunda (`deepClone`) recorre el árbol entero y duplica todo.

### 6.3 Chunks: agrupar geometría para no colapsar la GPU

```js
level.js:33   var CHUNK = 32;
level.js:34   var MAX_CHUNK_VERTS = 60000;    /* margen bajo el límite Uint16 (65535) */
```

> **Vocabulario — chunk:** "trozo". El nivel se divide en celdas de `32 × 32 m`; cada celda acumula la geometría que contiene. Es la misma idea que el *tiling* de mapas en 2D.

La lógica de agrupación:

```js
level.js:612    function groupFor(b, matId) {
level.js:628    function flushGroup(g) {
level.js:670        if (g.builder.vertexCount >= MAX_CHUNK_VERTS) flushGroup(g);
```

`flushGroup` "cierra" el grupo actual y lo convierte en un mesh definitivo. El `if` de la línea 670 es un **corte por presupuesto**: cuando un chunk acumula 60.000 vértices (con margen bajo el límite de 65.535), se cierra y se empieza otro. Es la misma estrategia que limitar el tamaño de un lote (*batch*) en un INSERT masivo de SQL.

El comentario del encabezado explica la evolución de `CHUNK` (12 → 24 → 32 m) como consecuencia de un presupuesto: **como máximo ~90 draw calls** en calidad alta. Chunks más grandes = menos draw calls (bueno) pero peor *culling* (ver siguiente apartado) porque un objeto pequeño dentro de un chunk grande obliga a dibujar todo el chunk.

### 6.4 `bakeLights`: hornear la luz en los vértices

```js
level.js:280        var t01 = ny * 0.5 + 0.5;
level.js:281        var r = ground[0] + (sky[0] - ground[0]) * t01;
level.js:285        for (k = 0; k < lights.length; k++) {
level.js:287          var dx = L.pos[0] - px, dy = L.pos[1] - py, dz = L.pos[2] - pz;
level.js:290          if (d2 > rad * rad) continue;              // fuera del radio: no aporta
level.js:293          var att = 1 - d / rad;  att *= att;         // atenuación al cuadrado
level.js:295          var ndl = (dx * nx + dy * ny + dz * nz) / d;   // N·L
level.js:297          var w = att * (0.22 + 0.78 * ndl) * L.intensity;
```

Esto es **iluminación horneada** (*baked lighting*): en lugar de calcular la luz de cada farola en el shader en cada fotograma, se calcula **una sola vez al construir el nivel** y el resultado se guarda en el color del vértice.

- `t01 = ny * 0.5 + 0.5` convierte la componente Y de la normal (que va de −1 a 1) en un valor de 0 a 1. Es el clásico **"ambiente hemisférico"**: las caras que miran hacia arriba (`ny = 1`) adoptan el color del cielo; las que miran hacia abajo (`ny = -1`), el del suelo. Da volumen sin coste alguno en tiempo real.
- La atenuación `att = 1 - d/rad`, elevada al cuadrado, es una caída suave: mucha luz cerca, casi nada en el borde del radio.
- `ndl = N·L` es el **producto escalar** entre la normal y la dirección a la luz. Si vale 0 o menos, la cara está de espaldas a la luz.

Y justo después, oclusión ambiental:

```js
level.js:304        if (useAO) {
level.js:305          /* AO de proximidad: oclusión por cajas cercanas en el hemisferio. */
level.js:307          var qMin = [px - AO_RADIUS, py - AO_RADIUS, pz - AO_RADIUS];
level.js:309          grid.query(qMin, qMax, near);
```

El **AO (Ambient Occlusion)** oscurece las esquinas y rincones, donde no llega tanta luz ambiental. Se implementa consultando los sólidos cercanos en la **rejilla hash** del nivel: si hay mucha geometría alrededor de un vértice, se le resta ambiente. Visualmente es lo que hace que los rincones de un nivel 3D no parezcan planos.

> **Vocabulario — rejilla hash espacial:** estructura de datos para responder rápido a "¿qué objetos hay cerca de este punto?". En lugar de recorrer los 5.000 colisionadores del nivel (búsqueda lineal), se calcula en qué celda cae el punto y se consulta solo esa celda. Es el equivalente en 3D de un índice de base de datos: `SELECT ... WHERE zona = 'x'` frente a un `SELECT *` completo.
>
> **Vocabulario — degradación con gracia (graceful degradation):** en `flushGroup` el AO se desactiva si el presupuesto de calidad es bajo, en vez de fallar. El juego se ve algo peor pero sigue funcionando.

**Ideas clave**

- La misión es un **objeto de datos**; "añadir contenido" = añadir datos, no lógica.
- `deepClone()` evita que el estado de una partida contamine la siguiente.
- El nivel se parte en **chunks** de 32 m para equilibrar "menos draw calls" contra "mejor culling".
- La iluminación estática se **hornea en los vértices** (ambiente hemisférico + luces + AO) y no cuesta nada por fotograma.
- El ambiente se aplica en tres sitios distintos: es una **duplicación documentada**.

**Para practicar**

1. Cambia el `clearColor` y el `fog.density` en `leveldata.js:922-923` a valores extremos (por ejemplo `0.15` de densidad) y observa el efecto en el juego. Explica qué hace exactamente la niebla.
2. Busca `AO_RADIUS` en `level.js` y describe en español, con tus palabras, qué pasaría si lo pusieras a `0` y a `500`.

---

## 7. Renderizado eficiente: `renderer.js`

### Analogía

Tienes 4.000 sillas en un almacén y te piden las 40 que valen para una boda. **No** las llevas todas a la boda: primero descartas por criterio y luego transportas solo las que sirven. Ese "descartar" es el *culling*, y el "transportar" son las *draw calls*.

### 7.1 Frustum culling: descartar lo que no se ve

```js
renderer.js:309  function aabbVisible(aabb) {
renderer.js:326  function collect(src, dst, distanceSort) {
renderer.js:327    for (var i = 0; i < src.length; i++) {
renderer.js:328      var e = src[i];
renderer.js:329      if (!aabbVisible(e.worldAabb)) continue;
renderer.js:330      dst.push(e);
renderer.js:331    }
```

`aabbVisible` responde a la pregunta "¿este objeto cae dentro de lo que ve la cámara?". Para cada objeto se usa su **AABB** (caja envolvente alineada con los ejes): en vez de comprobar la geometría real (carísimo), se comprueba su cajita de 6 planos. Si la caja no se ve, el objeto no se ve.

> **Vocabulario — frustum:** en gráficos 3D, la "pirámide" de visión de la cámara (como el cono de un proyector). Todo lo que queda fuera se puede descartar. *Frustum culling* = descartar por geometría de visibilidad.
>
> **Vocabulario — draw call:** cada orden que se manda a la GPU para que dibuje algo. Es la métrica de rendimiento más importante en 3D: pasar de 500 a 5.000 draw calls suele hundir los FPS, aunque el número de triángulos sea el mismo.

### 7.2 Ordenar antes de dibujar

```js
renderer.js:348  function prepare() {
renderer.js:349    var out = { opaque: [], transparent: [], viewmodel: [], drawCalls: 0, tris: 0 };
renderer.js:350    collect(R._opaque, out.opaque, false);
renderer.js:351    collect(R._transparent, out.transparent, true);
renderer.js:352    collect(R._viewmodel, out.viewmodel, false);
```

Los objetos se clasifican en **tres listas** y cada una se ordena con un criterio distinto:

1. **Opacos** (`distanceSort = false`): se ordenan por **programa shader y material**, no por distancia. Agrupar por programa/material minimiza los cambios de estado de la GPU (que son lo caro, no los triángulos). Es el mismo principio que agrupar filas por índice en un `INSERT ... ORDER BY`.
2. **Transparentes** (`distanceSort = true`): se ordenan **de atrás hacia adelante** (el `b.dist - a.dist` de la línea 333). En 3D, para que el cristal se vea bien, hay que dibujar primero lo de detrás. Es como pintar un cuadro: primero el fondo.
3. **ViewModel** (el arma en tus manos): lista aparte.

```js
renderer.js:788    flush: function () {
renderer.js:791      var plan = prepare();
renderer.js:798      drawList(plan.opaque, R._proj, R._view, null, 'none');
renderer.js:799      drawList(plan.transparent, R._proj, R._view, null, 'alpha');
renderer.js:801      if (plan.viewmodel.length) {
renderer.js:802        BS.GL.clear(null, true);        // limpiar solo la profundidad
renderer.js:805        drawList(plan.viewmodel, R._projVM, R._view, 'viewmodel', 'none');
```

El truco del arma tiene miga: se **limpia el buffer de profundidad** (`clear(null, true)`) y se vuelve a dibujar el viewmodel con **su propia matriz de proyección**. Así el arma nunca "atraviesa" las paredes, aunque esté pegada a la cámara. Es el motivo por el que `prepare()` separa el viewmodel en lugar de meterlo con los opacos.

### 7.3 Autoescalado: bajar resolución para no perder fluidez

```js
renderer.js:32    AUTO_FRAME_BUDGET: 22, // ms: por encima baja resolutionScale (R13)
renderer.js:485      avg > DEFS.AUTO_FRAME_BUDGET && R.resolutionScale > DEFS.RES_MIN) {
renderer.js:486        R.resolutionScale = Math.max(DEFS.RES_MIN, R.resolutionScale - DEFS.AUTO_STEP);
```

Si el tiempo medio por fotograma supera **22 ms** (menos de ~45 FPS), el renderizador **reduce la escala de resolución** (dibuja en un lienzo interno más pequeño y lo estira). Es el mismo truco que los juegos de consola: antes de bajar de 30 FPS, se baja la resolución.

> **Vocabulario — presupuesto de fotograma:** a 60 FPS solo tienes **16,67 ms** para *todo* (simulación + física + audio + dibujado + UI). Los presupuestos por subsistema (22 ms aquí para el render, `MAX_STEPS = 4` en la simulación, `voiceBudget = 24` en audio) son el equivalente a repartir el ancho de banda de una red entre servicios.

**Ideas clave**

- Se descarta por **AABB** contra el frustum antes de dibujar: barato y muy efectivo.
- El orden de dibujado es una decisión de rendimiento: agrupar opacos por material, transparentes de atrás hacia adelante.
- El **viewmodel** se dibuja en una pasada aparte con limpieza de profundidad.
- El **autoescalado de resolución** mantiene la fluidez en hardware lento.

**Para practicar**

1. Pon `DEFS.AUTO_FRAME_BUDGET` a `1` ms en `renderer.js:32` y juega. Activa "MOSTRAR FPS" en ajustes y describe qué pasa con la nitidez de la imagen.
2. Busca dónde se actualiza `R.stats.drawCalls` y anota el valor que muestra el juego en calidad ALTA. Compáralo con el presupuesto de ~90 draw calls documentado en `level.js`.

---

## 8. Física: cajas, escalones, rampas y rayos

### Analogía

En lugar de simular cada átomo de un cuerpo, se simula su **caja de zapatos**: un AABB. Toda la física del juego es "mover la caja de zapatos por el mundo sin que atraviese nada". Es la aproximación que usan muchísimos juegos reales, y es mil veces más rápida y más estable que una física exacta.

### 8.1 Constantes y máscaras

```js
physics.js:24   var SKIN = 0.02;              /* separación de seguridad al detenerse */
physics.js:25   var DEFAULT_STEP = 0.45;      /* altura de peldaño por defecto */
physics.js:27   var MAX_RAY = 512;            /* alcance máximo de un rayo (m) */
physics.js:32   var MASK = { WORLD: 1, ENEMY: 2, PLAYER: 4, PICKUP: 8, PROJECTILE: 16, PROP: 32 };
```

`SKIN = 2 cm` es la separación que se deja al chocar: sin ella, el cuerpo quedaría exactamente pegado al muro y en el siguiente fotograma se detectaría una penetración (el famoso *z-fighting* / temblor). Es como dejar un dedo de hueco al aparcar.

Las **máscaras** son una idea muy reutilizable: en vez de un booleano (colisiona / no colisiona), cada colisionador y cada rayo tienen una **máscara de bits**. Con `flags & mask` se decide si ese rayo "ve" ese objeto:

```js
physics.js:442        if (m && c.flags && (c.flags & m) === 0) continue;
```

Es el equivalente a los `LEFT JOIN`/filtros de SQL: consultar solo las filas de las tablas que te interesan. Por ejemplo, el rayo de un disparo usa `MASK.WORLD | MASK.PROP` para no "chocar" con los enemigos (ellos se comprueban aparte, para poder detectar punto débil).

### 8.2 El orden de resolución: X → Z → Y

```js
physics.js:374  function moveBox(level, body, delta, opts) {
physics.js:408    depenetrate(level, body, r, h);
physics.js:409    sweepHorizontal(level, body, 0, dx, r, h, stepH, res);   // eje X
physics.js:410    sweepHorizontal(level, body, 2, dz, r, h, stepH, res);   // eje Z
physics.js:411    moveY(level, body, dy, r, h, stepH, res, wasOnGround);  // eje Y
```

Tres fases y un orden muy meditado:

1. **`depenetrate`** primero: si por lo que sea el cuerpo ha acabado dentro de un muro (un *túnel* de un fotograma anterior, un spawn mal puesto), se le saca aplicando la **traslación mínima**:
   ```js
   physics.js:156        if (penY <= penX && penY <= penZ) {
   physics.js:158          body.pos[1] += (py >= cy ? 1 : -1) * (penY + SKIN);
   ```
   Se mira cuánto penetra en cada uno de los tres ejes y se empuja por el que **menos** cuesta. Es como desencajar una pieza de Lego: la mueves en la dirección que requiera menos desplazamiento.

2. **Barrido horizontal** en X y en Z **por separado**. Si se movieran a la vez, un desplazamiento en diagonal contra una esquina sería ambiguo.

3. **Y al final**: así, si el jugador sube un escalón durante el barrido horizontal, la gravedad del mismo fotograma se calcula ya desde la posición nueva (no "cae" a través del escalón que acaba de subir).

### 8.3 Barrido exacto: el código que impide atravesar paredes

```js
physics.js:207        var t = M.aabbSweepAABB(_bMin, _bMax, _d3, c.min, c.max);
physics.js:208        if (t >= 0 && t < tBest) { tBest = t; best = c; }
physics.js:216      out.normal[axis] = amount > 0 ? -1 : 1;
physics.js:217      var travel = amount * tBest;
physics.js:218      travel += (amount > 0 ? -SKIN : SKIN);
```

`aabbSweepAABB` resuelve: "si muevo esta caja `delta` en esta dirección, ¿en qué fracción `t` del recorrido toca otra caja?". Ese `t` (de 0 a 1) es la clave: **no se mueve el cuerpo a la posición destino y luego se corrige; se calcula el punto exacto de contacto de antemano**. Por eso el encabezado dice:

```js
physics.js:13   *             El algoritmo es de barrido exacto: no hay túnel a alta velocidad.
```

Ese es el bug clásico de los juegos caseros: mover primero y corregir después permite que un proyectil rápido "salte" un muro fino (túnel). Aquí hay incluso un test que lo verifica:

```js
physics.js:718    BS.Debug.register('physics:noTunnel', function () {
physics.js:721      var res = moveBox(lv, b, new Float32Array([100, 0, 0]), { gravity: 0, stepHeight: 0.45 });
```

Un desplazamiento de **100 metros en un solo fotograma** contra un muro de 0,4 m, y el test comprueba que el cuerpo se queda justo antes (`b.pos[0] > 19.0 && b.pos[0] < 20.0`, líneas 726).

### 8.4 Escalones: subir sin saltar

```js
physics.js:265      /* --- intento de subir un peldaño ---
physics.js:266       * Sólo se avanza un poco más allá del punto de contacto (nunca el delta
physics.js:267       * completo): así no se "salta" un muro alto ni un obstáculo fino. */
physics.js:268      if (stepH > 0) {
physics.js:270        var adv = Math.min(Math.abs(amount - contact), r + 0.05);
physics.js:276        if (fits(level, nx, liftFeet + h * 0.5, nz, r, h)) {
physics.js:279          if (isFinite(sup) && sup >= feet + 0.02) {
```

El algoritmo de *step-up* es bonito porque es fácil de explicar mal: **no** se "desliza" al jugador hacia arriba. Se hace:

1. Se calcula el punto de contacto (`contact`).
2. Se avanza **solo `r + 0.05` metros** más allá de ese contacto (línea 270). La cámara de aire es minúscula.
3. Se prueba si el cuerpo **cabría** a la altura del peldaño (`fits`).
4. Se comprueba que existe un suelo **real y más alto que los pies** (`sup >= feet + 0.02`, línea 279).

Ese `Math.min(..., r + 0.05)` es lo que evita la trampa obvia: si avanzaras el delta completo "hacia arriba", podrías atravesar un muro alto saltándolo. Y el conjunto de tests lo verifica con un escalón de 0,40 m (se sube, `physics:step` línea 694) y una repisa de 0,80 m (no se sube, línea 704).

### 8.5 Rampas: suelo que no bloquea

```js
physics.js:12   * Notas     : RAMPS = soporte vertical (nunca bloquean lateralmente).
physics.js:86   function rampSurfaceY(c, x, z) {
physics.js:96     return c.y0 + (c.y1 - c.y0) * t;
```

Una rampa es una caja "especial": en vez de bloquear como un muro, devuelve **una altura en función de la posición** (`rampSurfaceY`). Por eso en todas las consultas aparece:

```js
physics.js:126        if (c.type === 'ramp') continue;   /* las rampas no bloquean */
physics.js:203        if (c.type === 'ramp') continue;
```

Es una decisión de diseño que simplifica muchísimo: no hay que resolver "colisión con plano inclinado", solo "¿a qué altura está el suelo aquí?".

### 8.6 Rayos: munición, IA y linterna

```js
physics.js:421  function raycast(level, origin, dir, maxDist, mask) {
physics.js:438      var m = (mask === undefined || mask === null) ? (MASK.WORLD | MASK.PROP) : (mask | 0);
physics.js:443        var t = M.rayAABB(origin, _d3, c.min, c.max, limit);
```

Un **raycast** lanza un rayo desde un punto (`origin`) en una dirección y devuelve qué ha golpeado, dónde y con qué normal. Se usa para: armas *hitscan* (disparos instantáneos), línea de visión de los enemigos, y detección de paredes para el arma.

Detalle a destacar: los resultados son **objetos nuevos** (`new Float32Array([...])`, línea 471) mientras que internamente se usan **buffers reutilizados** del módulo (`_qOut`, `_bMin`, `_d3`, líneas 35-41). Y el encabezado avisa:

```js
physics.js:14   *             Reutiliza buffers scratch de módulo: los arrays devueltos por
physics.js:15   *             raycast() son NUEVOS (seguros de guardar), pero no son
physics.js:16   *             reentrantes entre llamadas anidadas.
```

> **Vocabulario — buffer scratch (o "de trabajo"):** memoria temporal que se reutiliza para no crear objetos nuevos en cada fotograma. Crear y destruir miles de arrays por segundo activa el *garbage collector* y provoca tirones. Es el mismo motivo por el que en PHP se evita concatenar cadenas en un bucle de 100.000 iteraciones.
>
> El precio: la función **no es reentrante**, es decir, no puedes llamarla "desde dentro" de otra llamada a la misma función y esperar que los datos sigan siendo válidos. El test `physics:noTunnel` documenta ese peligro en un comentario precioso (`physics.js:722-724`).

### 8.7 Separación entre enemigos

```js
physics.js:541  function resolveOverlaps(level, bodies, iterations) {
physics.js:556        var d2 = dx * dx + dz * dz;
physics.js:562        var push = (minD - d) * 0.5 + 0.005;
physics.js:563        a.pos[0] += nx * push; a.pos[2] += nz * push;
```

Los enemigos empujan a sus vecinos para no amontonarse, repartiendo el desplazamiento **a medias** entre los dos (de ahí el `* 0.5`). Se repite `iterations` veces (por defecto 2) porque mover a un cuerpo puede crear un solape nuevo: es una **solución relajada**, no exacta, y es lo estándar en motores de juego.

**Ideas clave**

- Todo son **AABB** (cajas alineadas con los ejes): la aproximación que hace viable una física rápida.
- Resolución **por ejes** (X → Z → Y) con `depenetrate` como red de seguridad.
- **Barrido exacto** (`t` de 0..1) en lugar de "mover y corregir": eso es lo que impide atravesar paredes.
- Las **rampas** no bloquean: solo aportan altura de suelo. Simplifica muchísimo el código.
- Las **máscaras de bits** permiten que un rayo ignore selectivamente tipos de objeto.
- Los buffers reutilizados ganan rendimiento pero crean una obligación de reentrada que hay que documentar.

**Para practicar**

1. En `physics.js:25`, cambia `DEFAULT_STEP` de `0.45` a `0.05` y juega. ¿Qué le pasa al jugador cuando intenta subir un pequeño desnivel? Vuelve a dejarlo.
2. Abre el juego, abre la consola de F12 y ejecuta `BS.Debug.run('physics:noTunnel')`. Lee el objeto que devuelve e interpreta cada campo (`wallHit`, `stoppedX`, `rayT`...).

---

## 9. Entidades: armas, enemigos e IA sin `navmesh`

### Analogía

Un arma y un enemigo son **fichas técnicas de una tienda online**: un formulario con campos ("daño: 26", "cadencia: 320 RPM"). El código que los hace funcionar es genérico y lee esos campos. Por eso añadir un arma nueva es **rellenar una ficha**, no programar un arma nueva.

### 9.1 Las armas son datos (`weapons.js`)

```js
weapons.js:28   var DEFS = {
weapons.js:30     1: {
weapons.js:31       slot: 1, id: 'pistol', name: 'MK-7 "VECTOR"',
weapons.js:32       ammoType: 'light', mode: 'semi', fireKind: 'hitscan',
weapons.js:33       damage: 26, headshotMul: 1.8, pellets: 1, rpm: 320,
weapons.js:34       magSize: 12, reserveMax: 120, startReserve: 60,
weapons.js:35       reloadTime: 1.25, reloadEmptyExtra: 0.35, range: 90,
weapons.js:36       baseSpread: 0.35, spreadPerShot: 0.9, spreadMax: 3.2, spreadRecover: 6.5,
weapons.js:45       sfx: { fire: 'pistol', reload: 'reload_in', empty: 'empty_click', impact: 'hit_world' },
weapons.js:46       hudColor: [1.0, 0.85, 0.4]
weapons.js:47     },
```

Fíjate en todo lo que se puede configurar sin tocar una sola línea de lógica:

- **`mode: 'semi'` vs `'auto'`**: semiautomático (una pulsación = un disparo) o automático (mantener pulsado). La pistola es `semi`; el subfusil (`weapons.js:52`) es `auto`.
- **`fireKind: 'hitscan'`**: disparo instantáneo por rayo. El plasma usa proyectil real.
- **`spreadPerShot` / `spreadRecover`**: la dispersión aumenta al disparar y se recupera con el tiempo. Así, disparar en ráfaga es menos preciso que disparar pausado, sin necesidad de ninguna fórmula especial.
- **`sfx`**: los **nombres** de los sonidos del catálogo de `audio.js`. El arma no sabe sintetizar sonido; solo pide `'pistol'`.
- **`viewmodel`** (líneas 40-44): posición, escala, retroceso, oscilación, y el punto del cañón donde aparece el fogonazo. Todo relativo a la cámara.

Y el modelo 3D del arma se construye por código:

```js
weapons.js:174  function buildViewmodel(cfgId) {
```

Es decir: la "pistola" que ves en pantalla es un conjunto de cajas generadas con `BS.Mesh`.

### 9.2 Los enemigos también son datos (`enemies.js`)

```js
enemies.js:69   var DEFS = {
enemies.js:70     drone: {
enemies.js:72       hp: 40, radius: 0.45, height: 0.6, headY: 0.02, centerY: 1.9,
enemies.js:73       speed: 2.8, strafeSpeed: 3.4, hover: true, gravity: 0,
enemies.js:74       sight: 28, coneDeg: 110, hearing: 14,
enemies.js:75       attack: {
enemies.js:76         kind: 'projectile', damage: 18, speed: 24, homing: 0.5,
enemies.js:77         cooldown: 1.8, range: 26, life: 4.0, radius: 0.30, lightRadius: 4
enemies.js:78       },
enemies.js:79       weakMul: 2.0, weak: 'core', staggerMin: 8,
```

Compara con el bruto:

```js
enemies.js:96     brute: {
enemies.js:98       hp: 220, radius: 0.7, height: 2.3, headY: 0.42, centerY: 1.2,
enemies.js:99       speed: 2.3, hover: false, gravity: 22,
enemies.js:100      sight: 26, coneDeg: 60, hearing: 24,
enemies.js:102      attack: { kind: 'slam', damage: 34, range: 2.6, cooldown: 2.6, ... },
enemies.js:105      weakMul: 2.5, weak: 'radiator', staggerMin: 999,
```

Los tres enemigos comparten **la misma lógica** y se diferencian por sus números:

| | drone | stalker | brute |
|---|---|---|---|
| HP | 40 | 55 | 220 |
| Cono de visión | 110° | 80° | 60° |
| Ataque | proyectil teledirigido | cuerpo a cuerpo con embestida | golpe en área (`slam`) |
| Punto débil | `core` (×2,0) | cabeza (×2,2) | radiador (×2,5) |
| `staggerMin` | 8 | 12 | **999** (nunca se tambalea) |

`staggerMin: 999` es un ejemplo excelente de diseño por datos: el bruto no se tambalea nunca, y en vez de escribir un `if (id === 'brute')` se pone un número imposible.

### 9.3 ¿Cómo se mueven por el nivel sin `navmesh`?

```js
enemies.js:10  *             oleada. Expone también el raycast de disparos y el reparto de
```

**Aquí está la decisión técnica más interesante del proyecto.** Los motores "de verdad" (Unity, Unreal) usan un **navmesh**: una malla de zonas transitables precalculada sobre la que se traza la ruta con A*. Este proyecto **no** lo usa. En su lugar, los enemigos se guían con tres capas sencillas:

**(a) Percepción: cono de visión + línea de visión real**

```js
enemies.js:539      if (!c || !c.level || !BS.Physics || typeof BS.Physics.raycast !== 'function') return true;
enemies.js:546      try { hit = BS.Physics.raycast(c.level, from, sc.v, dist - 0.05, mask); } catch (ex) { hit = null; }
```

No basta con estar dentro del cono (`coneDeg`) y del alcance (`sight`): hay que **comprobar con un rayo** que no hay una pared en medio. Eso es línea de visión (LOS, *Line Of Sight*).

**(b) Movimiento con "bigotes" (wall-slide)**

```js
enemies.js:678        var a = e.avoidSign * 0.70; // ~40°
enemies.js:830        var a = e.avoidSign * 0.7, ca = Math.cos(a), sa = Math.sin(a);
```

Cuando el enemigo choca, gira su dirección de avance unos 40° (`0.70 radianes ≈ 40°`) hacia un lado u otro. Ese giro se aplica **lateralmente**, así se desliza a lo largo de la pared en lugar de quedarse clavado. Es exactamente el comportamiento de "rozar la pared" que hace que el jugador pueda escapar corriendo pegado a un muro.

El lado hacia el que gira se guarda en `avoidSign`:

```js
enemies.js:480          avoidSign: rand() < 0.5 ? -1 : 1,
```

Aleatorio al nacer, lo que evita que todos los enemigos de una oleada giren en el mismo sentido y se comporten como un rebaño.

**(c) Anti-atasco: la red de seguridad**

```js
enemies.js:41     MAX_AVOID_ATTEMPTS: 2,       // tras N intentos -> search + reposición
enemies.js:863  function updateStuck(e, dt) {
enemies.js:879        e.avoidSign = -e.avoidSign;
enemies.js:881        if (e.stuckAttempts > CONFIG.MAX_AVOID_ATTEMPTS) {
```

`updateStuck` mide si el enemigo se ha movido lo suficiente en los últimos instantes. Si no:

1. Cambia de lado (`avoidSign = -avoidSign`), porque quizá está girando hacia el lado bloqueado.
2. Si tras `MAX_AVOID_ATTEMPTS = 2` intentos sigue atascado, se rinde y vuelve al estado `search` (buscar al jugador), con reposición.

Los estados del enemigo (`search`, `chase`, `attack`, `stagger`...) forman **otra máquina de estados**, esta vez dentro de cada enemigo. Un enemigo mal atascado en una esquina es el *bug* más frecuente de la IA sin navmesh, y aquí está resuelto explícitamente.

### 9.4 Disparos: dos tecnologías, una API

- **Hitscan**: `BS.Physics.raycast` desde la cámara. Instantáneo. Pistola y subfusil.
- **Proyectil**: una entidad con posición y velocidad que se mueve por fotograma y colisiona (`js/entities/projectiles.js`). El plasma y los disparos del drone.

Que el `fireKind` sea un campo de datos permite que **ambos** se disparen con el mismo código de arma: solo cambia la rama que crea la "cosa que hace daño".

**Ideas clave**

- Armas y enemigos son **fichas de datos** (`DEFS`); la lógica es genérica y lee esos campos.
- Diferencias de comportamiento se consiguen con **valores**, no con `if (id === ...)`.
- **No hay navmesh**: percepción por cono + rayo (LOS), esquiva por "bigotes" con `avoidSign` y `updateStuck` como red de seguridad.
- `MAX_AVOID_ATTEMPTS` es un patrón anti-bloqueo: reconocer el fallo y hacer algo distinto en lugar de insistir.

**Para practicar**

1. Cambia en `enemies.js:72` el `hp` del drone a `1` y su `speed` a `8`, y juega una oleada. Comprueba que no has tocado *ni una línea* de lógica.
2. Explica en tres frases por qué un enemigo con `coneDeg: 60` (el bruto) tarda más en detectarte que uno con `110` (el drone), suponiendo el mismo `sight`.

---

## 10. Audio procedural, interfaz y pruebas

### Analogía

- **Audio procedural:** en lugar de comprar un CD, fabricas el instrumento. No hay ni un solo `.mp3` en el proyecto: hay **39 recetas** que se sintetizan en el navegador.
- **Interfaz:** en lugar de tener el HTML escrito, el juego "imprime" sus menús con JavaScript (como generar un PDF a partir de una plantilla).
- **Tests:** en lugar de comprobar a mano si la física funciona, el código **se examina a sí mismo**.

### 10.1 Catálogo de sonidos (`audio.js`)

```js
audio.js:17   var NAMES = [
audio.js:18     'pistol', 'smg', 'plasma', 'plasma_impact', 'shell_drop', 'empty_click', 'reload_out', 'reload_in',
audio.js:19     'hit_world', 'hit_flesh', 'hitmarker', 'kill_confirm', 'explosion', 'footstep', 'land', 'jump',
audio.js:22     'ambient_hum', 'ambient_wind', 'alarm_loop',
audio.js:23     'music_menu', 'music_combat', 'heartbeat', 'shield_break'
audio.js:24   ];
```

39 nombres. Y cada uno es una **receta** = lista de capas que se suman:

```js
audio.js:35     pistol: {
audio.js:36       bus: 'sfx', tag: 'weapon', gain: 1.0, layers: [
audio.js:37         { k: 'osc', w: 'triangle', f0: 330, f1: 70, dur: 0.11, gain: 0.50, atk: 0.001 },
audio.js:38         { k: 'noise', rate: 1.45, dur: 0.10, gain: 0.55, filt: 'lowpass', fc0: 2600, fc1: 400, q: 1.1 }
audio.js:39       ]
audio.js:40     },
```

Se lee literalmente: *"el disparo de pistola es un oscilador triangular que baja de 330 Hz a 70 Hz en 0,11 s (el golpe) + un ruido blanco filtrado con paso bajo de 2600 a 400 Hz (la explosión del aire), mezclados"*. Dos capas, 30 ms de código, cero ficheros.

> **Vocabulario — Web Audio API:** API del navegador para generar y procesar audio en tiempo real mediante un **grafo de nodos**: osciladores → filtros → ganancias → destino. Es "síntesis modular programada" (como un sintetizador Eurorack, pero en JS).
>
> **Vocabulario — procedural:** generado por algoritmo en tiempo de ejecución en vez de cargado desde un fichero. Texturas procedurales, sonidos procedurales, geometría procedural.

Nodos que se usan: `OscillatorNode` (tono), `AudioBufferSourceNode` (ruido), `BiquadFilterNode` (filtro), `GainNode` (volumen), `StereoPannerNode` (paneo), `DynamicsCompressorNode` (compresor).

**El modulador de amplitud** merece un apartado: existe una capa de tipo `'am'` que no es una fuente de sonido, sino un oscilador de baja frecuencia (LFO) que **modula la ganancia** de la voz:

```js
audio.js:214      bus: 'sfx', tag: 'ambient', gain: 0.9, loop: true, layers: [
audio.js:217        { k: 'am', w: 'sine', freq: 7.5, depth: 0.35 }
```

Ese es el `drone_hover`: un zumbido de 118 Hz con un "wobble" a 7,5 Hz... que es exactamente cómo se siente el rotor de un dron. Y en el bucle de implementación:

```js
audio.js:660        if (L.k === 'am') {
audio.js:662            var lfo = c.createOscillator();
audio.js:667            lfo.connect(lg);
audio.js:668            lg.connect(voiceGain.gain);   // ¡modulando una ganancia con otro nodo!
```

Conectar un nodo a un **parámetro** (`.gain`) en lugar de a otro nodo es la característica estrella de Web Audio: **todo es modular**.

### 10.2 La política de autoplay, bien resuelta

```js
audio.js:472        if (Audio.ctx.state !== 'running') { Audio.lastPlayError = 'contexto ' + Audio.ctx.state; return null; }
```

**Ninguna función de audio lanza excepción**: si el contexto no está activo, devuelve `null` y anota el motivo en `lastPlayError`. Y el `resume()` solo se llama desde un clic real (`main.js:137`). Esto es exactamente cómo hay que tratar una restricción de plataforma: **hacerla explícita y modificable, no intentar engañarla**.

```js
audio.js:9    *             Ninguna llamada lanza: si no hay AudioContext o está `suspended`
audio.js:10   *             devuelve null (política de autoplay, R5).
```

### 10.3 Presupuesto de voces (con expulsión de la peor)

```js
audio.js:503        if (Audio.voices.length >= Audio.voiceBudget) {
audio.js:504          var worstIdx = -1, worstScore = Infinity;
audio.js:507            if (v.tag === 'music') continue;      // la música no se expulsa nunca
audio.js:508            var score = v._effGain;
audio.js:510            if (score < worstScore) { worstScore = score; worstIdx = i; }
audio.js:512          Audio.voices[worstIdx].stop(0.03);
```

Con más de 24 sonidos simultáneos, se busca el **menos audible** (el de menor ganancia efectiva, que normalmente es el más lejano) y se corta con un *fade* de 30 ms. Es un sistema de **robo de voces** (*voice stealing*), exactamente el mismo concepto que un caché LRU: cuando se llena, se expulsa el menos útil.

### 10.4 La interfaz se construye desde JS (`menu.js`)

```js
menu.js:8  *             TODO el DOM se crea desde JS dentro de #bs-ui; no hay HTML suelto.
menu.js:20   var SCREENS = ['loading', 'main', 'settings', 'controls', 'credits', 'tutorial',
menu.js:21     'pause', 'dead', 'victory'];
menu.js:73   function el(tag, className, text) {
menu.js:74     var e = document.createElement(tag);
menu.js:75     if (className) e.className = className;
menu.js:76     if (text !== undefined && text !== null) e.textContent = text;
menu.js:77     return e;
```

Nueve pantallas y un pequeño ayudante `el()` que sustituye a lo que harías con jQuery (`$('<div class="x">')`). Todo el HUD de ajustes sale de una **lista de widgets**:

```js
menu.js:25     { section: 'CONTROL', key: 'sensitivity', type: 'range', label: 'SENSIBILIDAD DEL RATÓN', min: 0.0004, max: 0.006, step: 0.0001, fmt: function (v) { return (v * 1000).toFixed(2); } },
menu.js:33     { section: 'VÍDEO', key: 'quality', type: 'select', label: 'CALIDAD GRÁFICA', options: [['auto', 'AUTO'], ['low', 'BAJA'], ['medium', 'MEDIA'], ['high', 'ALTA']] },
menu.js:41     { section: 'JUGABILIDAD', key: 'difficulty', type: 'select', label: 'DIFICULTAD', options: [['normal', 'NORMAL'], ['hard', 'DIFÍCIL']] }
```

Un widget = una fila de ajustes. Añadir un ajuste nuevo es **añadir un objeto a ese array**. El DOM se genera iterando. Esto es el mismo patrón de "formularios generados a partir de un array de campos" que se usa en tantos paneles de administración web.

Y la persistencia usa `localStorage` con reserva:

```js
menu.js:89       S.settings = (BS.Util && BS.Util.loadSettings) ? BS.Util.loadSettings() : {};
```

> **Vocabulario — localStorage:** almacén clave-valor del navegador, persistente y sin caducidad, con unos 5 MB por origen. Es al `sessionStorage` lo que un archivo es a una variable: sobrevive al cierre de la pestaña. Ojo: **en `file://` algunos navegadores lo bloquean o lo comparten raro**, y por eso el proyecto usa `BS.Util.tryLocalStorageGet/Set` (con reserva en memoria en `util.js`) y `loadSettings()` en vez de `localStorage.getItem()` directo.
>
> **Nota sobre ORM:** en este proyecto **no hay ORM** (Object-Relational Mapping) porque **no hay base de datos**: el estado se guarda en `localStorage` como un objeto JSON. Un ORM (Hibernate, Eloquent, Prisma) es la capa que traduce entre tus clases y las tablas de una base de datos relacional; aquí la "base de datos" son dos o tres claves del navegador.

### 10.5 El código se examina a sí mismo (`debug.js`)

```js
physics.js:639    if (BS.Debug && typeof BS.Debug.register === 'function') {
physics.js:641      BS.Debug.register('physics:landing', function () {
physics.js:718      BS.Debug.register('physics:noTunnel', function () {
```

Cada módulo puede **registrar sus propias pruebas**, que se ejecutan a demanda desde la consola o desde la herramienta de desarrollo. El test construye un **nivel mínimo** (`miniLevel()`, `physics.js:595`) con un suelo, un escalón de 0.40 m, un muro, una rampa, una repisa de 0.80 m... y comprueba comportamientos concretos:

```js
physics.js:700        var climbed = Math.abs(feet - 0.4) < 0.05;
physics.js:703        var ok = res.steppedUp && climbed && advanced && grounded;
```

Fíjate en que el nivel de pruebas se construye **a mano y sin GPU** (`physics.js:594: "Nivel mínimo determinista para los tests (sin GPU ni LevelData)"`): la física se puede probar en cualquier sitio porque no depende de WebGL.

Hay un detalle muy real documentado en un comentario:

```js
physics.js:722       /* moveBox devuelve el objeto COMPARTIDO _res: hay más abajo otra llamada
physics.js:723        * a moveBox (bloque b3) que lo machaca antes de que leamos el resultado.
physics.js:724        * Copiamos los campos relevantes a locales justo tras la primera llamada. */
physics.js:725       var wallHit = res.wallHit;
```

Es el peligro de los buffers compartidos que veíamos en el apartado 8, ¡cometido y luego corregido dentro del propio test! No hay mejor ejemplo de por qué los *tests* valen para documentar las trampas de un diseño.

También hay un caso de **dependencia de orden de carga resuelta elegantemente**:

```js
physics.js:750    } else if (BS.Log && BS.Log.warn) {
physics.js:751      BS.Log.warn('BS.Debug no disponible al cargar physics.js: los tests physics:* no se registran');
```

Y en `util.js`, el módulo `BS.Debug` **todavía no existe** cuando se carga (recuerda el orden de `index.html`: `util` va antes que `debug`), así que las peticiones de test se dejan en una **cola** (`BS._pendingTests`) que `debug.js` vacía cuando se carga. Es el patrón "publicar cuando el suscriptor no está listo".

**Ideas clave**

- **Cero ficheros de audio**: 39 sonidos sintetizados con osciladores, ruido, filtros y envolventes.
- El audio **nunca lanza excepción**: devuelve `null` y documenta el motivo (política de autoplay).
- **Presupuesto de voces** con expulsión de la voz menos audible.
- La UI se **genera desde arrays de datos** (`WIDGETS`, `SCREENS`), no desde HTML escrito a mano.
- Los módulos **registran sus propios tests**; el nivel de pruebas es determinista y sin GPU.
- El orden de carga se resuelve con **colas diferidas** (`BS._pendingTests`) y avisos claros.

**Para practicar**

1. Genera un sonido nuevo: copia la receta de `pistol` (`audio.js:35`), llámala `prueba`, y desde la consola de F12 ejecuta `BS.Audio.play('prueba')` después de hacer clic en la página. Cambia `f0` y `f1` y vuelve a probar.
2. Desde la consola, ejecuta `Object.keys(BS.Debug)`, encuentra la función que lanza todos los tests y ejecútala. Anota cuántos tests pasan y de qué módulos son.

---

## 11. Cómo añadirías algo

Los tres ejercicios siguientes son, por orden, de menos a más trabajo. Todos siguen la misma filosofía del proyecto: **añade datos, no lógica**.

### 11.1 Añadir un arma nueva (fácil)

1. Abre `js/entities/weapons.js` y busca `var DEFS = {` (línea 28).
2. Copia el bloque completo de la pistola (líneas 30-47) y pégalo justo después, cambiando la clave del objeto (`1:` → `4:`) y el `slot`.
3. Rellena la ficha. Ejemplo: un rifle de precisión.
   ```js
   4: {
     slot: 4, id: 'dmr', name: 'M-90 "SÉPTIMO"',
     ammoType: 'heavy', mode: 'semi', fireKind: 'hitscan',
     damage: 75, headshotMul: 2.5, pellets: 1, rpm: 60,
     magSize: 5, reserveMax: 40, startReserve: 20,
     reloadTime: 2.2, reloadEmptyExtra: 0.6, range: 150,
     baseSpread: 0.05, spreadPerShot: 3.0, spreadMax: 6.0, spreadRecover: 2.0,
     // ...resto de campos igual que la pistola...
     sfx: { fire: 'pistol', reload: 'reload_in', empty: 'empty_click', impact: 'hit_world' },
     hudColor: [0.6, 0.9, 1.0]
   }
   ```
4. Comprueba si el arma necesita un **modelo** distinto en `buildViewmodel` (línea 174) y, si lo necesita, añade un caso siguiendo el patrón existente.
5. Comprueba si el **HUD** recorre `DEFS` automáticamente o si tiene una lista de armas fija. Si tiene una lista, añade el slot donde corresponda.

**Qué habrás aprendido:** si el punto 4 y el 5 no exigen cambios, el sistema está bien diseñado (*data-driven*).

### 11.2 Añadir un tipo de enemigo (medio)

1. En `js/entities/enemies.js`, añade una entrada a `DEFS` (línea 69). Puedes reutilizar el mesh de otro enemigo (`meshId: 'mesh_enemy_stalker'`) para no tener que crear geometría.
2. Decide el `attack.kind`: `'projectile'`, `'melee'`, `'slam'`... **usa uno de los que ya existen** para no tener que implementar código nuevo.
3. Añade el nuevo tipo a la lista de apariciones de las oleadas en `js/game/game.js` (busca dónde se define el contenido de las oleadas).
4. Regístralo en la tabla de sonidos: en `js/core/audio.js`, comprueba que los `sfx` que hayas puesto en la ficha existen en `NAMES` (línea 17).

**Qué habrás aprendido:** el coste real de añadir contenido suele estar en los **sitios que no son obvios** (oleadas, sonidos, HUD, barra de jefe).

### 11.3 Añadir una sala al nivel (medio)

1. En `js/world/leveldata.js`, escribe una función nueva siguiendo el patrón de las existentes:
   ```js
   function zoneLab() {
     room({ x: 40, z: -20, w: 14, d: 10, h: 4.5, floor: 'mat_metal_floor', wall: 'mat_concrete_wall' });
     corridor({ x: 30, z: -20, w: 10, d: 3, h: 3.0, axis: 'x' });
     lamp({ pos: [40, 4.0, -20], color: [0.4, 0.9, 1.0], intensity: 1.6, radius: 9 });
     prop({ kind: 'crate', pos: [43, 0, -18], rot: 0.4 });
   }
   ```
   (Nombres y campos exactos: cópialos de una zona existente como `zoneStorage()`; el objeto `mission` que describe cada elemento se pasa por el validador de `leveldata.js:75` con `prop: !!o.prop`.)
2. Llama a `zoneLab();` dentro de `buildMission()`, justo después de `/*__ZONAS__*/` (línea 903).
3. Comprueba que la sala **conecta** con el resto por un pasillo, o el jugador no podrá llegar.
4. Arranca el juego y activa `MOSTRAR FPS`. Si los FPS caen mucho, mira el número de draw calls: es probable que hayas creado un chunk nuevo (recuerda: `CHUNK = 32` m).

**Qué habrás aprendido:** que "hacer un nivel" es colocar volúmenes y luces, y que el **rendimiento** (draw calls) es una consecuencia directa de esa colocación.

### 11.4 Bonus: añadir un sonido (fácil)

1. Añade el nombre en `NAMES` (`audio.js:17`) **y** la receta en `RECIPES` (línea 34).
2. Ejecuta el test del catálogo (`audio:catalog`, línea 834) para verificar que la receta es válida y que **no es idéntica a otra** (el test detecta duplicados comparando firmas).
3. Llama a `BS.Audio.play('nombre_nuevo', { pos: [x,y,z] })` para que se atenúe con la distancia.

---

## 12. Glosario

| Término | Qué es | Dónde se ve aquí |
|---|---|---|
| **AABB** | *Axis-Aligned Bounding Box*. Caja envolvente alineada con los ejes; aproximación barata de la forma de un objeto. | `physics.js`, `renderer.js:309` |
| **AO** (Ambient Occlusion) | Oscurecimiento de esquinas y rincones por falta de luz ambiental. | `level.js:304` |
| **API** | Conjunto de funciones y datos que un módulo ofrece a los demás. | Todo `BS.*` |
| **attribute** | Dato de un shader que llega **por vértice** desde un buffer. | `shaders.js:23-26` |
| **Autoplay (política)** | Regla del navegador: sin interacción del usuario no se puede reproducir audio. | `audio.js:472`, `main.js:137` |
| **Baked lighting** | Iluminación calculada una vez y guardada (en vértices o texturas). | `level.js:267` `bakeLights` |
| **Callback / hook** | Función que se deja preparada para que otro módulo la rellene. | `main.js:99` `wireMenu` |
| **Chunk** | Trozo del nivel (32 m) usado para agrupar geometría y limitar draw calls. | `level.js:33` |
| **Culling** | Descartar objetos que no hace falta dibujar. | `renderer.js:326` |
| **Determinismo** | Mismas entradas ⇒ mismos resultados. | `seed` en `leveldata.js:920`, paso fijo |
| **Draw call** | Orden de dibujado enviada a la GPU; métrica clave de rendimiento. | `gl.js:597`, `renderer.js:792` |
| **Estados (máquina de)** | Conjunto finito de modos y transiciones entre ellos. | `game.js:33` (9 estados) |
| **Framework** | Código que aporta la estructura de la aplicación. **Aquí no se usa ninguno.** | — |
| **Frustum** | Volumen de visión de la cámara. | `renderer.js:309` |
| **Fragment shader** | Programa de GPU que calcula el color de cada píxel. | `shaders.js:73` `BASIC_FS` |
| **GLSL ES 1.00** | Lenguaje de shaders de WebGL1. | `shaders.js` |
| **Hitscan** | Disparo instantáneo resuelto con un rayo. | `weapons.js:32` |
| **IIFE** | *Immediately Invoked Function Expression*: función que se define y se ejecuta al instante para aislar el código. | Primera y última línea de **todos** los ficheros |
| **Índices (dibujado con)** | Array que dice qué vértices forman cada triángulo. | `gl.js:601` |
| **Intercalado (formato)** | Datos de cada vértice contiguos en memoria. | `gl.js:15-18` |
| **localStorage** | Almacén clave-valor persistente del navegador. | `menu.js:89` |
| **LOS** (Line Of Sight) | Línea de visión, comprobada con un rayo. | `enemies.js:546` |
| **máscara de bits** | Entero donde cada bit activa/desactiva una categoría. | `physics.js:32` |
| **Middleware** | Capa intermedia que procesa peticiones entre dos extremos. **No hay servidor aquí**; el equivalente conceptual son los `callbacks` del menú y la cadena de `update` por entidad. | `main.js:99`, `game.js:1251-1255` |
| **Navmesh** | Malla de zonas transitables para el pathfinding. **No se usa**: ver `enemies.js` | — |
| **Normal (vector)** | Vector perpendicular a una superficie; se usa para iluminar. | `shaders.js:41`, `level.js:295` |
| **ORM** | Capa que traduce clases ↔ tablas de base de datos. **No aplica**: no hay BD, solo `localStorage`. | — |
| **Pointer Lock** | API que oculta el cursor y captura el movimiento para la cámara. | `input.js`, `main.js:143` |
| **Procedural** | Generado por algoritmo, no cargado de un fichero. | `textures.js`, `audio.js`, `mesh.js` |
| **Programa (GLSL)** | Par vertex+fragment shader compilado y enlazado. | `gl.js:340-343` |
| **rAF** | `requestAnimationFrame`: sincroniza el trabajo con el refresco de pantalla. | `main.js:58` |
| **RNG con semilla** | Generador pseudoaleatorio reproducible. | `util.js` (`BS.RNG`), `audio.js:394` |
| **Raycast** | Lanzar un rayo y ver qué golpea. | `physics.js:421` |
| **Scratch buffer** | Memoria temporal reutilizada para no crear objetos cada fotograma. | `physics.js:35-48` |
| **Shader** | Programa que se ejecuta en la GPU. | `shaders.js` |
| **SKIN** | Separación de seguridad (2 cm) al detener un cuerpo contra un sólido. | `physics.js:24` |
| **Step-up** | Subir automáticamente escalones bajos sin saltar. | `physics.js:265-287` |
| **Stride** | Distancia en bytes entre el inicio de dos vértices consecutivos. | `gl.js:586` (36) |
| **Texel / UV** | Coordenadas de textura de un vértice (u,v). | `gl.js:590` |
| **uniform** | Valor de shader igual para todo el dibujado (matriz, color). | `shaders.js:28-31` |
| **varying** | Valor que el vertex shader pasa interpolado al fragment shader. | `shaders.js:33-36` |
| **VBO / IBO** | *Vertex/Index Buffer Object*: arrays de datos subidos a la GPU. | `gl.js:584`, `gl.js:600` |
| **Voice budget** | Número máximo de sonidos simultáneos. | `audio.js:282` (24) |
| **WebGL** | API de gráficos 3D acelerados por GPU del navegador. | `gl.js` |
| **Web Audio API** | API de audio del navegador basada en grafos de nodos. | `audio.js` |

---

## Cierre

Si has llegado hasta aquí y has ido abriendo los ficheros, ya has visto de primera mano algo que en DAW se estudia en abstracto: **una arquitectura por capas real**, con sus dependencias explícitas, sus presupuestos de rendimiento, sus decisiones documentadas y sus trampas anotadas en comentarios.

Tres ideas para llevarte al próximo proyecto:

1. **Un global, 23 módulos.** No hace falta un framework para organizar código; hace falta un contrato claro (`window.BS`) y respetarlo.
2. **Los datos mandan.** Armas, enemigos, salas, ajustes, sonidos y shaders son datos. La lógica es genérica. Cuanto más contenido añadas sin tocar lógica, mejor está el diseño.
3. **Todo tiene un presupuesto.** 16,67 ms por fotograma, ~90 draw calls, 65.535 vértices, 24 voces de audio, 4 ticks de simulación. Escribe tus presupuestos en constantes con nombre y coméntalos.

