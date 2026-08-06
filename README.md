# FireSave Bot 🚀

FireSave — Telegram orqali **Instagram**, **TikTok** va **VK** tarmoqlaridan **Video** va **Audio (MP3)** fayllarni tezkor hamda yuqori sifatda yuklab beruvchi avtomatlashtirilgan bot-worker monoreposi.

---

## 🏗️ Loyiha Tuzilmasi

```text
/apps
  /bot           # Telegram bot (grammY + Fastify webhook/polling)
  /worker        # Download worker (pg-boss queue + yt-dlp + ffmpeg)
/packages
  /core          # URL normalizator, hashing, tiplar va utils
  /providers     # Instagram, TikTok va VK modulli provayderlar
  /db            # Supabase Postgres, Storage va pg-boss qatlami
/supabase
  /migrations    # SQL migratsiyalar (001_initial.sql va 002_features.sql)
.github/workflows
  /ci.yml        # GitHub Actions CI/CD pipeline
```

---

## ⚡ Xususiyatlari

- 🎯 **3 ta platforma**: Instagram (Reels, Post), TikTok, VK (Video, Clips).
- 🎵 **Audio (MP3) ekstraksiya**: Videodan sifatli MP3 ajratib berish.
- ⚡ **Deduplication (Instant Cache)**: Bir marta yuklangan link qayta yuborilsa, worker ishlatmasdan lahzada keshdan yuboradi.
- 📤 **Smart Delivery**: 48MB ga qadar bo‘lgan fayllar to‘g‘ridan-to‘g‘ri Telegram chatga yuboriladi, katta fayllar uchun Supabase Storage Signed URL havola yaratiladi.
- 🛡️ **Rate Limit & Ban**: Har bir foydalanuvchi uchun kunlik yuklashlar limiti va bloklash imkoniyati.
- 🔄 **Auto Retry**: Xatolik yuz berganda 3 martagacha avtomatik qayta urinish.
- 📊 **Admin Panel**: `/admin` buyrug‘i orqali jonli statistika va tahlil.

---

## 🚀 Ishga Tushirish

### 1. Talablar
- **Node.js**: v20+
- **pnpm**: v9+
- **yt-dlp** va **ffmpeg** (Server/kompyuterda o‘rnatilgan bo‘lishi kerak)

### 2. Atrof-muhit o‘zgaruvchilarini sozlash (`.env`)
Loyihaning ildiz papkasida `.env` faylini yaratib, to‘ldiring:

```env
BOT_TOKEN=8123456789:AAEF... (Telegram Bot Token)
PORT=3000
WEBHOOK_URL= (Polling uchun bo‘sh qoldiring, Webhook uchun domen yuboring)
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGci...
DATABASE_URL=postgresql://postgres:password@db.xxxx.supabase.co:5432/postgres
SUPABASE_STORAGE_BUCKET=downloads
LOCAL_DOWNLOAD_DIR=./tmp/downloads
ADMIN_TELEGRAM_ID=123456789
```

### 3. Supabase Migratsiyasini bajarish
Supabase konsolida SQL Editor orqali `supabase/migrations/001_initial.sql` va `002_features.sql` fayllarini ishga tushiring. Also create `downloads` storage bucket.

### 4. Ishga tushirish buyruqlari

```bash
# Bog‘liqliklarni o‘rnatish
pnpm install

# TypeScript proyektini build qilish
pnpm build

# Bot va Workerni birgalikda dev rejimida yurgizish
pnpm dev

# Yoki alohida-alohida:
pnpm dev:bot
pnpm dev:worker
```

---

## 🚢 Deploy Rejasi (Production)

- **Database & Storage**: [Supabase](https://supabase.com) (Managed Postgres & Storage Bucket).
- **Bot & Worker Services**: [Railway.app](https://railway.app) / [Render.com](https://render.com) / [Fly.io](https://fly.io).
  - `bot`: Command `pnpm dev:bot` yoki `node apps/bot/dist/index.js`
  - `worker`: Command `pnpm dev:worker` yoki `node apps/worker/dist/index.js` (Serverda `yt-dlp` va `ffmpeg` paketlari o‘rnatilgan bo‘lishi kerak).
