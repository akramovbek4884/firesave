import { webhookHandler } from "../apps/bot/src/bot";

export default async function handler(req: any, res: any) {
  try {
    await webhookHandler(req, res);
  } catch (error) {
    console.error("Webhook function error:", error);
    if (res && typeof res.statusCode === "number") {
      res.statusCode = 500;
      res.end("Webhook handler error");
    }
  }
}
