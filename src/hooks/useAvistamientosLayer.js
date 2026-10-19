import { useEffect, useRef } from 'react';
import Feature from 'ol/Feature';
import Point from 'ol/geom/Point';
import { hasValidCoordinates } from '../utils/pokemonUtils';
import { toWebMercator } from '../utils/spatialUtils';

/**
 * useAvistamientosLayer.js
 * ---------------------------------------------------------------------------
 * Custom Hook (SRP): sincroniza los avistamientos visibles con la VectorSource.
 * Dos ciclos de vida separados: reconstrucción de features y resaltado, para no
 * recrear marcadores cuando solo cambia la selección.
 *
 * Reproyección: EPSG:4326 (lon/lat de Supabase) -> EPSG:3857 (View de OL).
 * ---------------------------------------------------------------------------
 */

function buildFeature(avistamiento) {
  const [x, y] = toWebMercator(avistamiento.longitud, avistamiento.latitud);

  const feature = new Feature({ geometry: new Point([x, y]) });
  feature.setId(String(avistamiento.id));
  feature.setProperties({
    pokemon_name: avistamiento.pokemon_name,
    pokemon_type: avistamiento.pokemon_type,
    es_nido: Boolean(avistamiento.es_nido),
    selected: false,
  });
  return feature;
}

export function useAvistamientosLayer({ source, avistamientos, selectedId }) {
  const featuresRef = useRef(new Map());

  // 1) (Re)construcción de marcadores cuando cambia la colección visible.
  useEffect(() => {
    if (!source) return undefined;

    const validos = (avistamientos ?? []).filter(hasValidCoordinates);
    const features = validos.map(buildFeature);

    featuresRef.current = new Map(features.map((feature) => [feature.getId(), feature]));

    source.clear();
    source.addFeatures(features);
    return undefined;
  }, [source, avistamientos]);

  // 2) Resaltado ligero al cambiar la selección.
  useEffect(() => {
    if (!source) return undefined;

    featuresRef.current.forEach((feature, id) => {
      const seleccionado = id === String(selectedId ?? '');
      if (feature.get('selected') === seleccionado) return;
      feature.set('selected', seleccionado);
      feature.changed();
    });

    return undefined;
  }, [source, selectedId, avistamientos]);
}
