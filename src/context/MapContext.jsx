import { createContext, useContext, useMemo, useState } from 'react';

/**
 * MapContext.jsx
 * Estado global mínimo: instancia de ol/Map y ubicación del usuario (para el
 * cálculo de distancias y el botón "Mi Ubicación"). Sin lógica de render.
 */

const MapContext = createContext(null);

export function MapProvider({ children }) {
  const [map, setMap] = useState(null);
  const [userLocation, setUserLocation] = useState(null); // { latitud, longitud, precision }

  const value = useMemo(
    () => ({ map, setMap, userLocation, setUserLocation }),
    [map, userLocation],
  );

  return <MapContext.Provider value={value}>{children}</MapContext.Provider>;
}

export function useMapContext() {
  const contexto = useContext(MapContext);
  if (!contexto) {
    throw new Error('useMapContext debe usarse dentro de <MapProvider>.');
  }
  return contexto;
}
