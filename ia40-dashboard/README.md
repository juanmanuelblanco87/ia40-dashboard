# IA40 Dashboard (Cobus Group) — evolución mensual por categoría

Dashboard en Next.js + Postgres para Vercel. Sincroniza datos de la API
privada de IA40 (posiciones arancelarias / proveedores) a una base propia,
y muestra evolución mensual por marca/modelo/proveedor con un click.

## Qué falta confirmar antes de que esto funcione con datos reales

Esto es lo más importante del README, léelo antes de deployar:

1. **Código(s) NCM de "sillas de ruedas".** El `/api/sync` filtra por
   `posicion_arancelaria` (supuesto, no confirmado — el documento de
   ingeniería inversa no muestra ese nombre de campo en el body de
   `/data`, solo lo usa como *ranking*). Hay que:
   - Cargar el/los código(s) NCM reales en `category_ncm_codes`.
   - Verificar con una llamada real si `/data` filtra por
     `posicion_arancelaria` o por otro nombre de campo (ej. `ncm`,
     `posicion_arancelaria_codi`). Si es otro nombre, cambiar la línea
     correspondiente en `app/api/sync/route.ts`.

2. **Nombres reales de los campos marca/modelo.** El `schema` que
   devuelve la API es dinámico y el documento no lista sus campos
   completos. Corré una sync una vez, mirá `trade_records.raw` (json
   crudo guardado tal cual) para ver qué claves trae realmente
   (`marca_comercial`, `modelo`, `descripcion_mercaderia`, etc.), y
   cargalas en `field_mappings`:

   ```sql
   insert into field_mappings (category_id, target_field, source_json_path)
   values
     (1, 'marca',     'NOMBRE_REAL_DEL_CAMPO'),
     (1, 'modelo',    'NOMBRE_REAL_DEL_CAMPO'),
     (1, 'proveedor', 'razon_social'),
     (1, 'fecha',     'NOMBRE_REAL_DEL_CAMPO_FECHA');
   ```

   Sin esto, el dashboard va a agrupar todo como "sin_dato" (el sync no
   se rompe, pero el gráfico no discrimina por marca/modelo).

3. **JWT.** Sigue sin haber endpoint de login documentado. `IA40_JWT` se
   carga a mano como variable de entorno en Vercel y hay que refrescarlo
   cuando expire (`/api/sync` va a loguear `auth_error` en `sync_runs`
   cuando pase).

## Deploy en Vercel

1. Creá un Postgres (Vercel Postgres, o Neon/Supabase — cualquiera sirve,
   `pg` se conecta con un `DATABASE_URL` estándar).
2. Corré `sql/schema.sql` contra esa base (una vez).
3. Insertá el código NCM real de sillas de ruedas:
   ```sql
   insert into category_ncm_codes (category_id, ncm_code, description)
   values (1, '8713.10.00', 'Sillas de ruedas'); -- confirmar código real
   ```
4. `vercel link` en esta carpeta, y cargá las env vars (`vercel env add`):
   - `DATABASE_URL`
   - `IA40_JWT`
   - `CRON_SECRET` (cualquier string; Vercel Cron lo manda solo si lo
     configurás en el proyecto — ver docs de "Securing Cron Jobs")
   - `SYNC_MONTHS_BACK` (opcional, default 3)
5. `vercel deploy --prod`.
6. El cron ya está declarado en `vercel.json` (corre `/api/sync` todos
   los días a las 6am UTC). Podés dispararlo a mano pegándole a
   `GET /api/sync` con el header `Authorization: Bearer <CRON_SECRET>`.

## Agregar una categoría nueva (andadores, bastones, ...)

1. `insert into categories (slug, name) values ('andadores', 'Andadores');`
2. Insertar su(s) código(s) NCM en `category_ncm_codes`.
3. Correr `/api/sync` una vez, inspeccionar `raw` de `trade_records`, y
   cargar su `field_mappings` (los nombres de campo pueden ser distintos
   a los de sillas de ruedas).
4. Listo — aparece sola en el selector de categorías del front.

## Estructura

- `sql/schema.sql` — esquema completo, con comentarios.
- `lib/ia40.ts` — cliente HTTP a la API de IA40 (paginado).
- `lib/aggregate.ts` — inserta filas crudas (dedup por hash) y recalcula
  el agregado mensual usando `field_mappings`.
- `app/api/sync/route.ts` — job de sincronización (Vercel Cron).
- `app/api/categories`, `app/api/evolution` — endpoints que consume el front.
- `app/page.tsx` + `components/EvolutionChart.tsx` — dashboard.

## Limitaciones conocidas

- `maxDuration: 300` en `/api/sync` requiere plan Vercel Pro (Hobby limita
  a 10s, insuficiente para paginar varios meses de datos).
- Sin backfill histórico automático: la primera sync trae `SYNC_MONTHS_BACK`
  meses hacia atrás. Para cargar historia más larga, corré `/api/sync` con
  un `SYNC_MONTHS_BACK` alto una vez manualmente (puede tardar y toparse
  con el timeout — considerar correrlo por partes o localmente).
