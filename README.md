# BLACKSITE: LAST SIGNAL

FPS 3D para navegador en una instalación de investigación abandonada. Motor
**WebGL propio**, sin dependencias, sin servidor y sin instalación: se abre
haciendo doble clic en `index.html`.

> **Estado:** en desarrollo. Los resultados de las pruebas (qué se ejecutó y qué
> no) están al final, en «Informe de verificación», y se completan cuando el
> juego está terminado. Este documento no afirma nada que no se haya probado.

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

---

## 6. Informe de verificación

**Pendiente de completar.** Se rellena cuando el juego esté terminado, indicando:

- Qué agentes se pudieron ejecutar de verdad y cuáles no.
- Qué se probó **ejecutándolo** en un navegador real (y cómo).
- Qué **no** se pudo probar y por qué.
- Errores conocidos y limitaciones, si quedan.

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
