/**
 * Frecuencias de los avisos por correo de los temas del Radar. Sin imports de
 * servidor: lo usan el panel (navegador), la ruta que guarda la suscripción y
 * /api/notificar, que es quien envía (lib/temasCorreo.ts).
 */

export const FRECUENCIAS = ["inmediato", "horarios", "diario"] as const
export type Frecuencia = typeof FRECUENCIAS[number]

/** Envíos "por horarios", hora de Lima: inicio del día, mediodía y cierre. */
export const HORARIOS_TEMAS = [8, 13, 18]
/** Hora del envío diario, con lo encontrado en las 24 h anteriores. */
export const HORA_DIARIO_TEMAS = 8

export const FRECUENCIA_INFO: Record<Frecuencia, { label: string; corto: string; detalle: string }> = {
  inmediato: {
    label: "Apenas se publique",
    corto: "al momento",
    detalle: "Un correo en cuanto el radar encuentra algo nuevo: el radar revisa cada ~15 min y el correo sale a los pocos minutos.",
  },
  horarios: {
    label: "Por horarios: 08:00, 13:00 y 18:00",
    corto: "08:00 · 13:00 · 18:00",
    detalle: "Al iniciar el día, al mediodía y al cierre, con lo encontrado desde el envío anterior. Si no hubo nada, no llega correo.",
  },
  diario: {
    label: "Uno al día, a las 08:00",
    corto: "1 al día",
    detalle: "Un solo correo a las 08:00 con todo lo encontrado en las 24 horas anteriores. Si no hubo nada, no llega correo.",
  },
}

export function esFrecuencia(v: unknown): v is Frecuencia {
  return typeof v === "string" && (FRECUENCIAS as readonly string[]).indexOf(v) >= 0
}
