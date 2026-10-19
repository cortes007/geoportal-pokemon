import { useEffect } from 'react';

/**
 * useFocusTrap.js
 * ---------------------------------------------------------------------------
 * Hook de ciclo de vida (SRP): gestiona el foco de una superficie modal.
 *
 * Qué hace, y qué NO hace:
 * - Mueve el foco dentro del contenedor al activarse (requisito de `role="dialog"`
 *   + `aria-modal="true"`; sin esto, un lector de pantalla sigue anunciando el
 *   contenido de detrás).
 * - Mantiene el foco dentro mientras Tab / Shift+Tab recorren el contenedor.
 * - Devuelve el foco al elemento que abrió el panel al cerrarse.
 *
 * NO gestiona Escape: eso es `useDismissOnEscape`, para que cada hook tenga una
 * única razón de cambio.
 *
 * @param {import('react').RefObject<HTMLElement>} containerRef Contenedor modal.
 *                                 Debe ser enfocable (`tabIndex={-1}`) para el
 *                                 caso sin elementos enfocables.
 * @param {boolean} active Si es false, no hay trampa ni gestión de foco.
 */

/** Selector de elementos enfocables por teclado. */
const SELECTOR_ENFOCABLES = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/** Descarta elementos que existen en el DOM pero no se pintan. */
const esVisible = (elemento) => elemento.getClientRects().length > 0;

export function useFocusTrap(containerRef, active) {
  useEffect(() => {
    if (!active) return undefined;

    const contenedor = containerRef.current;
    if (!contenedor) return undefined;

    const elementoPrevio = document.activeElement;

    const obtenerEnfocables = () =>
      Array.from(contenedor.querySelectorAll(SELECTOR_ENFOCABLES)).filter(esVisible);

    // Foco inicial: el primer control, o el contenedor si no hay ninguno.
    const primerEnfocable = obtenerEnfocables()[0];
    (primerEnfocable ?? contenedor).focus();

    const alPulsarTecla = (event) => {
      if (event.key !== 'Tab') return;

      const enfocables = obtenerEnfocables();
      if (enfocables.length === 0) {
        event.preventDefault();
        return;
      }

      const primero = enfocables[0];
      const ultimo = enfocables[enfocables.length - 1];
      const activo = document.activeElement;

      if (event.shiftKey && (activo === primero || activo === contenedor)) {
        event.preventDefault();
        ultimo.focus();
        return;
      }

      if (!event.shiftKey && activo === ultimo) {
        event.preventDefault();
        primero.focus();
      }
    };

    document.addEventListener('keydown', alPulsarTecla);

    return () => {
      document.removeEventListener('keydown', alPulsarTecla);
      // Devolver el foco a quien abrió el panel.
      if (elementoPrevio instanceof HTMLElement && elementoPrevio.isConnected) {
        elementoPrevio.focus();
      }
    };
  }, [containerRef, active]);
}
