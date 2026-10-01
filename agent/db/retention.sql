-- ============================================================================
-- Política de retención de datos (decidida 2026-09-29)
-- Borra datos que ninguna pantalla ni el agente vuelven a leer. Ventanas:
--   competitor_articles            30 días  (dashboard lee hoy; caché de categorías 2 días)
--   gsc_daily, serp_opportunities  60 días  (pantalla lee el último día; Google guarda 16 meses)
--   own_traffic*, agent_runs       90 días  (calendario de /trafico y content decay usan 90)
--   daily_trends, watch_hits,
--   onpage_audits                  60 días
--   alerts                         90 días
--   códigos de acceso vencidos     se borran
--   cron.job_run_details           14 días  (pg_cron no lo limpia solo)
-- Corre sola cada día a las 02:30 Lima (07:30 UTC), en el hueco del radar.
-- Ejecutar en el SQL Editor de Supabase, en el orden de los PASOS.
-- ============================================================================

-- PASO 1 — función + tarea diaria ---------------------------------------------
create table if not exists public.data_retention_runs (
  id bigserial primary key,
  ran_at timestamptz not null default now(),
  deleted jsonb not null
);
alter table public.data_retention_runs enable row level security;

create or replace function public.purge_old_data()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r jsonb := '{}'::jsonb;
  n bigint;
begin
  delete from competitor_articles where fetched_date < current_date - 30;
  get diagnostics n = row_count; r := r || jsonb_build_object('competitor_articles', n);

  delete from gsc_daily where date < current_date - 60;
  get diagnostics n = row_count; r := r || jsonb_build_object('gsc_daily', n);
  delete from serp_opportunities where date < current_date - 60;
  get diagnostics n = row_count; r := r || jsonb_build_object('serp_opportunities', n);

  delete from own_traffic where date < current_date - 90;
  get diagnostics n = row_count; r := r || jsonb_build_object('own_traffic', n);
  delete from own_traffic_channels where date < current_date - 90;
  get diagnostics n = row_count; r := r || jsonb_build_object('own_traffic_channels', n);
  delete from own_traffic_sections where date < current_date - 90;
  get diagnostics n = row_count; r := r || jsonb_build_object('own_traffic_sections', n);
  delete from own_traffic_totals where date < current_date - 90;
  get diagnostics n = row_count; r := r || jsonb_build_object('own_traffic_totals', n);
  -- agent_runs alimenta las fechas del calendario de /trafico: misma ventana.
  delete from agent_runs where run_date < current_date - 90;
  get diagnostics n = row_count; r := r || jsonb_build_object('agent_runs', n);

  delete from daily_trends where date < current_date - 60;
  get diagnostics n = row_count; r := r || jsonb_build_object('daily_trends', n);
  delete from watch_hits where created_at < now() - interval '60 days';
  get diagnostics n = row_count; r := r || jsonb_build_object('watch_hits', n);
  delete from onpage_audits where audited_date < current_date - 60;
  get diagnostics n = row_count; r := r || jsonb_build_object('onpage_audits', n);
  delete from alerts where date < current_date - 90;
  get diagnostics n = row_count; r := r || jsonb_build_object('alerts', n);

  delete from dashboard_access_codes where expires_at < now() - interval '1 day';
  get diagnostics n = row_count; r := r || jsonb_build_object('dashboard_access_codes', n);
  delete from comite_access_codes where expires_at < now() - interval '1 day';
  get diagnostics n = row_count; r := r || jsonb_build_object('comite_access_codes', n);

  delete from cron.job_run_details where start_time < now() - interval '14 days';
  get diagnostics n = row_count; r := r || jsonb_build_object('cron.job_run_details', n);

  delete from data_retention_runs where ran_at < now() - interval '180 days';
  insert into data_retention_runs (deleted) values (r);
  return r;
end;
$$;

revoke all on function public.purge_old_data() from public, anon, authenticated;

select cron.unschedule('purge-old-data')
  where exists (select 1 from cron.job where jobname = 'purge-old-data');
select cron.schedule('purge-old-data', '30 7 * * *', $$select public.purge_old_data()$$);

-- PASO 2 — primera limpieza ahora (devuelve cuántas filas borró por tabla) ----
select public.purge_old_data();

-- PASO 3 — pendiente del 2026-09-23: visitas infladas ------------------------
-- Las contaba el middleware (precargas del menú) antes del deploy de e713305
-- (commit 21:38:57 UTC). Son 185 filas, todas antes de 21:40 UTC.
delete from dashboard_page_views where created_at < '2026-09-23 21:40:00+00';

-- PASO 4 — devolver el espacio al disco (un DELETE solo lo deja para reusar) --
-- Bloquea cada tabla unos segundos; correr fuera de horario pico. Ejecutar
-- cada línea POR SEPARADO (VACUUM no corre dentro de una transacción).
vacuum full analyze public.competitor_articles;
vacuum full analyze public.gsc_daily;
vacuum full analyze public.daily_trends;

-- Verificación: tamaño total y registro de la limpieza
-- select pg_size_pretty(pg_database_size(current_database()));
-- select * from public.data_retention_runs order by ran_at desc;
