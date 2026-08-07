import { webhookHandler } from "../apps/bot/src/bot";

export default async function handler(req: unknown, res: unknown) {
  try {
    return await webhookHandler(req as any, res as any);
  } catch (error) {
    console.error("Webhook function error:", error);
    if (res && typeof (res as any).statusCode === "number") {
      (res as any).statusCode = 500;
      (res as any).end?.("Webhook handler error");
    }
  }
}
