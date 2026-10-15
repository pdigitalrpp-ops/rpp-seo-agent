"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

/**
 * Destinatarios de los correos automáticos (2026-10-15). Antes se
 * administraban por SQL; ahora se agregan, editan, quitan y prueban desde aquí.
 * Toda escritura pasa por /api/admin/destinatarios, que valida, guarda y deja
 * el cambio en el historial.
 */

export type Destinatario = {
  email: string
  active: boolean
  digest: boolean
  alerts: boolean
  alert_min_severity: "low" | "medium" | "high"
  trends: boolean
  trend_categories: string[] | null
  traffic: boolean
  traffic_sections: string[] | null
}
export type UltimoEnvio = { email: string; kind: string; sent_at: string }
export type OpcionSeccion = { key: string; label: string; page_views: number }

const CORREOS: { kind: string; campo: keyof Destinatario; label: string; cuando: string }[] = [
  { kind: "resumen",    campo: "digest",  label: "Resumen matutino", cuando: "con el benchmark (~6 a.m.)" },
  { kind: "alerta",     campo: "alerts",  label: "Alertas",          cuando: "al momento" },
  { kind: "tendencias", campo: "trends",  label: "Tendencias",       cuando: "08:00 · 13:00 · 18:00" },
  { kind: "trafico",    campo: "traffic", label: "Tráfico de ayer",  cuando: "con el benchmark (~6 a.m.)" },
]
const PRUEBA: Record<string, string> = { resumen: "resumen", alerta: "alertas", tendencias: "tendencias", trafico: "trafico" }
const SEVERIDAD: Record<string, string> = { high: "Solo altas", medium: "Altas y medias", low: "Todas" }

const VACIO: Destinatario = {
  email: "", active: true, digest: false, alerts: false, alert_min_severity: "medium",
  trends: true, trend_categories: null, traffic: false, traffic_sections: null,
}

function fechaHora(iso: string | undefined): string {
  if (!iso) return "nunca"
  return new Date(iso).toLocaleString("es-PE", {
    timeZone: "America/Lima", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  })
}

export function DestinatariosCard({
  destinatarios, envios, categorias, secciones,
}: {
  destinatarios: Destinatario[]
  envios: UltimoEnvio[]
  categorias: [string, string][]
  secciones: OpcionSeccion[]
}) {
  const router = useRouter()
  const [editando, setEditando] = useState<Destinatario | null>(null)
  const [esNuevo, setEsNuevo] = useState(false)
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null)

  const nombreCat = (k: string) => categorias.find((c) => c[0] === k)?.[1] ?? k
  const nombreSec = (k: string) => secciones.find((s) => s.key === k)?.label ?? k
  const ultimo = (email: string, kind: string) =>
    envios.find((e) => e.email === email && e.kind === kind)?.sent_at

  async function llamar(cuerpo: Record<string, unknown>, etiqueta: string) {
    setOcupado(etiqueta)
    setAviso(null)
    try {
      const res = await fetch("/api/admin/destinatarios", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo),
      })
      const r = await res.json().catch(() => ({}))
      if (!res.ok) { setAviso({ ok: false, texto: r.error || "No se pudo completar." }); return false }
      return r
    } catch {
      setAviso({ ok: false, texto: "Sin conexión. Intenta de nuevo." })
      return false
    } finally {
      setOcupado(null)
    }
  }

  async function guardar() {
    if (!editando) return
    const r = await llamar({ action: "guardar", email: editando.email, data: editando }, "guardar")
    // El formulario se cierra SOLO al guardar: el panel se refresca solo cada
    // 5 min (AutoRefresh) y cerrarlo con cada dato nuevo borraría lo que se está editando.
    if (r) { setAviso({ ok: true, texto: `Guardado: ${editando.email}` }); setEditando(null); router.refresh() }
  }

  async function borrar(d: Destinatario) {
    if (!window.confirm(`¿Quitar a ${d.email}? Dejará de recibir todos los correos.`)) return
    const r = await llamar({ action: "borrar", email: d.email }, `borrar:${d.email}`)
    if (r) { setAviso({ ok: true, texto: `Quitado: ${d.email}` }); router.refresh() }
  }

  async function probar(d: Destinatario, kind: string) {
    const r = await llamar({ action: "probar", email: d.email, tipo: PRUEBA[kind] }, `probar:${d.email}:${kind}`)
    if (r) setAviso(r.enviado
      ? { ok: true, texto: `Prueba enviada a ${d.email}. Llega con "[PRUEBA]" en el asunto.` }
      : { ok: false, texto: r.nota || "No había datos para ese correo." })
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 px-4 py-2.5">
        <p className="text-xs text-gray-500">
          Solo correos @gruporpp.com.pe. Cada cambio queda en el historial de abajo.
        </p>
        {!editando && (
          <button
            onClick={() => { setEditando({ ...VACIO }); setEsNuevo(true); setAviso(null) }}
            className="rounded-lg bg-rpp-teal px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90"
          >
            + Agregar destinatario
          </button>
        )}
      </div>

      {aviso && (
        <div className={`mx-4 mt-3 rounded-lg border px-3 py-2 text-xs ${aviso.ok
          ? "border-teal-200 bg-teal-50 text-teal-800" : "border-red-200 bg-red-50 text-red-700"}`}>
          {aviso.texto}
        </div>
      )}

      {editando && (
        <Formulario
          valor={editando} esNuevo={esNuevo} categorias={categorias} secciones={secciones}
          ocupado={ocupado === "guardar"}
          onCambio={setEditando} onGuardar={guardar} onCancelar={() => setEditando(null)}
        />
      )}

      {destinatarios.length === 0 ? (
        <p className="p-4 text-sm text-gray-500">Nadie recibe correos todavía.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Correo</th>
                {CORREOS.map((c) => <th key={c.kind} className="px-4 py-2 text-left font-medium">{c.label}</th>)}
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {destinatarios.map((d) => (
                <tr key={d.email} className={`align-top ${d.active ? "" : "opacity-50"}`}>
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-900">{d.email.replace("@gruporpp.com.pe", "")}</div>
                    {!d.active && <div className="text-xs text-gray-500">En pausa</div>}
                  </td>
                  {CORREOS.map((c) => {
                    const on = d[c.campo] === true
                    const detalle =
                      c.kind === "alerta" ? SEVERIDAD[d.alert_min_severity] :
                      c.kind === "tendencias" ? (d.trend_categories?.length ? d.trend_categories.map(nombreCat).join(", ") : "Todas las categorías") :
                      c.kind === "trafico" ? (d.traffic_sections ?? []).map(nombreSec).join(", ") : null
                    return (
                      <td key={c.kind} className="px-4 py-3 text-xs">
                        {on ? (
                          <>
                            <div className="font-semibold text-teal-700">Sí</div>
                            {detalle && <div className="text-gray-600 max-w-[12rem]">{detalle}</div>}
                            <div className="text-gray-400">Último: {fechaHora(ultimo(d.email, c.kind))}</div>
                            <button
                              onClick={() => probar(d, c.kind)}
                              disabled={!!ocupado}
                              className="mt-1 text-teal-700 hover:underline disabled:opacity-40"
                            >
                              {ocupado === `probar:${d.email}:${c.kind}` ? "Enviando…" : "Enviar prueba"}
                            </button>
                          </>
                        ) : <span className="text-gray-400">No</span>}
                      </td>
                    )
                  })}
                  <td className="px-4 py-3 text-right text-xs whitespace-nowrap">
                    <button
                      onClick={() => { setEditando({ ...d }); setEsNuevo(false); setAviso(null) }}
                      className="text-gray-700 hover:underline"
                    >
                      Editar
                    </button>
                    <button
                      onClick={() => borrar(d)}
                      disabled={!!ocupado}
                      className="ml-3 text-red-600 hover:underline disabled:opacity-40"
                    >
                      Quitar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function Formulario({
  valor, esNuevo, categorias, secciones, ocupado, onCambio, onGuardar, onCancelar,
}: {
  valor: Destinatario
  esNuevo: boolean
  categorias: [string, string][]
  secciones: OpcionSeccion[]
  ocupado: boolean
  onCambio: (d: Destinatario) => void
  onGuardar: () => void
  onCancelar: () => void
}) {
  const set = (cambios: Partial<Destinatario>) => onCambio({ ...valor, ...cambios })
  const alternar = (lista: string[] | null, k: string) => {
    const l = lista ?? []
    const n = l.indexOf(k) >= 0 ? l.filter((x) => x !== k) : l.concat(k)
    return n.length ? n : null
  }
  const correoValido = /^[a-z0-9._%+-]+@gruporpp\.com\.pe$/.test(valor.email.trim().toLowerCase())
  const faltaSeccion = valor.traffic && !(valor.traffic_sections && valor.traffic_sections.length)

  return (
    <div className="m-4 rounded-xl border border-gray-200 bg-gray-50 p-4 space-y-4">
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Correo</label>
        {esNuevo ? (
          <input
            type="email" value={valor.email} placeholder="nombre@gruporpp.com.pe"
            onChange={(e) => set({ email: e.target.value })}
            className="w-full max-w-sm rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm"
          />
        ) : <div className="text-sm font-medium text-gray-900">{valor.email}</div>}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Bloque titulo="Resumen matutino" activo={valor.digest} onActivo={(v) => set({ digest: v })}
          ayuda="Tráfico de ayer del sitio, qué cubrir, tendencias, Search Console y títulos por mejorar." />

        <Bloque titulo="Alertas" activo={valor.alerts} onActivo={(v) => set({ alerts: v })}
          ayuda="Hechos rompiendo que RPP aún no publicó, al momento.">
          <select
            value={valor.alert_min_severity}
            onChange={(e) => set({ alert_min_severity: e.target.value as Destinatario["alert_min_severity"] })}
            className="rounded-lg border border-gray-300 bg-white px-2 py-1 text-xs"
          >
            <option value="high">Solo altas</option>
            <option value="medium">Altas y medias</option>
            <option value="low">Todas</option>
          </select>
        </Bloque>

        <Bloque titulo="Tendencias" activo={valor.trends} onActivo={(v) => set({ trends: v })}
          ayuda="Lo más buscado en Google Perú, a las 08:00, 13:00 y 18:00. Sin marcar ninguna categoría, llegan todas.">
          <Chips opciones={categorias.map(([k, l]) => ({ key: k, label: l }))} elegidas={valor.trend_categories}
            onAlternar={(k) => set({ trend_categories: alternar(valor.trend_categories, k) })} />
        </Bloque>

        <Bloque titulo="Tráfico de ayer" activo={valor.traffic} onActivo={(v) => set({ traffic: v })}
          ayuda="Total, canales y notas más leídas de las secciones elegidas (al menos una).">
          <Chips opciones={secciones.map((s) => ({ key: s.key, label: s.label }))} elegidas={valor.traffic_sections}
            onAlternar={(k) => set({ traffic_sections: alternar(valor.traffic_sections, k) })} />
          {faltaSeccion && <p className="mt-1 text-xs text-red-600">Elige al menos una sección.</p>}
        </Bloque>
      </div>

      <label className="flex items-center gap-2 text-sm text-gray-700">
        <input type="checkbox" checked={!valor.active} onChange={(e) => set({ active: !e.target.checked })} />
        Pausar todos sus correos (sin borrar su configuración)
      </label>

      <div className="flex gap-2">
        <button
          onClick={onGuardar}
          disabled={ocupado || !correoValido || faltaSeccion}
          className="rounded-lg bg-rpp-teal px-4 py-1.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-40"
        >
          {ocupado ? "Guardando…" : "Guardar"}
        </button>
        <button onClick={onCancelar} className="rounded-lg border border-gray-300 bg-white px-4 py-1.5 text-sm text-gray-700">
          Cancelar
        </button>
      </div>
    </div>
  )
}

function Bloque({ titulo, activo, onActivo, ayuda, children }: {
  titulo: string; activo: boolean; onActivo: (v: boolean) => void; ayuda: string; children?: React.ReactNode
}) {
  return (
    <div className={`rounded-lg border bg-white p-3 ${activo ? "border-teal-300" : "border-gray-200"}`}>
      <label className="flex items-center gap-2 text-sm font-semibold text-gray-800">
        <input type="checkbox" checked={activo} onChange={(e) => onActivo(e.target.checked)} />
        {titulo}
      </label>
      <p className="mt-1 text-xs text-gray-500">{ayuda}</p>
      {activo && children && <div className="mt-2">{children}</div>}
    </div>
  )
}

function Chips({ opciones, elegidas, onAlternar }: {
  opciones: { key: string; label: string }[]; elegidas: string[] | null; onAlternar: (k: string) => void
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {opciones.map((o) => {
        const on = (elegidas ?? []).indexOf(o.key) >= 0
        return (
          <button
            key={o.key} type="button" onClick={() => onAlternar(o.key)}
            className={`rounded-full border px-2 py-0.5 text-xs ${on
              ? "border-teal-600 bg-teal-600 text-white" : "border-gray-300 bg-white text-gray-700 hover:border-gray-400"}`}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
