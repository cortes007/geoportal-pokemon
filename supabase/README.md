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

`0001`–`0009` **ya están aplicadas** y son históricas: no las edites. `0008` quedó verificada con el
seed del catálogo, que corrió después. `0009` quedó aplicada y probada; el Advisor está en las 3
advertencias aceptadas. Su `ALTER DEFAULT PRIVILEGES` por esquema **no tuvo efecto** sobre el
`EXECUTE` global de `PUBLIC` (los defaults por esquema solo suman a los globales). **La próxima
migración libre es `0010` y es de la Fase 5**; no hay migración de corrección de privilegios: la
garantía es el patrón `REVOKE`/`GRANT` explícito de la sección siguiente.

**Estado del catálogo:** el seed ya se ejecutó. `pokemon_catalogo` tiene **1025 Pokémon**,
filtrados a la Pokédex nacional sobre **1351** procesados. Fase 5 no iniciada.

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

## Qué NO hace estas migraciones

- No ejecutan el seed del catálogo. Eso es `scripts/seed-catalogo.mjs`.
- No implementan la función de probabilidad/nivel: `celdas_habitat`,
  `afinidad_terreno` y `config_probabilidad` quedan listos para esa fase.
- No cambian el frontend. `reportes` exige sesión autenticada para insertar, y la
  app todavía no tiene login; hasta esa fase, la escritura real sigue pasando por
  `avistamientos` (y el trigger espejo la copia a `reportes`).
- `0009` **no cierra** la política de inserción anónima de `avistamientos` ni el trigger espejo.
  Ambos son temporales hasta la Fase 7: la app no se publica hasta cerrarlos.

## Pendientes vigentes

| Pendiente | Fase |
|---|---|
| Política de `avistamientos` y trigger espejo | 7 |
| `terrenos` vs `habitats.tipo_area` | 6 |
| Ids de tipo de reporte en `constants.js` | 6 y 7 |
| Poda de skills de Mapbox, MapLibre y Strix | antes de la 6 |
| `h3_index` de los reportes migrados | 5 |
| Contraseñas filtradas en Auth | revisar en la 7 |

## Claves de entorno para scripts

Los scripts locales leen del `.env` (no versionado):

```
SUPABASE_URL=https://<proyecto>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
```

La `service_role` **nunca** se usa en el frontend ni lleva prefijo `VITE_`.

- `.env` contiene la `service_role` y **debe seguir ignorado en git** (`.gitignore` cubre `.env`,
  `.env.local` y `*.local`).
- El caché de Overpass de la Fase 5 irá en una carpeta **ignorada** por git (por ejemplo
  `scripts/.overpass-cache/`).
