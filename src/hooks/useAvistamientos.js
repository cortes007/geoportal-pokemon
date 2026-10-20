import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AVISTAMIENTOS_TABLE,
  H3_RESOLUCION_POR_DEFECTO,
  RPC_AVISTAMIENTOS_RECIENTES,
} from '../config/constants';
import { isSupabaseConfigured, supabase } from '../config/supabaseClient';
import { upsertById } from '../utils/pokemonUtils';
import { latLngToH3Index } from '../utils/spatialUtils';

/**
 * useAvistamientos.js
 * ---------------------------------------------------------------------------
 * Custom Hook (SRP): ciclo de vida de los avistamientos.
 *   - fetchAvistamientos(): RPC `listar_avistamientos_recientes`.
 *   - crearAvistamiento(): INSERT (calcula antes el índice H3 de la celda).
 *   - Realtime: suscripción a INSERT para reflejar reportes al instante.
 * No contiene JSX ni conoce OpenLayers.
 * ---------------------------------------------------------------------------
 */

const MENSAJE_SIN_CONFIGURAR =
  'Supabase no está configurado (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY).';

const LIMITE_POR_DEFECTO = 300;

export function useAvistamientos() {
  const [avistamientos, setAvistamientos] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [ultimaActualizacion, setUltimaActualizacion] = useState(null);
  // Distingue "aún no ha respondido nadie" de "respondió y no hay datos".
  // Sin esto, el estado vacío aparecería durante el primer render (loading
  // arranca en false) y parpadearía antes de la primera consulta.
  const [inicializado, setInicializado] = useState(false);

  const aplicarRegistro = useCallback((registro) => {
    if (!registro?.id) return;
    setAvistamientos((prev) => upsertById(prev, registro));
    setUltimaActualizacion(new Date());
  }, []);

  /** Llama al procedimiento almacenado de avistamientos recientes. */
  const fetchAvistamientos = useCallback(async (parametros = {}) => {
    if (!isSupabaseConfigured) {
      setError(MENSAJE_SIN_CONFIGURAR);
      setInicializado(true);
      return [];
    }

    const { limite = LIMITE_POR_DEFECTO, tipo = null, soloNidos = false } = parametros;

    setLoading(true);
    setError(null);

    try {
      const { data, error: rpcError } = await supabase.rpc(RPC_AVISTAMIENTOS_RECIENTES, {
        limite,
        tipo,
        solo_nidos: soloNidos,
      });

      if (rpcError) throw rpcError;

      const registros = data ?? [];
      setAvistamientos(registros);
      setUltimaActualizacion(new Date());
      return registros;
    } catch (err) {
      setError(err?.message ?? 'Error desconocido al listar avistamientos.');
      return [];
    } finally {
      setLoading(false);
      setInicializado(true);
    }
  }, []);

  /**
   * Inserta un avistamiento. Calcula el índice H3 (resolución 9) a partir de
   * lat/lng antes de persistir, para habilitar análisis de densidad en servidor.
   */
  const crearAvistamiento = useCallback(
    async (nuevoAvistamiento) => {
      if (!isSupabaseConfigured) throw new Error(MENSAJE_SIN_CONFIGURAR);

      const { latitud, longitud, pokemon_name, pokemon_type } = nuevoAvistamiento;

      if (!Number.isFinite(latitud) || !Number.isFinite(longitud)) {
        throw new TypeError('crearAvistamiento: latitud/longitud inválidas.');
      }
      if (!pokemon_name || !pokemon_type) {
        throw new TypeError('crearAvistamiento: pokemon_name y pokemon_type son obligatorios.');
      }

      const h3_index = latLngToH3Index(latitud, longitud, H3_RESOLUCION_POR_DEFECTO);

      try {
        const { data, error: insertError } = await supabase
          .from(AVISTAMIENTOS_TABLE)
          .insert({ ...nuevoAvistamiento, h3_index })
          .select()
          .single();

        if (insertError) throw insertError;

        aplicarRegistro(data);
        return data;
      } catch (err) {
        setError(err?.message ?? 'Error desconocido al crear el avistamiento.');
        throw err;
      }
    },
    [aplicarRegistro],
  );

  // Carga inicial.
  useEffect(() => {
    fetchAvistamientos();
  }, [fetchAvistamientos]);

  // Realtime: nuevos reportes.
  useEffect(() => {
    if (!isSupabaseConfigured) return undefined;

    const canal = supabase
      .channel('avistamientos-realtime')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: AVISTAMIENTOS_TABLE },
        (payload) => aplicarRegistro(payload?.new),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(canal);
    };
  }, [aplicarRegistro]);

  return useMemo(
    () => ({
      avistamientos,
      loading,
      error,
      ultimaActualizacion,
      configurado: isSupabaseConfigured,
      inicializado,
      fetchAvistamientos,
      crearAvistamiento,
    }),
    [
      avistamientos,
      loading,
      error,
      ultimaActualizacion,
      inicializado,
      fetchAvistamientos,
      crearAvistamiento,
    ],
  );
}
