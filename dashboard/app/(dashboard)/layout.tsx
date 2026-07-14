import Image from "next/image"
import Link from "next/link"
import { NavPills } from "@/components/NavPills"

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Cabecera amarilla en dos niveles: marca arriba, navegación abajo.
          La fila de navegación scrollea horizontal en pantallas angostas en
          vez de partirse en varias líneas. */}
      <nav className="bg-rpp-yellow sticky top-0 z-10 shadow-[0_1px_0_rgba(17,24,39,0.08)]">
        <div className="max-w-screen-xl mx-auto px-4">
          <div className="flex items-center justify-between gap-3 pt-3">
            <Link href="/" className="flex items-center gap-3 min-w-0">
              <Image
                src="/rpp-logo.png"
                alt="RPP"
                width={40}
                height={40}
                priority
                className="h-10 w-10 rounded-full ring-2 ring-white shadow-sm shrink-0"
              />
              <span className="leading-tight min-w-0">
                <span className="block font-extrabold text-rpp-ink text-lg tracking-tight truncate">
                  SEO Agent
                </span>
                <span className="block text-[11px] font-semibold uppercase tracking-widest text-rpp-ink/60">
                  RPP Noticias
                </span>
              </span>
            </Link>
            <span className="hidden sm:inline-flex items-center rounded-full bg-white/80 border border-rpp-ink/10 px-3 py-1 text-xs font-semibold text-rpp-ink/80 shrink-0">
              Agente SEO · 2026
            </span>
          </div>
          <div className="overflow-x-auto py-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <NavPills />
          </div>
        </div>
      </nav>

      {/* Contenido */}
      <main className="max-w-screen-xl mx-auto px-4 py-6">{children}</main>
    </div>
  )
}
