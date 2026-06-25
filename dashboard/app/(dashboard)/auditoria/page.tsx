import { supabase } from "@/lib/supabase"

export const revalidate = 60

const SEVERITY_BADGE: Record<string, string> = {
  high:   "bg-red-100 text-red-700",
  medium: "bg-yellow-100 text-yellow-700",
  low:    "bg-blue-100 text-blue-700",
}

export default async function AuditoriaPage() {
  const today = new Date().toISOString().split("T")[0]

  const { data: audits } = await supabase
    .from("onpage_audits")
    .select("*")
    .order("audited_date", { ascending: false })
    .order("score", { ascending: true })
    .limit(30)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Auditoría SEO on-page</h1>
        <span className="text-sm text-gray-500">{today}</span>
      </div>

      {!audits?.length && (
        <div className="bg-white rounded-xl border p-8 text-center text-gray-500 text-sm">
          Aún no hay auditorías. El benchmark de la mañana revisa las notas publicadas y los quick wins de Search Console.
        </div>
      )}

      <div className="space-y-3">
        {audits?.map((a: any) => (
          <div key={a.id} className="bg-white rounded-xl border p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium text-gray-900 truncate">{a.title ?? a.url}</p>
                <p className="text-xs text-gray-400 font-mono truncate">{a.url}</p>
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
            {Array.isArray(a.issues) && a.issues.length > 0 && (
              <ul className="mt-3 space-y-1.5">
                {a.issues.map((it: any, i: number) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0 ${SEVERITY_BADGE[it.severity] ?? "bg-gray-100 text-gray-600"}`}>
                      {it.severity?.toUpperCase()}
                    </span>
                    <span className="text-xs text-gray-700">{it.message}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
