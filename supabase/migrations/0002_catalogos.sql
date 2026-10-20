-- ---------------------------------------------------------------------------
-- 0002 · Catálogos base: tipos de Pokémon, catálogo y perfiles
-- ---------------------------------------------------------------------------
-- `pokemon_tipos` es la única fuente de verdad del vocabulario de tipos. Sus ids
-- coinciden EXACTAMENTE con `POKEMON_TIPOS` de src/config/constants.js, de modo
-- que el frontend y las afinidades de terreno hablan el mismo idioma.
-- ---------------------------------------------------------------------------

-- 1) Tipos de Pokémon -------------------------------------------------------
create table if not exists public.pokemon_tipos (
  id    text primary key,
  label text not null
);

insert into public.pokemon_tipos (id, label) values
  ('agua',      'Agua'),
  ('fuego',     'Fuego'),
  ('planta',    'Planta'),
  ('electrico', 'Eléctrico'),
  ('normal',    'Normal'),
  ('veneno',    'Veneno'),
  ('psiquico',  'Psíquico'),
  ('roca',      'Roca'),
  ('tierra',    'Tierra'),
  ('volador',   'Volador'),
  ('hielo',     'Hielo'),
  ('dragon',    'Dragón'),
  ('fantasma',  'Fantasma'),
  ('lucha',     'Lucha'),
  ('siniestro', 'Siniestro'),
  ('acero',     'Acero'),
  ('hada',      'Hada'),
  ('bicho',     'Bicho')
on conflict (id) do update set label = excluded.label;

-- 2) Catálogo de Pokémon ----------------------------------------------------
-- `tipos` es text[] porque hay Pokémon de doble tipo (p. ej. Charizard:
-- fuego/volador). `id` es el número de la Pokédex nacional.
create table if not exists public.pokemon_catalogo (
  id            integer primary key,
  nombre        text not null,
  tipos         text[] not null default '{}',
  es_legendario boolean not null default false,
  sprite        text,
  creado_en     timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  constraint pokemon_catalogo_tipos_no_vacio check (array_length(tipos, 1) >= 1)
);

comment on table  public.pokemon_catalogo is
  'Pokédex. Se siembra desde PokeAPI con scripts/seed-catalogo.mjs.';
comment on column public.pokemon_catalogo.tipos is
  'Uno o dos ids de public.pokemon_tipos.';
comment on column public.pokemon_catalogo.es_legendario is
  'Incluye legendarios y míticos (is_legendary OR is_mythical).';

-- Valida que cada elemento de `tipos` exista en pokemon_tipos. Un CHECK no
-- puede consultar otra tabla, así que la integridad se resuelve con trigger.
create or replace function public.fn_validar_tipos_pokemon()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  tipo_desconocido text;
begin
  select t into tipo_desconocido
  from unnest(new.tipos) as t
  where not exists (select 1 from public.pokemon_tipos pt where pt.id = t)
  limit 1;

  if tipo_desconocido is not null then
    raise exception using
      errcode = 'P0001',
      message = format('Tipo de Pokémon desconocido: %s', tipo_desconocido),
      hint = 'Añade el tipo a public.pokemon_tipos o corrige el catálogo.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_pokemon_catalogo_validar_tipos on public.pokemon_catalogo;
create trigger trg_pokemon_catalogo_validar_tipos
  before insert or update of tipos on public.pokemon_catalogo
  for each row execute function public.fn_validar_tipos_pokemon();

drop trigger if exists trg_pokemon_catalogo_actualizado on public.pokemon_catalogo;
create trigger trg_pokemon_catalogo_actualizado
  before update on public.pokemon_catalogo
  for each row execute function public.fn_set_actualizado_en();

-- 3) Perfiles ---------------------------------------------------------------
-- 1:1 con auth.users. El id es el mismo uuid del usuario.
create table if not exists public.perfiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  nombre        text,
  avatar        text,
  creado_en     timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

comment on column public.perfiles.avatar is
  'URL o ruta en Storage del avatar.';

drop trigger if exists trg_perfiles_actualizado on public.perfiles;
create trigger trg_perfiles_actualizado
  before update on public.perfiles
  for each row execute function public.fn_set_actualizado_en();

-- Crea el perfil automáticamente al registrarse un usuario.
create or replace function public.fn_handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.perfiles (id, nombre, avatar)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data ->> 'nombre',
      new.raw_user_meta_data ->> 'full_name',
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      'Entrenador'
    ),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.fn_handle_new_user();

-- 4) Seguridad a nivel de fila ---------------------------------------------
alter table public.pokemon_tipos    enable row level security;
alter table public.pokemon_catalogo enable row level security;
alter table public.perfiles         enable row level security;

-- Catálogos: lectura pública, escritura solo service_role (sin políticas de
-- escritura para anon/authenticated; service_role ignora RLS por diseño).
drop policy if exists "pokemon_tipos lectura publica" on public.pokemon_tipos;
create policy "pokemon_tipos lectura publica"
  on public.pokemon_tipos for select using (true);

drop policy if exists "pokemon_catalogo lectura publica" on public.pokemon_catalogo;
create policy "pokemon_catalogo lectura publica"
  on public.pokemon_catalogo for select using (true);

drop policy if exists "perfiles lectura publica" on public.perfiles;
create policy "perfiles lectura publica"
  on public.perfiles for select using (true);

drop policy if exists "perfiles insercion propia" on public.perfiles;
create policy "perfiles insercion propia"
  on public.perfiles for insert
  with check (auth.uid() = id);

drop policy if exists "perfiles actualizacion propia" on public.perfiles;
create policy "perfiles actualizacion propia"
  on public.perfiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- 5) Permisos de tabla (PostgREST exige privilegio + política) -------------
grant select on public.pokemon_tipos, public.pokemon_catalogo to anon, authenticated;
grant select on public.perfiles to anon, authenticated;
grant insert, update on public.perfiles to authenticated;

-- 6) Realtime ---------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'perfiles'
  ) then
    alter publication supabase_realtime add table public.perfiles;
  end if;
exception when undefined_object then
  null; -- La publicación no existe en este entorno.
end $$;
