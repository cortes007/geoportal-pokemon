import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * useUserLocation.js
 * ---------------------------------------------------------------------------
 * Custom Hook (SRP): encapsula la Geolocation API del navegador.
 * ---------------------------------------------------------------------------
 */
export function useUserLocation() {
  const [position, setPosition] = useState(null); // { latitud, longitud, precision }
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const obtenerUbicacion = useCallback(() => {
    if (!('geolocation' in navigator)) {
      setError('Tu navegador no soporta geolocalización.');
      return Promise.resolve(null);
    }

    setLoading(true);
    setError(null);

    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (resultado) => {
          if (!mountedRef.current) {
            resolve(null);
            return;
          }

          const ubicacion = {
            latitud: resultado.coords.latitude,
            longitud: resultado.coords.longitude,
            precision: resultado.coords.accuracy,
          };
          setPosition(ubicacion);
          setLoading(false);
          resolve(ubicacion);
        },
        (fallo) => {
          if (!mountedRef.current) {
            resolve(null);
            return;
          }
          setError(fallo?.message ?? 'No se pudo obtener tu ubicación.');
          setLoading(false);
          resolve(null);
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 },
      );
    });
  }, []);

  return { position, loading, error, obtenerUbicacion };
}
