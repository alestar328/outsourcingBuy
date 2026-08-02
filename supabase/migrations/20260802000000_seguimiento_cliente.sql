-- ══════════════════════════════════════════════════════════════════════════════
--  Seguimiento de entregas sobre el Excel de OCs del cliente (reformateo 2026-08)
-- ══════════════════════════════════════════════════════════════════════════════
--  Nuevo método de trabajo: el cliente envía periódicamente un Excel con sus
--  órdenes de compra ya emitidas (hoja "Detalle", una fila por posición de OC).
--  Minos hace el expediting: contacta a cada proveedor con el listado de sus
--  materiales para que confirme o rectifique la "Fecha de entrega actual".
--
--  · Clave natural de una línea: (documento_compras, posicion) → upsert.
--  · Al reimportar se conservan las fechas confirmadas por el proveedor y se
--    guarda la fecha anterior cuando el cliente cambia la "actual" (marca visual).
--  · Las líneas que ya no vienen en el Excel se marcan activo=false (no se borran).
--  · Los emails de proveedor no vienen en el Excel del cliente: se capturan al
--    generar el correo y quedan en un mini-directorio por código SAP.
--  · Las tablas del seguimiento anterior (oc_eventos, oc_recepciones…) se
--    conservan intactas; este módulo las reemplaza funcionalmente.

create table seg_lineas (
  id                       uuid primary key default gen_random_uuid(),
  documento_compras        text not null,             -- N° OC del cliente
  posicion                 text not null,             -- Pos dentro de la OC
  gc                       text,                      -- grupo de compras (C00, C05…)
  fecha_documento          date,
  texto_breve              text,
  material                 text,                      -- código de material (vacío en servicios)
  proveedor_codigo         text,                      -- código SAP del proveedor
  proveedor_nombre         text,
  cantidad                 numeric(14,3),
  um                       text,
  moneda                   text,
  valor_neto               numeric(14,2),
  por_entregar_cantidad    numeric(14,3),
  por_entregar_valor       numeric(14,2),
  fecha_entrega_original   date,
  fecha_entrega_actual     date,
  fecha_entrega_anterior   date,                      -- valor previo de la "actual" si cambió al reimportar
  fecha_entrega_confirmada date,                      -- la que confirma/rectifica el proveedor (manual)
  status                   text,                      -- observación del cliente ("IN PIT", "Atendido…")
  activo                   boolean not null default true,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  unique (documento_compras, posicion)
);
create index idx_seglineas_proveedor on seg_lineas(proveedor_codigo);
create index idx_seglineas_activo on seg_lineas(activo);

-- Mini-directorio de emails de proveedor (se alimenta al generar cada correo).
create table seg_proveedor_emails (
  proveedor_codigo text primary key,                  -- código SAP (o nombre si no trae código)
  proveedor_nombre text,
  email            text not null,
  updated_at       timestamptz not null default now()
);

-- ─── RLS (permisiva para authenticated, igual que el resto del esquema) ───────
do $$
declare t text;
begin
  foreach t in array array['seg_lineas', 'seg_proveedor_emails'] loop
    execute format('alter table %I enable row level security;', t);
    execute format($p$create policy "auth_all_%1$s" on %1$I
                       for all to authenticated using (true) with check (true);$p$, t);
  end loop;
end $$;
