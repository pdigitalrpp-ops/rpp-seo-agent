"use client"

import { useEffect, useState } from "react"
import { FRECUENCIAS, FRECUENCIA_INFO, type Frecuencia } from "@/lib/avisosTemas"

/**
 * Avisos por correo de un tema del Radar: la ventana que abre la campana 🔔 de
 * cada tema, y el cliente de /api/radar/suscripcion. Cada quien administra
 * solo los suyos; el correo sale de la sesión, no de aquí.
 */

type Resultado = { ok: boolean; error?: string; nota?: string; enviado?: boolean; para?: string }

async function llamar(body: Record<string, unknown>): Promise<Resultado> {
  try {
    const res = await fetch("/api/radar/suscripcion", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) return { ok: false, error: json.error ?? "No se pudo guardar." }
    return { ok: true, ...json }
  } catch {
    return { ok: false, error: "Error de conexión. Intenta de nuevo." }
  }
}

export function guardarAviso(keywordId: string, frecuencia: Frecuencia | null) {
  return llamar({ keyword_id: keywordId, frecuencia })
}

export function probarAviso(keywordId: string) {
  return llamar({ keyword_id: keywordId, accion: "probar" })
}

/** Opciones de frecuencia como radios; `null` = no recibir correos. */
export function OpcionesAviso({
  valor, onChange, conNinguno = false, name,
}: { valor: Frecuencia | null; onChange: (f: Frecuencia | null) => void; conNinguno?: boolean; name: string }) {
  const opciones: (Frecuencia | null)[] = conNinguno ? [null, ...FRECUENCIAS] : [...FRECUENCIAS]
  return (
    <div className="space-y-1.5">
      {opciones.map((f) => {
        const activo = valor === f
        return (
          <label
            key={f ?? "ninguno"}
            className={`flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2 text-sm transition ${
              activo ? "border-rpp-teal bg-teal-50/60" : "border-gray-200 hover:bg-gray-50"
            }`}
          >
            <input
              type="radio"
              name={name}
              checked={activo}
              onChange={() => onChange(f)}
              className="mt-0.5 accent-[#0D9488]"
            />
            <span className="min-w-0">
              <span className="block font-medium text-gray-800">{f ? FRECUENCIA_INFO[f].label : "No enviarme correos"}</span>
              {f && <span className="block text-xs text-gray-500">{FRECUENCIA_INFO[f].detalle}</span>}
            </span>
          </label>
        )
      })}
    </div>
  )
}

export function AvisoCorreoDialog({
  keywordId, nombre, actual, correo, onClose, onSaved,
}: {
  keywordId: string
  nombre: string
  actual: Frecuencia | null
  correo: string | null
  onClose: () => void
  onSaved: (f: Frecuencia | null) => void
}) {
  const [valor, setValor] = useState<Frecuencia | null>(actual ?? "inmediato")
  const [ocupado, setOcupado] = useState<"guardar" | "quitar" | "probar" | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [nota, setNota] = useState<string | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  async function guardar(f: Frecuencia | null, cual: "guardar" | "quitar") {
    setOcupado(cual); setError(null); setNota(null)
    const r = await guardarAviso(keywordId, f)
    setOcupado(null)
    if (!r.ok) { setError(r.error ?? "No se pudo guardar."); return }
    onSaved(f)
    onClose()
  }

  async function probar() {
    setOcupado("probar"); setError(null); setNota(null)
    const r = await probarAviso(keywordId)
    setOcupado(null)
    if (!r.ok) { setError(r.error ?? "No se pudo enviar la muestra."); return }
    setNota(r.enviado ? `Listo: te enviamos una muestra a ${r.para ?? correo ?? "tu correo"}.` : (r.nota ?? "No hay nada que mostrar todavía."))
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
      role="dialog"
      aria-modal="true"
      aria-label={`Avisos por correo de ${nombre}`}
    >
      <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Avisos por correo</p>
            <p className="truncate text-base font-bold text-gray-900" title={nombre}>{nombre}</p>
          </div>
          <button onClick={onClose} aria-label="Cerrar" className="text-xl leading-none text-gray-400 hover:text-gray-600">×</button>
        </div>

        <p className="mt-2 text-sm text-gray-600">
          Te llegan a <b className="text-gray-800">{correo ?? "tu correo de RPP"}</b> las publicaciones nuevas que
          el radar encuentre sobre este tema. Solo tú ves y cambias tus avisos.
        </p>

        <div className="mt-4">
          <OpcionesAviso valor={valor} onChange={setValor} name={`aviso-${keywordId}`} />
        </div>

        {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        {nota && <p className="mt-3 rounded-lg bg-teal-50 px-3 py-2 text-sm text-teal-800">{nota}</p>}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            onClick={() => guardar(valor, "guardar")}
            disabled={!valor || ocupado !== null || valor === actual}
            className="rounded-lg bg-rpp-teal px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-40"
          >
            {ocupado === "guardar" ? "Guardando…" : actual ? "Guardar cambio" : "Activar avisos"}
          </button>
          {actual && (
            <button
              onClick={() => guardar(null, "quitar")}
              disabled={ocupado !== null}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-600 transition hover:bg-gray-50 disabled:opacity-40"
            >
              {ocupado === "quitar" ? "Quitando…" : "Dejar de recibir"}
            </button>
          )}
          <button
            onClick={probar}
            disabled={ocupado !== null}
            className="ml-auto text-xs font-medium text-rpp-teal hover:underline disabled:opacity-40"
          >
            {ocupado === "probar" ? "Enviando…" : "Enviarme una muestra"}
          </button>
        </div>
      </div>
    </div>
  )
}
