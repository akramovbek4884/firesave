import { webhookHandler } from "../apps/bot/dist/bot.js";

export default async function handler(req: any, res: any) {
  try {
    return await webhookHandler(req, res);
  } catch (error) {
    console.error("Vercel webhook runtime error:", error);
    if (res && typeof res.statusCode === "number") {
      res.statusCode = 500;
      res.setHeader("content-type", "text/plain");
      res.end(`Webhook runtime error: ${error?.message ?? error}`);
    }
  }
}
