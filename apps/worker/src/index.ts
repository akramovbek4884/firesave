import "dotenv/config";
import { promises as fs } from "node:fs";
import path from "node:path";
import { Bot, InputFile } from "grammy";
import {
  DOWNLOAD_QUEUE_NAME,
  type DownloadJobPayload,
} from "@firesave/core";
import {
  attachUploadedFile,
  createQueue,
  createSignedDownloadUrl,
  logJobEvent,
  saveTelegramFileId,
  updateJobStatus,
  uploadFileToStorage,
} from "@firesave/db";
import { getProvider } from "@firesave/providers";

const botToken = process.env.BOT_TOKEN;
const localDownloadDir = process.env.LOCAL_DOWNLOAD_DIR ?? "./tmp/downloads";
const TELEGRAM_MAX_FILE_SIZE_BYTES = 48 * 1024 * 1024; // 48 MB limit for standard bot upload

if (!botToken) {
  throw new Error("BOT_TOKEN topilmadi. Worker uchun `.env` ni to‘ldiring.");
}

const bot = new Bot(botToken);

async function start(): Promise<void> {
  await fs.mkdir(localDownloadDir, { recursive: true });

  const boss = await createQueue();
  console.log("Worker tayyor va queue kutmoqda...");

  await boss.work<DownloadJobPayload>(DOWNLOAD_QUEUE_NAME, async (job) => {
    const jobItem = Array.isArray(job) ? job[0] : job;
    const payload = jobItem.data;
    const currentRetry = payload.retryCount ?? 0;
    const provider = getProvider(payload.sourceUrl);

    if (!provider) {
      await updateJobStatus(payload.jobId, "failed", { errorMessage: "Mos provider topilmadi." });
      await logJobEvent(payload.jobId, "failed", { reason: "Provider not found" });
      await sendTelegramMessage(payload.chatId, "❌ Bu link hozircha qo‘llab-quvvatlanmaydi.");
      return;
    }

    const jobDir = path.join(localDownloadDir, payload.jobId);

    try {
      await updateJobStatus(payload.jobId, "processing", { retryCount: currentRetry });
      await logJobEvent(payload.jobId, "processing_started", { retryCount: currentRetry });

      await sendTelegramMessage(
        payload.chatId,
        `⏳ **Media yuklanmoqda...**\nFormat: ${payload.requestedFormat.toUpperCase()}`,
      );

      const result = await provider.download(payload.sourceUrl, payload.requestedFormat, jobDir);

      let telegramFileId: string | null = null;

      // Smart delivery: Try direct send to Telegram if < 48MB
      if (result.fileSizeBytes <= TELEGRAM_MAX_FILE_SIZE_BYTES) {
        try {
          await sendTelegramMessage(payload.chatId, "📤 **Telegram chatga yuklanmoqda...**");
          const caption = `✅ **${result.title}**\n\n🤖 @FireSave_Bot orqali yuklandi`;

          if (payload.requestedFormat === "video") {
            const sentMsg = await bot.api.sendVideo(payload.chatId, new InputFile(result.filePath), {
              caption,
              parse_mode: "Markdown",
            });
            telegramFileId = sentMsg.video?.file_id ?? null;
          } else {
            const sentMsg = await bot.api.sendAudio(payload.chatId, new InputFile(result.filePath), {
              caption,
              title: result.title,
              parse_mode: "Markdown",
            });
            telegramFileId = sentMsg.audio?.file_id ?? null;
          }

          if (telegramFileId) {
            await saveTelegramFileId(payload.jobId, telegramFileId);
          }
        } catch (tgError) {
          console.warn("Direct Telegram send failed, falling back to Storage URL:", tgError);
        }
      }

      // Storage Upload & Signed URL generation
      const storagePath = await uploadFileToStorage(result.filePath, payload.jobId, result.fileName);
      const signedUrl = await createSignedDownloadUrl(storagePath);
      await attachUploadedFile(payload.jobId, storagePath, result.fileSizeBytes);

      await updateJobStatus(payload.jobId, "done", {
        title: result.title,
        durationSeconds: result.duration ? Math.round(result.duration) : undefined,
      });

      await logJobEvent(payload.jobId, "completed", {
        fileSizeBytes: result.fileSizeBytes,
        hasTelegramFileId: Boolean(telegramFileId),
      });

      // If file was too large for direct Telegram send or direct send failed, provide signed download link
      if (!telegramFileId || result.fileSizeBytes > TELEGRAM_MAX_FILE_SIZE_BYTES) {
        const lines = [
          `✅ **${result.title}**`,
          `📁 Hajmi: ${(result.fileSizeBytes / (1024 * 1024)).toFixed(2)} MB`,
          "",
          `📥 [Faylni yuklab olish uchun bosing (Signed Link)](${signedUrl})`,
        ];
        await sendTelegramMessage(payload.chatId, lines.join("\n"));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Noma’lum xatolik";
      console.error(`Job ${payload.jobId} error:`, message);

      if (currentRetry < 2) {
        // Retry logic
        const nextRetry = currentRetry + 1;
        await logJobEvent(payload.jobId, "retry_scheduled", { nextRetry, error: message });
        await updateJobStatus(payload.jobId, "queued", { retryCount: nextRetry, errorMessage: message });

        await sendTelegramMessage(
          payload.chatId,
          `🔄 Yuklashda muammo bo‘ldi (${nextRetry}/3). Qayta urinib ko‘rilmoqda...`,
        );

        // Re-enqueue job after small delay
        const bossQueue = await createQueue();
        await bossQueue.send(DOWNLOAD_QUEUE_NAME, { ...payload, retryCount: nextRetry }, { startAfter: 5 });
        await bossQueue.stop();
      } else {
        await updateJobStatus(payload.jobId, "failed", { errorMessage: message, retryCount: currentRetry });
        await logJobEvent(payload.jobId, "failed", { error: message });
        await sendTelegramMessage(
          payload.chatId,
          `❌ Yuklab bo‘lmadi: ${message}\n\nIltimos, havolani tekshirib qayta yuboring.`,
        );
      }
    } finally {
      await fs.rm(jobDir, { recursive: true, force: true }).catch(() => null);
    }
  });

  process.on("SIGINT", async () => {
    await boss.stop();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    await boss.stop();
    process.exit(0);
  });
}

async function sendTelegramMessage(chatId: number, text: string): Promise<void> {
  try {
    await bot.api.sendMessage(chatId, text, { parse_mode: "Markdown" });
  } catch {
    await bot.api.sendMessage(chatId, text);
  }
}

start().catch((error) => {
  console.error(error);
  process.exit(1);
});
