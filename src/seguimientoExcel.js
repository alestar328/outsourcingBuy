// ══════════════════════════════════════════════════════════════════════════════
//  Informe de estado para el cliente (Excel + texto de correo)
// ══════════════════════════════════════════════════════════════════════════════
//  Decisión socio (2026-07-14): el informe lista TODAS las OCs pendientes de
//  entrega del cliente (pivotado por OC, no por SOLPED), y el sistema emite el
//  texto del correo y el Excel listos para copiar/pegar y adjuntar — el envío
//  sigue siendo manual (fase 1 sin correos automáticos).
// ══════════════════════════════════════════════════════════════════════════════

import * as XLSX from 'xlsx'
import { fmtDate, fechaComprometida, fechaObjetivo, hoyISO, esPendienteEntrega } from './seguimientoLogic.js'

const siNo = v => (v ? 'Sí' : 'No')

// Construye y descarga el Excel de OCs pendientes de entrega del cliente.
// Hoja 1: resumen por OC. Hoja 2: detalle de líneas pendientes.
export function exportarInformeCliente({ clienteNombre, ocs }) {
  const pendientes = ocs.filter(o => o.cliente === clienteNombre && esPendienteEntrega(o))

  const resumen = [[
    'N° OC', 'Proveedor', 'F. emisión', '¿Proveedor recibió la OC?', 'Estado',
    'F. comprometida', 'F. confirmada proveedor', 'Nueva fecha entrega', 'Avance %', 'Líneas pendientes',
  ]]
  for (const oc of pendientes) {
    const lineasPend = oc.items.filter(it => it.recibido < it.cantidad).length
    resumen.push([
      oc.numeroOC, oc.proveedor, fmtDate(oc.fechaEmision), siNo(oc.ocRecibidaProveedor), oc.hito,
      fmtDate(fechaComprometida(oc)), fmtDate(oc.fechaEntregaConfirmada), fmtDate(oc.nuevaFechaEntrega),
      oc.avancePct, lineasPend,
    ])
  }

  const detalle = [[
    'N° OC', 'Pos.', 'Código', 'Descripción', 'UM',
    'Cant. pedida', 'Cant. recibida', 'Pendiente', 'F. comprometida', 'F. estimada',
  ]]
  for (const oc of pendientes)
    for (const it of oc.items) {
      if (it.recibido >= it.cantidad) continue
      detalle.push([
        oc.numeroOC, it.posicion ?? '', it.codigo, it.descripcion, it.unidad,
        it.cantidad, it.recibido, it.cantidad - it.recibido,
        fmtDate(it.fechaEntrega), fmtDate(it.fechaEstimada),
      ])
    }

  const wb = XLSX.utils.book_new()
  const ws1 = XLSX.utils.aoa_to_sheet(resumen)
  ws1['!cols'] = [{ wch: 12 }, { wch: 34 }, { wch: 11 }, { wch: 20 }, { wch: 16 }, { wch: 14 }, { wch: 18 }, { wch: 16 }, { wch: 9 }, { wch: 14 }]
  XLSX.utils.book_append_sheet(wb, ws1, 'OCs pendientes')
  const ws2 = XLSX.utils.aoa_to_sheet(detalle)
  ws2['!cols'] = [{ wch: 12 }, { wch: 6 }, { wch: 14 }, { wch: 46 }, { wch: 6 }, { wch: 11 }, { wch: 12 }, { wch: 10 }, { wch: 14 }, { wch: 12 }]
  XLSX.utils.book_append_sheet(wb, ws2, 'Detalle líneas')

  const safe = (clienteNombre || 'cliente').replace(/[^\w.-]+/g, '_').slice(0, 40)
  XLSX.writeFile(wb, `MinosERP_Seguimiento_${safe}_${hoyISO()}.xlsx`)
  return pendientes.length
}

// Texto del correo listo para copiar y pegar (el Excel va adjunto).
export function textoCorreoInforme({ clienteNombre, ocs }) {
  const pendientes = ocs.filter(o => o.cliente === clienteNombre && esPendienteEntrega(o))
  const lineas = pendientes.map(oc => {
    const obj = fechaObjetivo(oc)
    const partes = [
      `• OC ${oc.numeroOC} — ${oc.proveedor || 'proveedor por confirmar'} — ${oc.hito}`,
      obj ? `entrega prevista ${fmtDate(obj)}` : 'fecha de entrega por confirmar',
    ]
    if (oc.avancePct > 0) partes.push(`avance ${oc.avancePct}%`)
    return partes.join(' — ')
  })
  return [
    `Estimados señores ${clienteNombre}:`,
    '',
    `Les compartimos el estado de sus órdenes de compra pendientes de entrega al ${fmtDate(hoyISO())}:`,
    '',
    ...(lineas.length ? lineas : ['(Sin órdenes de compra pendientes de entrega a la fecha.)']),
    '',
    'Adjuntamos el detalle línea a línea en el archivo Excel.',
    'Quedamos atentos a cualquier consulta.',
    '',
    'Saludos cordiales,',
    'Equipo Minos — Gestión de Compras',
  ].join('\n')
}
