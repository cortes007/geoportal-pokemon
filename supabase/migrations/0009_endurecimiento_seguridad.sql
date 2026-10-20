-- ---------------------------------------------------------------------------
-- 0009 · Endurecimiento de seguridad de funciones
-- ---------------------------------------------------------------------------
-- No edita ninguna migración anterior. Es aditiva e idempotente.
--
-- CONTEXTO
-- El Advisor marca funciones SECURITY DEFINER ejecutables por los roles de API
-- (0028/0029) y una función con search_path mutable (0011). Las funciones de
-- trigger no son endpoints RPC: nadie debe poder invocarlas con la anon key.
-- PostgreSQL comprueba EXECUTE al crear el trigger, no en cada disparo, así que
-- revocar el privilegio no apaga los triggers.
--
-- LISTAR_AVISTAMIENTOS_RECIENTES
-- Es una excepción aceptada: RPC pública de solo lectura para el frontend
-- anónimo actual. Se deja accesible a anon/authenticated, pero con GRANT
-- explícito y search_path fijo.
--
-- POLÍTICA DE AVISTAMIENTOS
-- No se toca en esta migración. Sigue siendo temporal hasta la Fase 7; ver el
-- comentario de la política y MEMORY.md.
-- ---------------------------------------------------------------------------

-- 1) search_path explícito --------------------------------------------------
alter function public.fn_set_actualizado_en()          set search_path = public;
alter function public.fn_espejo_avistamiento_a_reporte() set search_path = public;
alter function public.fn_handle_new_user()             set search_path = public;
alter function public.fn_reportes_limite_hora()        set search_path = public;
alter function public.fn_validar_tipos_pokemon()       set search_path = public;

-- Usa ST_Distance/ST_MakePoint sin calificar; extensions debe estar en la ruta.
alter function public.fn_reportes_normalizar()         set search_path = public, extensions;

-- 2) EXECUTE solo para el owner y los triggers -------------------------------
-- Se revoca también de fn_set_actualizado_en: es SECURITY INVOKER y no puede
-- llamarse fuera de un trigger, pero ningún rol de API necesita ejecutarla.
revoke execute on function public.fn_set_actualizado_en()
  from public, anon, authenticated;
revoke execute on function public.fn_espejo_avistamiento_a_reporte()
  from public, anon, authenticated;
revoke execute on function public.fn_handle_new_user()
  from public, anon, authenticated;
revoke execute on function public.fn_reportes_limite_hora()
  from public, anon, authenticated;
revoke execute on function public.fn_reportes_normalizar()
  from public, anon, authenticated;
revoke execute on function public.fn_validar_tipos_pokemon()
  from public, anon, authenticated;

comment on function public.fn_set_actualizado_en() is
  'Trigger genérico: actualiza actualizado_en en cada UPDATE. Interno; EXECUTE revocado a roles de API.';
comment on function public.fn_espejo_avistamiento_a_reporte() is
  'Trigger espejo avistamientos -> reportes. Temporal. Interno; EXECUTE revocado a roles de API.';
comment on function public.fn_handle_new_user() is
  'Trigger de alta de usuario: crea el perfil. Interno; EXECUTE revocado a roles de API.';
comment on function public.fn_reportes_limite_hora() is
  'Trigger de tope de reportes por usuario y hora. Interno; EXECUTE revocado a roles de API.';
comment on function public.fn_reportes_normalizar() is
  'Trigger de snapshots, expiración y verificación en sitio. Interno; EXECUTE revocado a roles de API.';
comment on function public.fn_validar_tipos_pokemon() is
  'Trigger de validación de tipos del catálogo. Interno; EXECUTE revocado a roles de API.';

-- 3) Excepción aceptada: RPC pública de lectura -----------------------------
alter function public.listar_avistamientos_recientes(int, text, boolean)
  set search_path = public;

-- Quita el EXECUTE implícito de PUBLIC y concede solo a los roles que la usan.
revoke execute on function public.listar_avistamientos_recientes(int, text, boolean)
  from public;
grant execute on function public.listar_avistamientos_recientes(int, text, boolean)
  to anon, authenticated;

comment on function public.listar_avistamientos_recientes(int, text, boolean) is
  'Excepción aceptada: RPC pública de solo lectura para el frontend anónimo. No exponer escritura.';

-- 4) Regla para funciones nuevas -------------------------------------------
-- Toda función nueva nace sin EXECUTE para la API y debe recibir un GRANT
-- explícito solo al rol que la use. Las funciones de trigger no reciben GRANT.
alter default privileges in schema public
  revoke execute on functions from public, anon, authenticated;

-- 5) Política de avistamientos: temporal, no se modifica --------------------
comment on policy "avistamientos insercion" on public.avistamientos is
  'TEMPORAL: permite INSERT anónimo mientras el formulario escribe en avistamientos. Cerrar en la Fase 7 (auth + RPC/reportes). La app no se publica hasta cerrar esta política.';

-- Refresca la caché de PostgREST tras cambiar privilegios.
notify pgrst, 'reload schema';
