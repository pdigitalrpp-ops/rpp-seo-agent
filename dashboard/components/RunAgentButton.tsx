"use client"

import { useState } from "react"

type Status = "idle" | "loading" | "started" | "error"

/**
 * Botón "Actualizar ahora": dispara el radar vía /api/run-agent.
 * La corrida tarda ~5-10 min; el botón queda deshabilitado tras iniciarla
 * para no acumular disparos (el endpoint además tiene cooldown de 30 min).
 */
export function RunAgentButton() {
  const [status, setStatus] = useState<Status>("idle")
  const [message, setMessage] = useState("")

  async function handleClick() {
    setStatus("loading")
    setMessage("")
    try {
      const res = await fetch("/api/run-agent", { method: "POST" })
      const body = await res.json()
      if (res.ok) {
        setStatus("started")
        setMessage(body.message)
      } else {
        setStatus("error")
        setMessage(body.error ?? "No se pudo iniciar la actualización.")
      }
    } catch {
      setStatus("error")
      setMessage("Error de conexión. Intenta de nuevo.")
    }
  }

  const disabled = status === "loading" || status === "started"

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={handleClick}
        disabled={disabled}
        className={`inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-semibold transition-colors ${
          disabled
            ? "bg-gray-100 text-gray-400 cursor-not-allowed"
            : "bg-rpp-teal text-white hover:bg-teal-700"
        }`}
      >
        {status === "loading" && "Iniciando…"}
        {status === "started" && "🔄 Actualizando (~5-10 min)"}
        {(status === "idle" || status === "error") && "⚡ Actualizar ahora"}
      </button>
      {message && (
        <p className={`text-xs max-w-64 text-right ${status === "error" ? "text-red-600" : "text-gray-500"}`}>
          {message}
        </p>
      )}
    </div>
  )
}
