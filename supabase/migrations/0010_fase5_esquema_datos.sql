-- ---------------------------------------------------------------------------
-- 0010 · Fase 5A: esquema aditivo y datos de terreno
-- ---------------------------------------------------------------------------
-- Esta migración NO normaliza pokemon_id, NO crea la FK a pokemon_catalogo y
-- NO toca el trigger espejo avistamientos -> reportes. Eso es 0011 (Fase 5B).
--
-- Añade:
--   1. celdas_h3: una fila por celda H3, con centro geography y polígono.
--   2. terreno_poligonos: polígonos/franjas OSM por terreno, sin lectura
--      pública. Datos © OpenStreetMap contributors, ODbL 1.0.
--   3. FK celdas_habitat -> celdas_h3.
--   4. Claves nuevas de config_probabilidad.
--   5. Índice reportes(expira_en).
--   6. fn_normalizar_terreno_poligono (trigger).
--   7. fn_recalcular_celdas_habitat (invoker, solo service_role).
--   8. fn_vaciar_terreno_poligonos (definer, solo service_role).
--
-- TOLERANCIA DE SIMPLIFICACIÓN:
--   - Polígonos: ST_SimplifyPreserveTopology(geom, 0.0001) ≈ 11 m.
--   - Líneas de río/quebrada: se simplifica la LÍNEA con 0.00001 ≈ 1,1 m y
--     después se bufferiza. No se aplica 0.0001 a la franja: con 11 m se
--     borrarían quebradas de 6-12 m. Es una excepción deliberada y aprobada.
--
-- URBANO:
--   `urbano` NO se consulta en OSM. fn_recalcular_celdas_habitat lo calcula
--   como 100 - suma explícita. Esto garantiza suma <= 100, pero sobreestima
--   lo urbano en zonas rurales sin clasificar. Aceptado para esta pasada.
--
-- CERRO:
--   Sin cobertura inicial: OSM no ofrece pendiente poligonal fiable. Sus
--   pesos de afinidad se cargan igual; requiere elevación/DEM en otra fase.
-- ---------------------------------------------------------------------------

set search_path = public, extensions;

-- 1) Celdas H3 ---------------------------------------------------------------
create table if not exists public.celdas_h3 (
  h3_index       text primary key,
  resolucion     smallint not null default 9,
  latitud        double precision not null,
  longitud       double precision not null,
  centro         geography(Point, 4326) generated always as (
                   ST_SetSRID(ST_MakePoint(longitud, latitud), 4326)::geography
                 ) stored,
  geom           geometry(MultiPolygon, 4326) not null,
  actualizado_en timestamptz not null default now(),
  constraint celdas_h3_resolucion_valida check (resolucion between 0 and 15),
  constraint celdas_h3_latitud_valida check (latitud between -90 and 90),
  constraint celdas_h3_longitud_valida check (longitud between -180 and 180)
);

comment on table public.celdas_h3 is
  'Una fila por celda H3. Centro generado desde lat/lon y geometría de la celda en EPSG:4326.';
comment on column public.celdas_h3.centro is
  'Geography generada en EPSG:4326 para distancias en metros e índice GiST.';
comment on column public.celdas_h3.geom is
  'Polígono de la celda H3 en EPSG:4326. Lo genera scripts/cargar-celdas.mjs.';

create index if not exists celdas_h3_centro_gix
  on public.celdas_h3 using gist (centro);
create index if not exists celdas_h3_geom_gix
  on public.celdas_h3 using gist (geom);

drop trigger if exists trg_celdas_h3_actualizado on public.celdas_h3;
create trigger trg_celdas_h3_actualizado
  before update on public.celdas_h3
  for each row execute function public.fn_set_actualizado_en();

alter table public.celdas_h3 enable row level security;

drop policy if exists "celdas_h3 lectura publica" on public.celdas_h3;
create policy "celdas_h3 lectura publica"
  on public.celdas_h3 for select using (true);

revoke all on public.celdas_h3 from public, anon, authenticated;
grant select on public.celdas_h3 to anon, authenticated;
grant select, insert, update, delete on public.celdas_h3 to service_role;

-- 2) Polígonos de terreno ----------------------------------------------------
create table if not exists public.terreno_poligonos (
  osm_tipo         text not null,
  osm_id           bigint not null,
  terreno          text not null references public.terrenos(id) on delete restrict,
  nombre           text,
  geom             geometry(Geometry, 4326) not null,
  ancho_m          numeric,
  actualizado_en   timestamptz not null default now(),
  primary key (osm_tipo, osm_id),
  constraint terreno_poligonos_osm_tipo_valido
    check (osm_tipo in ('way', 'relation')),
  constraint terreno_poligonos_ancho_valido
    check (ancho_m is null or (ancho_m > 0 and ancho_m <= 500)),
  constraint terreno_poligonos_geom_poligonal
    check (ST_GeometryType(geom) in ('ST_Polygon', 'ST_MultiPolygon'))
);

comment on table public.terreno_poligonos is
  'Polígonos y franjas de agua derivados de OpenStreetMap. Datos © OpenStreetMap contributors, ODbL 1.0. Sin lectura pública.';
comment on column public.terreno_poligonos.geom is
  'Entrada Geometry(4326); el trigger la convierte a MultiPolygon. Polígonos: simplify 0.0001 (~11 m). Líneas: simplify 0.00001 y buffer.';
comment on column public.terreno_poligonos.ancho_m is
  'Ancho total en metros para líneas de agua. NULL en polígonos.';
comment on column public.terreno_poligonos.terreno is
  'Uno de los 7 valores de public.terrenos. Urbano no se almacena: es remanente.';

create index if not exists terreno_poligonos_geom_gix
  on public.terreno_poligonos using gist (geom);
create index if not exists terreno_poligonos_terreno_idx
  on public.terreno_poligonos (terreno);

drop trigger if exists trg_terreno_poligonos_actualizado on public.terreno_poligonos;
create trigger trg_terreno_poligonos_actualizado
  before update on public.terreno_poligonos
  for each row execute function public.fn_set_actualizado_en();

alter table public.terreno_poligonos enable row level security;

revoke all on public.terreno_poligonos from public, anon, authenticated;
grant select, insert, update, delete on public.terreno_poligonos to service_role;

-- 3) FK de celdas_habitat ----------------------------------------------------
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'celdas_habitat_h3_fk'
      and conrelid = 'public.celdas_habitat'::regclass
  ) then
    alter table public.celdas_habitat
      add constraint celdas_habitat_h3_fk
      foreign key (h3_index)
      references public.celdas_h3(h3_index)
      on delete cascade;
  end if;
end $$;

comment on constraint celdas_habitat_h3_fk on public.celdas_habitat is
  'Integridad de la composición: toda celda debe existir en celdas_h3.';

-- 4) Configuración nueva -----------------------------------------------------
insert into public.config_probabilidad (clave, valor, descripcion) values
  ('h3_resolucion',            9,    'Resolución H3 usada por la malla y el frontend.'),
  ('radio_busqueda_m',         1000, 'Radio inicial de búsqueda de Pokémon cercanos, en metros.'),
  ('radio_maximo_m',           2000, 'Radio máximo permitido para una búsqueda, en metros.'),
  ('max_celdas_probables',     200,  'Máximo de celdas H3 que evalúa pokemon_cercanos.'),
  ('max_resultados_pokemon',   30,   'Máximo de resultados devueltos por pokemon_cercanos.'),
  ('umbral_probable_alto',     1.2,  'Umbral inicial de probabilidad alta. Conjetura hasta calibrar.'),
  ('umbral_probable_medio',    0.35, 'Umbral inicial de probabilidad media. Conjetura hasta calibrar.'),
  ('min_celdas_con_datos',     2,    'Celdas con datos de hábitat necesarias para estimar.'),
  ('min_usuarios_nivel_medio', 2,    'Usuarios distintos necesarios para nivel reportado medio.'),
  ('peso_verificado_en_sitio', 0.5,  'Refuerzo por un reporte verificado en sitio.'),
  ('peso_ya_no_esta',          1.0,  'Penalización por una confirmación ya_no_esta.')
on conflict (clave) do nothing;

-- 5) Índice de expiración ----------------------------------------------------
create index if not exists reportes_expira_en_idx
  on public.reportes (expira_en);

-- 6) Normalización de terreno_poligonos --------------------------------------
create or replace function public.fn_normalizar_terreno_poligono()
returns trigger
language plpgsql
security invoker
set search_path = public, extensions
as $fn$
declare
  v_geom  geometry;
  v_tipo  text;
  v_ancho numeric;
begin
  if new.geom is null then
    raise exception using
      errcode = 'P0001',
      message = 'terreno_poligonos.geom no puede ser NULL.';
  end if;

  v_geom := ST_MakeValid(new.geom);

  -- Algunos polígonos OSM inválidos producen GeometryCollection tras MakeValid.
  -- Rescatamos la parte poligonal; si no queda, se intenta la parte lineal para agua.
  if ST_GeometryType(v_geom) = 'ST_GeometryCollection' then
    v_geom := ST_CollectionExtract(v_geom, 3);
    if ST_IsEmpty(v_geom) and new.terreno = 'agua' then
      v_geom := ST_CollectionExtract(ST_MakeValid(new.geom), 2);
    end if;
  end if;

  v_tipo := ST_GeometryType(v_geom);

  if v_tipo in ('ST_LineString', 'ST_MultiLineString') then
    if new.terreno <> 'agua' then
      raise exception using
        errcode = 'P0001',
        message = format('Solo agua puede ser línea en terreno_poligonos; recibido: %s.', new.terreno);
    end if;

    v_ancho := coalesce(new.ancho_m, 10);
    if v_ancho <= 0 or v_ancho > 500 then
      raise exception using
        errcode = 'P0001',
        message = format('ancho_m inválido para línea de agua: %s', v_ancho);
    end if;

    -- Excepción aprobada: 0.00001 (~1,1 m) en la línea antes de bufferizar.
    -- Aplicar 0.0001 (~11 m) a la franja borraría quebradas estrechas.
    v_geom := ST_SimplifyPreserveTopology(v_geom, 0.00001);
    v_geom := ST_Buffer(v_geom::geography, v_ancho / 2.0)::geometry;
    new.ancho_m := v_ancho;
  elsif v_tipo in ('ST_Polygon', 'ST_MultiPolygon') then
    v_geom := ST_SimplifyPreserveTopology(v_geom, 0.0001);
    new.ancho_m := null;
  else
    raise exception using
      errcode = 'P0001',
      message = format('Geometría no soportada en terreno_poligonos: %s', v_tipo);
  end if;

  v_geom := ST_Multi(ST_CollectionExtract(ST_MakeValid(v_geom), 3));

  if v_geom is null or ST_IsEmpty(v_geom) then
    raise exception using
      errcode = 'P0001',
      message = 'La geometría quedó vacía después de normalizar.';
  end if;

  new.geom := v_geom;
  return new;
end;
$fn$;

comment on function public.fn_normalizar_terreno_poligono() is
  'Trigger: MakeValid, buffer de líneas de agua y simplify. Polígonos 0.0001; líneas 0.00001 antes del buffer. Interno.';

revoke execute on function public.fn_normalizar_terreno_poligono()
  from public, anon, authenticated;

drop trigger if exists trg_terreno_poligonos_normalizar on public.terreno_poligonos;
create trigger trg_terreno_poligonos_normalizar
  before insert or update of geom, ancho_m on public.terreno_poligonos
  for each row execute function public.fn_normalizar_terreno_poligono();

-- 7) Recálculo de composición por tile ---------------------------------------
create or replace function public.fn_recalcular_celdas_habitat(
  p_min_lon double precision,
  p_min_lat double precision,
  p_max_lon double precision,
  p_max_lat double precision
)
returns jsonb
language plpgsql
security invoker
set search_path = public, extensions
as $fn$
declare
  v_bbox          geometry;
  v_bbox_ampliado geometry;
  v_terreno       text;
  v_prioridad     text[] := array['agua', 'cementerio', 'industrial', 'parque', 'bosque', 'cerro'];
  v_geom_terreno  geometry;
  v_geom_efectiva geometry;
  v_acumulado     geometry := ST_GeomFromText('MULTIPOLYGON EMPTY', 4326);
  v_celdas        integer;
  v_filas         integer := 0;
  v_filas_tile    integer;
  v_mal           integer;
begin
  if p_min_lon is null or p_min_lat is null or p_max_lon is null or p_max_lat is null then
    raise exception using
      errcode = 'P0001',
      message = 'El bbox no puede tener nulos.';
  end if;
  if p_min_lon >= p_max_lon or p_min_lat >= p_max_lat then
    raise exception using
      errcode = 'P0001',
      message = 'Bbox inválido: se espera min < max.';
  end if;
  if p_min_lon < -180 or p_max_lon > 180 or p_min_lat < -90 or p_max_lat > 90 then
    raise exception using
      errcode = 'P0001',
      message = 'Bbox fuera del rango EPSG:4326.';
  end if;

  v_bbox := ST_MakeEnvelope(p_min_lon, p_min_lat, p_max_lon, p_max_lat, 4326);
  v_bbox_ampliado := ST_Expand(v_bbox, 0.02);

  select count(*) into v_celdas
  from public.celdas_h3 c
  where c.longitud between p_min_lon and p_max_lon
    and c.latitud between p_min_lat and p_max_lat;

  delete from public.celdas_habitat ch
  using public.celdas_h3 c
  where ch.h3_index = c.h3_index
    and c.longitud between p_min_lon and p_max_lon
    and c.latitud between p_min_lat and p_max_lat;

  foreach v_terreno in array v_prioridad loop
    select ST_Intersection(ST_Union(t.geom), v_bbox_ampliado)
    into v_geom_terreno
    from public.terreno_poligonos t
    where t.terreno = v_terreno
      and ST_Intersects(t.geom, v_bbox_ampliado);

    if v_geom_terreno is null or ST_IsEmpty(v_geom_terreno) then
      continue;
    end if;

    v_geom_efectiva := ST_Difference(v_geom_terreno, v_acumulado);
    if v_geom_efectiva is null or ST_IsEmpty(v_geom_efectiva) then
      continue;
    end if;

    v_acumulado := ST_Union(v_acumulado, v_geom_efectiva);

    insert into public.celdas_habitat (h3_index, terreno, porcentaje)
    select
      s.h3_index,
      v_terreno,
      trunc(s.porcentaje::numeric, 2)
    from (
      select
        c.h3_index,
        (
          ST_Area(ST_CollectionExtract(ST_Intersection(c.geom, v_geom_efectiva), 3)::geography)
          / nullif(ST_Area(c.geom::geography), 0)
          * 100
        ) as porcentaje
      from public.celdas_h3 c
      where c.longitud between p_min_lon and p_max_lon
        and c.latitud between p_min_lat and p_max_lat
        and ST_Intersects(c.geom, v_geom_efectiva)
    ) s
    where s.porcentaje >= 0.5
    on conflict (h3_index, terreno) do update
      set porcentaje = excluded.porcentaje,
          actualizado_en = now();

    get diagnostics v_filas_tile = row_count;
    v_filas := v_filas + v_filas_tile;
  end loop;

  -- Urbano = remanente. Se calcula con los porcentajes ya truncados, así la
  -- suma por celda nunca supera 100. Si el remanente es < 0.5 no se inserta.
  insert into public.celdas_habitat (h3_index, terreno, porcentaje)
  select
    c.h3_index,
    'urbano',
    greatest(0, round(100 - coalesce(sum(ch.porcentaje), 0), 2))
  from public.celdas_h3 c
  left join public.celdas_habitat ch on ch.h3_index = c.h3_index
  where c.longitud between p_min_lon and p_max_lon
    and c.latitud between p_min_lat and p_max_lat
  group by c.h3_index
  having 100 - coalesce(sum(ch.porcentaje), 0) >= 0.5
  on conflict (h3_index, terreno) do update
    set porcentaje = excluded.porcentaje,
        actualizado_en = now();

  get diagnostics v_filas_tile = row_count;
  v_filas := v_filas + v_filas_tile;

  select count(*) into v_mal
  from (
    select ch.h3_index
    from public.celdas_habitat ch
    join public.celdas_h3 c on c.h3_index = ch.h3_index
    where c.longitud between p_min_lon and p_max_lon
      and c.latitud between p_min_lat and p_max_lat
    group by ch.h3_index
    having sum(ch.porcentaje) > 100.001
  ) s;

  if v_mal > 0 then
    raise exception using
      errcode = 'P0001',
      message = format('Hay %s celdas con suma de porcentajes > 100 en el tile.', v_mal);
  end if;

  return jsonb_build_object(
    'min_lon', p_min_lon,
    'min_lat', p_min_lat,
    'max_lon', p_max_lon,
    'max_lat', p_max_lat,
    'celdas', v_celdas,
    'filas', v_filas
  );
end;
$fn$;

comment on function public.fn_recalcular_celdas_habitat(double precision, double precision, double precision, double precision) is
  'Calcula la composición de terreno de las celdas H3 de un tile. Prioridad agua>cementerio>industrial>parque>bosque>cerro; urbano es remanente. Solo service_role.';

revoke execute on function public.fn_recalcular_celdas_habitat(double precision, double precision, double precision, double precision)
  from public, anon, authenticated;
grant execute on function public.fn_recalcular_celdas_habitat(double precision, double precision, double precision, double precision)
  to service_role;

-- 8) Vaciar polígonos --------------------------------------------------------
create or replace function public.fn_vaciar_terreno_poligonos()
returns void
language plpgsql
security definer
set search_path = public
as $fn$
begin
  truncate table public.terreno_poligonos;
end;
$fn$;

comment on function public.fn_vaciar_terreno_poligonos() is
  'Vacía terreno_poligonos. Destructivo: solo después de recalcular y comprobar cobertura. Solo service_role.';

revoke execute on function public.fn_vaciar_terreno_poligonos()
  from public, anon, authenticated;
grant execute on function public.fn_vaciar_terreno_poligonos()
  to service_role;

-- 9) Permisos de escritura para los scripts locales --------------------------
grant select, insert, update, delete on public.celdas_habitat   to service_role;
grant select, insert, update, delete on public.afinidad_terreno to service_role;
grant select, insert, update, delete on public.terrenos         to service_role;
grant select, insert, update, delete on public.config_probabilidad to service_role;
grant select, insert, update, delete on public.reportes          to service_role;
grant select, insert, update, delete on public.avistamientos     to service_role;
grant select on public.pokemon_tipos to service_role;

notify pgrst, 'reload schema';
