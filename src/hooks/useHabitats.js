import { useCallback, useEffect, useMemo, useState } from 'react';
import { HABITATS_TABLE } from '../config/constants';
import { isSupabaseConfigured, supabase } from '../config/supabaseClient';
import { HABITATS_DEMO } from '../data/habitatsDemo';

/**
 * useHabitats.js
 * ---------------------------------------------------------------------------
 * Custom Hook (SRP): carga la capa de Zonas de Hábitat como FeatureCollection
 * GeoJSON. Si Supabase no está configurado o no hay filas, usa el GeoJSON demo.
 * ---------------------------------------------------------------------------
 */

/** Convierte filas de `habitats` a una FeatureCollection GeoJSON válida. */
function filasAGeoJSON(filas) {
  const features = (filas ?? [])
    .map((fila) => {
      const geometria = fila.geojson?.geometry ?? fila.geojson;
      if (!geometria?.type) return null;

      return {
        type: 'Feature',
        properties: {
          nombre: fila.nombre,
          tipo_area: fila.tipo_area,
        },
        geometry: geometria,
      };
    })
    .filter(Boolean);

  return { type: 'FeatureCollection', features };
}

export function useHabitats() {
  const [geoJSON, setGeoJSON] = useState(HABITATS_DEMO);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchHabitats = useCallback(async () => {
    if (!isSupabaseConfigured) return HABITATS_DEMO;

    setLoading(true);
    setError(null);

    try {
      const { data, error: queryError } = await supabase
        .from(HABITATS_TABLE)
        .select('nombre, tipo_area, geojson');

      if (queryError) throw queryError;

      const coleccion = filasAGeoJSON(data);
      const resultado = coleccion.features.length > 0 ? coleccion : HABITATS_DEMO;
      setGeoJSON(resultado);
      return resultado;
    } catch (err) {
      setError(err?.message ?? 'Error desconocido al cargar hábitats.');
      setGeoJSON(HABITATS_DEMO); // Degradación elegante.
      return HABITATS_DEMO;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHabitats();
  }, [fetchHabitats]);

  return useMemo(
    () => ({ geoJSON, loading, error, fetchHabitats }),
    [geoJSON, loading, error, fetchHabitats],
  );
}
