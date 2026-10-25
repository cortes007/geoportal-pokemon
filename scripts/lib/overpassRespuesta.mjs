/**
 * scripts/lib/overpassRespuesta.mjs
 * ---------------------------------------------------------------------------
 * Validación pura de respuestas JSON crudas de Overpass API.
 *
 * La usan tres caminos con la misma regla:
 *   - el cliente HTTP (respuesta recién llegada),
 *   - el caché en disco (respuesta guardada),
 *   - `--archivo` (JSON descargado a mano desde Overpass Turbo).
 *
 * Se espera JSON crudo de Overpass (`[out:json]`, salida `out geom`), NO GeoJSON:
 *   { "version": 0.6, "generator": "Overpass API ...", "elements": [ ... ] }
 * Coordenadas de `geometry`: EPSG:4326 (lat/lon WGS84).
 * ---------------------------------------------------------------------------
 */

export const TIPOS_OSM = Object.freeze(['node', 'way', 'relation']);

/** Patrón de los `remark` con que Overpass avisa errores con HTTP 200. */
const PATRON_REMARK_ERROR = /runtime error|timed out|out of memory/i;

/**
 * Devuelve el `remark` si Overpass informa un error de ejecución.
 * Overpass puede responder HTTP 200 con datos PARCIALES y un `remark` de error;
 * esa respuesta no es válida y nunca debe cachearse.
 * @returns {string|null}
 */
export function remarkDeError(data) {
  const remark = data?.remark;
  if (typeof remark !== 'string') return null;
  return PATRON_REMARK_ERROR.test(remark) ? remark : null;
}

/**
 * Describe el primer problema estructural de una respuesta, o null si es válida.
 * @returns {string|null}
 */
export function problemaRespuestaOverpass(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return 'no es un objeto JSON';
  }
  if (data.type === 'FeatureCollection' || data.type === 'Feature') {
    return 'es GeoJSON; se espera el JSON crudo de Overpass (Export > Data > raw data)';
  }
  if (!Array.isArray(data.elements)) {
    return 'falta el arreglo "elements"';
  }

  const remark = remarkDeError(data);
  if (remark) return `Overpass informó un error de ejecución: ${remark.slice(0, 200)}`;

  for (let indice = 0; indice < data.elements.length; indice += 1) {
    const elemento = data.elements[indice];
    if (!elemento || !TIPOS_OSM.includes(elemento.type)) {
      return `elements[${indice}] tiene un tipo inesperado (${JSON.stringify(elemento?.type)}); se esperan node, way o relation`;
    }
    if (!Number.isSafeInteger(elemento.id)) {
      return `elements[${indice}] no tiene un id numérico`;
    }
  }

  return null;
}

/**
 * Valida y devuelve un resumen con advertencias no bloqueantes.
 * @param {unknown} data
 * @param {string} [origen='respuesta'] Texto para el mensaje de error.
 * @returns {{ elementos: number, porTipo: Record<string, number>, advertencias: string[] }}
 */
export function validarRespuestaOverpass(data, origen = 'respuesta') {
  const problema = problemaRespuestaOverpass(data);
  if (problema) throw new Error(`${origen}: ${problema}.`);

  const porTipo = { node: 0, way: 0, relation: 0 };
  const idsNodos = new Set();
  for (const elemento of data.elements) {
    porTipo[elemento.type] += 1;
    if (elemento.type === 'node') idsNodos.add(elemento.id);
  }

  // Un way sin `geometry` solo sirve si sus nodos vienen en la misma respuesta.
  const waysSinGeometria = data.elements.filter(
    (elemento) =>
      elemento.type === 'way' &&
      !Array.isArray(elemento.geometry) &&
      !(Array.isArray(elemento.nodes) && elemento.nodes.every((id) => idsNodos.has(id))),
  ).length;

  const advertencias = [];
  if (waysSinGeometria > 0) {
    advertencias.push(
      `${waysSinGeometria} ways sin geometría ni nodos; la consulta debe terminar en "out geom;"`,
    );
  }
  if (data.elements.length === 0) {
    advertencias.push('la respuesta no trae elementos');
  }

  return { elementos: data.elements.length, porTipo, advertencias };
}
