import nodemailer from "nodemailer"
import { CODE_TTL_MIN } from "./accessServer"

/**
 * Envío del código por Gmail (cuenta pdigitalrpp) con una "contraseña de
 * aplicación" de Google — decisión del 2026-09-23: no requiere DNS ni a TI.
 * El SMTP integrado de Supabase ya no sirve: solo envía a miembros del equipo.
 *
 * Env en Vercel: GMAIL_USER, GMAIL_APP_PASSWORD (16 letras, sin espacios).
 */
export async function sendAccessCode(email: string, code: string): Promise<void> {
  const user = process.env.GMAIL_USER
  const pass = (process.env.GMAIL_APP_PASSWORD ?? "").replace(/\s/g, "")
  if (!user || !pass) throw new Error("Falta GMAIL_USER o GMAIL_APP_PASSWORD en Vercel")

  const transport = nodemailer.createTransport({ service: "gmail", auth: { user, pass } })
  const espaciado = `${code.slice(0, 3)} ${code.slice(3)}`

  await transport.sendMail({
    from: `"RPP SEO Agent" <${user}>`,
    to: email,
    subject: `${espaciado} es tu código de acceso al SEO Agent`,
    text:
      `Tu código de acceso al dashboard del SEO Agent de RPP es: ${code}\n\n` +
      `Vence en ${CODE_TTL_MIN} minutos y sirve una sola vez.\n` +
      `Si no lo pediste, ignora este correo: nadie puede entrar sin el código.`,
    html: `
      <div style="font-family:Arial,Helvetica,sans-serif;max-width:420px;margin:0 auto;color:#111827">
        <div style="background:#F5D414;padding:14px 18px;border-radius:12px 12px 0 0;font-weight:800;font-size:16px">
          SEO Agent · RPP Noticias
        </div>
        <div style="border:1px solid #e5e7eb;border-top:0;padding:22px 18px;border-radius:0 0 12px 12px">
          <p style="margin:0 0 12px;font-size:14px">Tu código de acceso al dashboard es:</p>
          <p style="margin:0 0 16px;font-size:32px;font-weight:800;letter-spacing:6px">${espaciado}</p>
          <p style="margin:0;font-size:13px;color:#6b7280">
            Vence en ${CODE_TTL_MIN} minutos y sirve una sola vez. Si no lo pediste,
            ignora este correo: nadie puede entrar sin el código.
          </p>
        </div>
      </div>`,
  })
}
