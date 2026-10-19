import { useEffect, useState } from 'react';

/**
 * useMediaQuery.js
 * ---------------------------------------------------------------------------
 * Hook de ciclo de vida (SRP): suscribe el componente a una media query y se
 * desuscribe al desmontar, manteniendo el valor sincronizado si el usuario
 * cambia el tamaño de la ventana o su configuración.
 *
 * Se prefiere resolver el breakpoint en JS (y no solo con utilidades `sm:`)
 * cuando las dos presentaciones tienen ESTRUCTURAS distintas y no solo estilos:
 * evita montar el mismo contenido dos veces en el DOM (lo que duplicaría ids y
 * suscripciones al contexto).
 *
 * @param {string} query Media query CSS, p. ej. '(min-width: 640px)'.
 * @returns {boolean}
 */
export function useMediaQuery(query) {
  const [coincide, setCoincide] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches,
  );

  useEffect(() => {
    const mql = window.matchMedia(query);
    const alCambiar = (event) => setCoincide(event.matches);

    setCoincide(mql.matches);
    mql.addEventListener('change', alCambiar);
    return () => mql.removeEventListener('change', alCambiar);
  }, [query]);

  return coincide;
}

/**
 * Breakpoint `sm` de Tailwind (640px). Debe coincidir con el tema; se declara
 * aquí como constante única para no dispersar el valor.
 */
export const BREAKPOINT_SM = '(min-width: 640px)';
