# BLACKSITE: LAST SIGNAL

FPS 3D para navegador en una instalación de investigación abandonada. Motor
**WebGL propio**, sin dependencias, sin servidor y sin instalación: se abre
haciendo doble clic en `index.html`.

> **Estado:** terminado y **verificado en un navegador real** (WebGL 2.0). El
> informe de verificación, en §6, dice exactamente qué se ejecutó de verdad, con
> qué cifras, qué no se pudo probar y por qué. Este documento no afirma nada que
> no se haya medido.

---

## 1. Cómo se ejecuta

1. Copia la carpeta completa a donde quieras.
2. Haz doble clic en **`index.html`**.

Ya está. No hay que instalar nada, no hay que compilar, no hace falta servidor
local ni conexión a internet después de copiar la carpeta.

Requisitos reales: un navegador de escritorio actualizado (Chrome, Edge, Firefox
u Opera) con **WebGL** y **JavaScript** activados. Si el navegador no puede crear
un contexto WebGL, el juego lo dice en pantalla y explica qué hacer en lugar de
quedarse en negro.

### Si algo no funciona
- **Sale «Necesitas JavaScript activado»**: activa JavaScript.
- **Sale un aviso de WebGL**: entra en los ajustes del navegador y activa la
  aceleración por hardware; actualiza el driver de la tarjeta gráfica.
- **El ratón no gira la vista**: haz clic sobre la pantalla del juego. Los
  navegadores exigen un clic del usuario para poder capturar el ratón.
- **No se oye nada**: los navegadores solo permiten sonido tras una interacción.
  Pulsa el botón de jugar o haz un clic, y el audio se activa.
- **Se abre con `about:blank` o en blanco**: asegúrate de abrir `index.html` y no
  otro archivo.

---

## 2. Controles

| Acción | Tecla |
|---|---|
| Moverse | `W` `A` `S` `D` |
| Girar la vista | Ratón |
| Correr (sprint) | `Shift` |
| Agacharse | `Ctrl` o `C` |
| Saltar | `Espacio` |
| Disparar | Clic izquierdo |
| Recargar | `R` |
| Cambiar de arma | `1` `2` `3`, o rueda del ratón |
| Arma anterior | `Q` |
| Interactuar (objetivos) | `E` |
| Pausa | `Esc` (o `P`) |
| Panel de depuración | `F1` |
| Silenciar | `M` |

La pausa también se activa sola si el juego pierde el foco, cambias de pestaña o
el navegador libera el ratón.

---

## 3. El juego

Eres un operador de recuperación enviado a la instalación **K-7**, que dejó de
emitir hace 36 horas. Dentro no hay nadie, pero algo sigue patrullando. Tu
trabajo es llegar al atrio central, devolver la energía al complejo y activar la
baliza de rescate antes de que la oleada final te alcance.

**Objetivos**
1. Llega al atrio central.
2. Restaura la energía del complejo.
3. Activa la baliza de rescate.
4. Sobrevive a las 5 oleadas. Al limpiar la última, ganas.

**Armas**
- **MK-7 «VECTOR»** (`1`) — pistola semiautomática, precisión alta, munición ligera.
- **VK-9 «HORNET»** (`2`) — subfusil automático, cadencia alta, poco daño por disparo.
- **AR-12 «ALCOTÁN»** (`3`) — lanzador de plasma: 6 perdigones por disparo con
  salpicadura. Ideal contra grupos y contra el enemigo blindado.

**Enemigos**
- **VIGÍA-7** (dron) — flota, orbita y dispara plasma guiado. Frágil y escurridizo.
- **SIGILO-9** (acechador) — rápido, embiste y ataca cuerpo a cuerpo. Rodea por
  los flancos.
- **EJECUTOR-3** (bruto) — lento y muy duro, golpea con onda expansiva. Su punto
  débil está en el radiador trasero.

**Estilo de juego**: agacharse mejora mucho la precisión y reduce tu silueta;
disparar hace ruido y los enemigos lo oyen. No es un juego de quedarse quieto:
las coberturas del mapa son parte del diseño.

---

## 4. Estructura del proyecto

```
/
├─ index.html                 ← ábrelo para jugar
├─ README.md
├─ js/
│  ├─ core/                   motor: matemáticas, WebGL, entrada, audio, texturas
│  ├─ render/                 shaders, geometría, renderer, efectos
│  ├─ world/                  datos del nivel, construcción, física
│  ├─ entities/               jugador, armas, proyectiles, recogibles, enemigos
│  ├─ ui/                     estilos, HUD, menús
│  ├─ game/                   bucle, estados, oleadas, mediador de combate
│  └─ main.js                 arranque
├─ sandbox/                   arneses de prueba por lotes
├─ tools/                     utilidades de verificación (no forman parte del juego)
└─ docs/                      arquitectura, decisiones y método de pruebas
```

Todo el arte es **procedural**: las texturas se generan con `canvas` 2D y se
suben a la GPU, y los sonidos se sintetizan con la Web Audio API. No hay ni un
solo archivo de imagen o de audio que cargar, así que no hay nada que se pueda
romper por una ruta mal escrita.

---

## 5. Cómo se ha construido (equipo de agentes)

El proyecto se ha desarrollado con un equipo de cinco agentes especializados, y
cada fase está documentada:

| Agente | Papel | Dónde está su resultado |
|---|---|---|
| `architect` | Diseñó la arquitectura, congeló las interfaces y analizó 20 riesgos de WebGL y `file://` | `docs/ARCHITECTURE.md` |
| `developer` | Implementó el motor (lote A), el mundo y el jugador (lote B) y el juego (lote C) | `js/` |
| `reviewer` | Revisó el código sin modificarlo y encontró los fallos | `docs/REVIEW.md` |
| `tester` | Probó el juego en un navegador real | `docs/TEST-REPORT.md` |
| `teacher` | Explicó el código para un estudiante de DAW | `docs/TEACHING.md` |

Las decisiones de diseño y los ajustes de alcance están en `docs/DECISIONS.md`, y
el método de prueba verificado en `docs/HARNESS.md`.

En una **segunda fase**, el equipo se volvió a movilizar para corregir dos bugs que
reportó un usuario real al jugar desde `index.html` (los botones del menú no hacían
nada y el clic no bloqueaba el ratón), más cuatro bugs extra encontrados al
verificar. El resultado consolidado está en `docs/FIX-REPORT.md`, con la revisión en
`docs/FIX-REVIEW.md`, las pruebas en `docs/FIX-TEST-REPORT.md` y la explicación
didáctica en `docs/TEACHING-BUGS.md`.

---

## 6. Informe de verificación

Todo lo de esta sección se ha **medido**, no deducido. El detalle completo, test a
test, está en `docs/TEST-REPORT.md`; el método en `docs/HARNESS.md`; la revisión de
código en `docs/REVIEW.md`; y la explicación didáctica en `docs/TEACHING.md`. La
corrección de los bugs reportados por el usuario (fase 2) está en
`docs/FIX-REPORT.md`, `docs/FIX-REVIEW.md`, `docs/FIX-TEST-REPORT.md` y
`docs/TEACHING-BUGS.md`.

### 6.1 Qué agentes se ejecutaron de verdad

| Agente | ¿Ejecutado? | Resultado |
|---|---|---|
| `architect` | **Sí** | `docs/ARCHITECTURE.md` (22 ficheros, contrato de interfaces congelado, 20 riesgos, presupuestos de rendimiento). |
| `developer` | **Sí, en 3 lotes** | Implementó el motor (lote A), el mundo/jugador (lote B) y el juego (lote C). Cerca del final **agotó su límite de tasa** (`Rate limit exceeded`). |
| `reviewer` | **Sí, 3 pasadas** | Encontró los fallos reales (linterna invertida, emisivo sin escribir, `Textures.rebuild()` borrando materiales, truncado de `mesh:stride`, ambient duplicado, props duplicados) y, en la pasada final, M1/B1–B5 → `docs/REVIEW.md`. |
| `tester` | **Sí** | Definió y ejecutó la batería de 28 auto-tests en un navegador real → `docs/TEST-REPORT.md`. |
| `teacher` | **Sí** | `docs/TEACHING.md`: recorrido del código para 2.º de DAW (1346 líneas). |

**Transparencia sobre la coordinación:** los subagentes se ejecutan sin permiso de
escritura, así que devuelven su resultado y el **orquestador** lo guarda en `docs/`.
Además, cuando el subagente `developer` agotó su límite de tasa, **el orquestador
aplicó directamente el resto de correcciones de la Fase 5** (arranque, viewmodel,
reinicio, ambiente, rutas, expectativas de tests y el arranque de `main.js`). Eso se
declara aquí porque no lo hizo el `developer`. Después se **re-verificó todo desde
cero** en el navegador.

### 6.2 Cómo se probó (condiciones reales)

Hay dos métodos, ambos sobre el navegador de escritorio real.

**1) Inyección del motor en `about:blank`** (fase 1): se cargaron los **23 `.js`** en
una pestaña `about:blank` y se inyectaron como `<script>` clásicos **en el mismo orden
que `index.html`** (sin servidor, sin `fetch`, sin módulos ES, un único global
`window.BS`, arte 100 % procedural). El juego se condujo con su API de depuración y la
imagen se comprobó por píxeles (`tools/frame_probe.js`), porque `browser.screenshot`
exige una ventana visible.

**2) El `index.html` real como `file://`** (fase de corrección): el navegador de
escritorio **sí** puede abrir el fichero real con sus `<script src>` relativos
(`file:///…/index.html`), lo que permitió pulsar los botones del menú con **clics
reales** y comprobar el flujo completo del usuario —justo la ruta que los bugs
rompían—. Entorno: **WebGL 2.0** vía **ANGLE D3D11** sobre **Intel UHD Graphics 770**.

> Límite honesto: sigue **sin ser** un doble clic desde el Explorador de Windows, pero
> el documento cargado es el `index.html` real, en `file://`, con las mismas
> restricciones (sin servidor, sin `fetch`, sin módulos).

### 6.3 Resultados medidos

- **Arranque:** 23 scripts con **0 errores**; **arranca sin parches** (`Main.ready=true`,
  estado `menu`, contexto WebGL creado, calidad `high`, 0 errores capturados). Antes de
  la Fase 5 el arranque se bloqueaba con `Game.isLowQuality is not a function`.
- **Auto-tests: 28/28** en la fase 1 (antes: 20/26 con 6 falsos negativos y los dos
  `math:*` sin registrarse) y **32/32** tras añadir los 4 tests de regresión de la
  fase 2 (`menu:buttons`, `menu:pointerlock-overlay`, `input:lockfail-count`,
  `boot:safety`).
- **Render:** máximo **87 draw calls** (presupuesto §7.1 ≤ 90) y ~6.500–8.200 triángulos
  en las posiciones medidas; `frameMs` ≈ 0.6–0.7 ms.
- **Viewmodel del arma:** visible (1 draw call extra; al anularlo cambian 226/3.200
  celdas muestreadas).
- **Linterna:** aporta (centro 0.072 con ella vs 0.051 sin ella; cambian 675/3.200
  celdas al apagarla).
- **Iluminación:** luminancia media de escena **0.075–0.11** (antes del arreglo del
  ambiente duplicado: **0.017**).
- **Jugador:** ~4,3 m/s; **muerte** → estado `dead`; **reinicio** (`restartMission`) →
  `playing` con 100 PV en el spawn.
- **Armas:** MK-7 «VECTOR» (slot 1), VK-9 «HORNET» (slot 2), AR-12 «ALCOTÁN» (slot 3);
  disparo y recarga correctos; las ranuras 2 y 3 se desbloquean al recoger el arma.
- **Enemigos:** detectan, persiguen y atacan (100→78→56→12→0 en ~12 s con 2 enemigos).
- **Oleadas y victoria:** la oleada 0 arranca en el atrio con 6 enemigos; al despejar la
  última (con `victoryOnClear`) el estado pasa a **`victory`**.
- **Tutorial y pausa:** `tutorial` y `paused`/`playing` funcionan.
- **Bugs del usuario (fase 2):** los botones del menú funcionan (clic real en JUGAR →
  `playing`; navegación y ajustes completos OK) y el clic es capturado por el overlay
  del ratón (`elementFromPoint` → `bs-click-catch`, `pointer-events:auto`; `lockRequests`
  +1 y `lockFailures` +1 exacto, sin disparo parásito). Detalle en `docs/FIX-REPORT.md`.

### 6.4 Errores conocidos y limitaciones

- **Draw calls al límite:** el máximo medido (87) deja **3 de margen** sobre el
  presupuesto (90). Añadir más props sin agruparlos lo superaría. Documentado en
  `docs/REVIEW.md` (B4).
- **`Debug.setQuality`** es un *override* efímero (herramienta de test; no afecta al
  jugador). `docs/REVIEW.md` (B5).
- **No probado** (limitación del método, no del juego): la **concesión real** del
  Pointer Lock con un ratón físico —el navegador de automatización la rechaza en
  cualquier documento (`WrongDocumentError`), aunque sí se verificó que el clic llega
  al overlay y que `requestPointerLock()` se ejecuta (`docs/FIX-REPORT.md` §4)—;
  captura de pantalla; calidad de sonido «de oído» (sí se verificó que el contexto de
  audio está `running`); sesiones largas/fugas de memoria y **otras GPU o navegadores**
  (solo se probó en un equipo con Intel UHD 770 y motor Chromium). El detalle está en
  `docs/TEST-REPORT.md` §6 y `docs/FIX-TEST-REPORT.md`.

### 6.5 Bugs reportados por el usuario y su corrección

Tras la entrega, un jugador reportó dos fallos reales jugando desde `index.html`:

1. **«El `index.html` no funciona: le doy clic y no me lleva a ningún lugar.»** Los
   botones del menú no hacían nada. Causa: el código interno de `menu.js` llamaba a
   `S.show/S.hide/S.showClickCatch/S.applySettings`, que solo existían en el objeto
   público `Menu` (no en el estado `S`), y el `TypeError` quedaba silenciado por el
   `try/catch` de los botones. Arreglo: 4 alias `S.show = Menu.show;` en `menu.js`.
2. **«Le doy clic para bloquear el ratón y no hace nada, solo dispara.»** El overlay
   «CLIC PARA BLOQUEAR EL RATÓN» era transparente al ratón porque `.bs-click-catch` no
   reponía `pointer-events:auto` (su padre `#bs-ui` es `pointer-events:none`). Arreglo:
   `pointer-events:auto;` en `js/ui/style.js`.

Se corrigieron además 4 bugs extra hallados al verificar y se añadieron 4 tests de
regresión (28 → 32). El detalle completo —evidencia, arreglo, riesgos, pruebas y
explicación didáctica— está en `docs/FIX-REPORT.md`, `docs/FIX-REVIEW.md`,
`docs/FIX-TEST-REPORT.md` y `docs/TEACHING-BUGS.md`.

---

## 7. Para ampliar el juego

- El mapa es **datos**: se edita en `js/world/leveldata.js` sin tocar el motor.
- Las oleadas y los objetivos también: son datos con `trigger`.
- Las armas son definiciones (`DEFS`): añadir un arma es añadir una entrada y su
  modelo procedural.
- Los enemigos son tres definiciones; añadir un tipo es añadir una entrada y su
  malla.

No hace falta ninguna herramienta: se edita el `.js` y se vuelve a abrir
`index.html`.
