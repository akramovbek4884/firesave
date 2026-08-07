import { webhookHandler } from "../apps/bot/src/bot";

interface VercelRequest {
  method?: string;
  body?: unknown;
  headers?: Record<string, string | undefined>;
}

interface VercelResponse {
  status(code: number): VercelResponse;
  json(payload: unknown): VercelResponse;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "POST") {
    await webhookHandler(req as never, res as never);
    return;
  }

  res.status(200).json({ ok: true, service: "firesave-webhook" });
}
