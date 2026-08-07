import { createHash } from "node:crypto";

export const SUPPORTED_PLATFORMS = ["instagram", "tiktok", "vk"] as const;
export const SUPPORTED_FORMATS = ["video", "audio"] as const;
export const DOWNLOAD_QUEUE_NAME = "download-media";

export type Platform = (typeof SUPPORTED_PLATFORMS)[number];
export type RequestedFormat = (typeof SUPPORTED_FORMATS)[number];
export type JobStatus = "queued" | "processing" | "done" | "failed";

export interface MediaMeta {
  title: string;
  duration?: number;
  thumbnail?: string;
  platform: Platform;
  sourceUrl: string;
  author?: string;
}

export interface DownloadJobPayload {
  jobId: string;
  chatId: number;
  userId: number;
  platform: Platform;
  sourceUrl: string;
  requestedFormat: RequestedFormat;
  urlHash: string;
  retryCount?: number;
}

export interface DownloadResult {
  kind: RequestedFormat;
  title: string;
  duration?: number;
  thumbnail?: string;
  filePath: string;
  fileName: string;
  mimeType: string;
  fileSizeBytes: number;
}

export interface CachedJobResult {
  id: string;
  title: string | null;
  telegramFileId: string | null;
  storagePath: string | null;
  fileSizeBytes: number | null;
}

export interface AdminStats {
  totalUsers: number;
  totalJobs: number;
  completedJobs: number;
  failedJobs: number;
  todayJobs: number;
  platformBreakdown: Record<string, number>;
}

export interface UserLimitConfig {
  maxDailyDownloads: number;
  rateLimitPerMinute: number;
}

export interface UserJobSummary {
  id: string;
  sourceUrl: string;
  platform: string;
  requestedFormat: RequestedFormat;
  status: JobStatus;
  title: string | null;
  createdAt: string;
}

export function isSupportedUrl(input: string): boolean {
  return detectPlatform(input) !== null;
}

export function detectPlatform(input: string): Platform | null {
  const value = input.toLowerCase();

  if (value.includes("instagram.com")) {
    return "instagram";
  }

  if (value.includes("tiktok.com") || value.includes("vt.tiktok.com")) {
    return "tiktok";
  }

  if (value.includes("vk.com") || value.includes("vkvideo.ru")) {
    return "vk";
  }

  return null;
}

/**
 * Removes tracking query parameters like ?igsh=, ?utm_*, ?is_from_webapp=
 */
export function cleanUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl.trim());
    const paramsToKeep = ["v"]; // keep video id if any
    const searchParams = new URLSearchParams();

    parsed.searchParams.forEach((val, key) => {
      if (paramsToKeep.includes(key)) {
        searchParams.append(key, val);
      }
    });

    parsed.search = searchParams.toString();
    // remove trailing slashes
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return rawUrl.trim();
  }
}

/**
 * Computes a SHA-256 hash of normalized URL for deduplication checks
 */
export function computeUrlHash(url: string): string {
  const cleaned = cleanUrl(url);
  return createHash("sha256").update(cleaned).digest("hex");
}

export function safeFileBaseName(title: string): string {
  return (
    title
      .normalize("NFKD")
      .replace(/[^\w\s.-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .slice(0, 80) || "media"
  );
}

export function buildStoragePath(jobId: string, fileName: string): string {
  const today = new Date().toISOString().slice(0, 10);
  return `${today}/${jobId}/${fileName}`;
}
