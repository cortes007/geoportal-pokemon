import { AlertTriangle, KeyRound, MapPinOff } from 'lucide-react';

/**
 * MapEmptyState.jsx
 * ---------------------------------------------------------------------------
 * Componente de UI (SRP): estado vacío del visor. Cubre los tres casos que el
 * mapa debe explicar en lugar de quedarse en blanco:
 *
 *   1. Sin configurar: faltan las variables de Supabase.
 *   2. Error: la consulta falló y no hay datos que mostrar.
 *   3. Cero resultados: la consulta respondió, pero no queda nada visible
 *      (no hay reportes o los filtros/capas los ocultaron).
 *
 * No conoce filtros ni Supabase: recibe el tipo y, si aplica, la acción.
 * ---------------------------------------------------------------------------
 */

const CONTENIDO = {
  'sin-configurar': {
    Icono: KeyRound,
    claseIcono: 'text-primary',
    titulo: 'Falta configurar Supabase',
    descripcion:
      'Copia .env.example a .env, define VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY, y reinicia Vite. El mapa funciona, pero todavía no hay datos.',
  },
  error: {
    Icono: AlertTriangle,
    claseIcono: 'text-danger',
    titulo: 'No se pudieron cargar los avistamientos',
    descripcion: 'Revisa la conexión con Supabase e inténtalo de nuevo.',
  },
  vacio: {
    Icono: MapPinOff,
    claseIcono: 'text-ink-muted',
    titulo: 'Todavía no hay avistamientos',
    descripcion: 'Sé la primera persona en reportar uno. Toca el mapa y marca la ubicación.',
  },
};

const CONTENIDO_FILTRADO = {
  titulo: 'Ningún avistamiento coincide',
  descripcion:
    'Ajusta la búsqueda o el tipo, o vuelve a activar las capas de avistamientos y nidos.',
};

export default function MapEmptyState({ tipo, filtrado = false, mensaje, onAccion }) {
  const base = CONTENIDO[tipo] ?? CONTENIDO.vacio;
  const esError = tipo === 'error';
  const esVacioFiltrado = tipo === 'vacio' && filtrado;

  const { Icono, claseIcono } = base;
  const titulo = esVacioFiltrado ? CONTENIDO_FILTRADO.titulo : base.titulo;
  const descripcion = esError
    ? (mensaje ?? base.descripcion)
    : esVacioFiltrado
      ? CONTENIDO_FILTRADO.descripcion
      : base.descripcion;

  const etiquetaAccion = esError
    ? 'Reintentar'
    : esVacioFiltrado
      ? 'Mostrar todos'
      : tipo === 'vacio'
        ? 'Reportar avistamiento'
        : null;

  return (
    <div
      role={esError ? 'alert' : 'status'}
      className="pointer-events-auto absolute left-1/2 top-1/2 z-10 w-[min(90vw,22rem)] -translate-x-1/2 -translate-y-1/2"
    >
      <div className="glass-panel rounded-2xl p-4 text-center">
        <Icono className={`mx-auto h-6 w-6 ${claseIcono}`} aria-hidden="true" />
        <h2 className="mt-2 text-sm font-semibold tracking-tight text-ink">{titulo}</h2>
        <p className="mt-1 text-xs leading-relaxed text-ink-soft">{descripcion}</p>

        {etiquetaAccion && onAccion && (
          <button
            type="button"
            onClick={onAccion}
            className="pressable focus-ring mt-3 inline-flex min-h-11 items-center justify-center rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-primary-hover sm:min-h-8"
          >
            {etiquetaAccion}
          </button>
        )}
      </div>
    </div>
  );
}
