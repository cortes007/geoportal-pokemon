import { CAPAS_BASE } from '../../config/mapConfig';

/**
 * AttributionPill.jsx
 * ---------------------------------------------------------------------------
 * Componente de UI (SRP): muestra la atribución legal de la capa base activa.
 *
 * POR QUÉ UNA PASTILLA PROPIA Y NO EL CONTROL NATIVO DE OPENLAYERS:
 * - El mapa se crea con `controls: []` (decisión de diseño del visor), así que
 *   el control `Attribution` nunca se monta.
 * - Una pastilla en el DOM consume los tokens del proyecto y puede cambiar de
 *   texto sin tocar el ciclo de vida de `ol/Map` (`useOpenMap.js`).
 *
 * Los textos y enlaces viven en `mapConfig.js`, junto a cada fuente, para que
 * la atribución no se desincronice de la capa que realmente se está pintando.
 * ---------------------------------------------------------------------------
 */
export default function AttributionPill({ capaBase }) {
  const atribuciones = CAPAS_BASE[capaBase]?.atribuciones ?? [];
  if (atribuciones.length === 0) return null;

  return (
    <p className="glass-panel pointer-events-auto edge-r absolute bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-10 max-w-[calc(100vw-2rem)] rounded-full px-2.5 py-1 text-center text-xs text-ink-soft">
      {atribuciones.map(({ texto, url }, indice) => (
        <span key={url}>
          {indice > 0 && <span aria-hidden="true"> · </span>}
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="focus-ring rounded-sm underline underline-offset-2 hover:text-primary"
          >
            {texto}
            <span className="sr-only"> (se abre en una pestaña nueva)</span>
          </a>
        </span>
      ))}
    </p>
  );
}
