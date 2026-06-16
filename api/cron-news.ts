import type { VercelRequest, VercelResponse } from '@vercel/node';
import { generateAndCacheNewsContext } from './_lib/news-service.js';
import { FPLService } from './index.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Validate it's from Vercel Cron or authorize it
  const authHeader = req.headers.authorization;
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized cron execution" });
  }

  try {
    const { players } = await FPLService.getBaseData();
    const context = await generateAndCacheNewsContext(players);
    
    if (!context) {
      return res.status(200).json({ status: "skipped", message: "News generation skipped (locked or no news)" });
    }
    
    return res.status(200).json({ status: "success", context });
  } catch (error: any) {
    console.error("[CRON NEWS] Error generating news:", error);
    return res.status(500).json({ error: "Failed to generate news", message: error.message });
  }
}
