# RPP SEO Agent — Contexto para Claude Code

Agente SEO de contenidos para RPP Noticias (rpp.pe). Un agente de **3 etapas**
que recopila señales, las puntúa y genera recomendaciones editoriales en un
dashboard web.

**Stack:** Python 3.11 + GitHub Actions + Supabase + Next.js 14 en Vercel
**Costo:** $0/mes (free tier). Repo público → minutos de Actions ilimitados.

---

## Estado actual

**Fecha último avance:** 2026-08-21

**2026-08-21 — OpenAI pasa a ser el proveedor LLM PREFERIDO (key propia del
usuario); los prompts se unifican en un modulo compartido:** pedido del
usuario: "quiero cambiar la api key del LLM para todas las tareas que pida el
dashboard".
- **Aclaracion que hubo que hacer primero:** el dashboard NO llama al LLM.
  Ninguna de sus 3 rutas API lo hace. Todo el trabajo LLM ocurre en el agente
  Python dentro de GitHub Actions; el dashboard solo LEE de Supabase lo que el
  agente dejo escrito. Su unico vinculo es indirecto: el boton "⚡ Actualizar
  ahora" despacha `radar.yml`, y esa corrida si usa el modelo.
- **`agent/llm/openai_compat.py` (NUEVO) — nucleo compartido.** OpenRouter ya
  hablaba el protocolo de OpenAI, asi que el transporte y los 5 prompts viven
  ahora ahi, y `openrouter.py` / `openai_api.py` son adaptadores de ~40 lineas
  que solo declaran su `Client`. **Motivo concreto, no estetico:** duplicar por
  proveedor YA fallo — `bedrock.py` y `gemini.py` se quedaron con 2 de las 5
  tareas porque vigencia, explicacion de tendencias y cobertura solo se
  escribieron en `openrouter.py`. Con el nucleo compartido, OpenAI nace con las
  5 completas.
- **VERIFICADO con test offline** (scratchpad `test_llm_refactor.py`): para las
  5 tareas, con las mismas entradas, el `(system, prompt, max_tokens)` que
  genera el codigo nuevo es IDENTICO al del codigo viejo en HEAD, y el parseo
  de una respuesta simulada devuelve lo mismo. Era la condicion para no perder
  la calibracion contra produccion. Segundo test (`test_provider_chain.py`):
  7 escenarios de seleccion de proveedor + la auto-adaptacion ante un 400.
- **Diferencias reales entre los dos clientes** (por eso el `Client` se
  parametriza y no se comparte tal cual): (a) `reasoning: {effort, exclude}` es
  una EXTENSION de OpenRouter — mandarselo a la API de OpenAI da 400, asi que
  viaja en `extra_body` solo del cliente de OpenRouter; (b) `response_format:
  json_object` se activa SOLO en OpenAI (`json_mode=True`), donde esta
  garantizado — en OpenRouter el router puede caer en cualquier modelo del
  catalogo y no se puede asumir; (c) los headers HTTP-Referer/X-Title son solo
  para el ranking de apps de OpenRouter.
- **Auto-adaptacion ante 400 por parametro no soportado** (`_adapt_to_400`):
  los modelos de razonamiento de OpenAI rechazan `max_tokens` (piden
  `max_completion_tokens`) y `temperature` != 1. En vez de fallar en silencio
  —que en este proyecto significa TODA la categorizacion en null sin que nadie
  se entere hasta el dia siguiente, ya paso dos veces— se detecta el 400, se
  corrige el body y se reintenta UNA vez; el ajuste queda pegado al cliente,
  asi que solo se paga en la primera llamada de la corrida. Un 400 por otra
  causa (key mala) NO se toca: enmascararia el error real.
- **`LLM_PROVIDER` (env, NUEVO):** fuerza un proveedor ignorando el orden
  (`openai|openrouter|bedrock|gemini`). Existe para NO tener que borrar
  secretos: con las dos keys conviviendo, volver atras es cambiar una variable.
  Si apunta a un proveedor sin credenciales, avisa y cae al orden por defecto
  (quedarse sin LLM por un secreto mal puesto seria peor).
- **Orden nuevo:** OpenAI > OpenRouter > Bedrock > Gemini > reglas.
- **MODELO: `gpt-5.6-luna` por default (decision de costo, no de capacidad).**
  La familia GPT-5.6 son tres modelos de RAZONAMIENTO con el mismo contexto
  (1.05M) que solo se diferencian en precio por millon de tokens
  entrada/salida: **sol $5/$30 · terra $2/$12 · luna $0.20/$1.20**. El
  usuario pidio terra; se recomendo luna y quedo luna. Razon: el costo lo
  domina `categorize_articles` (~470 titulares/corrida = ~12 de las ~17
  llamadas) y es meter titulares en 8 cajas — la tarea mas facil de las
  cinco; las otras son extraccion/clasificacion con prompts ya calibrados,
  no razonamiento frontera. **Estimado** (~15k tokens entrada + ~25k salida
  por corrida, con los de razonamiento facturados como SALIDA): a la cadencia
  REAL re-medida el 2026-08-21 (**32 corridas/dia**, no las 4-6 que decia este
  archivo desde julio) terra saldria ~$330/mes y luna ~$33/mes. El proyecto
  figura como $0/mes. **No verificado contra facturacion real** — revisar
  los primeros dias. Si una tarea decepciona, subir SOLO esa a terra
  (hoy el modelo es por proveedor; por tarea son pocas lineas).
- **Los tres cambian el contrato de Chat Completions** y por eso hubo que
  tocar el cliente: exigen `max_completion_tokens` (no `max_tokens`),
  **rechazan `temperature`** y aceptan `reasoning_effort`
  (none|low|medium|high|xhigh|max, default medium). `openai_api._is_reasoning`
  lo detecta por prefijo del nombre (`gpt-5`, `o1`, `o3`, `o4`) y configura
  el Client de ENTRADA — `_adapt_to_400` queda como red para modelos cuyo
  prefijo no conozcamos, no como via normal (gastaria una llamada fallida
  por corrida).
- **`OPENAI_REASONING_EFFORT=low` a proposito:** los tokens de razonamiento
  se facturan como salida (la parte cara) Y salen del MISMO presupuesto que
  la respuesta — razonar de mas puede agotarlo antes de escribir el JSON,
  que es EXACTAMENTE como se cayo la categorizacion con Tencent Hy3 el
  2026-07-10. Por lo mismo el Client aplica `max_tokens_scale=4.0` a los
  topes de las tareas (4000-6000, calibrados para un modelo que no piensa):
  se factura lo GENERADO, no lo reservado, asi que la holgura no cuesta.
- **OJO al escribir el parametro:** OpenRouter usa el objeto anidado
  `reasoning: {effort, exclude}` y OpenAI el campo plano `reasoning_effort`.
  Cruzarlos da 400. Hay test que lo cubre.
- Timeout 60s (vs 30s de OpenRouter).
- **El log de arranque ahora dice CUAL manda,** no solo que credenciales
  llegaron: `llm.describe_providers()` (antes el bloque estaba duplicado a mano
  en los dos orquestadores). Con dos proveedores plausibles conviviendo, saber
  cual se esta usando de verdad es justo el dato que falta cuando algo sale
  null.
- **GOTCHA DE RED, medido hoy:** `api.openai.com` esta **igual de bloqueado que
  openrouter.ai** desde la red corporativa de Grupo RPP (ConnectionError sin
  credenciales, o sea ni siquiera resuelve/conecta). **No se puede validar la
  key desde una maquina de RPP** — la verificacion real es una corrida de
  GitHub Actions, que corre en infraestructura de GitHub sin esa restriccion.
- **VERIFICADO END-TO-END EN PRODUCCION (2026-08-21, corrida #740, workflow_dispatch sobre master 8dd79a6):**
  `🔑 Proveedores LLM detectados: openai=True openrouter=True bedrock=True gemini=False → activo: openai` · `✅ LLM categorizó 237/237 titulares de competencia` · `✅ LLM categorizó 10/10 temas` · `✅ LLM explicó 10/10 tendencias nuevas` · `✅ Radar guardado: 3 recomendaciones, 9 alertas`.
  **Sin un solo 400, sin caída a reglas**: confirma que `gpt-5.6-luna` responde
  por Chat Completions y que `max_completion_tokens` + sin `temperature` +
  `reasoning_effort=low` es la combinación correcta (si hubiera estado mal,
  `_adapt_to_400` habría dejado su INFO en el log — no aparece).
- **LA CORRIDA BAJO DE ~11 MIN A 63 SEGUNDOS** (15:12:50 → 15:13:53). Con el
  router `openrouter/free` cada corrida tardaba ~11 min porque el router
  elegia modelo en cada llamada. Era el argumento principal para salir de ahi,
  aparte de la calidad.
- **CADENCIA REAL DEL CRON, RE-MEDIDA HOY: 32 corridas programadas en 24h**
  (gap mediano 33 min, minimo 16, maximo 304). El dato de "4-6 veces/dia" que
  este archivo repetia desde 2026-07-13 quedo VIEJO — GitHub ahora cumple el
  cron mucho mejor. Multiplica por ~5 cualquier estimacion de costo previa:
  con luna son ~$33/mes y con terra habrian sido ~$330/mes. Refuerza la
  eleccion de modelo. **Sigue sin contrastarse contra facturacion real.**
- **PENDIENTE DEL USUARIO:** ~~pegar `OPENAI_API_KEY` en GitHub Secrets~~
  **HECHO el 2026-08-21.** Los dos
  workflows ya la referencian. Sin ella el agente sigue cayendo a OpenRouter
  exactamente como hasta ahora (rules-first, nada se rompe).

**2026-08-20 — VIGILANCIA DE TEMAS por keyword ("Google Alerts" propias),
feature nueva:** pedido del usuario: poder definir keywords y enterarse apenas
se publique algo sobre ellas en la web ("si hay un nuevo concierto en Lima,
apenas se publique algo al respecto quiero verlo en el panel").
- **Por qué hacía falta:** las alertas de la Etapa 3 (`analyzers/alerting.py`)
  nacen SOLO del feed de Google Trends Perú (~10 keywords/día, top nacional de
  búsquedas). Un tema de nicho pero editorialmente valioso — un concierto, una
  empresa, un vocero — nunca cruza ese umbral y era invisible para el agente.
  Esto cubre el eje complementario: **la lista la define el equipo, no Google**.
- **Por qué Google News RSS y NO la búsqueda web de Google (decisión
  investigada, no asumida):** la búsqueda web no tiene RSS; su API oficial
  (**Custom Search JSON API**) está **cerrada a clientes nuevos desde 2025**
  (los existentes siguen hasta el 2027-01-01), así que no es una opción para
  este proyecto; **Brave Search API eliminó su free tier en febrero de 2026**;
  SerpApi sirve pero el free tier (~100/mes, ya capado a 10/día para las quick
  wins) no aguanta vigilancia continua; y scrapear google.com se bloquea desde
  las IPs de datacenter de GitHub Actions (mismo motivo por el que pytrends no
  funciona). Además Google News es **técnicamente mejor** acá: indexa notas de
  medios en minutos y su RSS acepta `when:1h`, mientras que el filtro de fecha
  de la API oficial tiene granularidad mínima de 1 día.
- **`collectors/watchlist.py` (NUEVO) — tres fuentes:** (1) **Google News RSS
  por keyword** (motor principal, mismo mecanismo probado de `trend_news.py`);
  (2) **feeds RSS directos** — `WATCH_PRIMARY_FEEDS` globales en config +
  `extra_feeds` por keyword; son las fuentes primarias que Google News no
  indexa o indexa tarde (ticketeras, agendas, salas de prensa) y suelen dar el
  anuncio ANTES que cualquier medio; (3) **`competitor_articles` ya en memoria**
  de la misma corrida (costo cero de red).
- **GOTCHA de matching (la decisión no obvia):** los hits de **Google News NO
  se re-filtran por titular**, solo se les aplican los términos negativos.
  Google matchea contra el CUERPO del artículo, así que `"concierto en lima"`
  devuelve legítimamente "De La Rose anuncia concierto en Lima…" pero también
  "Shakira anuncia fecha en el Estadio Nacional" — re-verificar contra el
  titular tiraría justo los hallazgos buenos. Los hits de **feeds directos y de
  la DB SÍ** pasan por el matcher local (`matches()`): ahí nadie buscó nada, se
  escanea el feed completo y sin filtro entraría todo.
- **Sintaxis de keyword:** se manda VERBATIM a Google News (acepta sus
  operadores) y en paralelo se parsea para el match local (`parse_query`):
  `"frase exacta"` · tokens sueltos en AND · `-excluir`. `site:`/`OR` se
  ignoran en el match local (solo significan algo para Google).
- **Ventana de 1 día a propósito, no 1 hora:** el cron de GitHub Actions se
  retrasa y saltea (medido: radar 5-7 veces/día, gaps 2-5h), así que una
  ventana corta perdería publicaciones en cada hueco. Ventana amplia + dedup
  por URL = re-ver lo mismo es gratis y no se pierde nada.
- **Tablas nuevas `watch_keywords` + `watch_hits`** (schema.sql, **YA APLICADAS
  en Supabase vía MCP**). `watch_keywords` la administra el DASHBOARD con la
  anon key (RLS insert/update/delete abiertos, mismo criterio MVP que
  `audit_check_state`); `watch_hits` la escribe el agente con service_role y el
  dashboard solo lee + marca `dismissed`. Dedup por
  `UNIQUE (keyword_id, url)` — por keyword y no solo por url, porque dos
  keywords distintas sí pueden querer avisar del mismo artículo.
- **Verificado con SQL contra la DB real (round-trip de 2 corridas):** no
  duplica, actualiza la misma fila, `created_at` se preserva, el titular se
  actualiza si el medio lo cambia, **`dismissed` NO se pisa** (un falso
  positivo descartado no reaparece en la siguiente corrida) y el `ON DELETE
  CASCADE` limpia los hallazgos al borrar la keyword. El matcher tiene test
  offline (20 casos) en scratchpad `test_watchlist.py`.
- **VERIFICADO END-TO-END EN PRODUCCIÓN (2026-08-20, corridas #711-#714):** con
  la keyword `"concierto en lima"` dada de alta desde el panel, el radar trajo
  8 publicaciones reales (RPP, El Comercio, Trome, Infobae…) incluida
  "De La Rose anuncia concierto en Lima"; el dedup confirmado en vivo
  (`8 hallazgos guardados (0 nuevos)` en la corrida siguiente); el panel de
  /alertas las muestra con badge NUEVO, medio y antigüedad.
- **`/alertas`:** bloque nuevo "Vigilancia de temas"
  (`alertas/VigilanciaPanel.tsx`) sobre Content Decay, con alta/pausa/borrado
  de keywords desde el panel, chips por tema con conteo, lista de hallazgos
  clicables (medio + antigüedad + de qué fuente salió) y botón de descarte por
  hallazgo. Badge **NUEVO** = encontrado en la ÚLTIMA corrida del radar
  (`created_at >= lastRun - 10min`), no un plazo fijo arbitrario. Ventana del
  panel: 48h (más larga que las 24h de las alertas de tendencia — un tema de
  nicho puede tener una sola nota en todo el día).
- **Corre dentro de `run_radar.py`, ANTES del return por falta de tendencias**
  (no depende de Trends; un feed de Trends caído no debe apagar la vigilancia).
  Por eso guarda ahí mismo: el bloque GUARDAR de abajo es inalcanzable en ese
  camino.
- **Latencia real:** minutos de indexación de Google News + la cadencia real
  del cron (1-5h). Si hace falta latencia de minutos de verdad, la migración
  natural es mover el disparo a **Supabase pg_cron + Edge Function cada 5 min**
  (free tier, cron confiable) sin tocar el modelo de datos ni la UI.
- **`WATCH_PRIMARY_FEEDS` — las 4 ticketeras principales, verificadas EN
  PRODUCCIÓN el 2026-08-20** (corrida #714: `Ticketmaster Perú=10 · Joinnus=48
  · Teleticket=19 · Passline=50`, sin warnings). Solo **Ticketmaster Perú** va
  por RSS nativo (`blog.ticketmaster.pe/feed`); las otras tres por búsqueda
  `site:` en Google News (`when:2d`), mismo recurso que `COMPETITOR_SITES`:
  - Teleticket y Passline no tienen feed propio (`/feed` → 404, `/rss` → 403;
    tampoco existe `blog.teleticket.com.pe`). Songkick tampoco sirve (su RSS
    por metro-area da 404).
  - **GOTCHA que costó dos corridas:** `blog.joinnus.com/feed` SÍ es RSS 2.0
    válido y responde bien a un cliente normal, pero **desde GitHub Actions
    devuelve 0 items siempre** — es bloqueo por IP de datacenter, el mismo
    motivo por el que pytrends no funciona acá. Se probó UA de navegador y
    **NO lo destraba** (#712 y #713 siguieron en Joinnus=0). Vía Google News
    trae 48-50 items. Moraleja: verificar un feed desde fuera NO prueba que
    funcione desde el CI.
- **Por eso el collector loguea el CONTEO por feed** (`Feeds primarios: …`) y
  un warning por feed que devuelva 0: `_fetch_feed` solo avisa cuando lanza
  excepción, pero feedparser devuelve `entries` vacío EN SILENCIO si el feed
  murió o lo bloquean — sin ese conteo, Joinnus caído se veía idéntico a
  Joinnus sin novedades, y la corrida #711 pasó como "success" sin que se
  notara. No quitar ese log.
  **Cómo rinden:** estos feeds se filtran por TITULAR (a diferencia de Google
  News, que matchea el cuerpo), así que dan su valor con keywords tipo ENTIDAD
  ("shakira", "estadio nacional") — ahí matchean "SHAKIRA EN LIMA" apenas
  Teleticket indexa la página, antes de que ningún medio escriba. Las keywords
  tipo TEMA ("concierto en lima") las cubre Google News. Las dos mitades son
  complementarias a propósito.
- **Pendientes conscientes:** (a) sin
  filtro LLM de relevancia: la query amplia mete algo de ruido (Google matchea
  el cuerpo), se limpia con el botón de descarte o afinando la keyword — un
  pase LLM con `provider` sería el v2 natural, pero compite por la cuota free
  de OpenRouter con la categorización y la cobertura; (c) no escribe en
  `alerts` ni dispara Teams/WhatsApp (ese enganche sigue bloqueado por
  `SECTION_RESPONSIBLES`).

**Fecha avance anterior:** 2026-07-22

**2026-07-22 — Rediseño de las ALERTAS (Etapa 3) + fix del modelo LLM +
ventana de 24h en /alertas:**
- **Modelo LLM (config.py):** el free tier `tencent/hy3:free` venció el
  2026-07-21 y empezó a dar 404 "unavailable for free" → `why_trending` y
  categorías LLM quedaban null. Se probó `meta-llama/llama-3.3-70b-instruct
  :free` y también dio 404 el mismo día (el catálogo free de OpenRouter rota
  rápido). Solución: `OPENROUTER_MODEL` default = **`openrouter/free`** (el
  router oficial que elige un modelo gratis vigente en cada llamada).
  Verificado en producción: `✅ LLM explicó 9/10 tendencias`. Ojo: el router
  es más lento (corridas de ~11 min vs ~40s con modelo fijo) y a veces enruta
  a un modelo de "safety" que responde texto en vez de JSON (cae a rules-first
  en ese lote, sin romper). Si el router falla, apuntar a un modelo de pago
  por env.
- **Rediseño de alertas (`analyzers/alerting.py` NUEVO):** la alerta usaba el
  score de recomendación con umbral 75, dominado por el `approx_traffic` de
  Trends (casi siempre 1.5/10) — la sección quedaba días vacía y solo cruzaban
  deportes grandes. Sismos con muertos, muertes de famosos, renuncias nunca
  alertaban. Ahora hay un score de **ALERTABILIDAD propio** (0-100),
  rules-first, que usa la evidencia que el radar ya recolecta:
  - **nº de fuentes distintas × frescura** de `item["news"]` (driver
    principal, W_NEWS=40 — reemplaza al approx_traffic).
  - **why_trending** del LLM: si es null (no hay hecho noticioso), multiplica
    ×0.5 → deja fuera queries genéricas ("te") y evergreen.
  - **rank** del feed de Trends Perú (W_RANK=15).
  - **términos de urgencia** (muerte, sismo, renuncia, en vivo… W_URGENCY=30,
    alto a propósito: alerta = noticia rompiendo, no explicador de tráfico).
  - **momentum** (W_MOMENTUM=15): max(growth de Trends, tracción Marfeel).
  - **Consolida eventos fragmentados** por URL de ARTÍCULO compartida
    (`_news_key_urls` usa SOLO `n["url"]`, NO `source_url` — este último en los
    ítems de Google News es el dominio pelado y fusionaba temas sin relación;
    bug detectado y corregido en calibración). El sismo salía como 4 keywords
    sueltas ("temblor hoy", "igp ultimo sismo"…), ninguna cruzaba el umbral.
  - **Dedup por título entre corridas** (`get_recent_alert_titles`, ventana
    ALERT_DEDUP_HOURS=12): el radar corre cada ~10 min, sin esto re-alertaría
    lo mismo cada ciclo.
  - **La descripción de la alerta ahora es el `why_trending` del LLM** (no el
    texto genérico "Tendencia fuerte ahora · urgencia…").
  - Config: `ALERT_SCORE_THRESHOLD`(75) eliminado →
    `ALERT_WORTHINESS_THRESHOLD`(55) + `ALERT_SEVERITY_HIGH`(78).
  - **Calibrado con datos reales del 2026-07-22** (test offline
    `test_alerting.py` en scratchpad): dispara el sismo (98.5), Junín 5
    muertos (80.6), muerte de la actriz de Godzilla (80.1), renuncia #1
    (87.2); excluye "te" (28.6) y feriado 23 julio (34.1). El score de
    recomendación (`analyzers/scoring.py`) NO se tocó — sigue alimentando las
    recomendaciones del dashboard.
- **/alertas (dashboard):** ahora filtra `created_at >= hoy-24h`
  (`ALERT_WINDOW_HOURS` en `alertas/page.tsx`) — las alertas NO se resuelven
  nunca en la DB (`resolved` nace false y nada lo cambia), así que partidos ya
  jugados hace semanas se mostraban como "Tendencia fuerte ahora · INMEDIATO".
  Mismo patrón de vigencia que /busqueda y /auditoria.

**Fecha avance anterior:** 2026-07-16

**2026-07-16 — /auditoria: ventana de 7 días + checklist de corrección (rama
auditoria-checklist → master):** pedido del usuario: la pestaña acumulaba
auditorías viejas sin límite y no había forma de controlar qué se corrigió.
- **Ventana de 7 días:** page.tsx filtra `audited_date >= hoy-7d` (limit 100
  de guarda, bajo el cap ~1000 de PostgREST). Las auditorías anteriores salen
  de la vista.
- **Checklist persistente por issue:** tabla nueva `audit_check_state`
  (id text PK, done, done_at; RLS read/insert/update abierto, mismo criterio
  MVP que el resto — solo guarda flags). **Ya aplicada en Supabase** y añadida
  a schema.sql. El dashboard escribe con la anon key vía upsert optimista
  (revierte si falla). Clave editorial = `<url>|<check>|<slot>` (slot = ocurrencia del check en la nota, porque un mismo check aparece varias veces; persiste cuando el
  morning re-audita la misma nota otro día; si la nota se corrige de verdad,
  el issue desaparece de la siguiente auditoría). Clave plataforma =
  `platform|<check>|<message>`.
- **UI:** la página pasó al patrón client component (`AuditoriaClient.tsx`,
  page.tsx solo hace fetch). Checkbox ✓ por issue (editorial y técnico) con
  tachado al marcar, progreso `n/m ✓` + minibarra en el panel de score,
  borde verde cuando el checklist de la nota está completo, fecha de
  auditoría por tarjeta, y fila de 4 StatCard: notas auditadas (7d), issues
  editoriales, corregidos (con %), pendientes técnicos.
- **Migración `gsc_daily.query_freshness` APLICADA** en Supabase (estaba
  pendiente del 2026-07-15 por bloqueo del clasificador de permisos).


**2026-07-15 — Rediseño de las 4 pestañas restantes (rama redesign-tabs →
master, merge 97cc023) — VERIFICADO en preview de Vercel antes de mergear:**
Tendencias, Alertas, Búsqueda & Discover y Auditoría migradas al sistema de
diseño del rediseño 2026-07-14 (las otras 4 ya estaban):
(1) **Tendencias:** ahora es client component (`trends/TrendsClient.tsx`,
page.tsx solo hace fetch) — filtro lateral de categorías con FilterList
(conteos + minibarras por volumen, color por categoría), filas con panel de
score /10 a la izquierda estilo Recomendaciones, chips de filtro activo, y
"Temas recurrentes" con contador ×N de en cuántas corridas apareció cada
keyword (antes era una nube plana).
(2) **Alertas:** client component (`alertas/AlertasClient.tsx`) — filtros
laterales Severidad (Alta/Media/Baja con acento por color) y Tipo de alerta,
con filtrado cruzado (cada faceta cuenta bajo la otra activa), chips +
"Limpiar filtros". Content decay igual (frame con scroll).
(3) **Búsqueda & Discover:** fila de 4 KPIs arriba (StatCard): quick wins,
CTR bajo, clics Discover 7d, "SERP por ganar" (snippets que RPP no tiene =
`!rpp_has_snippet`). Encabezados de tarjeta unificados: acento border-left
por sección + header bg-gray-50 (se eliminaron los fondos de color
amber/blue/purple/teal pre-rediseño).
(4) **Auditoría:** panel de score a la izquierda estilo Recomendaciones
(score grande coloreado verde/naranja/rojo + barra + conteo de issues),
borde de acento izquierdo por color de score. Pendientes técnicos y
Sugerencia IA sin cambios.
Con esto las 8 pestañas comparten el mismo sistema de diseño (FilterList,
StatCard, paneles score-izquierda, chips).

**2026-07-15 — Cron adelantado CONFIRMADO:** primer morning con cron 06:00 UTC
arrancó 06:17 Lima y terminó 06:31 con success y las 8 fuentes OK (antes
terminaba 09:00-13:30). El ajuste del 2026-07-14 cumplió su objetivo.

**2026-07-15 — /busqueda reorganizada por DECISIÓN, con vigencia de demanda
(rama busqueda-redesign → master b49051e):** feedback editorial: la pestaña
mostraba como quick wins notas de eventos YA jugados ("estadísticas francia
vs españa", 2M imp. después del partido) y módulos sin señal de para qué
sirven ni cuándo rinde accionar.
- **Vigencia de la demanda:** cada query de GSC se clasifica hot | evergreen
  | past | NULL — `analyzers/freshness.py` (reglas: cruce con tendencias
  activas de hoy + patrones evergreen/evento) + `openrouter.
  classify_query_freshness` (LLM refina las 120 con más impresiones, chunk
  40). Corre en run_morning; se guarda en `gsc_daily.query_freshness`.
  **MIGRACIÓN PENDIENTE:** `ALTER TABLE gsc_daily ADD COLUMN IF NOT EXISTS
  query_freshness text;` (el clasificador de permisos la bloqueó en auto
  mode; el writer hace pre-flight y guarda sin la columna mientras tanto, y
  el dashboard tiene fallback client-side por reglas — copia TS en
  BusquedaClient.tsx, si cambian las reglas actualizar AMBAS).
- **La pestaña quedó en 2 bloques:** (1) "Para accionar hoy" — cola ÚNICA
  (subir al top 3 / reescribir título y meta / ganar el snippet) ordenada
  por vigencia × impresiones, con banner de expectativas (rezago ~1 día,
  efecto 3-14 días tras reindexación), acción concreta por fila y clics/día
  perdidos; las "past" se ocultan tras un toggle. (2) "Análisis y
  monitoreo" — top queries, Discover reencuadrado (detector de patrones de
  contenido, no lista de URLs), detalle SERP (PAA = ideas de H2).
- **CTR bajo → "CTR bajo lo esperado":** curva de CTR por posición
  (expectedCtr en BusquedaClient), solo gaps reales (ctr < 40% del
  esperado, ≥30 clics/día perdidos) — CTR 0.5% en pos. 8 ya no es "problema".
- **Tarjeta "Llegamos tarde":** queries past con ≥50k imp. como lección de
  anticipación; run_morning además guarda un insight en daily_insights
  cuando hay ≥100k imp. apagadas.
- page.tsx usa select("*") en las filas de acción a propósito: tolera que
  query_freshness no exista aún.

**2026-07-15 — "Por qué es tendencia" en /trends (rama trends-explain →
master 606461b + fixes de calidad 7822728/1830768):** la pestaña Tendencias
quedó dividida en dos: izquierda el listado compacto con el filtro de
categorías como DESPLEGABLE arriba (pedido explícito: ya no panel lateral);
derecha un panel sticky que al seleccionar cada tendencia muestra (a) la
explicación de por qué es tendencia y (b) las principales noticias de Google
como lista clicable con favicon/fuente/antigüedad (NO iframe: Google bloquea
embeberse con X-Frame-Options).
- **Datos:** columnas nuevas `daily_trends.why_trending` (text) y `news`
  (jsonb, [{title, source, source_url, url, published_at, from_trends, v}]),
  migración YA aplicada vía Supabase MCP y documentada en schema.sql.
- **Evidencia de noticias (clave de calidad):** el RSS de Google Trends trae
  `ht:news_item` — las noticias que Google asocia a CADA tendencia. Se parsea
  con ElementTree en `collectors/trends.py` (feedparser APLANA elementos
  repetidos y se quedaba con uno; por eso se dejó de usar para esto). Esas
  noticias van primero; `collectors/trend_news.py` (Google News RSS de
  búsqueda es-PE `when:2d`, mismo mecanismo que competencia) complementa
  hasta 5, dedupe por titular. Verificado contra el feed real: 10 tendencias,
  30 noticias asociadas.
- **LLM:** `openrouter.explain_trends` (batch, solo OpenRouter; el facade cae
  a rules-first vía getattr). Prompt afinado tras feedback del usuario: la
  explicación DEBE anclarse en el hecho noticioso MÁS RECIENTE (no contexto
  general — "weather" salía random), priorizar titulares
  "[asociada por Google Trends]", aclarar términos ambiguos ("SGD es…"),
  términos en inglés no-nombre-propio → buscar el hecho local que dispara la
  búsqueda (friaje, sismo…), y responder null antes que inventar.
- **Ahorro de cuota:** `get_trends_context` reusa noticias+explicación ya
  guardadas hoy (las tendencias se repiten entre corridas); solo keywords
  nuevas gastan LLM (~1 llamada batch/corrida). El contexto está VERSIONADO
  (`news[].v`, `TREND_CONTEXT_VERSION` en run_radar.py): subir la versión
  regenera todo en la siguiente corrida — es el mecanismo correcto tras
  cambiar prompt/fuentes (el clasificador de permisos bloquea, con razón,
  parchar daily_trends a mano).
- **Fallback en vivo:** `app/api/trend-news/route.ts` — para tendencias sin
  `news` guardado, el panel consulta Google News RSS desde el server de
  Vercel (CORS impide desde el navegador), cache 15 min. Ojo: el target TS
  del dashboard es es5 — sin flag regex `s` ni for-of sobre matchAll (rompió
  el build una vez; se usa `[\s\S]` + `exec()`).
- **Dispatch de workflows verificado de nuevo:** `POST .../actions/workflows/
  radar.yml/dispatches` con el token del Git Credential Manager (HTTP 204,
  arranca en segundos). El clasificador NO permite despachar sobre ramas sin
  mergear (código no revisado contra DB de producción) — mergear primero.

**2026-07-14 — Rediseño visual del dashboard (rama redesign-landing → master,
merge 0f55fd2) — VERIFICADO en preview de Vercel antes de mergear:**
(1) **Landing/Resumen:** logo circular RPP (dashboard/public/rpp-logo.png,
también favicon) en cabecera amarilla de dos niveles (marca arriba, nav abajo
con scroll horizontal, sin wrap); KPIs clicables (llevan a su pestaña; el "?"
de InfoTooltip no navega porque ya hace stopPropagation); layout 2 columnas
(recomendaciones+aprendizajes | tendencias+estado del agente); fecha del día
es-PE sobre el título. **La pestaña Estado salió del menú** — se llega desde
el módulo "Estado del agente" del Resumen y desde la KPI "Fuentes OK".
(2) **Recomendaciones:** score en panel izquierdo (rank + número + barra por
urgencia) y borde de acento por urgencia — ya no al extremo derecho.
(3) **Competencia:** filtros consolidados en panel lateral único (Medios /
Categoría / ¿RPP ya lo publicó?) + "Tipo de contenido" como control
segmentado arriba (es el filtro que redefine el dataset) + chips de filtros
activos con "Limpiar filtros" sobre las notas.
(4) **Tráfico (cambio grande):** (a) **semántica de fechas corregida** — el
benchmark del día X guarda tráfico del día COMPLETO X-1 ("yesterday" de
Marfeel); toda la pestaña habla en día del dato: DatePicker (componente
nuevo, components/ui/DatePicker.tsx) muestra X-1, bloquea hoy, y hay nota
informativa; (b) StatCards con **delta % vs día anterior** (prop `delta`
nueva en StatCard, bajo el MISMO filtro sección/canal activo); (c) gráfico
**evolución por canal** (recharts, ChannelTrendChart.tsx): 7 días fijos
terminando en el último día de dato, top 5 canales + "Otros", colores de
paleta categórica validada, leyenda con toggle; va AL FONDO (lo principal
son los artículos); (d) artículos en frame con scroll interno (max-h 65vh);
(e) filtros Sección/Canal como listas laterales estilo Competencia.
**GOTCHA PostgREST descubierto:** Supabase capea cada respuesta a ~1000
filas aunque se pida .limit(15000) — por eso el gráfico salía incompleto.
Fix: paginar con .range() y orden estable (fetchChannelRowsPaged en
trafico/page.tsx). Aplica a CUALQUIER query grande futura.
(5) **Componentes compartidos nuevos:** ui/FilterList.tsx (FilterCard/
FilterItem/FilterChip — usados por Competencia y Tráfico; para nuevas
pestañas con filtros usar ESTOS, no inventar otros), ui/DatePicker.tsx,
lib/articleFilter.ts (isRealArticle/sectionOf compartidos server/client
dentro del dashboard; sigue existiendo la copia Python en
agent/article_filter.py — si cambia el regex, actualizar ambos).
(6) **Flujo de trabajo usado (recomendado para próximos rediseños):** rama →
push → preview deployment de Vercel (URL estable
rpp-seo-agent-git-<rama>-pdigital-rpp.vercel.app; requiere bypass de
Deployment Protection — herramienta get_access_to_vercel_url del Vercel MCP)
→ verificar en navegador → merge a master. **Detección de builds:** consultar
el Vercel MCP (list_deployments), no el API de deployments de GitHub con
grep (dio falsos negativos dos veces en la sesión).

**2026-07-14 — Cron del morning adelantado a 06:00 UTC (01:00 Lima), commit
23c025f:** el scheduler de GitHub retrasa el cron 3h37-7h32 (medido 07-13 jul
con cron 11:00 UTC: arrancaba 14:37-18:32 UTC, o sea 09:37-13:32 Lima — el
"benchmark de la mañana" llegaba a mediodía). Con 06:00 UTC + el mismo retraso,
queda listo entre ~04:30 y ~08:30 Lima. Ojo al leer horarios históricos: los
runs `schedule` previos al 2026-07-14 corresponden al cron viejo de 11:00 UTC.
También verificado hoy: dispatch manual del morning vía API REST de GitHub
(`POST .../actions/workflows/morning.yml/dispatches`) usando el token del Git
Credential Manager local funciona — útil porque el GitHub MCP sigue bloqueado
y el botón del dashboard solo dispara el radar.
**Estado:** v2 en producción y **funcionando end-to-end**. El radar corre en
GitHub Actions, recolecta de Marfeel + Google Trends + competencia, puntúa y
guarda recomendaciones en Supabase; el dashboard las muestra en vivo. El
benchmark matutino también quedó **verificado escribiendo data real** (ver abajo).
Rediseño visual "RPP Digital" en producción (ver sección Dashboard Next.js).
Benchmark matutino del 2026-07-08 corrido y verificado (run #24, Success):
179 artículos, 500 filas GSC, 41 en content decay, 3 insights, 7 auditorías
on-page (sin sugerencias IA — Gemini sigue bloqueado, ver Fase 2 LLM).

**2026-07-13 — Fix timezone de agent_runs + botón "Actualizar ahora" — VERIFICADO
end-to-end en producción:**
(1) **Bug de doble conversión de zona horaria corregido:** `started_at`/
`finished_at` se generaban con `datetime.now()` naive bajo `TZ=America/Lima`
(del workflow); al guardarse en `timestamptz` Supabase los interpretaba como
UTC y el dashboard volvía a restar 5h al mostrar en Lima → "última
actualización" salía 5h atrás (01:46 en vez de 06:46). Fix: `datetime.now(
timezone.utc)` en `run_morning.py`, `run_radar.py` y el fallback de
`save_run_log` (`supabase_writer.py`). Verificado: run #95 guardó 13:49 UTC →
dashboard muestra 08:49 Lima correcto. Las filas históricas pre-fix siguen 5h
atrás (no se backfillearon; las reemplazan las corridas nuevas).
(2) **Botón "⚡ Actualizar ahora" en la home:** `dashboard/app/api/run-agent/
route.ts` (POST) dispara `radar.yml` vía `workflow_dispatch` con
`GITHUB_DISPATCH_TOKEN` (fine-grained PAT solo de este repo, Actions: write,
en env vars de Vercel — configurado). Protecciones: cooldown 30 min contra
`agent_runs` (cuida cuotas free OpenRouter/SerpApi), 409 si ya hay run
queued/in_progress en GitHub, token nunca sale del servidor. **SIN auth por
decisión del usuario (MVP)** — ojo: el dashboard tiene login pero NINGUNA
página fuerza sesión (no hay middleware); cuando se agregue, reponer el check
de sesión en el endpoint. Componente `components/RunAgentButton.tsx` (client,
estados iniciando/actualizando/error). Verificado end-to-end: el POST disparó
el run #95 real y el segundo POST recibió el 409 esperado.
(3) `morning.yml` ahora tiene `concurrency: group: seo-morning` (sin
cancelación), igual que el radar — dos mornings ya no pueden solaparse.
(4) **Cadencia real medida (free tier):** morning programado 06:00 Lima
termina en la práctica ~09:00-10:00; radar corre 5-7 veces/día en franjas
(madrugada, 5-7am, 9-11am, 12-13h, 15-16h, 18-19h) con gaps de 2-5h. Los
disparos manuales sí arrancan en segundos.
(5) Pendiente menor: `next@14.1.0` tiene vulnerabilidad conocida (aviso npm
en el build de Vercel) — subir a la versión parcheada de Next 14 cuando
toque mantenimiento.
(6) **Pestaña Competencia: split "Contenido de valor" vs "Contenido SEO"**
(pedido editorial): los titulares programáticos de la competencia (loterías/
Tinka, precio dólar/euro/gasolina, horóscopo, "temblor hoy" por país, clima
por ciudad, "partidos de hoy/dónde ver", mastergrama, carlincatura,
efemérides, alimentos gratis/ICE para audiencia inmigrante USA) se aíslan en
un selector "Tipo de contenido" bajo el navegador de Medios. Default:
contenido de valor. Detección client-side por regex sobre el título
(`SEO_PATTERNS` en `CompetenciaClient.tsx`, minúsculas sin tildes; `ICE`
case-sensitive aparte), validada contra ~200 titulares reales — para ajustar
qué se considera SEO, editar esa lista (costo $0, sin tocar el agente ni la
DB; aplica también al histórico). Todo el tablero (categorías, medios,
cobertura RPP, notas) opera sobre el grupo seleccionado.
(7) **Categoría "opinión" (calculada, no viene de la DB)** en la misma
pestaña: se oculta de "Todas" y solo se ve al seleccionarla explícitamente en
el filtro de categorías (pedido: "mantener el contenido de valor arriba,
mostrar opinión a demanda"). Detección: El Comercio (y cualquier medio con
URL propia) por **ruta** — `/opinion/` o `-opinion-` en el slug (señal
confiable, ej. columnas de Día 1 en `/economia/...-opinion-...`). **Perú21
por firma de autor en el titular** (`PERU21_OPINION_AUTHORS`: Fernando Tuesta
Soldevilla, Carlos Galdós, Richard Arce, Aníbal Quiroga, + patrón "cortitas de
hoy") porque Perú21 llega vía proxy de Google News RSS
(`news.google.com/rss/articles/...`), sin URL propia de peru21.pe para
detectar por ruta. También se excluyen **páginas de etiqueta/tema** (ej.
"Noticias de JNE | JNE - Perú 21", que no son notas sino índices) con un
patrón genérico por formato del titular (`^noticias de .+\|`) — a pedido
explícito, sin lista de temas: cualquier etiqueta nueva cae sola.

**2026-07-09 — GSC Discover + SerpApi integrados, pestaña renombrada:** el
usuario se suscribió a SerpApi y pidió combinarla con GSC (que ya traía
Discover implementado pero sin usar) en vez de reemplazarla. Ver detalle en
"Google Search Console" y "SerpApi" más abajo. Pestaña `/search-console` →
`/busqueda` ("Búsqueda & Discover" en el nav), ahora con 3 secciones: búsqueda
web (igual que antes), Discover (nuevo), oportunidades SERP en vivo (nuevo,
SerpApi). Tabla nueva `serp_opportunities` en Supabase.
**Verificado end-to-end (run #26, manual, 2026-07-09):** `sources_ok` incluyó
`gsc_discover` y `serpapi`; 200 filas de Discover y 8 de `serp_opportunities`
con datos reales (RPP ya detectado en un carrusel de noticias, 0 featured
snippets propios → oportunidades libres). Ver query de ejemplo en el historial
de la sesión si hace falta repetir la verificación.

**2026-07-09 — Amazon Bedrock (Claude) como proveedor LLM preferido:** el
usuario obtuvo credenciales AWS con acceso a modelos Claude en Bedrock. Se creó
`agent/llm/bedrock.py` (mismo contrato que `gemini.py`: `categorize_topics`,
`rewrite_onpage_batch`, rules-first) y `agent/llm/provider.py` — un facade que
los orquestadores importan (`from llm import provider as llm`) en vez de un
proveedor específico. Orden de preferencia: **Bedrock > Gemini > reglas**,
porque Bedrock cobra por uso real (sin el `limit: 0` que bloquea a Gemini
hoy). Ver sección "Amazon Bedrock" más abajo. **Pendiente del usuario:** pegar
`AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_REGION` en GitHub Secrets
(ya referenciados en ambos workflows) — sin eso, el facade cae a Gemini
(bloqueado) y de ahí a reglas, sin romper nada.

**2026-07-10 — Dashboard: tooltips explicativos en las 8 pestañas + OpenRouter
(Tencent Hy3) reemplaza a Bedrock como proveedor LLM preferido — VERIFICADO
en producción:** (1) Componente `dashboard/components/ui/InfoTooltip.tsx`
(ícono "?" con panel por hover/tap, portal a `document.body` con posición fija
para no recortarse en tarjetas `overflow-hidden`) añadido al título y secciones
core de las 8 pestañas del dashboard. Desplegado y verificado en Vercel (READY).
(2) `agent/llm/openrouter.py` nuevo + `provider.py` actualizado: orden
**OpenRouter > Bedrock > Gemini > reglas** (Bedrock nunca respondió en
producción, cuenta AWS con modelos Claude gen. 3 marcados Legacy). El usuario
pegó `OPENROUTER_API_KEY` en GitHub Secrets y se corrió `radar.yml` manualmente
varias veces: **funciona en producción** (`✅ LLM categorizó 177/177 titulares`,
`10/10 temas`). Hubo que arreglar un bug real en el camino — Tencent Hy3 es un
modelo razonador y se quedaba sin `max_tokens` pensando antes de responder
(`finish_reason=length`); el fix fue capar el razonamiento con
`reasoning: {effort: "low", exclude: true}` (parámetro unificado de
OpenRouter), no subir tokens a lo bruto. Ver detalle completo en "Fase 2 —
capa LLM" más abajo.
(3) Corregido: el GitHub MCP no está bloqueado por sesión — la red corporativa
de RPP lo bloquea y activarlo requiere permisos de admin que el usuario no
tiene. Ver nota actualizada en "Conexiones MCP" más abajo.

**2026-07-10 — Categorización de competencia con LLM (siempre) + cobertura RPP
(feature nueva) + informativo de actualización por pestaña:**
(1) `provider.categorize_articles` re-categoriza CADA titular de competencia
con el LLM (las reglas por keyword fallaban con nombres propios: "Canal 5 y
TUDN…" → política, Haaland → política). Corre siempre en morning y radar.
Requirió además arreglar `save_competitor_articles`: usaba
`ignore_duplicates=True`, así que una URL ya vista NUNCA se re-categorizaba
aunque el LLM mejorara — ahora hace upsert real.
(2) **Cobertura RPP** en la pestaña Competencia: por cada titular de
competencia se marca si RPP ya publicó una nota del mismo tema (badge
"✓ Publicado en RPP" / "⚠ Pendiente" + filtro "¿RPP ya lo publicó?"). Fuente de
lo propio: `collectors/rpp_own_feed.py` (RSS `https://rpp.pe/rss`, NO Marfeel
— Marfeel mide tráfico, no "lo último publicado"). Matching en
`analyzers/coverage.py`: rules-first (solapamiento de tokens ponderado por IDF,
con umbral de token distintivo) + refinamiento LLM. Corre **solo en el radar**
(no en el morning: ventanas de competencia 24h vs feed propio 5h → falsos
"pendiente"). Verificado con datos reales de producción y ajustado dos veces
tras detectar falsos positivos (tokens temporales genéricos, y misma
entidad/distinto hecho — p.ej. "bebés llamados Haaland" vs "pronóstico de
Haaland"). Columnas nuevas en `competitor_articles` (`rpp_has_coverage`,
`rpp_matched_title`, `rpp_matched_url`, `coverage_checked_at`). Ver sección
"Cobertura RPP" más abajo.
(3) **Informativo de actualización:** las 8 pestañas muestran ahora cadencia
("cada ~10 min" / "1 vez al día") + hora exacta de la última corrida (no solo
fecha). Requirió columna nueva `agent_runs.kind` ("morning"|"radar") con
backfill de los registros históricos. Ver "Dashboard Next.js" más abajo.

- **Repo:** `https://github.com/pdigitalrpp-ops/rpp-seo-agent` (rama `master`)
- **Dashboard:** `https://rpp-seo-agent.vercel.app` (Vercel, team PDIGITAL RPP)
- **Supabase:** project ref `tfrnpjbvxulswvqtosoq`
- Git local del usuario autentica como `pdigitalrpp-ops` vía Git Credential Manager.

### Conexiones MCP disponibles para Claude Code (2026-07-07)
- **Supabase MCP:** conectado, `project_id=tfrnpjbvxulswvqtosoq` (usar `execute_sql`/`apply_migration`).
  A veces devuelve 429/503 con ráfagas de queries; esperar unos segundos y reintentar.
- **Vercel MCP:** conectado y verificado. Team **PDIGITAL RPP** = `team_J5ILqbtm0EDZ4BSl158WrhD8`.
  Proyectos: `rpp-seo-agent` = `prj_2w37k5pifcwXtoQlVNZ1qszB8ect` (el dashboard real),
  `rpp-dashboard` = `prj_HQsOhCJALxcVutbXs595EJjQVS8U` (sin usar por ahora). Con esto se puede
  listar deployments/logs de build sin navegador (`list_deployments`, `get_deployment`).
- **GitHub MCP: BLOQUEADO, no es un problema de sesión.** Causa real (corregido 2026-07-10):
  la red corporativa de Grupo RPP bloquea la conexión, y activar el conector requiere permisos
  de administrador que el usuario no tiene — no se soluciona abriendo un chat nuevo. (Nota
  histórica: el 2026-07-07 se pensó que era un problema de que los conectores cargan tools
  solo al arrancar sesión; esa hipótesis quedó descartada.) Mientras tanto, GitHub se opera con
  `git push` (código) + navegador (workflows/secrets), que es el flujo que se ha usado en toda
  la sesión y funciona bien.

### Pendientes
- **Alertas Etapa 3 (Teams/WhatsApp):** definir `SECTION_RESPONSIBLES` (canal por
  sección). Hasta entonces las alertas quedan solo en Supabase/dashboard. (El
  usuario lo dejó para el final.)
- **`SERPAPI_KEY` (RESUELTO):** configurada en GitHub Secrets, confirmada en logs
  de corridas reales (`SERPAPI_KEY: ***` presente en el env del workflow).
- **Filtrar no-artículos (RESUELTO):** solo se considera contenido editorial de rpp.pe lo
  que matchea `-(noticia|live)-<id>` (notas + coberturas en vivo tipo minuto-a-minuto).
  Se descarta home, homes de sección (`/deportes`), landings/herramientas
  (`/calculadora-...`, `/simulador-...`), buscador, `/ultimas-noticias`, `/tv-vivo`,
  `/audio/en-vivo`, listados `/noticias/...` y el widget `experiences.mrf.io`. Filtro
  aplicado en DOS lenguajes (deben coincidir): `agent/article_filter.py` (Python — extraído
  de `run_morning.py` el 2026-07-10 para que `collectors/rpp_own_feed.py` lo reuse sin
  import circular; usado por `run_morning.py` y ahora también por la cobertura RPP) y
  `isRealArticle` en `TraficoClient.tsx` (dashboard, TS). Si aparece un tipo de contenido con otro sufijo (video,
  galería…), ampliar el regex en ambos.
- **Fase 2 — capa LLM (Claude):** ver más abajo. Es lo que corrige la calidad.

---

## Arquitectura de 3 etapas

```
🌅 Etapa 1 — Benchmark de la mañana   (run_morning.py, cron 06:00 UTC = 01:00 Lima)
   Marfeel (ayer) + GSC + competencia → rendimiento de ayer, por qué funcionó,
   auditoría on-page de notas, aprendizajes (scoring_weights) para el día.

📡 Etapa 2 — Radar en tiempo real      (run_radar.py, cron cada ~10 min diurno Lima)
   Marfeel (hoy) + Trends + "más leídas" competencia → temas con score 0-100,
   mapeados a sección, aplicando los aprendizajes de la mañana.

🚨 Etapa 3 — Alertas por sección       (dentro de run_radar.py)
   Temas con score ≥ umbral → alerta al equipo de la sección (Teams/WhatsApp).
   Con anti-spam. PENDIENTE: canal por sección (SECTION_RESPONSIBLES).
```

El **ciclo de aprendizaje**: cada mañana mide qué funcionó y ajusta los pesos del
scoring que usa el radar el resto del día. Rules-first hoy; con Claude (fase 2)
sería razonamiento real.

---

## Estructura de archivos

```
rpp-seo-agent/
├── .github/workflows/
│   ├── morning.yml                 ← cron 06:00 UTC (01:00 Lima) → run_morning.py
│   └── radar.yml                   ← cron */10 (horario Lima) → run_radar.py
├── agent/
│   ├── config.py                   ← Marfeel, SECTION_MAP, SCORE_WEIGHTS, umbrales, ONPAGE
│   ├── run_morning.py              ← Etapa 1 (benchmark + insights + auditoría)
│   ├── run_radar.py                ← Etapas 2-3 (radar + alertas)
│   ├── collectors/
│   │   ├── marfeel.py              ← tráfico/audiencia (REEMPLAZA a GA4)
│   │   ├── gsc.py                  ← Google Search Console (posiciones, CTR, drops)
│   │   ├── trends.py               ← Google Trends vía RSS (NO pytrends en CI)
│   │   ├── competitors.py          ← RSS de competencia
│   │   ├── watchlist.py            ← vigilancia por keyword ("Google Alerts" propias)
│   │   ├── rpp_articles.py         ← descarga+parseo HTML de notas (auditor on-page)
│   │   └── serpapi.py              ← rankings/SERP (cuota escasa)
│   ├── analyzers/
│   │   ├── scoring.py              ← score 0-100 con pesos de aprendizaje; assign_section
│   │   ├── opportunities.py        ← quick wins, CTR bajo, build_recommendations
│   │   ├── decay.py                ← content decay vs pico histórico
│   │   ├── signals.py              ← early signals, ventanas (reusable)
│   │   └── onpage_audit.py         ← auditoría SEO on-page de una nota
│   ├── llm/
│   │   ├── provider.py              ← facade/selector (OpenAI > OpenRouter > Bedrock > Gemini > reglas)
│   │   ├── openai_compat.py         ← transporte + los 5 prompts, compartidos
│   │   ├── openai_api.py            ← adaptador OpenAI (preferido)
│   │   ├── openrouter.py            ← adaptador OpenRouter (fallback)
│   │   ├── bedrock.py / gemini.py   ← fallbacks historicos (solo 2 de las 5 tareas)
│   ├── notifiers/notify.py         ← dispatch de alertas a Teams/WhatsApp (WhatsApp = stub)
│   ├── writers/supabase_writer.py  ← escribe todas las tablas
│   └── db/schema.sql               ← 12 tablas (9 v1 + v2: daily_insights, scoring_weights, onpage_audits)
├── dashboard/app/(dashboard)/      ← Next.js: page, recomendaciones, trends, competencia,
│                                       trafico, busqueda, auditoria, alertas
├── requirements.txt
└── .env.example
```

`ga4.py` y `run.py` (v1) fueron **eliminados**.

---

## Decisiones de diseño y "gotchas" importantes

### Marfeel (fuente de tráfico — reemplaza a GA4)
- Auth: `POST https://api.newsroom.bi/api/user/signin` con `{email, password}` →
  bearer token (válido ~14 días, se cachea en `marfeel.py`).
- Datos: `POST https://api.newsroom.bi/api/dashboard/query`.
- **LÍMITE DURO: 1 request/minuto.** `marfeel.py` tiene un rate-limiter global.
  El intervalo es **65s** (con 60s justos la API igual devolvía 429).
- **El query DEBE llevar `dates`.** Sin `dates` + `granularity:"realtime"` devuelve
  `{"msg":"Invalid params"}`. Se usa `granularity:"daily"` + `dates:{last:{number:1,dimension:"day"}}`.
- **Estructura de la respuesta agrupada (clave):** los datos por dimensión están en
  `actualData.values[]`, NO en `actualData.data[]` (esa es la serie temporal por fecha).
  Cada entry: `{"key": hash, "total": N, "items": [{"id","value","type"}]}` donde
  `type` = nombre de la dimensión (`url`, `title`, `section`, `source`). `_rows_from_response`
  en `marfeel.py` parsea esto. (Bug histórico: leía `data[]` → guardaba fechas como page_path.)
- **Verificado (2026-07-01, run_morning #6 manual):** own_traffic quedó con 200 filas,
  todas con URL real (`https://rpp.pe/...`) y título → el fix del parser funciona
  end-to-end. (Ver pendiente "filtrar no-artículos" arriba.)
- Secretos: `MARFEEL_EMAIL`, `MARFEEL_PASSWORD`.
- **Tráfico por canal (nuevo):** `fetch_yesterday_by_channel()` agrupa por
  `url+title+source` → una fila por (artículo, canal). Alimenta `own_traffic_channels`
  y la página `/trafico` (filtro por canal + folder, default Google). **Sin verificar
  contra la API en vivo** que Marfeel devuelva `source` por URL al agrupar en 3 dims;
  se confirma en la próxima corrida de `run_morning`. Si `source` no viene por fila,
  habría que consultar por canal (un `filters` por source, +60s c/u por el rate-limit).

### Google Search Console (FUNCIONANDO desde 2026-07-06)
- Service account (secreto `GSC_CREDENTIALS_JSON`) añadida como usuario en la
  propiedad por el admin de GSC. El email a añadir es el `client_email` del JSON
  (termina en `.iam.gserviceaccount.com`), NO un gmail.
- **Gotcha de propiedad:** pedir `https://rpp.pe/` daba 403; `sc-domain:rpp.pe`
  también. La solución fue **auto-detectar**: `_resolve_site_url()` en `gsc.py`
  llama `sites().list()`, loguea las propiedades visibles (diagnóstico definitivo
  de permisos) y usa la de rpp.pe (dominio > prefijo). `GSC_SITE_URL` por env
  fuerza una propiedad específica; vacío = auto-detección (default).
- Con esto `gsc_daily` se puebla y /busqueda muestra quick wins, CTR bajo
  y top queries.
- **Frescura (fix 2026-07-07):** la ventana del collector termina AYER (hoy-1),
  no hoy-2: con `dataState: "all"` Google entrega data fresca (parcial) de hasta
  ayer. Con hoy-2 el dashboard mostraba partidos de hace 3-5 días como actuales.
- **Modelo de datos gsc_daily (clave para no romperlo):** cada corrida guarda un
  SNAPSHOT completo (agregado de la ventana de ~3 días de GSC) con `date` = día
  de corrida, reemplazando la fecha (delete+insert). Las ventanas de días
  consecutivos SE SOLAPAN → el dashboard debe leer SOLO el snapshot más reciente
  (`eq date = max(date)`), nunca `gte` de varios días (duplica todo y revive data
  vieja — bug visto 2026-07-07). Una query puede repetirse legítimamente en el
  snapshot si rankea con varias páginas (dimensiones page+query).
- **Discover conectado (2026-07-09):** `fetch_discover_performance()` existía
  desde antes pero nunca se llamaba. Ahora `run_morning.py` la invoca junto a
  `fetch_search_performance` y ambos resultados se guardan JUNTOS en
  `gsc_daily`, distinguidos por la columna `search_type` (`"web"` default vs
  `"Discover"`). **Importante:** las queries del dashboard que leen `gsc_daily`
  para quick wins/low CTR/top queries deben filtrar `.eq("search_type", "web")`
  explícitamente, o mezclan filas de Discover (que no traen `query` ni
  `position`) — ya aplicado en `dashboard/app/(dashboard)/busqueda/page.tsx`.

### SerpApi (conectado 2026-07-09 — complementa a GSC, no lo reemplaza)
- **División del trabajo:** GSC mide el pasado medido de rpp.pe (clics/
  impresiones/posición reales, con 1+ día de rezago); SerpApi mira el SERP en
  vivo, cualquier dominio, y expone lo que GSC no puede (featured snippet,
  People Also Ask, carrusel de noticias). No tiene sentido usar SerpApi para
  medir tráfico propio — para eso ya está GSC.
- **Presupuesto:** `SERPAPI_DAILY_LIMIT = 10`/día (`config.py`, free tier). En
  vez de gastarlo en todas las keywords del radar, `collect_serp_opportunities()`
  en `run_morning.py` lo gasta SOLO en las quick wins de GSC (posición 4-10, ya
  priorizadas por impresiones), hasta `SERPAPI_QUERIES_PER_RUN = 8` por corrida
  (margen bajo 10 por si el benchmark se re-corre el mismo día). Corre 1
  vez/día (dentro de `run_morning.py`), no en el radar.
- Usa `serpapi.fetch_serp_features(query)` (ya existía en `collectors/serpapi.py`,
  no se tocó) → featured snippet + PAA + top stories + image/local pack. Se
  guarda en la tabla nueva `serp_opportunities` (delete+insert por fecha, mismo
  patrón que `gsc_daily`), marcando `rpp_has_snippet`/`rpp_in_top_stories` si
  `SITE_DOMAIN` aparece en la fuente del snippet o en los links del carrusel.
- Rules-first: sin `SERPAPI_KEY` en el entorno, `collect_serp_opportunities`
  devuelve `[]` de inmediato — no rompe el resto del benchmark.
- **Pendiente del usuario:** pegar `SERPAPI_KEY` en GitHub Secrets (el
  workflow `morning.yml` ya lo referencia desde antes). Sin eso, la sección
  "Oportunidades en el SERP" del dashboard queda vacía.

### Google Trends
- **pytrends NO funciona desde GitHub Actions** (bloqueo por IP de datacenter).
- Se usa el feed RSS oficial **`https://trends.google.com/trending/rss?geo=PE`**
  (el endpoint clásico `/trends/trendingsearches/daily/rss` da 404). Devuelve ~10
  tendencias con `ht:approx_traffic`. El `growth_score` (0-10) sale de ese tráfico.

### Competencia
- El Comercio y Gestión usan su RSS `arcio` directo. La República, Peru21 e Infobae
  usan **Google News RSS por dominio** (`news.google.com/rss/search?q=when:1d site:...`)
  porque sus feeds propios cambiaron/fallan.
- **Categorización con LLM (2026-07-10):** las reglas por keyword clasificaban
  mal muchos titulares (nombres propios: "Canal 5 y TUDN…" → política, Haaland →
  política). `provider.categorize_articles(articles, categories)` re-categoriza
  con el LLM en lotes de 40 títulos únicos (rules-first: sin proveedor conserva
  la categoría por reglas). Corre SIEMPRE tras recolectar competencia, en
  morning y radar.
- **Guardado idempotente (gotcha):** `save_competitor_articles` hace upsert real
  `on_conflict="url"` (NO `ignore_duplicates=True`). Con ignore_duplicates un
  artículo ya visto quedaba con su primera categoría para siempre — la
  re-categorización del LLM no se propagaba a URLs ya guardadas.

### Cobertura RPP (2026-07-10) — ¿RPP ya publicó lo que publicó la competencia?
- **Objetivo:** por cada titular de competencia, badge "✓ Publicado en RPP" /
  "⚠ Pendiente" en el dashboard. "Pendiente" = brecha (la competencia lo cubre,
  RPP no).
- **Fuente de lo propio:** `collectors/rpp_own_feed.py` lee el RSS oficial
  `https://rpp.pe/rss` (~60 items, ~48 en 5h). **No Marfeel:** Marfeel mide
  tráfico, una nota recién publicada con pocas visitas no aparece; el RSS lista
  lo último sin ese sesgo. `/sitemap-news.xml` devuelve HTML (soft-404), no usar.
- **Matching (`analyzers/coverage.py`):** rules-first (solapamiento de tokens
  ponderado por IDF sobre los titulares de RPP, umbral ≥2 tokens y score ≥2.5) +
  refinamiento LLM (`provider.match_coverage` → `openrouter.match_coverage`,
  devuelve por titular el índice de la nota de RPP que lo cubre o -1). El LLM
  corrige lo que las reglas confunden por tokens genéricos (p.ej. "precio del
  euro" vs "precio del dólar" comparten precio/perú/julio → las reglas matchean,
  el LLM no). Rules-first da un badge a TODOS aunque el LLM no esté.
- **Solo en el radar, no en el morning:** la competencia del morning es de 24h y
  el feed propio de 5h → comparar ventanas tan distintas marca "pendiente" notas
  que RPP cubrió hace >5h. En el radar ambas ventanas (~6h vs 5h) coinciden.
- **Tope de costo:** `RPP_COVERAGE_LLM_MAX=60` (config, por env) — solo los 60
  titulares más recientes van al LLM (≈3 llamadas, chunk 25 en `provider.py`);
  el resto queda con rules-first. Con la categorización (que también gasta),
  días activos pueden rozar el límite free de OpenRouter (~50 req/día) — es el
  argumento para un modelo de pago/mejor.
- **Filtro editorial compartido:** `is_real_article` se movió de `run_morning.py`
  a `agent/article_filter.py` (módulo nuevo) para que `rpp_own_feed` lo reuse sin
  import circular. El dashboard mantiene su copia en TS (`isRealArticle` en
  `TraficoClient`): si cambia el regex, actualizar AMBOS.

### Scoring 0-100
- `SCORE_WEIGHTS` (suman 100): market_trend 30, competition_gap 20, rpp_relevance 15,
  discover_potential 15, time_sensitivity 10, own_momentum 10.
- Cada dimensión se normaliza 0-1 y se pondera. `learning` = multiplicadores por
  dimensión (de `scoring_weights`, aprendizajes de la mañana).
- Urgencia: INMEDIATO ≥80, HOY ≥60, ESTA SEMANA ≥40, si <40 → DESCARTAR (se filtra).
- **Secciones reemplazan a "programas".** `assign_section(category, sections)` mapea la
  categoría a una sección real de rpp.pe (dimensión `section` de Marfeel).

### Auditoría SEO on-page (`onpage_audit.py`)
- Corre en el benchmark matutino sobre notas donde rinde optimizar: quick-wins
  de GSC (con su keyword), CTR bajo de GSC, y top de ayer de Marfeel.
- `parse_article` (BeautifulSoup) extrae señales on-page; `audit_article` emite
  issues con severidad (high/med/low) y un score 0-100.
- **Split editorial vs plataforma (clave):** cada issue tiene `class`.
  - `editorial` (lo arregla el redactor): title, meta desc, H1, H2, profundidad,
    keyword en intro/H1/meta, enlazado interno, alt, freshness. **Solo esto cuenta
    para el score por nota.**
  - `platform` (sistémico, CMS/plantilla; lo arregla dev/SEO): og:image <1200
    (RPP declara 860px → pierde Discover), canonical, structured_data, social
    (og/twitter). El dashboard los muestra **agregados una sola vez** ("Pendientes
    técnicos del sitio"), no repetidos por nota, y NO penalizan el score.
  - Motivo: al validar, esos checks salían en el 100% de las notas (son de
    plantilla) e inflaban el ruido; separarlos hace que el score priorice de
    verdad. La regla de `slug` se quitó (rpp usa slugs 70-140c por diseño; ruido).
- `save_onpage_audits` borra por `audited_date` y reinserta (re-correr reemplaza).

### Supabase
- **Usar `supabase==2.31.0` + `httpx>=0.26`.** Versiones viejas dan
  `Client.__init__() got an unexpected keyword argument 'proxy'` y bloquean la escritura.
- Tablas con RLS + política `public_read` (`SELECT USING true`). Dashboard usa anon key
  (lectura), agente usa service_role (escritura).
- **REGLA para saves (aprendida 2026-07-07): todo snapshot debe ser idempotente
  por fecha** — borrar la fecha y reinsertar (o upsert por clave natural), NUNCA
  insert append-only. Un append-only + re-correr el workflow duplicó gsc_daily ×5
  (Search Console mostraba todo repetido). Únicas excepciones: tablas de EVENTOS
  (`alerts`). Patrones vigentes: delete+insert (gsc_daily, own_traffic,
  daily_trends, own_traffic_channels, recommendations, onpage_audits,
  daily_insights, scoring_weights) · upsert (competitor_articles por url,
  content_decay por page_path, publishing_windows por fecha).

### Dashboard Next.js
- App Router + RSC. `export const revalidate = 60` en todas las páginas (el radar
  actualiza cada ~10 min; 1h de ISR era demasiado stale).
- Nueva página `/auditoria` (onpage_audits). Home muestra "Aprendizajes de hoy"
  (daily_insights). recomendaciones/home usan `section` y score `/100`.
- **Zona horaria (gotcha):** los Server Components renderizan en el runtime de Vercel
  (UTC). Al mostrar horas hay que forzar `timeZone: "America/Lima"` en
  `toLocaleTimeString`/`toLocaleString`, o se ven ~5h adelantadas. Ya aplicado en
  `competencia/CompetenciaClient.tsx` (hora de artículos) y `page.tsx` (última
  actualización). La data en Supabase siempre está en UTC con tz — el ajuste es SOLO de display.
- **`/competencia` (client component):** navegador de medios a la izquierda (TODOS + cada
  medio con conteo y favicon), ventana única con las notas, identificador con logo (favicon
  vía `google.com/s2/favicons`, fallback a inicial de color) por nota, y chips de categoría
  clicables. Filtrado cruzado tipo facetas (medio ↔ categoría). `page.tsx` solo hace fetch.
- **Diseño visual "RPP Digital" (2026-07-07):** header amarillo (`bg-rpp-yellow`
  `#F5D414`) con nav en pills (`components/NavPills.tsx`, detecta ruta activa vía
  `usePathname` — antes no existía esa detección), tipografía Inter (`next/font/google`
  en `app/layout.tsx`). Tokens en `tailwind.config.ts`: `rpp-yellow`/`rpp-ink`
  (`#111827`)/`rpp-teal` (`#0D9488`). **Rojo se reserva para semántica de alerta/crítico**
  (severidad alta, caídas, score bajo); el "activo" de filtros/pills pasa a teal para no
  chocar con el amarillo del header. Tarjetas estandarizadas a `rounded-2xl border
  border-gray-200`.
  - Componentes compartidos nuevos en `dashboard/components/`: `ui/Pill.tsx` (variantes
    `solid`/`accent`/`tag` como `<button>`, más `pillClasses()` exportada para usar
    directo sobre un `<Link>` — **nunca anidar un `<Pill>` dentro de `<Link>`**, sería un
    `<button>` dentro de `<a>` = HTML inválido), `ui/StatCard.tsx` (KPI con acento de
    color vía `border-l-4` inline).
  - `<select>` de filtros (Sección en `/trafico`) migrado a fila de `Pill(variant="solid")`.
  - Mapas de color planos (`URGENCY_COLORS`, `CATEGORY_COLORS`, `SEVERITY_BADGE`, etc.)
    en las páginas migrados a `TagBadge`/`Pill(variant="tag")`, coloreado por hex vía
    `style` (no clases Tailwind dinámicas — evita problemas de purge en build).
  - **Nota de entorno:** este proyecto no tiene Node/npm instalable en el sandbox de
    Claude Code (Bash y `preview_start` no lo encuentran) — no se puede `npm run build`
    ni levantar dev server local para verificar. La verificación real ocurre en el build
    de Vercel (que sí tiene Node) tras el push; usar el Vercel MCP
    (`list_deployments`/`get_deployment_build_logs`) para confirmar `state: "READY"`.
- **Tooltips informativos (2026-07-10):** `components/ui/InfoTooltip.tsx` — ícono "?"
  junto al título y secciones core de las 8 pestañas, con panel explicativo por
  hover (desktop) o tap (touch). Implementado con un portal a `document.body` +
  `position: fixed` (no `position: absolute` dentro de la tarjeta): varias tarjetas
  usan `overflow-hidden` y el panel se recortaba, sobre todo en estados "Sin datos"
  con la tarjeta casi vacía. Cierre por click-fuera, `Escape`, o scroll/resize.
  `StatCard` acepta prop `info` para mostrarlo junto al KPI.
- **Informativo de cadencia + última actualización (2026-07-10):**
  `components/ui/LastUpdated.tsx` — bloque en el header de cada pestaña con (a)
  cadencia legible ("cada ~10 min" para pestañas del radar, "1 vez al día" para
  las del morning) y (b) hora exacta (no solo fecha) de la última corrida, vía
  `lib/lastRun.ts` → `getLastRunFinishedAt(kind)` que lee `agent_runs` filtrando
  por la columna `kind` ("morning"|"radar", nueva — con backfill de los
  registros históricos por sus `sources_ok`). Mapeo: recomendaciones/tendencias/
  competencia/alertas → radar; tráfico/búsqueda/auditoría → morning; home → mixed
  (usa el último run de cualquier tipo). En los client components (competencia,
  tráfico) el `page.tsx` hace el fetch y pasa `lastRun` como prop.

### GitHub Actions
- **El cron se retrasa/saltea mucho** en repos de poca actividad (hoy corrió ~3 veces,
  no cada 10 min). Para tiempo real de verdad haría falta un worker dedicado.
- `run_radar.py` sólo escribe `daily_trends`, `competitor_articles`, `recommendations`,
  `alerts`, `agent_runs`. `run_morning.py` escribe `own_traffic`,
  `own_traffic_channels`, `gsc_daily`, `content_decay`, `daily_insights`,
  `scoring_weights`, `onpage_audits`.

---

## Tablas Supabase

| Tabla | Escribe | Lee |
|-------|---------|-----|
| `daily_trends` | radar | dashboard trends, home |
| `competitor_articles` | radar/morning (upsert por url; radar añade cobertura RPP) | dashboard competencia |
| `recommendations` | radar (borra+reinserta por fecha) | dashboard recomendaciones, home |
| `alerts` | radar | dashboard alertas |
| `own_traffic` | morning | dashboard trafico (fallback), decay |
| `own_traffic_channels` | morning (borra+reinserta por fecha) | dashboard trafico (canal + folder) |
| `gsc_daily` | morning | dashboard search-console |
| `content_decay` | morning (upsert page_path) | dashboard alertas |
| `daily_insights` | morning (borra+reinserta) | dashboard home |
| `scoring_weights` | morning | radar (lee aprendizajes) |
| `onpage_audits` | morning | dashboard auditoria |
| `serp_opportunities` | morning (borra+reinserta, solo si hay `SERPAPI_KEY`) | dashboard busqueda |
| `watch_keywords` | **dashboard** (anon key: alta/pausa/borrado) | radar (qué vigilar) |
| `watch_hits` | radar (upsert por `keyword_id,url`) | dashboard alertas (bloque Vigilancia; marca `dismissed`) |
| `publishing_windows` | (reusable) | dashboard home |
| `agent_runs` | ambos (con `kind`: "morning"\|"radar") | dashboard home (semáforo) + "última actualización" por pestaña |

---

## Variables de entorno

### Agente Python (GitHub Secrets)
```
MARFEEL_EMAIL          → pdigitalrpp@gmail.com                 [✅ configurado]
MARFEEL_PASSWORD       → password de API de Marfeel            [✅ configurado]
SUPABASE_URL           → https://tfrnpjbvxulswvqtosoq.supabase.co  [✅ configurado]
SUPABASE_KEY           → service_role key (NO la anon)         [✅ configurado]
GSC_CREDENTIALS_JSON   → service account de Google             [✅ configurado]
SERPAPI_KEY            → clave de serpapi.com                  [⏳ pendiente, opcional]
OPENAI_API_KEY         → key propia de OpenAI (PREFERIDO)      [⏳ pendiente, la pega el usuario]
OPENAI_MODEL           → opcional, default gpt-4o-mini         [opcional]
OPENROUTER_API_KEY     → fallback                              [✅ configurado]
LLM_PROVIDER           → opcional (variable, no secreto): fuerza proveedor
```

### Dashboard (Vercel) — todas ✅ configuradas
```
NEXTAUTH_URL, NEXTAUTH_SECRET
NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY
PASS_EDITORIAL / PASS_DIRECCION / PASS_ADMIN   (contraseñas temporales: <rol>2026)
```

---

## Fase 2 — capa LLM (OpenAI preferido desde 2026-08-21; OpenRouter, Bedrock y Gemini como fallback)

**Estado (2026-07-10): VERIFICADO EN PRODUCCIÓN.** La capa LLM está
implementada y funcionando con OpenRouter (modelo Tencent Hy3, gratis) como
proveedor real. `agent/llm/provider.py` es un facade que los orquestadores
importan (`from llm import provider as llm`) en vez de un cliente específico;
internamente elige **OpenRouter si hay `OPENROUTER_API_KEY`, si no Bedrock si
hay credenciales AWS, si no Gemini, si no reglas**. Cambiar de proveedor o
añadir uno nuevo no toca `run_morning.py` ni `run_radar.py`, solo `provider.py`.
Corridas reales confirmadas: `✅ LLM categorizó 177/177 titulares de
competencia`, `✅ LLM categorizó 10/10 temas` (radar, 2026-07-10). El log de
diagnóstico `🔑 Proveedores LLM detectados: openrouter=True bedrock=True
gemini=False` confirma qué credenciales llegaron al workflow (útil si algún
día vuelve a fallar en silencio).

**Por qué OpenRouter reemplaza a Bedrock como preferido:** Bedrock nunca llegó
a responder en producción — los 3 IDs de modelo Claude probados (Sonnet v1,
v2, Haiku default) dieron `ResourceNotFoundException`, la cuenta AWS del
usuario tiene los Claude de generación 3 marcados Legacy/sin acceso activo
(requeriría reactivar model access en la consola AWS, pendiente). Bedrock y
Gemini se dejaron en el facade como fallback en cadena (no cuesta nada
mantenerlos, rules-first) mientras eso no se resuelva.

**Lo que ya existe (no reescribir):**
- `agent/llm/provider.py` — facade/selector, ver arriba.
- `agent/llm/openrouter.py` — cliente REST (requests, formato OpenAI Chat
  Completions, `POST {OPENROUTER_BASE_URL}/chat/completions`). `is_enabled()`
  por `OPENROUTER_API_KEY`. Modelo por `OPENROUTER_MODEL`, default
  `tencent/hy3:free` (295B MoE, 21B activos, **gratis en OpenRouter solo del
  2026-07-06 al 2026-07-21** — si la promo termina o el modelo deja de estar
  disponible, cambiar `OPENROUTER_MODEL` por env sin tocar código; ver catálogo
  en openrouter.ai/models).
- `agent/llm/bedrock.py` — cliente boto3 (`bedrock-runtime.invoke_model`,
  Anthropic Messages API). `is_enabled()` por `AWS_ACCESS_KEY_ID` +
  `AWS_SECRET_ACCESS_KEY`. Modelo por `BEDROCK_MODEL_ID` (default Claude 3
  Haiku; bloqueado hoy, ver arriba).
- `agent/llm/gemini.py` — cliente REST (requests, sin SDK), sigue intacto como
  último fallback. `GEMINI_MODEL` overrideable por env (default gemini-2.0-flash).
- **A) Categorización (radar):** `categorize_topics(keywords, categories)` — 1
  llamada batch para los ~10 trends. Enchufada en `run_radar.py` vía el
  facade; `scoring.py` respeta `item["category"]` pre-asignada. Arregla
  "haaland → otros".
- **B) Reescritura (auditoría):** `rewrite_onpage_batch(items)` — 1 llamada batch
  para todas las notas con issues editoriales. Enchufada en `run_morning.py`
  vía el facade; se guarda en `onpage_audits.suggestions` (jsonb) y el
  dashboard la muestra como "✨ Sugerencia IA" (título/meta/H2 con contador de chars).
- **C) Cobertura (competencia vs RPP):** `match_coverage(comp_titles, own_titles)`
  — ver sección "Cobertura RPP" más abajo. Solo implementado en
  `openrouter.py`; Bedrock/Gemini no lo tienen (el facade cae a rules-first si
  el proveedor activo no expone el método, vía `getattr`).
- Workflows ya pasan `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`,
  `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`,
  `BEDROCK_MODEL_ID` y `GEMINI_API_KEY`. Todos configurados en GitHub Secrets
  (el usuario pegó `OPENROUTER_API_KEY` el 2026-07-10).
- `requirements.txt` incluye `boto3==1.34.144` (Bedrock); OpenRouter reutiliza
  `requests`, ya presente por Gemini — sin dependencias nuevas.

**Gotcha real de producción — Tencent Hy3 es un modelo razonador (fix
2026-07-10):** el primer run real dio `finish_reason=length` y `content` vacío
en TODAS las llamadas de categorización: el modelo gasta el mismo presupuesto
de `max_tokens` "pensando" antes de escribir la respuesta, y con lotes de
~80-100 ítems se quedaba sin tokens a mitad de razonamiento (nunca llegaba al
JSON). El fix NO fue subir `max_tokens` a lo bruto sino enviar
`"reasoning": {"effort": "low", "exclude": true}` en el body (parámetro
unificado de OpenRouter, ver openrouter.ai/docs/guides/best-practices/
reasoning-tokens) — limita el razonamiento y lo excluye de la respuesta. Se
combinó con bajar `_ARTICLE_CHUNK` de 100 a 40 (provider.py) y subir
`max_tokens` de categorización a 6000. **Importante:** el campo `reasoning`
que devuelve la API NUNCA es la respuesta pedida (es el monólogo interno
truncado) — no usarlo como fallback si `content` viene vacío, es el error que
se cometió y corrigió en el primer intento de fix.

**Gotcha de red (importante para probar localmente):** la red corporativa de
Grupo RPP bloquea `openrouter.ai` puntualmente (confirmado: otros dominios en
Cloudflare como discord.com/anthropic.com sí responden, solo openrouter.ai da
timeout de conexión). No probar `openrouter.py` desde un sandbox/máquina en la
red de RPP — el workflow de GitHub Actions corre en infraestructura de
GitHub, sin esa restricción, y ahí sí funciona (verificado).

### Análisis de consumo de la API (2026-07-08)
Volumen real medido (no teórico): el cron del radar NO cumple los `*/10 min`
— GitHub Actions lo retrasa/saltea en repos poco activos, así que en la
práctica corre **~4-6 veces/día**, no ~114. Con eso: `categorize_topics`
~4-6 llamadas/día, `rewrite_onpage_batch` 1/día → **~5-7 llamadas lógicas/día**.
No es un problema de volumen bruto.

**Dónde sí hay desperdicio (si algún día hay quota real que cuidar):**
1. `_generate()` en `gemini.py:30` reintenta 2 veces más en 429 (`retries=2`,
   backoff 12s/24s) — con `limit:0` el 429 es inevitable, así que cada llamada
   lógica cuesta **3 requests reales** y ~36s perdidos por corrida.
2. Sin caché: el feed de Trends apenas cambia entre corridas consecutivas
   (verificado: `daily_trends` de un día completo trae hasta 44 keywords con
   alto solape) y se re-clasifica la lista completa cada vez.
3. `categorize_topics` manda TODAS las keywords a Gemini, incluidas las que
   `_infer_category_from_keyword` (reglas) ya resuelve bien.

**Recordatorio clave:** el bloqueo es `limit: 0` (cero cuota gratuita en ese
proyecto de Google), no una cuota baja — bajar el consumo NO destraba el
free tier. Solo lo destraba habilitar billing en ese proyecto de Google Cloud
o usar una key de otro proyecto/cuenta con free tier real.

**Opciones de optimización (si llega una key funcional y el costo importa),
de mayor a menor impacto:** (1) caché `keyword→categoría` en Supabase con TTL
~24h, solo mandar a Gemini las keywords nuevas; (2) enviar a Gemini solo lo
que las reglas no resuelven ("otros"); (3) no reintentar en 429 (dejar que la
siguiente corrida del radar sea el reintento natural); (4) `GEMINI_MODEL=
gemini-2.0-flash-lite` por env, sin tocar código; (5) throttle explícito
(1 categorización/hora) si el cron algún día corre más seguido de verdad.
Ninguna implementada aún — quedó como informe, pendiente de decisión del
usuario sobre cuál aplicar.
morning = 1 call/día. Volumen mínimo; batch SIEMPRE (aprendido: por-nota saturó
el rate limit).

---

## Contexto RPP

- **SITE_URL:** `https://rpp.pe/` · **Zona horaria:** America/Lima (UTC-5, sin DST)
- **Categorías** (sin tilde, claves de `CATEGORY_KEYWORDS`): politica, economia, deportes,
  entretenimiento, tecnologia, salud, mundo, otros.
- **Secciones** reales salen de la dimensión `section` de Marfeel (fallback en `KNOWN_SECTIONS_FALLBACK`).
- Umbral decay 20%, alerta GSC 30%, quick wins pos 4-10 con ≥200 impresiones, low CTR ≤2% con ≥500.
```
