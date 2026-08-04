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

  app.get("/api/recommendations", async (req, res) => {
    try {
      const riskMode = (req.query.riskMode as string) || 'safe';
      const budget = req.query.budget ? parseInt(req.query.budget as string) : 1000;
      const fuel = (req.query.fuel as string) || 'fplform';
      const userId = (req.query.userId as string) || 'unknown';
      const tierParam = (req.query.tier as string) || 'ai-agent';
      
      // For local dev, use the tier from query parameter, fallback to ai-agent
      const tier = tierParam === 'ai-agent' ? 'ai-agent' : 'free';
      
      console.log(`[Local Dev] Request: riskMode=${riskMode}, budget=${budget}, fuel=${fuel}, tier=${tier}`);
      
      const result = await FPLService.getRecommendations(riskMode, budget, tier, fuel);
      res.json(result);
    } catch (error: any) {
      console.error("Local Dev Error:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/sync/:teamId", async (req, res) => {
    try {
      const { teamId } = req.params;
      const riskMode = (req.query.riskMode as string) || 'safe';
      const result = await FPLService.syncTeam(teamId, riskMode);
      res.json(result);
    } catch (error: any) {
      console.error("Local Dev Sync Error:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  app.use(vite.middlewares);

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[GRAND CRU] Development server running on http://localhost:${PORT}`);
  });
}

startServer();
