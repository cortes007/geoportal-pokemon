#!/usr/bin/env node
/**
 * scripts/seed-afinidad.mjs
 * ---------------------------------------------------------------------------
 * Carga la matriz completa terreno -> tipo de Pokémon (7 x 18 = 126 pares).
 *
 * Fuente: scripts/data/afinidad-terreno.json
 *   - Solo contiene pesos distintos de cero.
 *   - Los pares no listados se expanden a 0.
 *   - No se permiten pesos negativos.
 *
 * Uso:
 *   node scripts/seed-afinidad.mjs --dry-run
 *   node scripts/seed-afinidad.mjs --dry-run --json
 *   node scripts/seed-afinidad.mjs
 *
 * La carga real usa SUPABASE_SERVICE_ROLE_KEY desde .env (sin prefijo VITE_).
 * ---------------------------------------------------------------------------
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { RAIZ } from './lib/env.mjs';

const RUTA_DATOS = resolve(RAIZ, 'scripts', 'data', 'afinidad-terreno.json');

function leerOpciones(argv) {
  const opciones = { dryRun: false, json: false };

  for (const arg of argv) {
    if (arg === '--dry-run') opciones.dryRun = true;
    else if (arg === '--json') opciones.json = true;
    else console.warn(`[afinidad] Flag ignorado: ${arg}`);
  }

  return opciones;
}

function cargarDatos() {
  const datos = JSON.parse(readFileSync(RUTA_DATOS, 'utf8'));

  if (!Array.isArray(datos.terrenos) || datos.terrenos.length !== 7) {
    throw new Error('afinidad-terreno.json: se esperaban exactamente 7 terrenos.');
  }
  if (!Array.isArray(datos.tipos) || datos.tipos.length !== 18) {
    throw new Error('afinidad-terreno.json: se esperaban exactamente 18 tipos.');
  }
  if (!datos.pesos || typeof datos.pesos !== 'object') {
    throw new Error('afinidad-terreno.json: falta el objeto "pesos".');
  }

  const terrenos = new Set(datos.terrenos);
  const tipos = new Set(datos.tipos);

  for (const [terreno, pesos] of Object.entries(datos.pesos)) {
    if (!terrenos.has(terreno)) {
      throw new Error(`afinidad-terreno.json: terreno desconocido "${terreno}".`);
    }
    if (!pesos || typeof pesos !== 'object') {
      throw new Error(`afinidad-terreno.json: pesos inválidos para "${terreno}".`);
    }

    for (const [tipo, peso] of Object.entries(pesos)) {
      if (!tipos.has(tipo)) {
        throw new Error(`afinidad-terreno.json: tipo desconocido "${tipo}" en "${terreno}".`);
      }
      if (typeof peso !== 'number' || !Number.isFinite(peso) || peso < 0) {
        throw new Error(
          `afinidad-terreno.json: peso inválido para ${terreno}/${tipo}: ${peso}.`,
        );
      }
    }
  }

  return datos;
}

function expandirMatriz(datos) {
  return datos.terrenos.flatMap((terreno) =>
    datos.tipos.map((pokemon_tipo) => ({
      terreno,
      pokemon_tipo,
      peso: Number(datos.pesos[terreno]?.[pokemon_tipo] ?? 0),
    })),
  );
}

function imprimirResumen(filas) {
  const noCero = filas.filter((fila) => fila.peso !== 0);
  const porTerreno = new Map();

  for (const fila of noCero) {
    porTerreno.set(fila.terreno, (porTerreno.get(fila.terreno) ?? 0) + 1);
  }

  console.log(`[afinidad] ${filas.length} pares (7 terrenos x 18 tipos)`);
  console.log(`[afinidad] ${noCero.length} pares con peso > 0; el resto = 0`);
  for (const [terreno, cantidad] of porTerreno) {
    console.log(`  ${terreno}: ${cantidad} tipos con peso`);
  }
}

async function main() {
  const opciones = leerOpciones(process.argv.slice(2));
  const datos = cargarDatos();
  const filas = expandirMatriz(datos);

  if (filas.length !== 126) {
    throw new Error(`Se esperaban 126 pares y se generaron ${filas.length}.`);
  }

  if (opciones.json) {
    console.log(JSON.stringify(filas, null, 2));
  } else {
    imprimirResumen(filas);
  }

  if (opciones.dryRun) {
    // Con --json, stdout debe quedar como JSON puro para poder parsearlo.
    const destino = opciones.json ? console.error : console.log;
    destino('[afinidad] dry-run: no se escribe en Supabase.');
    return;
  }

  const { crearClienteAdmin } = await import('./lib/supabaseAdmin.mjs');
  const supabase = crearClienteAdmin();

  const { error } = await supabase
    .from('afinidad_terreno')
    .upsert(filas, { onConflict: 'terreno,pokemon_tipo', ignoreDuplicates: false });

  if (error) throw new Error(`No se pudo cargar afinidad_terreno: ${error.message}`);

  const { count, error: errorCount } = await supabase
    .from('afinidad_terreno')
    .select('*', { count: 'exact', head: true });

  if (errorCount) throw new Error(`No se pudo contar afinidad_terreno: ${errorCount.message}`);

  console.log(`[afinidad] carga completa. Filas en afinidad_terreno: ${count ?? '?'}`);
}

main().catch((error) => {
  console.error(`[afinidad] ERROR: ${error.message}`);
  process.exitCode = 1;
});
