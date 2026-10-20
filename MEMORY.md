# MEMORY.md

> **Qué es este archivo.** Contexto persistente del proyecto: decisiones tomadas, su
> justificación, estado medido y trabajo pendiente. Existe para que una sesión nueva (o
> otra persona/agente) no tenga que redescubrir nada ni deshacer decisiones sin saber por qué.
>
> **Cuándo actualizarlo.** Al cerrar una fase, al cambiar una decisión de diseño, o al
> descubrir una restricción del entorno. `AGENTS.md` manda sobre este archivo: si hay
> conflicto, gana `AGENTS.md`.
>
> Última actualización: **Fase 4 cerrada y verificada**; endurecimiento `0009` aplicado y probado.
> **Fase 5 no iniciada.** `0001`–`0009` aplicadas: `0008` está verificada (el seed corrió después),
> `0009` es histórica (no editar) y el Advisor queda en 3 advertencias aceptadas. El seed dejó
> 1025 Pokémon en `pokemon_catalogo`. La próxima migración libre es `0010` y es de la Fase 5. Fase 3
> (A, B y C) completada; D, E, F y G pospuestos a la Fase 6.

---

## 1. Qué es el proyecto

| | |
|---|---|
| Nombre | `geoportal-pokemon-go` |
| Qué es | Geoportal de hábitats, nidos y avistamientos de Pokémon GO |
| Stack mapas | **OpenLayers 10** (`ol`), **no** Mapbox ni MapLibre |
| Stack UI | React 18 + Vite 6 + Tailwind CSS **4.3.3** (plugin de Vite, sin `tailwind.config.js`) |
| Geo/espacial | `proj4` (reproyección CRS), `h3-js` (malla hexagonal) |
| Datos | Supabase (`@supabase/supabase-js`). Modelo nuevo en `supabase/migrations/` (`reportes`, `confirmaciones`, `pokemon_catalogo`…). Transición: `avistamientos` + RPC `listar_avistamientos_recientes` siguen vivos. |
| Iconos | `lucide-react` |
| Acentos | `lucide-react`, `h3-js`, `proj4` |
| Repositorio | **0 commits.** Todo está sin trackear (`??`). Ver §8, es una trampa. |

CRS: web y GeoJSON en `EPSG:4326` (WGS84); el mapa renderiza en `EPSG:3857` (Web Mercator)
y la reproyección ocurre en `src/utils/spatialUtils.js`.

---

## 2. Sistema de diseño — lo más importante del repo

**Antes de la Fase 1 no existía.** `src/index.css` tenía `@import "tailwindcss"` y nada más:
cero bloques `@theme`. Todo el estilo eran utilidades Tailwind sueltas repetidas y hex crudos
dentro del JSX. Ahora hay una arquitectura de tokens en 3 capas, todo dentro de
`src/index.css` (que es configuración de Tailwind, no "CSS de componentes" — ver §4, decisión 1).

### Capa 1 · Primitivos (`--color-base-*`)
Valores crudos de la paleta. **Nunca se consumen desde componentes.** Solo los pasos que la
capa 2 usa realmente:

```
sky     50, 300, 500, 600, 700
slate   100, 400, 500, 600, 800
emerald 600, 700
amber   50, 200, 700
rose    50, 200, 700
```

### Capa 2 · Semánticos (`@theme`)
Son los que consumen los componentes, vía utilidades Tailwind autogeneradas.

| Token | Utilidad | Uso |
|---|---|---|
| `--color-primary` | `bg-primary`, `text-primary` | Acción principal (CTA, iconos activos) |
| `--color-primary-hover` | `hover:bg-primary-hover` | Estado hover del CTA |
| `--color-primary-soft` | `bg-primary-soft` | Fondo de píldora activa |
| `--color-primary-edge` | `border-primary-edge` | Borde de píldora activa |
| `--color-primary-ink` | `text-primary-ink` | Texto sobre `primary-soft` |
| `--color-surface-muted` | `bg-surface-muted` | Fondo de la app |
| `--color-ink` | `text-ink` | Texto principal |
| `--color-ink-soft` | `text-ink-soft` | **Mínimo para texto normal** (≥4.5:1) |
| `--color-ink-muted` | `text-ink-muted` | Metadatos. **Solo cumple 4.5:1 sobre blanco puro** |
| `--color-ink-disabled` | `text-ink-disabled` | Deshabilitado. **Nunca para información requerida** |
| `--color-glass` | `bg-glass` | Blanco translúcido (AGENTS.md §4) |
| `--color-glass-border` | `border-glass-border` | Borde translúcido |
| `--color-glass-inset` | `bg-glass-inset` | Superficie interior sobre un panel |
| `--color-ring` | — | Anillo de foco (3px) |
| `--color-scrim` | `bg-scrim` | Velo tras superficie modal |
| `--color-success` / `-hover` | `bg-success` | Botón guardar |
| `--color-warning` / `-soft` / `-edge` | `text-warning` | Aviso de ubicación, badge "Nido" |
| `--color-danger` / `-soft` / `-edge` | `text-danger` | Errores |
| `--color-layer-*` | `text-layer-sightings`, `-nests`, `-habitats`, `-h3` | Acentos de las 4 capas del visor |
| `--text-2xs` | `text-2xs` | 11px. Reemplaza el arbitrario `text-[11px]` |

### Capa 3 · Componente (`@utility`)
Solo para repetición real (el skill `ui-styling`: *"extract components only for true repetition"*).

| Utilidad | Reemplaza | Notas |
|---|---|---|
| `glass-panel` | Cadena duplicada **4×** (`CLASES_TARJETA`) | Fondo + blur + borde + sombra de AGENTS.md §4 |
| `glass-inset` | Filas de datos / chips | Superficie interior |
| `field` | Cadena duplicada **6×** en inputs/selects/textarea | **Ver decisión 3** |
| `focus-ring` | Foco de teclado en 12 controles | `outline` 3px, no `box-shadow`, para no pisar la elevación |
| `pressable` | `active:scale-95` + transición | Incluye `prefers-reduced-motion` |
| `edge-t` / `edge-r` / `edge-l` | Anclajes con safe area | `max(1rem, env(safe-area-inset-*))` |

### Reglas al añadir estilos
1. **Cero hex crudo en componentes.** Si necesitas un color, es un token nuevo en la capa 2.
   Excepción legítima: **datos de dominio**, no cromo de UI. Los colores oficiales de tipo de
   Pokémon (`POKEMON_TIPOS_META`) y de hábitat son *datos*, no diseño, y viven en
   `src/config/constants.js`.
2. Usa `text-ink-soft` o más oscuro para texto normal. `ink-muted` solo sobre blanco puro.
3. Las cadenas de utilidad deben ser **literales** en el JSX (p. ej. `'text-layer-nests'`),
   no construidas dinámicamente, o Tailwind no las detecta.

---

## 3. Arquitectura de archivos

```
src/
├── App.jsx                    Raíz de composición. NO posiciona nada.
├── index.css                  Sistema de diseño (tokens + @utility) + fuentes de Tailwind
├── main.jsx                   ol/ol.css → index.css → App
├── components/
│   ├── map/
│   │   ├── MapViewer.jsx      Render + eventos. Lógica OL en hooks.
│   │   ├── AttributionPill.jsx ★ NUEVO — atribución legal de la capa base
│   │   └── MapEmptyState.jsx   ★ NUEVO — estados vacíos del visor
│   └── ui/
│       ├── FilterDrawer.jsx   ★ NUEVO — shell responsivo del panel de filtros
│       ├── SearchCard.jsx     Contenido puro de filtros (sin superficie propia)
│       ├── DetailSheet.jsx    Ficha del avistamiento (sheet móvil / tarjeta escritorio)
│       └── ReportCard.jsx     Formulario de reporte
├── context/
│   ├── AvistamientosContext.jsx  Estado global + `filtrosActivos` derivado
│   └── MapContext.jsx            Ubicación del usuario
├── hooks/
│   ├── useDismissOnEscape.js  ★ NUEVO — tecla Escape
│   ├── useFocusTrap.js        ★ NUEVO — foco inicial, ciclo Tab, devolución de foco
│   ├── useMediaQuery.js       ★ NUEVO — breakpoints reactivos + prefers-reduced-motion
│   ├── useOpenMap.js          Ciclo de vida ol/Map
│   ├── useAvistamientos.js    Datos + realtime Supabase
│   ├── useHabitats.js / useUserLocation.js
│   └── use*Layer.js           Sincronización datos → capas vectoriales
├── config/                    constants.js · mapConfig.js · supabaseClient.js
└── utils/                     pokemonUtils · spatialUtils · mapStyles · formatUtils
```

`★` = creado en las Fases 1 a 3.

Fuera de `src/`: `supabase/migrations/0001–0007` (modelo `reportes`), `supabase/README.md` y
`scripts/seed-catalogo.mjs` (catálogo desde PokeAPI, Fase 4).

**Invariante de SRP del proyecto (`AGENTS.md` §2):** si un componente necesita gestionar el
ciclo de vida de algo (suscripción, listener, timer), eso va en `/hooks`, no en el componente.
Ese fue el motivo de extraer `useDismissOnEscape` y `useFocusTrap` en vez de hacer un
`useEffect` dentro de `DetailSheet` / `FilterDrawer`.

---

## 4. Registro de decisiones

Cada una con su porqué. Si vas a cambiarla, lee primero el motivo.

**1. Los tokens viven en `@theme`/`@utility`, no en un módulo de constantes JS.**
`AGENTS.md` §4 ordena estilo vía Tailwind y `§2` pide SRP. La tensión se resolvió poniendo la
capa de diseño en las directivas de Tailwind v4 (que *son* el mecanismo oficial para esto),
no creando un `designTokens.js` que habría sido CSS disfrazado de JS.
`@theme` y `@utility` son directivas de Tailwind, así que esto **no** viola la regla de
"no usar archivos .css externos" — ese archivo es configuración, no estilizado de componentes.

**2. `source(none)` + `@source` explícitos.** Ver §7, es la corrección más importante del repo.

**3. `field` deliberadamente NO fija `width` ni `padding`.**
Un `@utility` y una utilidad normal (p. ej. `pl-9`, `w-28`) tienen la misma especificidad y el
orden en la hoja depende del orden interno de Tailwind, no del orden en la cadena de clases.
Fijar `width`/`padding` dentro de `field` habría creado conflictos silenciosos. Cada llamada
aporta su `w-full` / `w-28` / `pl-9`.

**4. `FilterDrawer` (shell) separado de `SearchCard` (contenido).**
`SearchCard` se anclaba desde `App.jsx` con `w-[min(92vw,22rem)]`: en un móvil de 375px daba un
panel de 345px de ancho y ~460px de alto **tapando el mapa**, justo cuando el mapa es la
interfaz. Separar "cómo se presenta" de "qué contiene" permite que el contenido siga siendo
una sola unidad y que el contenedor cambie por completo.

**5. Breakpoints resueltos en JS, no con utilidades `sm:`.**
Con `sm:` habría que renderizar `SearchCard` **dos veces** en el DOM (una rama oculta por
breakpoint), duplicando ids y suscripciones al contexto. `useMediaQuery` + una sola instancia
lo evita. `BREAKPOINT_SM` está en `useMediaQuery.js` y debe coincidir con el `sm` de Tailwind.

**6. La hoja cerrada usa `invisible`, no solo `translate-y-full`.**
Desplazada fuera de pantalla pero visible seguiría estando en el árbol de accesibilidad y en el
orden de tabulación: un lector de pantalla leería un panel que el usuario no ve.
`transition-[transform,visibility]` mantiene `visibility` hasta el final del deslizamiento.

**7. Un solo control abre y cierra (no un botón + una X, ni un asa de arrastre).**
El disparador alterna entre `Filtros` (con insignia del nº de filtros activos) y `Cerrar`.
Descarté el asa de arrastre superior: la hoja **no** es arrastrable, así que habría sido una
mentira visual.

**8. `filtrosActivos` se deriva en el contexto, no en la UI.**
Es estado de dominio. Las capas conmutables no cuentan: son visibilidad, no filtrado.

**9. Los colores de tipo de Pokémon NO se usan como color de texto.**
Varios colores oficiales son muy claros — Eléctrico `#F7D02C` da ≈1.6:1 sobre blanco y
incumpliría WCAG 1.4.3. El badge usa punto de color + `text-ink`. El color queda como
indicador no textual, que es el uso correcto.

**10. Los tokens muertos se eliminan.**
Se quitaron `--color-surface`, `--color-edge`, `--color-edge-soft`, `--color-base-slate-300`
y la utilidad `edge-b` junto con 10 pasos de paleta huérfanos, tras auditar el CSS compilado
contra el fuente. Criterio: **un token semántico sin consumidor es un defecto**, no API futura.

**11. No habrá skeletons de carga.**
El propio skill `ui-ux-pro-max` lo dice: *"Don't use elaborate loaders for sub-300ms waits; they
flash and feel worse than no indicator"*. Una RPC a Supabase está muy por debajo de eso. El
problema real era el estado inicial de carga (ver §6, hallazgo E), no el indicador.

**12. La atribución se renderiza como pastilla en el DOM, no como control de OpenLayers.**
`useOpenMap.js` crea el mapa con `controls: []` y su ciclo de vida está escrito para tolerar el
doble montaje de StrictMode (`setTarget(null)` + `dispose()`). Añadir el control `Attribution`
nativo obligaba a tocar y limpiar ese ciclo, justo el riesgo señalado en §9. La pastilla
(`AttributionPill.jsx`) es presentacional, consume `capaBase` del contexto y lee los textos y
enlaces declarados junto a cada fuente en `mapConfig.js` (`atribuciones`), de modo que cambia al
conmutar la capa base sin acoplar UI y datos. Se conserva el `attributions` de cada `XYZ` para que
la fuente no pierda sus metadatos. Es el único punto de la fase con consecuencias legales: la
política de teselas de OSM exige atribución y CARTO exige la suya.

**13. `flyTo` respeta `prefers-reduced-motion` con un `ref`, no con una dependencia.**
Sin reducción se mantiene `animate({ duration: 600 })`; con reducción se aplican centro y zoom
directos (`setCenter` + `setZoom`), porque `animate` con duración 0 sigue programando un frame. La
preferencia se refleja en `movimientoReducidoRef` para que `flyTo` no cambie de identidad: su
dependencia es `[map]`, y si cambiara, el efecto de `MapViewer` repetiría el vuelo a la ubicación
del usuario cada vez que el usuario alternase la preferencia del sistema.

**14. Los estados vacíos dependen de `inicializado`, no solo de la colección visible.**
`useAvistamientos` arranca `loading` en `false` (hallazgo E), así que en el primer render
`avistamientosVisibles` ya está vacío. Sin la bandera `inicializado` (que se pone a `true` al
terminar la primera consulta, también cuando no hay configuración), el estado "cero resultados"
parpadearía antes de la primera respuesta. El indicador de carga sigue pospuesto, pero el estado
vacío no puede mentir mientras tanto.

**15. `mostrarTodosLosAvistamientos` es una acción del contexto, no lógica del estado vacío.**
`MapEmptyState` no muta `filters` ni `capas`: pide la acción y el contexto la resuelve
(restablece búsqueda y tipo, y reactiva las capas de avistamientos y nidos). Con esto la UI sigue
sin conocer el dominio y el único lugar que escribe filtros sigue siendo `AvistamientosContext`.

---

## 5. Resultados medidos

Build de producción, cifras reportadas por Vite (kB = 1000 B, como Vite):

| Métrica | Antes | Después | Cambio |
|---|---|---|---|
| CSS | 59.02 kB | **28.08 kB** | **−52.4 %** |
| CSS gzip | 11.28 kB | **6.42 kB** | **−43.1 %** |
| Reglas CSS | 819 | **367** | **−55.2 %** |
| JS | 1,101.34 kB | 1,104.67 kB | +0.3 % (inerte: el grueso es OpenLayers) |

Las tres cuartas partes de la ganancia de CSS **no** vienen de refactorizar estilos: vienen de
dejar de compilar las skills. Ver §7.

### Fase 3 (A, B, C)

| Métrica | Antes de F3 | Después de F3 | Cambio |
|---|---|---|---|
| CSS | 28.08 kB | **28.57 kB** | +1.7 % (clases nuevas: estado vacío y pastilla) |
| CSS gzip | 6.42 kB | **6.53 kB** | +1.7 % |
| JS | 1,104.67 kB | **1,109.68 kB** | +0.45 % (2 componentes nuevos; sigue dominando OpenLayers) |

Sin tokens nuevos: A, B y C consumen la capa semántica existente (`glass-panel`, `text-ink-soft`,
`text-danger`, `focus-ring`, `pressable`). Verificado con la rutina de §11 sobre el CSS compilado.

---

## 6. Accesibilidad — estado y hallazgos

### Corregido
| Falla | Norma | Corrección |
|---|---|---|
| `maximum-scale=1, user-scalable=no` bloqueaba el zoom de texto | WCAG 1.4.4 | Eliminado del viewport |
| Toggles inactivos a 4.34:1 | WCAG 1.4.3 | `text-ink-soft` → 6.92:1 |
| 5 campos solo con `placeholder`, sin etiqueta | WCAG 3.3.2 / 4.1.2 | `<label htmlFor>` real (+ `sr-only` en el buscador) |
| 0 controles con foco visible | WCAG 2.4.7 | `focus-ring` en 12 controles |
| Badge de tipo ilegible (Eléctrico 1.6:1) | WCAG 1.4.3 | Punto de color + `text-ink` |
| Ficha sin cierre por teclado | convención | Escape vía `useDismissOnEscape` |
| Objetivos táctiles de 28px | 44px mínimo | `min-h-11` en móvil, `sm:min-h-8` en escritorio |
| Contenido bajo el notch | safe areas | `viewport-fit=cover` + utilidades `edge-*` |
| `flyTo` animaba 600 ms ignorando `prefers-reduced-motion` | WCAG 2.3.3 | Salto instantáneo (`setCenter` + `setZoom`) con la preferencia activa |
| Atribución OSM/CARTO nunca visible (`controls: []` elimina el control nativo) | Política de teselas de OSM y CARTO | `AttributionPill` propia, con enlaces, que cambia con la capa base |
| Mapa en blanco sin explicar el motivo | UX / WCAG 3.3.1 | `MapEmptyState`: sin configurar, error (con reintento) y cero resultados (con salida) |
| Enlaces de atribución abrían pestaña nueva sin avisar | WCAG 3.2.5 (advisory) | `<span class="sr-only">(se abre en una pestaña nueva)</span>` |

### Pendiente (Fase 6)
- **`DetailSheet` declara `role="dialog"` sin gestionar el foco.** Incoherente: se anuncia como
  diálogo pero el foco se queda en el mapa.
- **`FilterDrawer` sin verificación visual en navegador** (ver §9, hallazgo G).
- **D, E, F y G**, pospuestos: el panel de filtros se rediseña en la Fase 6 (ver §9).

---

## 7. ⚠️ Trampas conocidas — leer antes de tocar Tailwind o git

### 7.1 Tailwind escaneaba las skills (ya corregido, no lo rompas)
Por defecto Tailwind v4 detecta fuentes recorriendo **todo** el proyecto. Encontraba nombres de
clase dentro de la documentación de `.opencode/skills/**` — por ejemplo `grid-cols-12` en
`ui-styling/references/tailwind-utilities.md`. Resultado medido: **819 reglas / 59 kB de CSS
para una app de 6 componentes**, con utilidades que la aplicación nunca usa.

Corregido al principio de `src/index.css`:

```css
@import "tailwindcss" source(none);
@source "../index.html";
@source "../src";
```

**Consecuencia que debes recordar:** si algún día añades clases Tailwind en un archivo fuera de
`src/` o `index.html`, **no se generarán**. Habrá que añadir un `@source` para esa ruta.
Esto también significa que instalar más skills ya **no** infla el bundle.

### 7.2 `npx skills add` recrea `.agents/`
El CLI `skills` tiene `.agents/skills/` hardcodeado como destino para OpenCode. Todo se
consolidó en `.opencode/skills/` (48 skills) y se borró `.agents/`, pero **la próxima vez que
ejecutes `npx skills add` el directorio volverá**. Hay que repetir el movimiento.

### 7.3 El repositorio tiene 0 commits y `.opencode/` no está ignorado
`git rev-list --count HEAD` falla: no hay ni un commit. Y `.gitignore` cubre
`node_modules`, `dist`, `dist-ssr`, `.env`, `.env.local`, `*.local`, `.DS_Store` — pero
**no `.opencode/`**. Un `git add -A` commitearía **~485 archivos** de contenido de terceros.

Líneas recomendadas (no ejecutadas, `AGENTS.md` §6 prohíbe tocar git):

```gitignore
.opencode/
skills-lock.json
```

### 7.4 Sesgo de la paleta: qué color usar
`text-ink-muted` (#64748b) da 4.76:1 sobre **blanco puro** pero solo 4.34:1 sobre `slate-100`.
Sobre el velo blanco de una tarjeta vale; sobre `bg-surface-muted` **no**. En caso de duda,
`text-ink-soft`.

---

## 8. Entorno

| | |
|---|---|
| OS | Windows (`win32`), PowerShell |
| Node | v24.21.0 |
| Python | **NO instalado.** Los scripts de búsqueda de `ui-ux-pro-max` (`search.py`) están **inutilizables**; el propio skill indica no instalarlo por cuenta propia y tirar de sus guías. |
| Playwright / Puppeteer | **No instalados.** |
| Navegador disponible | Edge en `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe` |

Verificación posible sin instalar nada: `msedge --headless --screenshot` (estático, sin clics).
Para interacción real hace falta Playwright, instalable **fuera del repo** (`$env:TEMP`) con
`PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` y `channel: 'msedge'`, evitando tocar `package.json`.

---

## 9. Fase 3 — ejecutada (A, B, C) y pospuesta (D–G)

Alcance ejecutado en esta fase: **A, B y C**. El resto queda pospuesto con un motivo explícito.

### Completado

| # | Hallazgo | Solución aplicada | Dónde |
|---|---|---|---|
| **A** | La atribución de OSM/CARTO no se mostraba nunca: `attributions` existía en `mapConfig.js`, pero `controls: []` (`useOpenMap.js`) elimina el control nativo y ningún componente lo renderizaba | Pastilla propia en el DOM que lee `CAPAS_BASE[capaBase].atribuciones`; cambia con la capa base y enlaza a la licencia. **No se tocó el ciclo de vida del mapa** | `components/map/AttributionPill.jsx`, `config/mapConfig.js`, `components/map/MapViewer.jsx` |
| **B** | `flyTo` animaba 600 ms ignorando `prefers-reduced-motion` | Salto instantáneo (`cancelAnimations` + `setCenter` + `setZoom`) bajo la preferencia; la normalidad conserva los 600 ms. La preferencia se lee con `useMediaQuery` y se guarda en un `ref` para no cambiar la identidad de `flyTo` | `hooks/useOpenMap.js`, `hooks/useMediaQuery.js` |
| **C** | No existía estado vacío (sin configurar / error / 0 resultados) | `MapEmptyState` con tres variantes, y `configurado` + `inicializado` expuestos por el contexto para no mostrar un "vacío" falso antes de la primera respuesta | `components/map/MapEmptyState.jsx`, `hooks/useAvistamientos.js`, `context/AvistamientosContext.jsx`, `components/map/MapViewer.jsx` |

Evidencia de cierre: `npm run build` correcto, rutina de tokens de §11 en verde, y captura estática
con `msedge --headless` que confirma la pastilla "© OpenStreetMap contributors" abajo a la derecha.

### Pospuesto a la Fase 6

**Motivo único: el panel de filtros se rediseña en la Fase 6.** Estos cuatro hallazgos dependen del
panel (su contenido, sus contadores o su verificación), así que revisarlos antes del rediseño sería
trabajo que se tira.

| # | Hallazgo | Evidencia original | Motivo |
|---|---|---|---|
| **D** | La selección no se limpia al filtrarla: el `selectedAvistamiento` busca en `avistamientos`, no en `avistamientosVisibles` | `AvistamientosContext.jsx:59-62` | Pospuesto: el panel de filtros se rediseña en la Fase 6 |
| **E** | El indicador de carga no aparece en el primer render: `loading` arranca en `false` | `useAvistamientos.js` | Pospuesto: el panel de filtros se rediseña en la Fase 6 |
| **F** | Los contadores no aclaran si son del total o del subconjunto visible | `AvistamientosContext.jsx` (`conteos` derivado de `avistamientosVisibles`) | Pospuesto: el panel de filtros se rediseña en la Fase 6 |
| **G** | Verificación visual del drawer móvil | Fase 2 | Pospuesto: el panel de filtros se rediseña en la Fase 6 |

Nota sobre **E**: el estado vacío (C) ya no miente en el primer render gracias a `inicializado`,
pero el indicador de carga sigue sin aparecer hasta la primera respuesta. Es exactamente lo que se
revisará al rehacer el panel.

**Riesgo principal de la fase, ya resuelto:** A tocaba el ciclo de vida del mapa, escrito para
tolerar el doble montaje de StrictMode (`setTarget(null)` + `dispose()`). Se evitó por completo al
resolver la atribución en el DOM en lugar de añadir un control de OpenLayers.

**Fases descartadas / no solicitadas:** modo oscuro (esfuerzo alto, tokens ya listos; el coste
está en la capa base oscura y en los colores de tipo) y selector de tipo con color (alternativa
barata: fila de chips con el patrón `ToggleCapa`).

---

## 10. Inventario de skills instaladas

48 skills en `.opencode/skills/`. **Están todas cargadas y muchas no aplican.**

| Grupo | Cuántas | ¿Aplica a este repo? |
|---|---|---|
| `apple-design` | 1 | Sí — auditoría de UI/UX, glassmorphism, HIG |
| `ui-ux-pro-max` + `design` + `design-system` + `ui-styling` + `banner-design` + `brand` + `slides` | 7 | **Parcial.** `ui-ux-pro-max`, `design-system` y `ui-styling` son la base del trabajo de §2. `banner-design`, `brand` y `slides` no tienen uso aquí. |
| Mapbox (`mapbox-*`) | 20 | **No.** El proyecto usa OpenLayers. |
| MapLibre (`maplibre-*`) | 11 | **No.** Mismo motivo. |
| Strix (`*security*`, `*pentest*`, `owasp-*`) | 9 | **No.** Orientadas a una plataforma de pentesting con Docker y claves de LLM, contra una app cliente estática. |

**Riesgo real:** las descripciones se usan para decidir qué skill cargar por coincidencia de
palabras. Frases como *"styling a map"*, *"markers"* o *"GeoJSON vs tiles"* harán que el agente
cargue una skill de Mapbox/MapLibre durante trabajo de **OpenLayers**, y entonces aconseje
`map.addLayer({type:'symbol'})`, `addImage` o `setFeatureState` — APIs que aquí no existen.
Recomendación (**pendiente antes de la Fase 6**): conservar `apple-design`, `ui-ux-pro-max`,
`design-system` y `ui-styling`, y podar el resto.

---

## 11. Comandos útiles

```bash
npm run dev             # Vite en :5173
npm run build           # build de producción
npm run preview
npm run seed:catalogo   # llena pokemon_catalogo desde PokeAPI (Fase 4)
```

Migraciones (las aplica el usuario, nunca el agente):

```bash
supabase db push        # aplica supabase/migrations/ en orden
```

No interactuar con git (`AGENTS.md` §6): solo recomendar comandos, no ejecutarlos.

Comprobación rápida de que los tokens siguen generándose tras editar `index.css`:

```powershell
$c = Get-Content (Get-ChildItem dist\assets\*.css)[0].FullName -Raw
foreach ($u in 'glass-panel','field','focus-ring','pressable','bg-primary','text-ink') {
  if ($c -match [regex]::Escape(".$u")) { "OK   .$u" } else { "MISS .$u" }
}
```

Regla de verificación de este proyecto: **el CSS compilado es la fuente de verdad** sobre si una
utilidad existe. Comprobar el fuente no basta — Tailwind purga lo que no se usa, y un patrón de
búsqueda mal escrito produce falsos negativos (me ha pasado dos veces en este repo con `.` y con
el escapado de `:` y `/`).

---

## 12. Fase 4 · Modelo de datos `reportes` — cerrada y verificada

Las migraciones **0001–0009** se aplicaron en Supabase; el 2026-10-20 el usuario cerró la fase:
`0008` quedó verificada con el seed del catálogo, `0009` con sus pruebas y el alta real de un
usuario. Plan aprobado antes de escribir; decisiones y porqué a continuación.

### Estado de ejecución

- **Aplicadas y verificadas por el usuario**: `0001` a `0009`, en orden. Sin errores reportados.
- Esas nueve migraciones son **históricas**: no editarlas. Cualquier cambio futuro del esquema va
  en `0010+` (la próxima migración libre es `0010`, ya de la Fase 5; Supabase registra el
  historial y no reejecuta archivos ya aplicados).
- **`0008_service_role_pokemon_catalogo.sql` aplicada y verificada.** Concede
  `SELECT/INSERT/UPDATE/DELETE` sobre `pokemon_catalogo` a `service_role` y fija los privilegios
  por defecto para tablas y secuencias futuras. No toca ninguna migración anterior. El seed del
  catálogo corrió **después** de aplicarla y terminó con 1025 Pokémon.
- **`0009_endurecimiento_seguridad.sql` aplicada, probada y ya histórica.** Fija `search_path`,
  revoca `EXECUTE` a los roles de API en las funciones de trigger y deja
  `listar_avistamientos_recientes` pública como excepción. Sus pruebas
  (`0009_verificar_triggers.sql` y `patron_funciones_nuevas.sql`) dieron `ok` en todos los casos
  bloqueantes. **No editar `0009`**; el detalle queda en §13. `0010` **no** es para corregir
  privilegios: es la primera migración de la Fase 5.
- **No volver a ejecutar `supabase/schema.sql`** sobre esta base: sus `insert ... on conflict do
  nothing` no tienen clave única que los proteja y duplicarían las semillas de ejemplo.
- Quedan activos los triggers de expiración, verificación y tope por hora, las políticas RLS y el
  trigger espejo `avistamientos → reportes`. La app sigue escribiendo en `avistamientos`.
- Verificación declarada por el usuario. Este archivo no registra métricas de latencia ni volumen
  porque no se midieron.

### Diagnóstico del fallo del seed (2026-10-20) — resuelto

El fallo reportado al usar la service key **no se explica solo por permisos de tabla**. Comprobado
contra el proyecto `ylebvurvjhismxyavgza`:

| Prueba | Resultado |
|---|---|
| `GET /rest/v1/pokemon_catalogo?select=id&limit=1` con la **anon key** del bundle | **200**, cuerpo `[]` |
| `POST /rest/v1/pokemon_catalogo` con body `{}` y la anon key (sin permiso de INSERT) | **401** con cuerpo `{"code":"42501","message":"permission denied for table pokemon_catalogo"}` |
| La misma petición con la service key **anterior** (`sb_secret_…`) | **401**, cuerpo **vacío** |
| `GET /rest/v1/` (raíz de PostgREST, sin tabla) con esa service key anterior | **401**, cuerpo **vacío** |

La diferencia está en el cuerpo: un fallo real de permisos trae `code 42501` y el nombre de la
tabla; la service key devuelve un 401 **vacío incluso en la raíz**, antes de evaluar privilegios.
Eso indica que la llave está siendo rechazada por el gateway: pertenece a otro proyecto, fue
rotada/revocada, o es una `sb_secret_…` que este proyecto todavía no tiene habilitada (el bundle usa
una anon JWT legacy `eyJ…`, señal de que el proyecto sigue en el sistema de llaves legacy).

**Actualización (2026-10-20, tras corregir la llave):** la llave efectiva de `.env` ya es una JWT
con `role: service_role` y `ref: ylebvurvjhismxyavgza`, que coincide con la referencia del proyecto
en `VITE_SUPABASE_URL`. No hay variables de sesión (`SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`,
`VITE_SUPABASE_URL`) que puedan pisar el `.env`. Una única lectura a `pokemon_catalogo` con esa
llave devolvió **403**: la llave es válida y correcta, y el problema restante era exactamente el
privilegio de tabla. `0008` lo corrigió (grant SELECT/INSERT/UPDATE/DELETE y defaults).

**Resuelto:** `0008` se aplicó y el seed corrió después. El 401 con cuerpo vacío era la llave
rechazada por el gateway (pertenecía a otro proyecto o estaba rotada); el `42501` era el fallo real
de permisos de tabla. El seed terminó con **1025 Pokémon** en `pokemon_catalogo`, filtrados a la
Pokédex nacional sobre **1351** procesados.

### Entregables

```
supabase/migrations/0001_extensiones.sql
supabase/migrations/0002_catalogos.sql
supabase/migrations/0003_config_probabilidad.sql
supabase/migrations/0004_reportes.sql
supabase/migrations/0005_confirmaciones.sql
supabase/migrations/0006_habitat_afinidad.sql
supabase/migrations/0007_avistamientos_a_reportes.sql
supabase/migrations/0008_service_role_pokemon_catalogo.sql
supabase/migrations/0009_endurecimiento_seguridad.sql
supabase/tests/0009_verificar_triggers.sql
supabase/tests/patron_funciones_nuevas.sql
supabase/README.md
scripts/seed-catalogo.mjs
.env.example
package.json  →  "seed:catalogo"
```

### Decisiones y su porqué

1. **`ubicacion geography(Point,4326)` como columna generada** desde `latitud`/`longitud`. El
   frontend ya habla lat/lon; la geografía derivada da distancias en metros y un índice GIST sin
   duplicar fuente de verdad.
2. **`tipo` es `text` con CHECK, no enum.** Añadir un tipo de reporte no debe requerir alterar un
   tipo de Postgres. Valores: `salvaje | nido | incursion | comentario`.
3. **Expiración en trigger, leyendo `config_probabilidad`.** `expira_en = creado_en + vida(tipo)`;
   `comentario` no expira (valor NULL). Solo se recalcula en INSERT o si cambia el tipo, para que
   editar un reporte no le alargue la vida.
4. **`verificado_en_sitio` lo decide el servidor.** El trigger mide la distancia entre el punto y
   la ubicación declarada y la compara con `radio_verificacion_m` (300 m por defecto). El booleano
   que envíe el cliente se ignora. Es señal de peso, nunca verdad por sí sola.
5. **Tope por hora en trigger.** Cuenta reportes del autor en la última hora y lanza excepción.
   Índice `(autor_id, creado_en desc)`. Queda documentado que dos inserts concurrentes podrían
   colarse; si se necesita rigor absoluto, añadir un advisory lock por usuario.
6. **Snapshot en `reportes`** (`pokemon_nombre`, `pokemon_tipos`) y **sin FK dura a
   `pokemon_catalogo`**: la migración corre antes del seed y un id ausente no debe tumbar un
   reporte. El catálogo enriquece, no condiciona.
7. **`pokemon_catalogo.tipos` es `text[]`** porque hay doble tipo; un trigger valida cada id
   contra `pokemon_tipos`, que replica los ids de `constants.js`.
8. **RLS: lectura pública, escritura con sesión y solo lo propio.** `autor_id`/`usuario_id`
   referencian `auth.users` (no `perfiles`) para no depender de que el perfil exista. Las tablas
   de catálogo/config tienen solo SELECT: las edita `service_role`.
9. **`confirmaciones` con PK `(reporte_id, usuario_id)`**: una fila por usuario y reporte. Se
   permite cambiar el voto (UPDATE propio) en lugar de voto inmutable.
10. **`config_probabilidad` clave/valor + `fn_config(clave)`.** Valores iniciales:
    salvaje 90 min, nido 20160 min, incursión 60 min, comentario NULL, tope 10/hora,
    `min_usuarios_nivel_alto` 3, radio 300 m. Editables sin tocar código.
11. **Continuidad con el frontend actual.** Backfill idempotente con `origen_id` UNIQUE (guarda
    `avistamientos.id`) + **trigger espejo** `avistamientos → reportes` + la tabla y la RPC
    `listar_avistamientos_recientes` intactas. Así la app no sufre regresión mientras no se
    adapte. Al migrar el frontend: quitar el trigger, escribir la RPC nueva y archivar
    `avistamientos`.

### Límites conocidos (para las fases siguientes)

- `reportes` exige sesión autenticada, y la app **no tiene login** (`persistSession: false`). La
  escritura real sigue pasando por `avistamientos` (espejo) hasta la fase de autenticación.
- **La política de inserción de `avistamientos` es temporal** (`with check (true)`, sin `TO`).
  **La app no se publica hasta cerrar la política y el destino del trigger espejo en la Fase 7**,
  cuando el formulario escriba en `reportes` (o en una RPC validada) y se revoque el INSERT anónimo
  directo.
- **La función de probabilidad/nivel no existe todavía**: `celdas_habitat`, `afinidad_terreno` y
  `config_probabilidad` quedan listos y vacíos de lógica.
- `terrenos` (7 tipos) no es el vocabulario de `habitats.tipo_area` (5 tipos); se reconcilian en
  la Fase 6.
- Los ids de tipo de reporte no están en `constants.js` todavía (Fases 6 y 7).
- El `h3_index` de los reportes migrados desde `avistamientos` queda pendiente para la Fase 5.
- El seed del catálogo requiere `SUPABASE_SERVICE_ROLE_KEY` en el `.env` (sin prefijo `VITE_`) y
  la migración `0008` aplicada (ya está). Verificado en seco (`--dry-run`) contra PokeAPI: nombres
  en español, doble tipo y `es_legendario` incluyendo míticos (Mew = true).
- **El seed se ejecutó y terminó:** `pokemon_catalogo` tiene **1025 Pokémon**, filtrados a la
  Pokédex nacional sobre **1351** procesados. Los reportes nuevos ya pueden completar
  nombre/tipos desde el catálogo.

---

## 13. Endurecimiento de seguridad `0009` — aplicado, probado e histórico

Plan aprobado antes de escribir. `0009_endurecimiento_seguridad.sql` no edita `0001–0008`.

### Estado: aplicado, probado e histórico

`0009` está aplicada en Supabase y es **histórica**: no se edita. El Advisor quedó en **3
advertencias aceptadas**: `listar_avistamientos_recientes` para `anon`, la misma para
`authenticated` y la política temporal `avistamientos insercion` (se cierra en la Fase 7). Cualquier
cambio de esquema va en una migración futura; la próxima libre es `0010`, ya de la Fase 5.

**Verificado por el usuario (2026-10-20):**

- `supabase/tests/0009_verificar_triggers.sql`: los seis triggers y los permisos de las funciones
  dieron `ok`.
- `supabase/tests/patron_funciones_nuevas.sql`: todos los casos bloqueantes dieron `ok`; el caso
  informativo mostró `anon=t` sin `REVOKE`, por el default de `PUBLIC`.
- Prueba real del trigger de registro: se creó un usuario en Authentication, apareció su fila en
  `perfiles` y se borró. Funciona.

La prueba **original** de `0009_verificar_triggers.sql` había fallado con:

```
P0001: anon puede ejecutar una función nueva sin GRANT explícito
```

La causa y la corrección quedan en el diagnóstico siguiente.

### Diagnóstico del fallo (privilegios por defecto)

**Causa confirmada por la documentación oficial de PostgreSQL.** Los privilegios por defecto
**por esquema se suman** a los globales; no los reemplazan. Referencia de
`ALTER DEFAULT PRIVILEGES` (texto literal):

> Default privileges that are specified per-schema are added to whatever the global default
> privileges are for the particular object type. This means you cannot revoke privileges
> per-schema if they are granted globally (either by default, or according to a previous `ALTER
> DEFAULT PRIVILEGES` command that did not specify a schema). Per-schema `REVOKE` is only useful to
> reverse the effects of a previous per-schema `GRANT`.

Su propio ejemplo es nuestro caso: para quitar el `EXECUTE` de `PUBLIC` en funciones nuevas hay que
hacerlo **global** (`ALTER DEFAULT PRIVILEGES ... REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;`, sin
`IN SCHEMA`); el mismo `REVOKE` **con `IN SCHEMA public` no tiene efecto** salvo que deshaga un
`GRANT` previo por esquema.

Por lo tanto, la línea de `0009`:

```sql
alter default privileges in schema public
  revoke execute on functions from public, anon, authenticated;
```

no podía quitar el `EXECUTE` implícito de `PUBLIC` (default **global** incorporado). `fn_prueba_0009`
nació con `EXECUTE` para `PUBLIC`, y `anon`/`authenticated` lo heredan porque todo rol es miembro
implícito de `PUBLIC`. Esa es la causa completa del `P0001`. **No hace falta** suponer un cambio de
rol entre migración y test; el test no registra `current_user`, pero eso ya no es la explicación.

Descartado: `CREATE OR REPLACE` sobre una función existente (el test hace `DROP` antes).

**Confirmación con la consulta:** no hay filas de `pg_default_acl` para `postgres` en `public` ni
globales; solo defaults de esquemas internos de Supabase. Por tanto, el default que aplica en
`public` es el incorporado de PostgreSQL (`EXECUTE` a `PUBLIC`), y no existe un `GRANT` por esquema
que una migración posterior pudiera revertir.

**Consulta de solo lectura sobre `pg_default_acl`** (SQL Editor):

```sql
select current_user, session_user;

select
  d.defaclrole::regrole                                  as rol_dueno,
  coalesce(n.nspname, '(global)')                         as esquema,
  d.defaclobjtype                                         as tipo,   -- f = funciones
  d.defaclacl::text                                       as acl_por_defecto,
  a.grantee,
  case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end as quien,
  a.privilege_type,
  a.is_grantable
from pg_default_acl d
left join pg_namespace n on n.oid = d.defaclnamespace
cross join lateral aclexplode(d.defaclacl) a
where d.defaclobjtype = 'f'
order by rol_dueno, esquema, quien, privilege_type;
```

Interpretación: muestra las reglas **por defecto** (globales y por esquema) de funciones y su rol
dueño. El `EXECUTE` de `PUBLIC` es un default **global incorporado** y no se puede quitar por
esquema. En este proyecto no aparecen filas para `postgres` en `public` ni globales (solo defaults
de esquemas internos de Supabase), así que **no hay un default por esquema que revertir**: las
funciones nuevas de `public` usan el default incorporado. La garantía es el `REVOKE` explícito por
función.

### Decisión: la corrección es por patrón; no hay migración de privilegios

`0010` es la próxima migración libre y pertenece a la Fase 5, no a esta corrección. No se crea una
migración vacía solo para documentar la regla. La corrección es doble:

1. **Patrón explícito en cada migración que cree una función** (la red de seguridad real):

```sql
revoke execute on function public.<fn>(<args>) from public, anon, authenticated;
grant  execute on function public.<fn>(<args>) to <rol_que_la_usa>;
```

2. **Pruebas separadas** que verifican el patrón (`patron_funciones_nuevas.sql`) y los triggers
   (`0009_verificar_triggers.sql`).

**No se añade un `REVOKE` global de `PUBLIC`.** Motivo (efecto secundario):

- Un `ALTER DEFAULT PRIVILEGES` **global** (sin `IN SCHEMA`) no se limita a `public`: aplica a toda
  función futura creada por ese rol **en cualquier esquema**, incluido `extensions` y los esquemas
  internos de Supabase.
- Las extensiones (PostGIS, `pgcrypto`, `uuid-ossp`, `pg_graphql`, etc.) crean funciones al
  instalarse/actualizarse con el rol administrador. Muchas dependen del `EXECUTE` a `PUBLIC` por
  defecto; quitarlo globalmente las deja inaccesibles para `anon`/`authenticated` y puede romper
  características que ya funcionan.
- El `REVOKE` global es demasiado amplio como red de seguridad; el `REVOKE` explícito por función
  es exacto y local.

**`service_role` también hereda de `PUBLIC`.** Al revocar `EXECUTE` de `PUBLIC`, `service_role`
pierde la ejecución implícita. Si una función debe llamarse desde un script de Node con la
`service_role`, el `GRANT` explícito debe incluir `service_role`; su condición de rol de servicio
no le da `EXECUTE` por sí sola.

**Defaults por esquema: descartado.** La consulta no muestra filas para `postgres` en `public` ni
globales, así que no hay un `GRANT` por esquema que revertir.

### Pruebas

Dos archivos separados, ambos con `select current_user, session_user;` y una tabla de resultados
antes del `ROLLBACK`:

1. `supabase/tests/0009_verificar_triggers.sql` — permisos de las seis funciones de trigger,
   `listar_avistamientos_recientes` y disparo de los seis triggers. No depende de los defaults.
2. `supabase/tests/patron_funciones_nuevas.sql` — crea una función, aplica el `REVOKE` explícito,
   comprueba que `anon`/`authenticated` no ejecutan, aplica `GRANT` y comprueba que solo ejecutan
   los roles beneficiados. Incluye un caso informativo (no bloqueante) sin `REVOKE` que muestra
   que `anon` sí ejecuta por el default `PUBLIC`.

Cada caso va aislado con `begin ... exception when others ...` para que un fallo no aborte el
resto. Los ejecutó el usuario en el SQL Editor el 2026-10-20: ambos pasaron (ver "Verificación").

### Qué hace

- Fija `search_path` explícito:
  - `public` para `fn_set_actualizado_en`, `fn_espejo_avistamiento_a_reporte`,
    `fn_handle_new_user`, `fn_reportes_limite_hora` y `fn_validar_tipos_pokemon`.
  - `public, extensions` para `fn_reportes_normalizar`, que usa `ST_Distance`,
    `ST_MakePoint` y `ST_SetSRID` sin calificar.
- Revoca `EXECUTE` de `public`, `anon` y `authenticated` a las seis funciones de trigger,
  incluida `fn_set_actualizado_en` (es `SECURITY INVOKER`, pero ningún rol de API debe
  ejecutarla).
- `listar_avistamientos_recientes`: `search_path = public`, `REVOKE` del `EXECUTE` implícito de
  `PUBLIC`, `GRANT` explícito a `anon, authenticated` y comentario de excepción aceptada.
- Intenta revocar `EXECUTE` por defecto para funciones nuevas:
  ```sql
  alter default privileges in schema public
    revoke execute on functions from public, anon, authenticated;
  ```
  **No funcionó para `PUBLIC`**: por esquema solo se suman privilegios; el `EXECUTE` de `PUBLIC`
  es global. **`0009` es histórica y esta línea no se edita**; queda documentada como ineficaz. Por
  eso la regla es el `REVOKE` explícito por función en cada migración (ver diagnóstico).
- Anota la política `avistamientos insercion` como temporal.
- `notify pgrst, 'reload schema';`

### Porqué

- Una función `SECURITY DEFINER` ejecutable por `anon`/`authenticated` es un endpoint RPC que
  corre con los privilegios de su owner y puede saltarse RLS. Las funciones de trigger no son
  API: no deben poder invocarse con la anon key.
- Revocar `EXECUTE` **no apaga los triggers**: PostgreSQL comprueba el privilegio al crear el
  trigger, no en cada disparo. La prueba SQL lo demuestra.
- `fn_set_actualizado_en` no es `SECURITY DEFINER`, pero se revoca igual por mínimo privilegio.
- `listar_avistamientos_recientes` se queda pública a propósito: es la RPC de lectura del
  frontend anónimo actual. Se documenta como excepción aceptada, no como descuido.
- El `REVOKE` por defecto convierte la regla en algo verificable, no en una convención oral. En la
  práctica **no basta**: los defaults por esquema se suman a los globales (y además son por rol
  dueño), así que no quitan el `EXECUTE` de `PUBLIC`; la garantía es el `REVOKE` explícito por
  función. Ver el diagnóstico del fallo arriba.

### Las 6 advertencias y el rol `authenticated`

Las 6 advertencias restantes que se ven desde `authenticated` (lint `0029`) son las mismas 6
funciones:

1. `fn_set_actualizado_en` — `0011_function_search_path_mutable`.
2. `fn_espejo_avistamiento_a_reporte` — `0029_security_definer_function_executable`.
3. `fn_handle_new_user` — idem.
4. `fn_reportes_limite_hora` — idem.
5. `fn_reportes_normalizar` — idem.
6. `fn_validar_tipos_pokemon` — idem.

El `REVOKE` a `authenticated` cubre las cinco funciones `SECURITY DEFINER`. La advertencia de
`fn_set_actualizado_en` es de `search_path` (`0011`), no de `SECURITY DEFINER`, y se corrige con
el `ALTER ... SET search_path`. `listar_avistamientos_recientes` queda fuera de las 6 por ser la
excepción aceptada.

### Advisor alcanzado (3 advertencias)

Quedaron **3 advertencias**:

1. `listar_avistamientos_recientes` para `anon` — excepción aceptada.
2. `listar_avistamientos_recientes` para `authenticated` — excepción aceptada.
3. `avistamientos insercion` — política temporal, se cierra en la Fase 7.

Si el Advisor sigue mostrando `fn_reportes_normalizar` u otra función de trigger, revisar que
`0009` se aplicó y que el `REVOKE` se ejecutó con el rol correcto.

### Política de `avistamientos`: temporal y bloqueante de publicación

Hoy `avistamientos insercion` es `FOR INSERT WITH CHECK (true)`, sin `TO`: permite insertar a
cualquier rol que tenga el privilegio de tabla, incluida la app anónima. No hay UPDATE/DELETE.
El trigger espejo copia el avistamiento a `reportes` con `origen_id`, tipo (`nido`/`salvaje`),
snapshot de Pokémon, coordenadas, H3, texto, `autor_nombre` y `creado_en`; deja `autor_id` nulo y
el normalizador calcula `expira_en` y `verificado_en_sitio = false`. Como `autor_id` es nulo, el
tope por hora no se aplica a los espejos. Es `SECURITY DEFINER`, así que bypassa la política de
inserción de `reportes`.

**Decisión:** no se cierra en `0009`. Cerrarla ahora rompería el formulario, que escribe con la
anon key y sin login. **La app no se publica hasta cerrar esta política y el destino del trigger
espejo en la Fase 7**, cuando el formulario escriba en `reportes` (o en una RPC validada) y se
revoque el INSERT anónimo directo.
No se debe simplemente eliminar la política ni revocar `INSERT` antes de esa migración.

### Regla permanente para funciones nuevas

**No se confía en los privilegios por defecto.** Toda migración que cree una función incluye, en la
misma migración:

```sql
revoke execute on function public.<fn>(<args>) from public, anon, authenticated;
grant  execute on function public.<fn>(<args>) to <rol_que_la_usa>;
```

- **`search_path` explícito** en cada función. Las que usan PostGIS lo fijan a
  `public, extensions`; el resto, a `public`.
- El `GRANT` explícito va **solo a quien deba usarla**. Las funciones de trigger no reciben
  `GRANT`.
- Si la llama un script de Node con `service_role`, el `GRANT` **también incluye `service_role`**:
  hereda de `PUBLIC`, así que al revocar `PUBLIC` pierde el `EXECUTE` implícito.
- **Cada función nueva lleva su prueba de permisos**, basada en
  `supabase/tests/patron_funciones_nuevas.sql` (crear → `REVOKE` → verificar que `anon`/
  `authenticated` no ejecutan → `GRANT` → verificar que solo ejecutan los beneficiados).
- **El Security Advisor se revisa al cerrar cada fase.** La red de seguridad es este patrón
  explícito más el Advisor, no una migración de defaults.
- `pokemon_cercanos` de la Fase 5 será pública a propósito: `search_path` fijo y `GRANT EXECUTE`
  explícito a `anon, authenticated`.
- `listar_avistamientos_recientes` es la única excepción pública `SECURITY DEFINER` aceptada por
  ahora.

### Verificación

Cierre declarado por el usuario en Supabase (2026-10-20):

- `0009` aplicada; Advisor en **3 advertencias aceptadas**.
- `0009_verificar_triggers.sql`: seis triggers y permisos, `ok`.
- `patron_funciones_nuevas.sql`: casos bloqueantes `ok`; el informativo mostró `anon=t` sin
  `REVOKE` (default de `PUBLIC`).
- Trigger de registro probado de verdad: usuario creado en Authentication → fila en `perfiles` →
  usuario borrado.
- Local no se ejecutó SQL: no hay PostgreSQL ni contraseña de la base. `npm run build` ya había
  pasado al crear `0009`.

---

## 14. Pendientes vigentes

| Pendiente | Fase | Detalle |
|---|---|---|
| Política de `avistamientos` y trigger espejo | **7** | Cerrar la inserción anónima (`with check (true)`) y decidir el destino del espejo `avistamientos → reportes`; bloquea la publicación. |
| `terrenos` vs `habitats.tipo_area` | **6** | 7 tipos contra 5; reconciliar el vocabulario en la fase de cálculo. |
| Ids de tipo de reporte en `constants.js` | **6 y 7** | Faltan `salvaje`, `nido`, `incursion` y `comentario` en el frontend. |
| Poda de skills de Mapbox, MapLibre y Strix | **antes de la 6** | 40 skills que no aplican (20 + 11 + 9); el riesgo está documentado en §10. |
| `h3_index` de los reportes migrados | **5** | Se completa al migrar la escritura a `reportes`; los espejos actuales lo dejan pendiente. |
| Protección contra contraseñas filtradas en Auth | **revisar en la 7** | Activar/verificar la comprobación de contraseñas filtradas de Supabase Auth. |

Reglas de entorno asociadas:

- `.env` contiene la `service_role` y **debe seguir ignorado en git** (`.gitignore` ya cubre
  `.env`, `.env.local` y `*.local`). La `service_role` nunca va al frontend ni lleva prefijo
  `VITE_`.
- El caché de Overpass de la Fase 5 irá en una **carpeta ignorada** por git (por ejemplo
  `scripts/.overpass-cache/`), para no versionar respuestas de terceros.
