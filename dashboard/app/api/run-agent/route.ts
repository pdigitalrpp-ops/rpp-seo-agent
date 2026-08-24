import { NextRequest, NextResponse } from "next/server"
import { supabase } from "@/lib/supabase"
import { dentroDeVentanaRadar, limaHour } from "@/lib/dates"

/**
 * Dispara el workflow del radar en GitHub Actions. Dos llamadores:
 *
 *  1. EL BOTÓN del dashboard — sin secreto, porque se llama desde el navegador
 *     y cualquier credencial quedaría a la vista. Lo acota el cooldown de 30 min.
 *  2. EL CRON EXTERNO (cron-job.org) — manda `CRON_SECRET` y por eso puede
 *     disparar cada 15 min. El secreto no da ACCESO (el endpoint sigue siendo
 *     público): compra un cooldown más corto.
 *
 * POR QUÉ EXISTE ESTE CAMINO. El `schedule` de GitHub Actions es best-effort y
 * se desprioriza: medido sobre 7 días y 242 intervalos, la cadencia real era de
 * 27 min de mediana **y el 7% de los huecos pasaba de una hora**, con un peor
 * caso de 1h51 en pleno día. Un `workflow_dispatch`, en cambio, arranca en
 * segundos (medido: 9 s de la llamada a la ejecución). Así que el agente se
 * queda donde está y lo único que se reemplaza es el reloj.
 */
export const dynamic = "force-dynamic"

const REPO = "pdigitalrpp-ops/rpp-seo-agent"
const WORKFLOW = "radar.yml"
const COOLDOWN_MINUTES = 30        // botón del dashboard
const COOLDOWN_CRON_MINUTES = 12   // cron externo cada 15 min, con holgura

/** ¿La petición trae el secreto del cron? Acepta Bearer o cabecera propia. */
function esCronAutorizado(req: NextRequest): boolean {
  const esperado = process.env.CRON_SECRET
  if (!esperado) return false
  const auth = req.headers.get("authorization") ?? ""
  const propia = req.headers.get("x-cron-secret") ?? ""
  const recibido = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7) : propia
  // Comparación de longitud fija para no filtrar el secreto por tiempo.
  if (!recibido || recibido.length !== esperado.length) return false
  let dif = 0
  for (let i = 0; i < esperado.length; i++) dif |= esperado.charCodeAt(i) ^ recibido.charCodeAt(i)
  return dif === 0
}

async function githubFetch(path: string, init?: RequestInit) {
  return fetch(`https://api.github.com/repos/${REPO}${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${process.env.GITHUB_DISPATCH_TOKEN}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...init?.headers,
    },
  })
}

export async function POST(req: NextRequest) {
  if (!process.env.GITHUB_DISPATCH_TOKEN) {
    return NextResponse.json(
      { error: "Actualización manual no configurada (falta GITHUB_DISPATCH_TOKEN en Vercel)." },
      { status: 503 }
    )
  }

  const esCron = esCronAutorizado(req)

  // LA PAUSA DE MADRUGADA SE DEFIENDE AQUÍ, no solo en la configuración del
  // cron externo: si cron-job.org queda mal configurado o cambia de zona
  // horaria, el agente no debe ponerse a correr a las 3 de la mañana. El botón
  // del dashboard NO pasa por esta guarda — si alguien lo pulsa de madrugada es
  // porque lo quiere.
  if (esCron && !dentroDeVentanaRadar()) {
    return NextResponse.json(
      { skipped: "fuera de la ventana activa (05:00–23:59 Lima)", limaHour: limaHour() },
      { status: 200 }
    )
  }

  const cooldown = esCron ? COOLDOWN_CRON_MINUTES : COOLDOWN_MINUTES

  // Cooldown: última corrida del radar terminada hace menos de eso → rechazar
  const { data: lastRun } = await supabase
    .from("agent_runs")
    .select("finished_at")
    .eq("kind", "radar")
    .order("finished_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (lastRun?.finished_at) {
    const ageMin = (Date.now() - new Date(lastRun.finished_at).getTime()) / 60_000
    if (ageMin >= 0 && ageMin < cooldown) {
      return NextResponse.json(
        {
          error: `Los datos se actualizaron hace ${Math.round(ageMin)} min. ` +
            `Para cuidar las cuotas gratuitas, espera ${Math.ceil(cooldown - ageMin)} min más.`,
        },
        { status: 429 }
      )
    }
  }

  // ¿Ya hay una corrida del radar en curso o en cola?
  const inProgress = await githubFetch(
    `/actions/workflows/${WORKFLOW}/runs?status=in_progress&per_page=1`
  )
  const queued = await githubFetch(
    `/actions/workflows/${WORKFLOW}/runs?status=queued&per_page=1`
  )
  if (inProgress.ok && queued.ok) {
    const running =
      (await inProgress.json()).total_count + (await queued.json()).total_count
    if (running > 0) {
      return NextResponse.json(
        { error: "Ya hay una actualización en curso. Los datos nuevos llegan en ~5-10 min." },
        { status: 409 }
      )
    }
  }

  // Despachar el workflow (workflow_dispatch)
  const dispatch = await githubFetch(`/actions/workflows/${WORKFLOW}/dispatches`, {
    method: "POST",
    body: JSON.stringify({ ref: "master" }),
  })

  if (dispatch.status !== 204) {
    const detail = await dispatch.text()
    console.error("run-agent dispatch failed:", dispatch.status, detail)
    return NextResponse.json(
      { error: "No se pudo iniciar la actualización. Intenta de nuevo en unos minutos." },
      { status: 502 }
    )
  }

  return NextResponse.json({
    ok: true,
    message: "Actualización iniciada. Los datos nuevos aparecen en ~5-10 min.",
  })
}
