-- Esquema para el dashboard IA40 (Cobus Group)
-- Pensado para crecer por categorias (sillas de ruedas, andadores, bastones, ...)
-- sin tener que rehacer el modelo cada vez.

create table if not exists categories (
  id serial primary key,
  slug text unique not null,          -- 'sillas_de_ruedas', 'andadores', 'bastones'
  name text not null,                 -- nombre para mostrar en el front
  created_at timestamptz not null default now()
);

-- Una categoria puede mapear a una o varias posiciones arancelarias (NCM).
create table if not exists category_ncm_codes (
  id serial primary key,
  category_id int not null references categories(id) on delete cascade,
  ncm_code text not null,             -- ej: '8713.10.00'
  description text,
  unique (category_id, ncm_code)
);

-- Mapeo de campos: como el 'schema' que devuelve la API es dinamico y todavia
-- no confirmamos los nombres exactos de marca/modelo para sillas de ruedas,
-- cada categoria define de que campo del JSON crudo sale cada dimension.
-- Asi, agregar una categoria nueva con campos distintos no requiere tocar codigo.
create table if not exists field_mappings (
  id serial primary key,
  category_id int not null references categories(id) on delete cascade,
  target_field text not null check (target_field in ('marca','modelo','proveedor','fecha','fob_dolars','unidades')),
  source_json_path text not null,     -- ej: 'marca_comercial', 'modelo_producto'
  unique (category_id, target_field)
);

-- Registro crudo: una fila por registro devuelto por POST /data.
-- Se guarda todo el JSON tal cual viene, mas algunas columnas indexadas
-- para no tener que parsear JSONB en cada query.
create table if not exists trade_records (
  id bigserial primary key,
  category_id int not null references categories(id) on delete cascade,
  ncm_code text not null,
  period date not null,               -- primer dia del mes del registro (YYYY-MM-01)
  cuit text,
  raw jsonb not null,                 -- fila completa devuelta por la API
  fob_dolars numeric,
  marca text,                         -- calculado por el parser de la categoria (lib/parsers), si tiene uno
  modelo text,                        -- idem
  color text,                         -- idem (paso 10 del parser de sillas de ruedas)
  ingested_at timestamptz not null default now(),
  source_hash text unique             -- hash del registro para evitar duplicados en re-sync
);

create index if not exists idx_trade_records_cat_period on trade_records (category_id, period);
create index if not exists idx_trade_records_ncm on trade_records (ncm_code);
create index if not exists idx_trade_records_raw_gin on trade_records using gin (raw);

-- Agregado mensual por marca/modelo/proveedor, para que el front no tenga
-- que agregar en el momento. Se recalcula en cada sync (ver /api/sync).
create table if not exists monthly_brand_model_agg (
  id bigserial primary key,
  category_id int not null references categories(id) on delete cascade,
  period date not null,
  marca text,
  modelo text,
  proveedor text,
  total_fob_dolars numeric not null default 0,
  total_unidades numeric not null default 0,
  record_count int not null default 0,
  unique (category_id, period, marca, modelo, proveedor)
);

create index if not exists idx_monthly_agg_lookup on monthly_brand_model_agg (category_id, period);

-- IA40 no siempre trae marca/modelo directo en el JSON. Cuando no viene, se
-- identifica manualmente por empresa importadora (campo "nombre") y se carga
-- aca via la pantalla /admin. Se va completando de a poco.
create table if not exists provider_brand_map (
  id serial primary key,
  category_id int not null references categories(id) on delete cascade,
  importer_name text not null,
  marca text not null,
  modelo text,
  updated_at timestamptz not null default now(),
  unique (category_id, importer_name)
);

-- Un importador puede traer varias marcas, y una marca varios modelos.
-- Cuando la clasificacion por importador entero (provider_brand_map) no
-- alcanza, se puede clasificar cada linea de detalle (cada registro de
-- trade_records) por separado aca. Tiene prioridad sobre provider_brand_map.
create table if not exists record_brand_map (
  id serial primary key,
  trade_record_id bigint not null references trade_records(id) on delete cascade,
  marca text not null,
  modelo text,
  updated_at timestamptz not null default now(),
  unique (trade_record_id)
);

-- Historial de corridas de sync, para debug y para saber desde que fecha
-- retomar la proxima vez (sync incremental).
create table if not exists sync_runs (
  id serial primary key,
  category_id int not null references categories(id) on delete cascade,
  ncm_code text not null,
  period_start date not null,
  period_end date not null,
  rows_ingested int not null default 0,
  status text not null default 'ok',  -- 'ok' | 'error'
  error_message text,
  run_at timestamptz not null default now()
);

-- Seed inicial: categoria piloto.
insert into categories (slug, name) values ('sillas_de_ruedas', 'Sillas de ruedas')
  on conflict (slug) do nothing;
