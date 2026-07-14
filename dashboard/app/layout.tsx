import type { Metadata } from "next"
import { Inter } from "next/font/google"
import "./globals.css"

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" })

export const metadata: Metadata = {
  title: "RPP SEO Dashboard",
  description: "Agente SEO de contenidos para RPP Noticias",
  icons: { icon: "/rpp-logo.png" },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={inter.variable}>
      <body className="font-sans antialiased bg-gray-50 text-gray-900">{children}</body>
    </html>
  )
}
