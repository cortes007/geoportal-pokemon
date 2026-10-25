/**
 * scripts/lib/overpassCache.mjs
 * ---------------------------------------------------------------------------
 * Caché en disco de respuestas crudas de Overpass por (bloque, terreno).
 *
 * - Ruta: scripts/.overpass-cache/terrenos/ (ignorada por git). No toca
 *   scripts/.overpass-cache/celdas-estado.json.
 * - Nombre: <terreno>__<oeste>_<sur>_<este>_<norte>__<hash de la consulta>.json
 *   Coordenadas del bloque en EPSG:4326, redondeadas a 6 decimales. Si la
 *   consulta cambia, cambia el hash y la entrada vieja deja de usarse.
 * - Solo se guarda una respuesta válida; un error nunca se cachea.
 * - Escritura atómica (archivo temporal + rename): un corte no deja JSON a medias.
 * ---------------------------------------------------------------------------
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CACHE_DIR } from './overpass.mjs';
import { problemaRespuestaOverpass } from './overpassRespuesta.mjs';

export const CACHE_TERRENOS_DIR = resolve(CACHE_DIR, 'terrenos');

function redondear(valor) {
  return String(Number(valor.toFixed(6)));
}

/** Clave legible de un bloque {minLon,minLat,maxLon,maxLat} en EPSG:4326. */
export function claveBloque({ minLon, minLat, maxLon, maxLat }) {
  return [minLon, minLat, maxLon, maxLat].map(redondear).join('_');
}

/** Hash corto y estable de la consulta. */
export function hashConsulta(query) {
  return createHash('sha256').update(query).digest('hex').slice(0, 12);
}

/**
 * @param {object} [opciones]
 * @param {string} [opciones.dir] Carpeta de caché (las pruebas usan una temporal).
 * @param {Pick<Console,'warn'>} [opciones.log]
 */
export function crearCacheTerrenos({ dir = CACHE_TERRENOS_DIR, log = console } = {}) {
  function ruta(bloque, terreno, query) {
    return resolve(dir, `${terreno}__${claveBloque(bloque)}__${hashConsulta(query)}.json`);
  }

  /** Devuelve la respuesta cacheada válida o null. */
  function leer(bloque, terreno, query) {
    const archivo = ruta(bloque, terreno, query);
    if (!existsSync(archivo)) return null;

    try {
      const data = JSON.parse(readFileSync(archivo, 'utf8'));
      const problema = problemaRespuestaOverpass(data);
      if (problema) {
        log.warn(`[cache] entrada inválida ignorada (${problema}): ${archivo}`);
        return null;
      }
      return data;
    } catch (error) {
      log.warn(`[cache] entrada ilegible ignorada (${error.message}): ${archivo}`);
      return null;
    }
  }

  /** Guarda solo respuestas válidas. Lanza si la respuesta no lo es. */
  function guardar(bloque, terreno, query, data) {
    const problema = problemaRespuestaOverpass(data);
    if (problema) throw new Error(`No se cachea una respuesta inválida: ${problema}`);

    mkdirSync(dir, { recursive: true });
    const archivo = ruta(bloque, terreno, query);
    const temporal = `${archivo}.${process.pid}.tmp`;
    writeFileSync(temporal, JSON.stringify(data), 'utf8');
    renameSync(temporal, archivo);
    return archivo;
  }

  return { ruta, leer, guardar, dir };
}
