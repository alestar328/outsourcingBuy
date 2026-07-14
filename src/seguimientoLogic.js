// ══════════════════════════════════════════════════════════════════════════════
//  Lógica de seguimiento: fechas y semáforo
// ══════════════════════════════════════════════════════════════════════════════
//  Umbrales acordados con el socio (2026-07-14):
//   · Acuse de recibo de la OC por el proveedor: 1 día hábil desde la emisión.
//   · Confirmación de fecha de entrega: 2 días hábiles desde la emisión.
//   · Ámbar además si faltan ≤7 días para la fecha objetivo sin despacho.
//   · Rojo con la fecha objetivo vencida sin entrega completa.
//  Compartida entre la vista Seguimiento y el informe Excel/correo al cliente.
// ══════════════════════════════════════════════════════════════════════════════

import { idxHito } from './seguimientoRepo.js'

export const UMBRAL_ACUSE_OC_DIAS       = 1
export const UMBRAL_CONFIRMA_FECHA_DIAS = 2
export const UMBRAL_AMBAR_PREVIO_DIAS   = 7

export const hoyISO = () => new Date().toISOString().slice(0, 10)

export function fmtDate(s) {
  if (!s) return ''
  const p = String(s).split('-')
  return p.length === 3 ? `${p[2]}.${p[1]}.${p[0]}` : s
}

// Días hábiles (L–V) transcurridos desde `desdeISO` (exclusivo) hasta `hastaISO` (inclusivo).
export function diasHabilesEntre(desdeISO, hastaISO) {
  if (!desdeISO || !hastaISO || hastaISO <= desdeISO) return 0
  const d = new Date(desdeISO + 'T00:00:00')
  const fin = new Date(hastaISO + 'T00:00:00')
  let n = 0
  while (d < fin) {
    d.setDate(d.getDate() + 1)
    const wd = d.getDay()
    if (wd !== 0 && wd !== 6) n++
  }
  return n
}

const diasCalendario = (desdeISO, hastaISO) =>
  Math.round((new Date(hastaISO + 'T00:00:00') - new Date(desdeISO + 'T00:00:00')) / 86400000)

// Fecha comprometida de la OC: cabecera si existe; si no, la última fecha de
// entrega de sus líneas; si no, emisión + plazo en días.
export function fechaComprometida(oc) {
  if (oc.fechaEntregaOC) return oc.fechaEntregaOC
  const fechas = (oc.items || []).map(i => i.fechaEntrega).filter(Boolean).sort()
  if (fechas.length) return fechas[fechas.length - 1]
  if (oc.fechaEmision && oc.plazoEntregaDias) {
    const d = new Date(oc.fechaEmision + 'T00:00:00')
    d.setDate(d.getDate() + Number(oc.plazoEntregaDias))
    return d.toISOString().slice(0, 10)
  }
  return ''
}

// Fecha contra la que se mide el retraso: la re-programación manda, luego la
// confirmada por el proveedor y por último la comprometida original.
export function fechaObjetivo(oc) {
  return oc.nuevaFechaEntrega || oc.fechaEntregaConfirmada || fechaComprometida(oc)
}

// Semáforo de la OC → { nivel: 'rojo'|'ambar'|'verde'|'gris', motivo }
export function semaforoOC(oc, hoy = hoyISO()) {
  if (oc.hito === 'Cerrada')
    return { nivel: 'gris', motivo: 'OC cerrada' }
  if (oc.hito === 'Recibida total')
    return { nivel: 'verde', motivo: 'Entregada al 100% — lista para cerrar' }

  const objetivo = fechaObjetivo(oc)
  if (objetivo && objetivo < hoy)
    return { nivel: 'rojo', motivo: `Fecha de entrega vencida (${fmtDate(objetivo)})` }

  if (!oc.ocRecibidaProveedor && diasHabilesEntre(oc.fechaEmision, hoy) > UMBRAL_ACUSE_OC_DIAS)
    return { nivel: 'ambar', motivo: `El proveedor no acusó recibo de la OC (umbral: ${UMBRAL_ACUSE_OC_DIAS} día hábil)` }

  if (!oc.fechaEntregaConfirmada && diasHabilesEntre(oc.fechaEmision, hoy) > UMBRAL_CONFIRMA_FECHA_DIAS)
    return { nivel: 'ambar', motivo: `El proveedor no confirmó fecha de entrega (umbral: ${UMBRAL_CONFIRMA_FECHA_DIAS} días hábiles)` }

  if (objetivo && idxHito(oc.hito) < idxHito('Despachada') && diasCalendario(hoy, objetivo) <= UMBRAL_AMBAR_PREVIO_DIAS)
    return { nivel: 'ambar', motivo: `Entrega en ≤${UMBRAL_AMBAR_PREVIO_DIAS} días sin despacho registrado` }

  return { nivel: 'verde', motivo: 'En curso, dentro de plazo' }
}

// ¿La OC sigue pendiente de entrega? (para el informe al cliente: todas las OC
// pendientes de entrega — decisión socio; las recibidas al 100% y cerradas salen).
export const esPendienteEntrega = oc => oc.hito !== 'Recibida total' && oc.hito !== 'Cerrada'
