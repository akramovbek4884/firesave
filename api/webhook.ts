import { Bot, webhookCallback } from 'grammy';
import 'dotenv/config';

interface VercelRequest {
  method?: string;
  body?: unknown;
  headers?: Record<string, string | undefined>;
}

interface VercelResponse {
  status(code: number): VercelResponse;
  json(payload: unknown): VercelResponse;
  send(payload: unknown): VercelResponse;
  end?: (payload?: string) => VercelResponse;
}

const botToken = process.env.BOT_TOKEN;

if (!botToken) {
  throw new Error('BOT_TOKEN is missing. Set it in Vercel environment variables.');
}

const bot = new Bot(botToken);
const handle = webhookCallback(bot, 'stdHTTP');

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'POST') {
    try {
      await handle(req as never, res as never);
    } catch (error) {
      console.error('Webhook error:', error);
      res.status(500).json({ ok: false, error: 'Webhook failed' });
    }
    return;
  }

  res.status(200).json({ ok: true, service: 'firesave-webhook' });
}
