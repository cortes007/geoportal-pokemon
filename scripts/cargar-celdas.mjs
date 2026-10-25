#!/usr/bin/env node
/**
 * scripts/cargar-celdas.mjs
 * ---------------------------------------------------------------------------
 * Genera la malla H3, la guarda en celdas_h3 y calcula la composición de
 * terreno por celda llamando a fn_recalcular_celdas_habitat por tiles.
 *
 * - No usa h3-js dentro de Postgres: la malla se genera en Node.
 * - Los tiles son pequeños (0.02° por defecto) para no agotar el tiempo de
 *   statement de la API.
 * - Un tile que falla no aborta la carga: se registra en
 *   scripts/.overpass-cache/celdas-estado.json y se puede relanzar con
 *   --solo-fallidos o --desde-tile=N.
 * - El upsert de celdas_h3 y el recálculo por tile son idempotentes.
 *
 * Uso:
 *   node scripts/cargar-celdas.mjs --dry-run
 *   node scripts/cargar-celdas.mjs --bbox=-75.60,6.19,-75.55,6.25 --max-tiles=1
 *   node scripts/cargar-celdas.mjs --bbox=-75.68,6.07,-75.32,6.48
 *
 * Flags:
 *   --bbox=oeste,sur,este,norte
 *   --tile=0.02
 *   --resolucion=9
 *   --max-tiles=N       procesa solo N tiles (para medir uno primero)
 *   --desde-tile=N      empieza en el tile N (1-based)
 *   --solo-fallidos     relanza solo los tiles fallidos del estado anterior
 *   --vaciar-terrenos   trunca terreno_poligonos al final (no recomendado aún)
 *   --pausa=0           pausa entre tiles, en ms
 *   --lote=500          celdas por upsert
 *   --dry-run           no toca Supabase
 * ---------------------------------------------------------------------------
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { crearClienteAdmin } from './lib/supabaseAdmin.mjs';
import { CACHE_DIR } from './lib/overpass.mjs';
import {
  BBOX_VALLE_ABURRA,
  H3_RESOLUCION_POR_DEFECTO,
  celdasParaBbox,
  celdaAMetadata,
  parseBbox,
  tilesParaBbox,
} from './lib/h3Cells.mjs';

const RUTA_ESTADO = resolve(CACHE_DIR, 'celdas-estado.json');

function leerEstado() {
  if (!existsSync(RUTA_ESTADO)) return null;
  try {
    return JSON.parse(readFileSync(RUTA_ESTADO, 'utf8'));
  } catch (error) {
    console.warn(`[celdas] estado ilegible (${RUTA_ESTADO}): ${error.message}`);
    return null;
  }
}

function guardarEstado(estado) {
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(RUTA_ESTADO, JSON.stringify(estado, null, 2), 'utf8');
}

function leerOpciones(argv) {
  const opciones = {
    bbox: BBOX_VALLE_ABURRA,
    tile: 0.02,
    resolucion: null,
    maxTiles: null,
    desdeTile: null,
    soloFallidos: false,
    vaciarTerrenos: false,
    pausa: 0,
    lote: 500,
    dryRun: false,
  };

  for (const arg of argv) {
    if (arg === '--dry-run') opciones.dryRun = true;
    else if (arg === '--solo-fallidos') opciones.soloFallidos = true;
    else if (arg === '--vaciar-terrenos') opciones.vaciarTerrenos = true;
    else if (arg.startsWith('--bbox=')) opciones.bbox = parseBbox(arg.slice(7));
    else if (arg.startsWith('--tile=')) opciones.tile = Number(arg.slice(7));
    else if (arg.startsWith('--resolucion=')) {
      opciones.resolucion = Number.parseInt(arg.slice(13), 10);
    } else if (arg.startsWith('--max-tiles=')) {
      opciones.maxTiles = Number.parseInt(arg.slice(12), 10);
    } else if (arg.startsWith('--desde-tile=')) {
      opciones.desdeTile = Number.parseInt(arg.slice(13), 10);
    } else if (arg.startsWith('--pausa=')) {
      opciones.pausa = Number.parseInt(arg.slice(8), 10);
    } else if (arg.startsWith('--lote=')) {
      opciones.lote = Number.parseInt(arg.slice(7), 10);
    } else {
      console.warn(`[celdas] Flag ignorado: ${arg}`);
    }
  }

  if (!Number.isFinite(opciones.tile) || opciones.tile <= 0) {
    throw new RangeError('--tile debe ser > 0.');
  }
  if (
    opciones.resolucion !== null &&
    (!Number.isInteger(opciones.resolucion) ||
      opciones.resolucion < 0 ||
      opciones.resolucion > 15)
  ) {
    throw new RangeError('--resolucion debe ser un entero entre 0 y 15.');
  }
  if (
    opciones.maxTiles !== null &&
    (!Number.isInteger(opciones.maxTiles) || opciones.maxTiles <= 0)
  ) {
    throw new RangeError('--max-tiles debe ser un entero > 0.');
  }
  if (
    opciones.desdeTile !== null &&
    (!Number.isInteger(opciones.desdeTile) || opciones.desdeTile <= 0)
  ) {
    throw new RangeError('--desde-tile debe ser un entero >= 1.');
  }
  if (!Number.isInteger(opciones.pausa) || opciones.pausa < 0) {
    throw new RangeError('--pausa debe ser un entero >= 0.');
  }
  if (!Number.isInteger(opciones.lote) || opciones.lote <= 0) {
    throw new RangeError('--lote debe ser un entero > 0.');
  }
  if (opciones.soloFallidos && opciones.desdeTile !== null) {
    throw new Error('--solo-fallidos y --desde-tile son mutuamente excluyentes.');
  }

  return opciones;
}

function seleccionarTiles(opciones) {
  if (opciones.soloFallidos) {
    const estado = leerEstado();
    if (!estado || !Array.isArray(estado.failed) || estado.failed.length === 0) {
      console.log('[celdas] --solo-fallidos: no hay tiles fallidos registrados.');
      return [];
    }
    return estado.failed.map((fallido) => ({
      indice: fallido.indice,
      minLon: fallido.minLon,
      minLat: fallido.minLat,
      maxLon: fallido.maxLon,
      maxLat: fallido.maxLat,
    }));
  }

  const todos = tilesParaBbox(opciones.bbox, opciones.tile);
  const desde = opciones.desdeTile ?? 1;
  const seleccionados = todos
    .map((tile, indice) => ({ ...tile, indice: indice + 1 }))
    .slice(desde - 1);

  if (opciones.maxTiles !== null) {
    return seleccionados.slice(0, opciones.maxTiles);
  }

  return seleccionados;
}

async function main() {
  const opciones = leerOpciones(process.argv.slice(2));
  const todosLosTiles = tilesParaBbox(opciones.bbox, opciones.tile);
  const tiles = seleccionarTiles(opciones);
  const resolucion = opciones.resolucion ?? H3_RESOLUCION_POR_DEFECTO;

  if (opciones.dryRun) {
    const celdas = celdasParaBbox(opciones.bbox, resolucion);
    const filasEstimadas = Math.ceil(celdas.length * 2.5);
    console.log('[celdas] DRY-RUN: no se toca Supabase.');
    console.log(`[celdas] bbox: ${opciones.bbox.join(',')}`);
    console.log(`[celdas] resolución H3: ${resolucion}`);
    console.log(`[celdas] celdas: ${celdas.length}`);
    console.log(`[celdas] tiles totales (${opciones.tile}°): ${todosLosTiles.length}`);
    console.log(`[celdas] tiles seleccionados: ${tiles.length}`);
    console.log(`[celdas] filas estimadas en celdas_habitat: ~${filasEstimadas}`);
    if (opciones.maxTiles !== null) {
      console.log(`[celdas] --max-tiles: ${opciones.maxTiles}`);
    }
    return;
  }

  const supabase = crearClienteAdmin();

  let resolucionReal = opciones.resolucion;
  if (resolucionReal === null) {
    const { data, error } = await supabase
      .from('config_probabilidad')
      .select('valor')
      .eq('clave', 'h3_resolucion')
      .maybeSingle();

    if (error) {
      console.warn(`[celdas] no se pudo leer h3_resolucion: ${error.message}; uso 9.`);
    }
    if (data?.valor != null && Number.isFinite(Number(data.valor))) {
      resolucionReal = Number(data.valor);
    } else {
      resolucionReal = H3_RESOLUCION_POR_DEFECTO;
    }
  }

  const celdas = celdasParaBbox(opciones.bbox, resolucionReal);
  console.log(`[celdas] ${celdas.length} celdas H3 resolución ${resolucionReal}; upsert...`);

  const inicioCeldas = Date.now();
  for (let i = 0; i < celdas.length; i += opciones.lote) {
    const lote = celdas.slice(i, i + opciones.lote).map(celdaAMetadata);
    const { error } = await supabase
      .from('celdas_h3')
      .upsert(lote, { onConflict: 'h3_index', ignoreDuplicates: false });

    if (error) throw new Error(`upsert celdas_h3: ${error.message}`);
    console.log(`[celdas] celdas ${Math.min(i + lote.length, celdas.length)}/${celdas.length}`);
  }
  console.log(`[celdas] celdas_h3 listo en ${Date.now() - inicioCeldas} ms`);

  const estadoPrevio = leerEstado();
  const fallidos = opciones.soloFallidos && Array.isArray(estadoPrevio?.failed)
    ? [...estadoPrevio.failed]
    : [];
  const tiempos = [];
  const inicioRecalculo = Date.now();

  for (const tile of tiles) {
    const numero = tile.indice ?? '?';
    const inicioTile = Date.now();

    try {
      const { data, error } = await supabase.rpc('fn_recalcular_celdas_habitat', {
        p_min_lon: tile.minLon,
        p_min_lat: tile.minLat,
        p_max_lon: tile.maxLon,
        p_max_lat: tile.maxLat,
      });

      if (error) throw new Error(error.message);

      const ms = Date.now() - inicioTile;
      tiempos.push(ms);
      const pendientes = fallidos.filter((fallido) => fallido.indice !== numero);
      fallidos.length = 0;
      fallidos.push(...pendientes);

      console.log(
        `[celdas] tile ${numero}/${todosLosTiles.length} ok: celdas=${data?.celdas ?? '?'} filas=${data?.filas ?? '?'} ${ms} ms`,
      );
    } catch (error) {
      const fallido = {
        indice: numero,
        minLon: tile.minLon,
        minLat: tile.minLat,
        maxLon: tile.maxLon,
        maxLat: tile.maxLat,
        error: error.message,
        at: new Date().toISOString(),
      };
      const existente = fallidos.findIndex((item) => item.indice === numero);
      if (existente >= 0) fallidos[existente] = fallido;
      else fallidos.push(fallido);

      console.error(
        `[celdas] tile ${numero}/${todosLosTiles.length} FALLÓ en ${Date.now() - inicioTile} ms: ${error.message}`,
      );
    }

    guardarEstado({
      bbox: opciones.bbox,
      tile: opciones.tile,
      resolucion: resolucionReal,
      actualizadoEn: new Date().toISOString(),
      failed: fallidos,
    });

    if (opciones.pausa > 0) {
      await new Promise((resolver) => setTimeout(resolver, opciones.pausa));
    }
  }

  const totalMs = Date.now() - inicioRecalculo;
  if (tiempos.length > 0) {
    const minimo = Math.min(...tiempos);
    const maximo = Math.max(...tiempos);
    const promedio = Math.round(tiempos.reduce((suma, ms) => suma + ms, 0) / tiempos.length);
    console.log(
      `[celdas] recálculo: ${tiempos.length} tiles ok, ${fallidos.length} fallidos, ${totalMs} ms total; tile min/avg/max = ${minimo}/${promedio}/${maximo} ms`,
    );
  } else {
    console.log(`[celdas] recálculo: 0 tiles ok, ${fallidos.length} fallidos, ${totalMs} ms total`);
  }

  if (opciones.vaciarTerrenos) {
    const parcial =
      opciones.soloFallidos || opciones.desdeTile !== null || opciones.maxTiles !== null;

    if (parcial) {
      console.warn('[celdas] --vaciar-terrenos omitido: la corrida es parcial.');
    } else if (fallidos.length > 0) {
      console.warn('[celdas] --vaciar-terrenos omitido: hay tiles fallidos.');
    } else {
      const { count, error: errorCount } = await supabase
        .from('celdas_habitat')
        .select('*', { count: 'exact', head: true });

      if (errorCount) {
        console.error(`[celdas] no se pudo comprobar cobertura: ${errorCount.message}`);
      } else if (!count || count <= 0) {
        console.warn('[celdas] --vaciar-terrenos omitido: cobertura 0.');
      } else {
        const { error } = await supabase.rpc('fn_vaciar_terreno_poligonos');
        if (error) {
          console.error(`[celdas] no se pudo vaciar terreno_poligonos: ${error.message}`);
        } else {
          console.log(`[celdas] terreno_poligonos vaciado; celdas_habitat tenía ${count} filas.`);
        }
      }
    }
  }

  if (fallidos.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`[celdas] ERROR: ${error.message}`);
  process.exitCode = 1;
});
