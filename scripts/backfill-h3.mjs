#!/usr/bin/env node
/**
 * scripts/backfill-h3.mjs
 * ---------------------------------------------------------------------------
 * Rellena h3_index en los registros históricos de reportes y avistamientos.
 *
 * ESTE SCRIPT SE ESCRIBE EN LA FASE 5A PERO NO SE EJECUTA HASTA LA 5B,
 * después de que el usuario respalde reportes.
 *
 * Uso:
 *   node scripts/backfill-h3.mjs --dry-run
 *   node scripts/backfill-h3.mjs --dry-run --limite=10
 *   node scripts/backfill-h3.mjs --tabla=reportes
 *   node scripts/backfill-h3.mjs --tabla=avistamientos
 *
 * Flags:
 *   --dry-run          calcula y muestra, sin escribir
 *   --limite=N         máximo de filas por tabla
 *   --tabla=reportes|avistamientos|ambas
 * ---------------------------------------------------------------------------
 */

import { latLngToCell } from 'h3-js';
import { crearClienteAdmin } from './lib/supabaseAdmin.mjs';
import { H3_RESOLUCION_POR_DEFECTO } from '../src/config/constants.js';

const TABLAS = Object.freeze({
  reportes: { nombre: 'reportes', etiqueta: 'reportes' },
  avistamientos: { nombre: 'avistamientos', etiqueta: 'avistamientos' },
});

function leerOpciones(argv) {
  const opciones = {
    dryRun: false,
    limite: null,
    tabla: 'ambas',
  };

  for (const arg of argv) {
    if (arg === '--dry-run') opciones.dryRun = true;
    else if (arg.startsWith('--limite=')) {
      opciones.limite = Number.parseInt(arg.slice(9), 10);
    } else if (arg.startsWith('--tabla=')) {
      opciones.tabla = arg.slice(8);
    } else {
      console.warn(`[h3] Flag ignorado: ${arg}`);
    }
  }

  if (
    opciones.limite !== null &&
    (!Number.isInteger(opciones.limite) || opciones.limite <= 0)
  ) {
    throw new RangeError('--limite debe ser un entero > 0.');
  }
  if (!['reportes', 'avistamientos', 'ambas'].includes(opciones.tabla)) {
    throw new RangeError('--tabla debe ser reportes, avistamientos o ambas.');
  }

  return opciones;
}

async function backfillTabla(supabase, tabla, opciones) {
  let consulta = supabase
    .from(tabla.nombre)
    .select('id, latitud, longitud')
    .is('h3_index', null)
    .not('latitud', 'is', null)
    .not('longitud', 'is', null)
    .order('creado_en', { ascending: true });

  if (opciones.limite !== null) consulta = consulta.limit(opciones.limite);

  const { data, error } = await consulta;
  if (error) throw new Error(`${tabla.etiqueta}: no se pudo leer: ${error.message}`);

  const filas = data ?? [];
  console.log(`[h3] ${tabla.etiqueta}: ${filas.length} filas sin h3_index`);

  let actualizadas = 0;
  for (const fila of filas) {
    const h3Index = latLngToCell(
      Number(fila.latitud),
      Number(fila.longitud),
      H3_RESOLUCION_POR_DEFECTO,
    );

    if (opciones.dryRun) {
      console.log(`[h3] ${tabla.etiqueta}/${fila.id} -> ${h3Index}`);
      continue;
    }

    const { error: errorUpdate } = await supabase
      .from(tabla.nombre)
      .update({ h3_index: h3Index })
      .eq('id', fila.id);

    if (errorUpdate) {
      throw new Error(`${tabla.etiqueta}/${fila.id}: ${errorUpdate.message}`);
    }
    actualizadas += 1;
  }

  if (opciones.dryRun) {
    console.log(`[h3] ${tabla.etiqueta}: dry-run, no se actualizó nada.`);
  } else {
    console.log(`[h3] ${tabla.etiqueta}: ${actualizadas} filas actualizadas.`);
  }

  return { pendientes: filas.length, actualizadas };
}

async function main() {
  const opciones = leerOpciones(process.argv.slice(2));
  const supabase = crearClienteAdmin();

  const tablas =
    opciones.tabla === 'ambas'
      ? [TABLAS.reportes, TABLAS.avistamientos]
      : [TABLAS[opciones.tabla]];

  let totalPendientes = 0;
  let totalActualizadas = 0;

  for (const tabla of tablas) {
    const resultado = await backfillTabla(supabase, tabla, opciones);
    totalPendientes += resultado.pendientes;
    totalActualizadas += resultado.actualizadas;
  }

  console.log(
    `[h3] fin: ${totalPendientes} pendientes, ${totalActualizadas} actualizadas${
      opciones.dryRun ? ' (dry-run)' : ''
    }.`,
  );
}

main().catch((error) => {
  console.error(`[h3] ERROR: ${error.message}`);
  process.exitCode = 1;
});
