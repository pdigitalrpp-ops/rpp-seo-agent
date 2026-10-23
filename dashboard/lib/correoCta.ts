/**
 * Enlaces al panel en TODOS los correos del agente (2026-10-20): pedido del
 * usuario para cerrar el círculo correo → panel. Cada correo lleva un enlace
 * arriba (en la cabecera amarilla) y un bloque al final con el botón y las
 * otras pestañas para explorar.
 *
 * Los enlaces llevan `?desde=correo-<tipo>`: PageViewTracker lo manda a
 * /api/visita y queda en `dashboard_page_views.via`, así /admin mide cuántas
 * visitas trae cada correo. Si la persona no tiene sesión, el login conserva
 * la URL completa (callbackUrl) y la visita se cuenta al volver.
 *
 * HTML con estilos en línea y el botón como tabla: Outlook ignora <style> y
 * no respeta padding en un <a>.
 */

export const PANEL = "https://rpp-seo-agent.vercel.app"

export type OrigenCorreo = "resumen" | "alertas" | "tendencias" | "trafico" | "temas"

/** Pestañas que se ofrecen para explorar. Sin las restringidas (Búsqueda, Auditoría, Admin). */
const PESTANAS: { path: string; label: string; que: string }[] = [
  { path: "/",                label: "Resumen",         que: "el día de un vistazo" },
  { path: "/recomendaciones", label: "Recomendaciones", que: "qué publicar ahora" },
  { path: "/trends",          label: "Tendencias",      que: "lo más buscado en Perú" },
  { path: "/competencia",     label: "Competencia",     que: "qué publicó cada medio" },
  { path: "/trafico",         label: "Tráfico",         que: "notas y canales de ayer" },
  { path: "/alertas",         label: "Alertas",         que: "hechos que RPP aún no tiene" },
  { path: "/radar",           label: "Radar de temas",  que: "tus temas vigilados" },
]

/** Pestaña principal de cada correo: a dónde lleva el botón. */
const DESTINO: Record<OrigenCorreo, string> = {
  resumen: "/", alertas: "/alertas", tendencias: "/trends", trafico: "/trafico", temas: "/radar",
}

const esc = (v: string) =>
  v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

/** URL del panel marcada con el correo de origen. */
export function urlPanel(path: string, origen: OrigenCorreo): string {
  return `${PANEL}${path}?desde=correo-${origen}`
}

/** Enlace corto para la cabecera amarilla. */
export function enlaceCabecera(origen: OrigenCorreo): string {
  return `<a href="${esc(urlPanel(DESTINO[origen], origen))}" style="color:#111827;font-weight:700;text-decoration:underline">Abrir en el SEO Agent →</a>`
}

/** Bloque final: botón a la pestaña del correo y el resto de indicadores. */
export function bloquePanel(origen: OrigenCorreo): string {
  const destino = DESTINO[origen]
  const principal = PESTANAS.filter((p) => p.path === destino)[0]
  const otras = PESTANAS.filter((p) => p.path !== destino)
  const boton = `
    <table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:10px 0 0">
      <tr><td style="background:#0D9488;border-radius:8px">
        <a href="${esc(urlPanel(destino, origen))}" style="display:inline-block;padding:10px 18px;color:#ffffff;font-weight:700;font-size:14px;text-decoration:none">
          Ver ${esc(principal ? principal.label : "el panel")} en el SEO Agent →
        </a>
      </td></tr>
    </table>`
  const lista = otras.map((p) =>
    `<a href="${esc(urlPanel(p.path, origen))}" style="color:#0D9488;text-decoration:none;font-weight:700">${esc(p.label)}</a>` +
    `<span style="color:#6b7280"> · ${esc(p.que)}</span>`).join("<br>")
  return `
    <div style="margin:24px 0 0;padding:14px 16px;background:#F0FDFA;border:1px solid #99F6E4;border-radius:10px">
      <div style="font-size:15px;font-weight:800;color:#111827">Hay más en el SEO Agent</div>
      <div style="font-size:13px;color:#374151;margin-top:2px">Este correo es un resumen: en el panel están los datos completos, con filtros e historial.</div>
      ${boton}
      <div style="font-size:13px;line-height:1.7;margin-top:12px">${lista}</div>
    </div>`
}

/** Versión de texto plano para el final del correo. */
export function textoPanel(origen: OrigenCorreo): string {
  return `Más indicadores en el SEO Agent: ${urlPanel(DESTINO[origen], origen)}`
}
