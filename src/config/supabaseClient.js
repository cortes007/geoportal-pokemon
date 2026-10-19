import { createClient } from '@supabase/supabase-js';

/**
 * supabaseClient.js
 * Única puerta de entrada al backend (consultas, RPC, inserts y Realtime).
 */

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

const isConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

if (!isConfigured) {
  // Advertimos en vez de lanzar: la UI degrada con un aviso, no con pantalla en blanco.
  console.warn(
    '[supabaseClient] Faltan VITE_SUPABASE_URL y/o VITE_SUPABASE_ANON_KEY. ' +
      'Copia .env.example a .env y reinicia el servidor de Vite.',
  );
}

/** Instancia de Supabase (null si la configuración de entorno está incompleta). */
export const supabase = isConfigured
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : null;

/** Bandera para validar configuración antes de consultar. */
export const isSupabaseConfigured = isConfigured;

/** Devuelve el cliente o lanza un error explícito. */
export function getSupabaseClient() {
  if (!supabase) {
    throw new Error(
      'Supabase no está configurado. Define VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY en tu .env',
    );
  }
  return supabase;
}
