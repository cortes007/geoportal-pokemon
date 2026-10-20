-- ---------------------------------------------------------------------------
-- Prueba de 0009 · Permisos y triggers
-- ---------------------------------------------------------------------------
-- EJECUTAR EN EL SQL EDITOR DE SUPABASE.
-- Todo ocurre dentro de una transacción y termina con ROLLBACK: no deja datos.
--
-- Comprueba:
--   1. anon/authenticated no pueden ejecutar las seis funciones de trigger.
--   2. listar_avistamientos_recientes sigue siendo pública (excepción aceptada).
--   3. Los seis triggers siguen disparando después del REVOKE de EXECUTE.
--
-- Devuelve una tabla (caso, resultado, detalle) antes del ROLLBACK.
-- Cada caso está aislado: un fallo no aborta los demás.
-- ---------------------------------------------------------------------------

begin;

select current_user, session_user;

create temporary table resultados_0009 (
  caso      text primary key,
  resultado text not null check (resultado in ('ok', 'falló')),
  detalle   text
) on commit drop;

-- 1) Permisos de las funciones de trigger -----------------------------------
do $$
declare
  v_fn      text;
  v_anon    boolean;
  v_auth    boolean;
  v_ok      boolean := true;
  v_detalle text := '';
begin
  foreach v_fn in array array[
    'public.fn_set_actualizado_en()',
    'public.fn_espejo_avistamiento_a_reporte()',
    'public.fn_handle_new_user()',
    'public.fn_reportes_limite_hora()',
    'public.fn_reportes_normalizar()',
    'public.fn_validar_tipos_pokemon()'
  ] loop
    v_anon := has_function_privilege('anon', v_fn, 'EXECUTE');
    v_auth := has_function_privilege('authenticated', v_fn, 'EXECUTE');
    if v_anon or v_auth then
      v_ok := false;
      v_detalle := v_detalle || format('%s: anon=%s authenticated=%s; ', v_fn, v_anon, v_auth);
    end if;
  end loop;

  insert into resultados_0009 (caso, resultado, detalle)
  values ('permisos_funciones_trigger',
          case when v_ok then 'ok' else 'falló' end,
          nullif(v_detalle, ''))
  on conflict (caso) do update
    set resultado = excluded.resultado,
        detalle   = excluded.detalle;
exception when others then
  insert into resultados_0009 (caso, resultado, detalle)
  values ('permisos_funciones_trigger', 'falló', sqlerrm)
  on conflict (caso) do update
    set resultado = excluded.resultado,
        detalle   = excluded.detalle;
end $$;

-- 2) listar_avistamientos_recientes sigue pública ---------------------------
do $$
declare
  v_anon boolean;
  v_auth boolean;
begin
  v_anon := has_function_privilege(
    'anon',
    'public.listar_avistamientos_recientes(integer, text, boolean)',
    'EXECUTE'
  );
  v_auth := has_function_privilege(
    'authenticated',
    'public.listar_avistamientos_recientes(integer, text, boolean)',
    'EXECUTE'
  );

  insert into resultados_0009 (caso, resultado, detalle)
  values ('listar_avistamientos_publica',
          case when v_anon and v_auth then 'ok' else 'falló' end,
          format('anon=%s authenticated=%s', v_anon, v_auth))
  on conflict (caso) do update
    set resultado = excluded.resultado,
        detalle   = excluded.detalle;
exception when others then
  insert into resultados_0009 (caso, resultado, detalle)
  values ('listar_avistamientos_publica', 'falló', sqlerrm)
  on conflict (caso) do update
    set resultado = excluded.resultado,
        detalle   = excluded.detalle;
end $$;

-- 3) fn_set_actualizado_en --------------------------------------------------
do $$
declare
  v_actualizado timestamptz;
begin
  delete from public.pokemon_catalogo where id = 999999;

  insert into public.pokemon_catalogo (id, nombre, tipos, creado_en, actualizado_en)
  values (999999, 'Test 0009', array['agua'],
          now() - interval '1 day', now() - interval '1 day');

  update public.pokemon_catalogo
  set nombre = 'Test 0009 bis'
  where id = 999999;

  select actualizado_en into v_actualizado
  from public.pokemon_catalogo
  where id = 999999;

  if v_actualizado is null or v_actualizado <= now() - interval '1 hour' then
    raise exception 'fn_set_actualizado_en no actualizó actualizado_en';
  end if;

  insert into resultados_0009 (caso, resultado, detalle)
  values ('fn_set_actualizado_en', 'ok', null)
  on conflict (caso) do update
    set resultado = excluded.resultado,
        detalle   = excluded.detalle;
exception when others then
  insert into resultados_0009 (caso, resultado, detalle)
  values ('fn_set_actualizado_en', 'falló', sqlerrm)
  on conflict (caso) do update
    set resultado = excluded.resultado,
        detalle   = excluded.detalle;
end $$;

-- 4) fn_validar_tipos_pokemon -----------------------------------------------
do $$
begin
  delete from public.pokemon_catalogo where id = 999998;

  begin
    insert into public.pokemon_catalogo (id, nombre, tipos)
    values (999998, 'Tipo inválido', array['no_existe']);

    raise exception 'fn_validar_tipos_pokemon no rechazó el tipo inválido'
      using errcode = 'P0002';
  exception
    when sqlstate 'P0001' then
      null; -- rechazo esperado
  end;

  insert into resultados_0009 (caso, resultado, detalle)
  values ('fn_validar_tipos_pokemon', 'ok', null)
  on conflict (caso) do update
    set resultado = excluded.resultado,
        detalle   = excluded.detalle;
exception when others then
  insert into resultados_0009 (caso, resultado, detalle)
  values ('fn_validar_tipos_pokemon', 'falló', sqlerrm)
  on conflict (caso) do update
    set resultado = excluded.resultado,
        detalle   = excluded.detalle;
end $$;

-- 5) fn_handle_new_user -----------------------------------------------------
do $$
declare
  v_user uuid := '00000000-0000-0000-0000-000000000009';
begin
  delete from auth.users
  where id = v_user
     or email = 'test-0009@example.invalid';

  insert into auth.users (
    id, instance_id, aud, role, email,
    raw_app_meta_data, raw_user_meta_data
  )
  values (
    v_user,
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'test-0009@example.invalid',
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"nombre":"Test 0009"}'::jsonb
  );

  if not exists (select 1 from public.perfiles where id = v_user) then
    raise exception 'fn_handle_new_user no creó el perfil';
  end if;

  insert into resultados_0009 (caso, resultado, detalle)
  values ('fn_handle_new_user', 'ok', null)
  on conflict (caso) do update
    set resultado = excluded.resultado,
        detalle   = excluded.detalle;
exception when others then
  insert into resultados_0009 (caso, resultado, detalle)
  values ('fn_handle_new_user', 'falló', sqlerrm)
  on conflict (caso) do update
    set resultado = excluded.resultado,
        detalle   = excluded.detalle;
end $$;

-- 6) fn_espejo_avistamiento_a_reporte ---------------------------------------
do $$
declare
  v_avistamiento uuid;
  v_reporte       public.reportes%rowtype;
begin
  insert into public.avistamientos (
    pokemon_name, pokemon_type, latitud, longitud, es_nido, creado_en
  )
  values (
    'Test 0009', 'agua', 6.2442, -75.5812, false,
    now() - interval '10 minutes'
  )
  returning id into v_avistamiento;

  select * into v_reporte
  from public.reportes
  where origen_id = v_avistamiento;

  if not found then
    raise exception 'fn_espejo_avistamiento_a_reporte no creó el reporte';
  end if;
  if v_reporte.tipo <> 'salvaje' then
    raise exception 'tipo espejo incorrecto: %', v_reporte.tipo;
  end if;
  if v_reporte.autor_id is not null then
    raise exception 'el espejo no debe inventar autor_id';
  end if;
  if v_reporte.expira_en is null then
    raise exception 'el normalizador no calculó expira_en en el espejo';
  end if;

  insert into resultados_0009 (caso, resultado, detalle)
  values ('fn_espejo_avistamiento_a_reporte', 'ok', null)
  on conflict (caso) do update
    set resultado = excluded.resultado,
        detalle   = excluded.detalle;
exception when others then
  insert into resultados_0009 (caso, resultado, detalle)
  values ('fn_espejo_avistamiento_a_reporte', 'falló', sqlerrm)
  on conflict (caso) do update
    set resultado = excluded.resultado,
        detalle   = excluded.detalle;
end $$;

-- 7) fn_reportes_normalizar -------------------------------------------------
do $$
declare
  v_reporte public.reportes%rowtype;
begin
  insert into public.reportes (
    tipo, latitud, longitud, latitud_declarada, longitud_declarada
  )
  values ('salvaje', 6.2442, -75.5812, 6.2442, -75.5812)
  returning * into v_reporte;

  if v_reporte.expira_en is null then
    raise exception 'fn_reportes_normalizar no calculó expira_en';
  end if;
  if v_reporte.verificado_en_sitio is not true then
    raise exception 'fn_reportes_normalizar no calculó verificado_en_sitio';
  end if;
  if v_reporte.distancia_declarada_m is null
     or v_reporte.distancia_declarada_m > 1 then
    raise exception 'distancia declarada inesperada: %', v_reporte.distancia_declarada_m;
  end if;

  insert into resultados_0009 (caso, resultado, detalle)
  values ('fn_reportes_normalizar', 'ok', null)
  on conflict (caso) do update
    set resultado = excluded.resultado,
        detalle   = excluded.detalle;
exception when others then
  insert into resultados_0009 (caso, resultado, detalle)
  values ('fn_reportes_normalizar', 'falló', sqlerrm)
  on conflict (caso) do update
    set resultado = excluded.resultado,
        detalle   = excluded.detalle;
end $$;

-- 8) fn_reportes_limite_hora ------------------------------------------------
do $$
declare
  v_user uuid := '00000000-0000-0000-0000-000000000009';
begin
  -- Asegura el autor para no depender del caso anterior.
  insert into auth.users (
    id, instance_id, aud, role, email,
    raw_app_meta_data, raw_user_meta_data
  )
  values (
    v_user,
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'test-0009@example.invalid',
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"nombre":"Test 0009"}'::jsonb
  )
  on conflict (id) do nothing;

  update public.config_probabilidad
  set valor = 0
  where clave = 'tope_reportes_por_hora';

  begin
    insert into public.reportes (tipo, latitud, longitud, autor_id)
    values ('salvaje', 6.2442, -75.5812, v_user);

    raise exception 'fn_reportes_limite_hora no disparó'
      using errcode = 'P0002';
  exception
    when sqlstate 'P0001' then
      null; -- rechazo esperado
  end;

  insert into resultados_0009 (caso, resultado, detalle)
  values ('fn_reportes_limite_hora', 'ok', null)
  on conflict (caso) do update
    set resultado = excluded.resultado,
        detalle   = excluded.detalle;
exception when others then
  insert into resultados_0009 (caso, resultado, detalle)
  values ('fn_reportes_limite_hora', 'falló', sqlerrm)
  on conflict (caso) do update
    set resultado = excluded.resultado,
        detalle   = excluded.detalle;
end $$;

-- 9) Resultados -------------------------------------------------------------
select caso, resultado, detalle
from resultados_0009
order by caso;

rollback;
