-- ══════════════════════════════════════════════════════════════════════════════
--  Envío de correos a proveedores desde la app (Resend) + control de respuesta
-- ══════════════════════════════════════════════════════════════════════════════
--  Un envío = un correo a UN proveedor que cubre N líneas de seguimiento.
--  La cabecera queda en `seg_envios` y el detalle en `seg_envio_lineas`, de modo
--  que se pueda auditar exactamente qué materiales se le pidieron confirmar.
--
--  Para no tener que agregar en cada consulta de la lista, dos marcas viven
--  desnormalizadas en `seg_lineas`:
--    · ultimo_envio_at  → cuándo se le escribió al proveedor por esa línea
--    · respondido_at    → cuándo respondió (al registrar la fecha confirmada,
--                          o marcándolo a mano si respondió "sin cambios")
--  «Sin respuesta hace X días» = ultimo_envio_at < now() - X y respondido_at null.
-- ══════════════════════════════════════════════════════════════════════════════

create table seg_envios (
  id               uuid primary key default gen_random_uuid(),
  proveedor_codigo text,
  proveedor_nombre text,
  email            text not null,
  reply_to         text,                                  -- buzón del comprador que lo envió
  asunto           text not null,
  cuerpo           text,
  n_lineas         integer not null default 0,
  estado           text not null default 'enviado' check (estado in ('enviado', 'error')),
  proveedor_msg_id text,                                  -- id que devuelve Resend (trazabilidad)
  error            text,
  enviado_por      uuid references auth.users(id) on delete set null,
  created_at       timestamptz not null default now()
);
create index idx_segenvios_proveedor on seg_envios(proveedor_codigo);
create index idx_segenvios_fecha on seg_envios(created_at desc);

create table seg_envio_lineas (
  id        uuid primary key default gen_random_uuid(),
  envio_id  uuid not null references seg_envios(id) on delete cascade,
  linea_id  uuid not null references seg_lineas(id) on delete cascade,
  unique (envio_id, linea_id)
);
create index idx_segenviolineas_envio on seg_envio_lineas(envio_id);
create index idx_segenviolineas_linea on seg_envio_lineas(linea_id);

alter table seg_lineas
  add column ultimo_envio_at timestamptz,
  add column respondido_at   timestamptz;

-- Acelera el filtro "pendientes de respuesta" (el caso que se consulta a diario).
create index idx_seglineas_sin_respuesta on seg_lineas(ultimo_envio_at)
  where respondido_at is null;

-- ─── RLS (permisiva para authenticated, igual que el resto del esquema) ───────
do $$
declare t text;
begin
  foreach t in array array['seg_envios', 'seg_envio_lineas'] loop
    execute format('alter table %I enable row level security;', t);
    execute format($p$create policy "auth_all_%1$s" on %1$I
                       for all to authenticated using (true) with check (true);$p$, t);
  end loop;
end $$;
