-- ---------------------------------------------------------------------------
-- 0007 · Continuidad: avistamientos → reportes
-- ---------------------------------------------------------------------------
-- OBJETIVO: migrar los datos de `avistamientos` a `reportes` sin perder nada y
-- sin romper el frontend actual, que sigue insertando en `avistamientos` y
-- leyendo por la RPC `listar_avistamientos_recientes`.
--
-- ESTRATEGIA:
--   1. Backfill idempotente: cada fila migrada guarda `origen_id`, y esa
--      columna es UNIQUE, así que reejecutar esta migración no duplica.
--   2. Trigger espejo: mientras el frontend siga escribiendo en `avistamientos`,
--      cada INSERT se refleja también en `reportes`.
--   3. La tabla `avistamientos` y su RPC NO se tocan: cero regresión en la app.
--
-- CUANDO EL FRONTEND USE `reportes`: eliminar el trigger espejo, escribir la
-- RPC nueva y archivar `avistamientos`. Queda anotado en MEMORY.md.
-- ---------------------------------------------------------------------------

-- Requiere el esquema base ya aplicado.
do $$
begin
  if to_regclass('public.avistamientos') is null then
    raise exception using
      message = 'Falta public.avistamientos.',
      hint = 'Ejecuta supabase/schema.sql antes de esta migración.';
  end if;
end $$;

-- 1) Backfill histórico -----------------------------------------------------
insert into public.reportes (
  origen_id,
  tipo,
  pokemon_id,
  pokemon_nombre,
  pokemon_tipos,
  latitud,
  longitud,
  h3_index,
  texto,
  autor_nombre,
  creado_en
)
select
  a.id,
  case when a.es_nido then 'nido' else 'salvaje' end,
  a.pokemon_id,
  a.pokemon_name,
  case
    when a.pokemon_type is null or a.pokemon_type = '' then null
    else array[a.pokemon_type]
  end,
  a.latitud,
  a.longitud,
  a.h3_index,
  a.descripcion,
  a.reportado_por,
  a.creado_en
from public.avistamientos a
on conflict (origen_id) do nothing;

-- 2) Trigger espejo ---------------------------------------------------------
create or replace function public.fn_espejo_avistamiento_a_reporte()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.reportes (
    origen_id,
    tipo,
    pokemon_id,
    pokemon_nombre,
    pokemon_tipos,
    latitud,
    longitud,
    h3_index,
    texto,
    autor_nombre,
    creado_en
  )
  values (
    new.id,
    case when new.es_nido then 'nido' else 'salvaje' end,
    new.pokemon_id,
    new.pokemon_name,
    case
      when new.pokemon_type is null or new.pokemon_type = '' then null
      else array[new.pokemon_type]
    end,
    new.latitud,
    new.longitud,
    new.h3_index,
    new.descripcion,
    new.reportado_por,
    new.creado_en
  )
  on conflict (origen_id) do nothing;

  return new;
end;
$$;

comment on function public.fn_espejo_avistamiento_a_reporte() is
  'Refleja un avistamiento nuevo en reportes. Temporal: se elimina al migrar el frontend.';

drop trigger if exists trg_espejo_avistamiento_a_reporte on public.avistamientos;
create trigger trg_espejo_avistamiento_a_reporte
  after insert on public.avistamientos
  for each row execute function public.fn_espejo_avistamiento_a_reporte();

-- 3) La RPC `listar_avistamientos_recientes` permanece intacta --------------
-- Sigue apuntando a `public.avistamientos`, que es la tabla viva para el
-- frontend actual. No se redefine en esta migración a propósito.
comment on function public.listar_avistamientos_recientes(int, text, boolean) is
  'Compatibilidad temporal con el frontend previo a reportes. No modificar hasta migrar la app.';
