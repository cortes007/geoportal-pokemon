-- ---------------------------------------------------------------------------
-- 0010 · Verificación de datos de la Fase 5A
-- ---------------------------------------------------------------------------
-- EJECUTAR EN EL SQL EDITOR DE SUPABASE, después de cargar:
--   1) afinidad_terreno
--   2) terreno_poligonos
--   3) celdas_h3 + celdas_habitat
--
-- Todo ocurre en una transacción de lectura y termina con ROLLBACK.
-- No modifica datos.
--
-- Nota: si se ejecutó --vaciar-terrenos, este test fallará a propósito:
-- terreno_poligonos debe tener datos para validar la cobertura.
-- ---------------------------------------------------------------------------

begin;

select current_user, session_user;

create temporary table resultados_datos_0010 (
  caso      text primary key,
  resultado text not null check (resultado in ('ok', 'falló')),
  detalle   text
) on commit drop;

-- 1) Afinidad completa -------------------------------------------------------
do $$
declare
  v_total bigint;
  v_terrenos bigint;
  v_tipos bigint;
  v_negativos bigint;
  v_nulos bigint;
  v_combinaciones bigint;
  v_detalle text;
begin
  select
    count(*),
    count(distinct terreno),
    count(distinct pokemon_tipo),
    count(*) filter (where peso < 0),
    count(*) filter (where peso is null)
  into v_total, v_terrenos, v_tipos, v_negativos, v_nulos
  from public.afinidad_terreno;

  select count(*) into v_combinaciones
  from (
    select t.id as terreno, p.id as pokemon_tipo
    from public.terrenos t
    cross join public.pokemon_tipos p
  ) esperadas
  join public.afinidad_terreno a
    on a.terreno = esperadas.terreno
   and a.pokemon_tipo = esperadas.pokemon_tipo;

  v_detalle := format(
    'filas=%s/126; terrenos=%s/7; tipos=%s/18; combinaciones=%s/126; negativos=%s; nulos=%s',
    v_total, v_terrenos, v_tipos, v_combinaciones, v_negativos, v_nulos
  );

  insert into resultados_datos_0010 (caso, resultado, detalle)
  values (
    'afinidad_126',
    case
      when v_total = 126 and v_terrenos = 7 and v_tipos = 18
       and v_combinaciones = 126 and v_negativos = 0 and v_nulos = 0
      then 'ok' else 'falló'
    end,
    v_detalle
  )
  on conflict (caso) do update
    set resultado = excluded.resultado, detalle = excluded.detalle;
exception when others then
  insert into resultados_datos_0010 (caso, resultado, detalle)
  values ('afinidad_126', 'falló', sqlerrm)
  on conflict (caso) do update
    set resultado = excluded.resultado, detalle = excluded.detalle;
end $$;

-- 2) Conteos mínimos ---------------------------------------------------------
do $$
declare
  v_celdas bigint;
  v_terrenos bigint;
  v_habitat bigint;
  v_detalle text;
begin
  select count(*) into v_celdas from public.celdas_h3;
  select count(*) into v_terrenos from public.terreno_poligonos;
  select count(*) into v_habitat from public.celdas_habitat;

  v_detalle := format('celdas_h3=%s; terreno_poligonos=%s; celdas_habitat=%s',
                      v_celdas, v_terrenos, v_habitat);

  insert into resultados_datos_0010 (caso, resultado, detalle)
  values (
    'conteos_minimos',
    case when v_celdas > 0 and v_terrenos > 0 and v_habitat > 0 then 'ok' else 'falló' end,
    v_detalle
  )
  on conflict (caso) do update
    set resultado = excluded.resultado, detalle = excluded.detalle;
exception when others then
  insert into resultados_datos_0010 (caso, resultado, detalle)
  values ('conteos_minimos', 'falló', sqlerrm)
  on conflict (caso) do update
    set resultado = excluded.resultado, detalle = excluded.detalle;
end $$;

-- 3) Porcentajes y sumas -----------------------------------------------------
do $$
declare
  v_fuera bigint;
  v_suma_mal bigint;
  v_max_suma numeric;
  v_min_suma numeric;
  v_min_pct numeric;
  v_max_pct numeric;
  v_detalle text;
begin
  select count(*) into v_fuera
  from public.celdas_habitat
  where porcentaje < 0 or porcentaje > 100;

  select
    count(*) filter (where suma > 100.001),
    max(suma),
    min(suma)
  into v_suma_mal, v_max_suma, v_min_suma
  from (
    select h3_index, sum(porcentaje) as suma
    from public.celdas_habitat
    group by h3_index
  ) s;

  select max(porcentaje), min(porcentaje)
  into v_max_pct, v_min_pct
  from public.celdas_habitat;

  v_detalle := format(
    'fuera_de_rango=%s; celdas_con_suma>100=%s; suma_min=%s; suma_max=%s; pct_min=%s; pct_max=%s',
    v_fuera, v_suma_mal, coalesce(v_min_suma, 0), coalesce(v_max_suma, 0),
    v_min_pct, v_max_pct
  );

  insert into resultados_datos_0010 (caso, resultado, detalle)
  values (
    'porcentajes',
    case when v_fuera = 0 and v_suma_mal = 0 then 'ok' else 'falló' end,
    v_detalle
  )
  on conflict (caso) do update
    set resultado = excluded.resultado, detalle = excluded.detalle;
exception when others then
  insert into resultados_datos_0010 (caso, resultado, detalle)
  values ('porcentajes', 'falló', sqlerrm)
  on conflict (caso) do update
    set resultado = excluded.resultado, detalle = excluded.detalle;
end $$;

-- 4) Huérfanos e integridad referencial --------------------------------------
do $$
declare
  v_sin_celda bigint;
  v_sin_terreno bigint;
  v_celdas_sin_composicion bigint;
  v_detalle text;
begin
  select count(*) into v_sin_celda
  from public.celdas_habitat h
  left join public.celdas_h3 c on c.h3_index = h.h3_index
  where c.h3_index is null;

  select count(*) into v_sin_terreno
  from public.celdas_habitat h
  left join public.terrenos t on t.id = h.terreno
  where t.id is null;

  select count(*) into v_celdas_sin_composicion
  from public.celdas_h3 c
  where not exists (
    select 1 from public.celdas_habitat h where h.h3_index = c.h3_index
  );

  v_detalle := format(
    'habitat_sin_celda=%s; habitat_sin_terreno=%s; celdas_sin_ninguna_fila=%s',
    v_sin_celda, v_sin_terreno, v_celdas_sin_composicion
  );

  insert into resultados_datos_0010 (caso, resultado, detalle)
  values (
    'integridad',
    case when v_sin_celda = 0 and v_sin_terreno = 0 and v_celdas_sin_composicion = 0
         then 'ok' else 'falló' end,
    v_detalle
  )
  on conflict (caso) do update
    set resultado = excluded.resultado, detalle = excluded.detalle;
exception when others then
  insert into resultados_datos_0010 (caso, resultado, detalle)
  values ('integridad', 'falló', sqlerrm)
  on conflict (caso) do update
    set resultado = excluded.resultado, detalle = excluded.detalle;
end $$;

-- 5) Geometrías --------------------------------------------------------------
do $$
declare
  v_mal_terreno bigint;
  v_mal_celda bigint;
  v_detalle text;
begin
  select count(*) into v_mal_terreno
  from public.terreno_poligonos
  where geom is null
     or ST_IsEmpty(geom)
     or ST_IsValid(geom) is not true
     or ST_SRID(geom) <> 4326
     or ST_GeometryType(geom) <> 'ST_MultiPolygon';

  select count(*) into v_mal_celda
  from public.celdas_h3
  where geom is null
     or centro is null
     or ST_IsEmpty(geom)
     or ST_IsValid(geom) is not true
     or ST_SRID(geom) <> 4326
     or ST_GeometryType(geom) <> 'ST_MultiPolygon';

  v_detalle := format('terreno_poligonos_invalidos=%s; celdas_h3_invalidas=%s',
                      v_mal_terreno, v_mal_celda);

  insert into resultados_datos_0010 (caso, resultado, detalle)
  values (
    'geometrias',
    case when v_mal_terreno = 0 and v_mal_celda = 0 then 'ok' else 'falló' end,
    v_detalle
  )
  on conflict (caso) do update
    set resultado = excluded.resultado, detalle = excluded.detalle;
exception when others then
  insert into resultados_datos_0010 (caso, resultado, detalle)
  values ('geometrias', 'falló', sqlerrm)
  on conflict (caso) do update
    set resultado = excluded.resultado, detalle = excluded.detalle;
end $$;

-- 6) Histograma urbano y celdas sin filas ------------------------------------
do $$
declare
  v_total bigint;
  v_b0_25 bigint;
  v_b25_50 bigint;
  v_b50_90 bigint;
  v_b90 bigint;
  v_sin_filas bigint;
  v_suma_buckets bigint;
  v_detalle text;
begin
  select count(*) into v_total from public.celdas_h3;

  with urbano as (
    select h3_index, sum(porcentaje) as porcentaje
    from public.celdas_habitat
    where terreno = 'urbano'
    group by h3_index
  ), valores as (
    select coalesce(u.porcentaje, 0) as porcentaje
    from public.celdas_h3 c
    left join urbano u on u.h3_index = c.h3_index
  )
  select
    count(*) filter (where porcentaje <= 25),
    count(*) filter (where porcentaje > 25 and porcentaje <= 50),
    count(*) filter (where porcentaje > 50 and porcentaje <= 90),
    count(*) filter (where porcentaje > 90)
  into v_b0_25, v_b25_50, v_b50_90, v_b90
  from valores;

  select count(*) into v_sin_filas
  from public.celdas_h3 c
  where not exists (
    select 1 from public.celdas_habitat h where h.h3_index = c.h3_index
  );

  v_suma_buckets := v_b0_25 + v_b25_50 + v_b50_90 + v_b90;
  v_detalle := format(
    'urbano 0-25=%s; 25-50=%s; 50-90=%s; >90=%s; celdas_sin_ninguna_fila=%s; total=%s',
    v_b0_25, v_b25_50, v_b50_90, v_b90, v_sin_filas, v_total
  );

  insert into resultados_datos_0010 (caso, resultado, detalle)
  values (
    'histograma_urbano_y_sin_filas',
    case when v_suma_buckets = v_total and v_sin_filas = 0 then 'ok' else 'falló' end,
    v_detalle
  )
  on conflict (caso) do update
    set resultado = excluded.resultado, detalle = excluded.detalle;
exception when others then
  insert into resultados_datos_0010 (caso, resultado, detalle)
  values ('histograma_urbano_y_sin_filas', 'falló', sqlerrm)
  on conflict (caso) do update
    set resultado = excluded.resultado, detalle = excluded.detalle;
end $$;

-- 7) Cobertura ---------------------------------------------------------------
do $$
declare
  v_total bigint;
  v_con_datos bigint;
  v_pct numeric;
  v_detalle text;
begin
  select count(*) into v_total from public.celdas_h3;
  select count(distinct h3_index) into v_con_datos from public.celdas_habitat;

  v_pct := case when v_total = 0 then 0
                else round(100.0 * v_con_datos / v_total, 2) end;
  v_detalle := format('celdas_con_datos=%s; total=%s; cobertura=%s%%',
                      v_con_datos, v_total, v_pct);

  insert into resultados_datos_0010 (caso, resultado, detalle)
  values (
    'cobertura',
    case when v_total > 0 and v_con_datos = v_total then 'ok' else 'falló' end,
    v_detalle
  )
  on conflict (caso) do update
    set resultado = excluded.resultado, detalle = excluded.detalle;
exception when others then
  insert into resultados_datos_0010 (caso, resultado, detalle)
  values ('cobertura', 'falló', sqlerrm)
  on conflict (caso) do update
    set resultado = excluded.resultado, detalle = excluded.detalle;
end $$;

-- 8) Parque Lleras: existencia y área razonable ------------------------------
do $$
declare
  v_n bigint;
  v_area double precision;
  v_detalle text;
begin
  select count(*), max(ST_Area(geom::geography))
  into v_n, v_area
  from public.terreno_poligonos
  where nombre ilike '%lleras%';

  if v_n = 0 then
    v_detalle := 'no se encontró ningún polígono con nombre que contenga Lleras';
    insert into resultados_datos_0010 (caso, resultado, detalle)
    values ('parque_lleras', 'falló', v_detalle)
    on conflict (caso) do update
      set resultado = excluded.resultado, detalle = excluded.detalle;
    return;
  end if;

  v_detalle := format('poligonos=%s; area_max=%.1f m2', v_n, v_area);
  insert into resultados_datos_0010 (caso, resultado, detalle)
  values (
    'parque_lleras',
    case when v_area between 500 and 50000 then 'ok' else 'falló' end,
    v_detalle
  )
  on conflict (caso) do update
    set resultado = excluded.resultado, detalle = excluded.detalle;
exception when others then
  insert into resultados_datos_0010 (caso, resultado, detalle)
  values ('parque_lleras', 'falló', sqlerrm)
  on conflict (caso) do update
    set resultado = excluded.resultado, detalle = excluded.detalle;
end $$;

-- 9) Configuración H3 --------------------------------------------------------
do $$
declare
  v_valor numeric;
  v_detalle text;
begin
  select valor into v_valor
  from public.config_probabilidad
  where clave = 'h3_resolucion';

  v_detalle := format('h3_resolucion=%s', v_valor);
  insert into resultados_datos_0010 (caso, resultado, detalle)
  values ('config_h3', case when v_valor = 9 then 'ok' else 'falló' end, v_detalle)
  on conflict (caso) do update
    set resultado = excluded.resultado, detalle = excluded.detalle;
exception when others then
  insert into resultados_datos_0010 (caso, resultado, detalle)
  values ('config_h3', 'falló', sqlerrm)
  on conflict (caso) do update
    set resultado = excluded.resultado, detalle = excluded.detalle;
end $$;

-- 10) Tamaños e información de h3_index históricos --------------------------
do $$
declare
  v_tam_celdas text;
  v_tam_terrenos text;
  v_tam_habitat text;
  v_reportes_null bigint;
  v_avist_null bigint;
begin
  select pg_size_pretty(pg_total_relation_size('public.celdas_h3'::regclass)),
         pg_size_pretty(pg_total_relation_size('public.terreno_poligonos'::regclass)),
         pg_size_pretty(pg_total_relation_size('public.celdas_habitat'::regclass))
  into v_tam_celdas, v_tam_terrenos, v_tam_habitat;

  select count(*) into v_reportes_null from public.reportes where h3_index is null;
  select count(*) into v_avist_null from public.avistamientos where h3_index is null;

  insert into resultados_datos_0010 (caso, resultado, detalle)
  values (
    'tamanos_e_h3_historicos',
    'ok',
    format('celdas_h3=%s; terreno_poligonos=%s; celdas_habitat=%s; reportes_h3_null=%s; avistamientos_h3_null=%s',
           v_tam_celdas, v_tam_terrenos, v_tam_habitat, v_reportes_null, v_avist_null)
  )
  on conflict (caso) do update
    set resultado = excluded.resultado, detalle = excluded.detalle;
exception when others then
  insert into resultados_datos_0010 (caso, resultado, detalle)
  values ('tamanos_e_h3_historicos', 'falló', sqlerrm)
  on conflict (caso) do update
    set resultado = excluded.resultado, detalle = excluded.detalle;
end $$;

select caso, resultado, detalle
from resultados_datos_0010
order by caso;

rollback;
