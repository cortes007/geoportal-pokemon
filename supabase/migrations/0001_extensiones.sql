-- ---------------------------------------------------------------------------
-- 0001 · Extensiones
-- ---------------------------------------------------------------------------
-- PostGIS: ubicación de los reportes y cálculo de distancias en metros.
-- pgcrypto: gen_random_uuid() (en PostgreSQL >= 13 ya es núcleo, pero se deja
-- declarado por portabilidad).
--
-- En Supabase las extensiones viven en el esquema `extensions`, que forma parte
-- del search_path por defecto del rol que aplica migraciones. Las funciones de
-- este proyecto usan PostGIS sin calificar y fijan `search_path` explícito.
--
-- NO ejecutar a mano: aplicar en orden con la CLI de Supabase o el SQL Editor.
-- ---------------------------------------------------------------------------

create schema if not exists extensions;

create extension if not exists postgis with schema extensions;
create extension if not exists pgcrypto with schema extensions;

-- Helper reutilizado por todas las tablas con `actualizado_en`.
-- Se define aquí una sola vez; las migraciones posteriores solo crean triggers.
create or replace function public.fn_set_actualizado_en()
returns trigger
language plpgsql
as $$
begin
  new.actualizado_en := now();
  return new;
end;
$$;

comment on function public.fn_set_actualizado_en() is
  'Trigger genérico: actualiza la columna actualizado_en en cada UPDATE.';
