"use client"

import { useState } from "react"
import { StatCard } from "@/components/ui/StatCard"
import { InfoTooltip } from "@/components/ui/InfoTooltip"
import { SESSION_DAYS, isAdmin } from "@/lib/access"

/**
 * Panel de administración: quién usa el dashboard, quién se quedó en el camino
 * del código, y qué pestañas se usan — para decidir qué mejorar.
 *
 * Todos los tiempos relativos se calculan contra `generated_at` (la hora del
 * servidor al armar las estadísticas), no contra Date.now(): así el HTML del
 * servidor y el primer render del cliente coinciden (mismo motivo que /radar).
 */

export type AdminUser = {
  email: string
  first_login_at: string
  last_login_at: string
  login_count: number
  blocked: boolean
  session_expires_at: string
  last_seen_at: string | null
  views_30d: number
  active_days_30d: number
  top_tab: string | null
}
export type AdminPending = {
  email: string
  requests: number
  last_request_at: string
  failed_attempts: number
  all_expired: boolean
}
export type AdminStats = {
  generated_at: string
  users: AdminUser[]
  pending: AdminPending[]
  funnel_30d: {
    codes_requested: number
    codes_expired_unused: number
    failed_attempts: number
    emails_requested: number
    emails_logged_in: number
  }
  tabs_30d: { tab: string; views: number; users: number }[]
  daily_14d: { day: string; views: number; users: number }[]
  hours_30d: { hour: number; views: number }[]
}

// Nombres legibles; las pestañas del menú que no aparezcan en las visitas se
// listan como "sin uso" — es la señal más directa de qué no le sirve al equipo.
const TAB_LABELS: Record<string, string> = {
  "/": "Resumen",
  "/recomendaciones": "Recomendaciones",
  "/trends": "Tendencias",
  "/competencia": "Competencia",
  "/trafico": "Tráfico",
  "/busqueda": "Búsqueda & Discover",
  "/auditoria": "Auditoría",
  "/alertas": "Alertas",
  "/radar": "Radar de temas",
  "/status": "Estado del agente",
  "/admin": "Admin",
}
const tabLabel = (t: string | null) => (t ? TAB_LABELS[t] ?? t : "—")

const TEAL = "#0D9488"
const DAY_MS = 86400000

function fechaHora(iso: string | null): string {
  if (!iso) return "—"
  return new Date(iso).toLocaleString("es-PE", {
    timeZone: "America/Lima", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  })
}

function hace(iso: string | null, now: number): string {
  if (!iso) return "nunca"
  const ms = now - new Date(iso).getTime()
  if (ms < 0) return "ahora"
  const min = Math.floor(ms / 60000)
  if (min < 60) return `hace ${Math.max(min, 1)} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `hace ${h} h`
  return `hace ${Math.floor(h / 24)} d`
}

function estadoUsuario(u: AdminUser, now: number): { label: string; cls: string } {
  if (u.blocked) return { label: "Bloqueado", cls: "bg-red-50 text-red-700 border-red-200" }
  const restan = Math.ceil((new Date(u.session_expires_at).getTime() - now) / DAY_MS)
  if (restan <= 0) return { label: "Acceso vencido", cls: "bg-gray-100 text-gray-600 border-gray-200" }
  if (restan <= 5) return { label: `Vence en ${restan} d`, cls: "bg-amber-50 text-amber-800 border-amber-200" }
  return { label: `Activo · ${restan} d`, cls: "bg-teal-50 text-teal-800 border-teal-200" }
}

export default function AdminClient({ stats }: { stats: AdminStats }) {
  const now = new Date(stats.generated_at).getTime()
  const [users, setUsers] = useState(stats.users)
  const [error, setError] = useState<string | null>(null)

  const activos7 = users.filter((u) => u.last_seen_at && now - new Date(u.last_seen_at).getTime() < 7 * DAY_MS).length
  const bloqueados = users.filter((u) => u.blocked).length
  const f = stats.funnel_30d
  const conversion = f.emails_requested ? Math.round((f.emails_logged_in / f.emails_requested) * 100) : null
  const pendientesVigentes = stats.pending.filter((p) => !p.all_expired).length
  const usadas = new Set(stats.tabs_30d.map((t) => t.tab))
  const sinUso = Object.keys(TAB_LABELS).filter((t) => t !== "/admin" && !usadas.has(t))
  const hayVisitas = stats.tabs_30d.length > 0

  async function toggleBlock(u: AdminUser) {
    const next = !u.blocked
    if (next && !window.confirm(`¿Bloquear a ${u.email}? No podrá volver a ingresar; si ya tiene una sesión abierta, la conserva hasta que venza.`)) return
    setError(null)
    setUsers((list) => list.map((x) => (x.email === u.email ? { ...x, blocked: next } : x)))
    const res = await fetch("/api/admin/block", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: u.email, blocked: next }),
    }).catch(() => null)
    if (!res || !res.ok) {
      setUsers((list) => list.map((x) => (x.email === u.email ? { ...x, blocked: !next } : x)))
      const body = res ? await res.json().catch(() => ({})) : {}
      setError(body.error ?? "No se pudo guardar el cambio.")
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            Administración
            <InfoTooltip align="left">
              Quién usa el dashboard y cómo. Las visitas se registran desde el
              23-sep-2026, al activarse el acceso por correo: cada vez que alguien
              abre una pestaña (las precargas del menú no cuentan).
            </InfoTooltip>
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Usuarios, accesos y uso de las pestañas · datos de {fechaHora(stats.generated_at)}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          label="Usuarios registrados"
          value={users.length}
          subtitle={bloqueados ? `${bloqueados} bloqueado${bloqueados === 1 ? "" : "s"}` : "ninguno bloqueado"}
          accent={TEAL}
          info="Correos que ingresaron al menos una vez con su código."
        />
        <StatCard
          label="Activos · 7 días"
          value={activos7}
          subtitle={`de ${users.length} registrados`}
          accent="#2563EB"
          info="Usuarios que abrieron alguna pestaña en los últimos 7 días. El ingreso con código es cada 30 días, así que esto se mide por visitas, no por ingresos."
        />
        <StatCard
          label="Pidieron código sin entrar"
          value={stats.pending.length}
          subtitle={pendientesVigentes ? `${pendientesVigentes} con código aún vigente` : "todos vencidos"}
          accent="#CA8A04"
          info="Correos que pidieron un código y nunca completaron el ingreso. Si crece, lo más probable es que el correo esté cayendo en no deseado o cuarentena."
        />
        <StatCard
          label="Correo → ingreso · 30 d"
          value={conversion === null ? "—" : `${conversion}%`}
          subtitle={`${f.emails_logged_in} de ${f.emails_requested} correos · ${f.failed_attempts} códigos errados`}
          accent="#7C3AED"
          info="De los correos que pidieron código en 30 días, cuántos llegaron a entrar. Los códigos errados son intentos con un número equivocado."
        />
      </div>

      {error && (
        <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-2 text-sm text-red-700">{error}</div>
      )}

      {/* Uso en el tiempo */}
      <Card title="Usuarios activos por día" info="Usuarios distintos que abrieron el dashboard cada día (últimos 14 días, hora de Lima). Pasa el cursor sobre una barra para ver también las visitas.">
        <DailyBars data={stats.daily_14d} />
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card title="Pestañas más usadas · 30 días" info="Visitas por pestaña y cuántas personas distintas la abrieron. Una pestaña con muchas visitas de una sola persona es un uso de nicho; con pocas visitas de muchos, puede que no encuentren lo que buscan.">
          {hayVisitas ? (
            <TabBars data={stats.tabs_30d} />
          ) : (
            <Vacio>Todavía no hay visitas registradas.</Vacio>
          )}
          {hayVisitas && sinUso.length > 0 && (
            <p className="mt-4 border-t border-gray-100 pt-3 text-xs text-gray-500">
              <span className="font-semibold text-gray-600">Sin visitas en 30 días:</span>{" "}
              {sinUso.map(tabLabel).join(" · ")}
            </p>
          )}
        </Card>
        <Card title="Horario de uso · 30 días" info="Visitas por hora del día (Lima). Sirve para decidir cuándo conviene que el agente tenga todo fresco.">
          {hayVisitas ? <HourBars data={stats.hours_30d} /> : <Vacio>Todavía no hay visitas registradas.</Vacio>}
        </Card>
      </div>

      {/* Usuarios */}
      <Card title={`Usuarios (${users.length})`} info={`El acceso dura ${SESSION_DAYS} días desde el último ingreso con código. "Último uso" es la última pestaña abierta; "último ingreso", la última vez que pidió y usó un código.`} flush>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500">
              <tr>
                <Th>Usuario</Th><Th>Estado</Th><Th>Último uso</Th><Th>Último ingreso</Th>
                <Th right>Ingresos</Th><Th right>Días activo · 30 d</Th><Th right>Visitas · 30 d</Th>
                <Th>Pestaña favorita</Th><Th>{""}</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {users.map((u) => {
                const st = estadoUsuario(u, now)
                return (
                  <tr key={u.email} className="hover:bg-gray-50/60">
                    <Td><span className="font-medium text-gray-900">{u.email}</span>
                      {isAdmin(u.email) && <span className="ml-2 rounded bg-rpp-yellow px-1.5 py-0.5 text-[10px] font-bold text-rpp-ink">ADMIN</span>}
                    </Td>
                    <Td><span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${st.cls}`}>{st.label}</span></Td>
                    <Td title={fechaHora(u.last_seen_at)}>{hace(u.last_seen_at, now)}</Td>
                    <Td>{fechaHora(u.last_login_at)}</Td>
                    <Td right>{u.login_count}</Td>
                    <Td right>{u.active_days_30d}</Td>
                    <Td right>{u.views_30d}</Td>
                    <Td>{tabLabel(u.top_tab)}</Td>
                    <Td>
                      {!isAdmin(u.email) && (
                        <button
                          onClick={() => toggleBlock(u)}
                          className={`text-xs font-medium ${u.blocked ? "text-teal-700 hover:underline" : "text-red-600 hover:underline"}`}
                        >
                          {u.blocked ? "Desbloquear" : "Bloquear"}
                        </button>
                      )}
                    </Td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Pidieron código y no entraron */}
      <Card title={`Pidieron código y no entraron (${stats.pending.length})`} info="Correos corporativos que pidieron un código pero nunca completaron el ingreso. Varios pedidos del mismo correo suelen indicar que el código no le llega (no deseado o cuarentena de Microsoft); intentos fallidos, que lo copió mal." flush>
        {stats.pending.length === 0 ? (
          <div className="p-4"><Vacio>Nadie se quedó a medio camino.</Vacio></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500">
                <tr><Th>Correo</Th><Th right>Pedidos</Th><Th>Último pedido</Th><Th right>Intentos fallidos</Th><Th>Código</Th></tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {stats.pending.map((p) => (
                  <tr key={p.email}>
                    <Td><span className="font-medium text-gray-900">{p.email}</span></Td>
                    <Td right>{p.requests}</Td>
                    <Td title={fechaHora(p.last_request_at)}>{hace(p.last_request_at, now)}</Td>
                    <Td right>{p.failed_attempts}</Td>
                    <Td>{p.all_expired ? <span className="text-gray-500">Vencido</span> : <span className="text-teal-700 font-medium">Vigente</span>}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}

// ── Piezas ────────────────────────────────────────────────────────────────

function Card({ title, info, children, flush = false }: { title: string; info?: string; children: React.ReactNode; flush?: boolean }) {
  return (
    <section className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
      <header className="flex items-center gap-2 border-b border-gray-100 bg-gray-50 px-4 py-2.5">
        <h2 className="text-sm font-semibold text-gray-800">{title}</h2>
        {info && <InfoTooltip align="left">{info}</InfoTooltip>}
      </header>
      <div className={flush ? "" : "p-4"}>{children}</div>
    </section>
  )
}

function Th({ children, right = false }: { children: React.ReactNode; right?: boolean }) {
  return <th className={`px-4 py-2 font-medium whitespace-nowrap ${right ? "text-right" : "text-left"}`}>{children}</th>
}
function Td({ children, right = false, title }: { children: React.ReactNode; right?: boolean; title?: string }) {
  return <td title={title} className={`px-4 py-2.5 whitespace-nowrap text-gray-700 ${right ? "text-right tabular-nums" : ""}`}>{children}</td>
}
function Vacio({ children }: { children: React.ReactNode }) {
  return <p className="py-6 text-center text-sm text-gray-400">{children}</p>
}

/** Tooltip de barra: aparece al pasar el cursor o al enfocar con teclado. */
function Tip({ children }: { children: React.ReactNode }) {
  return (
    <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 -translate-x-1/2 whitespace-nowrap rounded-md bg-gray-900 px-2 py-1 text-[11px] text-white opacity-0 shadow transition group-hover:opacity-100 group-focus:opacity-100">
      {children}
    </span>
  )
}

function DailyBars({ data }: { data: AdminStats["daily_14d"] }) {
  const max = Math.max(1, ...data.map((d) => d.users))
  const pico = data.reduce((a, d) => (d.users > a.users ? d : a), data[0] ?? { day: "", users: 0, views: 0 })
  const etiqueta = (day: string) =>
    new Date(`${day}T12:00:00Z`).toLocaleDateString("es-PE", { timeZone: "America/Lima", weekday: "short", day: "numeric" }).replace(".", "")
  return (
    <div>
      <div className="flex h-40 items-end gap-[2px] border-b border-gray-200" role="img" aria-label="Usuarios activos por día, últimos 14 días">
        {data.map((d) => (
          <div key={d.day} tabIndex={0} className="group relative flex h-full flex-1 items-end justify-center outline-none">
            <div
              className="w-full max-w-[28px] rounded-t-[4px] transition-opacity group-hover:opacity-80"
              style={{ height: `${(d.users / max) * 100}%`, minHeight: d.users ? 3 : 0, background: TEAL }}
            />
            <Tip>{etiqueta(d.day)}: {d.users} usuario{d.users === 1 ? "" : "s"} · {d.views} visitas</Tip>
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-[2px] text-[10px] text-gray-400">
        {data.map((d, i) => (
          <span key={d.day} className="flex-1 text-center">{i % 2 === data.length % 2 ? "" : etiqueta(d.day)}</span>
        ))}
      </div>
      {pico && pico.users > 0 && (
        <p className="mt-2 text-xs text-gray-500">Máximo: {pico.users} usuario{pico.users === 1 ? "" : "s"} el {etiqueta(pico.day)}.</p>
      )}
    </div>
  )
}

function TabBars({ data }: { data: AdminStats["tabs_30d"] }) {
  const max = Math.max(1, ...data.map((t) => t.views))
  return (
    <ul className="space-y-2.5">
      {data.map((t) => (
        <li key={t.tab} className="text-sm">
          <div className="mb-1 flex items-baseline justify-between gap-2">
            <span className="text-gray-800">{tabLabel(t.tab)}</span>
            <span className="text-xs text-gray-500 tabular-nums">
              {t.views} visitas · {t.users} persona{t.users === 1 ? "" : "s"}
            </span>
          </div>
          <div className="h-2 rounded-full bg-gray-100">
            <div className="h-2 rounded-full" style={{ width: `${(t.views / max) * 100}%`, background: TEAL }} />
          </div>
        </li>
      ))}
    </ul>
  )
}

function HourBars({ data }: { data: AdminStats["hours_30d"] }) {
  const max = Math.max(1, ...data.map((h) => h.views))
  return (
    <div>
      <div className="flex h-40 items-end gap-[2px] border-b border-gray-200" role="img" aria-label="Visitas por hora del día">
        {data.map((h) => (
          <div key={h.hour} tabIndex={0} className="group relative flex h-full flex-1 items-end outline-none">
            <div
              className="w-full rounded-t-[4px] transition-opacity group-hover:opacity-80"
              style={{ height: `${(h.views / max) * 100}%`, minHeight: h.views ? 3 : 0, background: TEAL }}
            />
            <Tip>{String(h.hour).padStart(2, "0")}:00 · {h.views} visitas</Tip>
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-gray-400">
        <span>00 h</span><span>06 h</span><span>12 h</span><span>18 h</span><span>23 h</span>
      </div>
    </div>
  )
}
