import "dotenv/config";
import express from "express";
import { createServer as createViteServer } from "vite";
import { FPLService } from "./api/index";

const app = express();
const PORT = 3000;

async function startServer() {
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: "spa",
  });

  // Request Logging
  app.use((req, res, next) => {
    console.log(`[REQUEST] ${req.method} ${req.url}`);
    next();
  });

  // Body parser for POST requests
  app.use(express.json());

  // Local API Proxies to the Unified FPLService

  // Vercel serverless function proxy for local dev
  app.post("/api/create-checkout", async (req, res) => {
    try {
      const checkoutHandler = (await import("./api/create-checkout")).default;
      await checkoutHandler(req, res);
    } catch (error: any) {
      console.error("Local Dev Checkout Error:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  app.all("/api/user-profile", async (req, res) => {
    try {
      const handler = (await import("./api/user-profile")).default;
      await handler(req, res);
    } catch (error: any) {
      console.error("Local Dev Profile Error:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  app.all("/api/admin*", async (req, res) => {
    try {
      const adminHandler = (await import("./api/admin")).default;
      await adminHandler(req as any, res as any);
    } catch (error: any) {
      console.error("Local Dev Admin Error:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  app.all("/api/agent*", async (req, res) => {
    try {
      const handler = (await import("./api/index")).default;
      await handler(req as any, res as any);
    } catch (error: any) {
      console.error("Local Dev Agent Error:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  app.all("/api/snapshots*", async (req, res) => {
    try {
      const handler = (await import("./api/snapshots")).default;
      await handler(req as any, res as any);
    } catch (error: any) {
      console.error("Local Dev Snapshots Error:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  app.all("/api/decision-logs*", async (req, res) => {
    try {
      const handler = (await import("./api/decision-logs")).default;
      await handler(req as any, res as any);
    } catch (error: any) {
      console.error("Local Dev Decision Logs Error:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/user", async (req, res) => {
    try {
      const userId = req.query.userId as string;
      // For local dev, hardcode your tier
      const tier = userId === 'XpmBVLzU0ZOqmofB7RVXHN0HctI3' ? 'ai-agent' : 'free';
      res.json({ tier });
    } catch (error: any) {
      console.error("Local Dev User Error:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  app.all("/api/recommendations", async (req, res) => {
    try {
      const riskMode = ((req.query.riskMode || req.body?.riskMode) as string) || 'safe';
      const budget = (req.query.budget || req.body?.budget) ? parseInt((req.query.budget || req.body?.budget) as string) : 1000;
      const fuel = ((req.query.fuel || req.body?.fuel) as string) || 'fplform';
      const userId = ((req.query.userId || req.body?.userId) as string) || 'unknown';
      const tierParam = ((req.query.tier || req.body?.tier) as string) || 'ai-agent';
      const tier = tierParam === 'ai-agent' ? 'ai-agent' : 'free';
      const scenario = ((req.query.scenario === 'template' || req.body?.scenario === 'template') ? 'template' : 'quant') as 'quant' | 'template';

      const lockedStr = (req.query.locked as string) || req.body?.locked || '';
      const excludedStr = (req.query.excluded as string) || req.body?.excluded || '';
      const lockedIds = Array.isArray(req.body?.lockedIds) 
        ? req.body.lockedIds 
        : (lockedStr ? lockedStr.split(',').map((s: string) => parseInt(s.trim())).filter((n: number) => !isNaN(n)) : []);
      const excludedIds = Array.isArray(req.body?.excludedIds) 
        ? req.body.excludedIds 
        : (excludedStr ? excludedStr.split(',').map((s: string) => parseInt(s.trim())).filter((n: number) => !isNaN(n)) : []);
      const skipComparison = req.query.skipComparison === 'true' || req.body?.skipComparison === true;
      const targetGw = (req.query.gw || req.body?.gw) ? parseInt((req.query.gw || req.body?.gw) as string, 10) : undefined;
      
      console.log(`[Local Dev] Recommendations: riskMode=${riskMode}, budget=${budget}, fuel=${fuel}, scenario=${scenario}, locked=${lockedIds.length}, excluded=${excludedIds.length}, tier=${tier}`);
      
      const result = await FPLService.getRecommendations(
        riskMode, 
        budget, 
        tier, 
        fuel, 
        scenario, 
        lockedIds, 
        excludedIds, 
        targetGw, 
        skipComparison
      );
      res.json(result);
    } catch (error: any) {
      console.error("Local Dev Recommendations Error:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  app.all("/api/sync/:teamId", async (req, res) => {
    try {
      const { teamId } = req.params;
      const riskMode = ((req.query.riskMode || req.body?.riskMode) as string) || 'safe';
      const fuel = ((req.query.fuel || req.body?.fuel) as string) || 'fplform';
      const tier = ((req.query.tier || req.body?.tier) as string) || 'free';
      const targetGw = (req.query.gw || req.body?.gw) ? parseInt((req.query.gw || req.body?.gw) as string, 10) : undefined;
      const scenario = ((req.query.scenario === 'template' || req.body?.scenario === 'template') ? 'template' : 'quant') as 'quant' | 'template';

      console.log(`[Local Dev] Sync: teamId=${teamId}, riskMode=${riskMode}, fuel=${fuel}, scenario=${scenario}, tier=${tier}`);
      const result = await FPLService.syncTeam(teamId, riskMode, tier, fuel, targetGw, scenario);
      res.json(result);
    } catch (error: any) {
      console.error("Local Dev Sync Error:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/live/:eventId", async (req, res) => {
    try {
      const { eventId } = req.params;
      const axios = (await import('axios')).default;
      const [liveRes, fixturesRes] = await Promise.all([
        axios.get(`https://fantasy.premierleague.com/api/event/${eventId}/live/`, {
          headers: { "User-Agent": "Mozilla/5.0" }
        }),
        axios.get(`https://fantasy.premierleague.com/api/fixtures/?event=${eventId}`, {
          headers: { "User-Agent": "Mozilla/5.0" }
        }).catch(() => ({ data: [] }))
      ]);
      res.json({
        elements: liveRes.data.elements,
        fixtures: fixturesRes.data || []
      });
    } catch (error: any) {
      console.error("Local Dev Live Error:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/ping", (req, res) => {
    res.json({ status: "ok", message: "Grand Cru Engine Online" });
  });

  // Serve data/ directory as static /data route (backtest results, CSV, etc.)
  app.use('/data', express.static('data'));

  app.use(vite.middlewares);

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[GRAND CRU] Development server running on http://localhost:${PORT}`);
  });
}

startServer();
