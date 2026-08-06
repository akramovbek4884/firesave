import { existsSync, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import {
  cleanUrl,
  detectPlatform,
  safeFileBaseName,
  type DownloadResult,
  type MediaMeta,
  type Platform,
  type RequestedFormat,
} from "@firesave/core";

export interface MediaProvider {
  readonly platform: Platform;
  canHandle(url: string): boolean;
  normalize(url: string): string;
  getMetadata(url: string): Promise<MediaMeta>;
  download(url: string, requestedFormat: RequestedFormat, outputDir: string): Promise<DownloadResult>;
}

export abstract class YtDlpBaseProvider implements MediaProvider {
  public abstract readonly platform: Platform;

  public canHandle(url: string): boolean {
    return detectPlatform(url) === this.platform;
  }

  public normalize(url: string): string {
    return cleanUrl(url);
  }

  public async getMetadata(url: string): Promise<MediaMeta> {
    const normalizedUrl = this.normalize(url);
    const output = await runCommand(getYtDlpPath(), [
      "--dump-single-json",
      "--no-playlist",
      "--no-warnings",
      normalizedUrl,
    ]);

    const parsed = JSON.parse(output) as {
      title?: string;
      duration?: number;
      thumbnail?: string;
      webpage_url?: string;
      uploader?: string;
      uploader_id?: string;
    };

    return {
      title: parsed.title || `${this.platform.toUpperCase()} media`,
      duration: parsed.duration,
      thumbnail: parsed.thumbnail,
      platform: this.platform,
      sourceUrl: parsed.webpage_url || normalizedUrl,
      author: parsed.uploader || parsed.uploader_id,
    };
  }

  public async download(
    url: string,
    requestedFormat: RequestedFormat,
    outputDir: string,
  ): Promise<DownloadResult> {
    const normalizedUrl = this.normalize(url);
    const fallbackMeta: MediaMeta = {
      title: `${this.platform}_${Date.now()}`,
      platform: this.platform,
      sourceUrl: normalizedUrl,
    };
    const meta = await this.getMetadata(normalizedUrl).catch(() => fallbackMeta);

    await fs.mkdir(outputDir, { recursive: true });

    const baseName = safeFileBaseName(meta.title);
    const extension = requestedFormat === "audio" ? "mp3" : "mp4";
    const outputTemplate = path.join(outputDir, `${baseName}.%(ext)s`);

    const args: string[] = ["--no-playlist", "--no-warnings", "-o", outputTemplate];
    const ffmpegDirectory = getFfmpegDirectory();

    if (ffmpegDirectory) {
      args.push("--ffmpeg-location", ffmpegDirectory);
    }

    if (requestedFormat === "audio") {
      args.push("-x", "--audio-format", "mp3", "--audio-quality", "0");
    } else {
      args.push("-f", "mp4/bestvideo+bestaudio/best", "--merge-output-format", "mp4");
    }

    args.push(normalizedUrl);

    await runCommand(getYtDlpPath(), args);

    const targetPath = path.join(outputDir, `${baseName}.${extension}`);
    
    // Check if target file exists, if not find any downloaded file in outputDir
    let finalPath = targetPath;
    try {
      await fs.stat(targetPath);
    } catch {
      const files = await fs.readdir(outputDir);
      const matched = files.find((f) => f.endsWith(`.${extension}`) || f.startsWith(baseName));
      if (!matched) {
        throw new Error(`Fayl yuklab olingandan so‘ng topilmadi: ${outputDir}`);
      }
      finalPath = path.join(outputDir, matched);
    }

    const stat = await fs.stat(finalPath);
    const fileName = path.basename(finalPath);

    return {
      kind: requestedFormat,
      title: meta.title,
      duration: meta.duration,
      thumbnail: meta.thumbnail,
      filePath: finalPath,
      fileName,
      mimeType: requestedFormat === "audio" ? "audio/mpeg" : "video/mp4",
      fileSizeBytes: stat.size,
    };
  }
}

function getYtDlpPath(): string {
  return process.env.YTDLP_PATH ?? getLocalBinaryPath("yt-dlp") ?? "yt-dlp";
}

function getFfmpegDirectory(): string | undefined {
  if (process.env.FFMPEG_PATH) {
    return path.dirname(process.env.FFMPEG_PATH);
  }

  const localFfmpeg = getLocalBinaryPath("ffmpeg");
  return localFfmpeg ? path.dirname(localFfmpeg) : undefined;
}

function getLocalBinaryPath(binary: "yt-dlp" | "ffmpeg"): string | undefined {
  const candidate = path.join(os.homedir(), ".local", "bin", binary);
  return existsSync(candidate) ? candidate : undefined;
}

export class InstagramProvider extends YtDlpBaseProvider {
  public readonly platform: Platform = "instagram";
}

export class TikTokProvider extends YtDlpBaseProvider {
  public readonly platform: Platform = "tiktok";
}

export class VkProvider extends YtDlpBaseProvider {
  public readonly platform: Platform = "vk";
}

export const providerRegistry: MediaProvider[] = [
  new InstagramProvider(),
  new TikTokProvider(),
  new VkProvider(),
];

export function getProvider(url: string): MediaProvider | null {
  return providerRegistry.find((provider) => provider.canHandle(url)) ?? null;
}

async function runCommand(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout.trim());
        return;
      }

      reject(new Error(stderr.trim() || `${command} ${args.join(" ")} exit code: ${code}`));
    });
  });
}
