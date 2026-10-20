-- ---------------------------------------------------------------------------
-- 0004 · Reportes (corazón del modelo)
-- ---------------------------------------------------------------------------
-- Un reporte es salvaje | nido | incursion | comentario. Las reglas de negocio
-- (expiración, verificación en sitio y tope por hora) se aplican en el servidor
-- con triggers; el cliente nunca decide `verificado_en_sitio` ni `expira_en`.
--
-- `latitud` y `longitud` siguen siendo el contrato con el frontend; `ubicacion`
-- es una columna generada geography(Point,4326) para medir en metros y para
-- indexar con GIST.
-- ---------------------------------------------------------------------------

set search_path = public, extensions;

create table if not exists public.reportes (
  id                     uuid primary key default gen_random_uuid(),
  tipo                   text not null,
  pokemon_id             integer,
  pokemon_nombre         text,
  pokemon_tipos          text[],
  latitud                double precision not null,
  longitud               double precision not null,
  ubicacion              geography(Point, 4326) generated always as (
                           ST_SetSRID(ST_MakePoint(longitud, latitud), 4326)::geography
                         ) stored,
  h3_index               text,
  texto                  text,
  autor_id               uuid references auth.users(id) on delete set null,
  autor_nombre           text,
  verificado_en_sitio    boolean not null default false,
  latitud_declarada      double precision,
  longitud_declarada     double precision,
  distancia_declarada_m  double precision,
  expira_en              timestamptz,
  origen_id              uuid unique,
  creado_en              timestamptz not null default now(),
  actualizado_en         timestamptz not null default now(),
  constraint reportes_tipo_valido
    check (tipo in ('salvaje', 'nido', 'incursion', 'comentario')),
  constraint reportes_latitud_valida
    check (latitud between -90 and 90),
  constraint reportes_longitud_valida
    check (longitud between -180 and 180),
  constraint reportes_latitud_declarada_valida
    check (latitud_declarada is null or latitud_declarada between -90 and 90),
  constraint reportes_longitud_declarada_valida
    check (longitud_declarada is null or longitud_declarada between -180 and 180),
  constraint reportes_comentario_sin_pokemon
    check (tipo <> 'comentario' or pokemon_id is null)
);

comment on table public.reportes is
  'Reportes colaborativos. `verificado_en_sitio` y `expira_en` los calcula el servidor.';
comment on column public.reportes.ubicacion is
  'Geography generada desde latitud/longitud. Distancias en metros.';
comment on column public.reportes.origen_id is
  'FK blanda a public.avistamientos.id. Da idempotencia a la migración histórica.';
comment on column public.reportes.verificado_en_sitio is
  'Señal declarada por el cliente y recalculada en servidor: distancia <= radio configurado.';
comment on column public.reportes.distancia_declarada_m is
  'Distancia en metros entre el punto y la ubicación declarada al enviar.';

-- Índices -------------------------------------------------------------------
create index if not exists reportes_creado_en_idx
  on public.reportes (creado_en desc);
create index if not exists reportes_tipo_expira_idx
  on public.reportes (tipo, expira_en);
create index if not exists reportes_pokemon_idx
  on public.reportes (pokemon_id, creado_en desc);
create index if not exists reportes_h3_idx
  on public.reportes (h3_index);
create index if not exists reportes_autor_hora_idx
  on public.reportes (autor_id, creado_en desc);
create index if not exists reportes_ubicacion_gix
  on public.reportes using gist (ubicacion);

-- Normalización: snapshot desde catálogo, expiración y verificación ----------
create or replace function public.fn_reportes_normalizar()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  nombre_catalogo text;
  tipos_catalogo  text[];
  nombre_perfil   text;
  vida_min        numeric;
  radio_m         numeric;
begin
  -- Snapshot desde el catálogo solo si el cliente no lo aportó.
  if new.pokemon_id is not null and (new.pokemon_nombre is null or new.pokemon_tipos is null) then
    select nombre, tipos into nombre_catalogo, tipos_catalogo
    from public.pokemon_catalogo
    where id = new.pokemon_id;

    if new.pokemon_nombre is null then
      new.pokemon_nombre := nombre_catalogo;
    end if;
    if new.pokemon_tipos is null then
      new.pokemon_tipos := tipos_catalogo;
    end if;
  end if;

  if new.autor_nombre is null and new.autor_id is not null then
    select nombre into nombre_perfil from public.perfiles where id = new.autor_id;
    new.autor_nombre := nombre_perfil;
  end if;

  -- Expiración: solo en INSERT o cuando cambia el tipo. Editar no alarga vida.
  if tg_op = 'INSERT' or new.tipo is distinct from old.tipo then
    vida_min := public.fn_config('vida_' || new.tipo || '_min');
    if vida_min is null then
      new.expira_en := null;
    else
      new.expira_en := new.creado_en + make_interval(mins => vida_min::int);
    end if;
  end if;

  -- Verificación en sitio: la decide el servidor a partir de la ubicación
  -- declarada, no el booleano que envíe el cliente.
  if new.latitud_declarada is not null and new.longitud_declarada is not null then
    radio_m := coalesce(public.fn_config('radio_verificacion_m'), 300);
    new.distancia_declarada_m := ST_Distance(
      ST_SetSRID(ST_MakePoint(new.longitud, new.latitud), 4326)::geography,
      ST_SetSRID(ST_MakePoint(new.longitud_declarada, new.latitud_declarada), 4326)::geography
    );
    new.verificado_en_sitio := new.distancia_declarada_m <= radio_m;
  else
    new.distancia_declarada_m := null;
    new.verificado_en_sitio := false;
  end if;

  return new;
end;
$$;

-- Tope de reportes por usuario y hora ---------------------------------------
create or replace function public.fn_reportes_limite_hora()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  tope      numeric;
  recientes integer;
begin
  if new.autor_id is null then
    return new;
  end if;

  tope := public.fn_config('tope_reportes_por_hora');
  if tope is null then
    return new;
  end if;

  select count(*) into recientes
  from public.reportes
  where autor_id = new.autor_id
    and creado_en > now() - interval '1 hour';

  if recientes >= tope then
    raise exception using
      errcode = 'P0001',
      message = format('Límite alcanzado: máximo %s reportes por hora.', tope::int);
  end if;

  return new;
end;
$$;

drop trigger if exists trg_reportes_normalizar on public.reportes;
create trigger trg_reportes_normalizar
  before insert or update on public.reportes
  for each row execute function public.fn_reportes_normalizar();

drop trigger if exists trg_reportes_limite_hora on public.reportes;
create trigger trg_reportes_limite_hora
  before insert on public.reportes
  for each row execute function public.fn_reportes_limite_hora();

drop trigger if exists trg_reportes_actualizado on public.reportes;
create trigger trg_reportes_actualizado
  before update on public.reportes
  for each row execute function public.fn_set_actualizado_en();

-- Vista de vigentes (para la siguiente fase de consultas) -------------------
create or replace view public.reportes_vigentes
with (security_invoker = true) as
select *
from public.reportes
where expira_en is null or expira_en > now();

comment on view public.reportes_vigentes is
  'Reportes no expirados. Respeta RLS del invocador (security_invoker).';

-- Seguridad a nivel de fila -------------------------------------------------
alter table public.reportes enable row level security;

drop policy if exists "reportes lectura publica" on public.reportes;
create policy "reportes lectura publica"
  on public.reportes for select using (true);

drop policy if exists "reportes insercion con sesion" on public.reportes;
create policy "reportes insercion con sesion"
  on public.reportes for insert
  with check (auth.uid() is not null and auth.uid() = autor_id);

drop policy if exists "reportes actualizacion propia" on public.reportes;
create policy "reportes actualizacion propia"
  on public.reportes for update
  using (auth.uid() = autor_id)
  with check (auth.uid() = autor_id);

drop policy if exists "reportes borrado propio" on public.reportes;
create policy "reportes borrado propio"
  on public.reportes for delete
  using (auth.uid() = autor_id);

grant select on public.reportes to anon, authenticated;
grant select on public.reportes_vigentes to anon, authenticated;
grant insert, update, delete on public.reportes to authenticated;

-- Realtime ------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'reportes'
  ) then
    alter publication supabase_realtime add table public.reportes;
  end if;
exception when undefined_object then
  null;
end $$;
