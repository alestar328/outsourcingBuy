// ══════════════════════════════════════════════════════════════════════════════
//  Seguimiento de entregas (Excel de OCs del cliente) — reformateo 2026-08
// ══════════════════════════════════════════════════════════════════════════════
//  El cliente envía un Excel con sus OCs ya emitidas (hoja "Detalle"). Minos
//  contacta a cada proveedor para que confirme o rectifique la "Fecha de entrega
//  actual" de sus materiales. List Report agrupada por proveedor con selección,
//  fecha confirmada editable en línea y «Generar email»: el correo se envía desde
//  la app (Resend vía Edge Function) o se copia para enviarlo a mano. Cada envío
//  queda registrado, lo que permite ver quién no responde pasados X días.
//  Reimportar preserva confirmadas y marca los cambios de fecha del cliente.
// ══════════════════════════════════════════════════════════════════════════════

import { useState, useEffect, useMemo, useRef } from 'react'
import * as XLSX from 'xlsx'
import {
  listarLineas, importarLineas, confirmarFechaEntrega, marcarRespondido,
  listarEmailsProveedores, guardarEmailProveedor, enviarCorreoProveedor,
} from './seguimientoRepo.js'
import {
  parsearSeguimientoExcel, exportarExcelProveedor, excelProveedorAdjunto,
  asuntoCorreoProveedor, textoCorreoProveedor,
} from './seguimientoExcel.js'
import {
  fmtDate, claveProveedor, diasVencidos, emailValido,
  estadoRespuesta, diasDesdeEnvio, UMBRAL_SIN_RESPUESTA_DIAS, OPCIONES_UMBRAL,
} from './seguimientoLogic.js'
import {
  RefreshCw, CheckCircle2, AlertCircle, X, Mail, Copy, Search, Truck,
  Upload, FileSpreadsheet, AtSign, Send, Clock,
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

const fmtNum = n => (n === null || n === undefined || n === '') ? '' :
  Number(n).toLocaleString('es-PE', { maximumFractionDigits: 2 })

// ─── Piezas visuales ──────────────────────────────────────────────────────────

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

function DateInp({ value, onChange, title }) {
  return (
    <input type="date" value={value || ''} title={title}
      onClick={e => e.stopPropagation()}
      onChange={e => onChange(e.target.value)}
      style={{
        fontFamily: F, fontSize: 11, color: value ? C.text : C.muted,
        border: `1px solid ${C.borderInput}`, borderRadius: 6, padding: '4px 6px',
        background: C.card, outline: 'none', width: 118, cursor: 'pointer',
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
const Td = ({ children, right, style, onClick }) => (
  <td onClick={onClick} style={{ padding: '8px 10px', fontFamily: F, fontSize: 12, color: C.text, borderBottom: `1px solid ${C.border}`, textAlign: right ? 'right' : 'left', verticalAlign: 'middle', ...style }}>{children}</td>
)

function Dato({ label, children }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontFamily: F, fontSize: 10, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 600, marginBottom: 4 }}>{label}</div>
      <div style={{ fontFamily: F, fontSize: 12, color: C.text }}>{children}</div>
    </div>
  )
}

function EstadoVacio({ icon: Icon, titulo, ayuda, accion }) {
  return (
    <div style={{ border: `1px dashed ${C.borderInput}`, borderRadius: 12, padding: '48px 20px', textAlign: 'center', margin: 20 }}>
      <Icon size={34} style={{ color: C.borderInput }} />
      <div style={{ fontFamily: F, fontSize: 14, fontWeight: 600, color: C.text, marginTop: 10 }}>{titulo}</div>
      <div style={{ fontFamily: F, fontSize: 12, color: C.muted, marginTop: 4 }}>{ayuda}</div>
      {accion && <div style={{ marginTop: 14, display: 'flex', justifyContent: 'center' }}>{accion}</div>}
    </div>
  )
}

// Marca de cambio: el cliente movió la "Fecha de entrega actual" en un reimport.
function FechaActualCell({ linea }) {
  const cambio = linea.fechaAnterior && linea.fechaAnterior !== linea.fechaActual
  return (
    <span title={cambio ? `El cliente cambió la fecha: antes ${fmtDate(linea.fechaAnterior)}` : undefined}>
      <span style={{ fontWeight: cambio ? 600 : 400, color: cambio ? '#8F5B00' : C.text, whiteSpace: 'nowrap' }}>
        {fmtDate(linea.fechaActual) || '—'}
      </span>
      {cambio && (
        <span style={{ display: 'block', fontSize: 10, color: C.gold, whiteSpace: 'nowrap' }}>
          antes {fmtDate(linea.fechaAnterior)}
        </span>
      )}
    </span>
  )
}

// Estado de la gestión con el proveedor (enviado / esperando / sin respuesta).
const EST_ESTILO = {
  sin_enviar:    { bg: '#EFEFEF', fg: C.muted,  txt: 'Sin enviar' },
  esperando:     { bg: '#E8F2FF', fg: C.brand,  txt: 'Esperando' },
  sin_respuesta: { bg: '#FDF3E7', fg: '#8F5B00', txt: 'Sin respuesta' },
  respondido:    { bg: '#E3F2E7', fg: '#106A32', txt: 'Respondió' },
}
function EstadoChip({ linea, umbral }) {
  const est = estadoRespuesta(linea, umbral)
  const s = EST_ESTILO[est]
  const dias = diasDesdeEnvio(linea)
  const detalle = est === 'sin_enviar' ? 'Aún no se ha escrito al proveedor por esta línea'
    : est === 'respondido' ? `Respondió el ${fmtDate(linea.respondidoAt?.slice(0, 10))}`
    : `Enviado hace ${dias} día${dias !== 1 ? 's' : ''}`
  return (
    <span title={detalle} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
      <span style={{ fontFamily: F, fontSize: 10.5, fontWeight: 600, color: s.fg, background: s.bg, padding: '2px 8px', borderRadius: 10 }}>
        {s.txt}
      </span>
      {(est === 'esperando' || est === 'sin_respuesta') && (
        <span style={{ fontFamily: F, fontSize: 10, color: est === 'sin_respuesta' ? C.warn : C.muted }}>{dias}d</span>
      )}
    </span>
  )
}

// ─── Modal: generar email al proveedor ────────────────────────────────────────

function EmailModal({ grupo, lineas, emailInicial, isMobile, onClose, onAviso, onEmailGuardado, onEnviado }) {
  const [email, setEmail] = useState(emailInicial || '')
  const [texto, setTexto] = useState(() => textoCorreoProveedor({ proveedorNombre: grupo.nombre, lineas }))
  const [enviando, setEnviando] = useState(false)
  const [errEnvio, setErrEnvio] = useState(null)
  const asunto = asuntoCorreoProveedor(lineas)

  // El email capturado se recuerda para la próxima vez (mini-directorio por código SAP).
  const persistirEmail = () => {
    if (!email.trim() || !emailValido(email.trim())) return
    guardarEmailProveedor({ codigo: grupo.codigo, nombre: grupo.nombre, email: email.trim() })
      .then(() => onEmailGuardado(grupo.codigo || grupo.nombre, email.trim()))
      .catch(() => {})
  }

  const copiar = async () => {
    persistirEmail()
    try {
      await navigator.clipboard.writeText(`Para: ${email.trim()}\nAsunto: ${asunto}\n\n${texto}`)
      onAviso('Correo copiado al portapapeles — pégalo en tu cliente de correo.')
    } catch { onAviso('No se pudo copiar automáticamente; selecciona y copia el texto.') }
  }
  const descargar = () => {
    persistirEmail()
    exportarExcelProveedor({ proveedorNombre: grupo.nombre, lineas })
    onAviso(`Excel de ${grupo.nombre} descargado (${lineas.length} material${lineas.length !== 1 ? 'es' : ''}) — adjúntalo al correo.`)
  }

  // Envío desde la app: la Edge Function manda por Resend y registra el envío.
  const enviar = async () => {
    setEnviando(true); setErrEnvio(null)
    persistirEmail()
    try {
      const r = await enviarCorreoProveedor({
        para: email.trim(), asunto, texto,
        adjunto: excelProveedorAdjunto({ proveedorNombre: grupo.nombre, lineas }),
        proveedor: { codigo: grupo.codigo, nombre: grupo.nombre },
        lineaIds: lineas.map(l => l.id),
      })
      onEnviado(`Correo enviado a ${grupo.nombre} (${email.trim()}) con ${lineas.length} material${lineas.length !== 1 ? 'es' : ''}.` +
        (r?.aviso ? ` ${r.aviso}` : ''))
    } catch (e) { setErrEnvio(e.message); setEnviando(false) }
  }

  const emailInvalido = !!email.trim() && !emailValido(email.trim())
  const puedeEnviar = !!email.trim() && !emailInvalido && !enviando

  return (
    <Modal isMobile={isMobile} width={640} onClose={onClose}
      title="Generar email al proveedor"
      subtitle={`${grupo.nombre}${grupo.codigo ? ` · ${grupo.codigo}` : ''} · ${lineas.length} material${lineas.length !== 1 ? 'es' : ''}`}
      footer={<>
        <Btn onClick={copiar} disabled={enviando}><Copy size={13} />Copiar</Btn>
        <Btn onClick={descargar} disabled={enviando}><FileSpreadsheet size={13} />Descargar Excel</Btn>
        <Btn primary onClick={enviar} disabled={!puedeEnviar}
          title={!email.trim() ? 'Escribe el email del proveedor' : 'Enviar ahora con el Excel adjunto'}>
          {enviando ? <RefreshCw size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Send size={13} />}
          {enviando ? 'Enviando…' : 'Enviar ahora'}
        </Btn>
      </>}>
      {errEnvio && <div style={{ marginBottom: 12 }}><Banner tipo="error">{errEnvio}</Banner></div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Dato label="Email del proveedor">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <AtSign size={14} style={{ color: C.muted, flexShrink: 0 }} />
            <input value={email} onChange={e => setEmail(e.target.value)} placeholder="correo@proveedor.com"
              style={{ fontFamily: F, fontSize: 12, border: `1px solid ${emailInvalido ? C.danger : C.borderInput}`, borderRadius: 6, padding: '6px 8px', flex: 1, outline: 'none' }} />
          </div>
          <div style={{ fontSize: 11, color: emailInvalido ? C.danger : C.muted, marginTop: 4 }}>
            {emailInvalido ? 'Formato de email inválido.'
              : 'Se guarda para reutilizarlo la próxima vez. Las respuestas del proveedor llegarán a tu propio buzón.'}
          </div>
        </Dato>
        <Dato label="Asunto">
          <div style={{ fontFamily: F, fontSize: 12, color: C.text, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6, padding: '6px 8px' }}>{asunto}</div>
        </Dato>
        <Dato label="Texto del correo (editable)">
          <textarea value={texto} onChange={e => setTexto(e.target.value)} rows={isMobile ? 10 : 13}
            style={{ fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 11.5, border: `1px solid ${C.borderInput}`, borderRadius: 8, padding: 10, width: '100%', boxSizing: 'border-box', outline: 'none', resize: 'vertical', background: C.card, color: C.text }} />
        </Dato>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: F, fontSize: 11, color: C.muted }}>
          <FileSpreadsheet size={13} style={{ flexShrink: 0 }} />
          Se adjunta automáticamente el Excel con las {lineas.length} línea{lineas.length !== 1 ? 's' : ''} y la columna «Fecha de entrega confirmada» para que la completen.
        </div>
      </div>
    </Modal>
  )
}

// ─── Raíz del módulo: List Report agrupada por proveedor ──────────────────────

export default function Seguimiento({ isMobile }) {
  const [lineas, setLineas] = useState([])
  const [emails, setEmails] = useState(new Map())
  const [loading, setLoading] = useState(true)
  const [importando, setImportando] = useState(false)
  const [error, setError] = useState(null)
  const [aviso, setAviso] = useState(null)
  const [busca, setBusca] = useState('')
  const [filtroProveedor, setFiltroProveedor] = useState('')
  const [soloVencidas, setSoloVencidas] = useState(false)
  const [soloSinRespuesta, setSoloSinRespuesta] = useState(false)
  const [umbral, setUmbral] = useState(UMBRAL_SIN_RESPUESTA_DIAS)
  const [seleccion, setSeleccion] = useState(new Set())
  const [modalEmail, setModalEmail] = useState(null)   // { grupo, lineas }
  const fileRef = useRef(null)

  const flashAviso = msg => { setAviso(msg); setTimeout(() => setAviso(a => a === msg ? null : a), 5000) }
  const refrescar = () => Promise.all([listarLineas(), listarEmailsProveedores()])
    .then(([ls, em]) => { setLineas(ls); setEmails(em) })
    .catch(e => setError(e.message))
    .finally(() => setLoading(false))
  useEffect(() => { refrescar() }, [])

  // ── Importación del Excel del cliente ──
  const processFile = file => {
    setImportando(true); setError(null)
    const reader = new FileReader()
    reader.onload = async e => {
      try {
        const wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array' })
        const { hoja, lineas: parseadas } = parsearSeguimientoExcel(wb)
        const st = await importarLineas(parseadas)
        await refrescar()
        setSeleccion(new Set())
        flashAviso(`Importada hoja «${hoja}»: ${st.total} líneas (${st.nuevas} nuevas, ${st.actualizadas} actualizadas` +
          (st.cambiosFecha ? `, ${st.cambiosFecha} con cambio de fecha de entrega` : '') +
          (st.desactivadas ? `, ${st.desactivadas} ya no vienen` : '') + '). Las fechas confirmadas se conservaron.')
      } catch (err) {
        setError(err.message ?? 'Error desconocido al importar.')
      } finally { setImportando(false) }
    }
    reader.onerror = () => { setError('No se pudo leer el archivo.'); setImportando(false) }
    reader.readAsArrayBuffer(file)
  }

  // ── Filtros y agrupación por proveedor ──
  const proveedores = useMemo(() =>
    [...new Map(lineas.map(l => [claveProveedor(l), l.proveedorNombre || claveProveedor(l)])).entries()]
      .sort((a, b) => a[1].localeCompare(b[1])), [lineas])

  const filtradas = useMemo(() => lineas.filter(l => {
    if (filtroProveedor && claveProveedor(l) !== filtroProveedor) return false
    if (soloVencidas && diasVencidos(l) === 0) return false
    if (soloSinRespuesta && estadoRespuesta(l, umbral) !== 'sin_respuesta') return false
    if (busca.trim()) {
      const q = busca.trim().toLowerCase()
      if (![l.documentoCompras, l.material, l.textoBreve, l.proveedorNombre].some(v => (v || '').toLowerCase().includes(q))) return false
    }
    return true
  }), [lineas, filtroProveedor, soloVencidas, soloSinRespuesta, umbral, busca])

  // Cuántas líneas llevan más del umbral sin respuesta (contador del filtro).
  const nSinRespuesta = useMemo(
    () => lineas.filter(l => estadoRespuesta(l, umbral) === 'sin_respuesta').length, [lineas, umbral])

  const grupos = useMemo(() => {
    const map = new Map()
    for (const l of filtradas) {
      const clave = claveProveedor(l)
      if (!map.has(clave)) map.set(clave, { clave, codigo: l.proveedorCodigo, nombre: l.proveedorNombre || clave, lineas: [] })
      map.get(clave).lineas.push(l)
    }
    return [...map.values()].sort((a, b) => a.nombre.localeCompare(b.nombre))
  }, [filtradas])

  // ── Selección ──
  const toggle = id => setSeleccion(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const toggleGrupo = g => setSeleccion(s => {
    const n = new Set(s)
    const todos = g.lineas.every(l => n.has(l.id))
    for (const l of g.lineas) todos ? n.delete(l.id) : n.add(l.id)
    return n
  })

  // Proveedor único de la selección actual (o null si está vacía / mezcla varios).
  const grupoSeleccion = useMemo(() => {
    if (!seleccion.size) return null
    const sel = lineas.filter(l => seleccion.has(l.id))
    const claves = new Set(sel.map(claveProveedor))
    if (claves.size !== 1) return null
    const l = sel[0]
    return { grupo: { clave: claveProveedor(l), codigo: l.proveedorCodigo, nombre: l.proveedorNombre || claveProveedor(l) }, lineas: sel }
  }, [seleccion, lineas])

  const abrirEmailSeleccion = () => { if (grupoSeleccion) setModalEmail(grupoSeleccion) }

  // Tras enviar: refrescamos para traer `ultimo_envio_at` y limpiamos la selección.
  const trasEnviar = async msg => {
    setModalEmail(null)
    setSeleccion(new Set())
    await refrescar()
    flashAviso(msg)
  }

  const confirmarFecha = (linea, fecha) => {
    setError(null)
    confirmarFechaEntrega(linea.id, fecha)
      .then(respondidoAt => {
        setLineas(ls => ls.map(l => l.id === linea.id ? { ...l, fechaConfirmada: fecha, respondidoAt } : l))
        flashAviso(fecha
          ? `Fecha confirmada por ${linea.proveedorNombre} para la OC ${linea.documentoCompras} pos. ${linea.posicion}: ${fmtDate(fecha)}.`
          : `Se quitó la fecha confirmada de la OC ${linea.documentoCompras} pos. ${linea.posicion}.`)
      })
      .catch(e => setError(e.message))
  }

  // El proveedor contestó sin mover la fecha (o por teléfono): sale de "sin respuesta".
  const marcarSeleccionRespondida = () => {
    const ids = [...seleccion]
    if (!ids.length) return
    setError(null)
    marcarRespondido(ids, true)
      .then(respondidoAt => {
        setLineas(ls => ls.map(l => seleccion.has(l.id) ? { ...l, respondidoAt } : l))
        setSeleccion(new Set())
        flashAviso(`${ids.length} línea${ids.length !== 1 ? 's marcadas' : ' marcada'} como respondida${ids.length !== 1 ? 's' : ''} por el proveedor.`)
      })
      .catch(e => setError(e.message))
  }

  const tituloEmail = !seleccion.size ? 'Selecciona materiales para generar el email'
    : !grupoSeleccion ? 'La selección mezcla varios proveedores: el email se genera por proveedor'
    : `Generar email a ${grupoSeleccion.grupo.nombre} (${grupoSeleccion.lineas.length})`

  const checkbox = (checked, onChange, title) => (
    <input type="checkbox" checked={checked} onChange={onChange} title={title}
      onClick={e => e.stopPropagation()} style={{ cursor: 'pointer' }} />
  )

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {error && <Banner tipo="error" onClose={() => setError(null)}>{error}</Banner>}
      {aviso && <Banner tipo="ok" onClose={() => setAviso(null)}>{aviso}</Banner>}

      {/* Toolbar de la List Report */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: isMobile ? '10px 14px' : '10px 24px', background: C.card, borderBottom: `1px solid ${C.border}` }}>
        <div style={{ fontFamily: F, fontSize: 14, fontWeight: 700, color: C.text, marginRight: 'auto' }}>
          Seguimiento de entregas <span style={{ color: C.muted, fontWeight: 400 }}>{filtradas.length}</span>
          {seleccion.size > 0 && <span style={{ color: C.primary, fontWeight: 600, fontSize: 12, marginLeft: 8 }}>{seleccion.size} seleccionada{seleccion.size !== 1 ? 's' : ''}</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, padding: '5px 9px' }}>
          <Search size={13} style={{ color: C.muted }} />
          <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="OC / material / proveedor…"
            style={{ fontFamily: F, fontSize: 12, border: 'none', outline: 'none', background: 'transparent', width: isMobile ? 110 : 170, color: C.text }} />
        </div>
        {!isMobile && (
          <select value={filtroProveedor} onChange={e => setFiltroProveedor(e.target.value)}
            style={{ fontFamily: F, fontSize: 12, border: `1px solid ${C.borderInput}`, borderRadius: 8, padding: '6px 8px', outline: 'none', color: C.text, background: C.card, maxWidth: 220 }}>
            <option value="">Todos los proveedores</option>
            {proveedores.map(([clave, nombre]) => <option key={clave} value={clave}>{nombre}</option>)}
          </select>
        )}
        <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontFamily: F, fontSize: 12, color: C.muted, cursor: 'pointer', userSelect: 'none' }}>
          <input type="checkbox" checked={soloVencidas} onChange={e => setSoloVencidas(e.target.checked)} />
          {isMobile ? 'Vencidas' : 'Solo vencidas'}
        </label>
        {/* Lo accionable del día: a quién se le escribió y no ha contestado. */}
        <label title={`Líneas enviadas hace ${umbral} días o más sin respuesta del proveedor`}
          style={{ display: 'flex', alignItems: 'center', gap: 5, fontFamily: F, fontSize: 12, color: nSinRespuesta ? '#8F5B00' : C.muted, cursor: 'pointer', userSelect: 'none' }}>
          <input type="checkbox" checked={soloSinRespuesta} onChange={e => setSoloSinRespuesta(e.target.checked)} />
          <Clock size={13} />
          {isMobile ? 'Sin resp.' : 'Sin respuesta'}
          <span style={{ fontWeight: 700 }}>{nSinRespuesta}</span>
        </label>
        {!isMobile && (
          <select value={umbral} onChange={e => setUmbral(Number(e.target.value))} title="Días sin respuesta a partir de los cuales hay que insistir"
            style={{ fontFamily: F, fontSize: 12, border: `1px solid ${C.borderInput}`, borderRadius: 8, padding: '6px 8px', outline: 'none', color: C.text, background: C.card }}>
            {OPCIONES_UMBRAL.map(d => <option key={d} value={d}>+{d} días</option>)}
          </select>
        )}
        <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }}
          onChange={e => { const f = e.target.files?.[0]; if (f) processFile(f); e.target.value = '' }} />
        <Btn onClick={() => fileRef.current?.click()} disabled={importando} title="Cargar el Excel de seguimiento que envía el cliente">
          {importando ? <RefreshCw size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Upload size={13} />}
          {isMobile ? '' : 'Subir Excel'}
        </Btn>
        {seleccion.size > 0 && (
          <Btn onClick={marcarSeleccionRespondida} title="El proveedor contestó sin cambiar la fecha (o por teléfono)">
            <CheckCircle2 size={13} />{isMobile ? '' : 'Marcar respondido'}
          </Btn>
        )}
        <Btn primary onClick={abrirEmailSeleccion} disabled={!grupoSeleccion} title={tituloEmail}>
          <Mail size={13} />{isMobile ? 'Email' : 'Generar email'}
        </Btn>
      </div>

      {/* Contenido (acepta arrastrar y soltar el Excel) */}
      <div
        onDragOver={e => e.preventDefault()}
        onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) processFile(f) }}
        style={{ flex: 1, overflowY: 'auto' }}>
        {loading ? (
          <div style={{ fontFamily: F, fontSize: 12, color: C.muted, padding: 24, display: 'flex', alignItems: 'center', gap: 8 }}>
            <RefreshCw size={14} style={{ animation: 'spin 1s linear infinite' }} />Cargando seguimiento…
          </div>
        ) : filtradas.length === 0 ? (
          <EstadoVacio icon={lineas.length ? Truck : FileSpreadsheet}
            titulo={lineas.length ? 'Sin resultados con estos filtros' : 'Sube el Excel de seguimiento del cliente'}
            ayuda={lineas.length ? 'Ajusta la búsqueda o los filtros para ver más materiales.'
              : 'Arrastra aquí el archivo (hoja «Detalle») o pulsa «Subir Excel». Cada fila es una posición de OC del cliente.'}
            accion={!lineas.length && (
              <Btn primary onClick={() => fileRef.current?.click()} disabled={importando}>
                <Upload size={13} />Subir Excel
              </Btn>
            )} />
        ) : isMobile ? (
          // Vista móvil: cards con labels, agrupadas por proveedor (sin scroll horizontal)
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '12px 14px' }}>
            {grupos.map(g => {
              const todos = g.lineas.every(l => seleccion.has(l.id))
              return (
                <div key={g.clave}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 2px 6px' }}>
                    {checkbox(todos, () => toggleGrupo(g), 'Seleccionar todo el proveedor')}
                    <span style={{ fontFamily: F, fontSize: 12.5, fontWeight: 700, color: C.text, flex: 1, minWidth: 0 }}>
                      {g.nombre} <span style={{ color: C.muted, fontWeight: 400 }}>{g.lineas.length}</span>
                    </span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {g.lineas.map(l => {
                      const dias = diasVencidos(l)
                      return (
                        <div key={l.id} onClick={() => toggle(l.id)}
                          style={{ background: C.card, border: `1px solid ${seleccion.has(l.id) ? C.primary : C.border}`, borderRadius: 12, padding: 12, cursor: 'pointer' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                            {checkbox(seleccion.has(l.id), () => toggle(l.id))}
                            <span style={{ fontFamily: F, fontSize: 13, fontWeight: 700, color: C.primary }}>{l.documentoCompras}</span>
                            <span style={{ fontFamily: F, fontSize: 11, color: C.muted }}>pos. {l.posicion}</span>
                            <span style={{ marginLeft: 'auto' }}><EstadoChip linea={l} umbral={umbral} /></span>
                            {dias > 0 && (
                              <span style={{ fontFamily: F, fontSize: 10.5, fontWeight: 600, color: C.danger, background: `${C.danger}12`, padding: '1px 8px', borderRadius: 10 }}>
                                {dias} día{dias !== 1 ? 's' : ''} vencida
                              </span>
                            )}
                          </div>
                          <div style={{ fontFamily: F, fontSize: 12, color: C.text, marginTop: 6 }}>
                            {l.material && <span style={{ fontWeight: 600 }}>{l.material} · </span>}{l.textoBreve}
                          </div>
                          <div style={{ fontFamily: F, fontSize: 11.5, color: C.muted, marginTop: 4, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                            <span>{fmtNum(l.cantidad)} {l.um}</span>
                            <span>{fmtNum(l.valorNeto)} {l.moneda}</span>
                            <span>Entrega: <FechaActualCell linea={l} /></span>
                          </div>
                          <div style={{ fontFamily: F, fontSize: 11.5, color: C.muted, marginTop: 6, display: 'flex', alignItems: 'center', gap: 6 }}
                            onClick={e => e.stopPropagation()}>
                            Confirmada:
                            <DateInp value={l.fechaConfirmada} title="Fecha que confirmó o rectificó el proveedor"
                              onChange={v => confirmarFecha(l, v)} />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', background: C.card }}>
            <thead><tr>
              <Th> </Th><Th>OC</Th><Th>Pos</Th><Th>Material</Th><Th>Texto breve</Th><Th>F. documento</Th>
              <Th right>Cantidad</Th><Th>UM</Th><Th right>Valor neto</Th><Th>F. entrega actual</Th>
              <Th>F. entrega confirmada</Th><Th>Gestión</Th><Th right>Días venc.</Th><Th>Status</Th>
            </tr></thead>
            <tbody>
              {grupos.map(g => {
                const todos = g.lineas.every(l => seleccion.has(l.id))
                const email = emails.get(g.clave)
                const pendientes = g.lineas.filter(l => estadoRespuesta(l, umbral) === 'sin_respuesta').length
                return [
                  // Cabecera del grupo proveedor
                  <tr key={`g-${g.clave}`} style={{ background: C.bg }}>
                    <Td style={{ borderBottom: `1px solid ${C.border}` }}>
                      {checkbox(todos, () => toggleGrupo(g), 'Seleccionar todo el proveedor')}
                    </Td>
                    <Td style={{ padding: '7px 10px' }} colSpan={13}>
                      <span style={{ fontWeight: 700, color: C.text }}>{g.nombre}</span>
                      {g.codigo && <span style={{ color: C.muted, marginLeft: 8, fontSize: 11 }}>{g.codigo}</span>}
                      <span style={{ color: C.muted, marginLeft: 8, fontSize: 11 }}>{g.lineas.length} material{g.lineas.length !== 1 ? 'es' : ''}</span>
                      {email && (
                        <span style={{ color: C.muted, marginLeft: 8, fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <AtSign size={11} />{email}
                        </span>
                      )}
                      {pendientes > 0 && (
                        <span title={`Se les escribió hace ${umbral} días o más y no han contestado`}
                          style={{ fontFamily: F, fontSize: 10.5, fontWeight: 600, color: '#8F5B00', background: '#FDF3E7', padding: '2px 8px', borderRadius: 10, marginLeft: 8 }}>
                          {pendientes} sin respuesta
                        </span>
                      )}
                    </Td>
                  </tr>,
                  ...g.lineas.map(l => {
                    const dias = diasVencidos(l)
                    return (
                      <tr key={l.id} onClick={() => toggle(l.id)} style={{ cursor: 'pointer', background: seleccion.has(l.id) ? '#F0F7FF' : 'transparent' }}
                        onMouseEnter={e => { if (!seleccion.has(l.id)) e.currentTarget.style.background = '#FAFBFC' }}
                        onMouseLeave={e => { if (!seleccion.has(l.id)) e.currentTarget.style.background = 'transparent' }}>
                        <Td>{checkbox(seleccion.has(l.id), () => toggle(l.id))}</Td>
                        <Td style={{ color: C.primary, fontWeight: 600, whiteSpace: 'nowrap' }}>{l.documentoCompras}</Td>
                        <Td>{l.posicion}</Td>
                        <Td style={{ whiteSpace: 'nowrap' }}>{l.material || <span style={{ color: C.muted }}>—</span>}</Td>
                        <Td style={{ maxWidth: 260 }}>{l.textoBreve}</Td>
                        <Td style={{ whiteSpace: 'nowrap' }}>{fmtDate(l.fechaDocumento)}</Td>
                        <Td right>{fmtNum(l.cantidad)}</Td>
                        <Td>{l.um}</Td>
                        <Td right style={{ whiteSpace: 'nowrap' }}>{fmtNum(l.valorNeto)} {l.moneda}</Td>
                        <Td><FechaActualCell linea={l} /></Td>
                        <Td onClick={e => e.stopPropagation()}>
                          <DateInp value={l.fechaConfirmada} title="Fecha que confirmó o rectificó el proveedor"
                            onChange={v => confirmarFecha(l, v)} />
                        </Td>
                        <Td><EstadoChip linea={l} umbral={umbral} /></Td>
                        <Td right style={{ color: dias > 0 ? C.danger : C.muted, fontWeight: dias > 0 ? 600 : 400 }}>
                          {dias > 0 ? dias : '—'}
                        </Td>
                        <Td style={{ color: C.muted, fontSize: 11, maxWidth: 160 }}>{l.status}</Td>
                      </tr>
                    )
                  }),
                ]
              })}
            </tbody>
          </table>
        )}
      </div>

      {modalEmail && (
        <EmailModal grupo={modalEmail.grupo} lineas={modalEmail.lineas} isMobile={isMobile}
          emailInicial={emails.get(modalEmail.grupo.clave) || ''}
          onClose={() => setModalEmail(null)} onAviso={flashAviso} onEnviado={trasEnviar}
          onEmailGuardado={(clave, em) => setEmails(m => new Map(m).set(clave, em))} />
      )}
    </div>
  )
}
