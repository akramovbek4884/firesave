import { Bot, webhookCallback } from 'grammy';
import 'dotenv/config';

interface VercelRequest {
  method?: string;
  body?: unknown;
}

interface VercelResponse {
  status(code: number): VercelResponse;
  json(payload: unknown): void;
}

const botToken = process.env.BOT_TOKEN;

if (!botToken) {
  throw new Error('BOT_TOKEN is missing. Set it in Vercel environment variables.');
}

const bot = new Bot(botToken);
const handle = webhookCallback(bot, 'stdHTTP');

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'POST') {
    await handle(req, res);
    return;
  }

  res.status(200).json({ ok: true, service: 'firesave-webhook' });
}
