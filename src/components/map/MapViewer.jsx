import { useCallback, useEffect, useRef } from 'react';
import { Loader2, LocateFixed, X } from 'lucide-react';
import { CAPAS } from '../../config/constants';
import { MAP_CONFIG } from '../../config/mapConfig';
import { useAvistamientosContext } from '../../context/AvistamientosContext';
import { useMapContext } from '../../context/MapContext';
import { useAvistamientosLayer } from '../../hooks/useAvistamientosLayer';
import { useH3DensityLayer } from '../../hooks/useH3DensityLayer';
import { useHabitatsLayer } from '../../hooks/useHabitatsLayer';
import { useOpenMap } from '../../hooks/useOpenMap';
import { useUserLocation } from '../../hooks/useUserLocation';
import AttributionPill from './AttributionPill';
import MapEmptyState from './MapEmptyState';

/**
 * MapViewer.jsx
 * ---------------------------------------------------------------------------
 * Componente principal del visor (SRP: render + captura de eventos). Toda la
 * lógica de OpenLayers vive en hooks; aquí solo se componen y se colocan los
 * controles flotantes propios del mapa (geolocalización y aviso de captura).
 *
 * Estilizado: consume la capa semántica del sistema de diseño
 * (`glass-panel`, `bg-primary`, `text-ink`…) definida en `src/index.css`.
 * Los controles anclados usan `edge-*` para respetar las safe areas.
 * ---------------------------------------------------------------------------
 */
export default function MapViewer() {
  const containerRef = useRef(null);

  const {
    avistamientos,
    avistamientosVisibles,
    habitatsGeoJSON,
    selectedId,
    capas,
    capaBase,
    h3Resolucion,
    modoReporte,
    loading,
    error,
    configurado,
    inicializado,
    selectAvistamiento,
    clearSelection,
    setCoordenadaReporte,
    cancelarReporte,
    iniciarReporte,
    mostrarTodosLosAvistamientos,
    refrescar,
  } = useAvistamientosContext();

  const { setUserLocation } = useMapContext();
  const { position, loading: ubicando, error: errorUbicacion, obtenerUbicacion } = useUserLocation();

  // Clic sobre marcador: delega la selección al estado global.
  const handleSelect = useCallback(
    (id) => {
      if (modoReporte) return; // En modo captura los clics no seleccionan.
      if (id) return selectAvistamiento(id);
      return clearSelection();
    },
    [modoReporte, selectAvistamiento, clearSelection],
  );

  // Clic sobre el mapa: en modo captura fija la coordenada del reporte.
  const handleMapClick = useCallback(
    (coordenada) => {
      if (!modoReporte) return;
      setCoordenadaReporte(coordenada);
    },
    [modoReporte, setCoordenadaReporte],
  );

  const { map, sources, layers, setCapaBase, flyTo } = useOpenMap(containerRef, {
    onSelect: handleSelect,
    onMapClick: handleMapClick,
  });

  // Sincronización de datos -> capas vectoriales.
  useAvistamientosLayer({
    source: sources?.avistamientos,
    avistamientos: avistamientosVisibles,
    selectedId,
  });
  useHabitatsLayer({ source: sources?.habitats, geoJSON: habitatsGeoJSON });
  useH3DensityLayer({
    source: sources?.h3,
    avistamientos: avistamientosVisibles,
    resolucion: h3Resolucion,
  });

  // Conmutación de capa base.
  useEffect(() => {
    setCapaBase(capaBase);
  }, [setCapaBase, capaBase]);

  // Visibilidad de capas temáticas.
  useEffect(() => {
    if (!map || !layers.current) return;
    layers.current.habitats?.setVisible(capas[CAPAS.HABITATS]);
    layers.current.h3?.setVisible(capas[CAPAS.H3]);
  }, [map, layers, capas]);

  // Al obtener ubicación: guardarla en el estado global y volar hacia ella.
  useEffect(() => {
    if (!position) return;
    setUserLocation(position);
    flyTo(position.latitud, position.longitud, MAP_CONFIG.zoomUbicacion);
  }, [position, setUserLocation, flyTo]);

  // --- Estado vacío del visor: sin configurar / error / cero resultados -----
  // `inicializado` evita el falso "cero resultados" del primer render, ya que
  // `loading` arranca en false. El indicador de carga (hallazgo E) se pospone
  // a la Fase 6, pero el estado vacío no debe mentir mientras tanto.
  const sinConfigurar = !configurado;
  const errorSinDatos = Boolean(error) && !sinConfigurar && avistamientos.length === 0;
  const ceroResultados =
    inicializado &&
    !loading &&
    !error &&
    !sinConfigurar &&
    !modoReporte &&
    avistamientosVisibles.length === 0;

  let estadoVacio = null;
  if (sinConfigurar) {
    estadoVacio = { tipo: 'sin-configurar' };
  } else if (errorSinDatos) {
    estadoVacio = { tipo: 'error', mensaje: error, onAccion: refrescar };
  } else if (ceroResultados) {
    const filtrado = avistamientos.length > 0;
    estadoVacio = {
      tipo: 'vacio',
      filtrado,
      onAccion: filtrado ? mostrarTodosLosAvistamientos : iniciarReporte,
    };
  }

  return (
    <div className="relative h-full w-full">
      {/* Contenedor donde OpenLayers inyecta el viewport del mapa. */}
      <div
        ref={containerRef}
        className="absolute inset-0 h-full w-full"
        role="application"
        aria-label="Mapa de hábitats, nidos y avistamientos de Pokémon GO"
      />

      {/* Atribución legal de la capa base activa. Vive en el DOM (no como
          control de OpenLayers) para no tocar el ciclo de vida del mapa. */}
      <AttributionPill capaBase={capaBase} />

      {/* Estado vacío: explica por qué el mapa no muestra datos. */}
      {estadoVacio && <MapEmptyState {...estadoVacio} />}

      {/* Pila de controles superior derecha: botón de ubicación + su aviso de
          error. Se agrupan en una columna para que el aviso fluya debajo del
          botón sin depender de un `top-20` fijo. */}
      <div className="edge-t edge-r absolute z-10 flex w-[min(70vw,20rem)] flex-col items-end gap-2">
        <button
          type="button"
          onClick={obtenerUbicacion}
          aria-label="Centrar en mi ubicación"
          className="glass-panel pressable focus-ring p-3 text-ink-soft hover:text-primary"
        >
          {ubicando ? (
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
          ) : (
            <LocateFixed className="h-5 w-5" aria-hidden="true" />
          )}
        </button>

        {errorUbicacion && (
          <div
            role="status"
            className="rounded-2xl border border-warning-edge bg-warning-soft/90 px-3 py-2 text-xs text-warning shadow-xl backdrop-blur-md"
          >
            {errorUbicacion}
          </div>
        )}
      </div>

      {/* Aviso de modo captura. */}
      {modoReporte && (
        <div className="edge-t absolute left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-2xl border border-primary-edge bg-primary-soft/90 px-4 py-2 text-xs font-medium text-primary-ink shadow-xl backdrop-blur-md">
          <span>Toca el mapa para marcar la ubicación del reporte</span>
          <button
            type="button"
            onClick={cancelarReporte}
            aria-label="Cancelar captura"
            className="pressable focus-ring -mr-1 rounded-lg p-1 hover:text-primary"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      )}

      {loading && (
        <div
          role="status"
          className="pointer-events-none absolute inset-x-0 top-0 z-10 flex justify-center pt-[max(0.5rem,env(safe-area-inset-top))]"
        >
          <span className="glass-panel rounded-full px-4 py-1.5 text-xs font-medium text-ink-soft">
            Sincronizando avistamientos…
          </span>
        </div>
      )}

      {/* Aviso de error de refresco: solo cuando ya hay datos en pantalla.
          Sin datos, el error lo comunica `MapEmptyState`. */}
      {error && !sinConfigurar && !errorSinDatos && (
        <div
          role="alert"
          className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex justify-center pb-[max(1rem,env(safe-area-inset-bottom))]"
        >
          <span className="max-w-[90vw] rounded-2xl border border-danger-edge bg-danger-soft/90 px-4 py-2 text-xs font-medium text-danger shadow-xl backdrop-blur-md">
            {error}
          </span>
        </div>
      )}
    </div>
  );
}
