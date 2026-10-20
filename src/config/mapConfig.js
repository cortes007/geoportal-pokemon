import XYZ from 'ol/source/XYZ';

/**
 * mapConfig.js
 * Configuración declarativa del visor: centro/zoom y fábricas de capas base.
 */

/**
 * Centro inicial en EPSG:4326 (WGS84) -> [longitud, latitud] (Bogotá).
 * La reproyección a Web Mercator se hace con spatialUtils.reprojectCoordinates.
 */
export const MAP_CONFIG = Object.freeze({
  centroInicial: [-74.0721, 4.711],
  zoomInicial: 12,
  minZoom: 3,
  maxZoom: 19,
  zoomSeleccion: 17,
  zoomUbicacion: 16,
});

export const CAPAS_BASE = Object.freeze({
  osm: {
    id: 'osm',
    label: 'OpenStreetMap',
    /**
     * Atribución visible en la UI (pastilla propia). Se declara aquí, junto a
     * la fuente, para que texto y enlace cambien con la capa base activa.
     * `attributions` se mantiene en la fuente XYZ para que OpenLayers también
     * conozca la autoría aunque el control nativo esté desactivado.
     */
    atribuciones: [
      {
        texto: '© OpenStreetMap contributors',
        url: 'https://www.openstreetmap.org/copyright',
      },
    ],
    createSource: () =>
      new XYZ({
        url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
        attributions: '© OpenStreetMap contributors',
        crossOrigin: 'anonymous',
        maxZoom: 19,
      }),
  },
  positron: {
    id: 'positron',
    label: 'CartoDB Positron',
    atribuciones: [
      {
        texto: '© OpenStreetMap contributors',
        url: 'https://www.openstreetmap.org/copyright',
      },
      {
        texto: '© CARTO',
        url: 'https://carto.com/attributions',
      },
    ],
    createSource: () =>
      new XYZ({
        url: 'https://{a-c}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
        attributions: '© OpenStreetMap contributors, © CARTO',
        crossOrigin: 'anonymous',
        maxZoom: 19,
      }),
  },
});

export const CAPAS_BASE_LISTA = Object.values(CAPAS_BASE);

// OpenStreetMap no requiere API key; CartoDB Positron queda como alternativa
// (Carto muestra la marca "API KEY REQUIRED" si no se configura una clave).
export const CAPA_BASE_POR_DEFECTO = 'osm';
