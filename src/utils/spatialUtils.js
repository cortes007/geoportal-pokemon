import proj4 from 'proj4';
import {
  cellToBoundary,
  cellToLatLng,
  cellToParent,
  getResolution,
  gridDisk,
  isValidCell,
  latLngToCell,
  polygonToCells,
} from 'h3-js';

/**
 * spatialUtils.js
 * ---------------------------------------------------------------------------
 * Lógica PURA de SIG (sin React, sin OpenLayers, sin efectos secundarios):
 *   1. Reproyección de coordenadas con proj4js.
 *   2. Indexación / mallas espaciales con Uber H3 (h3-js).
 *
 * Convención de orden de ejes para proj4: SIEMPRE [x, y].
 *   - EPSG:4326 -> [longitud, latitud] en GRADOS.
 *   - EPSG:3857 -> [x, y] en METROS (proyección del View de OpenLayers).
 *   - EPSG:9377 -> [Norte, Este] en METROS (Origen Nacional, Colombia).
 *   - EPSG:3116 -> [Norte, Este] en METROS (MAGNA-SIRGAS Origen Bogotá).
 * ---------------------------------------------------------------------------
 */

export const CRS = Object.freeze({
  WGS84: 'EPSG:4326',
  WEB_MERCATOR: 'EPSG:3857',
  ORIGEN_NACIONAL: 'EPSG:9377',
  BOGOTA_MAGNA_SIRGAS: 'EPSG:3116',
});

/* ============================ 1. REPROYECCIÓN ============================ */

const CUSTOM_PROJECTIONS = Object.freeze({
  [CRS.ORIGEN_NACIONAL]:
    '+proj=tmerc +lat_0=4 +lon_0=-73 +k=0.9992 +x_0=5000000 +y_0=2000000 ' +
    '+ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs +type=crs',
  [CRS.BOGOTA_MAGNA_SIRGAS]:
    '+proj=tmerc +lat_0=4.596200416666666 +lon_0=-74.07750791666666 +k=1 ' +
    '+x_0=1000000 +y_0=1000000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs +type=crs',
});

let projectionsInitialized = false;

/** Registra (idempotentemente) las proyecciones personalizadas en proj4js. */
export function initProjections() {
  if (projectionsInitialized) return;
  Object.entries(CUSTOM_PROJECTIONS).forEach(([code, def]) => {
    if (!proj4.defs(code)) proj4.defs(code, def);
  });
  projectionsInitialized = true;
}

initProjections();

/** Indica si proj4js puede resolver el CRS solicitado. */
export function isProjectionSupported(crs) {
  if (typeof crs !== 'string' || crs.length === 0) return false;
  return Boolean(proj4.defs(crs));
}

/** Valida una coordenada 2D numérica finita. */
export function isValidCoordinate(coords) {
  return (
    Array.isArray(coords) &&
    coords.length >= 2 &&
    Number.isFinite(coords[0]) &&
    Number.isFinite(coords[1])
  );
}

/**
 * Reproyecta una coordenada entre dos CRS.
 * @param {[number, number]} coords Coordenada origen [x, y].
 * @param {string} [fromCRS=EPSG:4326]
 * @param {string} [toCRS=EPSG:3857]
 * @returns {[number, number]} Coordenada destino [x, y].
 */
export function reprojectCoordinates(coords, fromCRS = CRS.WGS84, toCRS = CRS.WEB_MERCATOR) {
  if (!isValidCoordinate(coords)) {
    throw new TypeError('reprojectCoordinates: coordenada inválida. Se esperaba [x, y] finito.');
  }
  if (!isProjectionSupported(fromCRS) || !isProjectionSupported(toCRS)) {
    throw new RangeError(`reprojectCoordinates: CRS no soportado (${fromCRS} -> ${toCRS}).`);
  }

  try {
    const [x, y] = proj4(fromCRS, toCRS, [coords[0], coords[1]]);
    return [x, y];
  } catch (error) {
    throw new Error(`reprojectCoordinates: falló ${fromCRS} -> ${toCRS}: ${error.message}`);
  }
}

/** Atajo: [longitud, latitud] (EPSG:4326) -> [x, y] (EPSG:3857). */
export function toWebMercator(longitud, latitud) {
  return reprojectCoordinates([longitud, latitud], CRS.WGS84, CRS.WEB_MERCATOR);
}

/** Atajo: [x, y] (EPSG:3857) -> [longitud, latitud] (EPSG:4326). */
export function fromWebMercator(x, y) {
  return reprojectCoordinates([x, y], CRS.WEB_MERCATOR, CRS.WGS84);
}

/**
 * Reproyecta recursivamente una geometría GeoJSON.
 * @param {object} geometry Geometría GeoJSON.
 * @returns {object} Nueva geometría (entrada inmutable).
 */
export function reprojectGeometry(geometry, fromCRS = CRS.WGS84, toCRS = CRS.WEB_MERCATOR) {
  if (!geometry || typeof geometry.type !== 'string') {
    throw new TypeError('reprojectGeometry: geometría GeoJSON inválida.');
  }

  const mapPosition = (position) => reprojectCoordinates(position, fromCRS, toCRS);

  switch (geometry.type) {
    case 'Point':
      return { ...geometry, coordinates: mapPosition(geometry.coordinates) };
    case 'MultiPoint':
    case 'LineString':
      return { ...geometry, coordinates: geometry.coordinates.map(mapPosition) };
    case 'MultiLineString':
    case 'Polygon':
      return { ...geometry, coordinates: geometry.coordinates.map((ring) => ring.map(mapPosition)) };
    case 'MultiPolygon':
      return {
        ...geometry,
        coordinates: geometry.coordinates.map((poly) => poly.map((ring) => ring.map(mapPosition))),
      };
    default:
      throw new RangeError(`reprojectGeometry: tipo no soportado "${geometry.type}".`);
  }
}

/**
 * Distancia geodésica aproximada (haversine) en metros.
 * @returns {number} metros
 */
export function haversineDistance(lat1, lon1, lat2, lon2) {
  const RADIO_TIERRA_M = 6371008.8;
  const aRadianes = (grados) => (grados * Math.PI) / 180;

  const dLat = aRadianes(lat2 - lat1);
  const dLon = aRadianes(lon2 - lon1);
  const lat1Rad = aRadianes(lat1);
  const lat2Rad = aRadianes(lat2);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1Rad) * Math.cos(lat2Rad) * Math.sin(dLon / 2) ** 2;

  return 2 * RADIO_TIERRA_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/* ============================== 2. UBER H3 ============================== */

/** Convierte lat/lng (EPSG:4326) a un índice H3 de la resolución indicada. */
export function latLngToH3Index(latitud, longitud, resolucion) {
  if (!Number.isFinite(latitud) || !Number.isFinite(longitud)) {
    throw new TypeError('latLngToH3Index: latitud/longitud inválidas.');
  }
  if (!Number.isInteger(resolucion) || resolucion < 0 || resolucion > 15) {
    throw new RangeError('latLngToH3Index: resolución H3 fuera de rango (0-15).');
  }
  return latLngToCell(latitud, longitud, resolucion);
}

/** Indica si una cadena es un índice H3 válido. */
export function isValidH3Index(h3Index) {
  return typeof h3Index === 'string' && h3Index.length > 0 && isValidCell(h3Index);
}

/** Resolución (0-15) de un índice H3. */
export function getH3Resolution(h3Index) {
  return getResolution(h3Index);
}

/** Centroide de una celda H3 como { latitud, longitud } en EPSG:4326. */
export function h3IndexToCentroid(h3Index) {
  const [latitud, longitud] = cellToLatLng(h3Index);
  return { latitud, longitud };
}

/** Índice H3 padre (agregación/rollup a menor resolución). */
export function h3IndexToParent(h3Index, resolucionPadre) {
  return cellToParent(h3Index, resolucionPadre);
}

/** Celdas vecinas en un radio k (k=1 -> 7 celdas incluyendo la propia). */
export function getH3Neighbors(h3Index, k = 1) {
  return gridDisk(h3Index, k);
}

/**
 * Contorno de una celda H3 como geometría GeoJSON (Polygon en [lng, lat]).
 * Nota: h3-js devuelve [lat, lng]; aquí se invierte a [lng, lat] para GeoJSON.
 */
export function h3IndexToGeoJSON(h3Index) {
  const boundary = cellToBoundary(h3Index);
  const anillo = boundary.map(([lat, lng]) => [lng, lat]);
  if (anillo.length > 0) anillo.push(anillo[0]); // cierra el anillo
  return { type: 'Polygon', coordinates: [anillo] };
}

/**
 * Celdas H3 que cubren una geometría GeoJSON (Polygon/MultiPolygon).
 * @param {object} geometry Geometría en [lng, lat] (EPSG:4326).
 * @param {number} resolucion
 * @returns {string[]} Índices H3 (vacío si la geometría es inválida).
 */
export function getH3CellsForGeometry(geometry, resolucion) {
  if (!geometry) return [];
  try {
    return polygonToCells(geometry, resolucion, true);
  } catch (error) {
    console.warn('[spatialUtils] getH3CellsForGeometry falló:', error.message);
    return [];
  }
}

/**
 * Agrupa avistamientos por celda H3 -> [{ h3Index, count, centroide }].
 * Análisis de densidad para la capa de malla H3.
 */
export function aggregateByH3(avistamientos, resolucion, latKey = 'latitud', lngKey = 'longitud') {
  if (!Array.isArray(avistamientos)) return [];

  const buckets = new Map();

  avistamientos.forEach((item) => {
    const lat = item?.[latKey];
    const lng = item?.[lngKey];
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

    let h3Index;
    try {
      h3Index = latLngToH3Index(lat, lng, resolucion);
    } catch {
      return;
    }

    const actual = buckets.get(h3Index) ?? { h3Index, count: 0 };
    actual.count += 1;
    buckets.set(h3Index, actual);
  });

  return Array.from(buckets.values()).map((bucket) => ({
    ...bucket,
    centroide: h3IndexToCentroid(bucket.h3Index),
  }));
}

/** Formatea una coordenada para UI (lat, lng con precisión controlada). */
export function formatCoordinate(coords, decimals = 6) {
  if (!isValidCoordinate(coords)) return '—';
  return `${coords[1].toFixed(decimals)}, ${coords[0].toFixed(decimals)}`;
}
