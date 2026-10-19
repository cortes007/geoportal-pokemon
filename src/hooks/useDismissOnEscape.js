import { useEffect } from 'react';

/**
 * useDismissOnEscape.js
 * ---------------------------------------------------------------------------
 * Hook de ciclo de vida (SRP): registra un listener de teclado a nivel de
 * documento y lo retira al desmontar. Mantiene los componentes de UI libres de
 * la gestión de suscripciones, según AGENTS.md §2.
 *
 * Se usa para cerrar superficies no modales (DetailSheet) con la tecla Escape,
 * que es la convención esperada por usuarios de teclado.
 *
 * @param {() => void} onDismiss  Callback a ejecutar cuando se pulsa Escape.
 * @param {boolean} [active=true] Si es false, no se registra el listener.
 */
export function useDismissOnEscape(onDismiss, active = true) {
  useEffect(() => {
    if (!active) return undefined;

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onDismiss();
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onDismiss, active]);
}
