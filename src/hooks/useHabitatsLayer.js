import { useEffect, useRef } from 'react';
import GeoJSON from 'ol/format/GeoJSON';

/**
 * useHabitatsLayer.js
 * ---------------------------------------------------------------------------
 * Custom Hook (SRP): carga el GeoJSON de Zonas de Hábitat en su VectorSource.
 * Reproyección declarativa: dataProjection EPSG:4326 -> featureProjection 3857.
 * ---------------------------------------------------------------------------
 */

const WGS84 = 'EPSG:4326';
const WEB_MERCATOR = 'EPSG:3857';

export function useHabitatsLayer({ source, geoJSON }) {
  const formatRef = useRef(null);

  if (!formatRef.current) formatRef.current = new GeoJSON();

  useEffect(() => {
    if (!source) return undefined;

    source.clear();

    if (!geoJSON?.features?.length) return undefined;

    try {
      const features = formatRef.current.readFeatures(geoJSON, {
        dataProjection: WGS84,
        featureProjection: WEB_MERCATOR,
      });
      source.addFeatures(features);
    } catch (error) {
      console.warn('[useHabitatsLayer] GeoJSON inválido:', error.message);
    }

    return undefined;
  }, [source, geoJSON]);
}
