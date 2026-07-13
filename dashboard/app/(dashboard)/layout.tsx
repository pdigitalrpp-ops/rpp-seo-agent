import { NavPills } from "@/components/NavPills"

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Navbar */}
      <nav className="bg-rpp-yellow sticky top-0 z-10">
        <div className="max-w-screen-xl mx-auto px-4 flex items-center gap-4 min-h-[4rem] flex-wrap py-2">
          <div className="flex items-center gap-2 mr-2 shrink-0">
            <span className="font-extrabold text-rpp-ink text-base">RPP SEO</span>
            <span className="hidden sm:inline-flex items-center rounded-full bg-white border border-rpp-ink/10 px-3 py-1 text-xs font-semibold text-rpp-ink/80">
              Agente SEO 2026
            </span>
          </div>
          <NavPills />
        </div>
      </nav>

      {/* Contenido */}
      <main className="max-w-screen-xl mx-auto px-4 py-6">{children}</main>
    </div>
  )
}
