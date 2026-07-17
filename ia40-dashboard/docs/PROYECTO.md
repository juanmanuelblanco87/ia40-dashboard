# Módulo de Importaciones — Icom Salud / Cobus Group

Documentación técnica completa del proyecto. Última actualización: 17/07/2026.

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
| Almohadas y Cojines | `almohadones_ortopedicos` | 9404.90.00 | Renombrada 17/07/2026 (antes "Almohadones Ortopédicos" — ver nota abajo) |
| Sillas y Asientos | `sillas_ducha` | 9401.79.00 | Renombrada 17/07/2026 (antes "Sillas de Ducha" — ver nota abajo) |
| Elevadores de Inodoro | `elevadores_inodoro` | 3922.20.00 | — |
| Camas Hospitalarias | `camas_hospitalarias` | 9402.90.20 | — |

La investigación completa de estos códigos (metodología, confianza,
alternativas descartadas) está en `docs/ncm_nuevas_categorias.md`.

**Nota sobre los renombres (17/07/2026):** los `slug` internos
(`almohadones_ortopedicos`, `sillas_ducha`) NO cambiaron — solo la columna
`name` de `categories` (vía `UPDATE` manual en Neon), porque bajo esas NCM
en la práctica entra mucha data que no es ortopédica (ver "Patrón A/B y
segmentación por NCM" en la sección 8). Como los slugs no cambian, no hizo
falta tocar `category_ncm_codes` ni ningún foreign key.

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

⚠️ **`sql/schema.sql` en el repo está desactualizado.** Le faltan tablas
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
- **`model_sieve_log`** (nueva, 17/07/2026; columnas: `category_id`, `marca`,
  `modelo`, `checked_at`, `result`, `detail`, unique en
  `category_id+marca+modelo`) — registra qué combinaciones ya validó el
  "tamizador de segmentos" (sección 10.1), para no re-procesarlas ni re-gastar
  cuota de búsqueda/IA en corridas futuras.

Si se reconstruye la base desde cero, hay que crear estas tres tablas a mano
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

✅ **Verificado en producción (17/07/2026):** el mecanismo está funcionando.
Se confirmó corriendo en la consola de Neon:
```sql
select key, value, updated_at, now() - updated_at as antiguedad
from app_settings where key = 'ia40_jwt';
```
y `antiguedad` da unos pocos minutos (se actualiza solo cada 10 min, como se
espera).

⚠️ **Detalle raro para tener en cuenta:** no se encontró el archivo
`app/api/token/route.ts` (ni ningún archivo con "token" en el nombre fuera
de `refresh_token.py`) en esta copia local del repo. Como el mecanismo
funciona en producción, ese endpoint necesariamente existe en el código que
está desplegado en Vercel — solo que no está presente en esta carpeta local.
Probablemente se subió en algún momento directo desde la interfaz web de
GitHub y nunca se bajó/copió de vuelta a esta carpeta. **Recomendación:**
antes de editar o resubir cualquier archivo relacionado (`lib/ia40Export.ts`,
o cualquier cosa que toque `app_settings`), conviene entrar a GitHub y
confirmar si existe `app/api/token/route.ts` ahí, para no terminar con esta
carpeta local y el repo real desincronizados en otros archivos también.

### Cómo verificar que el token se está actualizando solo

Correr en la consola SQL de Neon:

```sql
select key, value, updated_at, now() - updated_at as antiguedad
from app_settings
where key = 'ia40_jwt';
```

- `antiguedad` de pocos minutos (menos de 20) → el mecanismo anda bien:
  `refresh_token.py` está corriendo en la PC del usuario cada 10 minutos y
  actualizando la base sin problema.
- `antiguedad` de varias horas/días, o la consulta no devuelve filas → el
  token dejó de actualizarse. Primer lugar donde mirar: el archivo
  `%LOCALAPPDATA%\CobusSync\log.txt` en la PC donde corre el instalador — ahí
  queda registrado "OK: token actualizado..." en cada corrida exitosa, o el
  motivo del error si falla (usuario/contraseña de Cobus vencidos, abono de
  Cobus vencido, usuario deshabilitado, etc. — ver los mensajes de error que
  arma `refresh_token.py`).

## 8. Parsers (marca / modelo / color / segmento)

`lib/parsers/index.ts` (~1740 líneas) y `lib/parsers/sillasDeRuedas.ts` (269
líneas, parece ser el parser original/piloto — no está claro si sigue en uso
o quedó reemplazado por la lógica generalizada en `index.ts`, revisar si se
puede borrar).

`CATEGORY_PARSERS` es un diccionario `slug → función parser`. Cada parser
recibe la fila cruda de IA40 y devuelve `{ marca, modelo, color?, segmento? }`
o `null`. `categoryUsesExportFlow(slug)` decide si una categoría necesita el
flujo de exportación: es `true` si tiene parser registrado en
`CATEGORY_PARSERS` o si es una de las 3 categorías de NCM compartido
(sección 4).

### Patrón A vs. Patrón B (¡importante, fuente de un bug grande!)

El texto de aduana ("SUB ITEMS - SUFIJOS") viene en dos formatos distintos
según la categoría, y **no son intercambiables**:

- **Patrón A** — `"<MARCA> <MODELO> SIN CODIGO (CA00)"`: marca y modelo van
  juntos, hay que separarlos por diccionario (`createCategoryParser`,
  motor genérico original armado para "Sillas de ruedas"). Lo usan
  `sillas_de_ruedas` y `sillas_ruedas_electricas`.
- **Patrón B** — `"<MARCA> SIN MODELO <código> (CA00)"`: `"SIN MODELO"` es
  un separador explícito, no hace falta diccionario para saber dónde
  termina la marca. Lo usan `andadores`/`bastones`/`calzado_ortopedico`
  (vía `parseOrtopedia9021Row`) y las 4 categorías reescritas el
  17/07/2026: `almohadones_ortopedicos`, `sillas_ducha`,
  `elevadores_inodoro`, `camas_hospitalarias`.

**Bug corregido (17/07/2026):** esas 4 últimas categorías usaban
`createCategoryParser` (Patrón A) aunque su texto real es Patrón B — el
parser viejo intentaba separar marca/modelo de un texto combinado que en
realidad ya venía separado por `"SIN MODELO"`, con diccionarios de marca
genéricos (los mismos de sillas de ruedas) que no tenían nada que ver con
las marcas reales de cada NCM (sanitarios, muebles, colchones, etc.). Se
reescribieron como funciones standalone (`almohadasCojinesParser`,
`sillasAsientosParser`, `elevadoresInodoroParser`, `camasHospitalariasParser`),
cada una con su propio diccionario de marcas y árbol de Segmento, usando el
helper compartido `splitPatternB()` para la extracción y
`extractColorGeneric()` para el color (default `"S/D"` en vez de `"Negro"`
en estas 4 — la mayoría de estos productos no traen color declarado).

El caso especial `parseOrtopedia9021Row()` (descripto en la sección 4) tiene
su propia lógica de normalización de texto (mayúsculas, corrección de typos
de marca vía `normalizeOrtopediaMarcaTypo`) y un diccionario de marca →
categoría/segmento armado a mano sobre el dataset real. Desde el 17/07/2026,
cuando una fila resuelve a la categoría `andadores`, se aplica además
`subSegmentoAndador()`, que refina el segmento genérico "Andadores y Ayudas
de Marcha" en 3 subtipos (Andador Fijo / Andador 2 Ruedas / Andador 4 Ruedas
— Rollator) usando reglas de marca + código de modelo (sufijo `"LH"` =
señal más confiable de rollator). Filas con `"HIP BRACE"` en el modelo
(marca Jianwei) se excluyen — no son andadores, son una órtesis de cadera
mal clasificada por el NCM — y quedan marcadas como
`"Andador Fijo (revisar - posible ortesis de cadera, no andador)"` para que
se puedan filtrar y corregir a mano en vez de contarse como un andador real.

**Filtro de Segmento por defecto (frontend):** ya que Almohadas y Cojines,
Sillas y Asientos y Elevadores de Inodoro traen de fondo mucha data no
relacionada al uso ortopédico (ver renombres arriba), `app/page.tsx`
(`DEFAULT_SEGMENTO_FILTER`) preselecciona el segmento relevante apenas se
elige la categoría (`"Cojín Ortopédico / Antiescaras"`,
`"Sillas de Ducha / Sanitarias"`, `"Elevador / Asiento Sanitario
Ortopédico"` respectivamente). Los datos de los demás segmentos igual están
sincronizados — el usuario puede ampliar el filtro para verlos.

⚠️ **Confianza de las reglas de Segmento de Camas Hospitalarias:** a
diferencia de las otras categorías (donde el texto trae palabras
descriptivas), en Camas Hospitalarias el texto de aduana NO indica si es
eléctrica o manual — se infiere por prefijo de código según catálogo de
cada fabricante (ej. Medik `YA-D...`=eléctrica / `YA-M...`=manual, Magesa
`D...`=eléctrica / `V...`=manual). Son heurísticas de mejor esfuerzo;
conviene revisar los conteos del primer sync real contra lo esperado
(~21% del dataset original quedaba en "Tipo no especificado").

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

## 10.1 Tamizador de segmentos (validación con IA, 17/07/2026)

**Por qué existe:** la clasificación automática de marca/modelo/segmento
(sección 8) es un árbol de reglas (marca declarada + palabras clave +, para
el NCM compartido, descripción de posición arancelaria) — funciona bien en
general, pero un mismo fabricante puede vender productos de tipos distintos
bajo códigos parecidos, y ahí la regla se puede equivocar. Caso real que
motivó esta feature: "Double Care Medical HY7300L" quedó clasificado como
`andadores` (por su marca + descripción genérica "LOS DEMÁS"), pero una
búsqueda real en Google muestra que es un **bastón trípode**, no un andador.

**Cómo funciona:** botón "🔎 Tamizar categoría" en el dashboard (junto a los
filtros). Al clickearlo, dispara `GET /api/sieve?category=<slug>`, que:

1. Busca combinaciones marca+modelo de la categoría actual que **todavía no
   se validaron** (tabla `model_sieve_log`, nueva — ver sección 5), ordenadas
   por **FOB total acumulado descendente** (suma de `total_fob_dolars` de
   todos los meses) — así se revisan primero los modelos con más peso real
   en el negocio, no alfabéticamente.
2. Para cada una (en lotes de `SIEVE_BATCH_LIMIT`, default 100 por click,
   procesadas de a `SIEVE_CONCURRENCY` en paralelo, default 10): le pide a
   OpenAI (`lib/aiClassifier.ts`, modelo `gpt-5.4-mini` vía Responses API)
   que decida el segmento real. **El modelo busca en la web por su cuenta**
   (tool nativo `web_search`) — no se usa SerpApi para esto. La IA **siempre
   elige el segmento que mejor aplique**, incluso con evidencia parcial o
   ambigua (pedido explícito del usuario, 17/07/2026: prefiere una mejor
   estimación de la IA antes que dejar el modelo sin clasificar) — el campo
   "confianza" indica qué tan segura estuvo, pero ya no se usa para bloquear
   la corrección del segmento.
3. Para las 3 categorías de NCM compartido (`andadores`/`bastones`/
   `calzado_ortopedico`), además le pregunta a la IA si el producto está en
   la categoría correcta. Este cambio de categoría sigue siendo conservador:
   solo se aplica con confianza alta/media (a diferencia del segmento), por
   ser un cambio estructural más grande. Si corresponde mover (como el caso
   de Double Care Medical), **se mueve automáticamente**: `UPDATE
   trade_records` cambia el `category_id` (y el segmento) de esa
   combinación marca+modelo, se recalcula `monthly_brand_model_agg` de
   ambas categorías (la vieja y la nueva), y se migran (si existían) la
   imagen cacheada y el override de segmento.
4. Al terminar el lote, el dashboard muestra un resumen: procesados, sin
   cambios, segmento corregido, categoría movida, sin evidencia (caso
   residual: la IA no devolvió ningún segmento pese a la instrucción de
   siempre elegir uno — debería ser raro), y errores.

Solo corre bajo demanda (no hay cron) — hace falta clickear el botón una o
más veces por categoría hasta agotar los pendientes (`model_sieve_log` evita
reprocesar lo ya validado).

**UI (17/07/2026, segunda vuelta):** el botón "🔎 Tamizar categoría" se movió
al panel superior del dashboard, en el lugar donde antes estaba el link
"☁️ Cargar/editar marcas por importador → " hacia `/admin` (se quitó porque,
con el tamizador corrigiendo automáticamente, ese flujo manual por
importador pierde sentido para segmento). Junto al botón se muestra:

- Una barra de progreso + `{tamizado}/{total} tamizado (X%)`, calculado por
  `GET /api/sieve/status?category=<slug>` (nuevo endpoint liviano, **no**
  gasta cuota de OpenAI ni de SerpApi — solo cuenta filas de
  `monthly_brand_model_agg` vs. `model_sieve_log`).
- Un tiempo estimado restante (`≈Xm restante`), calculado en el cliente
  como `pendientes × segundos-por-item-del-último-lote-corrido` (no hay
  forma de estimarlo sin haber corrido al menos un lote en la sesión).
- El panel de resultados también lista `detalle_errores` (el texto real de
  cada error), antes calculado en el backend pero nunca mostrado —
  necesario para diagnosticar por qué un lote da errores en vez de solo ver
  el contador. Se puede ocultar/mostrar con el botón "Ver errores".

**Variables de entorno:**
- `OPENAI_API_KEY` — obligatoria para que funcione el tamizador. Key del
  proyecto "cobus" en platform.openai.com (facturación por uso, pagada por
  la empresa). **Ojo:** esto es la API de OpenAI, no una suscripción de
  ChatGPT Plus/Pro — son sistemas de facturación totalmente distintos, hace
  falta una key generada en platform.openai.com con método de pago propio.
  Costo aproximado: el tool `web_search` cuesta USD 0.01 por búsqueda (10
  USD / 1.000 llamadas) + tokens de la respuesta al precio normal del
  modelo — un lote de 100 productos sale centavos de dólar.
- `SIEVE_BATCH_LIMIT` — opcional, tamaño del lote por click (default 100,
  antes 20 — con SerpApi ya no en el medio no hace falta ser tan
  conservador con la cuota, así que se subió al tope máximo para que cada
  click cubra más terreno).
- `SIEVE_CONCURRENCY` — opcional, cuántos ítems se procesan EN PARALELO
  dentro de cada lote (default 10). La llamada a OpenAI no pasa por el pool
  de Postgres (`lib/db.ts`, max 5 conexiones) — solo las queries cortas de
  insert/update lo usan, así que se puede paralelizar más que esas 5
  conexiones sin problema (el exceso de queries hace cola un instante nomás).
- `SIEVE_TIME_BUDGET_MS` — opcional (default 260000 = 260s), presupuesto de
  tiempo total del request, bien por debajo de `maxDuration` (300s). Ver
  incidente abajo — sin esto, un lote de 100 podía exceder el límite de
  Vercel y la función moría sin devolver ninguna respuesta al navegador.

**Incidente 17/07/2026 (segunda vuelta) — lote de 100 lento y sin
respuesta:** con el `SIEVE_BATCH_LIMIT` subido a 100, un lote real quedó
"colgado" y terminó devolviendo el error genérico "No se pudo correr el
tamizador" en el frontend, aunque 60 de los 100 ítems sí se habían
procesado y guardado bien (se veía en la barra de progreso). Causa: la
función de `/api/sieve` excedió los 300s de `maxDuration` y Vercel la mató
de golpe — el navegador nunca recibe una respuesta cuando eso pasa, así que
cae en el `.catch()` genérico del fetch en vez de mostrar un error
específico. Tres cambios para esto:
1. **Menos latencia por ítem** (`lib/aiClassifier.ts`): el prompt le pedía
   al modelo reintentar la búsqueda con variantes si la primera fallaba —
   se sacó esa instrucción (una sola búsqueda). Se agregó también
   `reasoning: { effort: "low" }` en el request a OpenAI (no hace falta
   razonamiento profundo para elegir de una lista fija de segmentos) y un
   timeout defensivo de 45s por request individual (`AbortController`).
2. **Más concurrencia** (`SIEVE_CONCURRENCY`, default 5 → 10).
3. **Presupuesto de tiempo** (`app/api/sieve/route.ts`): antes de cada
   tanda paralela se chequea cuánto tiempo pasó desde que arrancó el
   request; si ya se acerca a `SIEVE_TIME_BUDGET_MS`, se corta ahí mismo y
   se devuelve el resumen con `parcial: true` en vez de seguir y arriesgarse
   a que Vercel mate la función sin respuesta. El frontend (`app/page.tsx`)
   muestra un aviso ("⏱️ Se alcanzó el límite de tiempo... clickeá de nuevo
   para seguir") cuando esto pasa. Como cada ítem procesado se loguea en
   `model_sieve_log` al momento (no al final), no se pierde ni se reprocesa
   nada — el próximo click retoma justo donde quedó.

**Historial de proveedores de IA para el tamizador (todo el 17/07/2026):**
esta feature pasó por 3 proveedores distintos en el mismo día, cada cambio
motivado por una limitación real encontrada en producción:

1. **Anthropic (Claude)** — primera versión. Se descartó por pedido del
   usuario: quería empezar con una opción gratuita.
2. **Gemini** (`gemini-2.5-flash-lite`, después `gemini-3.1-flash-lite` tras
   un 404 de Google a API keys nuevas) — funcionó bien en un primer test
   pasándole a Gemini snippets de SerpApi como texto (JSON mode clásico).
   Después, por pedido del usuario de que la IA "buscara de verdad" en vez
   de depender de SerpApi, se cambió a que Gemini buscara solo con su tool
   nativo `google_search` (grounding) — pero ese tool devuelve 429 en el
   100% de los casos si el proyecto de Google AI Studio no tiene
   **facturación activada** (confirmado en la
   [página oficial de precios](https://ai.google.dev/gemini-api/docs/pricing):
   grounding figura como "No disponible" en el tier gratis puro). Activar
   facturación en Google requería cargar una tarjeta igual, así que en vez
   de eso la empresa decidió pagar la API de OpenAI.
3. **OpenAI** (`gpt-5.4-mini` vía Responses API, tool `web_search`) — la
   versión actual. La empresa ya factura este proveedor (proyecto "cobus"),
   así que no hace falta activar nada adicional del lado de Google. Mismo
   patrón que con Gemini: el modelo busca en la web por su cuenta durante
   la misma llamada, sin SerpApi.

Detalle técnico importante (aplica igual que con Gemini): **no** se combina
"structured output" (`text.format: json_schema` en la Responses API) con el
tool `web_search` — hay reportes de la comunidad de OpenAI de que esa
combinación corta la respuesta a la mitad y rompe el JSON. Por eso se le
pide al modelo en el prompt que responda solo con JSON en texto plano, y
`extractJson()` en `lib/aiClassifier.ts` lo extrae con un parser de llaves
balanceadas (tolerante a texto extra alrededor).

`lib/webSearch.ts` (cliente de SerpApi para texto, usado por la versión
Gemini-con-snippets) quedó sin uso en el repo — se puede borrar si se
quiere, no rompe nada. SerpApi sigue usándose exclusivamente para imágenes
del catálogo (`lib/imageSearch.ts`), sin relación con el tamizador.

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
| `/api/token` | POST (asumido) | Recibe el JWT que manda `refresh_token.py` y lo guarda en `app_settings`. Confirmado funcionando en producción, pero su archivo fuente no está en esta carpeta local (ver sección 7). |
| `/api/sieve` | GET | Tamizador de segmentos: busca en la web + IA y corrige/mueve modelos no validados de una categoría (ver sección 10.1). Bajo demanda, sin cron. |
| `/api/sieve/status` | GET | Progreso del tamizador para una categoría (`{total, tamizado, pendientes, porcentaje}`). Liviano, sin llamadas externas — usado para la barra de progreso. |

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
| `OPENAI_API_KEY` | `lib/aiClassifier.ts` | Clasificación con IA del tamizador de segmentos (sección 10.1). Proyecto "cobus" en platform.openai.com, facturación por uso pagada por la empresa (no es lo mismo que ChatGPT Plus). |
| `SIEVE_BATCH_LIMIT` | `app/api/sieve/route.ts` | Cuántas combinaciones marca+modelo procesa el tamizador por click (default 100). |
| `SIEVE_CONCURRENCY` | `app/api/sieve/route.ts` | Cuántas de esas combinaciones procesa en paralelo (default 10). |
| `SIEVE_TIME_BUDGET_MS` | `app/api/sieve/route.ts` | Presupuesto de tiempo total del request antes de cortar el lote y devolver un resumen parcial (default 260000 = 260s). |

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
- **4 parsers usando el patrón de aduana equivocado** — `almohadones_ortopedicos`,
  `sillas_ducha`, `elevadores_inodoro` y `camas_hospitalarias` usaban el
  motor genérico de Patrón A (pensado para "Sillas de ruedas": marca+modelo
  juntos en un texto) cuando su texto real es Patrón B (`"SIN MODELO"` como
  separador explícito) — ver sección 8. Se reescribieron los 4 como
  funciones standalone con sus propios diccionarios de marca y árboles de
  Segmento. De paso se renombraron 2 categorías ("Almohadones Ortopédicos"
  → "Almohadas y Cojines", "Sillas de Ducha" → "Sillas y Asientos") porque
  sus NCM traen en la práctica mucha data no ortopédica, y se agregó
  preselección de Segmento por defecto en el frontend para esas 3
  categorías + Elevadores de Inodoro. **Pendiente de confirmación del
  usuario tras el primer sync real con el parser nuevo** (tarea #71).

## 16. Deuda técnica conocida / pendientes

- `sql/schema.sql` no incluye `app_settings` ni `model_segmento_override`
  (sección 5) — reconstruir la base desde este archivo solo no alcanza.
- `README.md` y `.env.example` describen una versión vieja del proyecto (una
  sola categoría piloto, auth solo por variable de entorno) — no reflejan el
  estado actual. Convendría actualizarlos o al menos linkearlos a este
  documento.
- El endpoint `/api/token` que necesita `refresh_token.py` está confirmado
  funcionando en producción (sección 7), pero su archivo fuente no aparece
  en esta carpeta local — conviene confirmar en GitHub que existe y, si es
  posible, traer ese archivo de vuelta a esta carpeta para que quede
  completa y sincronizada con lo que realmente corre en Vercel.
- `lib/parsers/sillasDeRuedas.ts` podría estar huérfano (reemplazado por la
  lógica generalizada de `lib/parsers/index.ts`) — revisar si se puede
  eliminar.
- El backfill de imágenes (`/api/sync-images`) no corre automáticamente
  (sección 10) — es 100% manual hoy.
- Limpiezas de datos pendientes de confirmación final (sección 15, bastones
  y filas fantasma de julio 2026).
- Reglas de Segmento de Camas Hospitalarias basadas en prefijo de código son
  heurísticas de mejor esfuerzo (sección 8) — revisar contra el primer sync
  real.
- Filas "HIP BRACE" (marca Jianwei, dentro de `andadores`) quedan marcadas
  como "(revisar)" en vez de reclasificarse automáticamente fuera de la
  categoría — requiere decisión del usuario sobre dónde deberían ir (el
  tamizador de segmentos, sección 10.1, debería terminar corrigiendo estas
  también al pasar por esa categoría).
- El tamizador de segmentos (sección 10.1) es nuevo y no se validó todavía a
  gran escala — conviene revisar los primeros resultados reales (sobre todo
  los "categoria_movida", que tocan datos entre categorías) antes de confiar
  en él a ciegas para categorías enteras.

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
