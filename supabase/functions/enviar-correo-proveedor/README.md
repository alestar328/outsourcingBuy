# Envío de correos a proveedores (Resend)

La vista **Seguimiento** envía los correos de confirmación de fechas desde la app.
La clave de Resend no puede estar en el frontend (el bundle de Vite es público), así
que el envío pasa por esta Edge Function.

## Puesta en marcha (una sola vez)

1. **Crear cuenta en Resend** — https://resend.com. El plan gratuito da 3.000
   correos/mes; el volumen estimado es ~700/mes (166 proveedores × 1 vez por semana),
   así que no debería haber costo.

2. **Verificar el dominio de Minos** en Resend → *Domains* → *Add Domain*.
   Resend indica los registros **SPF, DKIM y DMARC** que hay que crear en el DNS del
   dominio. Sin esto los correos llegan a spam o son rechazados. La verificación tarda
   desde minutos hasta unas horas según el proveedor de DNS.

   > Mientras el dominio no esté verificado, Resend solo permite enviar a la dirección
   > con la que se registró la cuenta. Sirve para probar, no para operar.

3. **Crear la API key** en Resend → *API Keys* (permiso de envío basta).

4. **Cargar los secrets** en Supabase → *Project Settings* → *Edge Functions* →
   *Secrets* (o con la CLI, abajo):

   | Secret | Ejemplo | Qué es |
   |---|---|---|
   | `RESEND_API_KEY` | `re_xxxxxxxx` | la API key del paso 3 |
   | `RESEND_FROM` | `Minos Compras <seguimiento@tudominio.com>` | remitente; **el dominio debe ser el verificado en el paso 2** |

   ```bash
   supabase secrets set RESEND_API_KEY=re_xxxxxxxx
   supabase secrets set RESEND_FROM="Minos Compras <seguimiento@tudominio.com>"
   ```

   `SUPABASE_URL` y `SUPABASE_ANON_KEY` los inyecta la plataforma: no hay que cargarlos.

Si falta cualquiera de los dos secrets, la app muestra el error al pulsar «Enviar ahora»
en vez de fallar en silencio.

## Cómo funciona

- El **Reply-To** es el correo del usuario que envía (sale de su sesión de Supabase),
  así que las respuestas de los proveedores llegan a su propio buzón, no a un genérico.
- Cada envío se registra en `seg_envios` (+ `seg_envio_lineas` con el detalle de qué
  materiales iban) y sella `seg_lineas.ultimo_envio_at`. Eso es lo que alimenta el
  filtro **«Sin respuesta»** de la lista.
- Los intentos fallidos también se registran (`estado = 'error'`), para que quede
  rastro de lo que no salió.

## Redesplegar

```bash
supabase functions deploy enviar-correo-proveedor
```
