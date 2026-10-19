-- ---------------------------------------------------------------------------
-- Esquema del Geoportal Pokémon GO (Supabase / PostgreSQL)
-- Ejecutar en el SQL Editor. Coordenadas en EPSG:4326 (WGS84).
-- ---------------------------------------------------------------------------

-- 1) Avistamientos y nidos -------------------------------------------------
create table if not exists public.avistamientos (
  id             uuid primary key default gen_random_uuid(),
  pokemon_id     integer,
  pokemon_name   text not null,
  pokemon_type   text not null,
  latitud        double precision not null,
  longitud       double precision not null,
  es_nido        boolean not null default false,
  h3_index       text,              -- celda H3 (resolución 9) calculada por el cliente
  descripcion    text,
  reportado_por  text,
  creado_en      timestamptz not null default now()
);

create index if not exists avistamientos_creado_en_idx on public.avistamientos (creado_en desc);
create index if not exists avistamientos_type_idx      on public.avistamientos (pokemon_type);
create index if not exists avistamientos_nido_idx      on public.avistamientos (es_nido);
create index if not exists avistamientos_h3_idx        on public.avistamientos (h3_index);

-- 2) Zonas de hábitat (polígonos GeoJSON) ----------------------------------
create table if not exists public.habitats (
  id         uuid primary key default gen_random_uuid(),
  nombre     text not null,
  tipo_area  text not null,          -- bosque | agua | parque | urbano | costero
  geojson    jsonb not null,         -- Feature o geometry en EPSG:4326
  creado_en  timestamptz not null default now()
);

-- 3) Seguridad a nivel de fila --------------------------------------------
alter table public.avistamientos enable row level security;
alter table public.habitats      enable row level security;

drop policy if exists "avistamientos lectura publica" on public.avistamientos;
create policy "avistamientos lectura publica"
  on public.avistamientos for select using (true);

drop policy if exists "avistamientos insercion" on public.avistamientos;
create policy "avistamientos insercion"
  on public.avistamientos for insert with check (true);

drop policy if exists "habitats lectura publica" on public.habitats;
create policy "habitats lectura publica"
  on public.habitats for select using (true);

-- 4) RPC: listar avistamientos recientes -----------------------------------
create or replace function public.listar_avistamientos_recientes(
  limite int default 300,
  tipo text default null,
  solo_nidos boolean default false
)
returns setof public.avistamientos
language sql
stable
security definer
set search_path = public
as $$
  select a.*
  from public.avistamientos a
  where (tipo is null or a.pokemon_type = tipo)
    and (solo_nidos = false or a.es_nido = true)
  order by a.creado_en desc
  limit greatest(coalesce(limite, 300), 1);
$$;

grant execute on function public.listar_avistamientos_recientes(int, text, boolean)
  to anon, authenticated;

-- 5) Realtime --------------------------------------------------------------
alter publication supabase_realtime add table public.avistamientos;

-- 6) Semilla de ejemplo ----------------------------------------------------
insert into public.avistamientos (pokemon_id, pokemon_name, pokemon_type, latitud, longitud, es_nido, descripcion)
values
  (25, 'Pikachu',  'electrico', 4.7110, -74.0721, false, 'Cerca de la plaza principal'),
  (7,  'Squirtle', 'agua',      4.6580, -74.0937, false, 'En la fuente del parque'),
  (1,  'Bulbasaur','planta',    4.6651, -74.1021, true,  'Nido en el Parque Simón Bolívar'),
  (129,'Magikarp', 'agua',      4.7573, -74.1046, false, 'Humedal La Conejera')
on conflict do nothing;

insert into public.habitats (nombre, tipo_area, geojson)
values
  ('Humedal La Conejera', 'agua', jsonb_build_object(
    'type','Polygon','coordinates', jsonb_build_array(jsonb_build_array(
      jsonb_build_array(-74.1046,4.7573), jsonb_build_array(-74.0936,4.7562),
      jsonb_build_array(-74.0898,4.7481), jsonb_build_array(-74.1002,4.7449),
      jsonb_build_array(-74.1071,4.7505), jsonb_build_array(-74.1046,4.7573)
    ))
  ))
on conflict do nothing;
