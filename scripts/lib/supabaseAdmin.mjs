/**
 * scripts/lib/supabaseAdmin.mjs
 * ---------------------------------------------------------------------------
 * Cliente de Supabase para scripts locales con service_role.
 * No se usa en el frontend. No persiste sesión ni refresca tokens.
 * ---------------------------------------------------------------------------
 */

import { createClient } from '@supabase/supabase-js';
import { exigirEntorno } from './env.mjs';

export function crearClienteAdmin() {
  const { url, serviceRoleKey } = exigirEntorno();

  return createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    global: {
      headers: {
        'X-Client-Info': 'geoportal-pokemon-go/scripts-fase-5a',
      },
    },
  });
}
