-- ---------------------------------------------------------------------------
-- 0006 · Hábitat y afinidad terreno → tipo de Pokémon
-- ---------------------------------------------------------------------------
-- `terrenos` es el vocabulario de terreno. Es deliberadamente DISTINTO de
-- `habitats.tipo_area` (bosque/agua/parque/urbano/costero): celdas_habitat mide
-- composición de suelo por celda H3 y se reconciliará con `habitats` cuando la
-- capa de cálculo lo necesite.
--
-- Ambos catálogos son datos editables: cambiar pesos o porcentajes no requiere
-- tocar código. La lectura es pública; la escritura, solo service_role.
-- ---------------------------------------------------------------------------

-- 1) Vocabulario de terreno -------------------------------------------------
create table if not exists public.terrenos (
  id    text primary key,
  label text not null
);

insert into public.terrenos (id, label) values
  ('agua',        'Agua'),
  ('parque',      'Parque'),
  ('bosque',      'Bosque'),
  ('urbano',      'Urbano'),
  ('industrial',  'Industrial'),
  ('cerro',       'Cerro'),
  ('cementerio',  'Cementerio')
on conflict (id) do update set label = excluded.label;

comment on table public.terrenos is
  'Tipos de terreno usados por celdas_habitat y afinidad_terreno.';

-- 2) Composición de cada celda H3 -------------------------------------------
-- Porcentaje 0-100 de cada terreno en la celda. No se fuerza que sumen 100:
-- puede haber suelo sin clasificar.
create table if not exists public.celdas_habitat (
  h3_index       text not null,
  terreno        text not null references public.terrenos(id) on delete restrict,
  porcentaje     numeric(5, 2) not null,
  actualizado_en timestamptz not null default now(),
  primary key (h3_index, terreno),
  constraint celdas_habitat_porcentaje_valido
    check (porcentaje >= 0 and porcentaje <= 100)
);

comment on table public.celdas_habitat is
  'Porcentaje (0-100) de cada terreno en una celda H3. La suma no tiene por qué ser 100.';

create index if not exists celdas_habitat_terreno_idx
  on public.celdas_habitat (terreno);

drop trigger if exists trg_celdas_habitat_actualizado on public.celdas_habitat;
create trigger trg_celdas_habitat_actualizado
  before update on public.celdas_habitat
  for each row execute function public.fn_set_actualizado_en();

-- 3) Afinidad terreno -> tipo de Pokémon ------------------------------------
-- `peso` es relativo: positivo favorece, negativo penaliza, 0 es neutro. Lo
-- consumirá la futura función de probabilidad.
create table if not exists public.afinidad_terreno (
  terreno        text not null references public.terrenos(id) on delete restrict,
  pokemon_tipo   text not null references public.pokemon_tipos(id) on delete restrict,
  peso           numeric not null default 0,
  actualizado_en timestamptz not null default now(),
  primary key (terreno, pokemon_tipo)
);

comment on table public.afinidad_terreno is
  'Peso de cada tipo de Pokémon en cada terreno. Editable sin tocar código.';
comment on column public.afinidad_terreno.peso is
  'Peso relativo: positivo favorece, negativo penaliza, 0 neutro.';

create index if not exists afinidad_terreno_tipo_idx
  on public.afinidad_terreno (pokemon_tipo);

drop trigger if exists trg_afinidad_terreno_actualizado on public.afinidad_terreno;
create trigger trg_afinidad_terreno_actualizado
  before update on public.afinidad_terreno
  for each row execute function public.fn_set_actualizado_en();

-- 4) Seguridad a nivel de fila ----------------------------------------------
alter table public.terrenos         enable row level security;
alter table public.celdas_habitat   enable row level security;
alter table public.afinidad_terreno enable row level security;

drop policy if exists "terrenos lectura publica" on public.terrenos;
create policy "terrenos lectura publica"
  on public.terrenos for select using (true);

drop policy if exists "celdas_habitat lectura publica" on public.celdas_habitat;
create policy "celdas_habitat lectura publica"
  on public.celdas_habitat for select using (true);

drop policy if exists "afinidad_terreno lectura publica" on public.afinidad_terreno;
create policy "afinidad_terreno lectura publica"
  on public.afinidad_terreno for select using (true);

grant select on public.terrenos, public.celdas_habitat, public.afinidad_terreno
  to anon, authenticated;
