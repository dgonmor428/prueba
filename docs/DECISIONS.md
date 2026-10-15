# BLACKSITE: LAST SIGNAL — Decisiones del proyecto

Respuestas del responsable del proyecto (orquestador) a las 10 preguntas abiertas
planteadas por el agente `architect`. Estas decisiones **cierran** el diseño y
autorizan al agente `developer` a implementar sin volver a preguntar.

| # | Pregunta | Decisión |
|---|---|---|
| 1 | Idioma de la UI | **Español** para todos los textos de UI, HUD, menús y documentación. Identificadores de código en inglés. |
| 2 | Tercer arma | **Aprobada la propuesta**: PISTOL (hitscan semi), SMG (hitscan auto) y **ARC-12 BREACHER** (proyectil de plasma con salpicadura y 6 perdigones). Garantiza hitscan + proyectiles. |
| 3 | Tutorial | **Primera fase del mismo nivel K-7**, más una pantalla de controles en el menú. Sin mapa extra. |
| 4 | Regeneración de vida | **Aprobada**: se activa tras 6.5 s sin recibir daño, a 9 PV/s, con tope del 60 % de la vida máxima. El resto solo con botiquines. |
| 5 | Dificultad | **Sí**: selector `normal` / `hard`. En `hard`: +30 % vida enemiga, -25 % munición, sin regeneración. |
| 6 | Presupuesto de carga | **Aceptado ≤ 1.5 s** con pantalla de carga. Prioridad: que funcione. El AO por vértices es **opcional y simplificado** (si el horneado supera 120 ms, se reduce automáticamente). |
| 7 | `resolutionScale` por defecto | **Auto**: 1.0 en calidad `high`, 0.75 en `medium`, 0.6 en `low`, con autoajuste dinámico hacia abajo si el frame medio supera 22 ms. |
| 8 | `preserveDrawingBuffer: true` | **Aprobado** (fiabilidad de capturas del `tester`; coste despreciable). |
| 9 | Post-proceso | **Aprobado**: 1 pasada de composición (viñeta + tinte de daño + scanlines + grano), activa en `high`/`medium`, desactivada en `low`/software. |
| 10 | Persistencia | **Aprobado** `localStorage` con degradación silenciosa a memoria en memoria si el navegador lo bloquea en `file://`. |

## Ajustes de alcance aprobados (para garantizar la entrega funcionando)

El arquitecto diseñó 22 archivos. Se mantiene **la arquitectura, el contrato de
interfaces y el formato de vértice**, pero se autorizan estas simplificaciones
que no afectan a ninguna función obligatoria:

1. **Sin navmesh/navNodes**: la IA usa percepción por cono + raycast de línea de
   visión + *whiskers* de esquiva (3 rayos cortos) + lógica anti-atasco. Es
   suficiente, más barato y mucho más simple.
2. **AO simplificado**: horneado de luz estática por vértices + oscurecimiento
   por proximidad usando la rejilla de colisionadores (sin 9 rayos por vértice).
3. **Interpolación de render**: no se implementa en v1 (paso fijo a 60 Hz).
4. **`sprite` e `viewmodel`**: pueden compartir el mismo programa `basic` con
   `#define` distintos si eso reduce el riesgo; los nombres de uniforms no cambian.
5. El **formato de vértice de 36 bytes** y las **localizaciones de atributo fijas
   (0..3)** son intocables: son el contrato entre los tres lotes.
6. El **namespace global único `window.BS`** y el patrón IIFE son intocables.
7. Prohibido `fetch`, `XMLHttpRequest`, `import`, `type="module"`, `class` a nivel
   de archivo, y cualquier recurso externo. Todo el arte es procedural.
8. **Normal maps desactivados en este entorno** (verificado en `docs/HARNESS.md`
   §3.1: en WebGL2 con GLSL ES 1.00 no hay `dFdx`/`dFdy`). El código debe
   **funcionar siempre** con `normalMap = null` y `uNormalStrength = 0`, y la
   ruta con normal map queda detrás de `#define` para navegadores WebGL1 que sí
   expongan `OES_standard_derivatives`. La calidad visual se compensa con albedo
   procedural detallado, emisivos, especular y horneado de luz por vértices.
