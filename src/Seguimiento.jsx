// ══════════════════════════════════════════════════════════════════════════════
//  Seguimiento de Órdenes de Compra (expediting)
// ══════════════════════════════════════════════════════════════════════════════
//  List Report: OCs en curso con semáforo, acuse de recibo del proveedor y
//  nueva fecha de entrega editables en línea (pedidos del socio).
//  Object Page: línea de vida de hitos, fechas frente al proveedor, avance por
//  línea, recepciones parciales y bitácora. Informe Excel + correo por cliente.
//  Solo el equipo de Minos registra datos (fase 1, sin accesos externos).
// ══════════════════════════════════════════════════════════════════════════════

import { useState, useEffect, useMemo } from 'react'
import {
  listarOrdenesSeguimiento, listarEventos, marcarOCRecibida, confirmarFechaEntrega,
  actualizarNuevaFecha, cambiarHito, registrarNota, actualizarFechaEstimada,
  registrarRecepcion, idxHito,
} from './seguimientoRepo.js'
import { exportarInformeCliente, textoCorreoInforme } from './seguimientoExcel.js'
import {
  semaforoOC, fmtDate, hoyISO, fechaComprometida, fechaObjetivo, esPendienteEntrega,
} from './seguimientoLogic.js'
import {
  ChevronLeft, RefreshCw, CheckCircle2, AlertCircle, X, ArrowRight,
  Mail, Copy, Search, Truck, ClipboardList, Calendar,
} from 'lucide-react'

const C = {
  bg: '#F5F6F7', card: '#FFFFFF', shell: '#354A5E',
  primary: '#0070F2', brand: '#0854A0',
  gold: '#E78C07', warn: '#E78C07',
  text: '#32363A', muted: '#6A6D70',
  border: '#E5E5E5', borderInput: '#BABABA',
  danger: '#BB0000', success: '#188F3A',
}
const F = 'Inter, sans-serif'

// ─── Piezas visuales ──────────────────────────────────────────────────────────

const SEM_COLOR = { rojo: C.danger, ambar: C.warn, verde: C.success, gris: C.muted }

function Semaforo({ sem, size = 10 }) {
  return (
    <span title={sem.motivo} style={{
      display: 'inline-block', width: size, height: size, borderRadius: '50%',
      background: SEM_COLOR[sem.nivel], boxShadow: `0 0 0 3px ${SEM_COLOR[sem.nivel]}22`, flexShrink: 0,
    }} />
  )
}

const HITO_COLOR = {
  'Emitida':          { bg: '#E8F2FF', fg: C.brand },
  'Confirmada':       { bg: '#E3F2E7', fg: '#106A32' },
  'En fabricación':   { bg: '#FDF3E7', fg: '#8F5B00' },
  'Despachada':       { bg: '#EDEAFB', fg: '#4A3FA5' },
  'Recibida parcial': { bg: '#FDF3E7', fg: '#8F5B00' },
  'Recibida total':   { bg: '#E3F2E7', fg: '#106A32' },
  'Cerrada':          { bg: '#EFEFEF', fg: C.muted },
}
function HitoChip({ hito }) {
  const c = HITO_COLOR[hito] || HITO_COLOR['Emitida']
  return (
    <span style={{ fontFamily: F, fontSize: 11, fontWeight: 600, color: c.fg, background: c.bg, padding: '2px 9px', borderRadius: 10, whiteSpace: 'nowrap' }}>
      {hito}
    </span>
  )
}

function BarraAvance({ pct, width = 72 }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
      <span style={{ width, height: 6, borderRadius: 3, background: C.border, overflow: 'hidden', display: 'inline-block' }}>
        <span style={{ display: 'block', width: `${Math.min(pct, 100)}%`, height: '100%', background: pct >= 100 ? C.success : C.primary }} />
      </span>
      <span style={{ fontFamily: F, fontSize: 11, color: C.muted, minWidth: 30 }}>{pct}%</span>
    </span>
  )
}

function Btn({ children, onClick, primary, danger, disabled, title }) {
  return (
    <button onClick={onClick} disabled={disabled} title={title} style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      fontFamily: F, fontSize: 12, fontWeight: 600,
      background: primary ? C.primary : C.card,
      color: primary ? '#fff' : danger ? C.danger : C.brand,
      border: `1px solid ${primary ? C.primary : danger ? `${C.danger}66` : C.borderInput}`,
      borderRadius: 8, padding: '7px 13px', cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.55 : 1, whiteSpace: 'nowrap',
    }}>{children}</button>
  )
}

function DateInp({ value, onChange, disabled, title }) {
  return (
    <input type="date" value={value || ''} disabled={disabled} title={title}
      onClick={e => e.stopPropagation()}
      onChange={e => onChange(e.target.value)}
      style={{
        fontFamily: F, fontSize: 11, color: value ? C.text : C.muted,
        border: `1px solid ${C.borderInput}`, borderRadius: 6, padding: '4px 6px',
        background: disabled ? `${C.border}55` : C.card, outline: 'none', width: 118,
        cursor: disabled ? 'not-allowed' : 'pointer',
      }} />
  )
}

function Banner({ tipo, children, onClose }) {
  const err = tipo === 'error'
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8, margin: '8px 24px 0',
      padding: '8px 12px', borderRadius: 8, fontFamily: F, fontSize: 12,
      background: err ? `${C.danger}12` : `${C.success}15`,
      color: err ? C.danger : '#106A32', border: `1px solid ${err ? `${C.danger}44` : `${C.success}44`}`,
    }}>
      {err ? <AlertCircle size={15} style={{ flexShrink: 0 }} /> : <CheckCircle2 size={15} style={{ flexShrink: 0 }} />}
      <span style={{ flex: 1 }}>{children}</span>
      {onClose && <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', display: 'flex' }}><X size={14} /></button>}
    </div>
  )
}

function Modal({ title, subtitle, onClose, children, footer, isMobile, width = 560 }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(50,54,58,0.5)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: C.card, borderRadius: isMobile ? 0 : 12, boxShadow: '0 12px 40px rgba(0,0,0,0.25)',
        width: isMobile ? '100%' : width, maxWidth: '100%', height: isMobile ? '100%' : 'auto',
        maxHeight: isMobile ? '100%' : '90vh', display: 'flex', flexDirection: 'column',
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '16px 20px', borderBottom: `1px solid ${C.border}` }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: F, fontSize: 15, fontWeight: 700, color: C.text }}>{title}</div>
            {subtitle && <div style={{ fontFamily: F, fontSize: 12, color: C.muted, marginTop: 2 }}>{subtitle}</div>}
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.muted, display: 'flex', padding: 2 }}><X size={17} /></button>
        </div>
        <div style={{ padding: '16px 20px', overflowY: 'auto', flex: 1 }}>{children}</div>
        {footer && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '12px 20px', borderTop: `1px solid ${C.border}` }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}

const Th = ({ children, right }) => (
  <th style={{ position: 'sticky', top: 0, background: C.card, zIndex: 1, textAlign: right ? 'right' : 'left', padding: '9px 10px', fontFamily: F, fontSize: 10, fontWeight: 600, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: `1px solid ${C.border}`, whiteSpace: 'nowrap' }}>{children}</th>
)
const Td = ({ children, right, style }) => (
  <td style={{ padding: '8px 10px', fontFamily: F, fontSize: 12, color: C.text, borderBottom: `1px solid ${C.border}`, textAlign: right ? 'right' : 'left', verticalAlign: 'middle', ...style }}>{children}</td>
)

// Dato etiquetado de la cabecera de objeto / secciones.
function Dato({ label, children }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontFamily: F, fontSize: 10, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 600, marginBottom: 4 }}>{label}</div>
      <div style={{ fontFamily: F, fontSize: 12, color: C.text }}>{children}</div>
    </div>
  )
}

function EstadoVacio({ icon: Icon, titulo, ayuda }) {
  return (
    <div style={{ border: `1px dashed ${C.borderInput}`, borderRadius: 12, padding: '48px 20px', textAlign: 'center', margin: 20 }}>
      <Icon size={34} style={{ color: C.borderInput }} />
      <div style={{ fontFamily: F, fontSize: 14, fontWeight: 600, color: C.text, marginTop: 10 }}>{titulo}</div>
      <div style={{ fontFamily: F, fontSize: 12, color: C.muted, marginTop: 4 }}>{ayuda}</div>
    </div>
  )
}

// ─── Modal: registrar recepción ───────────────────────────────────────────────

function RecepcionModal({ oc, isMobile, onClose, onGuardar }) {
  const [fecha, setFecha] = useState(hoyISO())
  const [referencia, setReferencia] = useState('')
  const [nota, setNota] = useState('')
  // Por defecto se propone recibir todo lo pendiente (el caso común, ~70%).
  const [cant, setCant] = useState(() => Object.fromEntries(
    oc.items.map(it => [it.id, Math.max(it.cantidad - it.recibido, 0)])
  ))
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState(null)

  const setLinea = (id, v, max) => {
    const n = Math.max(0, Math.min(Number(v) || 0, max))
    setCant(c => ({ ...c, [id]: n }))
  }
  const lineas = oc.items
    .map(it => ({ ocItemId: it.id, cantidad: cant[it.id] || 0 }))
    .filter(l => l.cantidad > 0)
  const esTotal = oc.items.every(it => it.recibido + (cant[it.id] || 0) >= it.cantidad)

  const guardar = async () => {
    setSaving(true); setErr(null)
    try {
      await onGuardar({ fecha, referencia, nota, lineas, esTotal })
    } catch (e) { setErr(e.message); setSaving(false) }
  }

  return (
    <Modal isMobile={isMobile} width={640} onClose={onClose}
      title={`Registrar recepción — OC ${oc.numeroOC}`}
      subtitle="Entrega en almacén del cliente (avisada por correo o llamada)"
      footer={<>
        <Btn onClick={onClose}>Cancelar</Btn>
        <Btn primary disabled={saving || !lineas.length} onClick={guardar}>
          {saving ? <RefreshCw size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <CheckCircle2 size={13} />}
          {esTotal ? 'Registrar recepción total' : 'Registrar recepción parcial'}
        </Btn>
      </>}>
      {err && <Banner tipo="error">{err}</Banner>}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '140px 1fr', gap: 12, marginBottom: 14 }}>
        <Dato label="Fecha de recepción"><DateInp value={fecha} onChange={setFecha} /></Dato>
        <Dato label="Referencia (guía de remisión / aviso)">
          <input value={referencia} onChange={e => setReferencia(e.target.value)} placeholder="p.ej. GR 001-000123"
            style={{ fontFamily: F, fontSize: 12, border: `1px solid ${C.borderInput}`, borderRadius: 6, padding: '6px 8px', width: '100%', boxSizing: 'border-box', outline: 'none' }} />
        </Dato>
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr><Th>Línea</Th><Th right>Pedido</Th><Th right>Recibido</Th><Th right>Pendiente</Th><Th right>Recibir ahora</Th></tr></thead>
        <tbody>
          {oc.items.map(it => {
            const pend = Math.max(it.cantidad - it.recibido, 0)
            return (
              <tr key={it.id} style={{ opacity: pend === 0 ? 0.5 : 1 }}>
                <Td><span style={{ fontWeight: 600 }}>{it.codigo || '—'}</span> · {it.descripcion}</Td>
                <Td right>{it.cantidad} {it.unidad}</Td>
                <Td right>{it.recibido}</Td>
                <Td right>{pend}</Td>
                <Td right>
                  <input type="number" min={0} max={pend} value={cant[it.id] ?? 0} disabled={pend === 0}
                    onChange={e => setLinea(it.id, e.target.value, pend)}
                    style={{ fontFamily: F, fontSize: 12, width: 76, textAlign: 'right', border: `1px solid ${C.borderInput}`, borderRadius: 6, padding: '4px 6px', outline: 'none' }} />
                </Td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <div style={{ marginTop: 12 }}>
        <Dato label="Nota (opcional)">
          <textarea value={nota} onChange={e => setNota(e.target.value)} rows={2}
            style={{ fontFamily: F, fontSize: 12, border: `1px solid ${C.borderInput}`, borderRadius: 6, padding: '6px 8px', width: '100%', boxSizing: 'border-box', outline: 'none', resize: 'vertical' }} />
        </Dato>
      </div>
    </Modal>
  )
}

// ─── Modal genérico: fecha + nota (avance de hito, cierre, nota libre) ────────

function AccionModal({ titulo, subtitulo, confirmLabel, danger, conFecha = true, isMobile, onClose, onConfirmar }) {
  const [fecha, setFecha] = useState(hoyISO())
  const [nota, setNota] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState(null)
  const ok = async () => {
    setSaving(true); setErr(null)
    try { await onConfirmar({ fecha, nota }) } catch (e) { setErr(e.message); setSaving(false) }
  }
  return (
    <Modal isMobile={isMobile} width={440} onClose={onClose} title={titulo} subtitle={subtitulo}
      footer={<>
        <Btn onClick={onClose}>Cancelar</Btn>
        <Btn primary={!danger} danger={danger} disabled={saving} onClick={ok}>
          {saving && <RefreshCw size={13} style={{ animation: 'spin 1s linear infinite' }} />}{confirmLabel}
        </Btn>
      </>}>
      {err && <Banner tipo="error">{err}</Banner>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {conFecha && <Dato label="Fecha"><DateInp value={fecha} onChange={setFecha} /></Dato>}
        <Dato label="Nota (opcional)">
          <textarea value={nota} onChange={e => setNota(e.target.value)} rows={3} autoFocus={!conFecha}
            style={{ fontFamily: F, fontSize: 12, border: `1px solid ${C.borderInput}`, borderRadius: 6, padding: '6px 8px', width: '100%', boxSizing: 'border-box', outline: 'none', resize: 'vertical' }} />
        </Dato>
      </div>
    </Modal>
  )
}

// ─── Modal: informe al cliente (Excel + texto de correo) ──────────────────────

function InformeModal({ ocs, clientes, clienteInicial, isMobile, onClose, onAviso }) {
  const [cliente, setCliente] = useState(clienteInicial || clientes[0] || '')
  const pendientes = ocs.filter(o => o.cliente === cliente && esPendienteEntrega(o))
  const texto = cliente ? textoCorreoInforme({ clienteNombre: cliente, ocs }) : ''

  const copiar = async () => {
    try { await navigator.clipboard.writeText(texto); onAviso('Texto del correo copiado al portapapeles.') }
    catch { onAviso('No se pudo copiar automáticamente; selecciona y copia el texto.') }
  }
  const descargar = () => {
    exportarInformeCliente({ clienteNombre: cliente, ocs })
    onAviso(`Informe Excel de ${cliente} descargado (${pendientes.length} OC${pendientes.length !== 1 ? 's' : ''} pendiente${pendientes.length !== 1 ? 's' : ''}).`)
  }

  return (
    <Modal isMobile={isMobile} width={620} onClose={onClose}
      title="Informe de estado para el cliente"
      subtitle="Todas las OCs pendientes de entrega · el envío del correo es manual (fase 1)"
      footer={<>
        <Btn onClick={copiar} disabled={!cliente}><Copy size={13} />Copiar correo</Btn>
        <Btn primary onClick={descargar} disabled={!cliente}><Mail size={13} />Descargar Excel</Btn>
      </>}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
        <Dato label="Cliente">
          <select value={cliente} onChange={e => setCliente(e.target.value)}
            style={{ fontFamily: F, fontSize: 12, border: `1px solid ${C.borderInput}`, borderRadius: 6, padding: '6px 8px', outline: 'none', minWidth: 220 }}>
            {clientes.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </Dato>
        <span style={{ fontFamily: F, fontSize: 12, color: C.muted, paddingBottom: 7 }}>
          {pendientes.length} OC{pendientes.length !== 1 ? 's' : ''} pendiente{pendientes.length !== 1 ? 's' : ''} de entrega
        </span>
      </div>
      <Dato label="Texto del correo (copiar y pegar)">
        <textarea readOnly value={texto} rows={isMobile ? 12 : 14}
          style={{ fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 11.5, border: `1px solid ${C.borderInput}`, borderRadius: 8, padding: 10, width: '100%', boxSizing: 'border-box', outline: 'none', resize: 'vertical', background: C.bg, color: C.text }} />
      </Dato>
    </Modal>
  )
}

// ─── Object Page: detalle de una OC ───────────────────────────────────────────

// Pasos visibles de la línea de vida (parcial/total colapsan en "Recibida").
const PASOS = ['Emitida', 'Confirmada', 'En fabricación', 'Despachada', 'Recibida', 'Cerrada']
const pasoDeHito = h => h === 'Recibida parcial' || h === 'Recibida total' ? 4 : h === 'Cerrada' ? 5 : idxHito(h)

function Stepper({ oc, eventos, isMobile }) {
  const actual = pasoDeHito(oc.hito)
  // Fecha del primer evento registrado para cada paso.
  const fechaDe = paso => {
    const hitosDelPaso = paso === 4 ? ['Recibida parcial', 'Recibida total'] : [PASOS[paso] === 'Emitida' ? null : PASOS[paso]]
    if (paso === 0) return oc.fechaEmision
    const ev = [...eventos].reverse().find(e => hitosDelPaso.includes(e.hito))
    return ev?.fecha || ''
  }
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', overflowX: 'auto', padding: '14px 4px 6px' }}>
      {PASOS.map((paso, i) => {
        const done = i <= actual
        const esParcialAqui = i === 4 && oc.hito === 'Recibida parcial'
        const color = done ? (esParcialAqui ? C.warn : C.success) : C.borderInput
        return (
          <div key={paso} style={{ display: 'flex', alignItems: 'flex-start', flex: i < PASOS.length - 1 ? 1 : 'none', minWidth: isMobile ? 74 : 96 }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: isMobile ? 74 : 96, flexShrink: 0 }}>
              <div style={{ width: 22, height: 22, borderRadius: '50%', background: done ? color : C.card, border: `2px solid ${color}`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
                {done && <CheckCircle2 size={13} />}
              </div>
              <div style={{ fontFamily: F, fontSize: 10.5, fontWeight: i === actual ? 700 : 500, color: done ? C.text : C.muted, marginTop: 5, textAlign: 'center' }}>
                {paso}{esParcialAqui ? ` (${oc.avancePct}%)` : ''}
              </div>
              <div style={{ fontFamily: F, fontSize: 10, color: C.muted, marginTop: 1 }}>{fmtDate(fechaDe(i))}</div>
            </div>
            {i < PASOS.length - 1 && (
              <div style={{ flex: 1, height: 2, background: i < actual ? C.success : C.border, marginTop: 10, minWidth: 12 }} />
            )}
          </div>
        )
      })}
    </div>
  )
}

function DetalleOC({ oc, isMobile, onBack, conAccion }) {
  const [eventos, setEventos] = useState([])
  const [modal, setModal] = useState(null)   // 'recepcion' | 'hito' | 'cerrar' | 'nota'

  const cargarEventos = () => listarEventos(oc.id).then(setEventos).catch(() => {})
  useEffect(() => { cargarEventos() }, [oc.id, oc.hito, oc.totalRecibido])

  // Para acciones inline (inputs de fecha): el error ya se muestra en banner.
  const inline = (fn, msg) => conAccion(fn, msg).catch(() => {})

  const sem = semaforoOC(oc)
  const cerrada = oc.hito === 'Cerrada'
  // Siguiente hito "manual" de la cadena (los de recepción salen de las recepciones).
  const siguiente = ['Confirmada', 'En fabricación', 'Despachada'][idxHito(oc.hito)] || null
  const completa = oc.totalCantidad > 0 && oc.totalRecibido >= oc.totalCantidad

  const accion = (fn, msg) => conAccion(fn, msg).then(() => { setModal(null); cargarEventos() })

  const seccion = { background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: isMobile ? 12 : 16 }
  const h2 = { fontFamily: F, fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 10 }

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: isMobile ? '10px 14px' : '10px 24px' }}>
      {/* Cabecera de objeto */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
        <button onClick={onBack} title="Volver a la lista" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32, borderRadius: 8, background: C.card, border: `1px solid ${C.border}`, cursor: 'pointer', color: C.brand, flexShrink: 0 }}>
          <ChevronLeft size={17} />
        </button>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontFamily: F, fontSize: 17, fontWeight: 700, color: C.text }}>OC {oc.numeroOC}</span>
            <Semaforo sem={sem} size={11} />
            <HitoChip hito={oc.hito} />
            {oc.origen === 'cliente' && (
              <span style={{ fontFamily: F, fontSize: 10.5, fontWeight: 600, color: C.gold, background: `${C.gold}18`, border: `1px solid ${C.gold}40`, padding: '1px 8px', borderRadius: 4 }}>OC del cliente</span>
            )}
          </div>
          <div style={{ fontFamily: F, fontSize: 12, color: C.muted, marginTop: 2 }}>
            {oc.cliente || 'Sin cliente'} · {oc.proveedor || 'Sin proveedor'} · emitida {fmtDate(oc.fechaEmision)}
          </div>
          <div style={{ fontFamily: F, fontSize: 11.5, color: sem.nivel === 'rojo' ? C.danger : sem.nivel === 'ambar' ? '#8F5B00' : C.muted, marginTop: 2 }}>
            {sem.motivo}
          </div>
        </div>
        {/* Toolbar de acciones del objeto: una sola primaria a la derecha */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Btn onClick={() => setModal('nota')} title="Anotar gestión (llamada, correo…)"><ClipboardList size={13} />{isMobile ? '' : 'Nota'}</Btn>
          {siguiente && !cerrada && (
            <Btn onClick={() => setModal('hito')} title={`Marcar hito «${siguiente}»`}><Truck size={13} />{isMobile ? siguiente : `Marcar ${siguiente.toLowerCase()}`}</Btn>
          )}
          {!cerrada && (
            <Btn danger disabled={!completa} onClick={() => setModal('cerrar')}
              title={completa ? 'Cerrar la OC' : 'Solo se cierra con el 100% entregado en almacén del cliente'}>
              Cerrar OC
            </Btn>
          )}
          {!cerrada && (
            <Btn primary onClick={() => setModal('recepcion')} disabled={completa}
              title={completa ? 'Ya está todo recibido' : 'Registrar entrega en almacén del cliente'}>
              <CheckCircle2 size={13} />Registrar recepción
            </Btn>
          )}
        </div>
      </div>

      {/* Línea de vida */}
      <div style={{ ...seccion, marginBottom: 12 }}>
        <Stepper oc={oc} eventos={eventos} isMobile={isMobile} />
      </div>

      {/* Frente proveedor: acuse + fechas */}
      <div style={{ ...seccion, marginBottom: 12 }}>
        <div style={h2}>Frente proveedor</div>
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(6, auto)', gap: isMobile ? 12 : 22, justifyContent: 'start', alignItems: 'start' }}>
          <Dato label="Proveedor recibió la OC">
            {oc.ocRecibidaProveedor ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: C.success, fontWeight: 600 }}>
                <CheckCircle2 size={14} />{fmtDate(oc.fechaRecepcionOC) || 'Sí'}
              </span>
            ) : cerrada ? '—' : (
              <DateInp value="" title="Fecha del acuse de recibo"
                onChange={v => v && inline(() => marcarOCRecibida(oc.id, v), 'Acuse de recibo registrado.')} />
            )}
          </Dato>
          <Dato label="F. entrega confirmada">
            <DateInp value={oc.fechaEntregaConfirmada} disabled={cerrada} title="Fecha que confirmó el proveedor"
              onChange={v => v && inline(() => confirmarFechaEntrega(oc.id, v, oc.hito), 'Fecha de entrega confirmada.')} />
          </Dato>
          <Dato label="Nueva fecha de entrega">
            <DateInp value={oc.nuevaFechaEntrega} disabled={cerrada} title="Re-programación de la entrega"
              onChange={v => inline(() => actualizarNuevaFecha(oc.id, v), 'Nueva fecha de entrega guardada.')} />
          </Dato>
          <Dato label="F. comprometida">{fmtDate(fechaComprometida(oc)) || '—'}</Dato>
          <Dato label="Lugar de entrega">{oc.lugarEntrega || '—'}</Dato>
          <Dato label="Avance"><BarraAvance pct={oc.avancePct} /></Dato>
        </div>
      </div>

      {/* Líneas de la OC */}
      <div style={{ ...seccion, marginBottom: 12, padding: 0, overflow: 'hidden' }}>
        <div style={{ ...h2, padding: isMobile ? '12px 12px 0' : '14px 16px 0', marginBottom: 6 }}>
          Avance por línea <span style={{ color: C.muted, fontWeight: 400 }}>· {oc.items.length} línea{oc.items.length !== 1 ? 's' : ''}</span>
        </div>
        {isMobile ? (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {oc.items.map(it => {
              const pend = Math.max(it.cantidad - it.recibido, 0)
              return (
                <div key={it.id} style={{ padding: '10px 12px', borderTop: `1px solid ${C.border}` }}>
                  <div style={{ fontFamily: F, fontSize: 12, fontWeight: 600, color: C.text }}>{it.codigo ? `${it.codigo} · ` : ''}{it.descripcion}</div>
                  <div style={{ fontFamily: F, fontSize: 11, color: C.muted, marginTop: 3 }}>
                    Pedido {it.cantidad} {it.unidad} · Recibido {it.recibido} · Pendiente {pend}
                  </div>
                  <div style={{ marginTop: 5 }}><BarraAvance pct={it.cantidad ? Math.round((it.recibido / it.cantidad) * 100) : 0} width={110} /></div>
                  <div style={{ fontFamily: F, fontSize: 11, color: C.muted, marginTop: 4, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    Comprometida {fmtDate(it.fechaEntrega) || '—'} · Estimada{' '}
                    <DateInp value={it.fechaEstimada} disabled={cerrada}
                      onChange={v => inline(() => actualizarFechaEstimada(it.id, v), 'Fecha estimada guardada.')} />
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <Th>Pos.</Th><Th>Código</Th><Th>Descripción</Th><Th right>Pedido</Th><Th right>Recibido</Th><Th right>Pendiente</Th>
                <Th>Avance</Th><Th>F. comprometida</Th><Th>F. estimada</Th>
              </tr></thead>
              <tbody>
                {oc.items.map(it => {
                  const pend = Math.max(it.cantidad - it.recibido, 0)
                  return (
                    <tr key={it.id}>
                      <Td>{it.posicion ?? ''}</Td>
                      <Td style={{ color: C.primary, fontWeight: 600 }}>{it.codigo || '—'}</Td>
                      <Td>{it.descripcion}</Td>
                      <Td right>{it.cantidad} {it.unidad}</Td>
                      <Td right>{it.recibido}</Td>
                      <Td right style={{ fontWeight: pend > 0 ? 600 : 400, color: pend > 0 ? C.text : C.success }}>{pend > 0 ? pend : '✓'}</Td>
                      <Td><BarraAvance pct={it.cantidad ? Math.round((it.recibido / it.cantidad) * 100) : 0} /></Td>
                      <Td>{fmtDate(it.fechaEntrega) || '—'}</Td>
                      <Td>
                        <DateInp value={it.fechaEstimada} disabled={cerrada}
                          onChange={v => inline(() => actualizarFechaEstimada(it.id, v), 'Fecha estimada guardada.')} />
                      </Td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Recepciones + bitácora */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 12, marginBottom: 16 }}>
        <div style={seccion}>
          <div style={h2}>Recepciones registradas</div>
          {oc.recepciones.length === 0 ? (
            <div style={{ fontFamily: F, fontSize: 12, color: C.muted }}>Aún no hay entregas registradas.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[...oc.recepciones].reverse().map(r => (
                <div key={r.id} style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: '8px 10px' }}>
                  <div style={{ fontFamily: F, fontSize: 12, fontWeight: 600, color: C.text, display: 'flex', gap: 8, alignItems: 'center' }}>
                    <Calendar size={13} style={{ color: C.muted }} />{fmtDate(r.fecha)}
                    {r.referencia && <span style={{ color: C.muted, fontWeight: 400 }}>· {r.referencia}</span>}
                  </div>
                  <div style={{ fontFamily: F, fontSize: 11.5, color: C.muted, marginTop: 3 }}>
                    {r.lineas.map(l => {
                      const it = oc.items.find(i => i.id === l.ocItemId)
                      return `${l.cantidad} × ${it?.codigo || it?.descripcion || 'línea'}`
                    }).join(' · ')}
                  </div>
                  {r.nota && <div style={{ fontFamily: F, fontSize: 11.5, color: C.text, marginTop: 3 }}>{r.nota}</div>}
                </div>
              ))}
            </div>
          )}
        </div>
        <div style={seccion}>
          <div style={h2}>Bitácora de seguimiento</div>
          {eventos.length === 0 ? (
            <div style={{ fontFamily: F, fontSize: 12, color: C.muted }}>Sin eventos registrados todavía.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7, maxHeight: 260, overflowY: 'auto' }}>
              {eventos.map(e => (
                <div key={e.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                  <span style={{ fontFamily: F, fontSize: 11, color: C.muted, minWidth: 70, paddingTop: 1 }}>{fmtDate(e.fecha)}</span>
                  <div style={{ flex: 1 }}>
                    {e.hito && <span style={{ marginRight: 6 }}><HitoChip hito={e.hito} /></span>}
                    <span style={{ fontFamily: F, fontSize: 12, color: C.text }}>{e.nota}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Modales */}
      {modal === 'recepcion' && (
        <RecepcionModal oc={oc} isMobile={isMobile} onClose={() => setModal(null)}
          onGuardar={datos => accion(() => registrarRecepcion(oc.id, datos),
            datos.esTotal ? 'Recepción total registrada — la OC quedó lista para cerrar.' : 'Recepción parcial registrada.')} />
      )}
      {modal === 'hito' && siguiente && (
        <AccionModal isMobile={isMobile} titulo={`Marcar «${siguiente}»`}
          subtitulo={`OC ${oc.numeroOC} · ${oc.proveedor}`} confirmLabel={`Marcar ${siguiente.toLowerCase()}`}
          onClose={() => setModal(null)}
          onConfirmar={({ fecha, nota }) => accion(() => cambiarHito(oc.id, siguiente, { fecha, nota: nota || null }), `Hito «${siguiente}» registrado.`)} />
      )}
      {modal === 'cerrar' && (
        <AccionModal isMobile={isMobile} danger titulo="Cerrar Orden de Compra"
          subtitulo={`OC ${oc.numeroOC} · entregada al 100% en almacén del cliente. El pago no forma parte del seguimiento.`}
          confirmLabel="Cerrar OC" onClose={() => setModal(null)}
          onConfirmar={({ fecha, nota }) => accion(() => cambiarHito(oc.id, 'Cerrada', { fecha, nota: nota || null }), `OC ${oc.numeroOC} cerrada.`)} />
      )}
      {modal === 'nota' && (
        <AccionModal isMobile={isMobile} titulo="Anotar gestión" conFecha={false}
          subtitulo={`OC ${oc.numeroOC} · llamada, correo al proveedor, incidencia…`}
          confirmLabel="Guardar nota" onClose={() => setModal(null)}
          onConfirmar={({ nota }) => {
            if (!nota.trim()) return Promise.reject(new Error('Escribe la nota.'))
            return accion(() => registrarNota(oc.id, nota.trim()), 'Nota registrada.')
          }} />
      )}
    </div>
  )
}

// ─── List Report + raíz del módulo ────────────────────────────────────────────

export default function Seguimiento({ isMobile }) {
  const [ocs, setOcs] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [aviso, setAviso] = useState(null)
  const [busca, setBusca] = useState('')
  const [filtroCliente, setFiltroCliente] = useState('')
  const [verCerradas, setVerCerradas] = useState(false)
  const [detalleId, setDetalleId] = useState(null)
  const [modalInforme, setModalInforme] = useState(false)

  const flashAviso = msg => { setAviso(msg); setTimeout(() => setAviso(a => a === msg ? null : a), 4000) }
  const refrescar = () => listarOrdenesSeguimiento().then(setOcs).catch(e => setError(e.message)).finally(() => setLoading(false))
  useEffect(() => { refrescar() }, [])

  // Ejecuta una acción de seguimiento y refresca la lista, con feedback.
  const conAccion = async (fn, msgOk) => {
    setError(null)
    try { await fn(); await refrescar(); if (msgOk) flashAviso(msgOk) }
    catch (e) { setError(e.message); throw e }
  }
  // Variante para llamadas inline en la tabla (el banner ya muestra el error).
  const inline = (fn, msg) => conAccion(fn, msg).catch(() => {})

  const clientes = useMemo(() => [...new Set(ocs.map(o => o.cliente).filter(Boolean))].sort(), [ocs])
  const lista = useMemo(() => ocs.filter(o => {
    if (!verCerradas && o.hito === 'Cerrada') return false
    if (filtroCliente && o.cliente !== filtroCliente) return false
    if (busca.trim()) {
      const q = busca.trim().toLowerCase()
      if (![o.numeroOC, o.proveedor, o.cliente].some(v => (v || '').toLowerCase().includes(q))) return false
    }
    return true
  }), [ocs, verCerradas, filtroCliente, busca])

  const detalle = detalleId ? ocs.find(o => o.id === detalleId) : null

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {error && <Banner tipo="error" onClose={() => setError(null)}>{error}</Banner>}
      {aviso && <Banner tipo="ok" onClose={() => setAviso(null)}>{aviso}</Banner>}

      {detalle ? (
        <DetalleOC oc={detalle} isMobile={isMobile} onBack={() => setDetalleId(null)} conAccion={conAccion} />
      ) : (
        <>
          {/* Toolbar de la List Report */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: isMobile ? '10px 14px' : '10px 24px', background: C.card, borderBottom: `1px solid ${C.border}` }}>
            <div style={{ fontFamily: F, fontSize: 14, fontWeight: 700, color: C.text, marginRight: 'auto' }}>
              OCs en seguimiento <span style={{ color: C.muted, fontWeight: 400 }}>{lista.length}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, padding: '5px 9px' }}>
              <Search size={13} style={{ color: C.muted }} />
              <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="N° OC / proveedor…"
                style={{ fontFamily: F, fontSize: 12, border: 'none', outline: 'none', background: 'transparent', width: isMobile ? 110 : 160, color: C.text }} />
            </div>
            {!isMobile && (
              <select value={filtroCliente} onChange={e => setFiltroCliente(e.target.value)}
                style={{ fontFamily: F, fontSize: 12, border: `1px solid ${C.borderInput}`, borderRadius: 8, padding: '6px 8px', outline: 'none', color: C.text, background: C.card }}>
                <option value="">Todos los clientes</option>
                {clientes.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            )}
            <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontFamily: F, fontSize: 12, color: C.muted, cursor: 'pointer', userSelect: 'none' }}>
              <input type="checkbox" checked={verCerradas} onChange={e => setVerCerradas(e.target.checked)} />
              {isMobile ? 'Cerradas' : 'Ver cerradas'}
            </label>
            <Btn primary onClick={() => setModalInforme(true)} disabled={!clientes.length}>
              <Mail size={13} />{isMobile ? 'Informe' : 'Informe cliente'}
            </Btn>
          </div>

          {/* Contenido */}
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {loading ? (
              <div style={{ fontFamily: F, fontSize: 12, color: C.muted, padding: 24, display: 'flex', alignItems: 'center', gap: 8 }}>
                <RefreshCw size={14} style={{ animation: 'spin 1s linear infinite' }} />Cargando OCs…
              </div>
            ) : lista.length === 0 ? (
              <EstadoVacio icon={Truck} titulo="No hay OCs en seguimiento"
                ayuda={ocs.length ? 'Ajusta los filtros para ver más órdenes.' : 'Cuando emitas una Orden de Compra desde «Órdenes», aparecerá aquí para su seguimiento.'} />
            ) : isMobile ? (
              // Vista móvil: cards con labels (sin scroll horizontal)
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '12px 14px' }}>
                {lista.map(oc => {
                  const sem = semaforoOC(oc)
                  const objetivo = fechaObjetivo(oc)
                  return (
                    <div key={oc.id} onClick={() => setDetalleId(oc.id)}
                      style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 12, cursor: 'pointer' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <Semaforo sem={sem} />
                        <span style={{ fontFamily: F, fontSize: 13, fontWeight: 700, color: C.primary }}>{oc.numeroOC}</span>
                        <HitoChip hito={oc.hito} />
                        <ArrowRight size={14} style={{ color: C.muted, marginLeft: 'auto' }} />
                      </div>
                      <div style={{ fontFamily: F, fontSize: 11.5, color: C.muted, marginTop: 6 }}>
                        {oc.cliente} · {oc.proveedor || 'Sin proveedor'}
                      </div>
                      <div style={{ fontFamily: F, fontSize: 11.5, color: C.text, marginTop: 4, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                        <span>Emisión: {fmtDate(oc.fechaEmision)}</span>
                        <span>Entrega: {fmtDate(objetivo) || 'por confirmar'}</span>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          OC recibida: {oc.ocRecibidaProveedor ? <CheckCircle2 size={13} style={{ color: C.success }} /> : 'No'}
                        </span>
                      </div>
                      <div style={{ marginTop: 6 }}><BarraAvance pct={oc.avancePct} width={120} /></div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', background: C.card }}>
                <thead><tr>
                  <Th> </Th><Th>N° OC</Th><Th>Cliente</Th><Th>Proveedor</Th><Th>Emisión</Th>
                  <Th>OC recibida</Th><Th>F. confirmada</Th><Th>Nueva fecha</Th><Th>Hito</Th><Th>Avance</Th><Th> </Th>
                </tr></thead>
                <tbody>
                  {lista.map(oc => {
                    const sem = semaforoOC(oc)
                    const cerrada = oc.hito === 'Cerrada'
                    return (
                      <tr key={oc.id} onClick={() => setDetalleId(oc.id)} style={{ cursor: 'pointer' }}
                        onMouseEnter={e => e.currentTarget.style.background = '#FAFBFC'}
                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                        <Td><Semaforo sem={sem} /></Td>
                        <Td style={{ color: C.primary, fontWeight: 600, textDecoration: 'underline' }}>{oc.numeroOC}</Td>
                        <Td>{oc.cliente}</Td>
                        <Td>{oc.proveedor || <span style={{ color: C.muted }}>—</span>}</Td>
                        <Td style={{ whiteSpace: 'nowrap' }}>{fmtDate(oc.fechaEmision)}</Td>
                        <Td>
                          {oc.ocRecibidaProveedor ? (
                            <span title={`Acuse: ${fmtDate(oc.fechaRecepcionOC)}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: C.success, fontWeight: 600, fontSize: 11 }}>
                              <CheckCircle2 size={14} />{fmtDate(oc.fechaRecepcionOC)}
                            </span>
                          ) : cerrada ? '—' : (
                            <button onClick={e => { e.stopPropagation(); inline(() => marcarOCRecibida(oc.id, hoyISO()), `Acuse de recibo de la OC ${oc.numeroOC} registrado (hoy).`) }}
                              title="Marcar que el proveedor recibió la OC (con fecha de hoy)"
                              style={{ fontFamily: F, fontSize: 11, fontWeight: 600, color: C.brand, background: C.card, border: `1px solid ${C.borderInput}`, borderRadius: 6, padding: '3px 9px', cursor: 'pointer' }}>
                              Marcar
                            </button>
                          )}
                        </Td>
                        <Td onClick={e => e.stopPropagation()}>
                          <DateInp value={oc.fechaEntregaConfirmada} disabled={cerrada} title="Fecha de entrega confirmada por el proveedor"
                            onChange={v => v && inline(() => confirmarFechaEntrega(oc.id, v, oc.hito), `Fecha confirmada para la OC ${oc.numeroOC}.`)} />
                        </Td>
                        <Td onClick={e => e.stopPropagation()}>
                          <DateInp value={oc.nuevaFechaEntrega} disabled={cerrada} title="Nueva fecha de entrega (re-programación)"
                            onChange={v => inline(() => actualizarNuevaFecha(oc.id, v), `Nueva fecha de entrega guardada para la OC ${oc.numeroOC}.`)} />
                        </Td>
                        <Td><HitoChip hito={oc.hito} /></Td>
                        <Td><BarraAvance pct={oc.avancePct} /></Td>
                        <Td right><ArrowRight size={14} style={{ color: C.muted }} /></Td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {modalInforme && (
        <InformeModal ocs={ocs} clientes={clientes} clienteInicial={filtroCliente} isMobile={isMobile}
          onClose={() => setModalInforme(false)} onAviso={m => flashAviso(m)} />
      )}
    </div>
  )
}
