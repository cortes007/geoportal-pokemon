import { useEffect, useRef } from 'react';
import GeoJSON from 'ol/format/GeoJSON';
import { aggregateByH3, h3IndexToGeoJSON } from '../utils/spatialUtils';

/**
 * useH3DensityLayer.js
 * ---------------------------------------------------------------------------
 * Custom Hook (SRP): análisis de densidad espacial. Agrega los avistamientos
 * visibles en celdas Uber H3 y dibuja el hexágono resultante con un choropleth
 * según el número de reportes por celda.
 * ---------------------------------------------------------------------------
 */

const WGS84 = 'EPSG:4326';
const WEB_MERCATOR = 'EPSG:3857';

export function useH3DensityLayer({ source, avistamientos, resolucion }) {
  const formatRef = useRef(null);

  if (!formatRef.current) formatRef.current = new GeoJSON();

  useEffect(() => {
    if (!source) return undefined;

    source.clear();

    if (!Number.isInteger(resolucion)) return undefined;

    const agregados = aggregateByH3(avistamientos ?? [], resolucion);
    if (agregados.length === 0) return undefined;

    try {
      const features = agregados.map((celda) =>
        formatRef.current.readFeature(
          {
            type: 'Feature',
            properties: { h3Index: celda.h3Index, count: celda.count },
            geometry: h3IndexToGeoJSON(celda.h3Index),
          },
          { dataProjection: WGS84, featureProjection: WEB_MERCATOR },
        ),
      );
      source.addFeatures(features);
    } catch (error) {
      console.warn('[useH3DensityLayer] No se pudo generar la malla H3:', error.message);
    }

    return undefined;
  }, [source, avistamientos, resolucion]);
}
