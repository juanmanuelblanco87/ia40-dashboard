# Módulo de Importaciones — Icom Salud / Cobus Group

Documentación técnica completa del proyecto. Última actualización: 16/07/2026.

Este documento describe qué hace la app, cómo está armada, de dónde salen los
datos, y el historial de bugs importantes ya resueltos (para no repetirlos).
Está pensado para que cualquiera (incluida una sesión nueva de Claude sin
contexto previo) pueda entender el proyecto entero leyendo solo este archivo.

## 1. Qué es esto

Dashboard interno de inteligencia comercial que trackea, mes a mes, las
importaciones argentinas de equipamiento médico/ortopédico (sillas de ruedas,
andadores, bastones, camas hospitalarias, etc.), agrupadas por marca, modelo,
proveedor/importador, color y segmento. Los datos crudos salen de **IA40**
(la plataforma de inteligencia de comercio exterior de **Cobus Group**), que
expone despachos de aduana filtrados por posición arancelaria (NCM).

La app corre en **Vercel** (Next.js 14, App Router) contra una base
**Postgres en Neon**. Un cron diario sincroniza los datos nuevos.

**Flujo de trabajo del equipo (importante):** no se usa git localmente. Los
cambios de código se editan pegando el contenido completo del archivo en la
interfaz web de GitHub (Add file / editar archivo existente), y el SQL se
corre a mano en la consola de Neon. No hay `git push` ni deploy por CLI.

## 2. Arquitectura general

```
IA40 (Cobus Group)  →  /api/sync (cron diario, Vercel)  →  Neon Postgres  →  Dashboard (Next.js)
        ↑                                                        ↑
        |                                                        |
  refresh_token.py (PC del usuario, Windows)            /admin (correcciones manuales)
  mantiene el JWT de IA40 actualizado en la tabla
  app_settings, vía login automatizado con Playwright
```

Dos flujos de lectura de IA40 conviven, según si la categoría tiene un
parser de marca/modelo registrado o no:

- **`lib/ia40.ts`** — cliente del endpoint viejo `POST /data`, paginado. Lee
  el JWT directo de la variable de entorno `IA40_JWT`. Se usa para categorías
  **sin** parser registrado (`categoryUsesExportFlow(slug)` da `false`).
- **`lib/ia40Export.ts`** — cliente del flujo de **exportación** (`/export/data`
  + polling de `/notification/{id}` + descarga de un ZIP/CSV en S3). Es el
  único que trae la columna `SUB ITEMS - SUFIJOS`, necesaria para identificar
  marca/modelo automáticamente. Lee el JWT de la tabla `app_settings`
  (`key='ia40_jwt'`), **no** de una variable de entorno. Se usa para todas las
  categorías con parser registrado en `lib/parsers`.

## 3. Stack técnico

- Next.js 14.2 (App Router), React 18, TypeScript.
- Postgres (Neon), driver `pg` directo (sin ORM). Ver `lib/db.ts` (pool
  singleton, `ssl: rejectUnauthorized:false`, `max:5`).
- Recharts para gráficos.
- `jszip` para descomprimir el export de IA40 cuando llega zippeado.
- Deploy: Vercel, con un cron job (`vercel.json`) y despliegue automático al
  actualizar archivos desde la web de GitHub.
- Sin test suite ni CI configurados.

## 4. Categorías y códigos NCM

Actualmente hay **9 categorías** activas (la tabla `categories` en la base es
la fuente de verdad; `sql/schema.sql` solo trae el seed original de una sola
categoría piloto — ver sección 11 sobre desactualización del schema).

| Categoría | Slug | NCM | Notas |
|---|---|---|---|
| Sillas de Ruedas | `sillas_de_ruedas` | 8713.10.00 | Categoría piloto original |
| Sillas de Ruedas Eléctricas | `sillas_ruedas_electricas` | 8713.90.00 | — |
| Andadores | `andadores` | 9021.10.10 | **NCM compartido** (ver abajo) |
| Bastones | `bastones` | 9021.10.10 | **NCM compartido** (ver abajo) |
| Calzado Ortopédico | `calzado_ortopedico` | 9021.10.10 | **NCM compartido**, agregada después del resto |
| Almohadones Ortopédicos | `almohadones_ortopedicos` | 9404.90.00 | — |
| Sillas de Ducha | `sillas_ducha` | 9401.79.00 | — |
| Elevadores de Inodoro | `elevadores_inodoro` | 3922.20.00 | — |
| Camas Hospitalarias | `camas_hospitalarias` | 9402.90.20 | — |

La investigación completa de estos códigos (metodología, confianza,
alternativas descartadas) está en `docs/ncm_nuevas_categorias.md`.

### Caso especial: NCM 9021.10.10 compartido

Andadores, Bastones y Calzado Ortopédico declaran aduaneramente bajo el
**mismo** código NCM (9021.10.10). En vez de pedirle a IA40 el mismo export
tres veces, `/api/sync` lo pide **una sola vez** y lo reparte por fila según
`parseOrtopedia9021Row()` (`lib/parsers/index.ts`), que interpreta el texto de
la columna "sufijos" (formato `"<MARCA> SIN MODELO <código> (CA00)"`) contra
un diccionario de marcas conocidas (`ORTOPEDIA_MARCA_DICT`) para decidir a
qué categoría y segmento pertenece cada fila. Filas que no matchean ninguna
marca del diccionario se aproximan por la descripción de la posición
arancelaria; si tampoco matchean nada específico, se descartan
(`categoriaSlug: null`, contado como `descartadas_otras_categorias` en la
respuesta de `/api/sync`).

Este código y este diccionario fueron la fuente de un bug importante de
contaminación de datos — ver sección 10.

## 5. Esquema de base de datos

⚠️ **`sql/schema.sql` en el repo está desactualizado.** Le faltan dos tablas
que sí existen en la base real de Neon (creadas ahí a mano, nunca
retro-documentadas en este archivo):

- **`app_settings`** — tabla clave/valor genérica. Hoy solo se usa para
  guardar el JWT de IA40 (`key='ia40_jwt'`, columnas `value`, `updated_at`).
  La lee `lib/ia40Export.ts` → `getStoredJwt()`.
- **`model_segmento_override`** (columnas: `category_id`, `marca`, `modelo`,
  `segmento`, `updated_at`, unique en `category_id+marca+modelo`) — permite
  corregir a mano el segmento calculado por el parser para una combinación
  marca+modelo puntual, sin esperar al próximo sync. La usa `/api/evolution`
  (con `LEFT JOIN` + `coalesce`) y `/api/model-overrides`.

Si se reconstruye la base desde cero, hay que crear estas dos tablas a mano
además de correr `sql/schema.sql`.

Tablas que **sí** están documentadas en `sql/schema.sql` (141 líneas):
`categories`, `category_ncm_codes`, `field_mappings`, `trade_records` (la
tabla principal, una fila por línea de despacho, con `source_hash` único para
deduplicar en re-syncs), `monthly_brand_model_agg` (agregado mensual
precalculado que lee el front), `provider_brand_map` y `record_brand_map`
(correcciones manuales de marca/modelo por importador o por línea individual),
`sync_runs` (historial de corridas de sync), `model_images` (cache de
imágenes por marca/modelo).

## 6. Flujo de sincronización (`/api/sync`)

Endpoint: `GET /api/sync` (protegido por `CRON_SECRET`, ver sección 12).
Acepta `?category=<slug>` opcional para sincronizar una sola categoría (más
rápido, útil para diagnosticar una categoría puntual sin esperar a las otras
8 — importante en el plan Hobby de Vercel, con límite de 60s por request salvo
que se suba a Pro, que es lo que permite el `maxDuration=300` declarado).

**Rango de fechas (`dateRangeLastNMonths`):** trae por defecto los últimos 24
meses (`SYNC_MONTHS_BACK`). Nunca incluye el mes calendario actual: aplica un
"período de gracia" (`SYNC_DATA_LAG_DAYS`, default 15 días) porque los datos
de aduana tardan en cargarse completos. Si hoy es el día 15 del mes o antes,
el rango retrocede un mes extra. **Consecuencia práctica:** cualquier fila en
`trade_records` con `period` igual o posterior al mes calendario en curso es,
por construcción, sintética/errónea (nunca la trae el sync real) — ver el bug
de la sección 10.

**Para cada categoría:**
1. Si es una de las 3 de NCM compartido (sección 4), usa el bloque especial
   que pide el export una sola vez y reparte por `parseOrtopedia9021Row`.
2. Si no, recorre sus NCM (`category_ncm_codes`) y por cada uno decide el
   flujo de lectura: exportación (`lib/ia40Export.ts`) si la categoría tiene
   parser registrado, o `/data` paginado (`lib/ia40.ts`) si no.
3. Cada fila se upsertea en `trade_records` vía `upsertRawRecords` /
   `upsertPreParsedRecords` (`lib/aggregate.ts`), dedupeando por
   `source_hash` (hash SHA-256 del JSON crudo de la fila — mismo despacho
   físico = mismo hash, sin importar qué categoría lo clasificó).
4. Se recalcula `monthly_brand_model_agg` para la categoría
   (`recomputeMonthlyAgg`).
5. Se registra el resultado en `sync_runs` y se devuelve un JSON con
   diagnóstico detallado por categoría (`fetched`, `inserted`,
   `skipped_sin_fecha`, hashes de muestra, conteos de verificación).

## 7. Mecanismo de autenticación con IA40

Hay **dos mecanismos separados** conviviendo, uno por cada cliente:

**a) `lib/ia40.ts` (flujo `/data`, categorías sin parser):** lee el JWT
directo de la variable de entorno `IA40_JWT` en Vercel. Si vence, hay que
actualizar la variable a mano en Vercel.

**b) `lib/ia40Export.ts` (flujo de exportación, categorías con parser —
la mayoría hoy):** lee el JWT de la tabla `app_settings` en Neon, con un
chequeo de antigüedad (`MAX_TOKEN_AGE_MIN = 20` minutos — si el token
guardado tiene más de 20 min, tira `Ia40AuthError` y el sync de esa
categoría falla ese día hasta que se actualice). Este token se mantiene
fresco automáticamente mediante:

- **`CobusSync_Installer/`** — instalador para Windows (`Instalar.bat` +
  `install.ps1` + `refresh_token.py`) que el usuario corre una vez en su PC.
  Programa una tarea de Windows que corre `refresh_token.py` cada 10 minutos
  (incluso después de reiniciar la PC), y deja un log en
  `%LOCALAPPDATA%\CobusSync\log.txt`. También crea un ícono de escritorio que
  abre el dashboard en una ventana propia.
- **`refresh_token.py`** — abre un Chrome real headless (Playwright), con
  scripts anti-detección (`STEALTH_JS`: oculta `navigator.webdriver`, etc.),
  hace login real en cobusgroup.com con usuario/contraseña de Cobus
  (hardcodeados en el script — el archivo advierte explícitamente "no lo
  compartas fuera del equipo"), captura el JWT de la URL de redirect, y lo
  **envía por POST a `VERCEL_TOKEN_ENDPOINT`** (configurado como
  `.../api/token`) con `Authorization: Bearer <TOKEN_UPDATE_SECRET>`.

⚠️ **Hallazgo al documentar (16/07/2026): el endpoint `/api/token` no existe
en el repo.** Se buscó en `app/api/*` y no hay ninguna carpeta `token/`.
`refresh_token.py` y todo el mecanismo de `CobusSync_Installer` asumen que
existe un endpoint Next.js que recibe `{ token }` y lo guarda en
`app_settings` (`key='ia40_jwt'`), pero ese código no está en el proyecto —
o se perdió en algún momento, o nunca se llegó a crear. Vale la pena
confirmar con el usuario si el instalador está corriendo hoy sin error (el
log de `%LOCALAPPDATA%\CobusSync\log.txt` lo diría: si dice "OK" es que el
endpoint sí responde en producción aunque no esté en este código fuente; si
tira error 404, hay que crear `app/api/token/route.ts`).

## 8. Parsers (marca / modelo / color / segmento)

`lib/parsers/index.ts` (1190 líneas) y `lib/parsers/sillasDeRuedas.ts` (269
líneas, parece ser el parser original/piloto — no está claro si sigue en uso
o quedó reemplazado por la lógica generalizada en `index.ts`, revisar si se
puede borrar).

`CATEGORY_PARSERS` es un diccionario `slug → función parser`. Cada parser
recibe la fila cruda de IA40 y devuelve `{ marca, modelo, color?, segmento? }`
o `null`. `categoryUsesExportFlow(slug)` decide si una categoría necesita el
flujo de exportación: es `true` si tiene parser registrado en
`CATEGORY_PARSERS` o si es una de las 3 categorías de NCM compartido
(sección 4).

El caso especial `parseOrtopedia9021Row()` (descripto en la sección 4) tiene
su propia lógica de normalización de texto (mayúsculas, corrección de typos
de marca vía `normalizeOrtopediaMarcaTypo`) y un diccionario de marca →
categoría/segmento armado a mano sobre el dataset real.

## 9. Corrección manual de datos (`/admin`)

Cuando el parser automático no identifica bien una fila, hay tres niveles de
corrección manual, de más general a más específico (cada uno tiene prioridad
sobre el nivel anterior y se aplica **sin esperar al próximo sync**):

1. **Por importador entero** (`provider_brand_map`, `POST /api/providers`) —
   asigna marca/modelo/color a todas las filas de un importador.
2. **Por línea individual** (`record_brand_map`, `POST /api/records`) — un
   mismo importador puede traer varias marcas; esto corrige una fila puntual.
3. **Por segmento/imagen de un modelo** (`model_segmento_override` +
   `model_images`, `POST /api/model-overrides`) — corrige el segmento
   calculado por el parser, o carga una imagen a mano, para una combinación
   marca+modelo específica.

Los tres disparan `recomputeMonthlyAgg(categoryId)` (los dos primeros) o se
aplican en el momento de la consulta vía `LEFT JOIN` (el tercero, en
`/api/evolution`), así el dashboard refleja el cambio al instante.

## 10. Imágenes de modelos

`lib/imageSearch.ts` — cliente de SerpApi (Google Images), necesita
`SERPAPI_API_KEY`. 250 búsquedas gratis por mes. Tira `QuotaExceededError` si
se agota la cuota.

`lib/modelImages.ts` — `getOrSearchModelImage()` busca (o devuelve de cache)
la imagen de una combinación marca+modelo puntual, **on-demand**: se llama
desde el botón "Ver imagen" del dashboard (`POST /api/model-images/search`).
Solo re-busca si el estado guardado no es `'found'` ni `'not_found'`.

También existe `backfillModelImages()` y el endpoint `GET /api/sync-images`
para precalentar el catálogo en bloque, pero **no está enganchado a ningún
cron** (`vercel.json` solo declara el cron de `/api/sync`) — es manual, para
correrlo a mano si se quiere.

## 11. Endpoints API

| Endpoint | Método | Qué hace |
|---|---|---|
| `/api/sync` | GET | Sincroniza datos desde IA40 (todas las categorías, o una con `?category=`). Cron diario 6am UTC. |
| `/api/sync-images` | GET | Backfill manual de imágenes (no automático). |
| `/api/categories` | GET | Lista categorías con sus NCM asociados. |
| `/api/evolution` | GET | Serie mensual filtrable (marca/modelo/importador/color/segmento) para el gráfico y tablas del dashboard. Aplica `model_segmento_override`. |
| `/api/providers` | GET/POST | Lista importadores de una categoría (GET) / mapea importador→marca/modelo/color (POST). |
| `/api/records` | GET/POST | Lista líneas de detalle de una categoría, opcionalmente por importador (GET) / clasifica una línea puntual (POST). |
| `/api/model-images` | GET | Estado de búsqueda de imagen por marca/modelo de una categoría. |
| `/api/model-images/search` | POST | Busca (o cachea) la imagen de un modelo puntual, on-demand. |
| `/api/model-overrides` | POST | Corrige a mano segmento y/o imagen de una combinación marca+modelo. |
| `/api/token` | — | **No existe en el repo** (ver sección 7) — debería recibir el JWT que manda `refresh_token.py`. |

## 12. Variables de entorno

⚠️ `.env.example` en el repo está desactualizado (todavía sugiere `IA40_JWT`
como único mecanismo de auth). Lista real de variables usadas en el código:

| Variable | Usada en | Propósito |
|---|---|---|
| `DATABASE_URL` | `lib/db.ts` | Conexión a Neon. |
| `IA40_JWT` | `lib/ia40.ts` | JWT para el flujo `/data` (categorías sin parser). Se actualiza a mano en Vercel. |
| `CRON_SECRET` | `app/api/sync/route.ts`, `app/api/sync-images/route.ts` | Protege los endpoints (`Authorization: Bearer` o `?secret=`). Si no está seteada, no bloquea (pensado para dev local). |
| `SYNC_MONTHS_BACK` | `app/api/sync/route.ts` | Meses de historial a traer en cada sync (default 24). |
| `SYNC_DATA_LAG_DAYS` | `app/api/sync/route.ts` | Días de gracia antes de considerar completo el mes anterior (default 15). |
| `SERPAPI_API_KEY` | `lib/imageSearch.ts` | Búsqueda de imágenes. |
| `IMAGE_BACKFILL_LIMIT` | `app/api/sync-images/route.ts` | Límite de imágenes a buscar por categoría en el backfill manual (default 80). |
| `TOKEN_UPDATE_SECRET` | referenciada por `refresh_token.py` | Secreto compartido para el endpoint `/api/token` (que hoy no existe — ver sección 7). |

## 13. Frontend

- **`app/page.tsx`** — dashboard principal: selector de categoría, filtros
  (marca/modelo/importador/color/segmento, con dropdown multi-selección
  buscable, `components/MultiSelectDropdown.tsx`), KPIs de header (último
  mes y últimos 12 meses, FOB y unidades), gráfico de evolución
  (`components/EvolutionChart.tsx`, Recharts, top 9 + "Otros"), tablas de
  share por importador/marca/modelo/segmento, y modal de imagen por modelo
  con edición inline de segmento/imagen.
- **`app/admin/page.tsx`** — pantalla de corrección manual: mapeo
  importador→marca/modelo/color y clasificación línea por línea.
- **`app/layout.tsx`** — layout raíz, carga la tipografía Poppins.
- **Diseño responsive** (`app/globals.css`): clases utilitarias
  (`.filter-field`, `.kpi-row`/`.stack-row` + `.panel`, `.chart-wrap`/
  `.pie-wrap`, `.table-scroll`, `.app-header-logo`) con breakpoints en
  900px, 640px (mobile), 1400px (pantallas anchas) y una regla especial por
  `orientation:landscape` + `max-height:480px` (celulares acostados). El
  ancho máximo del contenido es `min(1600px, 96vw)` — fluido en pantallas
  anchas/apaisadas, pero se comporta como los ~1180px de siempre en
  pantallas normales.

## 14. Deploy

Vercel + GitHub (deploy automático al actualizar un archivo desde la web de
GitHub, sin acción manual extra). `vercel.json` declara un único cron:
`/api/sync` todos los días a las 6am UTC. No hay cron para `/api/sync-images`
(ver sección 10).

## 15. Historial de bugs importantes (para no repetirlos)

- **Inflación de FOB 10x-100x** — `parseArgNumber` se aplicaba sin distinguir
  el formato argentino (miles con ".", decimal con ",") del formato plano
  (solo "." decimal) que usa `SUB ITEMS - FOB U$S`. Corregido con detección
  de formato antes de parsear (`parseMoneyOrPlain`).
- **Pérdida de datos por ZIP** — el export de IA40 a veces llega
  comprimido en ZIP en vez de CSV plano; `downloadExportFile` ahora detecta
  el ZIP por sus magic bytes y lo descomprime con `jszip` antes de parsear.
- **`ON CONFLICT` no actualizaba `category_id`** — al re-procesar una fila ya
  insertada (mismo `source_hash`) bajo una categoría distinta a la original
  (por ejemplo, tras corregir el diccionario de marcas de ortopedia), el
  `ON CONFLICT ... DO UPDATE` solo tocaba marca/modelo/color/segmento, y la
  fila quedaba pegada para siempre a la categoría vieja. Corregido agregando
  `category_id`, `ncm_code`, `period`, `cuit`, `raw`, `fob_dolars` al
  `DO UPDATE SET` en ambas funciones de upsert (`lib/aggregate.ts`).
- **Contaminación de NCM legacy en "bastones"** — antes de la arquitectura de
  NCM compartido, bastones usaba un NCM histórico distinto (6602.00.00); tras
  migrar a 9021.10.10 compartido, quedaron ~737 filas viejas mezcladas con
  las ~371 correctas. Se limpiaron con un DELETE dirigido por NCM. **Pendiente
  de confirmación final del usuario** (tarea #57 en el historial de trabajo).
- **"Último mes" mostrando 0 USD / 0 unidades** — cuando una fila traía una
  fecha no parseable, el código la insertaba igual usando **la fecha de HOY**
  como fallback de período. Esto creaba un mes falso (ej. el mes calendario
  en curso) con `record_count > 0` pero FOB/unidades en 0, que — por ser
  cronológicamente el más reciente — ganaba como "Último mes" en el
  dashboard y tapaba el mes real anterior. Corregido: esas filas ahora se
  **descartan** en vez de insertarse con fecha inventada (contador
  `skippedSinFecha` en `lib/aggregate.ts`). Cualquier fila con
  `period >= <mes calendario actual>` en `trade_records` es sospechosa de
  ser basura de este bug (el sync nunca trae el mes en curso, ver sección 6)
  y es seguro borrarla. **Pendiente de confirmación final del usuario**
  (tarea #59).

## 16. Deuda técnica conocida / pendientes

- `sql/schema.sql` no incluye `app_settings` ni `model_segmento_override`
  (sección 5) — reconstruir la base desde este archivo solo no alcanza.
- `README.md` y `.env.example` describen una versión vieja del proyecto (una
  sola categoría piloto, auth solo por variable de entorno) — no reflejan el
  estado actual. Convendría actualizarlos o al menos linkearlos a este
  documento.
- El endpoint `/api/token` que necesita `refresh_token.py` no existe en el
  repo (sección 7) — confirmar si está corriendo en producción por otra vía,
  o si hay que crearlo.
- `lib/parsers/sillasDeRuedas.ts` podría estar huérfano (reemplazado por la
  lógica generalizada de `lib/parsers/index.ts`) — revisar si se puede
  eliminar.
- El backfill de imágenes (`/api/sync-images`) no corre automáticamente
  (sección 10) — es 100% manual hoy.
- Limpiezas de datos pendientes de confirmación final (sección 15, bastones
  y filas fantasma de julio 2026).

## 17. Cómo agregar una categoría nueva (receta rápida)

1. Confirmar el código NCM real contra IA40 (ver metodología en
   `docs/ncm_nuevas_categorias.md`).
2. Insertar en `categories` y `category_ncm_codes` (SQL manual en Neon).
3. Insertar los `field_mappings` necesarios si los nombres de campo del JSON
   crudo no son los default (`marca_comercial`, etc. — ver
   `getFieldMappings`/`mappingLookup` en `lib/aggregate.ts`).
4. Si necesita identificar marca/modelo automáticamente, registrar un parser
   en `CATEGORY_PARSERS` (`lib/parsers/index.ts`) — esto activa
   automáticamente el flujo de exportación para esa categoría.
5. Correr `/api/sync?category=<slug>` para probar en aislado antes del sync
   completo.
