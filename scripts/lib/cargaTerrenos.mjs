/**
 * scripts/lib/cargaTerrenos.mjs
 * ---------------------------------------------------------------------------
 * Coordinación de la carga de terrenos OSM: recorre (bloque, terreno), usa el
 * caché, pide a Overpass lo que falta, convierte a filas y escribe en
 * terreno_poligonos. Sin estado global: cliente, caché y escritor se inyectan
 * (scripts/lib/cargaTerrenos.test.mjs lo prueba con fetch y Supabase simulados).
 *
 * Garantías:
 *   - Lo que llega se escribe aunque otras peticiones fallen.
 *   - Los (bloque, terreno) fallidos se listan al final; al relanzar, lo ya
 *     cacheado no se vuelve a pedir (reanudable e idempotente: upsert por
 *     osm_tipo,osm_id).
 *   - Si un lote falla en Postgres, se reintenta fila por fila para señalar el
 *     elemento OSM exacto, con código y mensaje completos, sin abortar el resto.
 * ---------------------------------------------------------------------------
 */

import { readFileSync } from 'node:fs';
import osmtogeojson from 'osmtogeojson';
import { claveBloque } from './overpassCache.mjs';
import { describirError } from './overpass.mjs';
import { validarRespuestaOverpass } from './overpassRespuesta.mjs';
import { TERRENOS_CONSULTABLES, consultaOverpassTerreno, filaDesdeFeature } from './terrenos.mjs';

const MAX_ERRORES_DETALLADOS = 20;

export function crearEstadisticas() {
  return {
    peticiones: {
      red: 0,
      cache: 0,
      fallidas: 0,
      aplazadas: 0,
      intentosInterpreter: 0,
      fallosEstado: 0,
    },
    elementosRecibidos: 0,
    validos: {},
    descartados: {},
    duplicados: 0,
    faltantes: [],
    escritura: { ok: 0, fallidas: [] },
    vistos: new Set(),
  };
}

/**
 * Normaliza y valida el filtro `--solo=terreno` (admite cadena separada por
 * comas o arreglo). Lanza RangeError si algún valor no es consultable.
 * @param {string|string[]|null|undefined} solo
 * @returns {string[]}
 */
export function resolverTerrenosSolo(solo) {
  if (solo === null || solo === undefined) return [...TERRENOS_CONSULTABLES];
  const crudos = Array.isArray(solo) ? solo : String(solo).split(',');
  const limpios = crudos.map((t) => String(t).trim()).filter(Boolean);
  if (limpios.length === 0) {
    throw new RangeError(
      `--solo necesita al menos un terreno (${TERRENOS_CONSULTABLES.join(', ')}).`,
    );
  }
  for (const terreno of limpios) {
    if (!TERRENOS_CONSULTABLES.includes(terreno)) {
      throw new RangeError(
        `--solo inválido (${terreno}). Terrenos consultables: ${TERRENOS_CONSULTABLES.join(', ')}.`,
      );
    }
  }
  return [...new Set(limpios)];
}

function sumar(mapa, clave, cantidad = 1) {
  mapa[clave] = (mapa[clave] ?? 0) + cantidad;
}

/**
 * Convierte una respuesta cruda de Overpass en filas nuevas (no vistas antes en
 * esta corrida) y actualiza los contadores.
 */
export function procesarRespuesta(osm, stats) {
  stats.elementosRecibidos += osm.elements.length;
  const geojson = osmtogeojson(osm);
  const filas = [];

  for (const feature of geojson.features ?? []) {
    const resultado = filaDesdeFeature(feature);
    if (!resultado.fila) {
      sumar(stats.descartados, resultado.motivo);
      continue;
    }

    const clave = `${resultado.fila.osm_tipo}/${resultado.fila.osm_id}`;
    if (stats.vistos.has(clave)) {
      stats.duplicados += 1;
      continue;
    }
    stats.vistos.add(clave);
    sumar(stats.validos, resultado.fila.terreno);
    filas.push(resultado.fila);
  }

  return filas;
}

/** Motivo completo de un error de PostgREST/Postgres. */
export function formatearErrorPostgres(error) {
  const partes = [`código ${error?.code ?? 's/c'}: ${error?.message ?? String(error)}`];
  if (error?.details) partes.push(`detalle: ${error.details}`);
  if (error?.hint) partes.push(`pista: ${error.hint}`);
  return partes.join(' | ');
}

async function upsertSeguro(supabase, filas) {
  try {
    const { error } = await supabase.from('terreno_poligonos').upsert(filas, {
      onConflict: 'osm_tipo,osm_id',
      ignoreDuplicates: false,
    });
    return error ?? null;
  } catch (error) {
    return {
      code: error?.code ?? 'excepcion',
      message: error?.message ?? String(error),
      details: error?.cause?.message ?? null,
      hint: null,
    };
  }
}

/**
 * Escribe filas por lotes. Si un lote falla, reintenta fila por fila y registra
 * cada elemento OSM que falla con el motivo completo de Postgres.
 */
export async function escribirFilas(supabase, filas, { lote = 200, stats, log = console }) {
  for (let i = 0; i < filas.length; i += lote) {
    const grupo = filas.slice(i, i + lote);
    const errorLote = await upsertSeguro(supabase, grupo);
    if (!errorLote) {
      stats.escritura.ok += grupo.length;
      continue;
    }

    log.warn(
      `[terrenos] lote de ${grupo.length} filas rechazado (${formatearErrorPostgres(errorLote)}); reintentando fila por fila`,
    );

    for (const fila of grupo) {
      const errorFila = await upsertSeguro(supabase, [fila]);
      if (!errorFila) {
        stats.escritura.ok += 1;
        continue;
      }

      const fallo = {
        osm: `${fila.osm_tipo}/${fila.osm_id}`,
        terreno: fila.terreno,
        codigo: errorFila.code ?? null,
        motivo: formatearErrorPostgres(errorFila),
      };
      stats.escritura.fallidas.push(fallo);
      if (stats.escritura.fallidas.length <= MAX_ERRORES_DETALLADOS) {
        log.error(`[terrenos] INSERT falló para ${fallo.osm} (${fallo.terreno}): ${fallo.motivo}`);
      }
    }
  }
}

/**
 * Recorre bloques × terrenos. Una sola petición en vuelo; pausa solo entre
 * peticiones reales (no entre lecturas de caché).
 */
export async function cargarBloques({
  bloques,
  terrenos = TERRENOS_CONSULTABLES,
  solo = null,
  maxPeticiones = null,
  cliente,
  cache,
  escribir,
  esperarFn,
  pausaMs = 10_000,
  refrescar = false,
  timeoutS = 120,
  stats = crearEstadisticas(),
  log = console,
}) {
  const listaTerrenos = solo !== null ? resolverTerrenosSolo(solo) : resolverTerrenosSolo(terrenos);
  if (maxPeticiones !== null && (!Number.isInteger(maxPeticiones) || maxPeticiones <= 0)) {
    throw new RangeError('--max-peticiones debe ser un entero > 0.');
  }

  let huboPeticion = false;
  let peticionesRedHechas = 0;

  for (let indice = 0; indice < bloques.length; indice += 1) {
    const bloque = bloques[indice];
    const clave = claveBloque(bloque);

    for (const terreno of listaTerrenos) {
      const etiqueta = `bloque ${indice + 1}/${bloques.length} [${clave}] ${terreno}`;
      const query = consultaOverpassTerreno(terreno, bloque, { timeoutS });
      let osm = refrescar ? null : cache.leer(bloque, terreno, query);

      if (osm) {
        stats.peticiones.cache += 1;
        log.log(`[terrenos] ${etiqueta}: desde caché (${osm.elements.length} elementos)`);
      } else {
        if (maxPeticiones !== null && peticionesRedHechas >= maxPeticiones) {
          stats.peticiones.aplazadas += 1;
          continue;
        }

        if (huboPeticion && pausaMs > 0) await esperarFn(pausaMs);
        huboPeticion = true;
        peticionesRedHechas += 1;

        try {
          const resultado = await cliente.consultar(query, { etiqueta });
          osm = resultado.data;
          stats.peticiones.red += 1;
          stats.peticiones.intentosInterpreter +=
            resultado.intentosInterpreter ?? resultado.intentos ?? 0;
          stats.peticiones.fallosEstado += resultado.fallosEstado ?? 0;
        } catch (error) {
          stats.peticiones.fallidas += 1;
          stats.peticiones.intentosInterpreter +=
            error?.intentosInterpreter ?? error?.intentos ?? 0;
          stats.peticiones.fallosEstado += error?.fallosEstado ?? 0;
          stats.faltantes.push({ bloque: clave, terreno, motivo: describirError(error) });
          log.error(`[terrenos] ${etiqueta}: FALTA | ${describirError(error)}`);
          continue;
        }

        try {
          cache.guardar(bloque, terreno, query, osm);
        } catch (error) {
          log.warn(`[terrenos] ${etiqueta}: no se pudo cachear (${error.message}); se usa igual`);
        }
      }

      const filas = procesarRespuesta(osm, stats);
      if (escribir && filas.length > 0) await escribir(filas);
      log.log(`[terrenos] ${etiqueta}: ${filas.length} filas nuevas`);
    }
  }

  if (stats.peticiones.aplazadas > 0) {
    log.log(
      `[terrenos] tope --max-peticiones=${maxPeticiones} alcanzado (${peticionesRedHechas} petición/es por red); quedan ${stats.peticiones.aplazadas} (bloque, terreno) pendientes para la siguiente tanda`,
    );
  }

  return stats;
}

/** Imprime conteos por terreno de un conjunto de filas. */
function conteoPorTerreno(filas) {
  const conteo = {};
  for (const fila of filas) sumar(conteo, fila.terreno);
  return conteo;
}

/**
 * Carga uno o varios JSON crudos de Overpass descargados a mano.
 * Valida cada archivo, imprime elementos y terrenos ANTES de escribir.
 */
export async function cargarArchivos({
  rutas,
  escribir,
  stats = crearEstadisticas(),
  log = console,
  leerArchivo = (ruta) => readFileSync(ruta, 'utf8'),
}) {
  const filas = [];

  for (const ruta of rutas) {
    let data;
    try {
      data = JSON.parse(leerArchivo(ruta));
    } catch (error) {
      throw new Error(`${ruta}: no se pudo leer como JSON (${error.message}).`);
    }

    const resumen = validarRespuestaOverpass(data, ruta);
    for (const aviso of resumen.advertencias) log.warn(`[terrenos] ${ruta}: aviso: ${aviso}`);

    const nuevas = procesarRespuesta(data, stats);
    filas.push(...nuevas);
    log.log(
      `[terrenos] ${ruta}: ${resumen.elementos} elementos (node ${resumen.porTipo.node}, way ${resumen.porTipo.way}, relation ${resumen.porTipo.relation}); filas válidas nuevas por terreno: ${JSON.stringify(conteoPorTerreno(nuevas))}`,
    );
  }

  log.log(
    `[terrenos] total archivos: ${stats.elementosRecibidos} elementos; ${filas.length} filas válidas por terreno: ${JSON.stringify(stats.validos)}; descartados: ${JSON.stringify(stats.descartados)}`,
  );

  if (escribir && filas.length > 0) {
    log.log(`[terrenos] escribiendo ${filas.length} filas en terreno_poligonos...`);
    await escribir(filas);
  }

  return stats;
}

/** Resumen final legible. */
export function imprimirResumen(stats, { modo = 'overpass', log = console } = {}) {
  const linea = '='.repeat(60);
  log.log(`\n${linea}\nRESUMEN DE CARGA DE TERRENOS (${modo})\n${linea}`);

  if (modo === 'overpass') {
    const p = stats.peticiones;
    const extraAplazadas = p.aplazadas > 0 ? ` | aplazadas por tope ${p.aplazadas}` : '';
    log.log(
      `Peticiones: hechas por red ${p.red} | desde caché ${p.cache} | fallidas ${p.fallidas}${extraAplazadas} | intentos /api/interpreter ${p.intentosInterpreter} | fallos /api/status ${p.fallosEstado}`,
    );
  }

  log.log(`Elementos recibidos (crudos): ${stats.elementosRecibidos}`);
  log.log('Polígonos/franjas válidos por terreno:');
  for (const terreno of TERRENOS_CONSULTABLES) {
    log.log(`  - ${terreno}: ${stats.validos[terreno] ?? 0}`);
  }
  if (stats.duplicados > 0) {
    log.log(`Repetidos entre consultas (contados una vez): ${stats.duplicados}`);
  }

  const totalDescartados = Object.values(stats.descartados).reduce((a, b) => a + b, 0);
  log.log(`Descartados: ${totalDescartados}`);
  for (const [motivo, cantidad] of Object.entries(stats.descartados)) {
    log.log(`  - ${motivo}: ${cantidad}`);
  }

  const fallidas = stats.escritura.fallidas;
  log.log(`Escritura terreno_poligonos: ${stats.escritura.ok} ok | ${fallidas.length} fallidas`);
  if (fallidas.length > 0) {
    const porCodigo = {};
    for (const fallo of fallidas) sumar(porCodigo, fallo.codigo ?? 's/c');
    log.log(`  por código Postgres: ${JSON.stringify(porCodigo)}`);
    log.log(`  ejemplos: ${fallidas.slice(0, 10).map((f) => f.osm).join(', ')}`);
  }

  if (stats.faltantes.length > 0) {
    log.log(`Faltan ${stats.faltantes.length} (bloque, terreno):`);
    for (const faltante of stats.faltantes) {
      log.log(`  - [${faltante.bloque}] ${faltante.terreno}`);
    }
    log.log('  Relanza el mismo comando: lo ya cacheado no se vuelve a pedir.');
  }
  log.log(linea);
}

/** 1 si no llegó nada, si falta algún (bloque, terreno) o si falló alguna fila. */
export function codigoSalida(stats, { log = console } = {}) {
  if (stats.elementosRecibidos === 0) {
    log.error(
      '[terrenos] ERROR: no llegó ningún elemento (ni por red, ni desde caché, ni desde archivo). Corre el diagnóstico antes de reintentar.',
    );
    return 1;
  }
  if (stats.faltantes.length > 0 || stats.escritura.fallidas.length > 0) return 1;
  return 0;
}
