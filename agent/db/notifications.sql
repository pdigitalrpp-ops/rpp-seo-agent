-- Notificaciones por correo: resumen matutino y alertas (2026-10-12).
--
-- El agente NO envía nada: escribe en la base como siempre. pg_cron llama cada
-- 5 min a /api/notificar del dashboard (Vercel), que es quien tiene las
-- credenciales de Gmail, y esa ruta decide qué hay nuevo para mandar.
--
--   pg_cron (*/5) → notificar_cron_disparar() → pg_net POST → /api/notificar
--
-- Usa el MISMO secreto de Vault que el reloj del radar ('radar_cron_secret' =
-- CRON_SECRET en Vercel). Aplicada vía Supabase MCP; este archivo es el registro.

-- A quién se le manda qué. Por ahora se administra con SQL.
create table if not exists public.notification_recipients (
  email               text primary key,
  digest              boolean not null default true,    -- resumen matutino
  alerts              boolean not null default true,    -- alertas en el momento
  alert_min_severity  text    not null default 'medium' check (alert_min_severity in ('low','medium','high')),
  active              boolean not null default true,
  created_at          timestamptz not null default now()
);

-- Qué se envió a quién. La clave única es lo que impide mandar dos veces:
-- la ruta RESERVA la fila antes de enviar y solo envía lo que logró reservar.
--   kind = 'resumen' → ref = día de Lima (YYYY-MM-DD)
--   kind = 'alerta'  → ref = alerts.id
create table if not exists public.notification_log (
  id       bigint generated always as identity primary key,
  kind     text not null,
  ref      text not null,
  email    text not null,
  sent_at  timestamptz not null default now(),
  unique (kind, ref, email)
);
create index if not exists notification_log_sent_at_idx on public.notification_log (sent_at);

-- RLS sin políticas: solo service_role (mismo criterio que dashboard_users).
alter table public.notification_recipients enable row level security;
alter table public.notification_log        enable row level security;

create or replace function public.notificar_cron_disparar(p_body jsonb default '{}'::jsonb)
returns bigint
language plpgsql
security definer
set search_path to 'public', 'vault', 'net'
as $$
declare
  v_secreto text;
  v_id      bigint;
begin
  select decrypted_secret into v_secreto
  from vault.decrypted_secrets where name = 'radar_cron_secret';

  if v_secreto is null then
    raise warning 'notificar_cron: falta el secreto en Vault; no se dispara';
    return null;
  end if;

  select net.http_post(
    url     := 'https://rpp-seo-agent.vercel.app/api/notificar',
    body    := coalesce(p_body, '{}'::jsonb),
    headers := jsonb_build_object(
                 'Content-Type',  'application/json',
                 'x-cron-secret', v_secreto),
    timeout_milliseconds := 30000
  ) into v_id;

  return v_id;
end $$;

revoke all on function public.notificar_cron_disparar(jsonb) from public, anon, authenticated;

-- Primer destinatario (prueba).
insert into public.notification_recipients (email) values ('flozano@gruporpp.com.pe')
on conflict (email) do nothing;

-- El reloj. Se programa DESPUÉS de desplegar la ruta:
--   select cron.schedule('notificar', '*/5 * * * *', 'select public.notificar_cron_disparar()');
-- Para probar un correo sin tocar el registro:
--   select public.notificar_cron_disparar('{"prueba":"resumen","para":"flozano@gruporpp.com.pe"}');
--   select public.notificar_cron_disparar('{"prueba":"alertas","para":"flozano@gruporpp.com.pe"}');
-- Para ver qué respondió la ruta: select * from radar_cron_diagnostico(5);
