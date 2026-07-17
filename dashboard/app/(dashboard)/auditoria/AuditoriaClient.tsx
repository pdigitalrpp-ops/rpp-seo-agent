"use client"

import { useMemo, useState } from "react"
import { supabase } from "@/lib/supabase"
import { InfoTooltip } from "@/components/ui/InfoTooltip"
import { LastUpdated } from "@/components/ui/LastUpdated"
import { StatCard } from "@/components/ui/StatCard"

const SEVERITY_BADGE: Record<string, string> = {
  high:   "bg-red-100 text-red-700",
  medium: "bg-yellow-100 text-yellow-700",
  low:    "bg-blue-100 text-blue-700",
}

// Fallback por si alguna fila vieja no trae el campo `class` en sus issues.
const PLATFORM_CHECKS = new Set(["structured_data", "indexability", "canonical", "discover", "social"])
const issueClass = (it: any) =>
  it.class ?? (PLATFORM_CHECKS.has(it.check) ? "platform" : "editorial")

// Claves del checklist: por URL (no por id de auditoría) para que lo marcado
// persista cuando el morning re-audita la misma nota otro día.
const editorialKey = (a: any, it: any) => `${a.url}|${it.check}`
const platformKey = (check: string, message: string) => `platform|${check}|${message}`

function CheckBox({ done, onToggle }: { done: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      title={done ? "Marcar como pendiente" : "Marcar como corregido"}
      aria-label={done ? "Marcar como pendiente" : "Marcar como corregido"}
      className={`shrink-0 w-4 h-4 mt-0.5 rounded border flex items-center justify-center text-[10px] font-bold leading-none transition ${
        done
          ? "bg-rpp-teal border-rpp-teal text-white"
          : "bg-white border-gray-300 text-transparent hover:border-rpp-teal"
      }`}
    >
      ✓
    </button>
  )
}

export default function AuditoriaClient({
  audits,
  initialChecks,
  lastRun,
}: {
  audits: any[]
  initialChecks: Record<string, boolean>
  lastRun: string | null
}) {
  const [checks, setChecks] = useState<Record<string, boolean>>(initialChecks)

  const toggle = (id: string) => {
    const next = !checks[id]
    setChecks((c) => ({ ...c, [id]: next }))
    supabase
      .from("audit_check_state")
      .upsert({ id, done: next, done_at: next ? new Date().toISOString() : null })
      .then(({ error }) => {
        if (error) setChecks((c) => ({ ...c, [id]: !next })) // revertir si no se pudo guardar
      })
  }

  // Agregado de issues de PLATAFORMA (sistémicos): se muestran una sola vez,
  // con cuántas notas afecta cada uno.
  const platformIssues = useMemo(() => {
    const agg: Record<string, { check: string; message: string; severity: string; count: number }> = {}
    for (const a of audits) {
      const seen = new Set<string>()
      for (const it of a.issues ?? []) {
        if (issueClass(it) !== "platform") continue
        const key = it.check + "|" + it.message
        if (seen.has(key)) continue
        seen.add(key)
        if (!agg[key]) agg[key] = { check: it.check, message: it.message, severity: it.severity, count: 0 }
        agg[key].count++
      }
    }
    return Object.values(agg).sort((a, b) => b.count - a.count)
  }, [audits])

  // KPIs del período (solo issues editoriales, que son los accionables por nota)
  const editorialIds = useMemo(() => {
    const ids: string[] = []
    for (const a of audits)
      for (const it of a.issues ?? []) if (issueClass(it) === "editorial") ids.push(editorialKey(a, it))
    return ids
  }, [audits])
  const editorialDone = editorialIds.filter((id) => checks[id]).length
  const platformDone = platformIssues.filter((it) => checks[platformKey(it.check, it.message)]).length

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          Auditoría SEO on-page
          <InfoTooltip align="left">
            Revisión automática de los elementos SEO dentro de cada nota (título, meta
            description, H1/H2, keyword, enlazado interno, imágenes…). El benchmark de la
            mañana audita las notas donde más rinde optimizar y les pone un score 0–100.
            Se muestran las auditorías de los últimos 7 días; marca cada issue con su
            check ✓ cuando quede corregido para llevar el control.
          </InfoTooltip>
        </h1>
        <LastUpdated kind="morning" finishedAt={lastRun} />
      </div>

      {/* KPIs del período */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          label="Notas auditadas"
          value={audits.length}
          subtitle="últimos 7 días"
          accent="#0D9488"
          info="Cuántas notas auditó el benchmark de la mañana en los últimos 7 días. Las anteriores salen de la vista para que la lista no crezca sin límite."
        />
        <StatCard
          label="Issues editoriales"
          value={editorialIds.length}
          subtitle="accionables por redacción"
          accent="#F97316"
          info="Total de problemas que el redactor puede corregir en las notas de la vista (título, meta, H2, keyword, enlaces, imágenes…)."
        />
        <StatCard
          label="Corregidos"
          value={`${editorialDone}/${editorialIds.length}`}
          subtitle={editorialIds.length ? `${Math.round((editorialDone / editorialIds.length) * 100)}% del checklist` : "—"}
          accent="#16A34A"
          info="Issues editoriales marcados con ✓ en el checklist. El marcado es manual: sirve para controlar qué se ha ido corrigiendo."
        />
        <StatCard
          label="Pendientes técnicos"
          value={`${platformDone}/${platformIssues.length}`}
          subtitle="resuelve dev/SEO técnico"
          accent="#CA8A04"
          info="Problemas de plantilla/CMS que se repiten en muchas notas. No dependen del redactor; también se pueden marcar con ✓ al resolverse."
        />
      </div>

      {!audits.length && (
        <div className="bg-white rounded-2xl border border-gray-200 p-8 text-center text-gray-500 text-sm">
          Sin auditorías en los últimos 7 días. El benchmark de la mañana revisa las notas
          publicadas y los quick wins de Búsqueda &amp; Discover.
        </div>
      )}

      {/* Pendientes técnicos del sitio (sistémicos, para dev/SEO técnico) */}
      {platformIssues.length > 0 && (
        <div className="bg-white rounded-2xl border border-amber-200 p-4">
          <h2 className="text-sm font-semibold text-gray-800 flex items-center gap-1.5">
            Pendientes técnicos del sitio
            <InfoTooltip align="left">
              Problemas de plantilla/CMS que se repiten en muchas notas (og:image,
              canonical, datos estructurados…). No dependen del redactor: los resuelve el
              equipo técnico/dev. Se muestran una sola vez con cuántas notas afecta cada
              uno y no penalizan el score por nota. Marca el ✓ cuando el fix esté en
              producción.
            </InfoTooltip>
          </h2>
          <p className="text-xs text-gray-500 mb-3">
            Issues de plantilla/CMS que se repiten en muchas notas. No dependen del redactor;
            los resuelve el equipo técnico y no afectan el score por nota.
          </p>
          <ul className="space-y-1.5">
            {platformIssues.map((it, i) => {
              const id = platformKey(it.check, it.message)
              const done = !!checks[id]
              return (
                <li key={i} className="flex items-start gap-2">
                  <CheckBox done={done} onToggle={() => toggle(id)} />
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0 ${SEVERITY_BADGE[it.severity] ?? "bg-gray-100 text-gray-600"} ${done ? "opacity-40" : ""}`}>
                    {it.severity?.toUpperCase()}
                  </span>
                  <span className={`text-xs flex-1 ${done ? "text-gray-400 line-through" : "text-gray-700"}`}>{it.message}</span>
                  <span className="text-xs text-gray-400 shrink-0">{it.count} nota{it.count !== 1 ? "s" : ""}</span>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {/* Auditoría editorial por nota (lo que el redactor puede arreglar) */}
      {audits.length > 0 && (
        <h2 className="text-sm font-semibold text-gray-800 flex items-center gap-1.5">
          Auditoría editorial por nota
          <span className="font-normal text-gray-400">· últimos 7 días</span>
          <InfoTooltip align="left">
            Lo que el redactor sí puede arreglar en cada nota: título, meta description,
            H1/H2, keyword en el intro, profundidad, enlazado interno, alt de imágenes,
            frescura. El score 0–100 refleja solo estos puntos editoriales. Verde ≥80,
            naranja ≥60, rojo &lt;60. Marca el ✓ de cada issue al corregirlo: el avance
            queda guardado para todo el equipo. Si hay ✨ Sugerencia IA, es una
            reescritura propuesta del título/meta/H2.
          </InfoTooltip>
        </h2>
      )}
      <div className="space-y-3">
        {audits.map((a: any) => {
          const editorial = (a.issues ?? []).filter((it: any) => issueClass(it) === "editorial")
          const doneCount = editorial.filter((it: any) => checks[editorialKey(a, it)]).length
          const allDone = editorial.length > 0 && doneCount === editorial.length
          const scoreColor =
            a.score == null ? "#9CA3AF" : a.score >= 80 ? "#16A34A" : a.score >= 60 ? "#F97316" : "#DC2626"
          return (
            <div
              key={a.id}
              className="bg-white rounded-2xl border border-gray-200 p-4 transition hover:border-gray-300 hover:shadow-sm"
              style={{ borderLeftWidth: 4, borderLeftColor: allDone ? "#16A34A" : scoreColor }}
            >
              <div className="flex gap-4 md:gap-5">
                {/* Panel de score (izquierda), como en Recomendaciones */}
                <div className="shrink-0 w-16 md:w-20 flex flex-col items-center text-center border-r border-gray-100 pr-4 self-start">
                  <span className="text-3xl font-extrabold leading-none" style={{ color: scoreColor }}>
                    {a.score ?? "—"}
                  </span>
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mt-0.5">
                    score /100
                  </span>
                  <div className="h-1.5 w-full rounded-full bg-gray-100 mt-2">
                    <div
                      className="h-1.5 rounded-full"
                      style={{ width: `${Math.min(100, a.score ?? 0)}%`, backgroundColor: scoreColor }}
                    />
                  </div>
                  {editorial.length > 0 ? (
                    <>
                      <span className={`text-[10px] mt-1.5 font-semibold ${allDone ? "text-green-600" : "text-gray-500"}`}>
                        {doneCount}/{editorial.length} ✓
                      </span>
                      <div className="h-1 w-full rounded-full bg-gray-100 mt-1">
                        <div
                          className="h-1 rounded-full bg-rpp-teal transition-all"
                          style={{ width: `${editorial.length ? (doneCount / editorial.length) * 100 : 0}%` }}
                        />
                      </div>
                    </>
                  ) : (
                    <span className="text-[10px] text-gray-400 mt-1.5">0 issues</span>
                  )}
                </div>

                {/* Contenido (derecha) */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-gray-900 truncate flex-1">{a.title ?? a.url}</p>
                    <span className="text-[10px] text-gray-400 shrink-0">{a.audited_date}</span>
                  </div>
                  <a href={a.url} target="_blank" rel="noreferrer"
                     className="text-xs text-gray-400 font-mono truncate hover:text-rpp-teal block">{a.url}</a>
                  {a.target_keyword && (
                    <p className="text-xs text-gray-500 mt-0.5">keyword: <strong>{a.target_keyword}</strong></p>
                  )}

                  {editorial.length > 0 ? (
                    <ul className="mt-3 space-y-1.5">
                      {editorial.map((it: any, i: number) => {
                        const id = editorialKey(a, it)
                        const done = !!checks[id]
                        return (
                          <li key={i} className="flex items-start gap-2">
                            <CheckBox done={done} onToggle={() => toggle(id)} />
                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0 ${SEVERITY_BADGE[it.severity] ?? "bg-gray-100 text-gray-600"} ${done ? "opacity-40" : ""}`}>
                              {it.severity?.toUpperCase()}
                            </span>
                            <span className={`text-xs ${done ? "text-gray-400 line-through" : "text-gray-700"}`}>{it.message}</span>
                          </li>
                        )
                      })}
                    </ul>
                  ) : (
                    <p className="mt-3 text-xs text-green-600">Sin problemas editoriales — nota bien optimizada.</p>
                  )}
                  {allDone && (
                    <p className="mt-2 text-xs font-semibold text-green-600">✓ Checklist completo — nota corregida.</p>
                  )}

                  {/* Sugerencias reescritas por IA */}
                  {a.suggestions && (a.suggestions.title || a.suggestions.meta_description) && (
                    <div className="mt-3 rounded-lg bg-violet-50 border border-violet-100 p-3 space-y-2">
                      <p className="text-[11px] font-semibold text-violet-700 flex items-center gap-1">
                        ✨ Sugerencia IA
                      </p>
                      {a.suggestions.title && (
                        <div>
                          <p className="text-[10px] uppercase text-gray-400 font-medium">Título</p>
                          <p className="text-xs text-gray-800">{a.suggestions.title}
                            <span className="text-gray-400"> ({a.suggestions.title.length}c)</span></p>
                        </div>
                      )}
                      {a.suggestions.meta_description && (
                        <div>
                          <p className="text-[10px] uppercase text-gray-400 font-medium">Meta description</p>
                          <p className="text-xs text-gray-800">{a.suggestions.meta_description}
                            <span className="text-gray-400"> ({a.suggestions.meta_description.length}c)</span></p>
                        </div>
                      )}
                      {Array.isArray(a.suggestions.h2) && a.suggestions.h2.length > 0 && (
                        <div>
                          <p className="text-[10px] uppercase text-gray-400 font-medium">Subtítulos H2</p>
                          <ul className="text-xs text-gray-800 list-disc list-inside">
                            {a.suggestions.h2.map((h: string, i: number) => <li key={i}>{h}</li>)}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
