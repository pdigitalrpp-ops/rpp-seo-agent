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
