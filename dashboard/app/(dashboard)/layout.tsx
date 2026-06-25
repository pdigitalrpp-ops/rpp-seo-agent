import Link from "next/link"

const NAV_ITEMS = [
  { href: "/",                label: "Resumen" },
  { href: "/recomendaciones", label: "Recomendaciones" },
  { href: "/trends",          label: "Tendencias" },
  { href: "/competencia",     label: "Competencia" },
  { href: "/trafico",         label: "Tráfico" },
  { href: "/search-console",  label: "Search Console" },
  { href: "/auditoria",       label: "Auditoría" },
  { href: "/alertas",         label: "Alertas" },
]

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Navbar */}
      <nav className="bg-white border-b sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 flex items-center gap-6 h-14">
          <div className="flex items-center gap-2 mr-4">
            <div className="w-6 h-6 bg-red-600 rounded" />
            <span className="font-bold text-gray-800 text-sm">RPP SEO</span>
          </div>
          {NAV_ITEMS.map(item => (
            <Link
              key={item.href}
              href={item.href}
              className="text-sm text-gray-600 hover:text-red-600 font-medium transition-colors"
            >
              {item.label}
            </Link>
          ))}
        </div>
      </nav>

      {/* Contenido */}
      <main className="max-w-7xl mx-auto px-4 py-6">{children}</main>
    </div>
  )
}
