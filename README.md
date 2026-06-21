# FPL Horizon V3: Quant Engine

[![Live App](https://img.shields.io/badge/Live-fplhorizon.app-00ff86?style=for-the-badge)](https://fplhorizon.app/)
[![Quant Whitepaper](https://img.shields.io/badge/Docs-Quant_Whitepaper-bd1a62?style=for-the-badge)](https://fplhorizon.app/fpl_v3_quant_playbook.html)
[![Strategy Playbook](https://img.shields.io/badge/Docs-Strategy_Playbook-bd1a62?style=for-the-badge)](https://fplhorizon.app/fpl_strategy_manual_updated.html)

An elite Fantasy Premier League (FPL) optimization engine built on **Constrained Portfolio Theory**, **Linear Programming (LP)**, and **Generative AI**. The V3 Engine abandons flawed raw "Expected Points" (xP) models in favor of a true Hedge-Fund grade positioning system that balances variance capture and mathematical rank protection.

## 🚀 The V3 Architecture

Winning FPL is not an optimization problem—it is a Positioning and Variance Capture system. The V3 Engine separates the "Truth Engine" (Expected Value) from the "Risk Overlay" (Expected Ownership) to generate the optimal mathematical squad.

### 🧠 The Core Components

1. **Constrained Portfolio Optimizer (`api/_lib/lp-solver.ts`)**
   - Built on `javascript-lp-solver`.
   - Natively understands FPL constraints (Budget limits, 2/5/5/3 positional rules, 3-players-per-team limits).
   - Dynamically injects Top 1k Manager Expected Ownership (EO) constraints based on the user's selected Risk Profile.

2. **The 3 Strategy Modes**
   - **🛡️ SAFE MODE:** The Rank Shield. Enforces strict EO constraints (`eo_total >= 250` and `elite_eo_count >= 1`). Forces the solver to buy highly-owned elite players to protect your rank against the hive-mind consensus.
   - **🎯 RISKY MODE:** The Variance Hunter. Drops all EO constraints and optimizes purely for total Expected Value (EV). Buys high-upside differentials to attack rank.
   - **💸 VALUE MODE:** The Efficiency Engine. Drops all EO and overall score constraints to maximize pure **Points-Per-Million (£)**. Exposes underpriced gems and actively rejects expensive premium players.

3. **The Autonomous Data Pipeline (`scripts/`)**
   - **Sniper Bot:** A GitHub Action (`.github/workflows/sniper-fetch.yml`) wakes up every hour and checks the Official FPL API for the upcoming deadline.
   - Exactly 1-2 hours before the deadline (the "Golden Window"), it scrapes the freshest xP data from FPLForm and live Elite Manager Sentiment from Top 1k accounts.
   - **Marketing Bot:** A headless Playwright script (`capture-dashboard.js`) autonomously screenshots the live dashboard and updates the marketing assets to prove the engine's validity.
   - Commits and deploys the new data directly to Vercel without human intervention.

4. **Groq AI Agent (`api/agent/ask.ts`)**
   - A natural language FPL assistant powered by blazing-fast Groq models.
   - Acts as a Beta Pilot, parsing press conferences, injury reports, and tactical nuances that pure mathematics might miss.

## 💳 Monetization & Tiers

The Horizon engine is fully monetized using Stripe and Firebase Auth, offering distinct tiers:
- **Free Tier**: Basic Pitch View and xP metrics.
- **Strategist Tier (£9.99/mo)**: Unlocks the full Constrained Portfolio Optimizer and the 3 Strategy Modes (SAFE, RISKY, VALUE).
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

4. Trigger the Autonomous Sniper Bot locally:
```bash
npx tsx scripts/fetch-xp.ts
npx tsx scripts/fetch-top-1k.ts
```

## ☁️ Vercel Deployment

This project is perfectly tuned for Vercel Serverless Functions. The LP solver executes its complex constraint matrix in milliseconds, ensuring lightning-fast squad generation before Vercel timeouts.

To deploy manually:
```bash
npx vercel --prod
```
