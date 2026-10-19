import { useMemo } from 'react';
import { Clock, Hexagon, Navigation, Ruler, Star, X } from 'lucide-react';
import { H3_RESOLUCION_POR_DEFECTO, getPokemonTipoMeta } from '../../config/constants';
import { useAvistamientosContext } from '../../context/AvistamientosContext';
import { useMapContext } from '../../context/MapContext';
import { useDismissOnEscape } from '../../hooks/useDismissOnEscape';
import {
  construirUrlRuta,
  formatearAntiguedad,
  formatearDistancia,
} from '../../utils/formatUtils';
import { latLngToH3Index, haversineDistance, isValidH3Index } from '../../utils/spatialUtils';

/**
 * DetailSheet.jsx
 * ---------------------------------------------------------------------------
 * Componente de UI (SRP): Bottom Sheet en móvil / tarjeta lateral flotante en
 * escritorio. Muestra antigüedad, distancia, celda H3 del avistamiento y ofrece
 * el botón "Cómo llegar".
 *
 * Accesibilidad:
 * - Escape cierra el panel (convención esperada por usuarios de teclado).
 *   La suscripción al teclado vive en `useDismissOnEscape`, no aquí.
 * - El badge de tipo usa texto oscuro (`text-ink`) + punto de color, en lugar
 *   de teñir el texto con el color del tipo. Varios colores oficiales son muy
 *   claros (p. ej. Eléctrico #F7D02C ≈ 1.6:1 sobre blanco) y como color de
 *   texto incumplirían WCAG 1.4.3; el color queda como indicador no textual.
 * ---------------------------------------------------------------------------
 */

export default function DetailSheet() {
  const { selectedAvistamiento, clearSelection } = useAvistamientosContext();
  const { userLocation } = useMapContext();

  // El listener debe registrarse antes del early return (reglas de Hooks).
  useDismissOnEscape(clearSelection, Boolean(selectedAvistamiento));

  const h3Index = useMemo(() => {
    if (!selectedAvistamiento) return null;
    if (isValidH3Index(selectedAvistamiento.h3_index)) return selectedAvistamiento.h3_index;

    try {
      return latLngToH3Index(
        selectedAvistamiento.latitud,
        selectedAvistamiento.longitud,
        H3_RESOLUCION_POR_DEFECTO,
      );
    } catch {
      return null;
    }
  }, [selectedAvistamiento]);

  const distancia = useMemo(() => {
    if (!selectedAvistamiento || !userLocation) return null;
    return haversineDistance(
      userLocation.latitud,
      userLocation.longitud,
      selectedAvistamiento.latitud,
      selectedAvistamiento.longitud,
    );
  }, [selectedAvistamiento, userLocation]);

  // Early return: sin selección no hay panel.
  if (!selectedAvistamiento) return null;

  const { pokemon_name, pokemon_id, pokemon_type, es_nido, descripcion, latitud, longitud, creado_en } =
    selectedAvistamiento;
  const meta = getPokemonTipoMeta(pokemon_type);

  return (
    <aside
      role="dialog"
      aria-label={`Detalle de ${pokemon_name}`}
      className={[
        // Móvil: Bottom Sheet deslizable.
        'glass-panel pointer-events-auto absolute inset-x-0 bottom-0 rounded-t-3xl',
        'max-h-[70vh] overflow-y-auto pb-[env(safe-area-inset-bottom)]',
        // Escritorio: tarjeta lateral flotante.
        'sm:inset-x-auto sm:bottom-4 sm:right-4 sm:top-4 sm:max-h-none sm:w-96 sm:rounded-2xl sm:pb-0',
        'p-4',
      ].join(' ')}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-2xs font-semibold text-ink"
              style={{ backgroundColor: `${meta.color}1a`, borderColor: `${meta.color}66` }}
            >
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: meta.color }}
                aria-hidden="true"
              />
              {meta.label}
            </span>
            {es_nido && (
              <span className="inline-flex items-center gap-1 rounded-full border border-warning-edge bg-warning-soft px-2.5 py-1 text-2xs font-semibold text-warning">
                <Star className="h-3 w-3" aria-hidden="true" />
                Nido
              </span>
            )}
          </div>

          <h2 className="mt-2 truncate text-base font-semibold tracking-tight text-ink">
            {pokemon_name}
            {Number.isFinite(pokemon_id) && (
              <span className="ml-1.5 font-mono text-xs font-normal text-ink-muted">
                #{String(pokemon_id).padStart(3, '0')}
              </span>
            )}
          </h2>
        </div>

        <button
          type="button"
          onClick={clearSelection}
          aria-label="Cerrar detalle"
          className="pressable focus-ring rounded-xl border border-glass-border bg-glass p-2 text-ink-soft hover:text-ink"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </header>

      <div className="mt-4 space-y-3 text-sm text-ink-soft">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-muted">
          <span className="flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5" aria-hidden="true" />
            {formatearAntiguedad(creado_en)}
          </span>
          {distancia !== null && (
            <span className="flex items-center gap-1.5">
              <Navigation className="h-3.5 w-3.5" aria-hidden="true" />
              a {formatearDistancia(distancia)}
            </span>
          )}
        </div>

        {descripcion && <p className="leading-relaxed">{descripcion}</p>}

        <dl className="glass-inset grid grid-cols-1 gap-2 rounded-xl p-3 text-xs">
          <div className="flex items-center justify-between gap-3">
            <dt className="flex items-center gap-1.5 text-ink-muted">
              <Ruler className="h-3.5 w-3.5" aria-hidden="true" />
              EPSG:4326 (WGS84)
            </dt>
            <dd className="font-mono text-ink">
              {latitud.toFixed(6)}, {longitud.toFixed(6)}
            </dd>
          </div>

          {h3Index && (
            <div className="flex items-center justify-between gap-3">
              <dt className="flex items-center gap-1.5 text-ink-muted">
                <Hexagon className="h-3.5 w-3.5" aria-hidden="true" />
                Celda H3
              </dt>
              <dd className="truncate font-mono text-ink" title={h3Index}>
                {h3Index}
              </dd>
            </div>
          )}
        </dl>
      </div>

      <a
        href={construirUrlRuta(latitud, longitud)}
        target="_blank"
        rel="noreferrer"
        className="pressable focus-ring mt-4 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-primary-hover"
      >
        <Navigation className="h-4 w-4" aria-hidden="true" />
        Cómo llegar
      </a>
    </aside>
  );
}
