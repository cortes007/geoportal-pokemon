import { useCallback, useEffect, useRef, useState } from 'react';
import Map from 'ol/Map';
import View from 'ol/View';
import TileLayer from 'ol/layer/Tile';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import { CAPA_BASE_POR_DEFECTO, CAPAS_BASE, MAP_CONFIG } from '../config/mapConfig';
import { useMapContext } from '../context/MapContext';
import { createAvistamientoStyle, createH3Style, createHabitatStyle } from '../utils/mapStyles';
import { reprojectCoordinates, CRS } from '../utils/spatialUtils';

/**
 * useOpenMap.js
 * ---------------------------------------------------------------------------
 * Custom Hook (SRP): encapsula TODO el ciclo de vida de la instancia ol/Map.
 * El componente MapViewer solo aporta el ref del contenedor y el JSX.
 *
 * Capas creadas: base (conmutable) + Hábitats + Malla H3 + Avistamientos.
 *
 * Garantías:
 *   - Cleanup explícito con map.setTarget(null) + dispose() (anti memory-leak),
 *     tolerante al doble montaje de StrictMode.
 *   - Los callbacks de interacción viven en refs: no re-inicializan el mapa.
 * ---------------------------------------------------------------------------
 */

const HIT_TOLERANCE = 8;

export function useOpenMap(targetRef, { onSelect, onMapClick } = {}) {
  const { setMap } = useMapContext();

  const [map, setMapInstance] = useState(null);
  const [sources, setSources] = useState(null);

  const layersRef = useRef({});
  const baseLayersRef = useRef({});
  const onSelectRef = useRef(onSelect);
  const onMapClickRef = useRef(onMapClick);

  // Refs siempre actualizadas: evita re-crear el mapa si cambian los callbacks.
  useEffect(() => {
    onSelectRef.current = onSelect;
    onMapClickRef.current = onMapClick;
  }, [onSelect, onMapClick]);

  // --- Inicialización (una vez por montaje del contenedor) ---
  useEffect(() => {
    const contenedor = targetRef?.current;
    if (!contenedor) return undefined;

    const avistamientosSource = new VectorSource();
    const habitatsSource = new VectorSource();
    const h3Source = new VectorSource();

    const habitatsLayer = new VectorLayer({ source: habitatsSource, style: createHabitatStyle });
    const h3Layer = new VectorLayer({ source: h3Source, style: createH3Style, visible: false });
    const avistamientosLayer = new VectorLayer({
      source: avistamientosSource,
      style: createAvistamientoStyle,
      updateWhileAnimating: true,
      updateWhileInteracting: true,
    });

    // Capas base: se crean todas y se conmuta visibilidad sin re-render.
    const baseLayers = Object.entries(CAPAS_BASE).map(([id, config]) => {
      const layer = new TileLayer({
        source: config.createSource(),
        visible: id === CAPA_BASE_POR_DEFECTO,
      });
      layer.set('baseLayerId', id);
      baseLayersRef.current[id] = layer;
      return layer;
    });

    // Centro inicial: EPSG:4326 (WGS84) -> EPSG:3857 (Web Mercator).
    const [centerX, centerY] = reprojectCoordinates(
      MAP_CONFIG.centroInicial,
      CRS.WGS84,
      CRS.WEB_MERCATOR,
    );

    const instance = new Map({
      target: contenedor,
      layers: [...baseLayers, habitatsLayer, h3Layer, avistamientosLayer],
      view: new View({
        center: [centerX, centerY],
        zoom: MAP_CONFIG.zoomInicial,
        minZoom: MAP_CONFIG.minZoom,
        maxZoom: MAP_CONFIG.maxZoom,
        constrainResolution: true,
      }),
      controls: [],
    });

    // singleclick: primero resuelve marcador; si no hay, entrega coordenada
    // geográfica (EPSG:4326) para capturar un nuevo reporte.
    const handleSingleClick = (event) => {
      const feature = instance.forEachFeatureAtPixel(
        event.pixel,
        (candidate) => candidate,
        { hitTolerance: HIT_TOLERANCE, layerFilter: (layer) => layer === avistamientosLayer },
      );

      if (feature) {
        onSelectRef.current?.(String(feature.getId()));
        return;
      }

      try {
        const [longitud, latitud] = reprojectCoordinates(
          event.coordinate,
          CRS.WEB_MERCATOR,
          CRS.WGS84,
        );
        onMapClickRef.current?.({ latitud, longitud });
      } catch (error) {
        console.warn('[useOpenMap] No se pudo reproyectar el clic:', error.message);
      }
    };

    const handlePointerMove = (event) => {
      const hayMarcador = instance.hasFeatureAtPixel(event.pixel, {
        hitTolerance: HIT_TOLERANCE,
        layerFilter: (layer) => layer === avistamientosLayer,
      });
      const element = instance.getTargetElement();
      if (element) element.style.cursor = hayMarcador ? 'pointer' : 'crosshair';
    };

    instance.on('singleclick', handleSingleClick);
    instance.on('pointermove', handlePointerMove);

    setMapInstance(instance);
    setSources({ avistamientos: avistamientosSource, habitats: habitatsSource, h3: h3Source });
    layersRef.current = { habitats: habitatsLayer, h3: h3Layer, avistamientos: avistamientosLayer };
    setMap(instance);

    return () => {
      instance.un('singleclick', handleSingleClick);
      instance.un('pointermove', handlePointerMove);
      instance.setTarget(null); // Desvincula el DOM: requisito anti memory-leak.
      instance.dispose();
      baseLayersRef.current = {};
      layersRef.current = {};
      setMapInstance(null);
      setSources(null);
      setMap(null);
    };
  }, [targetRef, setMap]);

  // --- Conmutación de capa base ---
  const setCapaBase = useCallback((id) => {
    Object.entries(baseLayersRef.current).forEach(([layerId, layer]) => {
      layer.setVisible(layerId === id);
    });
  }, []);

  /** Vuela a una coordenada EPSG:4326. */
  const flyTo = useCallback(
    (latitud, longitud, zoom = MAP_CONFIG.zoomSeleccion) => {
      if (!map || !Number.isFinite(latitud) || !Number.isFinite(longitud)) return;

      const destino = reprojectCoordinates([longitud, latitud], CRS.WGS84, CRS.WEB_MERCATOR);
      map.getView().animate({ center: destino, zoom, duration: 600 });
    },
    [map],
  );

  return { map, sources, layers: layersRef, setCapaBase, flyTo };
}
