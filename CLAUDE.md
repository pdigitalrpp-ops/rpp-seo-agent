# RPP SEO Agent — Contexto para Claude Code

> **⚠️ ACTUALIZACIÓN v2 (2026-06-24):** el core fue replanteado a un agente de
> **3 etapas** (benchmark de la mañana → radar en tiempo real → alertas por
> sección) + **auditoría SEO on-page** de notas publicadas. **Marfeel reemplaza
> a GA4.** `run.py` se partió en `run_morning.py` (Etapa 1) y `run_radar.py`
> (Etapas 2-3). Las "secciones" reemplazan a los "programas" y salen de la
> dimensión `section` de Marfeel. Parte de las secciones de abajo describen el
> diseño v1 y están desactualizadas — la fuente de verdad del diseño v2 está en
> la memoria del proyecto (`diseno_core_agente_v2.md`).

## Qué es este proyecto

Agente SEO de contenidos para RPP Noticias. Corre automáticamente cada mañana a las **06:00 AM Lima (11:00 UTC)** vía GitHub Actions, recopila señales de 5 fuentes, las analiza y genera recomendaciones editoriales que aparecen en un dashboard web.

**Stack:** Python 3.11 + GitHub Actions + Supabase + Next.js 14 en Vercel  
**Costo:** $0/mes (todos los servicios en free tier)

---

## Estado actual del proyecto

**Fecha último avance:** 2026-06-04  
**Estado:** Código 100% completo y committeado en git local. Pendiente: subir a GitHub y configurar credenciales de servicios externos.

### Archivos creados (39 archivos, ~2800 líneas)

```
rpp-seo-agent/
├── .github/workflows/daily.yml         ← cron GitHub Actions
├── agent/
│   ├── config.py                       ← configuración central (sitios, categorías, umbrales)
│   ├── run.py                          ← orquestador principal
│   ├── collectors/
│   │   ├── ga4.py                      ← Google Analytics 4 (tráfico, patrones horarios)
│   │   ├── gsc.py                      ← Google Search Console (posiciones, CTR, drops)
│   │   ├── trends.py                   ← Google Trends Perú (tendencias + growth score)
│   │   ├── competitors.py              ← RSS/sitemap de 5 competidores
│   │   └── serpapi.py                  ← rankings y SERP features (cuota: 15 calls/día)
│   ├── analyzers/
│   │   ├── scoring.py                  ← score 0-10 por tema, urgencia, formato, programa
│   │   ├── opportunities.py            ← quick wins GSC, CTR bajo, recomendaciones finales
│   │   ├── decay.py                    ← content decay vs pico histórico (umbral 20%)
│   │   └── signals.py                  ← early signals, cross-reference, ventanas de publicación
│   ├── writers/supabase_writer.py      ← guarda en todas las tablas de Supabase
│   └── db/schema.sql                   ← 9 tablas con RLS, índices, políticas de lectura pública
├── dashboard/
│   ├── app/(auth)/login/page.tsx       ← login con NextAuth (3 roles)
│   ├── app/(dashboard)/
│   │   ├── layout.tsx                  ← nav lateral con 7 secciones
│   │   ├── page.tsx                    ← resumen ejecutivo del día
│   │   ├── recomendaciones/page.tsx    ← top 5 temas con score, ángulo, ventana
│   │   ├── trends/page.tsx             ← tendencias Google Trends Perú
│   │   ├── competencia/page.tsx        ← artículos de 5 competidores agrupados por sitio
│   │   ├── trafico/page.tsx            ← top artículos GA4 + distribución por canal
│   │   ├── search-console/page.tsx     ← quick wins + low CTR + top queries
│   │   └── alertas/page.tsx            ← alertas activas + content decay
│   ├── app/api/auth/[...nextauth]/route.ts
│   ├── lib/supabase.ts
│   ├── package.json                    ← next@14.1, next-auth, recharts, supabase-js
│   └── [tailwind, tsconfig, postcss, next.config.js]
├── requirements.txt
├── .env.example
└── .gitignore
```

---

## Decisiones de diseño importantes

### Python / Agente

- **`safe_collect(name, func, run_data, **kwargs)`** — patrón estándar para todos los colectores; nunca bloquea el pipeline si falla una fuente. Los fallos se loggean y van a `sources_failed` en Supabase.
- **Google Trends** usa `pytrends` con `@retry(stop_after_attempt(3), wait_exponential(min=60, max=180))` — es propenso a 429. Los sleeps de 2-5s entre llamadas son intencionales.
- **GSC** tiene latencia de ~2 días. Siempre usar `days_back >= 3`. El parámetro `dataState: "all"` incluye datos frescos no consolidados.
- **SerpAPI** limitado a 15 llamadas/día (`SERPAPI_DAILY_LIMIT`). El contador `_call_count` es un módulo-global; se resetea con cada ejecución del agente.
- **Content decay** compara el tráfico actual vs promedio de los 30 días de mayor tráfico histórico (leídos de Supabase, no de GA4). El primer mes de operación no habrá datos históricos suficientes → normal que decay esté vacío.
- **Scoring** funciona en 5 dimensiones: growth score (0-3 pts), cobertura competidores (0-2), relevancia RPP (0-2), potencial Discover (0-2), urgencia temporal (0-1). Máximo 10.

### Dashboard Next.js

- **App Router** con React Server Components. Todas las páginas usan `export const revalidate = 3600` (1h ISR).
- **Supabase anon key** en el cliente — las tablas solo tienen política `SELECT USING (true)`. El agente Python usa `service_role key` para escritura.
- **NextAuth** con `CredentialsProvider`. 3 usuarios hardcodeados en `route.ts`, contraseñas en variables de entorno de Vercel.
- No hay estado global ni Context. Cada página hace sus propias queries a Supabase en el servidor.

---

## Competidores monitoreados

| Nombre | RSS |
|--------|-----|
| El Comercio | https://elcomercio.pe/arcio/rss/ |
| La República | https://larepublica.pe/arcio/rss/ |
| Gestión | https://gestion.pe/arcio/rss/ |
| Peru21 | https://peru21.pe/arcio/rss/ |
| Infobae Perú | https://www.infobae.com/feeds/rss/peru/ |

Si un RSS falla, `_parse_sitemap()` intenta el `sitemap-news.xml` del dominio como fallback.

---

## Tablas Supabase

| Tabla | Escribe | Lee |
|-------|---------|-----|
| `daily_trends` | agente Python | dashboard trends |
| `gsc_daily` | agente Python | dashboard search-console |
| `own_traffic` | agente Python | dashboard trafico, decay |
| `competitor_articles` | agente Python (upsert por URL) | dashboard competencia |
| `recommendations` | agente (borra y reinserta por fecha) | dashboard recomendaciones, home |
| `alerts` | agente Python | dashboard alertas |
| `content_decay` | agente (upsert por page_path) | dashboard alertas |
| `publishing_windows` | agente (upsert por fecha) | dashboard home |
| `agent_runs` | agente Python | dashboard home (semáforo) |

---

## Variables de entorno

### Agente Python (GitHub Secrets)
```
MARFEEL_EMAIL          → pdigitalrpp@gmail.com (usuario con API role)   [✅ configurado]
MARFEEL_PASSWORD       → password de API de Marfeel                     [✅ configurado]
GSC_CREDENTIALS_JSON   → JSON completo de service account de Google
SERPAPI_KEY            → clave de serpapi.com
SUPABASE_URL           → https://tfrnpjbvxulswvqtosoq.supabase.co
SUPABASE_KEY           → service_role key (NO la anon key)
```

### Dashboard (Vercel)
```
NEXTAUTH_URL           → https://tu-app.vercel.app
NEXTAUTH_SECRET        → openssl rand -base64 32
NEXT_PUBLIC_SUPABASE_URL       → mismo que agente
NEXT_PUBLIC_SUPABASE_ANON_KEY  → anon key (distinta al service_role)
PASS_EDITORIAL         → contraseña para redacción
PASS_DIRECCION         → contraseña para dirección/c-levels
PASS_ADMIN             → contraseña admin
```

---

## Pasos pendientes (requieren credenciales humanas)

### 1. GitHub
```bash
# En el directorio del repo:
git remote add origin https://github.com/TU_ORG/rpp-seo-agent.git
git push -u origin master
```
Luego en GitHub → Settings → Secrets → Actions → añadir los 6 secrets.

### 2. Supabase
1. Crear proyecto en supabase.com
2. Ir a SQL Editor → pegar y ejecutar `agent/db/schema.sql`
3. Copiar URL y service_role key para GitHub Secrets
4. Copiar URL y anon key para Vercel

### 3. Google Service Account
1. Google Cloud Console → crear proyecto o usar el existente de RPP
2. Habilitar: "Google Analytics Data API" y "Google Search Console API"
3. Crear Service Account → descargar JSON de credenciales
4. En GA4: Administrador → Propiedad → Control de acceso → añadir el email de la service account como "Lector"
5. En Search Console: rpp.pe → Configuración → Usuarios y permisos → Añadir usuario (mismo email, permiso Restringido)

### 4. SerpAPI
- Registrar en serpapi.com → free tier incluye 100 búsquedas/mes
- El agente usa máximo 15/día → ~450/mes → excede free tier si corre todos los días
- Considerar reducir `SERPAPI_DAILY_LIMIT` a 10 o usar plan de pago

### 5. Vercel
```bash
cd dashboard
npm install
# Verificar que compila localmente:
npm run build
```
Luego conectar el repo en vercel.com → seleccionar carpeta `dashboard` como root → configurar las 7 variables de entorno.

### 6. Test manual del agente
```bash
cd agent
cp ../.env.example .env
# Rellenar .env con credenciales reales
pip install -r ../requirements.txt
python run.py
```

### 7. Test manual de GitHub Actions
En el repo de GitHub → Actions → "SEO Agent — Daily Run" → "Run workflow"

---

## Flujo de datos completo

```
GitHub Actions (06:00 AM Lima)
    │
    ▼
agent/run.py
    ├── collectors/ga4.py        → sesiones, bounce rate, patrón horario
    ├── collectors/gsc.py        → posiciones, CTR, drops, Discover
    ├── collectors/trends.py     → trending Perú + growth score
    ├── collectors/competitors.py → artículos RSS/sitemap de 5 medios
    └── collectors/serpapi.py    → rankings y PAA
    │
    ▼
analyzers/
    ├── scoring.py      → score 0-10 por tema
    ├── opportunities.py → top 5 recomendaciones + ángulos
    ├── decay.py        → artículos cuyo tráfico cayó >20%
    └── signals.py      → early signals + ventanas óptimas
    │
    ▼
writers/supabase_writer.py → guarda todo en Supabase
    │
    ▼
Dashboard Vercel (Next.js) → 7 páginas con login
```

---

## Contexto RPP

- **SITE_URL:** `https://rpp.pe/`
- **Zona horaria:** America/Lima (UTC-5, sin DST)
- **Programas afines por categoría:**
  - Política → Ampliación de Noticias
  - Economía → Economía al Día
  - Deportes → RPP Deportes
  - Entretenimiento → Trome TV
  - Tecnología → Tech y Más
  - Salud → Vida Saludable
- **Umbral decay:** 20% de caída respecto al pico histórico
- **Umbral alerta GSC:** 30% de caída de clics vs semana anterior
- **Quick wins GSC:** posición 4-10 con ≥200 impresiones
- **Low CTR:** CTR ≤2% con ≥500 impresiones
