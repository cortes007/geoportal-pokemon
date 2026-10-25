/**
 * scripts/lib/geo.mjs
 * ---------------------------------------------------------------------------
 * Conversiones puras GeoJSON -> EWKT (EPSG:4326).
 *
 * Convención:
 *   - GeoJSON usa [longitud, latitud].
 *   - EWKT se emite como `SRID=4326;...`.
 *   - Las alturas (tercera coordenada) se ignoran.
 *   - Los anillos de polígonos se cierran si el GeoJSON no lo hizo.
 * ---------------------------------------------------------------------------
 */

const TIPOS_SOPORTADOS = new Set([
  'Point',
  'LineString',
  'MultiLineString',
  'Polygon',
  'MultiPolygon',
]);

function validarSrid(srid) {
  if (!Number.isInteger(srid) || srid <= 0) {
    throw new TypeError('geojsonToEwkt: SRID inválido.');
  }
}

function validarPosicion(posicion, contexto) {
  if (!Array.isArray(posicion) || posicion.length < 2) {
    throw new TypeError(`${contexto}: se esperaba [longitud, latitud].`);
  }

  const longitud = Number(posicion[0]);
  const latitud = Number(posicion[1]);

  if (!Number.isFinite(longitud) || !Number.isFinite(latitud)) {
    throw new TypeError(`${contexto}: coordenada no finita.`);
  }
  if (longitud < -180 || longitud > 180) {
    throw new RangeError(`${contexto}: longitud fuera de rango (${longitud}).`);
  }
  if (latitud < -90 || latitud > 90) {
    throw new RangeError(`${contexto}: latitud fuera de rango (${latitud}).`);
  }

  return [longitud, latitud];
}

function formatearNumero(valor) {
  // 8 decimales ~ 1 mm en latitud. Evita notación científica y ruido binario.
  return Number(valor.toFixed(8)).toString();
}

function formatearPosicion(posicion, contexto) {
  const [longitud, latitud] = validarPosicion(posicion, contexto);
  return `${formatearNumero(longitud)} ${formatearNumero(latitud)}`;
}

function normalizarAnillo(anillo, contexto) {
  if (!Array.isArray(anillo) || anillo.length < 3) {
    throw new TypeError(`${contexto}: un anillo necesita al menos 3 posiciones.`);
  }

  const posiciones = anillo.map((posicion, indice) =>
    validarPosicion(posicion, `${contexto}[${indice}]`),
  );

  const primero = posiciones[0];
  const ultimo = posiciones[posiciones.length - 1];
  if (primero[0] !== ultimo[0] || primero[1] !== ultimo[1]) {
    posiciones.push([...primero]);
  }

  if (posiciones.length < 4) {
    throw new TypeError(`${contexto}: un anillo cerrado necesita al menos 4 posiciones.`);
  }

  return posiciones;
}

function anilloAWkt(anillo, contexto) {
  return `(${normalizarAnillo(anillo, contexto)
    .map((posicion, indice) => formatearPosicion(posicion, `${contexto}[${indice}]`))
    .join(',')})`;
}

function poligonoAWkt(poligono, contexto) {
  if (!Array.isArray(poligono) || poligono.length === 0) {
    throw new TypeError(`${contexto}: polígono vacío.`);
  }
  return `(${poligono.map((anillo, indice) => anilloAWkt(anillo, `${contexto}[${indice}]`)).join(',')})`;
}

/**
 * Convierte una geometría GeoJSON a EWKT.
 * @param {object} geometry GeoJSON geometry.
 * @param {number} [srid=4326]
 * @returns {string} `SRID=4326;...`
 */
export function geojsonToEwkt(geometry, srid = 4326) {
  validarSrid(srid);

  if (!geometry || typeof geometry.type !== 'string') {
    throw new TypeError('geojsonToEwkt: geometría GeoJSON inválida.');
  }
  if (!TIPOS_SOPORTADOS.has(geometry.type)) {
    throw new RangeError(`geojsonToEwkt: tipo no soportado "${geometry.type}".`);
  }

  const { type, coordinates } = geometry;

  switch (type) {
    case 'Point':
      return `SRID=${srid};POINT(${formatearPosicion(coordinates, 'Point')})`;

    case 'LineString':
      return `SRID=${srid};LINESTRING(${coordinates
        .map((posicion, indice) => formatearPosicion(posicion, `LineString[${indice}]`))
        .join(',')})`;

    case 'MultiLineString':
      return `SRID=${srid};MULTILINESTRING(${coordinates
        .map(
          (linea, indice) =>
            `(${linea
              .map((posicion, j) =>
                formatearPosicion(posicion, `MultiLineString[${indice}][${j}]`),
              )
              .join(',')})`,
        )
        .join(',')})`;

    case 'Polygon':
      return `SRID=${srid};POLYGON${poligonoAWkt(coordinates, 'Polygon')}`;

    case 'MultiPolygon':
      return `SRID=${srid};MULTIPOLYGON(${coordinates
        .map((poligono, indice) => poligonoAWkt(poligono, `MultiPolygon[${indice}]`))
        .join(',')})`;

    default:
      throw new RangeError(`geojsonToEwkt: tipo no soportado "${type}".`);
  }
}

/** Indica si una geometría GeoJSON es poligonal o lineal, sin lanzar. */
export function tipoGeometria(geometry) {
  if (!geometry || typeof geometry.type !== 'string') return null;
  return TIPOS_SOPORTADOS.has(geometry.type) ? geometry.type : null;
}
