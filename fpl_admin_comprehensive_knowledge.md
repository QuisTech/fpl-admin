# Comprehensive fpl-admin Knowledge Base (Extended V3)

This document is the ultimate, exhaustive reference architecture for the `fpl-admin` project (Horizon V3 Engine), capturing every quantitative mechanism, autonomous pipeline, monetization structure, infrastructure setup, and AI integration ever discussed since the beginning of this workspace.

---

## 1. Project Ecosystem & V3 Architecture

`fpl-admin` operates as a Hedge-Fund grade FPL positioning system (Tier 4). It abandons flawed, purely deterministic Expected Points (xP) models in favor of a dual-engine approach: separating the **"Truth Engine"** (Expected Value) from the **"Risk Overlay"** (Expected Ownership constraints).

### Core Mathematical Logic
- **Objective Purity**: Expected Value (EV) scores are mathematically pure and unmutated by crowd sentiment or Effective Ownership (EO) multipliers, ensuring clean alpha generation.
- **Constrained Portfolio Optimization**: Instead of faking scores to ensure safety, the engine enforces strict, calibrated bounds in "Safe Mode". This guarantees market defense (Rank Shield) while allowing the engine to find alpha.
- **Time-Decay Value Weighting**: Future predictions are inherently less valuable. The LP solver employs a `0.85^i` decay multiplier on gameweek horizons, forcing the engine to prioritize immediate, reliable points over distant "maybe" points.
- **Constraint Relaxation (Crash Prevention)**: In chaotic gameweeks (e.g., massive blanks) where Top 1k managers are highly fragmented, the Safe Mode constraints are designed to automatically relax from `eo_total: 300`, `elite_eo_count: 2` down to `eo_total: 200`, `elite_eo_count: 1`. This fallback prevents `javascript-lp-solver` from returning `null` and crashing the application.
- **Terminal Chip Valuation**: Fixes the simulation "Horizon Effect" by assigning abstract holding values to unused chips (e.g., Wildcard = 25pts), preventing the engine from burning them prematurely.

---

## 2. Monetization & Subscription Tiers

The Horizon engine is fully monetized. The backend routes adjust optimization depth based on these tiers:

- **Free Scout (£0)**: Basic 1-gameweek squad view and safe-mode recommendations. Only utilizes raw xP sorting (top N per position), never hitting the LP solver or Herd data.
- **Horizon Strategist (£9.99/mo)**: Unlocks the full Constrained Portfolio Optimizer (LP) with access to the 3 Strategy Modes (SAFE, AGGRESSIVE, VALUE) and team synchronization.
- **Horizon Grand Cru (£24.99/mo)**: Unlocks the V3 Multiverse Engine for 8-gameweek beam-search simulations, multi-transfer LP optimization, and autonomous chip state guidance.
- **AI Optimizer Agent / Beta Pilot (£49.99/mo)**: The flagship Hybrid FPL Agent combining LLM reasoning with mathematical simulation. Includes conversational chat, press conference parsing, and priority solver access.

**Payment Gateways**: The application integrates both **Stripe** and **DodoPayments** (`dodopayments` SDK) for checkout sessions, dynamically switching between environments (test mode vs live mode). Firebase Auth maps user UID to subscription claims.

---

## 3. Data Pipeline: How `data/` Powers the Engine

The engine relies fundamentally on three autonomous data pipelines updating in the background.

### A. Autonomous Sniper Bot & `fplform.csv`
- **Mechanism**: A GitHub Action (`.github/workflows/sniper-fetch.yml`) wakes up every hour to check the Official FPL API for the deadline. In the "Golden Window" (1-2 hours before the deadline), the headless Playwright script `scripts/fetch-xp.ts` autonomously scrapes the freshest data from `fplform.com/fpl-predicted-points`.
- **Role**: This creates the foundation for the `CSVOracle` (`api/_lib/ingestion.ts`) to construct both the **xP Matrix** and **Variance Matrix** projecting 15 gameweeks forward based on fixture difficulty and the time-decay factor. A marketing bot (`capture-dashboard.js`) concurrently screenshots the live dashboard to update marketing assets autonomously.

### B. The Herd Intelligence (`top_1000_eo.json`)
- **Mechanism**: Built by `scripts/fetch-top-1k.ts`, which queries the FPL API to analyze the current Top 1,000 FPL managers (skipping Free Hit managers to reduce noise).
- **Contents**: Stores Ownership%, Started%, Effective Ownership (EO%), Captain%, and Triple-Captain% for every player.
- **Role**: Feeds the Risk Overlay. It allows the solver to inject strict EO constraints into `SAFE` mode to mimic elite hedge coverage.

### C. The FPL Intelligence Layer (Cron News Pipeline)
- **Mechanism**: A decoupled Vercel cron job (`/api/cron-news.ts`) fetches news from `/r/FantasyPL/search.json` every 4 hours.
- **LLM Parsing**: An LLM (adapted to Gemini with fallback mechanisms) parses the Reddit feed into structured FPL contexts (injuries, returns, etc.) and fuzzy-matches against the current player dataset to assign accurate `playerId`s.
- **Storage**: The parsed output is cached in Firestore under `fpl_news_context`, using a `news_lock` to prevent race conditions.
- **Role**: When users interact with the Beta Pilot (via `/api/agent/ask`), it reads instantly from the Firestore cache, avoiding API quota spikes and ensuring it filters `validTargets` to avoid recommending injured players before executing its "High-Compression Prompt Injection."

---

## 4. Strategy Modes: Brain + Herd Combination

The system features two distinct flows based on whether a user's actual FPL team has been synced.

### Flow A: Pre-Sync (`/api/recommendations`)
Builds an optimal squad from scratch. The mathematical formulation diverges based on Risk Mode:
- **SAFE**: `Utility = xP - 0.5 * Variance`. Punishes volatility. Enforces Herd constraints (`eo_total >= 250%` and `>= 1` elite EO player).
- **AGGRESSIVE**: `Utility = xP + 0.7 * Variance`. Rewards volatility. No Herd constraints.
- **VALUE**: `Utility = xP / Cost`. Maximizes points per million. No Herd constraints.

*Premium Captaincy Boost*: In SAFE and AGGRESSIVE modes, expensive players (>= 10.0m and >= 8.0m) receive artificial utility boosts (1.15x and 1.08x respectively) to simulate the persistent value of having an elite captaincy option.

### Flow B: Post-Sync (`/api/sync/:teamId`)
Recommends transfers based on the existing squad.
- **Simulator Execution**: Premium tiers leverage the Multi-Horizon Beam Search Simulator (`simulator.ts`) projecting up to 8 gameweeks wide (width: 50 states).
- **Utility & Risk (Lambda)**: 
  Each gameweek's utility is scored as `gwPoints - (lambda * gwVariance) - hitCost`.
    - **SAFE**: lambda = 0.15 (Heavily penalizes variance).
    - **AGGRESSIVE**: lambda = 0.02 (Almost ignores variance).
    - **VALUE**: lambda = 0.05 (Default balanced).
- **Transfer & Chip Logic**: The best first action from the simulator becomes the primary recommendation. If the 8-week mathematical simulation path demands a Wildcard, it advises a STRONG BUY on that chip.

---

## 5. Engineering & Infrastructure

- **Data Validation Layer**: Employs **Zod schemas** (`FPLPlayer`, `FPLTeam`, `FPLFixture`) mapped to the official FPL API responses. If the FPL API unexpectedly changes its schema, the application fails explicitly with an error rather than generating corrupt recommendations.
- **Local Proxy Server**: Uses a custom `server.ts` utilizing `express` and `vite` in middleware mode. It proxies local development requests directly to Vercel Serverless functions (`/api/create-checkout`, `/api/user-profile`) allowing complete end-to-end testing of Firebase/Payments/Solver logic offline.
- **Serverless Architecture**: Perfectly tuned for Vercel. The LP solver executes its complex constraint matrix (simulating thousands of multi-horizon paths) in milliseconds, ensuring squad generation occurs rapidly before Vercel timeouts trigger.

---

## Summary
The `fpl-admin` quant engine represents a true masterpiece of Serverless engineering. It seamlessly binds headless browser scraping, FPL API crowd wisdom, operations research (LP Solver), AI-driven parallel universe modeling (Beam Search), LLM news analysis (Gemini/Groq), and Stripe/Dodo monetization into a unified Vercel application.
