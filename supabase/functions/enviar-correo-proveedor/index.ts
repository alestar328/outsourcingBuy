// ══════════════════════════════════════════════════════════════════════════════
//  Edge Function: enviar correo de confirmación de fechas a un proveedor
// ══════════════════════════════════════════════════════════════════════════════
//  La clave de Resend no puede vivir en el frontend (quedaría expuesta en el
//  bundle), así que el envío pasa por aquí. La función:
//    1. exige sesión válida (el JWT lo verifica la plataforma),
//    2. envía el correo por Resend con el Excel adjunto,
//    3. registra el envío en seg_envios + seg_envio_lineas y sella
//       seg_lineas.ultimo_envio_at para el control de "sin respuesta".
//  Los fallos también se registran (estado='error'), para que quede rastro.
//
//  Secrets requeridos:  RESEND_API_KEY, RESEND_FROM
//  (SUPABASE_URL y SUPABASE_ANON_KEY los inyecta la plataforma.)
// ══════════════════════════════════════════════════════════════════════════════

import { createClient } from 'npm:@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

const emailOk = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)

// Tope defensivo: un correo de expediting nunca lleva miles de líneas.
const MAX_LINEAS = 500

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Método no permitido.' }, 405)

  const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
  const RESEND_FROM = Deno.env.get('RESEND_FROM')
  if (!RESEND_API_KEY || !RESEND_FROM)
    return json({ error: 'Falta configurar RESEND_API_KEY o RESEND_FROM en los secrets del proyecto.' }, 500)

  const authHeader = req.headers.get('Authorization') ?? ''
  if (!authHeader) return json({ error: 'Falta la sesión: vuelve a iniciar sesión.' }, 401)

  // Cliente con el JWT del usuario: la escritura queda sujeta a RLS y es atribuible.
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  )
  const { data: { user }, error: authErr } = await supabase.auth.getUser()
  if (authErr || !user) return json({ error: 'Sesión inválida o expirada.' }, 401)

  let body: any
  try { body = await req.json() } catch { return json({ error: 'Cuerpo de la petición inválido.' }, 400) }

  const { para, asunto, texto, adjunto, proveedor, lineaIds } = body ?? {}
  if (!para || !emailOk(String(para))) return json({ error: 'El email del proveedor no es válido.' }, 400)
  if (!asunto || !texto) return json({ error: 'Falta el asunto o el cuerpo del correo.' }, 400)
  const ids: string[] = Array.isArray(lineaIds) ? lineaIds.slice(0, MAX_LINEAS) : []

  // El comprador que envía recibe las respuestas del proveedor en su propio buzón.
  const replyTo = user.email ?? undefined

  // ── 1. Enviar por Resend ──
  let msgId: string | null = null
  let fallo: string | null = null
  try {
    const payload: Record<string, unknown> = {
      from: RESEND_FROM,
      to: [String(para)],
      subject: String(asunto),
      text: String(texto),
    }
    if (replyTo) payload.reply_to = replyTo
    if (adjunto?.contenidoBase64 && adjunto?.filename)
      payload.attachments = [{ filename: String(adjunto.filename), content: String(adjunto.contenidoBase64) }]

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const out = await res.json().catch(() => ({}))
    if (!res.ok) fallo = out?.message || out?.error?.message || `Resend respondió ${res.status}.`
    else msgId = out?.id ?? null
  } catch (e) {
    fallo = `No se pudo contactar con Resend: ${e instanceof Error ? e.message : String(e)}`
  }

  // ── 2. Registrar el envío (también si falló: deja rastro de lo intentado) ──
  const { data: envio, error: eIns } = await supabase
    .from('seg_envios')
    .insert({
      proveedor_codigo: proveedor?.codigo || null,
      proveedor_nombre: proveedor?.nombre || null,
      email: String(para),
      reply_to: replyTo ?? null,
      asunto: String(asunto),
      cuerpo: String(texto),
      n_lineas: ids.length,
      estado: fallo ? 'error' : 'enviado',
      proveedor_msg_id: msgId,
      error: fallo,
      enviado_por: user.id,
    })
    .select('id')
    .single()

  if (fallo) return json({ error: fallo, envioId: envio?.id ?? null }, 502)
  if (eIns) {
    // El correo SÍ salió: avisamos del fallo de registro sin decir que no se envió.
    return json({ ok: true, aviso: `El correo se envió, pero no se pudo registrar: ${eIns.message}`, messageId: msgId })
  }

  // ── 3. Detalle de líneas + sello para el control de respuesta ──
  if (ids.length) {
    await supabase.from('seg_envio_lineas').insert(ids.map(id => ({ envio_id: envio.id, linea_id: id })))
    await supabase.from('seg_lineas')
      .update({ ultimo_envio_at: new Date().toISOString(), respondido_at: null })
      .in('id', ids)
  }

  return json({ ok: true, envioId: envio.id, messageId: msgId, nLineas: ids.length })
})
