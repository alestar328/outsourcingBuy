// ══════════════════════════════════════════════════════════════════════════════
//  Capa de datos: Seguimiento de OCs (expediting) ↔ Supabase
// ══════════════════════════════════════════════════════════════════════════════
//  Solo el equipo de Minos registra el avance (decisión socio 2026-07-14).
//  El hito actual vive desnormalizado en ordenes_compra.hito; cada cambio se
//  anota además en la bitácora oc_eventos. Las entregas se registran en
//  oc_recepciones/oc_recepcion_items (parciales por línea) y el % de avance se
//  calcula aquí. Mismo estilo que clientesRepo.js / ordenesRepo.js.
// ══════════════════════════════════════════════════════════════════════════════

import { supabase } from './supabaseClient.js'

// Orden de la línea de vida (para saber qué hitos ya se cumplieron).
export const HITOS = ['Emitida', 'Confirmada', 'En fabricación', 'Despachada', 'Recibida parcial', 'Recibida total', 'Cerrada']
export const idxHito = h => HITOS.indexOf(h)

// El estado "clásico" de la OC se mantiene en sincronía con el hito de seguimiento
// para que el resto de la app (y reportes antiguos) sigan teniendo sentido.
const ESTADO_POR_HITO = {
  'Emitida': 'Emitida', 'Confirmada': 'Emitida', 'En fabricación': 'Emitida',
  'Despachada': 'En tránsito', 'Recibida parcial': 'En tránsito',
  'Recibida total': 'Entregada', 'Cerrada': 'Cerrada',
}

function itemDbToUI(it, recibidoPorItem) {
  const cantidad = Number(it.cantidad) || 0
  const recibido = Math.min(recibidoPorItem.get(it.id) || 0, cantidad)
  return {
    id:             it.id,
    posicion:       it.posicion,
    codigo:         it.codigo || '',
    descripcion:    it.descripcion || '',
    unidad:         it.unidad || 'UN',
    cantidad,
    precioUnitario: Number(it.precio_unitario) || 0,
    total:          Number(it.total) || 0,
    fechaEntrega:   it.fecha_entrega || '',    // comprometida
    fechaEstimada:  it.fecha_estimada || '',   // estimada (re-programación por línea)
    recibido,                                  // real acumulado de recepciones
  }
}

function ocDbToUI(oc) {
  const recibidoPorItem = new Map()
  const recepciones = (oc.oc_recepciones || [])
    .map(r => ({
      id: r.id, fecha: r.fecha, referencia: r.referencia || '', nota: r.nota || '',
      lineas: (r.oc_recepcion_items || []).map(l => ({ ocItemId: l.oc_item_id, cantidad: Number(l.cantidad) || 0 })),
    }))
    .sort((a, b) => (a.fecha || '').localeCompare(b.fecha || ''))
  for (const r of recepciones)
    for (const l of r.lineas)
      recibidoPorItem.set(l.ocItemId, (recibidoPorItem.get(l.ocItemId) || 0) + l.cantidad)

  const items = (oc.oc_items || [])
    .sort((a, b) => (a.posicion || 0) - (b.posicion || 0))
    .map(it => itemDbToUI(it, recibidoPorItem))
  const totalCantidad = items.reduce((s, it) => s + it.cantidad, 0)
  const totalRecibido = items.reduce((s, it) => s + it.recibido, 0)

  return {
    id:                     oc.id,
    numeroOC:               oc.numero_oc,
    cliente:                oc.cliente?.razon_social || '',
    clienteId:              oc.cliente_id,
    proveedor:              oc.proveedor?.razon_social || '',
    proveedorContacto:      oc.proveedor?.contacto_nombre || '',
    proveedorEmail:         oc.proveedor?.contacto_email || '',
    fechaEmision:           oc.fecha_emision || '',
    estado:                 oc.estado,
    hito:                   oc.hito || 'Emitida',
    origen:                 oc.origen || 'minos',
    ocRecibidaProveedor:    !!oc.oc_recibida_proveedor,
    fechaRecepcionOC:       oc.fecha_recepcion_oc || '',
    fechaEntregaConfirmada: oc.fecha_entrega_confirmada || '',
    nuevaFechaEntrega:      oc.nueva_fecha_entrega || '',
    fechaCierre:            oc.fecha_cierre || '',
    moneda:                 oc.moneda || 'USD',
    fechaEntregaOC:         oc.fecha_entrega || '',   // comprometida a nivel cabecera (si se capturó)
    lugarEntrega:           oc.lugar_entrega || '',
    plazoEntregaDias:       oc.plazo_entrega_dias,
    items, recepciones, totalCantidad, totalRecibido,
    avancePct: totalCantidad > 0 ? Math.round((totalRecibido / totalCantidad) * 100) : 0,
  }
}

// OCs emitidas (todo lo que no sea Borrador) con líneas y recepciones, para la
// List Report de Seguimiento. Las cerradas se incluyen: la UI decide el filtro.
export async function listarOrdenesSeguimiento() {
  const { data, error } = await supabase
    .from('ordenes_compra')
    .select(`
      id, numero_oc, cliente_id, fecha_emision, estado, hito, origen,
      oc_recibida_proveedor, fecha_recepcion_oc, fecha_entrega_confirmada,
      nueva_fecha_entrega, fecha_cierre, moneda, lugar_entrega, plazo_entrega_dias, fecha_entrega,
      cliente:clientes(razon_social),
      proveedor:proveedores(razon_social, contacto_nombre, contacto_email),
      oc_items(id, posicion, codigo, descripcion, unidad, cantidad, precio_unitario, total, fecha_entrega, fecha_estimada),
      oc_recepciones(id, fecha, referencia, nota, oc_recepcion_items(oc_item_id, cantidad))
    `)
    .neq('estado', 'Borrador')
    .order('fecha_emision', { ascending: false })
  if (error) throw error
  return (data || []).map(ocDbToUI)
}

// Bitácora de una OC (hitos + notas), más reciente primero.
export async function listarEventos(ocId) {
  const { data, error } = await supabase
    .from('oc_eventos')
    .select('id, hito, fecha, nota, created_at')
    .eq('oc_id', ocId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data || []).map(e => ({ id: e.id, hito: e.hito, fecha: e.fecha, nota: e.nota || '', createdAt: e.created_at }))
}

async function insertarEvento(ocId, { hito = null, fecha = null, nota = null }) {
  const { error } = await supabase.from('oc_eventos')
    .insert({ oc_id: ocId, hito, fecha: fecha || undefined, nota })
  if (error) throw error
}

// El proveedor acusó recibo de la OC (umbral socio: 1 día hábil desde emisión).
export async function marcarOCRecibida(ocId, fecha) {
  const { error } = await supabase.from('ordenes_compra')
    .update({ oc_recibida_proveedor: true, fecha_recepcion_oc: fecha })
    .eq('id', ocId)
  if (error) throw error
  await insertarEvento(ocId, { fecha, nota: 'Proveedor acusó recibo de la OC' })
}

// El proveedor confirmó fecha de entrega (umbral socio: 2 días hábiles). Si la OC
// seguía en "Emitida", pasa a "Confirmada".
export async function confirmarFechaEntrega(ocId, fecha, hitoActual) {
  const upd = { fecha_entrega_confirmada: fecha }
  const sube = idxHito(hitoActual) < idxHito('Confirmada')
  if (sube) { upd.hito = 'Confirmada'; upd.estado = ESTADO_POR_HITO['Confirmada'] }
  const { error } = await supabase.from('ordenes_compra').update(upd).eq('id', ocId)
  if (error) throw error
  await insertarEvento(ocId, {
    hito: sube ? 'Confirmada' : null,
    nota: `Proveedor confirmó fecha de entrega: ${fecha}`,
  })
}

// Re-programación de la entrega ("nueva fecha de entrega" a nivel OC).
export async function actualizarNuevaFecha(ocId, fecha) {
  const { error } = await supabase.from('ordenes_compra')
    .update({ nueva_fecha_entrega: fecha || null }).eq('id', ocId)
  if (error) throw error
  await insertarEvento(ocId, { nota: fecha ? `Nueva fecha de entrega: ${fecha}` : 'Se quitó la nueva fecha de entrega' })
}

// Cambia el hito de la línea de vida (En fabricación, Despachada, Cerrada…).
export async function cambiarHito(ocId, hito, { fecha, nota } = {}) {
  const upd = { hito, estado: ESTADO_POR_HITO[hito] || 'Emitida' }
  if (hito === 'Cerrada') upd.fecha_cierre = fecha || new Date().toISOString().slice(0, 10)
  const { error } = await supabase.from('ordenes_compra').update(upd).eq('id', ocId)
  if (error) throw error
  await insertarEvento(ocId, { hito, fecha, nota })
}

// Nota libre de gestión (llamada al proveedor, correo, incidencia…).
export async function registrarNota(ocId, nota) {
  await insertarEvento(ocId, { nota })
}

// Fecha estimada de una línea concreta.
export async function actualizarFechaEstimada(ocItemId, fecha) {
  const { error } = await supabase.from('oc_items')
    .update({ fecha_estimada: fecha || null }).eq('id', ocItemId)
  if (error) throw error
}

// Registra una recepción en almacén del cliente (aviso por correo/llamada).
// `lineas` = [{ ocItemId, cantidad }] con cantidad > 0. `esTotal` lo calcula la UI
// comparando lo acumulado contra lo pedido; decide el hito resultante.
export async function registrarRecepcion(ocId, { fecha, referencia, nota, lineas, esTotal }) {
  const filas = (lineas || []).filter(l => Number(l.cantidad) > 0)
  if (!filas.length) throw new Error('Indica la cantidad recibida en al menos una línea.')

  const { data: rec, error } = await supabase.from('oc_recepciones')
    .insert({ oc_id: ocId, fecha, referencia: referencia?.trim() || null, nota: nota?.trim() || null })
    .select('id').single()
  if (error) throw error

  const { error: e2 } = await supabase.from('oc_recepcion_items')
    .insert(filas.map(l => ({ recepcion_id: rec.id, oc_item_id: l.ocItemId, cantidad: Number(l.cantidad) })))
  if (e2) {
    await supabase.from('oc_recepciones').delete().eq('id', rec.id)  // rollback de cabecera
    throw e2
  }

  const hito = esTotal ? 'Recibida total' : 'Recibida parcial'
  const { error: e3 } = await supabase.from('ordenes_compra')
    .update({ hito, estado: ESTADO_POR_HITO[hito] }).eq('id', ocId)
  if (e3) throw e3
  await insertarEvento(ocId, { hito, fecha, nota: `Recepción registrada${referencia ? ` (${referencia})` : ''}` })
  return rec.id
}
