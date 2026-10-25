-- ---------------------------------------------------------------------------
-- 0010 Â· VerificaciÃ³n de esquema de la Fase 5A
-- ---------------------------------------------------------------------------
-- EJECUTAR EN EL SQL EDITOR DE SUPABASE, despuÃ©s de aplicar 0010.
-- Todo ocurre en una transacciÃ³n y termina con ROLLBACK.
--
-- Devuelve una tabla (caso, resultado, detalle). Cada caso estÃ¡ aislado: un
-- fallo no aborta los demÃ¡s.
--
-- Cubre:
--   - columnas, PK, FK, Ã­ndices y claves de configuraciÃ³n;
--   - RLS y grants de tablas;
--   - proconfig/search_path y prosecdef de las funciones nuevas;
--   - permisos con roles simulados (anon, authenticated, service_role);
--   - normalizaciÃ³n de polÃ­gonos y franjas de agua;
--   - solape, prioridad y remanente urbano con una celda de prueba;
--   - fn_vaciar_terreno_poligonos, solo si la tabla estaba vacÃ­a al inicio.
-- ---------------------------------------------------------------------------

begin;

select current_user, session_user;

create temporary table resultados_0010 (
  caso      text primary key,
  resultado text not null check (resultado in ('ok', 'fallÃ³')),
  detalle   text
) on commit drop;

-- Estado inicial: se usa para decidir si se prueba fn_vaciar de verdad.
do $$
declare
  v_filas bigint;
begin
  select count(*) into v_filas from public.terreno_poligonos;
  insert into resultados_0010 (caso, resultado, detalle)
  values ('terreno_poligonos_inicial', 'ok', format('filas=%s', v_filas))
  on conflict (caso) do update
    set resultado = excluded.resultado, detalle = excluded.detalle;
exception when others then
  insert into resultados_0010 (caso, resultado, detalle)
  values ('terreno_poligonos_inicial', 'fallÃ³', sqlerrm)
  on conflict (caso) do update
    set resultado = excluded.resultado, detalle = excluded.detalle;
end $$;

-- 1) Columnas ----------------------------------------------------------------
do $$
declare
  v_detalle text := '';
  v_ok boolean := true;
begin
  if to_regclass('public.celdas_h3') is null then
    v_ok := false;
    v_detalle := v_detalle || 'falta celdas_h3; ';
  end if;
  if to_regclass('public.terreno_poligonos') is null then
    v_ok := false;
    v_detalle := v_detalle || 'falta terreno_poligonos; ';
  end if;

  if (select count(*) from information_schema.columns
      where table_schema = 'public' and table_name = 'celdas_h3'
        and column_name in ('h3_index','resolucion','latitud','longitud','centro','geom','actualizado_en')) <> 7 then
    v_ok := false;
    v_detalle := v_detalle || 'columnas celdas_h3 incompletas; ';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'celdas_h3'
      and column_name = 'centro' and is_generated = 'ALWAYS'
  ) then
    v_ok := false;
    v_detalle := v_detalle || 'centro no es generada; ';
  end if;

  if (select count(*) from information_schema.columns
      where table_schema = 'public' and table_name = 'terreno_poligonos'
        and column_name in ('osm_tipo','osm_id','terreno','nombre','geom','ancho_m','actualizado_en')) <> 7 then
    v_ok := false;
    v_detalle := v_detalle || 'columnas terreno_poligonos incompletas; ';
  end if;

  insert into resultados_0010 (caso, resultado, detalle)
  values ('columnas', case when v_ok then 'ok' else 'fallÃ³' end, nullif(v_detalle, ''))
  on conflict (caso) do update
    set resultado = excluded.resultado, detalle = excluded.detalle;
exception when others then
  insert into resultados_0010 (caso, resultado, detalle)
  values ('columnas', 'fallÃ³', sqlerrm)
  on conflict (caso) do update
    set resultado = excluded.resultado, detalle = excluded.detalle;
end $$;

-- 2) PK, FK e Ã­ndices ---------------------------------------------------------
do $$
declare
  v_ok boolean := true;
  v_detalle text := '';
  v_gist integer;
begin
  if not exists (select 1 from pg_constraint where conname = 'celdas_h3_pkey') then
    v_ok := false; v_detalle := v_detalle || 'falta PK celdas_h3; ';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'terreno_poligonos_pkey') then
    v_ok := false; v_detalle := v_detalle || 'falta PK terreno_poligonos; ';
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'celdas_habitat_h3_fk' and contype = 'f'
  ) then
    v_ok := false; v_detalle := v_detalle || 'falta FK celdas_habitat_h3_fk; ';
  end if;
  if to_regclass('public.reportes_expira_en_idx') is null then
    v_ok := false; v_detalle := v_detalle || 'falta reportes_expira_en_idx; ';
  end if;

  select count(*) into v_gist
  from pg_indexes
  where schemaname = 'public'
    and tablename in ('celdas_h3', 'terreno_poligonos')
    and indexdef ilike '%using gist%';
  if v_gist < 3 then
    v_ok := false; v_detalle := v_detalle || format('Ã­ndices GiST=%s (se esperaban 3); ', v_gist);
  end if;

  insert into resultados_0010 (caso, resultado, detalle)
  values ('pk_fk_indices', case when v_ok then 'ok' else 'fallÃ³' end, nullif(v_detalle, ''))
  on conflict (caso) do update
    set resultado = excluded.resultado, detalle = excluded.detalle;
exception when others then
  insert into resultados_0010 (caso, resultado, detalle)
  values ('pk_fk_indices', 'fallÃ³', sqlerrm)
  on conflict (caso) do update
    set resultado = excluded.resultado, detalle = excluded.detalle;
end $$;

-- 3) Claves de configuraciÃ³n -------------------------------------------------
do $$
declare
  v_ok integer;
  v_total integer;
  v_detalle text;
begin
  select count(*) into v_ok
  from (values
    ('h3_resolucion', 9::numeric),
    ('radio_busqueda_m', 1000::numeric),
    ('radio_maximo_m', 2000::numeric),
    ('max_celdas_probables', 200::numeric),
    ('max_resultados_pokemon', 30::numeric),
    ('umbral_probable_alto', 1.2::numeric),
    ('umbral_probable_medio', 0.35::numeric),
    ('min_celdas_con_datos', 2::numeric),
    ('min_usuarios_nivel_medio', 2::numeric),
    ('peso_verificado_en_sitio', 0.5::numeric),
    ('peso_ya_no_esta', 1.0::numeric)
  ) e(clave, valor)
  join public.config_probabilidad c
    on c.clave = e.clave and c.valor = e.valor;

  select count(*) into v_total
  from public.config_probabilidad
  where clave in (
    'h3_resolucion','radio_busqueda_m','radio_maximo_m','max_celdas_probables',
    'max_resultados_pokemon','umbral_probable_alto','umbral_probable_medio',
    'min_celdas_con_datos','min_usuarios_nivel_medio','peso_verificado_en_sitio',
    'peso_ya_no_esta'
  );

  v_detalle := format('claves correctas=%s/11; filas=%s', v_ok, v_total);
  insert into resultados_0010 (caso, resultado, detalle)
  values ('config_claves', case when v_ok = 11 and v_total = 11 then 'ok' else 'fallÃ³' end, v_detalle)
  on conflict (caso) do update
    set resultado = excluded.resultado, detalle = excluded.detalle;
exception when others then
  insert into resultados_0010 (caso, resultado, detalle)
  values ('config_claves', 'fallÃ³', sqlerrm)
  on conflict (caso) do update
    set resultado = excluded.resultado, detalle = excluded.detalle;
end $$;

-- 4) RLS y polÃ­ticas ----------------------------------------------------------
do $$
declare
  v_ok boolean := true;
  v_detalle text := '';
  v_rls boolean;
  v_politicas integer;
begin
  select relrowsecurity into v_rls from pg_class where oid = 'public.celdas_h3'::regclass;
  if v_rls is not true then v_ok := false; v_detalle := v_detalle || 'celdas_h3 sin RLS; '; end if;

  select relrowsecurity into v_rls from pg_class where oid = 'public.terreno_poligonos'::regclass;
  if v_rls is not true then v_ok := false; v_detalle := v_detalle || 'terreno_poligonos sin RLS; '; end if;

  select count(*) into v_politicas
  from pg_policies
  where schemaname = 'public' and tablename = 'celdas_h3' and cmd = 'SELECT';
  if v_politicas <> 1 then v_ok := false; v_detalle := v_detalle || 'celdas_h3 sin polÃ­tica SELECT Ãºnica; '; end if;

  select count(*) into v_politicas
  from pg_policies
  where schemaname = 'public' and tablename = 'terreno_poligonos';
  if v_politicas <> 0 then v_ok := false; v_detalle := v_detalle || 'terreno_poligonos no debe tener polÃ­ticas pÃºblicas; '; end if;

  insert into resultados_0010 (caso, resultado, detalle)
  values ('rls_politicas', case when v_ok then 'ok' else 'fallÃ³' end, nullif(v_detalle, ''))
  on conflict (caso) do update
    set resultado = excluded.resultado, detalle = excluded.detalle;
exception when others then
  insert into resultados_0010 (caso, resultado, detalle)
  values ('rls_politicas', 'fallÃ³', sqlerrm)
  on conflict (caso) do update
    set resultado = excluded.resultado, detalle = excluded.detalle;
end $$;

-- 5) Grants de tablas ---------------------------------------------------------
do $$
declare
  v_ok boolean := true;
  v_detalle text := '';
begin
  if not has_table_privilege('anon', 'public.celdas_h3', 'SELECT') then
    v_ok := false; v_detalle := v_detalle || 'anon sin SELECT celdas_h3; ';
  end if;
  if has_table_privilege('anon', 'public.terreno_poligonos', 'SELECT') then
    v_ok := false; v_detalle := v_detalle || 'anon NO debe leer terreno_poligonos; ';
  end if;
  if not has_table_privilege('service_role', 'public.terreno_poligonos', 'INSERT') then
    v_ok := false; v_detalle := v_detalle || 'service_role sin INSERT terreno_poligonos; ';
  end if;
  if not has_table_privilege('service_role', 'public.celdas_h3', 'INSERT') then
    v_ok := false; v_detalle := v_detalle || 'service_role sin INSERT celdas_h3; ';
  end if;
  if not has_table_privilege('service_role', 'public.celdas_habitat', 'INSERT') then
    v_ok := false; v_detalle := v_detalle || 'service_role sin INSERT celdas_habitat; ';
  end if;
  if not has_table_privilege('service_role', 'public.afinidad_terreno', 'INSERT') then
    v_ok := false; v_detalle := v_detalle || 'service_role sin INSERT afinidad_terreno; ';
  end if;
  if not has_table_privilege('service_role', 'public.reportes', 'UPDATE') then
    v_ok := false; v_detalle := v_detalle || 'service_role sin UPDATE reportes; ';
  end if;
  if not has_table_privilege('service_role', 'public.avistamientos', 'UPDATE') then
    v_ok := false; v_detalle := v_detalle || 'service_role sin UPDATE avistamientos; ';
  end if;

  insert into resultados_0010 (caso, resultado, detalle)
  values ('grants_tablas', case when v_ok then 'ok' else 'fallÃ³' end, nullif(v_detalle, ''))
  on conflict (caso) do update
    set resultado = excluded.resultado, detalle = excluded.detalle;
exception when others then
  insert into resultados_0010 (caso, resultado, detalle)
  values ('grants_tablas', 'fallÃ³', sqlerrm)
  on conflict (caso) do update
    set resultado = excluded.resultado, detalle = excluded.detalle;
end $$;

-- 6) Atributos de funciones ---------------------------------------------------
do $$
declare
  v_ok boolean := true;
  v_detalle text := '';
  v_prosecdef boolean;
  v_config text;
  v_public integer;
begin
  select p.prosecdef, coalesce(array_to_string(p.proconfig, ','), '')
  into v_prosecdef, v_config
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace
    and p.proname = 'fn_recalcular_celdas_habitat';
  if v_prosecdef is not false or v_config not like '%search_path=public, extensions%' then
    v_ok := false; v_detalle := v_detalle || 'fn_recalcular atributos incorrectos; ';
  end if;

  select p.prosecdef, coalesce(array_to_string(p.proconfig, ','), '')
  into v_prosecdef, v_config
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace
    and p.proname = 'fn_vaciar_terreno_poligonos';
  if v_prosecdef is not true or v_config not like '%search_path=public%' then
    v_ok := false; v_detalle := v_detalle || 'fn_vaciar atributos incorrectos; ';
  end if;

  select p.prosecdef, coalesce(array_to_string(p.proconfig, ','), '')
  into v_prosecdef, v_config
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace
    and p.proname = 'fn_normalizar_terreno_poligono';
  if v_prosecdef is not false or v_config not like '%search_path=public, extensions%' then
    v_ok := false; v_detalle := v_detalle || 'fn_normalizar atributos incorrectos; ';
  end if;

  select count(*) into v_public
  from pg_proc p
  cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
  where p.pronamespace = 'public'::regnamespace
    and p.proname in ('fn_recalcular_celdas_habitat','fn_vaciar_terreno_poligonos','fn_normalizar_terreno_poligono')
    and a.grantee = 0
    and a.privilege_type = 'EXECUTE';
  if v_public <> 0 then
    v_ok := false; v_detalle := v_detalle || format('EXECUTE de PUBLIC=%s; ', v_public);
  end if;

  if has_function_privilege('anon',
       'public.fn_recalcular_celdas_habitat(double precision,double precision,double precision,double precision)',
       'EXECUTE') then
    v_ok := false; v_detalle := v_detalle || 'anon ejecuta fn_recalcular; ';
  end if;
  if has_function_privilege('authenticated',
       'public.fn_recalcular_celdas_habitat(double precision,double precision,double precision,double precision)',
       'EXECUTE') then
    v_ok := false; v_detalle := v_detalle || 'authenticated ejecuta fn_recalcular; ';
  end if;
  if not has_function_privilege('service_role',
       'public.fn_recalcular_celdas_habitat(double precision,double precision,double precision,double precision)',
       'EXECUTE') then
    v_ok := false; v_detalle := v_detalle || 'service_role no ejecuta fn_recalcular; ';
  end if;
  if has_function_privilege('service_role', 'public.fn_normalizar_terreno_poligono()', 'EXECUTE') then
    v_ok := false; v_detalle := v_detalle || 'service_role ejecuta fn_normalizar; ';
  end if;

  insert into resultados_0010 (caso, resultado, detalle)
  values ('funciones_atributos', case when v_ok then 'ok' else 'fallÃ³' end, nullif(v_detalle, ''))
  on conflict (caso) do update
    set resultado = excluded.resultado, detalle = excluded.detalle;
exception when others then
  insert into resultados_0010 (caso, resultado, detalle)
  values ('funciones_atributos', 'fallÃ³', sqlerrm)
  on conflict (caso) do update
    set resultado = excluded.resultado, detalle = excluded.detalle;
end $$;

-- 7) Permisos reales: anon y authenticated no ejecutan -----------------------
do $$
declare
  v_ok boolean := false;
  v_detalle text := '';
begin
  execute 'set local role anon';
  begin
    perform public.fn_recalcular_celdas_habitat(-0.01, -0.01, 0.01, 0.01);
  exception when insufficient_privilege then
    v_ok := true;
    v_detalle := 'anon: insufficient_privilege';
  end;
  execute 'reset role';

  insert into resultados_0010 (caso, resultado, detalle)
  values ('anon_recalcular', case when v_ok then 'ok' else 'fallÃ³' end, v_detalle)
  on conflict (caso) do update
    set resultado = excluded.resultado, detalle = excluded.detalle;
exception when others then
  execute 'reset role';
  insert into resultados_0010 (caso, resultado, detalle)
  values ('anon_recalcular', 'fallÃ³', sqlerrm)
  on conflict (caso) do update
    set resultado = excluded.resultado, detalle = excluded.detalle;
end $$;

do $$
declare
  v_ok boolean := false;
  v_detalle text := '';
begin
  execute 'set local role authenticated';
  begin
    perform public.fn_recalcular_celdas_habitat(-0.01, -0.01, 0.01, 0.01);
  exception when insufficient_privilege then
    v_ok := true;
    v_detalle := 'authenticated: insufficient_privilege';
  end;
  execute 'reset role';

  insert into resultados_0010 (caso, resultado, detalle)
  values ('authenticated_recalcular', case when v_ok then 'ok' else 'fallÃ³' end, v_detalle)
  on conflict (caso) do update
    set resultado = excluded.resultado, detalle = excluded.detalle;
exception when others then
  execute 'reset role';
  insert into resultados_0010 (caso, resultado, detalle)
  values ('authenticated_recalcular', 'fallÃ³', sqlerrm)
  on conflict (caso) do update
    set resultado = excluded.resultado, detalle = excluded.detalle;
end $$;

do $$
declare
  v_ok boolean := false;
  v_detalle text := '';
begin
  execute 'set local role anon';
  begin
    perform public.fn_vaciar_terreno_poligonos();
  exception when insufficient_privilege then
    v_ok := true;
    v_detalle := 'anon: insufficient_privilege';
  end;
  execute 'reset role';

  insert into resultados_0010 (caso, resultado, detalle)
  values ('anon_vaciar', case when v_ok then 'ok' else 'fallÃ³' end, v_detalle)
  on conflict (caso) do update
    set resultado = excluded.resultado, detalle = excluded.detalle;
exception when others then
  execute 'reset role';
  insert into resultados_0010 (caso, resultado, detalle)
  values ('anon_vaciar', 'fallÃ³', sqlerrm)
  on conflict (caso) do update
    set resultado = excluded.resultado, detalle = excluded.detalle;
end $$;

do $$
declare
  v_ok boolean := false;
  v_detalle text := '';
begin
  execute 'set local role authenticated';
  begin
    perform public.fn_vaciar_terreno_poligonos();
  exception when insufficient_privilege then
    v_ok := true;
    v_detalle := 'authenticated: insufficient_privilege';
  end;
  execute 'reset role';

  insert into resultados_0010 (caso, resultado, detalle)
  values ('authenticated_vaciar', case when v_ok then 'ok' else 'fallÃ³' end, v_detalle)
  on conflict (caso) do update
    set resultado = excluded.resultado, detalle = excluded.detalle;
exception when others then
  execute 'reset role';
  insert into resultados_0010 (caso, resultado, detalle)
  values ('authenticated_vaciar', 'fallÃ³', sqlerrm)
  on conflict (caso) do update
    set resultado = excluded.resultado, detalle = excluded.detalle;
end $$;

-- 8) Permisos reales de lectura ----------------------------------------------
do $$
declare
  v_ok boolean := false;
  v_detalle text := '';
begin
  execute 'set local role anon';
  begin
    perform count(*) from public.celdas_h3;
    v_ok := true;
    v_detalle := 'anon puede leer celdas_h3';
  exception when insufficient_privilege then
    v_detalle := 'anon no puede leer celdas_h3';
  end;
  execute 'reset role';

  insert into resultados_0010 (caso, resultado, detalle)
  values ('anon_lee_celdas_h3', case when v_ok then 'ok' else 'fallÃ³' end, v_detalle)
  on conflict (caso) do update
    set resultado = excluded.resultado, detalle = excluded.detalle;
exception when others then
  execute 'reset role';
  insert into resultados_0010 (caso, resultado, detalle)
  values ('anon_lee_celdas_h3', 'fallÃ³', sqlerrm)
  on conflict (caso) do update
    set resultado = excluded.resultado, detalle = excluded.detalle;
end $$;

do $$
declare
  v_ok boolean := false;
  v_detalle text := '';
begin
  execute 'set local role anon';
  begin
    perform count(*) from public.terreno_poligonos;
    v_detalle := 'anon pudo leer terreno_poligonos (no deberÃ­a)';
  exception when insufficient_privilege then
    v_ok := true;
    v_detalle := 'anon: insufficient_privilege al leer terreno_poligonos';
  end;
  execute 'reset role';

  insert into resultados_0010 (caso, resultado, detalle)
  values ('anon_no_lee_terreno_poligonos', case when v_ok then 'ok' else 'fallÃ³' end, v_detalle)
  on conflict (caso) do update
    set resultado = excluded.resultado, detalle = excluded.detalle;
exception when others then
  execute 'reset role';
  insert into resultados_0010 (caso, resultado, detalle)
  values ('anon_no_lee_terreno_poligonos', 'fallÃ³', sqlerrm)
  on conflict (caso) do update
    set resultado = excluded.resultado, detalle = excluded.detalle;
end $$;

-- 9) Trigger: polÃ­gono, Ã¡rea conocida y franja de agua -----------------------
do $$
declare
  v_tipo text;
  v_srid integer;
  v_valido boolean;
  v_area double precision;
  v_area_parque double precision;
  v_ancho numeric;
begin
  insert into public.terreno_poligonos (osm_tipo, osm_id, terreno, nombre, geom, ancho_m)
  values (
    'way', -900001, 'parque', 'Parque de prueba 100x100',
    ST_GeomFromText(
      'POLYGON((-75.5812 6.2442,-75.5802962 6.2442,-75.5802962 6.2450983,-75.5812 6.2450983,-75.5812 6.2442))',
      4326
    ),
    null
  );

  select ST_GeometryType(geom), ST_SRID(geom), ST_IsValid(geom), ST_Area(geom::geography)
  into v_tipo, v_srid, v_valido, v_area
  from public.terreno_poligonos
  where osm_tipo = 'way' and osm_id = -900001;

  if v_tipo <> 'ST_MultiPolygon' or v_srid <> 4326 or v_valido is not true
     or v_area < 8500 or v_area > 11500 then
    raise exception 'PolÃ­gono de prueba inesperado: tipo=% srid=% valido=% area=%',
      v_tipo, v_srid, v_valido, v_area;
  end if;
  v_area_parque := v_area;

  insert into public.terreno_poligonos (osm_tipo, osm_id, terreno, nombre, geom, ancho_m)
  values (
    'way', -900002, 'agua', 'Quebrada de prueba',
    ST_GeomFromText('LINESTRING(0 0,0.001 0)', 4326),
    20
  );

  select ST_GeometryType(geom), ST_SRID(geom), ST_IsValid(geom), ST_Area(geom::geography), ancho_m
  into v_tipo, v_srid, v_valido, v_area, v_ancho
  from public.terreno_poligonos
  where osm_tipo = 'way' and osm_id = -900002;

  if v_tipo <> 'ST_MultiPolygon' or v_srid <> 4326 or v_valido is not true
     or v_ancho <> 20 or v_area < 1500 or v_area > 3000 then
    raise exception 'Franja de agua inesperada: tipo=% srid=% valido=% ancho=% area=%',
      v_tipo, v_srid, v_valido, v_ancho, v_area;
  end if;

  insert into resultados_0010 (caso, resultado, detalle)
  values (
    'trigger_normaliza',
    'ok',
    format('parque area=%.1f m2; quebrada ancho=%s area=%.1f m2', v_area_parque, v_ancho, v_area)
  )
  on conflict (caso) do update
    set resultado = excluded.resultado, detalle = excluded.detalle;
exception when others then
  insert into resultados_0010 (caso, resultado, detalle)
  values ('trigger_normaliza', 'fallÃ³', sqlerrm)
  on conflict (caso) do update
    set resultado = excluded.resultado, detalle = excluded.detalle;
end $$;

-- 10) Solape, prioridad y urbano remanente -----------------------------------
do $$
declare
  v_ok boolean := true;
  v_detalle text := '';
  v_parque numeric;
  v_bosque numeric;
  v_urbano numeric;
  v_suma numeric;
  v_filas integer;
begin
  insert into public.celdas_h3 (h3_index, resolucion, latitud, longitud, geom)
  values (
    'prueba000000000', 9, 0.005, 0.005,
    ST_GeomFromText('MULTIPOLYGON(((0 0,0.01 0,0.01 0.01,0 0.01,0 0)))', 4326)
  );

  insert into public.terreno_poligonos (osm_tipo, osm_id, terreno, nombre, geom)
  values
    ('way', -900003, 'parque', 'Parque solapado',
     ST_GeomFromText('POLYGON((0 0,0.01 0,0.01 0.005,0 0.005,0 0))', 4326)),
    ('way', -900004, 'bosque', 'Bosque solapado',
     ST_GeomFromText('POLYGON((0 0,0.005 0,0.005 0.01,0 0.01,0 0))', 4326));

  execute 'set local role service_role';
  begin
    perform public.fn_recalcular_celdas_habitat(-0.01, -0.01, 0.01, 0.01);
  exception when others then
    execute 'reset role';
    raise;
  end;
  execute 'reset role';

  select count(*) into v_filas
  from public.celdas_habitat
  where h3_index = 'prueba000000000';

  select porcentaje into v_parque
  from public.celdas_habitat
  where h3_index = 'prueba000000000' and terreno = 'parque';

  select porcentaje into v_bosque
  from public.celdas_habitat
  where h3_index = 'prueba000000000' and terreno = 'bosque';

  select porcentaje into v_urbano
  from public.celdas_habitat
  where h3_index = 'prueba000000000' and terreno = 'urbano';

  select sum(porcentaje) into v_suma
  from public.celdas_habitat
  where h3_index = 'prueba000000000';

  if v_filas <> 3 then
    v_ok := false; v_detalle := v_detalle || format('filas=%s (se esperaban 3); ', v_filas);
  end if;
  if v_parque is null or v_parque < 49.5 or v_parque > 50.5 then
    v_ok := false; v_detalle := v_detalle || format('parque=%s; ', v_parque);
  end if;
  if v_bosque is null or v_bosque < 24.5 or v_bosque > 25.5 then
    v_ok := false; v_detalle := v_detalle || format('bosque=%s; ', v_bosque);
  end if;
  if v_urbano is null or v_urbano < 24.5 or v_urbano > 25.5 then
    v_ok := false; v_detalle := v_detalle || format('urbano=%s; ', v_urbano);
  end if;
  if v_suma is null or v_suma > 100.001 then
    v_ok := false; v_detalle := v_detalle || format('suma=%s; ', v_suma);
  end if;

  insert into resultados_0010 (caso, resultado, detalle)
  values (
    'solape_prioridad_urbano',
    case when v_ok then 'ok' else 'fallÃ³' end,
    nullif(v_detalle, '')
  )
  on conflict (caso) do update
    set resultado = excluded.resultado, detalle = excluded.detalle;
exception when others then
  execute 'reset role';
  insert into resultados_0010 (caso, resultado, detalle)
  values ('solape_prioridad_urbano', 'fallÃ³', sqlerrm)
  on conflict (caso) do update
    set resultado = excluded.resultado, detalle = excluded.detalle;
end $$;

-- 11) fn_vaciar: solo se ejecuta de verdad si la tabla estaba vacÃ­a ----------
do $$
declare
  v_inicial bigint;
  v_despues bigint;
  v_ok boolean;
begin
  select (regexp_match(detalle, 'filas=([0-9]+)'))[1]::bigint
  into v_inicial
  from resultados_0010 where caso = 'terreno_poligonos_inicial';

  if v_inicial is distinct from 0 then
    insert into resultados_0010 (caso, resultado, detalle)
    values ('fn_vaciar', 'ok', format('omitido: terreno_poligonos tenÃ­a %s filas al inicio', v_inicial))
    on conflict (caso) do update
      set resultado = excluded.resultado, detalle = excluded.detalle;
    return;
  end if;

  execute 'set local role service_role';
  begin
    perform public.fn_vaciar_terreno_poligonos();
  exception when others then
    execute 'reset role';
    raise;
  end;
  execute 'reset role';

  select count(*) into v_despues from public.terreno_poligonos;
  v_ok := v_despues = 0;

  insert into resultados_0010 (caso, resultado, detalle)
  values ('fn_vaciar', case when v_ok then 'ok' else 'fallÃ³' end,
          format('service_role vaciÃ³; filas despuÃ©s=%s', v_despues))
  on conflict (caso) do update
    set resultado = excluded.resultado, detalle = excluded.detalle;
exception when others then
  execute 'reset role';
  insert into resultados_0010 (caso, resultado, detalle)
  values ('fn_vaciar', 'fallÃ³', sqlerrm)
  on conflict (caso) do update
    set resultado = excluded.resultado, detalle = excluded.detalle;
end $$;

-- 12) Resultados -------------------------------------------------------------
select caso, resultado, detalle
from resultados_0010
order by caso;

rollback;

