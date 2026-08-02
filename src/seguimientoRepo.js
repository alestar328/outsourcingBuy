// ══════════════════════════════════════════════════════════════════════════════
//  Capa de datos: Seguimiento de entregas (Excel del cliente) ↔ Supabase
// ══════════════════════════════════════════════════════════════════════════════
//  Reformateo 2026-08: el seguimiento ya no nace de OCs internas sino del Excel
//  de OCs que envía el cliente. Una fila = (documento_compras, posicion).
//  Reimportar hace upsert conservando la fecha confirmada por el proveedor y
//  marcando (fecha_entrega_anterior) las líneas cuya "Fecha de entrega actual"
//  cambió. Las líneas que ya no vienen se desactivan, no se borran.
// ══════════════════════════════════════════════════════════════════════════════

import { supabase } from './supabaseClient.js'

const CHUNK = 400

function dbToUI(r) {
  return {
    id:                  r.id,
    documentoCompras:    r.documento_compras,
    posicion:            r.posicion,
    gc:                  r.gc || '',
    fechaDocumento:      r.fecha_documento || '',
    textoBreve:          r.texto_breve || '',
    material:            r.material || '',
    proveedorCodigo:     r.proveedor_codigo || '',
    proveedorNombre:     r.proveedor_nombre || '',
    cantidad:            r.cantidad === null ? null : Number(r.cantidad),
    um:                  r.um || '',
    moneda:              r.moneda || '',
    valorNeto:           r.valor_neto === null ? null : Number(r.valor_neto),
    porEntregarCantidad: r.por_entregar_cantidad === null ? null : Number(r.por_entregar_cantidad),
    porEntregarValor:    r.por_entregar_valor === null ? null : Number(r.por_entregar_valor),
    fechaOriginal:       r.fecha_entrega_original || '',
    fechaActual:         r.fecha_entrega_actual || '',
    fechaAnterior:       r.fecha_entrega_anterior || '',
    fechaConfirmada:     r.fecha_entrega_confirmada || '',
    status:              r.status || '',
    ultimoEnvioAt:       r.ultimo_envio_at || '',
    respondidoAt:        r.respondido_at || '',
  }
}

// Líneas activas para la List Report, agrupables por proveedor.
export async function listarLineas() {
  const { data, error } = await supabase
    .from('seg_lineas')
    .select('*')
    .eq('activo', true)
    .order('proveedor_nombre', { ascending: true })
    .order('documento_compras', { ascending: true })
    .order('posicion', { ascending: true })
  if (error) throw error
  return (data || []).map(dbToUI)
}

// Importa el Excel del cliente (líneas ya parseadas). Upsert por clave natural:
//  · nueva línea ⇒ insert
//  · existente   ⇒ update con lo que manda el cliente, PRESERVANDO la fecha
//    confirmada; si la "actual" cambió, la previa queda en fecha_entrega_anterior
//  · líneas que ya no vienen ⇒ activo=false
// Devuelve { total, nuevas, actualizadas, cambiosFecha, desactivadas }.
export async function importarLineas(lineas) {
  if (!lineas?.length) throw new Error('El Excel no contiene líneas de seguimiento.')

  const { data: actuales, error } = await supabase
    .from('seg_lineas')
    .select('id, documento_compras, posicion, fecha_entrega_actual, fecha_entrega_anterior, fecha_entrega_confirmada')
  if (error) throw error
  const porClave = new Map((actuales || []).map(r => [`${r.documento_compras}|${r.posicion}`, r]))

  const ahora = new Date().toISOString()
  let nuevas = 0, actualizadas = 0, cambiosFecha = 0
  const filas = []
  const vistas = new Set()
  for (const l of lineas) {
    const clave = `${l.documentoCompras}|${l.posicion}`
    if (vistas.has(clave)) continue                  // duplicado dentro del propio Excel
    vistas.add(clave)
    const prev = porClave.get(clave)
    const cambio = prev && prev.fecha_entrega_actual && l.fechaActual &&
                   prev.fecha_entrega_actual !== l.fechaActual
    if (cambio) cambiosFecha++
    if (prev) actualizadas++; else nuevas++
    filas.push({
      documento_compras:        l.documentoCompras,
      posicion:                 l.posicion,
      gc:                       l.gc || null,
      fecha_documento:          l.fechaDocumento || null,
      texto_breve:              l.textoBreve || null,
      material:                 l.material || null,
      proveedor_codigo:         l.proveedorCodigo || null,
      proveedor_nombre:         l.proveedorNombre || null,
      cantidad:                 l.cantidad ?? null,
      um:                       l.um || null,
      moneda:                   l.moneda || null,
      valor_neto:               l.valorNeto ?? null,
      por_entregar_cantidad:    l.porEntregarCantidad ?? null,
      por_entregar_valor:       l.porEntregarValor ?? null,
      fecha_entrega_original:   l.fechaOriginal || null,
      fecha_entrega_actual:     l.fechaActual || null,
      // El upsert escribe todas las columnas: arrastramos los valores que se preservan.
      fecha_entrega_anterior:   cambio ? prev.fecha_entrega_actual : (prev?.fecha_entrega_anterior || null),
      fecha_entrega_confirmada: prev?.fecha_entrega_confirmada || null,
      status:                   l.status || null,
      activo:                   true,
      updated_at:               ahora,
    })
  }

  for (let i = 0; i < filas.length; i += CHUNK) {
    const { error: e } = await supabase
      .from('seg_lineas')
      .upsert(filas.slice(i, i + CHUNK), { onConflict: 'documento_compras,posicion' })
    if (e) throw e
  }

  // Las líneas que el cliente ya no manda salen de la vista (histórico conservado).
  const faltan = (actuales || []).filter(r => !vistas.has(`${r.documento_compras}|${r.posicion}`)).map(r => r.id)
  for (let i = 0; i < faltan.length; i += CHUNK) {
    const { error: e } = await supabase
      .from('seg_lineas')
      .update({ activo: false, updated_at: ahora })
      .in('id', faltan.slice(i, i + CHUNK))
    if (e) throw e
  }

  return { total: filas.length, nuevas, actualizadas, cambiosFecha, desactivadas: faltan.length }
}

// Fecha que el proveedor confirmó o rectificó para una línea (edición inline).
// Registrar una fecha implica que el proveedor respondió: sella `respondido_at`
// y la línea deja de contar como pendiente de respuesta.
export async function confirmarFechaEntrega(id, fecha) {
  const ahora = new Date().toISOString()
  const { error } = await supabase
    .from('seg_lineas')
    .update({ fecha_entrega_confirmada: fecha || null, respondido_at: fecha ? ahora : null, updated_at: ahora })
    .eq('id', id)
  if (error) throw error
  return fecha ? ahora : ''
}

// El proveedor respondió sin cambiar la fecha (o por teléfono): se marca a mano.
export async function marcarRespondido(ids, respondido = true) {
  const lista = [...new Set((ids || []).filter(Boolean))]
  if (!lista.length) return ''
  const ahora = new Date().toISOString()
  for (let i = 0; i < lista.length; i += CHUNK) {
    const { error } = await supabase
      .from('seg_lineas')
      .update({ respondido_at: respondido ? ahora : null, updated_at: ahora })
      .in('id', lista.slice(i, i + CHUNK))
    if (error) throw error
  }
  return respondido ? ahora : ''
}

// ─── Envío del correo (Edge Function `enviar-correo-proveedor` → Resend) ──────
// La clave de Resend vive en los secrets del proyecto, nunca en el frontend.
// La función registra el envío en seg_envios y sella `ultimo_envio_at`.
export async function enviarCorreoProveedor({ para, asunto, texto, adjunto, proveedor, lineaIds }) {
  const { data, error } = await supabase.functions.invoke('enviar-correo-proveedor', {
    body: { para, asunto, texto, adjunto, proveedor, lineaIds },
  })
  if (error) {
    // Un fallo con cuerpo JSON trae el motivo real (Resend, validación, sesión…).
    let detalle = error.message
    try { detalle = (await error.context?.json())?.error || detalle } catch { /* sin cuerpo legible */ }
    throw new Error(detalle)
  }
  return data
}

// Historial de correos enviados a un proveedor (más reciente primero).
export async function listarEnviosProveedor(codigoONombre) {
  const { data, error } = await supabase
    .from('seg_envios')
    .select('id, email, asunto, n_lineas, estado, error, created_at')
    .or(`proveedor_codigo.eq.${codigoONombre},proveedor_nombre.eq.${codigoONombre}`)
    .order('created_at', { ascending: false })
    .limit(20)
  if (error) throw error
  return (data || []).map(e => ({
    id: e.id, email: e.email, asunto: e.asunto, nLineas: e.n_lineas,
    estado: e.estado, error: e.error || '', createdAt: e.created_at,
  }))
}

// ─── Mini-directorio de emails de proveedor ───────────────────────────────────

// Map: proveedor_codigo → email (se precarga al abrir el módulo).
export async function listarEmailsProveedores() {
  const { data, error } = await supabase.from('seg_proveedor_emails').select('proveedor_codigo, email')
  if (error) throw error
  return new Map((data || []).map(r => [r.proveedor_codigo, r.email]))
}

// Guarda/actualiza el email capturado al generar un correo.
export async function guardarEmailProveedor({ codigo, nombre, email }) {
  const clave = (codigo || nombre || '').trim()
  if (!clave || !email?.trim()) return
  const { error } = await supabase
    .from('seg_proveedor_emails')
    .upsert({ proveedor_codigo: clave, proveedor_nombre: nombre || null, email: email.trim(), updated_at: new Date().toISOString() })
  if (error) throw error
}
