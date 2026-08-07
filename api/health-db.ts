import type { VercelRequest, VercelResponse } from '@vercel/node';
import { loadEnvConfig, getDbPool } from '@firesave/db';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    // Validate env vars without returning secrets
    loadEnvConfig();

    // Try a lightweight DB query to verify connectivity
    const pool = getDbPool();
    await pool.query('SELECT 1');

    res.status(200).json({ ok: true, message: 'DB OK' });
  } catch (error: any) {
    console.error('health-db error:', error);
    res.status(500).json({ ok: false, message: String(error?.message ?? error) });
  }
}
