import { useCallback, useId, useRef, useState } from 'react';
import { SlidersHorizontal, X } from 'lucide-react';
import { useAvistamientosContext } from '../../context/AvistamientosContext';
import { useDismissOnEscape } from '../../hooks/useDismissOnEscape';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { BREAKPOINT_SM, useMediaQuery } from '../../hooks/useMediaQuery';

/**
 * FilterDrawer.jsx
 * ---------------------------------------------------------------------------
 * Componente de UI (SRP): SOPORTE responsivo del panel de filtros. No contiene
 * ningún control de filtrado; recibe esos controles como `children` y decide
 * cómo presentarlos:
 *
 *   - Escritorio (>= 640px): tarjeta flotante anclada arriba a la izquierda,
 *     siempre visible.
 *   - Móvil (< 640px): disparador compacto que abre una hoja inferior (bottom
 *     sheet) sobre un velo.
 *
 * POR QUÉ UN COMPONENTE APARTE: antes, `SearchCard` se anclaba directamente con
 * `w-[min(92vw,22rem)]` desde `App.jsx`, lo que en un teléfono de 375px daba un
 * panel de 345px de ancho y ~460px de alto tapando casi todo el mapa. Separar el
 * "cómo se presenta" del "qué contiene" permite que el contenido siga siendo
 * una sola unidad y que el contenedor cambie por completo según el tamaño.
 *
 * ACCESIBILIDAD (hoja inferior):
 * - `role="dialog"` + `aria-modal="true"` con trampa de foco real
 *   (`useFocusTrap`): sin la trampa, un lector de pantalla seguiría anunciando
 *   el mapa de detrás pese a que el velo lo bloquea visualmente.
 * - Escape cierra (`useDismissOnEscape`).
 * - El disparador expone `aria-expanded` / `aria-controls`.
 * - Cerrada, la hoja es `invisible` (fuera del árbol de accesibilidad y del
 *   orden de tabulación) en lugar de solo desplazada fuera de pantalla.
 * ---------------------------------------------------------------------------
 */
export default function FilterDrawer({ children }) {
  const { filtrosActivos } = useAvistamientosContext();
  const esEscritorio = useMediaQuery(BREAKPOINT_SM);

  const [abierto, setAbierto] = useState(false);
  const panelRef = useRef(null);
  const idPanel = useId();

  const cerrar = useCallback(() => setAbierto(false), []);
  const alternar = useCallback(() => setAbierto((previo) => !previo), []);

  // Solo aplican en móvil: en escritorio la tarjeta no es una superficie modal.
  const comoModal = abierto && !esEscritorio;
  useDismissOnEscape(cerrar, comoModal);
  useFocusTrap(panelRef, comoModal);

  // --- Escritorio: tarjeta flotante siempre visible ------------------------
  if (esEscritorio) {
    return (
      <div className="edge-l edge-t pointer-events-auto absolute w-[min(92vw,22rem)]">
        <div className="glass-panel rounded-2xl p-4">{children}</div>
      </div>
    );
  }

  // --- Móvil: disparador + hoja inferior -----------------------------------
  return (
    <>
      {/* Velo. z-20 deja por debajo los demás paneles flotantes cuando la hoja
          está abierta, evitando que se apilen dos bottom sheets confusamente. */}
      {abierto && (
        <div
          onClick={cerrar}
          aria-hidden="true"
          className="bg-scrim pointer-events-auto absolute inset-0 z-20 backdrop-blur-[2px]"
        />
      )}

      <div
        ref={panelRef}
        id={idPanel}
        role="dialog"
        aria-modal="true"
        aria-label="Filtros de búsqueda"
        tabIndex={-1}
        className={[
          'glass-panel pointer-events-auto absolute inset-x-0 bottom-0 z-30 rounded-t-3xl p-4',
          'max-h-[85vh] overflow-y-auto pb-[max(1rem,env(safe-area-inset-bottom))]',
          'transition-[transform,visibility] duration-300 ease-out outline-none',
          abierto ? 'visible translate-y-0' : 'invisible translate-y-full',
        ].join(' ')}
      >
        {children}
      </div>

      {/* Único control de apertura/cierre. Se mantiene por encima del velo
          (z-40) para poder cerrar sin desplazarse, y reutiliza la etiqueta
          como estado: no añade cromo extra a la hoja. */}
      <button
        type="button"
        onClick={alternar}
        aria-expanded={abierto}
        aria-controls={idPanel}
        className="glass-panel pressable focus-ring edge-l edge-t pointer-events-auto absolute z-40 inline-flex min-h-11 items-center gap-2 px-4 text-sm font-semibold text-ink"
      >
        {abierto ? (
          <X className="h-4 w-4 text-ink-soft" aria-hidden="true" />
        ) : (
          <SlidersHorizontal className="h-4 w-4 text-primary" aria-hidden="true" />
        )}
        {abierto ? 'Cerrar' : 'Filtros'}
        {!abierto && filtrosActivos > 0 && (
          <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-2xs font-bold text-white">
            {filtrosActivos}
          </span>
        )}
      </button>
    </>
  );
}
