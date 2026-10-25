/**
 * scripts/lib/env.mjs
 * ---------------------------------------------------------------------------
 * Carga del `.env` local para los scripts de datos.
 *
 * Reglas:
 *   - La service role key se lee SIN prefijo VITE_.
 *   - Nunca se imprime ni se exporta al frontend.
 *   - Las variables ya presentes en el entorno tienen prioridad.
 * ---------------------------------------------------------------------------
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Raíz del repositorio (scripts/lib -> scripts -> raíz). */
export const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const RUTA_ENV = resolve(RAIZ, '.env');

/** Carga `.env` sin sobrescribir variables ya definidas en el entorno. */
export function cargarEnv(ruta = RUTA_ENV) {
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

    if (clave && !(clave in process.env)) process.env[clave] = valor;
  }
}

/**
 * Comprueba las llaves necesarias y devuelve URL + service role.
 * `SUPABASE_URL` es obligatoria; `VITE_SUPABASE_URL` solo se acepta como
 * fallback porque no es un secreto.
 */
export function exigirEntorno() {
  cargarEnv();

  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) {
    throw new Error(
      'Falta SUPABASE_URL en .env (o VITE_SUPABASE_URL como fallback no secreto).',
    );
  }
  if (!serviceRoleKey) {
    throw new Error(
      'Falta SUPABASE_SERVICE_ROLE_KEY en .env. No uses variables con prefijo VITE_.',
    );
  }

  return { url, serviceRoleKey };
}
