# MEMORY.md

> **Qué es este archivo.** Contexto persistente del proyecto: decisiones tomadas, su
> justificación, estado medido y trabajo pendiente. Existe para que una sesión nueva (o
> otra persona/agente) no tenga que redescubrir nada ni deshacer decisiones sin saber por qué.
>
> **Cuándo actualizarlo.** Al cerrar una fase, al cambiar una decisión de diseño, o al
> descubrir una restricción del entorno. `AGENTS.md` manda sobre este archivo: si hay
> conflicto, gana `AGENTS.md`.
>
> Última actualización: Fase 2 (IA móvil) completada, Fase 3 planificada y no iniciada.

---

## 1. Qué es el proyecto

| | |
|---|---|
| Nombre | `geoportal-pokemon-go` |
| Qué es | Geoportal de hábitats, nidos y avistamientos de Pokémon GO |
| Stack mapas | **OpenLayers 10** (`ol`), **no** Mapbox ni MapLibre |
| Stack UI | React 18 + Vite 6 + Tailwind CSS **4.3.3** (plugin de Vite, sin `tailwind.config.js`) |
| Geo/espacial | `proj4` (reproyección CRS), `h3-js` (malla hexagonal) |
| Datos | Supabase (`@supabase/supabase-js`), tabla `avistamientos` + RPC `listar_avistamientos_recientes` |
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
│   ├── map/MapViewer.jsx      Render + eventos. Lógica OL en hooks.
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
│   ├── useMediaQuery.js       ★ NUEVO — breakpoints reactivos
│   ├── useOpenMap.js          Ciclo de vida ol/Map
│   ├── useAvistamientos.js    Datos + realtime Supabase
│   ├── useHabitats.js / useUserLocation.js
│   └── use*Layer.js           Sincronización datos → capas vectoriales
├── config/                    constants.js · mapConfig.js · supabaseClient.js
└── utils/                     pokemonUtils · spatialUtils · mapStyles · formatUtils
```

`★` = creado en las Fases 1 y 2.

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

### Pendiente (ver Fase 3)
- **`flyTo` anima 600 ms ignorando `prefers-reduced-motion`** (`useOpenMap.js:164`). Lo único
  que se mueve solo en esta app es la cámara del mapa, y es justo donde no se respetó la
  preferencia. `@utility pressable` sí la respeta; el mapa no.
- **`DetailSheet` declara `role="dialog"` sin gestionar el foco.** Incoherente: se anuncia como
  diálogo pero el foco se queda en el mapa.
- **`FilterDrawer` sin verificación visual en navegador** (ver §9).

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

## 9. Trabajo pendiente — Fase 3

Plan completo presentado y **aprobación aún pendiente**. Resumen:

| # | Hallazgo | Evidencia | Tipo | Decisión necesaria |
|---|---|---|---|---|
| **A** | **La atribución de OSM/CARTO no se muestra nunca.** `attributions` está declarado en `mapConfig.js:28,39` pero `controls: []` (`useOpenMap.js:92`) elimina el control `Attribution`, y ningún componente lo renderiza | verificado con grep en todo `src/` | **Compliance / legal** | Pastilla propia (recomendado) vs control nativo de OL |
| **B** | `flyTo` ignora `prefers-reduced-motion` | `useOpenMap.js:164` | Accesibilidad | — |
| **C** | No existe estado vacío (sin configurar / error / 0 resultados) | `avistamientosVisibles` vacío no dice nada | UX | — |
| **D** | La selección no se limpia al filtrarla | `AvistamientosContext.jsx:59-62` busca en `avistamientos`, no en `avistamientosVisibles` | Inconsistencia | (a) limpiar ficha vs (b) mantenerla |
| **E** | El indicador de carga no aparece en el primer render | `useAvistamientos.js:29`: `loading` arranca en `false` | UX menor | — |
| **F** | Los contadores no aclaran si son del total o del subconjunto | `Context:64` deriva de `avistamientosVisibles` | UX / ambigüedad | — |
| **G** | Verificación visual del drawer móvil | Fase 2 | Deuda | — |

**Orden propuesto:** `Fase 0 (verificación) → A1 A2 A4 → A3 → B1 B2 → C`

A1 (atribución) se prioriza deliberadamente: es el único punto de la lista con consecuencias
**legales**, no estéticas. La política de uso de teselas de OSM exige atribución.

**Riesgo principal:** A1 toca `useOpenMap.js`, el ciclo de vida del mapa, que está escrito para
tolerar el doble montaje de StrictMode (`setTarget(null)` + `dispose()`). Un control nuevo mal
limpiado puede reintroducir el memory leak.

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
Recomendación: conservar `apple-design`, `ui-ux-pro-max`, `design-system` y `ui-styling`, y
podar el resto.

---

## 11. Comandos útiles

```bash
npm run dev        # Vite en :5173
npm run build      # build de producción
npm run preview
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
