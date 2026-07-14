-- ══════════════════════════════════════════════════════════════════════════════
--  Módulo de Seguimiento (expediting) de Órdenes de Compra
-- ══════════════════════════════════════════════════════════════════════════════
--  Decisiones del socio (seguimiento_dudas_socio.pdf, 2026-07-14):
--   · Solo el equipo de Minos registra el avance (sin portal externo).
--   · Hitos reales: Emitida → Confirmada → En fabricación → Despachada
--     → Recibida (parcial/total) → Cerrada.
--   · Cierre = OC entregada al 100% en almacén del cliente (el pago queda fuera).
--   · Parciales existen (~30%): recepciones con cantidad por línea.
--   · Tres fechas por línea: comprometida (oc_items.fecha_entrega),
--     estimada (oc_items.fecha_estimada) y real (de las recepciones).
--   · Umbrales: acuse de recibo de la OC en 1 día hábil; confirmación de
--     fecha de entrega en 2 días hábiles (el semáforo se calcula en la UI).
--   · El cliente también genera sus propias OCs → columna `origen`.
-- ══════════════════════════════════════════════════════════════════════════════

-- Línea de vida de la OC frente al proveedor
create type hito_oc as enum (
  'Emitida', 'Confirmada', 'En fabricación', 'Despachada',
  'Recibida parcial', 'Recibida total', 'Cerrada'
);

alter table ordenes_compra
  -- hito actual (desnormalizado para listar/filtrar; la historia vive en oc_eventos)
  add column hito hito_oc not null default 'Emitida',
  -- quién generó la OC: Minos la emite desde el sistema; el cliente puede traer la suya
  add column origen text not null default 'minos' check (origen in ('minos', 'cliente')),
  -- acuse de recibo de la OC por el proveedor (umbral: 1 día hábil)
  add column oc_recibida_proveedor boolean not null default false,
  add column fecha_recepcion_oc date,
  -- fecha de entrega confirmada por el proveedor (umbral: 2 días hábiles)
  add column fecha_entrega_confirmada date,
  -- re-programación posterior a la confirmación ("nueva fecha de entrega")
  add column nueva_fecha_entrega date,
  add column fecha_cierre date;

-- Fecha estimada por línea (la comprometida es fecha_entrega; la real sale de recepciones)
alter table oc_items add column fecha_estimada date;

-- ─── Bitácora de seguimiento ──────────────────────────────────────────────────
-- Cada cambio de hito o nota de gestión (llamada, correo al proveedor…) queda aquí.
create table oc_eventos (
  id         uuid primary key default gen_random_uuid(),
  oc_id      uuid not null references ordenes_compra(id) on delete cascade,
  hito       hito_oc,                        -- null ⇒ nota libre sin cambio de hito
  fecha      date not null default current_date,
  nota       text,
  created_at timestamptz not null default now()
);
create index idx_oceventos_oc on oc_eventos(oc_id);

-- ─── Recepciones (parciales o totales) ────────────────────────────────────────
-- El cliente avisa (correo/llamada) y Minos registra la entrega en su almacén.
create table oc_recepciones (
  id         uuid primary key default gen_random_uuid(),
  oc_id      uuid not null references ordenes_compra(id) on delete cascade,
  fecha      date not null default current_date,
  referencia text,                            -- guía de remisión / N° de aviso
  nota       text,
  created_at timestamptz not null default now()
);
create index idx_ocrecep_oc on oc_recepciones(oc_id);

create table oc_recepcion_items (
  id           uuid primary key default gen_random_uuid(),
  recepcion_id uuid not null references oc_recepciones(id) on delete cascade,
  oc_item_id   uuid not null references oc_items(id) on delete cascade,
  cantidad     numeric(14,3) not null check (cantidad > 0)
);
create index idx_ocrecepitems_recep on oc_recepcion_items(recepcion_id);
create index idx_ocrecepitems_item  on oc_recepcion_items(oc_item_id);

-- ─── RLS (permisiva para authenticated, igual que el resto del esquema) ───────
do $$
declare t text;
begin
  foreach t in array array['oc_eventos', 'oc_recepciones', 'oc_recepcion_items'] loop
    execute format('alter table %I enable row level security;', t);
    execute format($p$create policy "auth_all_%1$s" on %1$I
                       for all to authenticated using (true) with check (true);$p$, t);
  end loop;
end $$;
