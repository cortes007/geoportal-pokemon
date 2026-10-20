-- ---------------------------------------------------------------------------
-- 0008 · Permisos explícitos de service_role sobre pokemon_catalogo
-- ---------------------------------------------------------------------------
-- CONTEXTO
-- Las migraciones 0001–0007 concedieron SELECT a anon/authenticated, pero no
-- concedieron DML explícito a service_role. En Supabase, service_role ignora
-- RLS (BYPASSRLS), pero NO ignora los privilegios de tabla: sin INSERT/UPDATE,
-- el upsert de scripts/seed-catalogo.mjs falla con
-- "permission denied for table pokemon_catalogo".
--
-- Esta migración es aditiva e idempotente. NO edita ninguna migración aplicada.
--
-- CÓMO DISTINGUIR EL FALLO
--   · 403 / code 42501 "permission denied for table ..."  -> este script lo corrige.
--   · 401 con cuerpo vacío, incluso en GET /rest/v1/       -> la API key está
--     siendo rechazada por el gateway; los permisos no son la causa. Revisa que
--     la service key sea del mismo proyecto y que su formato esté habilitado.
-- ---------------------------------------------------------------------------

grant usage on schema public to service_role;

grant select, insert, update, delete
  on table public.pokemon_catalogo
  to service_role;

-- Prevención: las tablas y secuencias futuras creadas por el rol que aplica
-- migraciones heredarán estos privilegios, para no repetir el fallo con el
-- siguiente script de datos.
alter default privileges in schema public
  grant select, insert, update, delete on tables to service_role;

alter default privileges in schema public
  grant usage, select on sequences to service_role;

-- Refresca la caché de PostgREST para que el cambio de privilegios se vea sin
-- esperar al siguiente reinicio.
notify pgrst, 'reload schema';
