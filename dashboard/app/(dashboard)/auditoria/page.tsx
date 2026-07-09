import { supabase } from "@/lib/supabase"
import { InfoTooltip } from "@/components/ui/InfoTooltip"

export const revalidate = 60

const SEVERITY_BADGE: Record<string, string> = {
  high:   "bg-red-100 text-red-700",
  medium: "bg-yellow-100 text-yellow-700",
  low:    "bg-blue-100 text-blue-700",
}

// Fallback por si alguna fila vieja no trae el campo `class` en sus issues.
const PLATFORM_CHECKS = new Set(["structured_data", "indexability", "canonical", "discover", "social"])
const issueClass = (it: any) =>
  it.class ?? (PLATFORM_CHECKS.has(it.check) ? "platform" : "editorial")

export default async function AuditoriaPage() {
  const today = new Date().toISOString().split("T")[0]

  const { data: audits } = await supabase
    .from("onpage_audits")
    .select("*")
    .order("audited_date", { ascending: false })
    .order("score", { ascending: true })
    .limit(30)

  const rows = audits ?? []

  // Agregado de issues de PLATAFORMA (sistémicos): se muestran una sola vez,
  // con cuántas notas afecta cada uno.
  const platformAgg: Record<string, { message: string; severity: string; count: number }> = {}
  for (const a of rows) {
    const seen = new Set<string>()
    for (const it of (a.issues ?? [])) {
      if (issueClass(it) !== "platform") continue
      const key = it.check + "|" + it.message
      if (seen.has(key)) continue
      seen.add(key)
      if (!platformAgg[key]) platformAgg[key] = { message: it.message, severity: it.severity, count: 0 }
      platformAgg[key].count++
    }
  }
  const platformIssues = Object.values(platformAgg).sort((a, b) => b.count - a.count)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          Auditoría SEO on-page
          <InfoTooltip align="left">
            Revisión automática de los elementos SEO dentro de cada nota (título, meta
            description, H1/H2, keyword, enlazado interno, imágenes…). El benchmark de la
            mañana audita las notas donde más rinde optimizar y les pone un score 0–100.
            Sirve para saber qué corregir en cada artículo, con guía concreta.
          </InfoTooltip>
        </h1>
        <span className="text-sm text-gray-500">{today}</span>
      </div>

      {!rows.length && (
        <div className="bg-white rounded-2xl border border-gray-200 p-8 text-center text-gray-500 text-sm">
          Aún no hay auditorías. El benchmark de la mañana revisa las notas publicadas y los quick wins de Búsqueda & Discover.
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
              uno y no penalizan el score por nota.
            </InfoTooltip>
          </h2>
          <p className="text-xs text-gray-500 mb-3">
            Issues de plantilla/CMS que se repiten en muchas notas. No dependen del redactor;
            los resuelve el equipo técnico y no afectan el score por nota.
          </p>
          <ul className="space-y-1.5">
            {platformIssues.map((it, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0 ${SEVERITY_BADGE[it.severity] ?? "bg-gray-100 text-gray-600"}`}>
                  {it.severity?.toUpperCase()}
                </span>
                <span className="text-xs text-gray-700 flex-1">{it.message}</span>
                <span className="text-xs text-gray-400 shrink-0">{it.count} nota{it.count !== 1 ? "s" : ""}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Auditoría editorial por nota (lo que el redactor puede arreglar) */}
      {rows.length > 0 && (
        <h2 className="text-sm font-semibold text-gray-800 flex items-center gap-1.5">
          Auditoría editorial por nota
          <InfoTooltip align="left">
            Lo que el redactor sí puede arreglar en cada nota: título, meta description,
            H1/H2, keyword en el intro, profundidad, enlazado interno, alt de imágenes,
            frescura. El score 0–100 refleja solo estos puntos editoriales. Verde ≥80,
            naranja ≥60, rojo &lt;60. Si hay ✨ Sugerencia IA, es una reescritura propuesta
            del título/meta/H2.
          </InfoTooltip>
        </h2>
      )}
      <div className="space-y-3">
        {rows.map((a: any) => {
          const editorial = (a.issues ?? []).filter((it: any) => issueClass(it) === "editorial")
          return (
            <div key={a.id} className="bg-white rounded-2xl border border-gray-200 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-gray-900 truncate">{a.title ?? a.url}</p>
                  <a href={a.url} target="_blank" rel="noreferrer"
                     className="text-xs text-gray-400 font-mono truncate hover:text-rpp-teal block">{a.url}</a>
                  {a.target_keyword && (
                    <p className="text-xs text-gray-500 mt-0.5">keyword: <strong>{a.target_keyword}</strong></p>
                  )}
                </div>
                <div className="text-right shrink-0">
                  <span className={`text-xl font-bold ${
                    a.score >= 80 ? "text-green-600" : a.score >= 60 ? "text-orange-500" : "text-red-600"
                  }`}>{a.score ?? "—"}</span>
                  <span className="text-xs text-gray-400">/100</span>
                </div>
              </div>
              {editorial.length > 0 ? (
                <ul className="mt-3 space-y-1.5">
                  {editorial.map((it: any, i: number) => (
                    <li key={i} className="flex items-start gap-2">
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0 ${SEVERITY_BADGE[it.severity] ?? "bg-gray-100 text-gray-600"}`}>
                        {it.severity?.toUpperCase()}
                      </span>
                      <span className="text-xs text-gray-700">{it.message}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-xs text-green-600">Sin problemas editoriales — nota bien optimizada.</p>
              )}

              {/* Sugerencias reescritas por IA (Gemini) */}
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
          )
        })}
      </div>
    </div>
  )
}
