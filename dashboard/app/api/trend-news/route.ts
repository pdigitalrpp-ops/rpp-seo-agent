import { NextRequest, NextResponse } from "next/server"

/**
 * Noticias de Google News para una keyword — fallback en vivo del panel
 * "Por qué es tendencia" (/trends). El radar guarda `news` en daily_trends,
 * pero las tendencias recolectadas antes de este feature (o si el RSS falló
 * en esa corrida) no lo traen: este endpoint las cubre consultando el RSS de
 * búsqueda de Google News desde el server de Vercel (CORS impide hacerlo
 * desde el navegador).
 */

export const revalidate = 900 // 15 min: las noticias de una tendencia no cambian más rápido

type NewsItem = {
  title: string
  source: string
  source_url: string
  url: string
  published_at: string
}

const decodeEntities = (s: string) =>
  s
    .replace(/<!\[CDATA\[(.*?)\]\]>/gs, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .trim()

const tag = (block: string, name: string) => {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`))
  return m ? decodeEntities(m[1]) : ""
}

export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim()
  if (!q || q.length > 120) {
    return NextResponse.json({ error: "q requerido" }, { status: 400 })
  }

  const url =
    `https://news.google.com/rss/search?q=${encodeURIComponent(q)}+when:2d` +
    `&hl=es-419&gl=PE&ceid=PE:es-419`

  try {
    const res = await fetch(url, { next: { revalidate: 900 } })
    if (!res.ok) {
      return NextResponse.json({ items: [] as NewsItem[] })
    }
    const xml = await res.text()

    const items: NewsItem[] = []
    for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
      const block = m[1]
      let title = tag(block, "title")
      if (!title) continue
      const source = tag(block, "source")
      const sourceUrl = decodeEntities(block.match(/<source url="([^"]*)"/)?.[1] ?? "")
      // Google News formatea "Titular - Medio"; se limpia el sufijo repetido
      if (source && title.endsWith(` - ${source}`)) {
        title = title.slice(0, -(source.length + 3)).trim()
      }
      items.push({
        title,
        source,
        source_url: sourceUrl,
        url: tag(block, "link"),
        published_at: tag(block, "pubDate"),
      })
      if (items.length >= 5) break
    }

    return NextResponse.json({ items })
  } catch {
    return NextResponse.json({ items: [] as NewsItem[] })
  }
}
