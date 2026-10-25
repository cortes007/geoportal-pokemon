/**
 * scripts/lib/terrenos.mjs
 * ---------------------------------------------------------------------------
 * Lógica pura de clasificación de terrenos OSM y armado de la consulta.
 *
 * Orden de prioridad (el primero gana si un elemento tiene varias etiquetas):
 *   agua > cementerio > industrial > parque > bosque > cerro
 * `urbano` no se consulta: es el remanente calculado por PostGIS.
 * ---------------------------------------------------------------------------
 */

import { geojsonToEwkt } from './geo.mjs';

export const PRIORIDAD_TERRENOS = Object.freeze([
  'agua',
  'cementerio',
  'industrial',
  'parque',
  'bosque',
  'cerro',
]);

const ANCHOS_POR_WATERWAY = Object.freeze({
  river: 40,
  stream: 8,
  canal: 12,
  ditch: 4,
});

function incluye(valor, esperados) {
  return typeof valor === 'string' && esperados.includes(valor);
}

/**
 * Clasifica un elemento OSM por sus tags.
 * @param {Record<string, string>} tags
 * @returns {'agua'|'cementerio'|'industrial'|'parque'|'bosque'|null}
 */
export function clasificarTerreno(tags = {}) {
  const natural = tags.natural;
  const landuse = tags.landuse;
  const leisure = tags.leisure;
  const amenity = tags.amenity;
  const railway = tags.railway;
  const waterway = tags.waterway;

  if (
    incluye(natural, ['water', 'wetland']) ||
    incluye(landuse, ['reservoir']) ||
    incluye(waterway, ['river', 'stream', 'canal', 'ditch'])
  ) {
    return 'agua';
  }

  if (landuse === 'cemetery' || amenity === 'grave_yard') {
    return 'cementerio';
  }

  if (incluye(landuse, ['industrial', 'quarry']) || railway === 'yard') {
    return 'industrial';
  }

  if (
    incluye(leisure, ['park', 'garden', 'playground']) ||
    incluye(landuse, ['recreation_ground', 'village_green'])
  ) {
    return 'parque';
  }

  if (
    leisure === 'nature_reserve' ||
    landuse === 'forest' ||
    incluye(natural, ['wood', 'scrub'])
  ) {
    return 'bosque';
  }

  return null;
}

/**
 * Ancho total en metros para una línea de agua.
 * Si `width` es numérico y razonable, se respeta; si no, se usa el ancho por tipo.
 */
export function anchoWaterway(tags = {}) {
  const tipo = tags.waterway;
  const porDefecto = ANCHOS_POR_WATERWAY[tipo] ?? 10;
  const anchoTag = Number.parseFloat(String(tags.width ?? '').replace(',', '.'));

  if (!Number.isFinite(anchoTag) || anchoTag < 1 || anchoTag > 200) {
    return porDefecto;
  }

  return anchoTag;
}

/** Terrenos que se piden a Overpass, una petición por terreno y bloque. */
export const TERRENOS_CONSULTABLES = Object.freeze([
  'agua',
  'cementerio',
  'industrial',
  'parque',
  'bosque',
]);

/**
 * Selectores por terreno: [tipos OSM, filtro de etiquetas].
 * Coinciden con clasificarTerreno. Las líneas de agua (waterway) se piden solo
 * como `way`: las relaciones type=waterway duplicarían los mismos tramos.
 */
const SELECTORES_POR_TERRENO = Object.freeze({
  agua: [
    [['way', 'relation'], '["natural"~"^(water|wetland)$"]'],
    [['way', 'relation'], '["landuse"="reservoir"]'],
    [['way'], '["waterway"~"^(river|stream|canal|ditch)$"]'],
  ],
  cementerio: [
    [['way', 'relation'], '["landuse"="cemetery"]'],
    [['way', 'relation'], '["amenity"="grave_yard"]'],
  ],
  industrial: [
    [['way', 'relation'], '["landuse"~"^(industrial|quarry)$"]'],
    [['way', 'relation'], '["railway"="yard"]'],
  ],
  parque: [
    [['way', 'relation'], '["leisure"~"^(park|garden|playground)$"]'],
    [['way', 'relation'], '["landuse"~"^(recreation_ground|village_green)$"]'],
  ],
  bosque: [
    [['way', 'relation'], '["leisure"="nature_reserve"]'],
    [['way', 'relation'], '["landuse"="forest"]'],
    [['way', 'relation'], '["natural"~"^(wood|scrub)$"]'],
  ],
});

/**
 * Bbox de Overpass "sur,oeste,norte,este" desde un bloque en EPSG:4326
 * ({minLon,minLat,maxLon,maxLat}), redondeado a 6 decimales (~0,1 m).
 */
export function bboxOverpass({ minLon, minLat, maxLon, maxLat }) {
  return [minLat, minLon, maxLat, maxLon].map((v) => String(Number(v.toFixed(6)))).join(',');
}

/**
 * Consulta Overpass QL de un terreno en un bloque. Salida `out geom` (JSON crudo
 * con geometría embebida, EPSG:4326). `timeoutS` debe ser <= timeout del cliente.
 */
export function consultaOverpassTerreno(terreno, bloque, { timeoutS = 120 } = {}) {
  const selectores = SELECTORES_POR_TERRENO[terreno];
  if (!selectores) throw new RangeError(`Terreno no consultable: ${terreno}`);
  if (!Number.isInteger(timeoutS) || timeoutS <= 0) {
    throw new RangeError('timeoutS debe ser un entero > 0.');
  }

  const area = `(${bboxOverpass(bloque)})`;
  const lineas = selectores.flatMap(([tipos, filtro]) =>
    tipos.map((tipo) => `  ${tipo}${filtro}${area};`),
  );

  return `[out:json][timeout:${timeoutS}];\n(\n${lineas.join('\n')}\n);\nout geom;`;
}

const GEOMETRIAS_ADMITIDAS = Object.freeze([
  'Polygon',
  'MultiPolygon',
  'LineString',
  'MultiLineString',
]);

/**
 * Convierte un feature GeoJSON (salida de osmtogeojson, EPSG:4326) en una fila
 * de terreno_poligonos, o explica por qué se descarta.
 * @returns {{ fila: object } | { motivo: string, osm: string|null }}
 */
export function filaDesdeFeature(feature) {
  const tags = feature?.properties ?? {};
  const idCompleto = String(feature?.id ?? tags.id ?? '');
  const osm = idCompleto || null;

  const terreno = clasificarTerreno(tags);
  if (!terreno) return { motivo: 'etiquetas sin terreno', osm };

  const geometria = feature?.geometry;
  if (!geometria || !GEOMETRIAS_ADMITIDAS.includes(geometria.type)) {
    return { motivo: `geometría no admitida (${geometria?.type ?? 'vacía'})`, osm };
  }

  const [osmTipo, osmIdTexto] = idCompleto.split('/');
  if (!['way', 'relation'].includes(osmTipo) || !/^\d+$/.test(osmIdTexto ?? '')) {
    return { motivo: 'id OSM no es way/relation', osm };
  }

  const esLinea = geometria.type === 'LineString' || geometria.type === 'MultiLineString';
  if (esLinea && terreno !== 'agua') return { motivo: 'línea que no es agua', osm };

  let geom;
  try {
    geom = geojsonToEwkt(geometria);
  } catch {
    return { motivo: 'geometría inválida', osm };
  }

  return {
    fila: {
      osm_tipo: osmTipo,
      osm_id: Number(osmIdTexto),
      terreno,
      nombre: typeof tags.name === 'string' ? tags.name : null,
      geom,
      ancho_m: esLinea && tags.waterway ? anchoWaterway(tags) : null,
    },
  };
}
