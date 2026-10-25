# Base de datos · Supabase

Este directorio contiene el esquema del Geoportal Pokémon GO.

- `schema.sql`: arranque histórico. Crea `avistamientos`, `habitats`, su RLS y la
  RPC `listar_avistamientos_recientes`. **Se conserva** por compatibilidad, pero
  a partir de ahora el modelo nuevo vive en `migrations/`.
- `migrations/`: fuente de verdad del modelo `reportes`.
- `tests/`: pruebas SQL transaccionales que terminan en `ROLLBACK`.

## Orden de aplicación

| # | Archivo | Qué crea |
|---|---|---|
| 0001 | `0001_extensiones.sql` | PostGIS, pgcrypto y `fn_set_actualizado_en()` |
| 0002 | `0002_catalogos.sql` | `pokemon_tipos`, `pokemon_catalogo`, `perfiles` |
| 0003 | `0003_config_probabilidad.sql` | Parámetros editables y `fn_config()` |
| 0004 | `0004_reportes.sql` | `reportes`, triggers de negocio y `reportes_vigentes` |
| 0005 | `0005_confirmaciones.sql` | `confirmaciones` (un voto por usuario y reporte) |
| 0006 | `0006_habitat_afinidad.sql` | `terrenos`, `celdas_habitat`, `afinidad_terreno` |
| 0007 | `0007_avistamientos_a_reportes.sql` | Backfill + trigger espejo de continuidad |
| 0008 | `0008_service_role_pokemon_catalogo.sql` | Permisos explícitos de `service_role` sobre `pokemon_catalogo` |
| 0009 | `0009_endurecimiento_seguridad.sql` | `search_path` fijo y `EXECUTE` revocado a las funciones de trigger (el intento de defaults por esquema no tuvo efecto) |
| 0010 | `0010_fase5_esquema_datos.sql` | Fase 5A: `celdas_h3`, `terreno_poligonos`, FK de `celdas_habitat`, configuración y funciones de recálculo |

`0001`–`0009` **ya están aplicadas** y son históricas: no las edites. `0008` quedó verificada con el
seed del catálogo, que corrió después. `0009` quedó aplicada y probada; el Advisor está en las 3
advertencias aceptadas. Su `ALTER DEFAULT PRIVILEGES` por esquema **no tuvo efecto** sobre el
`EXECUTE` global de `PUBLIC` (los defaults por esquema solo suman a los globales). **`0010` está
escrita pero pendiente de aplicar y verificar por el usuario**; no la edites una vez aplicada.

**Estado del catálogo:** el seed ya se ejecutó. `pokemon_catalogo` tiene **1025 Pokémon**,
filtrados a la Pokédex nacional sobre **1351** procesados. **Fase 5A escrita, pendiente de aplicar
y de cargar datos.** No se ejecutaron cargas reales ni las pruebas SQL; el usuario debe aplicarlas
y verificarlas. La Fase 5B (`pokemon_cercanos`) no se ha iniciado.

Las migraciones son idempotentes en su mayoría (`if not exists`, `create or
replace`, `on conflict`), pero Supabase las registra y no las reejecuta. No las
edites una vez aplicadas: añade una migración nueva.

## Cómo aplicarlas

Con la CLI de Supabase (recomendado, guarda el historial):

```bash
supabase link --project-ref <tu-project-ref>
supabase db push
```

Alternativa sin CLI: pega el contenido de cada archivo **en orden** en el SQL
Editor del proyecto.

## Requisitos previos

1. `supabase/schema.sql` ya aplicado (esta migración lee `public.avistamientos`).
2. PostGIS disponible (Supabase lo trae; la migración lo instala si falta).

## Funciones nuevas: regla de privilegios

Toda migración que cree una función debe quitar el `EXECUTE` por defecto y concederlo solo a quien
lo use, en la misma migración:

```sql
revoke execute on function public.<fn>(<args>) from public, anon, authenticated;
grant  execute on function public.<fn>(<args>) to <rol_que_la_usa>;
```

No se confía en `ALTER DEFAULT PRIVILEGES` para quitar `PUBLIC`: los defaults **por esquema se
suman** a los globales, y el `EXECUTE` de `PUBLIC` es global. Además, la regla es **por rol dueño**
(solo afecta a objetos creados por el rol que la ejecuta, o el de `FOR ROLE`). Por eso la garantía
es el `REVOKE` explícito por función.

- Cada función fija su `search_path`: `public, extensions` si usa PostGIS; `public` en el resto.
- Cada función nueva lleva una prueba de permisos basada en
  `supabase/tests/patron_funciones_nuevas.sql`.
- El Advisor se revisa al cerrar cada fase.

Motivo del fallo de `0009`: su `alter default privileges in schema public revoke execute ...` no
podía quitar el `EXECUTE` global de `PUBLIC`. La documentación de PostgreSQL es explícita: los
privilegios por defecto **por esquema se suman** a los globales, así que un `REVOKE` con
`IN SCHEMA` solo deshace un `GRANT` por esquema. Para quitar el `EXECUTE` de `PUBLIC` haría falta un
`ALTER DEFAULT PRIVILEGES` **global**, que aquí **no** se usa a propósito: afectaría a toda función
futura en todos los esquemas, incluidas las que crean las extensiones (PostGIS, `pgcrypto`,
`pg_graphql`, etc.), que suelen depender del `EXECUTE` a `PUBLIC` por defecto.

La consulta a `pg_default_acl` no muestra filas para `postgres` en `public` ni globales (solo
defaults de esquemas internos de Supabase), así que no hay un default por esquema que revertir. La
garantía es el patrón explícito por función; **no** una migración vacía. Si la función la llama un
script de Node con `service_role`, el `GRANT` debe incluir `service_role`: hereda de `PUBLIC` y no
tiene `EXECUTE` propio.

## Pruebas SQL

- `supabase/tests/0009_verificar_triggers.sql`: permisos de las seis funciones
  de trigger, `listar_avistamientos_recientes` y disparo de los seis triggers.
  No depende de los defaults.
- `supabase/tests/patron_funciones_nuevas.sql`: crea una función, aplica el
  `REVOKE` explícito, comprueba que `anon`/`authenticated` no ejecutan, aplica
  `GRANT` y comprueba que solo ejecutan los roles beneficiados. Incluye un caso
  informativo (no bloqueante) sin `REVOKE` que muestra que `anon` sí ejecuta por
  el default `PUBLIC`.

Ambas empiezan con `select current_user, session_user;`, terminan en `ROLLBACK` y devuelven una
tabla (`caso`, `resultado`, `detalle`) antes del rollback. Cada caso está aislado para que un
fallo no aborte el resto.

**Resultado del cierre (2026-10-20):** ambas pasaron. `0009_verificar_triggers.sql` dio `ok` en los
seis triggers y los permisos; `patron_funciones_nuevas.sql` dio `ok` en los casos bloqueantes, y el
caso informativo mostró `anon=t` sin `REVOKE` (default de `PUBLIC`). El trigger de registro se
probó de verdad: usuario creado en Authentication → fila en `perfiles` → usuario borrado.

## Fase 5A · Datos de terreno y malla H3

`0010_fase5_esquema_datos.sql` es la primera migración de la Fase 5. **No** normaliza
`pokemon_id`, **no** crea la FK a `pokemon_catalogo`, **no** toca la política de `avistamientos` ni
el trigger espejo y **no** implementa `pokemon_cercanos`; todo eso es 5B/0011. `0010` solo añade:

- `celdas_h3`: una fila por celda, `h3_index` PK, resolución, lat/lon, `centro geography(Point,4326)`
  generada, `geom geometry(MultiPolygon,4326)` e índices GiST. La malla se genera en Node con
  `h3-js`; Postgres no ejecuta `h3-js`.
- `terreno_poligonos`: polígonos y franjas de agua OSM por terreno, PK `(osm_tipo, osm_id)`, GiST,
  RLS sin lectura pública y DML solo para `service_role`.
- FK `celdas_habitat.h3_index -> celdas_h3.h3_index`.
- 11 claves nuevas en `config_probabilidad` (incluida `h3_resolucion = 9`).
- Índice `reportes(expira_en)`.
- `fn_normalizar_terreno_poligono` (trigger), `fn_recalcular_celdas_habitat` (invoker, solo
  `service_role`) y `fn_vaciar_terreno_poligonos` (definer, solo `service_role`).

### Atribución y licencia OSM

Los polígonos se derivan de OpenStreetMap. **Datos © OpenStreetMap contributors, ODbL 1.0.**
La atribución queda también en el comentario de la tabla `public.terreno_poligonos`. El frontend no
lee esta tabla; no se añade atribución visible nueva en el mapa.

### Decisiones de datos

- **Tolerancia de simplificación:** polígonos `0.0001` (~11 m). Líneas de río/quebrada
  `0.00001` (~1,1 m) **antes** de bufferizar; no se simplifica la franja con 11 m porque borraría
  quebradas de 6–12 m. Es la única excepción aprobada.
- **Prioridad de solape:** `agua > cementerio > industrial > parque > bosque > cerro`.
  `urbano` no se consulta: es el remanente `100 − suma explícita`, truncado a 2 decimales. Esto
  garantiza suma ≤ 100, pero **sobreestima lo urbano en zonas rurales sin clasificar**.
- **`cerro` sin cobertura inicial:** OSM no ofrece pendiente poligonal fiable. Los pesos de
  afinidad se cargan igual; falta elevación/DEM para otra fase.
- **Bbox operativo:** `-75.68,6.07,-75.32,6.48` (no es una frontera administrativa; incluye parte
  de Rionegro y laderas orientales). Con resolución 9 produce **16 640 celdas** y **378 tiles** de
  `0.02°`. El cálculo previo de 399 tiles era una estimación; el valor medido es 378.
- **Tiles de recálculo:** `0.02°`. **Bloques Overpass:** `0.1°`; el bbox con margen `0.02°` produce
  20 bloques y 5 peticiones por bloque (`agua`, `cementerio`, `industrial`, `parque`, `bosque`),
  en secuencia, con pausa de 10 s, consulta previa a `/api/status` y espera exponencial (30–300 s).
- **`--vaciar-terrenos`:** implementado, pero **no** está en `datos:todo` ni se recomienda en esta
  pasada. Solo se ejecuta tras un recálculo completo, sin tiles fallidos y con cobertura > 0.

### Scripts y orden de carga

Todos los scripts leen `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` del `.env` local (sin prefijo
`VITE_`). `--dry-run` no toca Supabase ni Overpass (en terrenos) y no requiere credenciales.

```bash
# 0) Aplicar 0010 (CLI recomendada; guarda historial)
supabase db push

# 1) Afinidad: primero dry-run y JSON de los 126 pares.
#    NO cargar de verdad hasta revisar/aprobar ese JSON.
npm run seed:afinidad -- --dry-run
npm run seed:afinidad -- --dry-run --json
npm run seed:afinidad

# 2) Primera corrida con bbox de prueba (siempre dry-run antes)
npm run datos:terrenos -- --dry-run --bbox=-75.60,6.19,-75.55,6.25
npm run datos:terrenos -- --bbox=-75.60,6.19,-75.55,6.25

npm run datos:celdas -- --dry-run --bbox=-75.60,6.19,-75.55,6.25 --max-tiles=1
npm run datos:celdas -- --bbox=-75.60,6.19,-75.55,6.25 --max-tiles=1

# 3) Carga final del bbox completo (primero dry-run)
npm run datos:terrenos -- --dry-run
npm run datos:terrenos

npm run datos:celdas -- --dry-run
# Medir un tile antes de lanzar los 378:
npm run datos:celdas -- --max-tiles=1
# Si el tile cabe en el timeout, lanzar el resto:
npm run datos:celdas

# 4) Si algún tile falla, el estado queda en
#    scripts/.overpass-cache/celdas-estado.json
npm run datos:celdas -- --solo-fallidos
# o, para reanudar desde un tile concreto (1-based):
npm run datos:celdas -- --desde-tile=120
```

`npm run datos:todo` encadena afinidad + terrenos + celdas, **sin** `--dry-run` y **sin**
`--vaciar-terrenos`. No usarlo hasta que el JSON de afinidad y la corrida de prueba estén aprobados.

### Timeout de la API con `service_role`

Según la documentación de Supabase (*Timeouts*): las llamadas del cliente/Dashboard tienen un
**máximo configurable de 60 s**. Los timeouts por rol por defecto son `anon` 3 s,
`authenticated` 8 s y `service_role` **sin timeout propio: hereda los 8 s de `authenticator` si no
se configura**. Por tanto, una RPC con `service_role` a través de PostgREST se corta a los **8 s**
por defecto, no a 60 s. El máximo configurable por API es 60 s; para transacciones más largas hay
que usar conexión directa o Supavisor, que no es el camino de estos scripts.

`--max-tiles=1` imprime el tiempo del tile. Si un tile se acerca a 8 s, hay que reducirlo o cambiar
el timeout de rol/función de forma explícita; `0010` no cambia timeouts globales.

### Pruebas

- `supabase/tests/0010_verificar_esquema_fase5a.sql`: columnas, PK/FK/índices, configuración, RLS,
  grants, `prosecdef`/`search_path`, permisos con `anon`/`authenticated`/`service_role`, trigger de
  normalización, solape/prioridad/urbano y `fn_vaciar` (solo si `terreno_poligonos` estaba vacía al
  inicio; si no, lo informa como omitido).
- `supabase/tests/0010_verificar_datos_fase5a.sql`: 126 pares de afinidad, conteos, porcentajes y
  sumas, huérfanos, geometrías, histograma urbano (0–25, 25–50, 50–90, >90), celdas sin ninguna
  fila, cobertura, Parque Lleras, `h3_resolucion` y tamaños. Es de solo lectura.
- `npm run test:scripts`: pruebas Node de conversión GeoJSON→EWKT, H3, teselado, prioridad de
  terrenos, anchos de agua, `osmtogeojson`, cliente Overpass (reintentos, `Retry-After`, `/api/status`)
  y caché/reanudación/`--archivo`.

### Dependencia OSM

`osmtogeojson` se fijó en **`3.0.0-beta.5`** con override **`@xmldom/xmldom@0.8.15`**. Es una beta
sin mantenimiento; solo se le pasa JSON de Overpass (no XML) y `npm audit` quedó en 0. El caché
crudo de Overpass vive en `scripts/.overpass-cache/terrenos/` (dentro de `scripts/.overpass-cache/`,
ya ignorado por git). El User-Agent es ASCII e identificable y las consultas son secuenciales con
backoff exponencial y soporte de `--archivo=ruta.json` como vía de respaldo.

### Hallazgo: los 4 `h3_index` nulos

Los 4 reportes/avistamientos con `h3_index` nulo son la **semilla histórica de `supabase/schema.sql`**,
copiada por `0007` y por el trigger espejo. **No es un fallo del frontend**: `useAvistamientos.js`
calcula H3 al insertar. `scripts/backfill-h3.mjs` está escrito para corregirlos, pero **no se ejecuta
en 5A**; se hará en 5B, después de respaldar `reportes`.

## Qué NO hace estas migraciones

- No ejecutan el seed del catálogo. Eso es `scripts/seed-catalogo.mjs`.
- No implementan `pokemon_cercanos` ni la función de probabilidad/nivel pública. `0010` solo deja
  la malla H3, los terrenos, la afinidad y el recálculo de composición; `pokemon_cercanos` es 5B.
- No cambian el frontend. `reportes` exige sesión autenticada para insertar, y la
  app todavía no tiene login; hasta esa fase, la escritura real sigue pasando por
  `avistamientos` (y el trigger espejo la copia a `reportes`).
- `0009` **no cierra** la política de inserción anónima de `avistamientos` ni el trigger espejo.
  Ambos son temporales hasta la Fase 7: la app no se publica hasta cerrarlos.
- `0010` no normaliza `pokemon_id`, no crea la FK a `pokemon_catalogo`, no toca el trigger espejo y
  no ejecuta `backfill-h3.mjs`.

## Pendientes vigentes

| Pendiente | Fase | Detalle |
|---|---|---|
| Política de `avistamientos` y trigger espejo | 7 | Bloquea publicación. |
| `terrenos` vs `habitats.tipo_area` | 6 | Reconciliar vocabulario. |
| Ids de tipo de reporte en `constants.js` | 6 y 7 | Faltan en frontend. |
| Poda de skills de Mapbox, MapLibre y Strix | antes de la 6 | Skills que no aplican. |
| Aplicar/verificar `0010` y cargar datos 5A | 5A | Pendiente de ejecución del usuario. |
| `h3_index` de reportes/avistamientos históricos | 5B | Los 4 nulos son la semilla de `schema.sql`, no un fallo del frontend. `backfill-h3.mjs` está escrito pero no ejecutado. |
| `pokemon_cercanos` y 0011/0012 | 5B | No iniciado; requiere aprobación tras verificar 5A. |
| Contraseñas filtradas en Auth | revisar en la 7 | Activar/verificar. |

## Claves de entorno para scripts

Los scripts locales leen del `.env` (no versionado):

```
SUPABASE_URL=https://<proyecto>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
```

La `service_role` **nunca** se usa en el frontend ni lleva prefijo `VITE_`.

- `.env` contiene la `service_role` y **debe seguir ignorado en git** (`.gitignore` cubre `.env`,
  `.env.local` y `*.local`). Hay una plantilla **`.env.example`** sin valores y sin prefijo `VITE_`.
- El caché de Overpass de la Fase 5 vive en `scripts/.overpass-cache/`, ya ignorado por git.
  También guarda `celdas-estado.json` para relanzar tiles fallidos.
