-- Feature additions for rate limits, deduplication, retry handling, and admin support

-- 1. Add fields to users table
alter table public.users add column if not exists is_admin boolean not null default false;
alter table public.users add column if not exists daily_download_count integer not null default 0;
alter table public.users add column if not exists last_download_at timestamptz;
alter table public.users add column if not exists last_active_at timestamptz not null default now();

-- 2. Add fields to download_jobs table
alter table public.download_jobs add column if not exists telegram_file_id text;
alter table public.download_jobs add column if not exists url_hash text;
alter table public.download_jobs add column if not exists retry_count integer not null default 0;
alter table public.download_jobs add column if not exists retry_limit integer not null default 3;

-- 3. Create index for deduplication lookup
create index if not exists idx_download_jobs_dedup 
  on public.download_jobs(url_hash, requested_format, status);

-- 4. User limits table for custom rate limits per user
create table if not exists public.user_limits (
  telegram_user_id bigint primary key references public.users(telegram_user_id) on delete cascade,
  max_daily_downloads integer not null default 50,
  rate_limit_per_minute integer not null default 10,
  updated_at timestamptz not null default now()
);

-- 5. Helper function for daily download count reset or check
create or replace function public.increment_user_download(p_telegram_user_id bigint)
returns boolean
language plpgsql
as $$
declare
  v_daily_count integer;
  v_max_daily integer := 50;
  v_last_download timestamptz;
begin
  select daily_download_count, last_download_at 
    into v_daily_count, v_last_download
    from public.users
   where telegram_user_id = p_telegram_user_id;

  -- Reset daily count if date has changed
  if v_last_download is null or v_last_download::date < now()::date then
    v_daily_count := 0;
  end if;

  select max_daily_downloads into v_max_daily
    from public.user_limits
   where telegram_user_id = p_telegram_user_id;

  if v_max_daily is null then
    v_max_daily := 50;
  end if;

  if v_daily_count >= v_max_daily then
    return false;
  end if;

  update public.users
     set daily_download_count = v_daily_count + 1,
         last_download_at = now(),
         last_active_at = now()
   where telegram_user_id = p_telegram_user_id;

  return true;
end;
$$;
