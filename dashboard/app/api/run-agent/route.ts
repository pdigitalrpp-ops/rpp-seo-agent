import { NextRequest, NextResponse } from "next/server"
import { supabase } from "@/lib/supabase"

// Dispara manualmente el workflow del radar en GitHub Actions.
// Sin auth por ahora (MVP: el dashboard entero es libre); las protecciones
// reales son el cooldown de 30 min contra agent_runs (cuida las cuotas free
// de OpenRouter/Marfeel) y no despachar si ya hay una corrida
// queued/in_progress en GitHub.
export const dynamic = "force-dynamic"

const REPO = "pdigitalrpp-ops/rpp-seo-agent"
const WORKFLOW = "radar.yml"
const COOLDOWN_MINUTES = 30

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

export async function POST(_req: NextRequest) {
  if (!process.env.GITHUB_DISPATCH_TOKEN) {
    return NextResponse.json(
      { error: "Actualización manual no configurada (falta GITHUB_DISPATCH_TOKEN en Vercel)." },
      { status: 503 }
    )
  }

  // Cooldown: última corrida del radar terminada hace < 30 min → rechazar
  const { data: lastRun } = await supabase
    .from("agent_runs")
    .select("finished_at")
    .eq("kind", "radar")
    .order("finished_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (lastRun?.finished_at) {
    const ageMin = (Date.now() - new Date(lastRun.finished_at).getTime()) / 60_000
    if (ageMin >= 0 && ageMin < COOLDOWN_MINUTES) {
      return NextResponse.json(
        {
          error: `Los datos se actualizaron hace ${Math.round(ageMin)} min. ` +
            `Para cuidar las cuotas gratuitas, espera ${Math.ceil(COOLDOWN_MINUTES - ageMin)} min más.`,
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
