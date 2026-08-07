export default async function handler(req: any, res: any) {
  try {
    const { webhookHandler } = await import("../dist/bot.js");
    return await webhookHandler(req, res);
  } catch (error) {
    console.error("Vercel bot import/runtime error:", error);
    if (res && typeof res.statusCode === "number") {
      res.statusCode = 500;
      res.setHeader("content-type", "text/plain");
      res.end(`Webhook runtime error: ${error?.message ?? String(error)}`);
    }
  }
}
