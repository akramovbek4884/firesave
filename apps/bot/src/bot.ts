import dotenv from "dotenv";
import { randomUUID } from "node:crypto";
import { Bot, InlineKeyboard, webhookCallback } from "grammy";
import {
  cleanUrl,
  detectPlatform,
  isSupportedUrl,
  type DownloadJobPayload,
  type Platform,
  type RequestedFormat,
} from "@firesave/core";
import {
  checkUserRateLimit,
  createDownloadJobRecord,
  enqueueDownloadJob,
  findCachedDownloadJob,
  getAdminAnalytics,
  getUserRecentJobs,
  getUserStats,
  toggleUserBlock,
  upsertTelegramUser,
  createSignedDownloadUrl,
} from "@firesave/db";

dotenv.config();

interface PendingRequest {
  sourceUrl: string;
  platform: Platform;
  telegramUserId: number;
  chatId: number;
}

const botToken = process.env.BOT_TOKEN;
const adminIdEnv = process.env.ADMIN_TELEGRAM_ID ? Number(process.env.ADMIN_TELEGRAM_ID) : null;

if (!botToken) {
  throw new Error("BOT_TOKEN topilmadi. `.env` faylini to‘ldiring.");
}

const bot = new Bot(botToken);
const pendingRequests = new Map<string, PendingRequest>();

const STATUS_EMOJI: Record<string, string> = {
  queued: "⏳",
  processing: "🔄",
  done: "✅",
  failed: "❌",
};

async function ensureUserNotBlocked(ctx: { from?: { id: number; username?: string }; reply: (text: string) => Promise<unknown> }): Promise<boolean> {
  if (!ctx.from) return false;

  const user = await upsertTelegramUser({
    telegramUserId: ctx.from.id,
    username: ctx.from.username,
  });

  if (user.isBlocked) {
    await ctx.reply("🚫 Sizning hisobingiz bloklangan. Admin bilan bog‘laning.");
    return false;
  }

  return true;
}

async function isAdminUser(telegramUserId: number, username?: string): Promise<boolean> {
  const user = await upsertTelegramUser({ telegramUserId, username });
  return user.isAdmin || (adminIdEnv !== null && telegramUserId === adminIdEnv);
}

bot.command("start", async (ctx) => {
  if (!ctx.from) return;

  try {
    const user = await upsertTelegramUser({
      telegramUserId: ctx.from.id,
      username: ctx.from.username,
    });

    if (user.isBlocked) {
      await ctx.reply("🚫 Sizning hisobingiz bloklangan. Admin bilan bog‘laning.");
      return;
    }
  } catch (error) {
    console.error("/start uchun foydalanuvchini saqlab bo‘lmadi:", error);
    await ctx.reply(
      "⚠️ Bot hozircha ma’lumotlar bazasiga ulanmayapti. Administrator konfiguratsiyani tekshirishi kerak.",
    );
    return;
  }

  const lines = [
    "🚀 **FireSave Downloader Botiga xush kelibsiz!**",
    "",
    "Menga quyidagi platformalardan media link yuboring:",
    "• 📸 **Instagram** (Reels, Post, IGTV)",
    "• 🎵 **TikTok** (Video & Audio)",
    "• 🎬 **VK** (Video & Clips)",
    "",
    "Siz **Video** yoki **Audio (MP3)** formatini tanlab yuklab olishingiz mumkin.",
    "",
    "📌 Buyruqlar: /help | /stats | /myjobs",
  ];

  await ctx.reply(lines.join("\n"), { parse_mode: "Markdown" });
});

bot.command("help", async (ctx) => {
  const lines = [
    "ℹ️ **Qo‘llanma & Qo‘llab-quvvatlanadigan platformalar:**",
    "",
    "1. Qo‘llab-quvvatlanadigan ilovalar: Instagram, TikTok va VK.",
    "2. Botga havola yuboring.",
    "3. `Video 📹` yoki `Audio 🎵` tugmasidan birini tanlang.",
    "4. Bot mediani tayyorlab chatga yuboradi yoki tezkor yuklab olish havolasini beradi.",
    "",
    "💡 Tip: Bir xil havolalar keshdan lahzada yuboriladi!",
  ];

  await ctx.reply(lines.join("\n"), { parse_mode: "Markdown" });
});

bot.command("stats", async (ctx) => {
  if (!ctx.from) return;
  if (!(await ensureUserNotBlocked(ctx))) return;

  const stats = await getUserStats(ctx.from.id);

  const lines = [
    "📊 **Sizning statistikangiz:**",
    "",
    `👤 Telegram ID: \`${ctx.from.id}\``,
    `📥 Jami yuklashlar so‘rovi: ${stats.total} ta`,
    `✅ Muvaffaqiyatli yuklanganlar: ${stats.done} ta`,
    `📅 Bugungi yuklashlaringiz: ${stats.daily} ta (limit: 50)`,
  ];

  await ctx.reply(lines.join("\n"), { parse_mode: "Markdown" });
});

bot.command("myjobs", async (ctx) => {
  if (!ctx.from) return;
  if (!(await ensureUserNotBlocked(ctx))) return;

  const jobs = await getUserRecentJobs(ctx.from.id, 10);

  if (jobs.length === 0) {
    await ctx.reply("📭 Hali hech qanday yuklash so‘rovi yo‘q. Link yuboring!");
    return;
  }

  const lines = ["📋 **Oxirgi yuklashlaringiz:**", ""];

  for (const job of jobs) {
    const emoji = STATUS_EMOJI[job.status] ?? "❓";
    const date = new Date(job.createdAt).toLocaleString("uz-UZ", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
    const title = job.title ?? job.platform.toUpperCase();
    lines.push(`${emoji} **${title}** (${job.requestedFormat})`);
    lines.push(`   📅 ${date} | ${job.status}`);
    lines.push("");
  }

  await ctx.reply(lines.join("\n"), { parse_mode: "Markdown" });
});

bot.command("admin", async (ctx) => {
  if (!ctx.from) return;

  const isAdmin = await isAdminUser(ctx.from.id, ctx.from.username);

  if (!isAdmin) {
    await ctx.reply("❌ Bu buyruq faqat adminlar uchun.");
    return;
  }

  const stats = await getAdminAnalytics();

  const lines = [
    "👑 **Admin Dashboard & Analytics:**",
    "",
    `👥 Jami foydalanuvchilar: **${stats.totalUsers}**`,
    `📦 Jami joblar: **${stats.totalJobs}**`,
    `✅ Muvaffaqiyatli: **${stats.completedJobs}**`,
    `❌ Xatolar: **${stats.failedJobs}**`,
    `📅 Bugungi joblar: **${stats.todayJobs}**`,
    "",
    "📊 **Platformalar bo‘yicha:**",
    `• Instagram: ${stats.platformBreakdown.instagram ?? 0}`,
    `• TikTok: ${stats.platformBreakdown.tiktok ?? 0}`,
    `• VK: ${stats.platformBreakdown.vk ?? 0}`,
    "",
    "🛠 **Admin buyruqlar:**",
    "`/block <telegram_id>` — foydalanuvchini bloklash",
    "`/unblock <telegram_id>` — blokdan chiqarish",
  ];

  await ctx.reply(lines.join("\n"), { parse_mode: "Markdown" });
});

bot.command("block", async (ctx) => {
  if (!ctx.from) return;

  const isAdmin = await isAdminUser(ctx.from.id, ctx.from.username);
  if (!isAdmin) {
    await ctx.reply("❌ Bu buyruq faqat adminlar uchun.");
    return;
  }

  const targetId = Number(ctx.match?.trim());
  if (!targetId || Number.isNaN(targetId)) {
    await ctx.reply("❌ Foydalanuvchi ID sini kiriting.\nMisol: `/block 123456789`", { parse_mode: "Markdown" });
    return;
  }

  if (targetId === ctx.from.id) {
    await ctx.reply("❌ O‘zingizni bloklay olmaysiz.");
    return;
  }

  const success = await toggleUserBlock(targetId, true);
  if (success) {
    await ctx.reply(`🚫 Foydalanuvchi \`${targetId}\` bloklandi.`, { parse_mode: "Markdown" });
  } else {
    await ctx.reply(`❌ Foydalanuvchi \`${targetId}\` topilmadi.`, { parse_mode: "Markdown" });
  }
});

bot.command("unblock", async (ctx) => {
  if (!ctx.from) return;

  const isAdmin = await isAdminUser(ctx.from.id, ctx.from.username);
  if (!isAdmin) {
    await ctx.reply("❌ Bu buyruq faqat adminlar uchun.");
    return;
  }

  const targetId = Number(ctx.match?.trim());
  if (!targetId || Number.isNaN(targetId)) {
    await ctx.reply("❌ Foydalanuvchi ID sini kiriting.\nMisol: `/unblock 123456789`", { parse_mode: "Markdown" });
    return;
  }

  const success = await toggleUserBlock(targetId, false);
  if (success) {
    await ctx.reply(`✅ Foydalanuvchi \`${targetId}\` blokdan chiqarildi.`, { parse_mode: "Markdown" });
  } else {
    await ctx.reply(`❌ Foydalanuvchi \`${targetId}\` topilmadi.`, { parse_mode: "Markdown" });
  }
});

bot.on("message:text", async (ctx) => {
  if (!ctx.from) return;
  const rawText = ctx.message.text.trim();

  if (rawText.startsWith("/")) return;

  if (!(await ensureUserNotBlocked(ctx))) return;

  const normalizedUrl = cleanUrl(rawText);

  if (!isSupportedUrl(normalizedUrl)) {
    await ctx.reply("❌ Hozircha faqat Instagram, TikTok va VK havolalari qo‘llab-quvvatlanadi.");
    return;
  }

  const rateLimitStatus = await checkUserRateLimit(ctx.from.id);
  if (!rateLimitStatus.allowed) {
    await ctx.reply(`⚠️ ${rateLimitStatus.message || "Limitga yetdingiz."}`);
    return;
  }

  const platform = detectPlatform(normalizedUrl);
  if (!platform) {
    await ctx.reply("❌ Platformani aniqlab bo‘lmadi.");
    return;
  }

  const requestId = randomUUID();
  pendingRequests.set(requestId, {
    sourceUrl: normalizedUrl,
    platform,
    telegramUserId: ctx.from.id,
    chatId: ctx.chat.id,
  });

  const keyboard = new InlineKeyboard()
    .text("📹 Video", `dl:${requestId}:video`)
    .text("🎵 Audio", `dl:${requestId}:audio`);

  await ctx.reply(`🔗 Link qabul qilindi.\n🌐 Platforma: **${platform.toUpperCase()}**\n\nQaysi formatda yuklamoqchisiz?`, {
    reply_markup: keyboard,
    parse_mode: "Markdown",
  });
});

bot.callbackQuery(/^dl:([^:]+):(video|audio)$/, async (ctx) => {
  if (!ctx.from) return;

  if (!(await ensureUserNotBlocked(ctx))) {
    await ctx.answerCallbackQuery({ text: "Hisobingiz bloklangan.", show_alert: true });
    return;
  }

  const requestId = ctx.match[1];
  const requestedFormat = ctx.match[2] as RequestedFormat;
  const pendingRequest = pendingRequests.get(requestId);

  if (!pendingRequest) {
    await ctx.answerCallbackQuery({
      text: "So‘rov muddati tugagan. Linkni qayta yuboring.",
      show_alert: true,
    });
    return;
  }

  if (pendingRequest.telegramUserId !== ctx.from.id) {
    await ctx.answerCallbackQuery({
      text: "Bu tugma boshqa foydalanuvchining so‘roviga tegishli.",
      show_alert: true,
    });
    return;
  }

  try {
    await upsertTelegramUser({
      telegramUserId: pendingRequest.telegramUserId,
      username: ctx.from.username,
    });

    const cachedJob = await findCachedDownloadJob(pendingRequest.sourceUrl, requestedFormat);
    if (cachedJob) {
      pendingRequests.delete(requestId);
      await ctx.answerCallbackQuery({ text: "Tezkor keshdan topildi! ⚡" });

      if (cachedJob.telegramFileId) {
        await ctx.editMessageText("🚀 Keshdan yuborilmoqda...");
        if (requestedFormat === "video") {
          await ctx.replyWithVideo(cachedJob.telegramFileId, {
            caption: `✅ **${cachedJob.title || "Media"}** (Keshdan⚡)`,
            parse_mode: "Markdown",
          });
        } else {
          await ctx.replyWithAudio(cachedJob.telegramFileId, {
            caption: `🎵 **${cachedJob.title || "Audio"}** (Keshdan⚡)`,
            parse_mode: "Markdown",
          });
        }
        return;
      } else if (cachedJob.storagePath) {
        const signedUrl = await createSignedDownloadUrl(cachedJob.storagePath);
        await ctx.editMessageText(
          `⚡ **Keshdan topildi!**\n\n📥 [Yuklab olish uchun bosing](${signedUrl})`,
          { parse_mode: "Markdown" },
        );
        return;
      }
    }

    const { jobId, urlHash } = await createDownloadJobRecord({
      telegramUserId: pendingRequest.telegramUserId,
      chatId: pendingRequest.chatId,
      sourceUrl: pendingRequest.sourceUrl,
      platform: pendingRequest.platform,
      requestedFormat,
    });

    const payload: DownloadJobPayload = {
      jobId,
      chatId: pendingRequest.chatId,
      userId: pendingRequest.telegramUserId,
      platform: pendingRequest.platform,
      sourceUrl: pendingRequest.sourceUrl,
      requestedFormat,
      urlHash,
    };

    await enqueueDownloadJob(payload);
    pendingRequests.delete(requestId);

    await ctx.answerCallbackQuery({ text: "Yuklash navbatga qo‘shildi." });
    await ctx.editMessageText(
      `⏳ **So‘rov qabul qilindi!**\n🌐 Platforma: ${pendingRequest.platform.toUpperCase()}\n🎞 Format: ${requestedFormat.toUpperCase()}\n\n⏱️ Worker faollashmoqda...`,
      { parse_mode: "Markdown" },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Noma’lum xatolik";
    await ctx.answerCallbackQuery({
      text: "So‘rovni yaratib bo‘lmadi.",
      show_alert: true,
    });
    await ctx.reply(`❌ Xatolik: ${message}`);
  }
});

bot.catch((err) => {
  console.error("Bot xatoligi yuz berdi:", err.error || err);
});

export const webhookHandler = webhookCallback(bot, "express");
export { bot };
