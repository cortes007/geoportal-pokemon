-- ---------------------------------------------------------------------------
-- 0003 · Parámetros de probabilidad y vida útil
-- ---------------------------------------------------------------------------
-- Tabla clave/valor editable desde el SQL Editor o el Table Editor sin tocar
-- código. Los triggers de `reportes` la leen con `fn_config(...)`.
--
-- Valores iniciales propuestos (ajústalos libremente aquí o en la tabla):
--   vida_salvaje_min       90       (1 h 30 min)
--   vida_nido_min          20160    (14 días)
--   vida_incursion_min     60       (1 hora)
--   vida_comentario_min    null     (los comentarios no expiran)
--   tope_reportes_por_hora 10
--   min_usuarios_nivel_alto 3
--   radio_verificacion_m   300
-- ---------------------------------------------------------------------------

create table if not exists public.config_probabilidad (
  clave          text primary key,
  valor          numeric,
  descripcion    text,
  actualizado_en timestamptz not null default now()
);

comment on table public.config_probabilidad is
  'Parámetros editables del modelo. `valor` admite NULL para "sin límite" (p. ej. comentario).';
comment on column public.config_probabilidad.valor is
  'Unidad según la clave: minutos, metros o conteos.';

drop trigger if exists trg_config_probabilidad_actualizado on public.config_probabilidad;
create trigger trg_config_probabilidad_actualizado
  before update on public.config_probabilidad
  for each row execute function public.fn_set_actualizado_en();

insert into public.config_probabilidad (clave, valor, descripcion) values
  ('vida_salvaje_min',        90,    'Vida útil de un reporte salvaje, en minutos.'),
  ('vida_nido_min',           20160, 'Vida útil de un nido, en minutos (14 días).'),
  ('vida_incursion_min',      60,    'Vida útil de una incursión, en minutos.'),
  ('vida_comentario_min',     null,  'Vida útil de un comentario. NULL = no expira.'),
  ('tope_reportes_por_hora',  10,    'Máximo de reportes que un usuario puede crear por hora.'),
  ('min_usuarios_nivel_alto', 3,     'Usuarios distintos necesarios para declarar nivel alto.'),
  ('radio_verificacion_m',    300,   'Radio en metros para marcar verificado_en_sitio.')
on conflict (clave) do nothing;

-- Lectura tipada de un parámetro. Devuelve NULL si la clave no existe.
create or replace function public.fn_config(p_clave text)
returns numeric
language sql
stable
set search_path = public
as $$
  select valor from public.config_probabilidad where clave = p_clave;
$$;

comment on function public.fn_config(text) is
  'Devuelve el valor numérico de un parámetro de config_probabilidad (NULL si no existe).';

-- RLS: lectura pública, escritura solo service_role.
alter table public.config_probabilidad enable row level security;

drop policy if exists "config_probabilidad lectura publica" on public.config_probabilidad;
create policy "config_probabilidad lectura publica"
  on public.config_probabilidad for select using (true);

grant select on public.config_probabilidad to anon, authenticated;
