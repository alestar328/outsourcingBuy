// ══════════════════════════════════════════════════════════════════════════════
//  Excel del Seguimiento de entregas
// ══════════════════════════════════════════════════════════════════════════════
//  · Importación: hoja "Detalle" del `seguimiento_clientes.xlsx` que envía el
//    cliente (una fila por posición de OC). Las cabeceras se localizan por nombre
//    para tolerar filas en blanco y cambios de orden de columnas.
//  · Exportación: Excel por proveedor con las columnas acordadas, que se adjunta
//    al correo pidiendo confirmar la "Fecha de entrega actual".
//  · Texto del correo genérico al proveedor (el envío es manual: copiar y pegar).
// ══════════════════════════════════════════════════════════════════════════════

import * as XLSX from 'xlsx'
import { excelDateToISO, partirProveedor, fmtDate, hoyISO } from './seguimientoLogic.js'

// Normaliza una cabecera: minúsculas, sin saltos de línea ni espacios repetidos.
const norm = s => String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase()

// Cabecera del Excel del cliente → campo interno.
const CAMPOS = {
  'documento compras':        'documentoCompras',
  'pos':                      'posicion',
  'gc':                       'gc',
  'fecha documento':          'fechaDocumento',
  'texto breve':              'textoBreve',
  'material':                 'material',
  'proveedor':                'proveedor',
  'cantidad de pedido':       'cantidad',
  'um':                       'um',
  'moneda':                   'moneda',
  'valor neto de pedido':     'valorNeto',
  'por entregar (cantidad)':  'porEntregarCantidad',
  'por entregar (valor)':     'porEntregarValor',
  'fecha de entrega original': 'fechaOriginal',
  'fecha de entrega actual':  'fechaActual',
  'status':                   'status',
}
const FECHAS = new Set(['fechaDocumento', 'fechaOriginal', 'fechaActual'])
const NUMEROS = new Set(['cantidad', 'valorNeto', 'porEntregarCantidad', 'porEntregarValor'])

// Lee el workbook del cliente y devuelve las líneas normalizadas.
// Busca la hoja cuya cabecera contiene "Documento compras" (preferencia: "Detalle").
export function parsearSeguimientoExcel(wb) {
  const nombres = [...wb.SheetNames].sort((a, b) =>
    (norm(b) === 'detalle') - (norm(a) === 'detalle'))
  for (const nombre of nombres) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[nombre], { header: 1, defval: null })
    // La cabecera puede no ser la primera fila (el cliente deja filas en blanco).
    for (let h = 0; h < Math.min(rows.length, 12); h++) {
      const head = (rows[h] || []).map(norm)
      if (!head.includes('documento compras')) continue
      const colDe = {}
      head.forEach((c, i) => { if (CAMPOS[c] && colDe[CAMPOS[c]] === undefined) colDe[CAMPOS[c]] = i })
      if (colDe.posicion === undefined) break        // hoja resumen (sin Pos) ⇒ probar otra
      return { hoja: nombre, lineas: leerLineas(rows, h + 1, colDe) }
    }
  }
  throw new Error('No se encontró la hoja de detalle: ninguna cabecera contiene «Documento compras» y «Pos». Revisa que sea el Excel de seguimiento del cliente.')
}

function leerLineas(rows, desde, colDe) {
  const lineas = []
  for (let i = desde; i < rows.length; i++) {
    const row = rows[i] || []
    const cell = campo => colDe[campo] === undefined ? null : row[colDe[campo]]
    const doc = String(cell('documentoCompras') ?? '').trim()
    if (!doc) continue                               // filas vacías o de relleno
    const l = { documentoCompras: doc, posicion: String(cell('posicion') ?? '').trim() || '0' }
    for (const campo of Object.keys(colDe)) {
      if (campo === 'documentoCompras' || campo === 'posicion' || campo === 'proveedor') continue
      const v = cell(campo)
      if (FECHAS.has(campo)) l[campo] = excelDateToISO(v)
      else if (NUMEROS.has(campo)) l[campo] = v === null || v === '' ? null : Number(v) || 0
      else l[campo] = String(v ?? '').trim()
    }
    const { codigo, nombre } = partirProveedor(cell('proveedor'))
    l.proveedorCodigo = codigo
    l.proveedorNombre = nombre
    lineas.push(l)
  }
  return lineas
}

// ─── Excel por proveedor (adjunto del correo) ─────────────────────────────────
// Columnas acordadas: solo lo que el proveedor necesita para confirmar fechas.
export function exportarExcelProveedor({ proveedorNombre, lineas }) {
  const aoa = [[
    'Material', 'Texto breve', 'Fecha documento', 'Proveedor', 'Cantidad de pedido',
    'UM', 'Moneda', 'Valor neto pedido', 'Fecha de entrega actual', 'Fecha de entrega confirmada',
  ]]
  for (const l of lineas) {
    aoa.push([
      l.material || '', l.textoBreve || '', fmtDate(l.fechaDocumento), l.proveedorNombre || proveedorNombre,
      l.cantidad ?? '', l.um || '', l.moneda || '', l.valorNeto ?? '',
      fmtDate(l.fechaActual), fmtDate(l.fechaConfirmada),
    ])
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!cols'] = [
    { wch: 14 }, { wch: 44 }, { wch: 14 }, { wch: 34 }, { wch: 15 },
    { wch: 6 }, { wch: 8 }, { wch: 15 }, { wch: 20 }, { wch: 24 },
  ]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Confirmación entregas')
  const safe = (proveedorNombre || 'proveedor').replace(/[^\w.-]+/g, '_').slice(0, 40)
  XLSX.writeFile(wb, `MinosERP_Confirmacion_${safe}_${hoyISO()}.xlsx`)
}

// ─── Correo genérico al proveedor ─────────────────────────────────────────────

export function asuntoCorreoProveedor(lineas) {
  const ocs = [...new Set(lineas.map(l => l.documentoCompras))]
  const lista = ocs.slice(0, 3).join(', ') + (ocs.length > 3 ? '…' : '')
  return `Confirmación de fechas de entrega — OC${ocs.length !== 1 ? 's' : ''} ${lista}`
}

export function textoCorreoProveedor({ proveedorNombre, lineas }) {
  const resumen = lineas.map(l => {
    const partes = [
      `• OC ${l.documentoCompras} pos. ${l.posicion}`,
      l.material ? `${l.material} — ${l.textoBreve}` : l.textoBreve,
      `${l.cantidad ?? ''} ${l.um || ''}`.trim(),
      `entrega prevista ${fmtDate(l.fechaActual) || 'por definir'}`,
    ]
    return partes.filter(Boolean).join(' — ')
  })
  return [
    `Estimados señores ${proveedorNombre}:`,
    '',
    `Como parte del seguimiento de las órdenes de compra que tienen en curso con nuestro cliente, les solicitamos confirmar si la fecha de entrega prevista de los siguientes materiales sigue vigente, o indicarnos la fecha rectificada en caso de haber cambiado:`,
    '',
    ...resumen,
    '',
    'Adjuntamos el detalle en Excel: agradeceremos completar la columna «Fecha de entrega confirmada» y devolvernos el archivo.',
    'Quedamos atentos a su pronta respuesta.',
    '',
    'Saludos cordiales,',
    'Equipo Minos — Gestión de Compras',
  ].join('\n')
}
