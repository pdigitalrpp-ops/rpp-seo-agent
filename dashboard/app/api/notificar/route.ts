import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/accessServer"
import { esCronAutorizado } from "@/lib/cronAuth"
import { isAllowedEmail, normalizeEmail } from "@/lib/access"
import { limaHour, todayInLima } from "@/lib/dates"
import { sendMail } from "@/lib/mailer"
import { armarAlertas, armarResumen, NIVEL } from "@/lib/notificaciones"
import {
  ENVIOS_TENDENCIAS, MARGEN_ENVIO_HORAS, armarTendencias, desdeParaEnvio, leerTendencias,
} from "@/lib/tendenciasCorreo"
import { armarTrafico, leerTrafico } from "@/lib/traficoCorreo"
import { armarPruebaTemas, enviarTemas } from "@/lib/temasCorreo"

/**
 * Envía por correo lo que el agente dejó nuevo en la base. La llama pg_cron
 * desde Supabase cada 5 min (función `notificar_cron_disparar`), con el mismo
 * `CRON_SECRET` que /api/run-agent. Sin el secreto no hace nada: el middleware
 * la deja pasar porque pg_cron no tiene cookie.
 *
 * Dos envíos, cada uno a los destinatarios de `notification_recipients`:
 *
 *  - RESUMEN MATUTINO: una vez al día, apenas existe la corrida `morning` de
 *    hoy. No tiene hora fija porque el benchmark no la tiene (medido: entre
 *    06:40 y 09:06).
 *  - ALERTAS: las creadas en las últimas horas que esa persona aún no recibió,
 *    juntas en un solo correo por pasada.
 *  - TENDENCIAS: 08:00, 13:00 y 18:00 hora de Lima (lib/tendenciasCorreo.ts),
 *    solo a quien tiene `trends` activo, filtrado por sus `trend_categories`.
 *  - TRÁFICO DE AYER por sección (lib/traficoCorreo.ts): una vez al día con el
 *    benchmark, a quien tiene `traffic` activo, solo sus `traffic_sections`.
 *  - TEMAS DEL RADAR (lib/temasCorreo.ts): a quien sigue un tema desde /radar
 *    (`watch_subscriptions`), al momento, por horarios o una vez al día.
 *
 * Prueba de temas: `{"prueba": "temas", "para": "...", "keyword_id": "..."}`
 * (sin keyword_id, los temas que sigue esa persona).
 *
 * QUE NO SE REPITA NI SE PIERDA. `notification_log` tiene una fila por
 * (tipo, referencia, correo) con clave única. Se RESERVA antes de enviar
 * (insert que ignora duplicados) y solo se envía lo que se logró reservar: dos
 * pasadas simultáneas no mandan dos veces. Si el envío falla, la reserva se
 * borra y la siguiente pasada reintenta.
 *
 * PRUEBAS. Con `{"prueba": "resumen" | "alertas" | "tendencias" | "trafico", "para": "correo"}` manda ese
 * correo en el momento, sin mirar ni tocar el registro.
 */
export const dynamic = "force-dynamic"
export const maxDuration = 60

/** Una alerta más vieja que esto ya no es "ahora": no se manda con retraso. */
const ALERTA_MAX_HORAS = 3

type Destinatario = {
  email: string; digest: boolean; alerts: boolean; alert_min_severity: string
  trends: boolean; trend_categories: string[] | null
  traffic: boolean; traffic_sections: string[] | null
}
type Body = {
  prueba?: string; para?: string; secciones?: string[] | null; categorias?: string[] | null; keyword_id?: string | null
}

export async function POST(req: NextRequest) {
  if (!esCronAutorizado(req)) return NextResponse.json({ error: "No autorizado." }, { status: 401 })

  let body: Body = {}
  try { body = await req.json() } catch { /* vacío */ }

  const db = supabaseAdmin()
  const hoy = todayInLima()
  const desde = new Date(Date.now() - ALERTA_MAX_HORAS * 3600_000).toISOString()

  // --- Modo prueba ----------------------------------------------------------
  if (body.prueba) {
    const para = normalizeEmail(body.para)
    if (!isAllowedEmail(para)) return NextResponse.json({ error: "Correo no permitido." }, { status: 400 })
    try {
      if (body.prueba === "resumen") {
        const c = await armarResumen(db, hoy)
        await sendMail(para, "[PRUEBA] " + c.subject, c.html, c.text)
      } else if (body.prueba === "alertas") {
        // Las últimas del día, aunque ya se hayan enviado: es para ver el formato.
        const { data } = await db.from("alerts")
          .select("id, type, severity, section, score, title, keyword, description, url, created_at")
          .eq("date", hoy).order("created_at", { ascending: false }).limit(3)
        if (!data || !data.length) return NextResponse.json({ ok: true, prueba: "alertas", enviado: 0, nota: "sin alertas hoy" })
        const c = armarAlertas(data)
        await sendMail(para, "[PRUEBA] " + c.subject, c.html, c.text)
      } else if (body.prueba === "tendencias") {
        const filas = await leerTendencias(db, hoy)
        if (!filas) return NextResponse.json({ ok: true, prueba: "tendencias", enviado: 0, nota: "sin tendencias hoy" })
        const h = limaHour()
        const slot = ENVIOS_TENDENCIAS.filter((x) => x <= h).pop() ?? ENVIOS_TENDENCIAS[0]
        const c = armarTendencias(filas, slot, desdeParaEnvio(hoy, slot), body.categorias ?? null)
        if (!c) return NextResponse.json({ ok: true, prueba: "tendencias", enviado: 0 })
        await sendMail(para, "[PRUEBA] " + c.subject, c.html, c.text)
      } else if (body.prueba === "trafico") {
        const datos = await leerTrafico(db, hoy)
        const c = datos ? armarTrafico(datos, body.secciones && body.secciones.length ? body.secciones : ["economia"]) : null
        if (!c) return NextResponse.json({ ok: true, prueba: "trafico", enviado: 0, nota: "sin tráfico de ayer todavía" })
        await sendMail(para, "[PRUEBA] " + c.subject, c.html, c.text)
      } else if (body.prueba === "temas") {
        const c = await armarPruebaTemas(db, para, body.keyword_id)
        if (!c) return NextResponse.json({ ok: true, prueba: "temas", enviado: 0, nota: "ese tema no trajo publicaciones en las últimas 24 h" })
        await sendMail(para, "[PRUEBA] " + c.subject, c.html, c.text)
      } else {
        return NextResponse.json({ error: "Prueba desconocida." }, { status: 400 })
      }
    } catch (e) {
      console.error("[notificar] fallo la prueba:", e instanceof Error ? e.message : e)
      return NextResponse.json({ error: "No se pudo enviar la prueba." }, { status: 502 })
    }
    return NextResponse.json({ ok: true, prueba: body.prueba, para })
  }

  // --- Envío normal ---------------------------------------------------------
  const resultado = { resumen: 0, alertas: 0, tendencias: 0, trafico: 0, temas: 0, fallos: 0 }

  /** Reserva (tipo, ref) para un correo; devuelve las refs que quedaron a su nombre. */
  async function reservar(kind: string, refs: string[], email: string): Promise<string[]> {
    const { data, error } = await db.from("notification_log")
      .upsert(refs.map((ref) => ({ kind, ref, email })), { onConflict: "kind,ref,email", ignoreDuplicates: true })
      .select("ref")
    if (error) { console.error("[notificar] no se pudo reservar:", error.message); return [] }
    return (data ?? []).map((r: { ref: string }) => r.ref)
  }
  async function liberar(kind: string, refs: string[], email: string) {
    await db.from("notification_log").delete().eq("kind", kind).eq("email", email).in("ref", refs)
  }

  // 0. Avisos de los temas del Radar. Van ANTES de leer notification_recipients:
  //    quien sigue un tema no necesita estar en esa lista.
  try {
    const t = await enviarTemas(db, {
      hoy, hora: limaHour(), reservar, liberar,
      enviar: (para, c) => sendMail(para, c.subject, c.html, c.text),
    })
    resultado.temas = t.enviados
    resultado.fallos += t.fallos
  } catch (e) {
    console.error("[notificar] fallaron los avisos de temas:", e instanceof Error ? e.message : e)
  }

  const { data: dest, error: errDest } = await db.from("notification_recipients")
    .select("email, digest, alerts, alert_min_severity, trends, trend_categories, traffic, traffic_sections").eq("active", true)
  if (errDest) {
    console.error("[notificar] no se pudo leer destinatarios:", errDest.message)
    return NextResponse.json({ error: "Sin destinatarios.", ...resultado }, { status: 500 })
  }
  const destinatarios = ((dest ?? []) as Destinatario[]).filter((d) => isAllowedEmail(d.email))
  if (!destinatarios.length) return NextResponse.json({ ok: true, ...resultado, nota: "sin destinatarios" })

  // 1. Resumen matutino: solo si el benchmark de HOY ya terminó.
  const { data: morning } = await db.from("agent_runs").select("id")
    .eq("kind", "morning").eq("run_date", hoy).limit(1).maybeSingle()
  if (morning) {
    let correo: Awaited<ReturnType<typeof armarResumen>> | null = null
    for (const d of destinatarios.filter((x) => x.digest)) {
      const mias = await reservar("resumen", [hoy], d.email)
      if (!mias.length) continue
      try {
        if (!correo) correo = await armarResumen(db, hoy)
        await sendMail(d.email, correo.subject, correo.html, correo.text)
        resultado.resumen++
      } catch (e) {
        console.error("[notificar] fallo el resumen:", e instanceof Error ? e.message : e)
        await liberar("resumen", mias, d.email)
        resultado.fallos++
      }
    }
  }

  // 4. Tráfico de ayer por sección: con el benchmark de hoy, como el resumen.
  const conTrafico = destinatarios.filter((d) => d.traffic && d.traffic_sections && d.traffic_sections.length)
  if (morning && conTrafico.length) {
    let datos: Awaited<ReturnType<typeof leerTrafico>> = null
    try { datos = await leerTrafico(db, hoy) } catch (e) {
      console.error("[notificar] no se pudo leer el tráfico:", e instanceof Error ? e.message : e)
    }
    if (datos) {
      for (const d of conTrafico) {
        const correo = armarTrafico(datos, d.traffic_sections as string[])
        if (!correo) continue
        const mias = await reservar("trafico", [hoy], d.email)
        if (!mias.length) continue
        try {
          await sendMail(d.email, correo.subject, correo.html, correo.text)
          resultado.trafico++
        } catch (e) {
          console.error("[notificar] fallo el correo de tráfico:", e instanceof Error ? e.message : e)
          await liberar("trafico", mias, d.email)
          resultado.fallos++
        }
      }
    }
  }

  // 3. Tendencias: el envío del horario vigente, si todavía está en su margen.
  const hora = limaHour()
  const slot = ENVIOS_TENDENCIAS.filter((x) => x <= hora && hora < x + MARGEN_ENVIO_HORAS).pop()
  const suscritos = destinatarios.filter((d) => d.trends)
  if (slot !== undefined && suscritos.length) {
    let filas: Awaited<ReturnType<typeof leerTendencias>> = null
    try { filas = await leerTendencias(db, hoy) } catch (e) {
      console.error("[notificar] no se pudo leer tendencias:", e instanceof Error ? e.message : e)
    }
    // Sin tendencias registradas todavía no se reserva nada: la siguiente
    // pasada vuelve a intentarlo dentro del margen.
    if (filas) {
      const ref = `${hoy}@${slot}`
      for (const d of suscritos) {
        const correo = armarTendencias(filas, slot, desdeParaEnvio(hoy, slot), d.trend_categories)
        if (!correo) continue
        const mias = await reservar("tendencias", [ref], d.email)
        if (!mias.length) continue
        try {
          await sendMail(d.email, correo.subject, correo.html, correo.text)
          resultado.tendencias++
        } catch (e) {
          console.error("[notificar] fallo el correo de tendencias:", e instanceof Error ? e.message : e)
          await liberar("tendencias", mias, d.email)
          resultado.fallos++
        }
      }
    }
  }

  // 2. Alertas recientes.
  const { data: alertas } = await db.from("alerts")
    .select("id, type, severity, section, score, title, keyword, description, url, created_at")
    .gte("created_at", desde).order("created_at", { ascending: false }).limit(30)
  if (alertas && alertas.length) {
    for (const d of destinatarios.filter((x) => x.alerts)) {
      const minimo = NIVEL[d.alert_min_severity] ?? NIVEL.medium
      const candidatas = alertas.filter((a) => (NIVEL[a.severity] ?? 0) >= minimo)
      if (!candidatas.length) continue
      const mias = await reservar("alerta", candidatas.map((a) => String(a.id)), d.email)
      if (!mias.length) continue
      try {
        const c = armarAlertas(candidatas.filter((a) => mias.indexOf(String(a.id)) >= 0))
        await sendMail(d.email, c.subject, c.html, c.text)
        resultado.alertas += mias.length
      } catch (e) {
        console.error("[notificar] fallaron las alertas:", e instanceof Error ? e.message : e)
        await liberar("alerta", mias, d.email)
        resultado.fallos++
      }
    }
  }

  return NextResponse.json({ ok: true, ...resultado })
}
