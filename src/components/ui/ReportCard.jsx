import { useId, useState } from 'react';
import { Loader2, MapPin, Save, X } from 'lucide-react';
import { POKEMON_TIPOS_LISTA } from '../../config/constants';
import { useAvistamientosContext } from '../../context/AvistamientosContext';

/**
 * ReportCard.jsx
 * ---------------------------------------------------------------------------
 * Componente de UI (SRP): formulario de registro de un avistamiento/nido.
 * La coordenada proviene del evento singleclick del mapa (contexto global);
 * este componente solo captura el resto de los datos y los envía al hook.
 *
 * Accesibilidad: cada campo tiene `<label>` asociada por `htmlFor`/`id` (antes
 * solo había `placeholder`, que no es una etiqueta válida — WCAG 3.3.2),
 * el error usa `role="alert"` y se vincula con `aria-describedby`, y el estado
 * de la coordenada es una región `aria-live` para que se anuncie al marcarla.
 * ---------------------------------------------------------------------------
 */

const FILA_INICIAL = {
  pokemon_name: '',
  pokemon_id: '',
  pokemon_type: POKEMON_TIPOS_LISTA[0]?.id ?? 'normal',
  es_nido: false,
  descripcion: '',
};

const CLASE_ETIQUETA = 'mb-1 block text-xs font-medium text-ink-soft';

export default function ReportCard() {
  const { modoReporte, coordenadaReporte, confirmarReporte, cancelarReporte } =
    useAvistamientosContext();

  const [fila, setFila] = useState(FILA_INICIAL);
  const [guardando, setGuardando] = useState(false);
  const [errorLocal, setErrorLocal] = useState(null);

  // Identificadores estables para asociar labels y mensajes de error.
  const idNombre = useId();
  const idNumero = useId();
  const idTipo = useId();
  const idDescripcion = useId();
  const idError = useId();

  // Early return: solo visible en modo captura.
  if (!modoReporte) return null;

  const actualizarCampo = (campo, valor) => setFila((prev) => ({ ...prev, [campo]: valor }));

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!coordenadaReporte) {
      setErrorLocal('Toca el mapa para marcar la ubicación.');
      return;
    }
    if (!fila.pokemon_name.trim()) {
      setErrorLocal('El nombre del Pokémon es obligatorio.');
      return;
    }

    setGuardando(true);
    setErrorLocal(null);

    try {
      await confirmarReporte({
        pokemon_name: fila.pokemon_name.trim(),
        pokemon_id: fila.pokemon_id ? Number.parseInt(fila.pokemon_id, 10) : null,
        pokemon_type: fila.pokemon_type,
        es_nido: fila.es_nido,
        descripcion: fila.descripcion.trim() || null,
      });
      setFila(FILA_INICIAL); // El contexto cierra el modo captura al confirmar.
    } catch (err) {
      setErrorLocal(err?.message ?? 'No se pudo guardar el reporte.');
    } finally {
      setGuardando(false);
    }
  };

  return (
    <section
      aria-label="Nuevo avistamiento"
      className={[
        'glass-panel pointer-events-auto absolute inset-x-0 bottom-0 rounded-t-3xl',
        // `pb-safe` deja hueco a la barra gestual del sistema (viewport-fit=cover).
        'max-h-[80vh] overflow-y-auto pb-[env(safe-area-inset-bottom)]',
        'sm:inset-x-auto sm:bottom-4 sm:left-4 sm:max-h-none sm:w-96 sm:rounded-2xl sm:pb-0',
        'p-4',
      ].join(' ')}
    >
      <header className="flex items-start justify-between gap-3">
        <h2 className="text-sm font-semibold tracking-tight text-ink">Nuevo reporte</h2>
        <button
          type="button"
          onClick={cancelarReporte}
          aria-label="Cancelar reporte"
          className="pressable focus-ring rounded-xl border border-glass-border bg-glass p-2 text-ink-soft hover:text-ink"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </header>

      {/* Estado de la coordenada capturada en el mapa. */}
      <p
        aria-live="polite"
        className="glass-inset mt-3 flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs text-ink-soft"
      >
        <MapPin className="h-3.5 w-3.5 shrink-0 text-ink-muted" aria-hidden="true" />
        {coordenadaReporte
          ? `${coordenadaReporte.latitud.toFixed(6)}, ${coordenadaReporte.longitud.toFixed(6)}`
          : 'Sin ubicación: toca el mapa para marcar el punto.'}
      </p>

      <form onSubmit={handleSubmit} className="mt-3 space-y-3">
        <div>
          <label htmlFor={idNombre} className={CLASE_ETIQUETA}>
            Nombre del Pokémon <span aria-hidden="true">*</span>
          </label>
          <input
            id={idNombre}
            type="text"
            required
            value={fila.pokemon_name}
            onChange={(event) => actualizarCampo('pokemon_name', event.target.value)}
            placeholder="Ej. Pikachu"
            aria-describedby={errorLocal ? idError : undefined}
            className="field w-full px-3 py-2 text-sm"
          />
        </div>

        <div className="flex gap-2">
          <div className="w-28 shrink-0">
            <label htmlFor={idNumero} className={CLASE_ETIQUETA}>
              ID
            </label>
            <input
              id={idNumero}
              type="number"
              min={1}
              value={fila.pokemon_id}
              onChange={(event) => actualizarCampo('pokemon_id', event.target.value)}
              placeholder="Ej. 25"
              className="field w-full px-3 py-2 text-sm"
            />
          </div>

          <div className="min-w-0 flex-1">
            <label htmlFor={idTipo} className={CLASE_ETIQUETA}>
              Tipo
            </label>
            <select
              id={idTipo}
              value={fila.pokemon_type}
              onChange={(event) => actualizarCampo('pokemon_type', event.target.value)}
              className="field w-full px-3 py-2 text-sm"
            >
              {POKEMON_TIPOS_LISTA.map((tipo) => (
                <option key={tipo.id} value={tipo.id}>
                  {tipo.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <label className="pressable flex min-h-11 cursor-pointer items-center gap-2 text-sm text-ink-soft sm:min-h-0">
          <input
            type="checkbox"
            checked={fila.es_nido}
            onChange={(event) => actualizarCampo('es_nido', event.target.checked)}
            className="focus-ring h-4 w-4 rounded accent-primary"
          />
          Marcar como nido
        </label>

        <div>
          <label htmlFor={idDescripcion} className={CLASE_ETIQUETA}>
            Descripción <span className="font-normal text-ink-muted">(opcional)</span>
          </label>
          <textarea
            id={idDescripcion}
            value={fila.descripcion}
            onChange={(event) => actualizarCampo('descripcion', event.target.value)}
            rows={2}
            placeholder="Detalles del avistamiento…"
            className="field w-full resize-none px-3 py-2 text-sm"
          />
        </div>

        {errorLocal && (
          <p
            id={idError}
            role="alert"
            className="rounded-xl border border-danger-edge bg-danger-soft px-3 py-2 text-xs text-danger"
          >
            {errorLocal}
          </p>
        )}

        <button
          type="submit"
          disabled={guardando}
          className="pressable focus-ring flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-success px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-success-hover disabled:opacity-50"
        >
          {guardando ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Save className="h-4 w-4" aria-hidden="true" />
          )}
          Guardar reporte
        </button>
      </form>
    </section>
  );
}
