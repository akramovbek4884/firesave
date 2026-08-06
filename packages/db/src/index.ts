import { readFile } from "node:fs/promises";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import PgBoss from "pg-boss";
import pg from "pg";
import {
  DOWNLOAD_QUEUE_NAME,
  buildStoragePath,
  computeUrlHash,
  type AdminStats,
  type CachedJobResult,
  type DownloadJobPayload,
  type JobStatus,
  type RequestedFormat,
} from "@firesave/core";

const { Pool } = pg;

interface EnvConfig {
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  databaseUrl: string;
  storageBucket: string;
}

export function loadEnvConfig(): EnvConfig {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const databaseUrl = process.env.DATABASE_URL;
  const storageBucket = process.env.SUPABASE_STORAGE_BUCKET ?? "downloads";

  if (!supabaseUrl || !supabaseServiceRoleKey || !databaseUrl) {
    throw new Error("SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY va DATABASE_URL majburiy.");
  }

  return {
    supabaseUrl,
    supabaseServiceRoleKey,
    databaseUrl,
    storageBucket,
  };
}

let dbPool: pg.Pool | null = null;

export function getDbPool(): pg.Pool {
  if (!dbPool) {
    const config = loadEnvConfig();
    dbPool = new Pool({
      connectionString: config.databaseUrl,
      ssl: { rejectUnauthorized: false },
      max: 10,
    });
  }
  return dbPool;
}

export function createSupabaseAdmin(): SupabaseClient {
  const config = loadEnvConfig();
  return createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

export async function createQueue(): Promise<PgBoss> {
  const config = loadEnvConfig();
  const boss = new PgBoss({
    connectionString: config.databaseUrl,
    ssl: { rejectUnauthorized: false },
  });

  await boss.start();
  await boss.createQueue(DOWNLOAD_QUEUE_NAME);
  return boss;
}

export async function upsertTelegramUser(telegramUser: {
  telegramUserId: number;
  username?: string;
}): Promise<{ id: string; isBlocked: boolean; isAdmin: boolean }> {
  const pool = getDbPool();
  const username = telegramUser.username ?? null;

  const res = await pool.query<{ id: string; is_blocked: boolean; is_admin: boolean }>(
    `
    INSERT INTO public.users (telegram_user_id, username, last_active_at)
    VALUES ($1, $2, NOW())
    ON CONFLICT (telegram_user_id) 
    DO UPDATE SET username = EXCLUDED.username, last_active_at = NOW()
    RETURNING id, is_blocked, is_admin;
    `,
    [telegramUser.telegramUserId, username],
  );

  const row = res.rows[0];
  return {
    id: row.id,
    isBlocked: row.is_blocked ?? false,
    isAdmin: row.is_admin ?? false,
  };
}

export async function checkUserRateLimit(telegramUserId: number): Promise<{ allowed: boolean; message?: string }> {
  const pool = getDbPool();

  const userRes = await pool.query<{ is_blocked: boolean; daily_download_count: number; last_download_at: Date | null }>(
    `SELECT is_blocked, daily_download_count, last_download_at FROM public.users WHERE telegram_user_id = $1`,
    [telegramUserId],
  );

  const user = userRes.rows[0];
  if (user?.is_blocked) {
    return { allowed: false, message: "Sizning hisobingiz bloklangan." };
  }

  const limitRes = await pool.query<{ max_daily_downloads: number }>(
    `SELECT max_daily_downloads FROM public.user_limits WHERE telegram_user_id = $1`,
    [telegramUserId],
  );

  const maxDaily = limitRes.rows[0]?.max_daily_downloads ?? 50;
  const today = new Date().toISOString().slice(0, 10);
  const lastDownloadDate = user?.last_download_at ? new Date(user.last_download_at).toISOString().slice(0, 10) : null;

  const currentDailyCount = lastDownloadDate === today ? (user?.daily_download_count ?? 0) : 0;

  if (currentDailyCount >= maxDaily) {
    return {
      allowed: false,
      message: `Kunlik yuklashlar limitiga yetdingiz (${maxDaily} ta). Ertaga qayta urinib ko‘ring.`,
    };
  }

  return { allowed: true };
}

export async function findCachedDownloadJob(
  sourceUrl: string,
  requestedFormat: RequestedFormat,
): Promise<CachedJobResult | null> {
  const pool = getDbPool();
  const urlHash = computeUrlHash(sourceUrl);

  const res = await pool.query<{
    id: string;
    title: string | null;
    telegram_file_id: string | null;
    storage_path: string | null;
    file_size_bytes: number | null;
  }>(
    `
    SELECT id, title, telegram_file_id, storage_path, file_size_bytes
      FROM public.download_jobs
     WHERE url_hash = $1
       AND requested_format = $2
       AND status = 'done'
       AND (telegram_file_id IS NOT NULL OR storage_path IS NOT NULL)
     ORDER BY finished_at DESC
     LIMIT 1
    `,
    [urlHash, requestedFormat],
  );

  const data = res.rows[0];
  if (!data) {
    return null;
  }

  return {
    id: data.id,
    title: data.title,
    telegramFileId: data.telegram_file_id,
    storagePath: data.storage_path,
    fileSizeBytes: data.file_size_bytes ? Number(data.file_size_bytes) : null,
  };
}

export async function createDownloadJobRecord(input: {
  telegramUserId: number;
  chatId: number;
  sourceUrl: string;
  platform: string;
  requestedFormat: RequestedFormat;
}): Promise<{ jobId: string; urlHash: string }> {
  const pool = getDbPool();
  const urlHash = computeUrlHash(input.sourceUrl);

  const userRes = await pool.query<{ id: string }>(
    `SELECT id FROM public.users WHERE telegram_user_id = $1`,
    [input.telegramUserId],
  );

  const userId = userRes.rows[0]?.id;
  if (!userId) {
    throw new Error("Foydalanuvchi topilmadi.");
  }

  const jobRes = await pool.query<{ id: string }>(
    `
    INSERT INTO public.download_jobs (user_id, telegram_chat_id, source_url, platform, requested_format, url_hash, status)
    VALUES ($1, $2, $3, $4, $5, $6, 'queued')
    RETURNING id;
    `,
    [userId, input.chatId, input.sourceUrl, input.platform, input.requestedFormat, urlHash],
  );

  const jobId = jobRes.rows[0].id;

  // Increment user daily download count
  await pool.query(`SELECT public.increment_user_download($1)`, [input.telegramUserId]).catch(() => null);

  return { jobId, urlHash };
}

export async function enqueueDownloadJob(payload: DownloadJobPayload): Promise<void> {
  const boss = await createQueue();
  await boss.send(DOWNLOAD_QUEUE_NAME, payload);
  await boss.stop();
}

export async function updateJobStatus(
  jobId: string,
  status: JobStatus,
  options?: {
    errorMessage?: string;
    title?: string;
    durationSeconds?: number;
    retryCount?: number;
  },
): Promise<void> {
  const pool = getDbPool();
  const isFinished = status === "done" || status === "failed";

  await pool.query(
    `
    UPDATE public.download_jobs
       SET status = $2,
           error_message = COALESCE($3, error_message),
           title = COALESCE($4, title),
           duration_seconds = COALESCE($5, duration_seconds),
           retry_count = COALESCE($6, retry_count),
           finished_at = CASE WHEN $7 THEN NOW() ELSE finished_at END
     WHERE id = $1;
    `,
    [
      jobId,
      status,
      options?.errorMessage ?? null,
      options?.title ?? null,
      options?.durationSeconds ?? null,
      options?.retryCount ?? null,
      isFinished,
    ],
  );
}

export async function saveTelegramFileId(jobId: string, telegramFileId: string): Promise<void> {
  const pool = getDbPool();
  await pool.query(`UPDATE public.download_jobs SET telegram_file_id = $2 WHERE id = $1`, [jobId, telegramFileId]);
}

export async function logJobEvent(jobId: string, eventType: string, payload: Record<string, unknown> = {}): Promise<void> {
  const pool = getDbPool();
  await pool.query(
    `INSERT INTO public.job_events (job_id, event_type, payload) VALUES ($1, $2, $3)`,
    [jobId, eventType, JSON.stringify(payload)],
  );
}

export async function attachUploadedFile(jobId: string, storagePath: string, fileSizeBytes: number): Promise<void> {
  const pool = getDbPool();
  await pool.query(
    `UPDATE public.download_jobs SET storage_path = $2, file_size_bytes = $3 WHERE id = $1`,
    [jobId, storagePath, fileSizeBytes],
  );
}

export async function uploadFileToStorage(localFilePath: string, jobId: string, fileName: string): Promise<string> {
  const supabase = createSupabaseAdmin();
  const { storageBucket } = loadEnvConfig();

  // Ensure storage bucket exists
  await supabase.storage.createBucket(storageBucket, { public: false }).catch(() => null);

  const fileBuffer = await readFile(localFilePath);
  const storagePath = buildStoragePath(jobId, fileName);

  const { error } = await supabase.storage.from(storageBucket).upload(storagePath, fileBuffer, {
    upsert: true,
  });

  if (error) {
    throw error;
  }

  return storagePath;
}

export async function createSignedDownloadUrl(storagePath: string): Promise<string> {
  const supabase = createSupabaseAdmin();
  const { storageBucket } = loadEnvConfig();
  const { data, error } = await supabase.storage.from(storageBucket).createSignedUrl(storagePath, 60 * 60 * 24);

  if (error || !data) {
    throw error ?? new Error("signed URL yaratib bo‘lmadi.");
  }

  return data.signedUrl;
}

export async function getUserStats(telegramUserId: number): Promise<{ total: number; done: number; daily: number }> {
  const pool = getDbPool();

  const userRes = await pool.query<{ id: string; daily_download_count: number }>(
    `SELECT id, daily_download_count FROM public.users WHERE telegram_user_id = $1`,
    [telegramUserId],
  );

  const user = userRes.rows[0];
  if (!user) {
    return { total: 0, done: 0, daily: 0 };
  }

  const jobsRes = await pool.query<{ total: string; done: string }>(
    `
    SELECT COUNT(*) as total,
           COUNT(*) FILTER (WHERE status = 'done') as done
      FROM public.download_jobs
     WHERE user_id = $1
    `,
    [user.id],
  );

  const row = jobsRes.rows[0];
  return {
    total: Number(row?.total ?? 0),
    done: Number(row?.done ?? 0),
    daily: user.daily_download_count ?? 0,
  };
}

export async function getAdminAnalytics(): Promise<AdminStats> {
  const pool = getDbPool();

  const usersCount = await pool.query<{ count: string }>(`SELECT COUNT(*) FROM public.users`);
  const jobsCount = await pool.query<{
    total: string;
    done: string;
    failed: string;
    today: string;
  }>(`
    SELECT COUNT(*) as total,
           COUNT(*) FILTER (WHERE status = 'done') as done,
           COUNT(*) FILTER (WHERE status = 'failed') as failed,
           COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE) as today
      FROM public.download_jobs
  `);

  const platformsRes = await pool.query<{ platform: string; count: string }>(`
    SELECT platform, COUNT(*) as count
      FROM public.download_jobs
     GROUP BY platform
  `);

  const platformBreakdown: Record<string, number> = { instagram: 0, tiktok: 0, vk: 0 };
  for (const row of platformsRes.rows) {
    if (row.platform) {
      platformBreakdown[row.platform] = Number(row.count);
    }
  }

  const jRow = jobsCount.rows[0];
  return {
    totalUsers: Number(usersCount.rows[0]?.count ?? 0),
    totalJobs: Number(jRow?.total ?? 0),
    completedJobs: Number(jRow?.done ?? 0),
    failedJobs: Number(jRow?.failed ?? 0),
    todayJobs: Number(jRow?.today ?? 0),
    platformBreakdown,
  };
}

export async function toggleUserBlock(telegramUserId: number, blockState: boolean): Promise<boolean> {
  const pool = getDbPool();
  const res = await pool.query(`UPDATE public.users SET is_blocked = $2 WHERE telegram_user_id = $1`, [
    telegramUserId,
    blockState,
  ]);
  return (res.rowCount ?? 0) > 0;
}
