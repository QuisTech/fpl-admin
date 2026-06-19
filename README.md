# FPL Horizon

[![Live App](https://img.shields.io/badge/Live-fplhorizon.app-00ff86?style=for-the-badge)](https://fplhorizon.app/)
[![Strategy Playbook](https://img.shields.io/badge/Docs-Strategy_Playbook-bd1a62?style=for-the-badge)](https://fplhorizon.app/fpl_strategy_manual_updated.html)

An elite Fantasy Premier League (FPL) optimization engine that uses **Multi-Horizon Beam Search**, **Linear Programming (LP)**, and **Generative AI** to project the absolute mathematical and contextual optimum for your squad.

## 🚀 The V3 Architecture

Unlike traditional FPL tools that only look at the immediate upcoming gameweek, the FPL Horizon Engine simulates multiple gameweeks into the future. It traverses thousands of potential squad states, evaluating the mathematical Expected Value (EV) of free transfers, points hits, and chip usage.

### 🧠 The Core Components
1. **The Multi-Horizon Simulator (`api/simulator.ts`)**
   - Implements a Beam Search algorithm to explore the massive combinatorial tree of future Gameweeks.
   - Natively understands FPL constraints (Budget limits, 2/5/5/3 positional rules).
   - Tracks the **Chip State Machine**, allowing it to autonomously decide when to play `Wildcard`, `Free Hit`, `Bench Boost`, or `Triple Captain`.

2. **The LP Solver (`api/lp-solver.ts`)**
   - Built on `javascript-lp-solver`.
   - Used heavily during `Wildcard` and `Free Hit` simulation branches. When a chip is played in a simulated future, the Simulator passes the exact available budget to the LP Solver, which instantly returns the mathematically perfect 15-man squad for that Gameweek horizon.

3. **Groq AI Agent (`api/agent/ask.ts`)**
   - A natural language FPL assistant powered by blazing-fast Groq models.
   - The agent acts as a Beta Pilot, parsing press conferences, injury reports, and tactical nuances that pure mathematics might miss, giving users an edge in their decision-making.

4. **The Autonomous Oracle (`scripts/fetch-xp.ts` & `scripts/check-deadline.ts`)**
   - Powered by Expected Points (xP) data ingested from FPLForm.
   - We utilize a **"Sniper Bot"** GitHub Action (`.github/workflows/sniper-fetch.yml`). 
   - Every hour, the bot checks the Official FPL API for the upcoming deadline. Exactly 1-2 hours before the deadline (after all press conferences and leaks), it fires up a headless Playwright browser, scrapes the freshest xP data, and commits it back to the repository autonomously.

## 💳 Monetization & Tiers

The Horizon engine is fully monetized using Stripe and Firebase Auth, offering distinct tiers:
- **Free Tier**: Basic Pitch View and xP metrics.
- **Strategist Tier (£9.99/mo)**: Unlocks the full Multi-Horizon Simulation Engine and LP Solver for multi-gameweek transfer planning.
- **Beta Pilot Tier (£49.99/mo)**: Unlocks the elite Groq AI Agent, providing full contextual analysis and natural language tactical advice.

## ⚙️ Running Locally

1. Install dependencies:
```bash
npm install
```

2. Configure Environment Variables (`.env`):
Set up your Firebase credentials, Stripe secret keys, and Groq API keys.

3. Run the development server:
```bash
npm run dev
```

4. Test the V3 Engine locally (without spinning up the frontend):
```bash
npx tsx test_api.ts
```

## ☁️ Vercel Deployment

This project is perfectly tuned for Vercel. Because Vercel serverless functions have strict execution time limits, the Simulator automatically scales its `beamWidth` and `maxDepth` based on the environment to ensure it always returns a result before the Vercel timeout.

To deploy manually:
```bash
npx vercel --prod
```
