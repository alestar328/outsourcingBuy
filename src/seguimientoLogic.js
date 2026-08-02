// ══════════════════════════════════════════════════════════════════════════════
//  Helpers del Seguimiento de entregas (Excel del cliente)
// ══════════════════════════════════════════════════════════════════════════════
//  Fechas del Excel de SAP: mezclan seriales numéricos (45652) con textos
//  "dd/mm/yyyy" en la misma columna; todo se normaliza aquí a ISO (yyyy-mm-dd).
// ══════════════════════════════════════════════════════════════════════════════

export const hoyISO = () => new Date().toISOString().slice(0, 10)

// ISO → dd/mm/yyyy para mostrar.
export function fmtDate(iso) {
  if (!iso) return ''
  const [y, m, d] = String(iso).slice(0, 10).split('-')
  return d && m && y ? `${d}/${m}/${y}` : ''
}

// Celda de fecha del Excel (serial numérico, "dd/mm/yyyy" o ISO) → ISO o null.
export function excelDateToISO(v) {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'number' && isFinite(v)) {
    if (v < 20000 || v > 80000) return null            // fuera de rango razonable (1954–2118)
    // Serial de Excel (base 1899-12-30) → fecha UTC.
    const dt = new Date(Math.round((v - 25569) * 86400000))
    return isNaN(dt) ? null : dt.toISOString().slice(0, 10)
  }
  const str = String(v).trim()
  const m = str.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/)
  if (m) {
    let [, d, mo, y] = m
    if (y.length === 2) y = '20' + y
    return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) return str.slice(0, 10)
  return null
}

// "2030590961 MEXICHEM PERU S.A." → { codigo: '2030590961', nombre: 'MEXICHEM PERU S.A.' }
export function partirProveedor(v) {
  const str = String(v ?? '').trim().replace(/\s+/g, ' ')
  const m = str.match(/^(\d{6,})\s+(.+)$/)
  if (m) return { codigo: m[1], nombre: m[2] }
  return { codigo: '', nombre: str }
}

// Clave estable de agrupación por proveedor (código SAP o, si no trae, el nombre).
export const claveProveedor = l => l.proveedorCodigo || l.proveedorNombre || '(sin proveedor)'

// Fecha frente al proveedor: la confirmada manda; si no hay, la actual del cliente.
export const fechaObjetivo = l => l.fechaConfirmada || l.fechaActual || ''

// Días de atraso frente a la fecha objetivo (0 si no hay fecha o aún no vence).
export function diasVencidos(l, hoy = hoyISO()) {
  const obj = fechaObjetivo(l)
  if (!obj) return 0
  const diff = Math.round((new Date(hoy) - new Date(obj)) / 86400000)
  return diff > 0 ? diff : 0
}

export const emailValido = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)
