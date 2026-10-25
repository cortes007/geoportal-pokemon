#!/usr/bin/env node
/**
 * scripts/cargar-terrenos.mjs
 * ---------------------------------------------------------------------------
 * Carga polígonos y franjas de agua de OpenStreetMap en terreno_poligonos.
 *
 * - Una petición Overpass por (bloque, terreno), secuencial, con pausa de 10 s
 *   entre peticiones reales y reintentos con espera exponencial (lib/overpass.mjs).
 * - Caché por (bloque, terreno) en scripts/.overpass-cache/terrenos/: lo ya
 *   descargado no se vuelve a pedir. Reanudable e idempotente.
 * - Lo que llega se escribe aunque otras peticiones fallen; al final se listan
 *   los (bloque, terreno) que faltan.
 * - Convierte GeoJSON (EPSG:4326) a EWKT y deja que el trigger de Postgres
 *   normalice, bufferice líneas de agua y simplifique.
 * - `urbano` no se consulta: es el remanente de fn_recalcular_celdas_habitat.
 *
 * Uso:
 *   node scripts/cargar-terrenos.mjs --dry-run --bbox=-75.60,6.19,-75.55,6.25
 *   node scripts/cargar-terrenos.mjs --bbox=-75.60,6.19,-75.55,6.25
 *   node scripts/cargar-terrenos.mjs --archivo=agua.json --archivo=parque.json
 *   node scripts/cargar-terrenos.mjs --dry-run --archivo=agua.json
 *
 * Flags:
 *   --bbox=oeste,sur,este,norte  EPSG:4326 (por defecto el Valle de Aburrá aprobado)
 *   --bloque=0.1                  tamaño del bloque Overpass, en grados
 *   --margen=0.02                 margen para cubrir celdas del borde
 *   --pausa=10000                 pausa entre peticiones reales, en ms
 *   --lote=200                    filas por upsert
 *   --max-bloques=N               limita bloques (útil para una prueba)
 *   --solo=terreno                filtra terrenos consultables (ej. --solo=parque)
 *   --max-peticiones=N            tope de peticiones por red en esta corrida (tandas)
 *   --refrescar                   ignora la caché (la sobrescribe si llega algo válido)
 *   --archivo=ruta.json           JSON crudo de Overpass; repetible. No usa la red.
 *   --dry-run                     no toca red ni base (con --archivo: solo valida)
 * ---------------------------------------------------------------------------
 */

import { cargarEnv } from './lib/env.mjs';
import { crearClienteAdmin } from './lib/supabaseAdmin.mjs';
import {
  TIMEOUT_PETICION_MS,
  TIMEOUT_QL_S,
  crearClienteOverpass,
  endpointsConfigurados,
  esperar,
  hostsDe,
  origenEndpoints,
} from './lib/overpass.mjs';
import { crearCacheTerrenos } from './lib/overpassCache.mjs';
import {
  cargarArchivos,
  cargarBloques,
  codigoSalida,
  crearEstadisticas,
  escribirFilas,
  imprimirResumen,
  resolverTerrenosSolo,
} from './lib/cargaTerrenos.mjs';
import {
  BBOX_VALLE_ABURRA,
  expandirBbox,
  parseBbox,
  tilesParaBbox,
} from './lib/h3Cells.mjs';
import {
  PRIORIDAD_TERRENOS,
  TERRENOS_CONSULTABLES,
  consultaOverpassTerreno,
} from './lib/terrenos.mjs';
import { instalarManejadoresGlobales } from './lib/procesoSeguro.mjs';

const PREFIJO = '[terrenos]';
const SEGUNDOS_MAX_POR_PETICION = 60;

function leerOpciones(argv) {
  const opciones = {
    bbox: BBOX_VALLE_ABURRA,
    bloque: 0.1,
    margen: 0.02,
    pausa: 10_000,
    lote: 200,
    maxBloques: null,
    maxPeticiones: null,
    terrenos: [...TERRENOS_CONSULTABLES],
    refrescar: false,
    dryRun: false,
    archivos: [],
  };

  const soloAcumulados = [];

  for (const arg of argv) {
    if (arg === '--dry-run') opciones.dryRun = true;
    else if (arg === '--refrescar') opciones.refrescar = true;
    else if (arg.startsWith('--bbox=')) opciones.bbox = parseBbox(arg.slice(7));
    else if (arg.startsWith('--bloque=')) opciones.bloque = Number(arg.slice(9));
    else if (arg.startsWith('--margen=')) opciones.margen = Number(arg.slice(9));
    else if (arg.startsWith('--pausa=')) opciones.pausa = Number(arg.slice(8));
    else if (arg.startsWith('--lote=')) opciones.lote = Number.parseInt(arg.slice(7), 10);
    else if (arg.startsWith('--max-bloques=')) {
      opciones.maxBloques = Number.parseInt(arg.slice(14), 10);
    } else if (arg.startsWith('--max-peticiones=')) {
      opciones.maxPeticiones = Number.parseInt(arg.slice(17), 10);
    } else if (arg.startsWith('--solo=')) {
      soloAcumulados.push(arg.slice(7));
    } else if (arg.startsWith('--archivo=')) {
      const ruta = arg.slice(10).trim();
      if (!ruta) throw new TypeError('--archivo necesita una ruta.');
      opciones.archivos.push(ruta);
    } else {
      console.warn(`${PREFIJO} Flag ignorado: ${arg}`);
    }
  }

  if (soloAcumulados.length > 0) {
    opciones.terrenos = resolverTerrenosSolo(soloAcumulados.join(','));
  }

  if (!Number.isFinite(opciones.bloque) || opciones.bloque <= 0) {
    throw new RangeError('--bloque debe ser > 0.');
  }
  if (!Number.isFinite(opciones.margen) || opciones.margen < 0) {
    throw new RangeError('--margen debe ser >= 0.');
  }
  if (!Number.isFinite(opciones.pausa) || opciones.pausa < 0) {
    throw new RangeError('--pausa debe ser >= 0.');
  }
  if (!Number.isInteger(opciones.lote) || opciones.lote <= 0) {
    throw new RangeError('--lote debe ser un entero > 0.');
  }
  if (
    opciones.maxBloques !== null &&
    (!Number.isInteger(opciones.maxBloques) || opciones.maxBloques <= 0)
  ) {
    throw new RangeError('--max-bloques debe ser un entero > 0.');
  }
  if (
    opciones.maxPeticiones !== null &&
    (!Number.isInteger(opciones.maxPeticiones) || opciones.maxPeticiones <= 0)
  ) {
    throw new RangeError('--max-peticiones debe ser un entero > 0.');
  }

  return opciones;
}

function calcularBloques(opciones) {
  const bboxAmpliado = expandirBbox(opciones.bbox, opciones.margen);
  const bloques = tilesParaBbox(bboxAmpliado, opciones.bloque);
  const seleccion = opciones.maxBloques === null ? bloques : bloques.slice(0, opciones.maxBloques);
  return { bboxAmpliado, bloques: seleccion };
}

function formatearDuracion(segundos) {
  const minutos = Math.floor(segundos / 60);
  const resto = Math.round(segundos % 60);
  return minutos > 0 ? `${minutos} min ${resto} s` : `${resto} s`;
}

function imprimirDryRun(opciones, bboxAmpliado, bloques) {
  const cache = crearCacheTerrenos();
  let enCache = 0;
  for (const bloque of bloques) {
    for (const terreno of opciones.terrenos) {
      const query = consultaOverpassTerreno(terreno, bloque, { timeoutS: TIMEOUT_QL_S });
      if (cache.leer(bloque, terreno, query)) enCache += 1;
    }
  }

  const peticiones = bloques.length * opciones.terrenos.length;
  const pendientesTotal = opciones.refrescar ? peticiones : peticiones - enCache;
  const pendientes =
    opciones.maxPeticiones === null
      ? pendientesTotal
      : Math.min(pendientesTotal, opciones.maxPeticiones);
  const pausaTotalS = (Math.max(0, pendientes - 1) * opciones.pausa) / 1000;
  const estimadoS = pendientes * SEGUNDOS_MAX_POR_PETICION + pausaTotalS;

  console.log(`${PREFIJO} DRY-RUN: no se consulta Overpass ni Supabase.`);
  console.log(`${PREFIJO} bbox (EPSG:4326): ${opciones.bbox.join(',')}`);
  console.log(`${PREFIJO} bbox con margen ${opciones.margen}: ${bboxAmpliado.join(',')}`);
  console.log(`${PREFIJO} bloque: ${opciones.bloque}°; bloques: ${bloques.length}`);
  console.log(`${PREFIJO} terrenos: ${opciones.terrenos.join(', ')}`);
  console.log(
    `${PREFIJO} peticiones: ${bloques.length} bloques x ${opciones.terrenos.length} terrenos = ${peticiones}; ya en caché: ${opciones.refrescar ? '0 (--refrescar)' : enCache}; por pedir: ${pendientes}${opciones.maxPeticiones !== null ? ` (tope --max-peticiones=${opciones.maxPeticiones}, total sin caché ${pendientesTotal})` : ''}`,
  );
  console.log(
    `${PREFIJO} pausa entre peticiones: ${opciones.pausa} ms; pausa total: ${formatearDuracion(pausaTotalS)}`,
  );
  console.log(
    `${PREFIJO} estimación (hasta ${SEGUNDOS_MAX_POR_PETICION} s por petición, sin reintentos): ${formatearDuracion(estimadoS)}`,
  );
  console.log(
    `${PREFIJO} timeouts: petición ${TIMEOUT_PETICION_MS / 1000} s; [timeout:${TIMEOUT_QL_S}] en la consulta`,
  );
  console.log(
    `${PREFIJO} endpoints (${origenEndpoints()}): ${hostsDe(endpointsConfigurados())}`,
  );
  console.log(`${PREFIJO} prioridad: ${PRIORIDAD_TERRENOS.join(' > ')} > urbano (remanente)`);
}

async function main() {
  instalarManejadoresGlobales(PREFIJO);
  cargarEnv();
  const opciones = leerOpciones(process.argv.slice(2));
  const stats = crearEstadisticas();

  if (opciones.archivos.length > 0) {
    const escribir = opciones.dryRun
      ? null
      : (() => {
          const supabase = crearClienteAdmin();
          return (filas) => escribirFilas(supabase, filas, { lote: opciones.lote, stats });
        })();

    if (opciones.dryRun) console.log(`${PREFIJO} DRY-RUN con --archivo: solo se valida y clasifica.`);
    await cargarArchivos({ rutas: opciones.archivos, escribir, stats });
    imprimirResumen(stats, { modo: opciones.dryRun ? 'archivo, dry-run' : 'archivo' });
    process.exitCode = codigoSalida(stats);
    return;
  }

  const { bboxAmpliado, bloques } = calcularBloques(opciones);

  if (opciones.dryRun) {
    imprimirDryRun(opciones, bboxAmpliado, bloques);
    return;
  }

  // Credenciales primero: si faltan, se falla antes de gastar peticiones Overpass.
  const supabase = crearClienteAdmin();
  const cliente = crearClienteOverpass({ endpoints: endpointsConfigurados() });
  console.log(`${PREFIJO} endpoints (${origenEndpoints()}): ${hostsDe(cliente.endpoints)}`);
  console.log(
    `${PREFIJO} ${bloques.length} bloques x ${opciones.terrenos.length} terrenos (${opciones.terrenos.join(', ')}); pausa ${opciones.pausa} ms${opciones.maxPeticiones !== null ? `; max-peticiones ${opciones.maxPeticiones}` : ''}`,
  );

  const inicio = Date.now();
  await cargarBloques({
    bloques,
    terrenos: opciones.terrenos,
    maxPeticiones: opciones.maxPeticiones,
    cliente,
    cache: crearCacheTerrenos(),
    escribir: (filas) => escribirFilas(supabase, filas, { lote: opciones.lote, stats }),
    esperarFn: esperar,
    pausaMs: opciones.pausa,
    refrescar: opciones.refrescar,
    timeoutS: TIMEOUT_QL_S,
    stats,
  });

  imprimirResumen(stats, { modo: 'overpass' });
  console.log(`${PREFIJO} duración: ${formatearDuracion((Date.now() - inicio) / 1000)}`);
  process.exitCode = codigoSalida(stats);
}

main().catch((error) => {
  console.error(`${PREFIJO} ERROR: ${error.message}`);
  if (error.cause) console.error(`${PREFIJO} causa:`, error.cause);
  process.exitCode = 1;
});
