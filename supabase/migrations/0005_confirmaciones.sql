-- ---------------------------------------------------------------------------
-- 0005 · Confirmaciones
-- ---------------------------------------------------------------------------
-- Un voto por usuario y reporte. La PK compuesta (reporte_id, usuario_id) lo
-- garantiza a nivel de base de datos; no hace falta un índice único extra.
--
-- `sigue_ahi` refuerza la confianza del reporte; `ya_no_esta` la reduce. El peso
-- exacto lo aplicará la futura función de probabilidad (aún no existe).
-- ---------------------------------------------------------------------------

create table if not exists public.confirmaciones (
  reporte_id     uuid not null references public.reportes(id) on delete cascade,
  usuario_id     uuid not null references auth.users(id) on delete cascade,
  voto           text not null,
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  primary key (reporte_id, usuario_id),
  constraint confirmaciones_voto_valido
    check (voto in ('sigue_ahi', 'ya_no_esta'))
);

comment on table public.confirmaciones is
  'Confirmación de un reporte por parte de un usuario. Un voto por usuario y reporte.';
comment on column public.confirmaciones.voto is
  'sigue_ahi = todavía está; ya_no_esta = ya no se encuentra.';

create index if not exists confirmaciones_usuario_idx
  on public.confirmaciones (usuario_id, creado_en desc);
create index if not exists confirmaciones_reporte_idx
  on public.confirmaciones (reporte_id, voto);

drop trigger if exists trg_confirmaciones_actualizado on public.confirmaciones;
create trigger trg_confirmaciones_actualizado
  before update on public.confirmaciones
  for each row execute function public.fn_set_actualizado_en();

-- Seguridad a nivel de fila -------------------------------------------------
alter table public.confirmaciones enable row level security;

drop policy if exists "confirmaciones lectura publica" on public.confirmaciones;
create policy "confirmaciones lectura publica"
  on public.confirmaciones for select using (true);

drop policy if exists "confirmaciones insercion con sesion" on public.confirmaciones;
create policy "confirmaciones insercion con sesion"
  on public.confirmaciones for insert
  with check (auth.uid() is not null and auth.uid() = usuario_id);

-- El usuario puede cambiar su voto: sigue habiendo una sola fila por reporte.
drop policy if exists "confirmaciones actualizacion propia" on public.confirmaciones;
create policy "confirmaciones actualizacion propia"
  on public.confirmaciones for update
  using (auth.uid() = usuario_id)
  with check (auth.uid() = usuario_id);

drop policy if exists "confirmaciones borrado propio" on public.confirmaciones;
create policy "confirmaciones borrado propio"
  on public.confirmaciones for delete
  using (auth.uid() = usuario_id);

grant select on public.confirmaciones to anon, authenticated;
grant insert, update, delete on public.confirmaciones to authenticated;

-- Realtime ------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'confirmaciones'
  ) then
    alter publication supabase_realtime add table public.confirmaciones;
  end if;
exception when undefined_object then
  null;
end $$;
