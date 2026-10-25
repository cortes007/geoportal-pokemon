/**
 * scripts/lib/h3Cells.mjs
 * ---------------------------------------------------------------------------
 * Utilidades puras de malla H3 y teselado del bbox.
 *
 * Convención del bbox: [oeste, sur, este, norte] en EPSG:4326.
 * h3-js devuelve [lat, lng]; aquí se invierte a [lng, lat] para GeoJSON/WKT.
 * ---------------------------------------------------------------------------
 */

import {
  cellToBoundary,
  cellToLatLng,
  getResolution,
  polygonToCells,
} from 'h3-js';

/** Bbox operativo del Valle de Aburrá aprobado para la Fase 5A. */
export const BBOX_VALLE_ABURRA = Object.freeze([-75.68, 6.07, -75.32, 6.48]);

/** Resolución usada por el frontend y por `config_probabilidad.h3_resolucion`. */
export const H3_RESOLUCION_POR_DEFECTO = 9;

function validarBbox(bbox) {
  if (!Array.isArray(bbox) || bbox.length !== 4) {
    throw new TypeError('Bbox inválido: se esperaba [oeste, sur, este, norte].');
  }

  const [oeste, sur, este, norte] = bbox.map(Number);
  if (![oeste, sur, este, norte].every(Number.isFinite)) {
    throw new TypeError('Bbox inválido: todos los valores deben ser números.');
  }
  if (oeste < -180 || este > 180 || sur < -90 || norte > 90) {
    throw new RangeError('Bbox fuera de rango EPSG:4326.');
  }
  if (oeste >= este || sur >= norte) {
    throw new RangeError('Bbox inválido: se espera oeste < este y sur < norte.');
  }

  return [oeste, sur, este, norte];
}

/** Parsea `--bbox=oeste,sur,este,norte`. */
export function parseBbox(texto) {
  if (typeof texto !== 'string' || texto.trim() === '') {
    throw new TypeError('--bbox necesita el formato oeste,sur,este,norte.');
  }

  const crudas = texto.split(',');
  if (crudas.length !== 4 || crudas.some((parte) => parte.trim() === '')) {
    throw new TypeError('--bbox necesita exactamente cuatro valores: oeste,sur,este,norte.');
  }

  const partes = crudas.map((parte) => Number(parte.trim()));
  return validarBbox(partes);
}

/** Devuelve una copia del bbox ampliada por `margen` grados en cada lado. */
export function expandirBbox(bbox, margen = 0) {
  const [oeste, sur, este, norte] = validarBbox(bbox);
  if (!Number.isFinite(margen) || margen < 0) {
    throw new RangeError('El margen del bbox debe ser >= 0.');
  }
  return [oeste - margen, sur - margen, este + margen, norte + margen];
}

/** Anillo GeoJSON [lng, lat] que cubre el bbox. */
export function bboxAAnillo(bbox) {
  const [oeste, sur, este, norte] = validarBbox(bbox);
  return [
    [oeste, sur],
    [este, sur],
    [este, norte],
    [oeste, norte],
    [oeste, sur],
  ];
}

/**
 * Celdas H3 cuyo centro cae dentro del bbox.
 * `polygonToCells` de h3-js v4 espera el anillo de coordenadas, no el objeto
 * GeoJSON completo.
 */
export function celdasParaBbox(bbox, resolucion = H3_RESOLUCION_POR_DEFECTO) {
  if (!Number.isInteger(resolucion) || resolucion < 0 || resolucion > 15) {
    throw new RangeError('Resolución H3 fuera de rango (0-15).');
  }

  const anillo = bboxAAnillo(bbox);
  return polygonToCells(anillo, resolucion, true).sort();
}

/** Convierte una celda H3 a EWKT MULTIPOLYGON en EPSG:4326. */
export function celdaAWkt(h3Index) {
  if (typeof h3Index !== 'string' || h3Index.length === 0) {
    throw new TypeError('celdaAWkt: índice H3 inválido.');
  }

  const boundary = cellToBoundary(h3Index);
  if (!Array.isArray(boundary) || boundary.length < 3) {
    throw new Error(`celdaAWkt: límite vacío para ${h3Index}.`);
  }

  const anillo = boundary.map(([latitud, longitud]) => [longitud, latitud]);
  const primero = anillo[0];
  const ultimo = anillo[anillo.length - 1];
  if (primero[0] !== ultimo[0] || primero[1] !== ultimo[1]) {
    anillo.push([...primero]);
  }

  const posiciones = anillo
    .map(([longitud, latitud]) => `${Number(longitud.toFixed(8))} ${Number(latitud.toFixed(8))}`)
    .join(',');

  return `SRID=4326;MULTIPOLYGON(((${posiciones})))`;
}

/** Metadatos listos para upsert en `celdas_h3`. */
export function celdaAMetadata(h3Index) {
  const [latitud, longitud] = cellToLatLng(h3Index);
  return {
    h3_index: h3Index,
    resolucion: getResolution(h3Index),
    latitud,
    longitud,
    geom: celdaAWkt(h3Index),
  };
}

/**
 * Divide el bbox en tiles rectangulares de `tamano` grados.
 * Los tiles son contiguos y no se solapan. El último puede ser más pequeño.
 */
export function tilesParaBbox(bbox, tamano = 0.02) {
  const [oeste, sur, este, norte] = validarBbox(bbox);
  if (!Number.isFinite(tamano) || tamano <= 0) {
    throw new RangeError('El tamaño de tile debe ser > 0.');
  }

  const columnas = Math.max(1, Math.ceil((este - oeste) / tamano - 1e-12));
  const filas = Math.max(1, Math.ceil((norte - sur) / tamano - 1e-12));
  const tiles = [];

  for (let fila = 0; fila < filas; fila += 1) {
    const minLat = sur + fila * tamano;
    const maxLat = Math.min(minLat + tamano, norte);
    for (let columna = 0; columna < columnas; columna += 1) {
      const minLon = oeste + columna * tamano;
      const maxLon = Math.min(minLon + tamano, este);
      tiles.push({ minLon, minLat, maxLon, maxLat });
    }
  }

  return tiles;
}
