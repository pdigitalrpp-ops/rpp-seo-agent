/**
 * Fechas del dashboard — fuente única.
 *
 * POR QUÉ EXISTE
 * --------------
 * Los Server Components se renderizan en el runtime de Vercel, que corre en
 * **UTC**. El agente, en cambio, escribe sus fechas bajo `TZ: America/Lima`
 * (así está el workflow), o sea `date.today()` = día de Lima.
 *
 * Con `new Date().toISOString().split("T")[0]` el dashboard preguntaba por el
 * día UTC. Lima es UTC-5, así que **de 19:00 a 23:59 hora de Lima el dashboard
 * pedía el día SIGUIENTE**, que todavía no existe en la base: cinco horas cada
 * noche con Resumen, Recomendaciones, Tendencias y Competencia en blanco.
 * Medido en producción el 2026-08-21 a las 21:23 de Lima — 4 de 5 páginas
 * vacías.
 *
 * No es un problema de "mostrar la hora bonita" (eso ya estaba resuelto con
 * `timeZone` en los toLocale*), sino de con qué CLAVE se consulta la base.
 * Cualquier página que filtre por una columna `date` escrita por el agente
 * tiene que usar esto y no `toISOString()`.
 */

export const TZ_LIMA = "America/Lima"

/** Día de HOY en Lima, en formato YYYY-MM-DD (el que usa la DB). */
export function todayInLima(): string {
  // en-CA da directamente ISO (YYYY-MM-DD), que es lo que espera Postgres.
  return new Date().toLocaleDateString("en-CA", { timeZone: TZ_LIMA })
}

/** Día de Lima correspondiente a un instante dado, en YYYY-MM-DD. */
export function limaDayOf(when: Date | number): string {
  return new Date(when).toLocaleDateString("en-CA", { timeZone: TZ_LIMA })
}

/**
 * Hora de Lima (0-23) de un instante. Se usa para la ventana activa del radar:
 * el agente descansa de madrugada y esa pausa debe respetarse aunque el cron
 * que lo dispara viva fuera (cron-job.org), que puede quedar mal configurado.
 */
export function limaHour(when: Date | number = new Date()): number {
  const h = Number(
    new Date(when).toLocaleString("en-US", {
      timeZone: TZ_LIMA, hour: "2-digit", hour12: false,
    })
  )
  // `hour12: false` en en-US devuelve "24" a medianoche en varias versiones de
  // Node en vez de "00". Sin esta línea, la medianoche de Lima quedaba fuera de
  // cualquier comparación por rango.
  return h === 24 ? 0 : h
}

/** Ventana activa del radar: 05:00–23:59 hora de Lima. */
export const RADAR_HOUR_FROM = 5
export const RADAR_HOUR_TO = 24
export function dentroDeVentanaRadar(when: Date | number = new Date()): boolean {
  const h = limaHour(when)
  return h >= RADAR_HOUR_FROM && h < RADAR_HOUR_TO
}
