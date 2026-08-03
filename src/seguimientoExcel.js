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

import XLSX from 'xlsx-js-style'
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
//  Columnas acordadas: solo lo que el proveedor necesita para confirmar fechas.
//  Este archivo lo abre gente ajena al ERP (y representa a Minos ante el
//  proveedor), así que va formateado: cabecera de marca, instrucciones visibles
//  y la única columna que deben rellenar resaltada en ámbar para que no haya duda.
//  Requiere `xlsx-js-style`: el SheetJS community ignora la propiedad `s`.

const HEX = {
  brand: '0854A0', shell: '354A5E', blanco: 'FFFFFF',
  zebra: 'FAFBFC', suave: 'EDEFF1', linea: 'D0D5DA',
  ambar: 'FFF6E5', ambarTexto: '8F5B00', ambarLinea: 'E3B778',
  texto: '32363A', muted: '5B6066',
}
const FUENTE = 'Calibri'
const trazo = { style: 'thin', color: { rgb: HEX.linea } }
const BORDE = { top: trazo, bottom: trazo, left: trazo, right: trazo }
const relleno = rgb => ({ fill: { fgColor: { rgb } } })

// Definición única de las columnas: título, ancho y cómo se pinta el dato.
const COLS_PROVEEDOR = [
  { titulo: 'Material',                    wch: 15 },
  { titulo: 'Texto breve',                 wch: 46 },
  { titulo: 'Fecha documento',             wch: 16, centro: true },
  { titulo: 'Proveedor',                   wch: 34 },
  { titulo: 'Cantidad de pedido',          wch: 16, numFmt: '#,##0.##' },
  { titulo: 'UM',                          wch: 7,  centro: true },
  { titulo: 'Moneda',                      wch: 9,  centro: true },
  { titulo: 'Valor neto pedido',           wch: 17, numFmt: '#,##0.00' },
  { titulo: 'Fecha de entrega actual',     wch: 21, centro: true },
  { titulo: 'Fecha de entrega confirmada', wch: 25, centro: true, editable: true },
]
const N_COLS = COLS_PROVEEDOR.length
const FILA_CABECERA = 3            // 0-based: título, subtítulo, instrucciones, cabecera

// Fila completa (todas las celdas existen) para que bordes y rellenos se pinten.
const filaAncha = (valor = '') => [valor, ...Array(N_COLS - 1).fill('')]

function construirWbProveedor({ proveedorNombre, lineas }) {
  const aoa = [
    filaAncha('CONFIRMACIÓN DE FECHAS DE ENTREGA'),
    filaAncha(`${proveedorNombre} · ${lineas.length} material${lineas.length !== 1 ? 'es' : ''} · Generado el ${fmtDate(hoyISO())}`),
    filaAncha('Complete la columna «Fecha de entrega confirmada» (dd/mm/aaaa) y devuélvanos este archivo por correo.'),
    COLS_PROVEEDOR.map(c => c.titulo),
  ]
  for (const l of lineas) {
    aoa.push([
      l.material || '', l.textoBreve || '', fmtDate(l.fechaDocumento), l.proveedorNombre || proveedorNombre,
      l.cantidad ?? '', l.um || '', l.moneda || '', l.valorNeto ?? '',
      fmtDate(l.fechaActual), fmtDate(l.fechaConfirmada),
    ])
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa)
  const en = (r, c) => ws[XLSX.utils.encode_cell({ r, c })]
  const pintar = (r, c, s) => { const cel = en(r, c); if (cel) cel.s = s }

  // ── Bloque de cabecera: título de marca, contexto e instrucción ──
  ws['!merges'] = [0, 1, 2].map(r => ({ s: { r, c: 0 }, e: { r, c: N_COLS - 1 } }))
  for (let c = 0; c < N_COLS; c++) {
    pintar(0, c, {
      font: { name: FUENTE, sz: 14, bold: true, color: { rgb: HEX.blanco } },
      ...relleno(HEX.brand),
      alignment: { horizontal: 'left', vertical: 'center', indent: 1 },
    })
    pintar(1, c, {
      font: { name: FUENTE, sz: 10, color: { rgb: HEX.muted } },
      ...relleno(HEX.suave),
      alignment: { horizontal: 'left', vertical: 'center', indent: 1 },
    })
    pintar(2, c, {
      font: { name: FUENTE, sz: 10, bold: true, color: { rgb: HEX.ambarTexto } },
      ...relleno(HEX.ambar),
      alignment: { horizontal: 'left', vertical: 'center', indent: 1 },
      border: { bottom: { style: 'thin', color: { rgb: HEX.ambarLinea } } },
    })
    // ── Cabecera de la tabla: fondo oscuro, texto blanco, ajustado ──
    pintar(FILA_CABECERA, c, {
      font: { name: FUENTE, sz: 10, bold: true, color: { rgb: HEX.blanco } },
      ...relleno(HEX.shell),
      alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
      border: BORDE,
    })
  }

  // ── Datos: bordes finos, zebra y la columna a rellenar en ámbar ──
  lineas.forEach((_, i) => {
    const r = FILA_CABECERA + 1 + i
    const par = i % 2 === 1
    COLS_PROVEEDOR.forEach((col, c) => {
      pintar(r, c, {
        font: { name: FUENTE, sz: 10, color: { rgb: HEX.texto } },
        ...relleno(col.editable ? HEX.ambar : par ? HEX.zebra : HEX.blanco),
        alignment: {
          horizontal: col.numFmt ? 'right' : col.centro ? 'center' : 'left',
          vertical: 'center', wrapText: c === 1,
        },
        numFmt: col.numFmt,
        border: col.editable
          ? { ...BORDE, left: { style: 'medium', color: { rgb: HEX.ambarLinea } }, right: { style: 'medium', color: { rgb: HEX.ambarLinea } } }
          : BORDE,
      })
    })
  })

  ws['!cols'] = COLS_PROVEEDOR.map(c => ({ wch: c.wch }))
  ws['!rows'] = [{ hpt: 26 }, { hpt: 17 }, { hpt: 19 }, { hpt: 30 }]
  // Autofiltro sobre la cabecera: el proveedor puede ordenar por OC o por fecha.
  ws['!autofilter'] = { ref: XLSX.utils.encode_range({
    s: { r: FILA_CABECERA, c: 0 }, e: { r: FILA_CABECERA + lineas.length, c: N_COLS - 1 },
  }) }

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Confirmación entregas')
  return wb
}

export const nombreArchivoProveedor = proveedorNombre =>
  `MinosERP_Confirmacion_${(proveedorNombre || 'proveedor').replace(/[^\w.-]+/g, '_').slice(0, 40)}_${hoyISO()}.xlsx`

// Descarga directa (envío manual: el usuario lo adjunta él mismo).
export function exportarExcelProveedor({ proveedorNombre, lineas }) {
  XLSX.writeFile(construirWbProveedor({ proveedorNombre, lineas }), nombreArchivoProveedor(proveedorNombre))
}

// Mismo Excel en base64, para adjuntarlo al correo que envía la Edge Function.
export function excelProveedorAdjunto({ proveedorNombre, lineas }) {
  return {
    filename: nombreArchivoProveedor(proveedorNombre),
    contenidoBase64: XLSX.write(construirWbProveedor({ proveedorNombre, lineas }), { type: 'base64', bookType: 'xlsx' }),
  }
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
