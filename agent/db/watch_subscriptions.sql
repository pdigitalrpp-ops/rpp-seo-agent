-- Avisos por correo de los temas del Radar (2026-10-19).
--
-- Cualquier usuario del panel (todos son @gruporpp.com.pe) puede pedir que le
-- lleguen por correo las publicaciones nuevas de un tema de /radar, con una de
-- tres frecuencias:
--   'inmediato' → en cuanto el radar las encuentra (el correo sale en la
--                 siguiente pasada de /api/notificar, cada 5 min)
--   'horarios'  → 08:00, 13:00 y 18:00 de Lima, con lo encontrado desde el envío anterior
--   'diario'    → 08:00, con lo encontrado en las 24 h anteriores
--
-- La escribe SOLO el dashboard (/api/radar/suscripcion, con la sesión de quien
-- se suscribe) y la lee /api/notificar. Lo enviado queda en notification_log:
--   kind 'tema'         → ref = watch_hits.id   (aviso inmediato, uno por hallazgo)
--   kind 'tema_horario' → ref = 'YYYY-MM-DD@H'
--   kind 'tema_diario'  → ref = 'YYYY-MM-DD'
-- Aplicada vía Supabase MCP; este archivo es el registro.

create table if not exists public.watch_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  keyword_id  uuid not null references public.watch_keywords(id) on delete cascade,
  email       text not null,
  frequency   text not null check (frequency in ('inmediato', 'horarios', 'diario')),
  created_at  timestamptz not null default now(),
  -- Se renueva en cada cambio. El aviso inmediato solo manda hallazgos
  -- posteriores: al pasar de "diario" a "inmediato" no se reenvía lo de horas atrás.
  updated_at  timestamptz not null default now(),
  unique (keyword_id, email)
);
create index if not exists watch_subscriptions_email_idx on public.watch_subscriptions (email);

-- RLS sin políticas: solo service_role (mismo criterio que notification_recipients).
alter table public.watch_subscriptions enable row level security;
