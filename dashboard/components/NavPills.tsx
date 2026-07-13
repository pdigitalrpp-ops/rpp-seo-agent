"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { pillClasses } from "./ui/Pill"

const NAV_ITEMS = [
  { href: "/",                label: "Resumen" },
  { href: "/recomendaciones", label: "Recomendaciones" },
  { href: "/trends",          label: "Tendencias" },
  { href: "/competencia",     label: "Competencia" },
  { href: "/trafico",         label: "Tráfico" },
  { href: "/busqueda",        label: "Búsqueda & Discover" },
  { href: "/auditoria",       label: "Auditoría" },
  { href: "/alertas",         label: "Alertas" },
  { href: "/status",          label: "Estado" },
]

export function NavPills() {
  const pathname = usePathname()

  return (
    <div className="flex items-center gap-1 flex-wrap">
      {NAV_ITEMS.map((item) => {
        const active = item.href === "/" ? pathname === "/" : !!pathname?.startsWith(item.href)
        return (
          <Link key={item.href} href={item.href} className={pillClasses("nav", active)}>
            {item.label}
          </Link>
        )
      })}
    </div>
  )
}
