"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { usePathname } from "next/navigation"
import { getSession } from "next-auth/react"
import { pillClasses } from "./ui/Pill"
import { RESTRICTED_ROUTES, canAccessPath } from "@/lib/access"

const NAV_ITEMS = [
  { href: "/",                label: "Resumen" },
  { href: "/recomendaciones", label: "Recomendaciones" },
  { href: "/trends",          label: "Tendencias" },
  { href: "/competencia",     label: "Competencia" },
  { href: "/trafico",         label: "Tráfico" },
  { href: "/busqueda",        label: "Búsqueda & Discover" },
  { href: "/auditoria",       label: "Auditoría" },
  { href: "/alertas",         label: "Alertas" },
  { href: "/radar",           label: "Radar de temas" },
  { href: "/admin",           label: "Admin" },
  // "/status" no va en el menú: se llega desde el módulo "Estado del agente" del Resumen.
]

const esRestringida = (href: string) => RESTRICTED_ROUTES.some((r) => r.prefix === href)

export function NavPills() {
  const pathname = usePathname()

  // Las pestañas restringidas arrancan OCULTAS y aparecen cuando la sesión
  // confirma el correo: así quien no tiene permiso nunca las ve parpadear. La
  // sesión se lee en el navegador para no romper el ISR (ver UserMenu).
  const [email, setEmail] = useState<string | null>(null)
  useEffect(() => {
    getSession().then((s) => setEmail(s?.user?.email ?? null)).catch(() => {})
  }, [])

  const items = NAV_ITEMS.filter((item) => !esRestringida(item.href) || (email && canAccessPath(item.href, email)))

  return (
    <div className="flex items-center gap-1 w-max">
      {items.map((item) => {
        const active = item.href === "/" ? pathname === "/" : !!pathname?.startsWith(item.href)
        return (
          <Link key={item.href} href={item.href} className={pillClasses("nav", active, "whitespace-nowrap")}>
            {item.label}
          </Link>
        )
      })}
    </div>
  )
}
