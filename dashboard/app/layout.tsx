import type { Metadata } from "next"
import "./globals.css"

export const metadata: Metadata = {
  title: "RPP SEO Dashboard",
  description: "Agente SEO de contenidos para RPP Noticias",
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  )
}
