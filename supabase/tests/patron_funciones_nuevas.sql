-- ---------------------------------------------------------------------------
-- Prueba del patrón de privilegios para funciones nuevas
-- ---------------------------------------------------------------------------
-- EJECUTAR EN EL SQL EDITOR DE SUPABASE.
-- Todo ocurre dentro de una transacción y termina con ROLLBACK: no deja datos.
--
-- Este archivo NO prueba los privilegios por defecto de PostgreSQL. Prueba el
-- patrón obligatorio de cada migración:
--
--   1. crear la función;
--   2. REVOKE EXECUTE ... FROM public, anon, authenticated;
--   3. comprobar que anon/authenticated no la ejecutan;
--   4. GRANT EXECUTE al rol beneficiado;
--   5. comprobar que solo ese rol la ejecuta.
--
-- Incluye un caso informativo (no bloqueante) que muestra que, sin el REVOKE
-- explícito, anon sí ejecuta la función porque hereda el EXECUTE de PUBLIC.
-- ---------------------------------------------------------------------------

begin;

select current_user, session_user;

create temporary table resultados_patron (
  caso       text primary key,
  resultado  text not null check (resultado in ('ok', 'falló')),
  detalle    text,
  bloqueante boolean not null default true
) on commit drop;

-- 1) Crear + REVOKE explícito + comprobar que nadie de la API ejecuta --------
do $$
begin
  drop function if exists public.fn_patron_prueba();

  create function public.fn_patron_prueba()
  returns integer
  language sql
  as $fn$
    select 1;
  $fn$;

  revoke execute on function public.fn_patron_prueba()
    from public, anon, authenticated;

  insert into resultados_patron (caso, resultado, detalle, bloqueante)
  values (
    'sin_grant_despues_de_revoke',
    case
      when not has_function_privilege('anon', 'public.fn_patron_prueba()', 'EXECUTE')
       and not has_function_privilege('authenticated', 'public.fn_patron_prueba()', 'EXECUTE')
      then 'ok' else 'falló'
    end,
    format(
      'anon=%s authenticated=%s',
      has_function_privilege('anon', 'public.fn_patron_prueba()', 'EXECUTE'),
      has_function_privilege('authenticated', 'public.fn_patron_prueba()', 'EXECUTE')
    ),
    true
  )
  on conflict (caso) do update
    set resultado  = excluded.resultado,
        detalle    = excluded.detalle,
        bloqueante = excluded.bloqueante;
exception when others then
  insert into resultados_patron (caso, resultado, detalle, bloqueante)
  values ('sin_grant_despues_de_revoke', 'falló', sqlerrm, true)
  on conflict (caso) do update
    set resultado  = excluded.resultado,
        detalle    = excluded.detalle,
        bloqueante = excluded.bloqueante;
end $$;

-- 2) GRANT explícito a anon: solo anon ejecuta ------------------------------
do $$
begin
  grant execute on function public.fn_patron_prueba() to anon;

  insert into resultados_patron (caso, resultado, detalle, bloqueante)
  values (
    'grant_anon',
    case
      when has_function_privilege('anon', 'public.fn_patron_prueba()', 'EXECUTE')
       and not has_function_privilege('authenticated', 'public.fn_patron_prueba()', 'EXECUTE')
      then 'ok' else 'falló'
    end,
    format(
      'anon=%s authenticated=%s (solo anon recibió el GRANT)',
      has_function_privilege('anon', 'public.fn_patron_prueba()', 'EXECUTE'),
      has_function_privilege('authenticated', 'public.fn_patron_prueba()', 'EXECUTE')
    ),
    true
  )
  on conflict (caso) do update
    set resultado  = excluded.resultado,
        detalle    = excluded.detalle,
        bloqueante = excluded.bloqueante;
exception when others then
  insert into resultados_patron (caso, resultado, detalle, bloqueante)
  values ('grant_anon', 'falló', sqlerrm, true)
  on conflict (caso) do update
    set resultado  = excluded.resultado,
        detalle    = excluded.detalle,
        bloqueante = excluded.bloqueante;
end $$;

-- 3) GRANT explícito a authenticated: ambos ejecutan ------------------------
do $$
begin
  grant execute on function public.fn_patron_prueba() to authenticated;

  insert into resultados_patron (caso, resultado, detalle, bloqueante)
  values (
    'grant_authenticated',
    case
      when has_function_privilege('anon', 'public.fn_patron_prueba()', 'EXECUTE')
       and has_function_privilege('authenticated', 'public.fn_patron_prueba()', 'EXECUTE')
      then 'ok' else 'falló'
    end,
    format(
      'anon=%s authenticated=%s (ambos recibieron GRANT)',
      has_function_privilege('anon', 'public.fn_patron_prueba()', 'EXECUTE'),
      has_function_privilege('authenticated', 'public.fn_patron_prueba()', 'EXECUTE')
    ),
    true
  )
  on conflict (caso) do update
    set resultado  = excluded.resultado,
        detalle    = excluded.detalle,
        bloqueante = excluded.bloqueante;
exception when others then
  insert into resultados_patron (caso, resultado, detalle, bloqueante)
  values ('grant_authenticated', 'falló', sqlerrm, true)
  on conflict (caso) do update
    set resultado  = excluded.resultado,
        detalle    = excluded.detalle,
        bloqueante = excluded.bloqueante;
end $$;

-- 4) Informativo, no bloqueante: sin REVOKE, anon ejecuta -------------------
do $$
declare
  v_anon boolean;
begin
  drop function if exists public.fn_patron_sin_revoke();

  create function public.fn_patron_sin_revoke()
  returns integer
  language sql
  as $fn$
    select 1;
  $fn$;

  v_anon := has_function_privilege('anon', 'public.fn_patron_sin_revoke()', 'EXECUTE');

  insert into resultados_patron (caso, resultado, detalle, bloqueante)
  values (
    'informativo_sin_revoke',
    case when v_anon then 'ok' else 'falló' end,
    format(
      'informativo, no bloqueante: anon=%s; se esperaba true por el default PUBLIC',
      v_anon
    ),
    false
  )
  on conflict (caso) do update
    set resultado  = excluded.resultado,
        detalle    = excluded.detalle,
        bloqueante = excluded.bloqueante;
exception when others then
  insert into resultados_patron (caso, resultado, detalle, bloqueante)
  values ('informativo_sin_revoke', 'falló', sqlerrm, false)
  on conflict (caso) do update
    set resultado  = excluded.resultado,
        detalle    = excluded.detalle,
        bloqueante = excluded.bloqueante;
end $$;

-- 5) Resultados -------------------------------------------------------------
select caso, resultado, detalle, bloqueante
from resultados_patron
order by caso;

rollback;
