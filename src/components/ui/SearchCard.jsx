import { useId } from 'react';
import {
  Crosshair,
  Layers,
  Leaf,
  Loader2,
  Map as MapIcon,
  RotateCw,
  Search,
  Star,
  X,
} from 'lucide-react';
import { CAPAS, FILTRO_TODOS, POKEMON_TIPOS_LISTA } from '../../config/constants';
import { CAPAS_BASE_LISTA } from '../../config/mapConfig';
import { useAvistamientosContext } from '../../context/AvistamientosContext';

/**
 * SearchCard.jsx
 * ---------------------------------------------------------------------------
 * Componente de UI (SRP): tarjeta flotante estilo Google Maps (Glassmorphism).
 * Captura interacciones (búsqueda, filtros, toggles y base) y las delega al
 * estado global. Sin lógica de negocio ni transformaciones espaciales.
 *
 * Estilizado: consume la capa semántica del sistema de diseño (`glass-panel`,
 * `field`, `bg-primary`, `text-ink`…) definida en `src/index.css`. No quedan
 * valores hex crudos en este archivo.
 * ---------------------------------------------------------------------------
 */

/**
 * Presentación de las capas temáticas del visor.
 *
 * Antes estaba inline y repetida 4 veces, con el color en hex crudo. Ahora el
 * acento se expresa como utilidad de token (`text-layer-*`), de modo que el
 * sistema de diseño sigue siendo la única fuente de verdad. Las cadenas son
 * literales para que el escáner de Tailwind las detecte.
 */
const CAPAS_UI = [
  { id: CAPAS.AVISTAMIENTOS, etiqueta: 'Avistamientos', Icono: Crosshair, acento: 'text-layer-sightings' },
  { id: CAPAS.NIDOS, etiqueta: 'Nidos', Icono: Star, acento: 'text-layer-nests' },
  { id: CAPAS.HABITATS, etiqueta: 'Zonas de hábitat', Icono: Leaf, acento: 'text-layer-habitats' },
  { id: CAPAS.H3, etiqueta: 'Malla H3', Icono: Layers, acento: 'text-layer-h3' },
];

/**
 * Conmutador de capa.
 *
 * Accesibilidad aplicada:
 * - `aria-pressed` comunica el estado a lectores de pantalla.
 * - El estado inactivo usa `text-ink-soft` (#475569) en lugar del antiguo
 *   `text-slate-400`, que daba 4.34:1 y no alcanzaba el mínimo WCAG 1.4.3
 *   (4.5:1) para texto normal.
 * - `focus-ring` hace visible el foco de teclado.
 * - En táctil el objetivo mide 44px de alto (`min-h-11`); en escritorio se
 *   compacta a 32px, donde el puntero preciso no necesita ese margen.
 * - El icono lleva `aria-hidden`: la etiqueta de texto ya transmite el
 *   significado, así que el icono es decorativo.
 */
function ToggleCapa({ activa, onClick, Icono, etiqueta, acento }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={activa}
      className={[
        'pressable focus-ring inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3 py-1.5',
        'text-xs font-medium sm:min-h-8',
        activa
          ? 'border-glass-border bg-glass text-ink shadow-sm'
          : 'border-glass-border bg-surface-muted/70 text-ink-soft',
      ].join(' ')}
    >
      <Icono
        className={`h-3.5 w-3.5 shrink-0 ${activa ? acento : 'text-ink-disabled'}`}
        aria-hidden="true"
      />
      {etiqueta}
    </button>
  );
}

export default function SearchCard() {  const {
    filters,
    capas,
    capaBase,
    h3Resolucion,
    conteos,
    loading,
    modoReporte,
    setQuery,
    setTipo,
    setCapaBase,
    toggleCapa,
    setH3Resolucion,
    refrescar,
    iniciarReporte,
  } = useAvistamientosContext();

  // Identificador estable para asociar la etiqueta accesible del buscador.
  const idBusqueda = useId();

  return (
    <section className="space-y-4" aria-label="Búsqueda y filtros">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-sm font-semibold tracking-tight text-ink">
            <MapIcon className="h-4 w-4 text-primary" aria-hidden="true" />
            Geoportal Pokémon GO
          </h1>
          <p className="mt-0.5 text-xs text-ink-muted">
            {conteos.avistamientos} avistamientos · {conteos.nidos} nidos
          </p>
        </div>

        <button
          type="button"
          onClick={refrescar}
          disabled={loading}
          aria-label="Recargar avistamientos"
          className="pressable focus-ring rounded-xl border border-glass-border bg-glass p-2 text-ink-soft hover:text-primary disabled:opacity-50"
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <RotateCw className="h-4 w-4" aria-hidden="true" />
          )}
        </button>
      </header>

      {/* Búsqueda por nombre o ID.
          `<label>` con texto solo para lectores de pantalla: el placeholder
          por sí solo no es una etiqueta válida (WCAG 3.3.2 / 4.1.2).
          El botón de limpiar va FUERA del `<label>`: un control interactivo
          anidado en una etiqueta es HTML inválido y provoca que pulsarlo
          también enfoque el campo. */}
      <div className="relative">
        <label htmlFor={idBusqueda} className="sr-only">
          Buscar Pokémon por nombre o ID
        </label>
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted"
          aria-hidden="true"
        />
        <input
          id={idBusqueda}
          type="search"
          value={filters.query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Buscar Pokémon por nombre o ID…"
          className="field w-full py-2 pl-9 pr-9 text-sm"
        />
        {filters.query && (
          <button
            type="button"
            onClick={() => setQuery('')}
            aria-label="Limpiar búsqueda"
            className="pressable focus-ring absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1 text-ink-muted hover:text-ink"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </div>

      {/* Filtro por tipo */}
      <div>
        <label htmlFor="filtro-tipo" className="mb-1.5 block text-xs font-medium text-ink-soft">
          Tipo de Pokémon
        </label>
        <select
          id="filtro-tipo"
          value={filters.tipo}
          onChange={(event) => setTipo(event.target.value)}
          className="field w-full px-3 py-2 text-sm"
        >
          <option value={FILTRO_TODOS}>Todos los tipos</option>
          {POKEMON_TIPOS_LISTA.map((tipo) => (
            <option key={tipo.id} value={tipo.id}>
              {tipo.label}
            </option>
          ))}
        </select>
      </div>

      {/* Conmutadores de capas temáticas */}
      <fieldset className="space-y-2">
        <legend className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-ink-soft">
          <Layers className="h-3.5 w-3.5" aria-hidden="true" />
          Capas
        </legend>

        <div className="flex flex-wrap gap-2">
          {CAPAS_UI.map(({ id, etiqueta, Icono, acento }) => (
            <ToggleCapa
              key={id}
              activa={Boolean(capas[id])}
              onClick={() => toggleCapa(id)}
              Icono={Icono}
              etiqueta={etiqueta}
              acento={acento}
            />
          ))}
        </div>

        {/* Resolución H3 (solo relevante con la malla activa). */}
        {capas[CAPAS.H3] && (
          <label className="flex items-center gap-2 pt-1 text-xs text-ink-soft">
            <span className="whitespace-nowrap">Resolución H3</span>
            <input
              type="range"
              min={5}
              max={12}
              step={1}
              value={h3Resolucion}
              onChange={(event) => setH3Resolucion(Number(event.target.value))}
              className="focus-ring h-11 flex-1 cursor-pointer accent-primary sm:h-auto"
            />
            <span className="w-6 text-right font-mono text-ink">{h3Resolucion}</span>
          </label>
        )}
      </fieldset>

      {/* Capa base */}
      <div>
        <span className="mb-1.5 block text-xs font-medium text-ink-soft">Capa base</span>
        <div className="flex gap-2">
          {CAPAS_BASE_LISTA.map((capa) => {
            const activa = capaBase === capa.id;
            return (
              <button
                key={capa.id}
                type="button"
                onClick={() => setCapaBase(capa.id)}
                aria-pressed={activa}
                className={[
                  'pressable focus-ring min-h-11 flex-1 rounded-xl border px-3 py-1.5 text-xs font-medium',
                  'sm:min-h-8',
                  activa
                    ? 'border-primary-edge bg-primary-soft text-primary-ink shadow-sm'
                    : 'border-glass-border bg-glass text-ink-soft hover:text-ink',
                ].join(' ')}
              >
                {capa.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* CTA de captura */}
      <button
        type="button"
        onClick={iniciarReporte}
        disabled={modoReporte}
        className="pressable focus-ring flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-primary-hover disabled:opacity-50"
      >
        <Crosshair className="h-4 w-4" aria-hidden="true" />
        Reportar avistamiento / nido
      </button>
    </section>
  );
}
