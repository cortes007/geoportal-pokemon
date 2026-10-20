#!/usr/bin/env node
/**
 * scripts/seed-catalogo.mjs
 * ---------------------------------------------------------------------------
 * Llena `public.pokemon_catalogo` desde PokeAPI.
 *
 * Node puro (sin Python, sin dependencias nuevas salvo @supabase/supabase-js,
 * que ya está en el proyecto). Reejecutable: hace UPSERT por id.
 *
 * Llaves: lee del `.env` de la raíz, SIN prefijo VITE_:
 *   SUPABASE_URL                 (fallback: VITE_SUPABASE_URL, que no es secreta)
 *   SUPABASE_SERVICE_ROLE_KEY    (obligatoria; jamás en el frontend)
 *
 * Uso:
 *   node scripts/seed-catalogo.mjs
 *   node scripts/seed-catalogo.mjs --solo-faltantes
 *   node scripts/seed-catalogo.mjs --limit=50 --dry-run
 *
 * Flags:
 *   --limit=N          procesa solo N Pokémon
 *   --offset=N         salta los primeros N
 *   --solo-faltantes   omite los ids que ya están en el catálogo
 *   --dry-run          consulta PokeAPI pero no escribe en Supabase
 *   --concurrencia=N   peticiones simultáneas (por defecto 8)
 * ---------------------------------------------------------------------------
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RUTA_ENV = resolve(RAIZ, '.env');

const POKEAPI = 'https://pokeapi.co/api/v2';
const LOTE_UPSERT = 200;

/** Mapea los tipos de PokeAPI (inglés) a los ids de src/config/constants.js. */
const TIPOS_POKEAPI = Object.freeze({
  normal: 'normal',
  fighting: 'lucha',
  flying: 'volador',
  poison: 'veneno',
  ground: 'tierra',
  rock: 'roca',
  bug: 'bicho',
  ghost: 'fantasma',
  steel: 'acero',
  fire: 'fuego',
  water: 'agua',
  grass: 'planta',
  electric: 'electrico',
  psychic: 'psiquico',
  ice: 'hielo',
  dragon: 'dragon',
  dark: 'siniestro',
  fairy: 'hada',
});

/** Carga .env sin sobrescribir variables ya presentes en el entorno. */
function cargarEnv(ruta) {
  if (!existsSync(ruta)) return;

  const contenido = readFileSync(ruta, 'utf8');
  for (const linea of contenido.split(/\r?\n/)) {
    const limpia = linea.trim();
    if (!limpia || limpia.startsWith('#')) continue;

    const separador = limpia.indexOf('=');
    if (separador === -1) continue;

    const clave = limpia.slice(0, separador).trim();
    let valor = limpia.slice(separador + 1).trim();
    if (
      (valor.startsWith('"') && valor.endsWith('"')) ||
      (valor.startsWith("'") && valor.endsWith("'"))
    ) {
      valor = valor.slice(1, -1);
    }

    if (!(clave in process.env)) process.env[clave] = valor;
  }
}

function leerOpciones(argv) {
  const opciones = {
    limit: null,
    offset: 0,
    soloFaltantes: false,
    dryRun: false,
    concurrencia: 8,
  };

  for (const arg of argv) {
    if (arg === '--solo-faltantes') opciones.soloFaltantes = true;
    else if (arg === '--dry-run') opciones.dryRun = true;
    else if (arg.startsWith('--limit=')) opciones.limit = Number.parseInt(arg.slice(8), 10);
    else if (arg.startsWith('--offset=')) opciones.offset = Number.parseInt(arg.slice(9), 10);
    else if (arg.startsWith('--concurrencia=')) {
      opciones.concurrencia = Number.parseInt(arg.slice(14), 10);
    } else {
      console.warn(`[seed] Flag ignorado: ${arg}`);
    }
  }

  return opciones;
}

const esperar = (ms) => new Promise((resolver) => setTimeout(resolver, ms));
const capitalizar = (texto) => texto.charAt(0).toUpperCase() + texto.slice(1);

/** GET con reintentos y backoff exponencial. Devuelve null en 404. */
async function pedirJSON(url, intentos = 4) {
  for (let intento = 1; intento <= intentos; intento += 1) {
    try {
      const respuesta = await fetch(url, {
        headers: { 'User-Agent': 'geoportal-pokemon-go/seed-catalogo' },
      });

      if (respuesta.status === 404) return null;
      if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status}`);

      return await respuesta.json();
    } catch (error) {
      if (intento === intentos) throw error;
      await esperar(400 * 2 ** (intento - 1));
    }
  }

  return null;
}

/** Ejecuta `tarea` sobre `elementos` con un maximo de `limite` en paralelo. */
async function mapearConLimite(elementos, limite, tarea) {
  const resultados = new Array(elementos.length);
  let siguiente = 0;

  async function trabajador() {
    while (siguiente < elementos.length) {
      const indice = siguiente;
      siguiente += 1;
      resultados[indice] = await tarea(elementos[indice], indice);
    }
  }

  const trabajadores = Array.from(
    { length: Math.max(1, Math.min(limite, elementos.length)) },
    trabajador,
  );
  await Promise.all(trabajadores);

  return resultados;
}

async function construirEntrada(id) {
  const [pokemon, especie] = await Promise.all([
    pedirJSON(`${POKEAPI}/pokemon/${id}`),
    pedirJSON(`${POKEAPI}/pokemon-species/${id}`),
  ]);

  if (!pokemon) return null;

  const tipos = (pokemon.types ?? [])
    .map(({ type }) => TIPOS_POKEAPI[type?.name])
    .filter(Boolean);

  if (tipos.length === 0) {
    console.warn(`[seed] #${id} sin tipos mapeables; se omite.`);
    return null;
  }

  const nombreEs = especie?.names?.find((entrada) => entrada.language?.name === 'es')?.name;
  const sprite =
    pokemon.sprites?.other?.['official-artwork']?.front_default ??
    pokemon.sprites?.front_default ??
    null;

  return {
    id,
    nombre: nombreEs ?? capitalizar(pokemon.name),
    tipos,
    es_legendario: Boolean(especie?.is_legendary || especie?.is_mythical),
    sprite,
  };
}

async function obtenerIdsExistentes(supabase) {
  const ids = new Set();
  const tamano = 1000;

  for (let desde = 0; ; desde += tamano) {
    const { data, error } = await supabase
      .from('pokemon_catalogo')
      .select('id')
      .range(desde, desde + tamano - 1)
      .order('id');

    if (error) throw new Error(`No se pudo leer pokemon_catalogo: ${error.message}`);

    for (const fila of data ?? []) ids.add(fila.id);
    if (!data || data.length < tamano) break;
  }

  return ids;
}

async function main() {
  const opciones = leerOpciones(process.argv.slice(2));
  cargarEnv(RUTA_ENV);

  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) {
    console.error(
      '[seed] Falta SUPABASE_URL en el .env (o VITE_SUPABASE_URL como respaldo).',
    );
    process.exit(1);
  }
  if (!opciones.dryRun && !serviceKey) {
    console.error(
      '[seed] Falta SUPABASE_SERVICE_ROLE_KEY en el .env. ' +
        'Es la service_role key: nunca debe llevar prefijo VITE_ ni llegar al frontend.',
    );
    process.exit(1);
  }
  if (opciones.soloFaltantes && !serviceKey) {
    console.error('[seed] --solo-faltantes necesita SUPABASE_SERVICE_ROLE_KEY para leer el catálogo.');
    process.exit(1);
  }

  const supabase = serviceKey
    ? createClient(url, serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : null;

  console.log('[seed] Consultando el total de PokeAPI…');
  const primera = await pedirJSON(`${POKEAPI}/pokemon?limit=1`);
  const total = primera?.count ?? 1025;

  let ids = Array.from({ length: total }, (_, indice) => indice + 1);
  ids = ids.slice(Math.max(0, opciones.offset));
  if (Number.isFinite(opciones.limit)) ids = ids.slice(0, opciones.limit);

  if (opciones.soloFaltantes) {
    const existentes = await obtenerIdsExistentes(supabase);
    ids = ids.filter((id) => !existentes.has(id));
    console.log(`[seed] ${existentes.size} ids ya en catálogo; quedan ${ids.length} por revisar.`);
  }

  if (ids.length === 0) {
    console.log('[seed] Nada que hacer.');
    return;
  }

  console.log(`[seed] Procesando ${ids.length} Pokémon (concurrencia ${opciones.concurrencia})…`);
  let procesados = 0;

  const entradas = await mapearConLimite(ids, opciones.concurrencia, async (id) => {
    const entrada = await construirEntrada(id);
    procesados += 1;
    if (procesados % 50 === 0) console.log(`[seed] ${procesados}/${ids.length}`);
    return entrada;
  });

  const limpios = entradas.filter(Boolean);

  if (opciones.dryRun) {
    console.log(`[seed] Dry run: ${limpios.length} entradas listas. Muestra:`);
    console.log(JSON.stringify(limpios.slice(0, 5), null, 2));
    return;
  }

  for (let inicio = 0; inicio < limpios.length; inicio += LOTE_UPSERT) {
    const lote = limpios.slice(inicio, inicio + LOTE_UPSERT);
    const { error } = await supabase
      .from('pokemon_catalogo')
      .upsert(lote, { onConflict: 'id' });

    if (error) {
      throw new Error(`Upsert falló en el lote ${inicio}: ${error.message}`);
    }
    console.log(`[seed] Escrito ${Math.min(inicio + lote.length, limpios.length)}/${limpios.length}`);
  }

  console.log(`[seed] Listo. ${limpios.length} Pokémon en pokemon_catalogo.`);
}

main().catch((error) => {
  console.error(`[seed] Error: ${error.message}`);
  process.exit(1);
});
