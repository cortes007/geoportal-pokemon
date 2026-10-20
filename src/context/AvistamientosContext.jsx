import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import {
  CAPAS,
  FILTRO_TODOS,
  H3_RESOLUCION_POR_DEFECTO,
} from '../config/constants';
import { CAPA_BASE_POR_DEFECTO } from '../config/mapConfig';
import { useAvistamientos } from '../hooks/useAvistamientos';
import { useHabitats } from '../hooks/useHabitats';
import { contarPorTipo, filterAvistamientos } from '../utils/pokemonUtils';

/**
 * AvistamientosContext.jsx
 * ---------------------------------------------------------------------------
 * Estado global de la aplicación (SRP): datos, filtros, visibilidad de capas,
 * selección activa y flujo de captura de reportes. No renderiza UI; delega el
 * filtrado a utilidades puras.
 * ---------------------------------------------------------------------------
 */

const FILTROS_INICIALES = { query: '', tipo: FILTRO_TODOS };

const CAPAS_INICIALES = {
  [CAPAS.AVISTAMIENTOS]: true,
  [CAPAS.NIDOS]: true,
  [CAPAS.HABITATS]: true,
  [CAPAS.H3]: false,
};

const AvistamientosContext = createContext(null);

export function AvistamientosProvider({ children }) {
  const {
    avistamientos,
    loading,
    error,
    ultimaActualizacion,
    configurado,
    inicializado,
    fetchAvistamientos,
    crearAvistamiento,
  } = useAvistamientos();

  const { geoJSON: habitatsGeoJSON, loading: habitatsLoading, error: habitatsError } =
    useHabitats();

  const [filters, setFilters] = useState(FILTROS_INICIALES);
  const [capas, setCapas] = useState(CAPAS_INICIALES);
  const [capaBase, setCapaBase] = useState(CAPA_BASE_POR_DEFECTO);
  const [h3Resolucion, setH3Resolucion] = useState(H3_RESOLUCION_POR_DEFECTO);
  const [selectedId, setSelectedId] = useState(null);
  const [modoReporte, setModoReporte] = useState(false);
  const [coordenadaReporte, setCoordenadaReporte] = useState(null); // { latitud, longitud }

  /** Colección visible = válidos + filtros + capas activas. */
  const avistamientosVisibles = useMemo(
    () => filterAvistamientos(avistamientos, filters, capas),
    [avistamientos, filters, capas],
  );

  const selectedAvistamiento = useMemo(
    () => avistamientos.find((item) => item.id === selectedId) ?? null,
    [avistamientos, selectedId],
  );

  const conteos = useMemo(() => contarPorTipo(avistamientosVisibles), [avistamientosVisibles]);

  /**
   * Número de filtros de texto activos (búsqueda + tipo). Derivado aquí, no en
   * la UI: es estado de dominio. Las capas conmutables no cuentan, porque son
   * visibilidad y no filtrado. Alimenta la insignia del disparador en móvil.
   */
  const filtrosActivos = useMemo(
    () => (filters.query.trim() ? 1 : 0) + (filters.tipo === FILTRO_TODOS ? 0 : 1),
    [filters],
  );

  const setQuery = useCallback((query) => {
    setFilters((prev) => ({ ...prev, query }));
  }, []);

  const setTipo = useCallback((tipo) => {
    setFilters((prev) => ({ ...prev, tipo }));
  }, []);

  const toggleCapa = useCallback((nombreCapa) => {
    setCapas((prev) => ({ ...prev, [nombreCapa]: !prev[nombreCapa] }));
  }, []);

  /**
   * Restablece las entradas que alimentan `avistamientosVisibles`: búsqueda,
   * tipo y visibilidad de avistamientos/nidos. Es una acción de dominio (no la
   * UI mutando filtros) y da salida al estado de "cero resultados".
   */
  const mostrarTodosLosAvistamientos = useCallback(() => {
    setFilters({ ...FILTROS_INICIALES });
    setCapas((prev) => ({
      ...prev,
      [CAPAS.AVISTAMIENTOS]: true,
      [CAPAS.NIDOS]: true,
    }));
  }, []);

  const selectAvistamiento = useCallback((id) => setSelectedId(id), []);
  const clearSelection = useCallback(() => setSelectedId(null), []);

  /** Entra en modo captura: el siguiente clic fija las coordenadas del reporte. */
  const iniciarReporte = useCallback(() => {
    setModoReporte(true);
    setCoordenadaReporte(null);
    setSelectedId(null);
  }, []);

  const cancelarReporte = useCallback(() => {
    setModoReporte(false);
    setCoordenadaReporte(null);
  }, []);

  /** Persiste el reporte combinando el formulario con la coordenada capturada. */
  const confirmarReporte = useCallback(
    async (datosFormulario) => {
      if (!coordenadaReporte) {
        throw new Error('Marca primero la ubicación en el mapa.');
      }

      const creado = await crearAvistamiento({
        ...datosFormulario,
        latitud: coordenadaReporte.latitud,
        longitud: coordenadaReporte.longitud,
      });

      setModoReporte(false);
      setCoordenadaReporte(null);
      setSelectedId(creado?.id ?? null);
      return creado;
    },
    [coordenadaReporte, crearAvistamiento],
  );

  const refrescar = useCallback(
    () =>
      fetchAvistamientos({
        tipo: filters.tipo === FILTRO_TODOS ? null : filters.tipo,
        soloNidos: capas[CAPAS.NIDOS] && !capas[CAPAS.AVISTAMIENTOS],
      }),
    [fetchAvistamientos, filters.tipo, capas],
  );

  const value = useMemo(
    () => ({
      // Datos
      avistamientos,
      avistamientosVisibles,
      habitatsGeoJSON,
      loading,
      error,
      habitatsLoading,
      habitatsError,
      ultimaActualizacion,
      configurado,
      inicializado,
      conteos,
      filtrosActivos,
      // Filtros y capas
      filters,
      capas,
      capaBase,
      h3Resolucion,
      setQuery,
      setTipo,
      toggleCapa,
      mostrarTodosLosAvistamientos,
      setCapaBase,
      setH3Resolucion,
      // Selección
      selectedId,
      selectedAvistamiento,
      selectAvistamiento,
      clearSelection,
      // Flujo de reporte
      modoReporte,
      coordenadaReporte,
      iniciarReporte,
      cancelarReporte,
      setCoordenadaReporte,
      confirmarReporte,
      // Acciones
      refrescar,
    }),
    [
      avistamientos,
      avistamientosVisibles,
      habitatsGeoJSON,
      loading,
      error,
      habitatsLoading,
      habitatsError,
      ultimaActualizacion,
      configurado,
      inicializado,
      conteos,
      filtrosActivos,
      filters,
      capas,
      capaBase,
      h3Resolucion,
      setQuery,
      setTipo,
      toggleCapa,
      mostrarTodosLosAvistamientos,
      setH3Resolucion,
      selectedId,
      selectedAvistamiento,
      selectAvistamiento,
      clearSelection,
      modoReporte,
      coordenadaReporte,
      iniciarReporte,
      cancelarReporte,
      confirmarReporte,
      refrescar,
    ],
  );

  return (
    <AvistamientosContext.Provider value={value}>{children}</AvistamientosContext.Provider>
  );
}

export function useAvistamientosContext() {
  const contexto = useContext(AvistamientosContext);
  if (!contexto) {
    throw new Error('useAvistamientosContext debe usarse dentro de <AvistamientosProvider>.');
  }
  return contexto;
}
