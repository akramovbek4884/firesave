create extension if not exists pgcrypto;

create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  telegram_user_id bigint not null unique,
  username text,
  is_blocked boolean not null default false,
  first_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.download_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  telegram_chat_id bigint not null,
  source_url text not null,
  platform text not null,
  requested_format text not null check (requested_format in ('video', 'audio')),
  status text not null check (status in ('queued', 'processing', 'done', 'failed')),
  title text,
  duration_seconds integer,
  storage_path text,
  file_size_bytes bigint,
  error_message text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

create table if not exists public.job_events (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.download_jobs(id) on delete cascade,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_download_jobs_status on public.download_jobs(status);
create index if not exists idx_download_jobs_user_id on public.download_jobs(user_id);
create index if not exists idx_job_events_job_id on public.job_events(job_id);
