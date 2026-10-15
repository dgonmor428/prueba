# Arnés de pruebas en navegador real — hallazgos verificados

Este documento lo escribe el **orquestador** a partir de pruebas que ha ejecutado
**de verdad** en el navegador de OpenCode antes de implementar el juego. No
contiene suposiciones.

## 1. Por qué no se puede abrir `file://` directamente desde las herramientas

`browser.tabs.open` rechaza URLs `file://`:

> `Invalid browser URL. Use an HTTP/HTTPS URL or about:blank without embedded credentials.`

Es una limitación de la herramienta, **no del juego**. El juego sí se abrirá con
doble clic en `index.html` desde el navegador normal del usuario.

## 2. Método de prueba verificado (equivalente funcional a `file://`)

Se ha comprobado que **funciona** inyectar código dentro de una pestaña
`about:blank`:

```js
const s = document.createElement('script');
s.textContent = '<contenido de un archivo .js>';
document.body.appendChild(s);      // se ejecuta correctamente
```

Resultado de la prueba: `window.__probeRan === 42` y `window.BS.fake === 1`. El
mecanismo de scripts clásicos funciona en `about:blank` igual que en `file://`.

Por eso el juego **debe** cumplir estas condiciones, que son exactamente las de
`file://`, y así la prueba es fiel:

- Nada de `fetch`, `XMLHttpRequest`, `import`, `type="module"`.
- Un solo global: `window.BS`.
- Todo el arte (texturas y audio) generado en tiempo de ejecución.
- Todo el DOM y el CSS creados desde JavaScript.

## 3. Capacidades reales del navegador de pruebas (medidas)

| Capacidad | Valor medido |
|---|---|
| Contexto | **WebGL 2.0** disponible (y WebGL 1 también) |
| GPU | `ANGLE (Intel, Intel(R) UHD Graphics 770 (0x00004680) Direct3D11 vs_5_0 ps_5_0, D3D11)` |
| ¿Rasterizador software? | **No** (GPU real, no SwiftShader) |
| `devicePixelRatio` | 1 |
| `MAX_TEXTURE_SIZE` | 16384 |
| `MAX_FRAGMENT_UNIFORM_VECTORS` | 1024 |
| `MAX_VERTEX_UNIFORM_VECTORS` | 4096 |
| `MAX_VERTEX_ATTRIBS` | 16 |
| `OES_element_index_uint` | **no expuesta** (es core en WebGL2) → usar siempre `Uint16` |
| `EXT_texture_filter_anisotropic` | disponible |
| `OES_standard_derivatives` | **no expuesta** en contexto WebGL2 |

### 3.1 Consecuencias obligatorias para el código

1. **`caps.isWebGL2` será `true` en la máquina de desarrollo.** El juego debe
   funcionar igual en WebGL1, pero el camino que se va a probar es WebGL2.
2. **`caps.derivativesAvailable` debe calcularse así:**
   `isWebGL2 ? false : !!gl.getExtension('OES_standard_derivatives')`.
   Es decir: **en WebGL2 con shaders GLSL ES 1.00 NO hay `dFdx`/`dFdy`**. Se ha
   verificado compilando: `'dFdx' : no matching overloaded function found`.
   → **Decisión: `normalMap = null` para todos los materiales** en este entorno;
   el shader conserva la ruta bajo `#define`, pero debe funcionar con
   `uNormalStrength = 0`. El apartado visual se compensa con albedo procedural,
   emisivos, especular y horneado de luz por vértices.
3. **`caps.uintIndex` será `false`.** Confirmado: nunca depender de índices de
   32 bits. Si un mesh supera 65535 vértices hay que trocearlo.

## 4. Verificación visual sin `browser.screenshot`

`browser.screenshot` falla con:
> `Screenshot needs a visible tab. Call browser.tabs.focus and keep its desktop window visible.`

Como no se puede garantizar que la ventana del escritorio esté visible, la
verificación visual se hace **por píxeles**, y se ha comprobado que funciona:

- `gl.readPixels(...)` devuelve los valores correctos → comprobado:
  `clearColor(0.15,0.45,0.75)` produjo `[38,115,191,255]`.
- `canvas.toDataURL('image/png')` funciona (se usará `preserveDrawingBuffer:true`).

**Técnica recomendada para el `tester`:** volcar el canvas a un canvas 2D pequeño
(p. ej. 48×24) y calcular estadísticas que demuestren que hay una escena real:

- proporción de píxeles no negros,
- luminancia media y desviación,
- número de "tonos" distintos (variedad),
- **miniatura ASCII** (mapear luminancia a `" .:-=+*#%@"`) que se puede leer en
  texto y permite comprobar de un vistazo que se ve geometría y no una pantalla
  negra o un color plano.

## 5. Otras comprobaciones que el `tester` debe poder hacer

- `browser.console` con `level:'warning'` para recoger errores y avisos.
- `BS.Debug.errors` (engancha `window.onerror` y `unhandledrejection`).
- `BS.Debug.stepFrames(n)` para avanzar la simulación de forma determinista sin
  depender de `requestAnimationFrame`.
- `BS.Debug.state()` / `BS.Debug.stats()` para leer estado y contadores sin
  capturas.
