// ══════════════════════════════════════════════════════════════════════════════
//  Dashboard de Seguimiento — foco operativo del día
// ══════════════════════════════════════════════════════════════════════════════
//  Responde a "¿qué tengo que hacer hoy?" con los datos ya cargados en
//  `seg_lineas`: qué falta confirmar, qué está vencido, a quién se le escribió y
//  no contesta, y qué entra en los próximos 7 días. No inventa histórico: todo
//  sale de las mismas líneas que alimentan la List Report de Seguimiento.
//
//  Los importes NO se suman entre monedas (el Excel del cliente mezcla USD y
//  PEN): se totalizan por moneda y se muestran por separado.
// ══════════════════════════════════════════════════════════════════════════════

import { useState, useEffect, useMemo } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import {
  Truck, Clock, AlertTriangle, CalendarCheck, RefreshCw, ArrowRight, FileSpreadsheet,
} from 'lucide-react'
import { listarLineas } from './seguimientoRepo.js'
import {
  hoyISO, fmtDate, fechaObjetivo, diasVencidos, claveProveedor,
  estadoRespuesta, UMBRAL_SIN_RESPUESTA_DIAS, OPCIONES_UMBRAL,
} from './seguimientoLogic.js'

const C = {
  bg: '#F5F6F7', card: '#FFFFFF',
  primary: '#0070F2', brand: '#0854A0',
  gold: '#E78C07', warn: '#E78C07',
  text: '#32363A', muted: '#6A6D70',
  border: '#E5E5E5', borderInput: '#BABABA',
  danger: '#BB0000', info: '#0070F2', success: '#188F3A',
}
const F = 'Inter, sans-serif'

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

const fmtEntero = n => Number(n || 0).toLocaleString('es-PE', { maximumFractionDigits: 0 })
// Importes grandes en notación corta: 16.650.000 → "16,65 M".
const fmtImporte = n => {
  const v = Number(n || 0)
  if (v >= 1e6) return `${(v / 1e6).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} M`
  if (v >= 1e3) return `${(v / 1e3).toLocaleString('es-PE', { maximumFractionDigits: 1 })} K`
  return fmtEntero(v)
}

// ─── Piezas visuales (mismo lenguaje que el resto de la app) ──────────────────

const Card = ({ children, style }) => (
  <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, boxShadow: '0 1px 4px rgba(0,0,0,0.06)', padding: 16, minWidth: 0, ...style }}>{children}</div>
)

const Titulo = ({ children, extra }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
    <span style={{ fontFamily: F, fontSize: 11, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{children}</span>
    {extra && <span style={{ marginLeft: 'auto' }}>{extra}</span>}
  </div>
)

function KpiCard({ k, isMobile, onClick }) {
  const [hover, setHover] = useState(false)
  const Icon = k.icon
  return (
    <div onClick={onClick} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        background: C.card, border: `1px solid ${hover ? `${k.color}55` : C.border}`, borderRadius: 12, padding: 16,
        cursor: onClick ? 'pointer' : 'default', transition: 'box-shadow .15s, transform .15s',
        boxShadow: hover ? '0 4px 14px rgba(0,0,0,0.12)' : '0 1px 4px rgba(0,0,0,0.06)',
        transform: hover && onClick ? 'translateY(-2px)' : 'none', minWidth: 0,
      }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <span style={{ fontFamily: F, fontSize: isMobile ? 9 : 10, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.08em', lineHeight: 1.4 }}>{k.label}</span>
        <div style={{ padding: 6, borderRadius: 7, background: `${k.color}12`, flexShrink: 0, marginLeft: 6 }}>
          <Icon size={14} style={{ color: k.color, display: 'block' }} />
        </div>
      </div>
      <div style={{ fontFamily: F, fontWeight: 900, fontSize: isMobile ? 28 : 34, color: k.color, marginTop: 8, lineHeight: 1 }}>{k.value}</div>
      <div style={{ fontFamily: F, fontSize: 11, color: C.muted, marginTop: 5 }}>{k.sub}</div>
    </div>
  )
}

// ─── Cálculo de los indicadores ───────────────────────────────────────────────

function calcular(lineas, umbral) {
  const hoy = hoyISO()
  const en7 = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10)

  const pendientes = lineas.filter(l => !l.fechaConfirmada)
  const vencidas = lineas.filter(l => diasVencidos(l, hoy) > 0)
  const sinRespuesta = lineas.filter(l => estadoRespuesta(l, umbral) === 'sin_respuesta')
  const proximas = lineas.filter(l => {
    const obj = fechaObjetivo(l)
    return obj && obj >= hoy && obj <= en7
  })

  // Estado de la gestión con el proveedor.
  const estados = { sin_enviar: 0, esperando: 0, sin_respuesta: 0, respondido: 0 }
  for (const l of lineas) estados[estadoRespuesta(l, umbral)]++

  // Valor por entregar, separado por moneda (no se suman entre sí).
  const porMoneda = new Map()
  for (const l of lineas) {
    const m = l.moneda || '—'
    const v = l.porEntregarValor ?? l.valorNeto ?? 0
    if (!v) continue
    porMoneda.set(m, (porMoneda.get(m) || 0) + v)
  }
  const importes = [...porMoneda.entries()].sort((a, b) => b[1] - a[1])

  // ── Entregas por mes de la fecha objetivo ──
  //  Los meses salen de los datos, NO de una ventana fija hacia el futuro: el
  //  Excel del cliente trae histórico (las OCs cargadas van de 2025 a mediados
  //  de 2026), así que un "próximos 6 meses" saldría vacío. Se muestran los 12
  //  últimos meses con líneas. El reparto de cada barra usa las mismas
  //  definiciones que los KPIs, de modo que las cifras cuadran entre sí.
  const nuevoBucket = (clave, mes) => ({ clave, mes, vencidas: 0, sinConfirmar: 0, confirmadas: 0 })
  const porMes = new Map()
  const sinFecha = nuevoBucket('9999-99', 'Sin fecha')
  let haySinFecha = false

  for (const l of lineas) {
    const obj = fechaObjetivo(l)
    const campo = diasVencidos(l, hoy) > 0 ? 'vencidas' : l.fechaConfirmada ? 'confirmadas' : 'sinConfirmar'
    if (!obj) { sinFecha[campo]++; haySinFecha = true; continue }
    const k = obj.slice(0, 7)
    if (!porMes.has(k)) {
      const [y, m] = k.split('-')
      porMes.set(k, nuevoBucket(k, `${MESES[Number(m) - 1]} ${y.slice(2)}`))
    }
    porMes.get(k)[campo]++
  }
  const grafico = [
    ...[...porMes.values()].sort((a, b) => (a.clave < b.clave ? -1 : 1)).slice(-12),
    ...(haySinFecha ? [sinFecha] : []),
  ]

  // ── Ranking de proveedores: primero quien tiene material vencido ──
  const porProveedor = new Map()
  for (const l of lineas) {
    const clave = claveProveedor(l)
    if (!porProveedor.has(clave)) {
      porProveedor.set(clave, {
        clave, nombre: l.proveedorNombre || clave, codigo: l.proveedorCodigo || '',
        total: 0, pendientes: 0, vencidas: 0, sinRespuesta: 0, proxima: '',
      })
    }
    const p = porProveedor.get(clave)
    p.total++
    if (!l.fechaConfirmada) p.pendientes++
    if (diasVencidos(l, hoy) > 0) p.vencidas++
    if (estadoRespuesta(l, umbral) === 'sin_respuesta') p.sinRespuesta++
    const obj = fechaObjetivo(l)
    if (obj && obj >= hoy && (!p.proxima || obj < p.proxima)) p.proxima = obj
  }
  const ranking = [...porProveedor.values()]
    .filter(p => p.pendientes > 0)
    .sort((a, b) => b.vencidas - a.vencidas || b.sinRespuesta - a.sinRespuesta || b.pendientes - a.pendientes)

  return {
    kpis: { pendientes: pendientes.length, vencidas: vencidas.length, sinRespuesta: sinRespuesta.length, proximas: proximas.length },
    totalLineas: lineas.length, proveedores: porProveedor.size,
    estados, importes, grafico, ranking,
  }
}

// ─── Vista ────────────────────────────────────────────────────────────────────

export default function DashboardSeguimiento({ isMobile, onNav }) {
  const [lineas, setLineas] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [umbral, setUmbral] = useState(UMBRAL_SIN_RESPUESTA_DIAS)

  // `setLoading(true)` vive fuera del efecto a propósito: llamarlo en el cuerpo
  // del efecto dispara renders en cascada (react-hooks/set-state-in-effect).
  const cargar = () => listarLineas()
    .then(ls => { setLineas(ls); setError(null) })
    .catch(e => setError(e.message))
    .finally(() => setLoading(false))

  const recargar = () => { setLoading(true); cargar() }

  useEffect(() => { cargar() }, [])

  const d = useMemo(() => calcular(lineas, umbral), [lineas, umbral])
  const gap = isMobile ? 12 : 16

  if (loading) {
    return (
      <div style={{ fontFamily: F, fontSize: 12, color: C.muted, padding: 24, display: 'flex', alignItems: 'center', gap: 8 }}>
        <RefreshCw size={14} style={{ animation: 'spin 1s linear infinite' }} />Cargando indicadores de seguimiento…
      </div>
    )
  }

  if (!lineas.length) {
    return (
      <div style={{ border: `1px dashed ${C.borderInput}`, borderRadius: 12, padding: '48px 20px', textAlign: 'center', margin: 20 }}>
        <FileSpreadsheet size={34} style={{ color: C.borderInput }} />
        <div style={{ fontFamily: F, fontSize: 14, fontWeight: 600, color: C.text, marginTop: 10 }}>
          {error ? 'No se pudieron cargar los datos' : 'Todavía no hay líneas de seguimiento'}
        </div>
        <div style={{ fontFamily: F, fontSize: 12, color: C.muted, marginTop: 4 }}>
          {error || 'Sube el Excel de OCs del cliente en la pantalla Seguimiento y este panel se llenará solo.'}
        </div>
        {onNav && !error && (
          <button onClick={() => onNav('seguimiento')}
            style={{ marginTop: 14, display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: F, fontSize: 12, fontWeight: 600, background: C.primary, color: '#fff', border: `1px solid ${C.primary}`, borderRadius: 8, padding: '7px 13px', cursor: 'pointer' }}>
            Ir a Seguimiento <ArrowRight size={13} />
          </button>
        )}
      </div>
    )
  }

  const kpis = [
    { label: 'Por confirmar',      value: fmtEntero(d.kpis.pendientes),   sub: 'materiales sin fecha confirmada', icon: Truck,         color: C.warn    },
    { label: 'Vencidos',           value: fmtEntero(d.kpis.vencidas),     sub: 'la fecha ya pasó',                icon: AlertTriangle, color: C.danger  },
    { label: 'Sin respuesta',      value: fmtEntero(d.kpis.sinRespuesta), sub: `+${umbral} días desde el correo`, icon: Clock,         color: C.gold    },
    { label: 'Entregas 7 días',    value: fmtEntero(d.kpis.proximas),     sub: 'previstas esta semana',           icon: CalendarCheck, color: C.info    },
  ]

  const gestion = [
    { label: 'Sin escribir',   count: d.estados.sin_enviar,    color: C.muted   },
    { label: 'Esperando',      count: d.estados.esperando,     color: C.info    },
    { label: 'Sin respuesta',  count: d.estados.sin_respuesta, color: C.danger  },
    { label: 'Respondido',     count: d.estados.respondido,    color: C.success },
  ]

  const irASeguimiento = onNav ? () => onNav('seguimiento') : undefined

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: isMobile ? '14px 14px' : 24, display: 'flex', flexDirection: 'column', gap }}>

      {error && (
        <div style={{ fontFamily: F, fontSize: 12, color: C.danger, background: `${C.danger}12`, border: `1px solid ${C.danger}44`, borderRadius: 8, padding: '8px 12px' }}>
          {error}
        </div>
      )}

      {/* ── Cabecera de contexto ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontFamily: F, fontSize: 12, color: C.muted }}>
          <strong style={{ color: C.text }}>{fmtEntero(d.totalLineas)}</strong> materiales en seguimiento ·{' '}
          <strong style={{ color: C.text }}>{fmtEntero(d.proveedores)}</strong> proveedores
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          <select value={umbral} onChange={e => setUmbral(Number(e.target.value))}
            title="Días sin respuesta a partir de los cuales hay que insistir"
            style={{ fontFamily: F, fontSize: 12, border: `1px solid ${C.borderInput}`, borderRadius: 8, padding: '6px 8px', outline: 'none', color: C.text, background: C.card }}>
            {OPCIONES_UMBRAL.map(x => <option key={x} value={x}>Sin respuesta +{x} días</option>)}
          </select>
          <button onClick={recargar} title="Recargar indicadores"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: F, fontSize: 12, fontWeight: 600, background: C.card, color: C.brand, border: `1px solid ${C.borderInput}`, borderRadius: 8, padding: '6px 12px', cursor: 'pointer' }}>
            <RefreshCw size={13} />{isMobile ? '' : 'Actualizar'}
          </button>
        </div>
      </div>

      {/* ── KPIs ── */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)', gap: isMobile ? 10 : 14 }}>
        {kpis.map(k => <KpiCard key={k.label} k={k} isMobile={isMobile} onClick={irASeguimiento} />)}
      </div>

      {/* ── Calendario de entregas + estado de la gestión ── */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 260px', gap: 14 }}>
        <Card>
          <Titulo extra={
            <span style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
              {[{ l: 'Vencidas', c: C.danger }, { l: 'Sin confirmar', c: C.warn }, { l: 'Confirmadas', c: C.success }].map(x => (
                <span key={x.l} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <span style={{ width: 10, height: 10, borderRadius: 2, background: x.c, display: 'inline-block' }} />
                  <span style={{ fontFamily: F, fontSize: 11, color: C.muted, textTransform: 'none', letterSpacing: 0 }}>{x.l}</span>
                </span>
              ))}
            </span>
          }>
            Entregas por mes de la fecha de entrega
          </Titulo>
          <ResponsiveContainer width="100%" height={isMobile ? 180 : 220}>
            <BarChart data={d.grafico} margin={{ top: 0, right: 6, left: -20, bottom: 0 }} barCategoryGap="28%">
              <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false} />
              <XAxis dataKey="mes" tick={{ fill: C.muted, fontSize: 10, fontFamily: F }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: C.muted, fontSize: 10, fontFamily: F }} axisLine={false} tickLine={false} allowDecimals={false} />
              <Tooltip
                formatter={(v, n) => [fmtEntero(v), { vencidas: 'Vencidas', sinConfirmar: 'Sin confirmar', confirmadas: 'Confirmadas' }[n] || n]}
                contentStyle={{ background: C.card, border: `1px solid ${C.border}`, fontFamily: F, fontSize: 11, borderRadius: 6, color: C.text }} />
              <Bar dataKey="vencidas"     stackId="a" fill={C.danger}  />
              <Bar dataKey="sinConfirmar" stackId="a" fill={C.warn}    />
              <Bar dataKey="confirmadas"  stackId="a" fill={C.success} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card>
          <Titulo>Estado de la gestión</Titulo>
          <div style={{ display: isMobile ? 'grid' : 'flex', gridTemplateColumns: '1fr 1fr', flexDirection: 'column', gap: 8 }}>
            {gestion.map(s => (
              <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 11px', borderRadius: 8, background: `${s.color}0D`, border: `1px solid ${s.color}30` }}>
                <span style={{ fontFamily: F, fontWeight: 800, fontSize: 19, color: s.color, minWidth: 38, lineHeight: 1 }}>{fmtEntero(s.count)}</span>
                <span style={{ fontFamily: F, fontSize: 12, color: C.text }}>{s.label}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* ── Ranking de proveedores + valor por entregar ── */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 300px', gap: 14 }}>
        <Card style={{ overflowX: 'auto' }}>
          <Titulo extra={
            <span style={{ fontFamily: F, fontSize: 11, color: C.muted, textTransform: 'none', letterSpacing: 0 }}>
              {d.ranking.length > 8 ? `Top 8 de ${fmtEntero(d.ranking.length)}` : `${d.ranking.length} con pendientes`}
            </span>
          }>
            Proveedores a los que hay que empujar
          </Titulo>
          {d.ranking.length === 0 ? (
            <div style={{ fontFamily: F, fontSize: 12, color: C.muted, padding: '18px 0' }}>
              No queda ningún material pendiente de confirmar. 🎉
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: F, fontSize: 12 }}>
              <thead>
                <tr style={{ color: C.muted, borderBottom: `1px solid ${C.border}` }}>
                  <th style={{ padding: '0 10px 8px 0', textAlign: 'left', fontWeight: 500 }}>Proveedor</th>
                  <th style={{ padding: '0 10px 8px 0', textAlign: 'right', fontWeight: 500 }}>Pend.</th>
                  <th style={{ padding: '0 10px 8px 0', textAlign: 'right', fontWeight: 500 }}>Venc.</th>
                  {!isMobile && <th style={{ padding: '0 10px 8px 0', textAlign: 'right', fontWeight: 500 }}>Sin resp.</th>}
                  {!isMobile && <th style={{ padding: '0 0 8px 0', textAlign: 'left', fontWeight: 500 }}>Próxima entrega</th>}
                </tr>
              </thead>
              <tbody>
                {d.ranking.slice(0, 8).map(p => (
                  <tr key={p.clave} onClick={irASeguimiento}
                    style={{ borderBottom: `1px solid ${C.border}`, cursor: irASeguimiento ? 'pointer' : 'default' }}>
                    <td style={{ padding: '9px 10px 9px 0', color: C.text, fontWeight: 600, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                      title={p.codigo ? `${p.nombre} · ${p.codigo}` : p.nombre}>{p.nombre}</td>
                    <td style={{ padding: '9px 10px 9px 0', textAlign: 'right', color: C.text }}>{fmtEntero(p.pendientes)}</td>
                    <td style={{ padding: '9px 10px 9px 0', textAlign: 'right', color: p.vencidas ? C.danger : C.muted, fontWeight: p.vencidas ? 700 : 400 }}>{p.vencidas || '—'}</td>
                    {!isMobile && <td style={{ padding: '9px 10px 9px 0', textAlign: 'right', color: p.sinRespuesta ? '#8F5B00' : C.muted, fontWeight: p.sinRespuesta ? 700 : 400 }}>{p.sinRespuesta || '—'}</td>}
                    {!isMobile && <td style={{ padding: '9px 0', color: C.muted }}>{fmtDate(p.proxima) || '—'}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card>
          <Titulo>Valor por entregar</Titulo>
          {d.importes.length === 0 ? (
            <div style={{ fontFamily: F, fontSize: 12, color: C.muted }}>El Excel no trae importes.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {d.importes.map(([moneda, valor]) => (
                <div key={moneda}>
                  <div style={{ fontFamily: F, fontSize: 10, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 600 }}>{moneda}</div>
                  <div style={{ fontFamily: F, fontSize: 24, fontWeight: 800, color: C.brand, lineHeight: 1.2 }}>{fmtImporte(valor)}</div>
                </div>
              ))}
              <div style={{ fontFamily: F, fontSize: 11, color: C.muted, borderTop: `1px solid ${C.border}`, paddingTop: 8 }}>
                Totales por moneda, sin convertir entre ellas.
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}
