import { createClient } from "@supabase/supabase-js"

/**
 * Cliente de lectura del dashboard (anon key).
 *
 * Todas sus consultas van con `cache: "no-store"`. Sin eso Next 14 guarda cada
 * fetch en su Data Cache y la página en la caché ISR, y con el poco tráfico de
 * este panel (3-6 personas) eso significaba datos VIEJOS: una página ISR solo
 * se regenera cuando alguien la pide, y a ese primer visitante le entrega la
 * copia anterior. Medido el 2026-10-12: tras varios días sin visitas, /alertas
 * y /busqueda mostraban datos de días atrás y /radar salía vacío (sus
 * hallazgos congelados quedaban fuera de la ventana de 48 h), con la base al
 * día. Las páginas van además con `dynamic = "force-dynamic"`.
 */
export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  {
    global: { fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }) },
  }
)
