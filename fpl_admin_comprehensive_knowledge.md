# Comprehensive fpl-admin Knowledge Base

This document represents the consolidated knowledge of the `fpl-admin` project discussed to date. It serves as a unified reference architecture for the system's data pipeline, strategy modes, and optimization framework.

---

## 1. Project Ecosystem & Architecture

`fpl-admin` represents the "Final Boss" of deterministic FPL optimization in this workspace (Tier 4). It is a quant-grade SaaS application that separates clean Expected Value (EV)/Variance objective functions from explicit portfolio constraints.

### Core Architecture
- **Objective Purity**: Expected Value (EV) scores are strictly mathematically driven and are not mutated by crowd sentiment or Effective Ownership (EO) multipliers to ensure clean alpha generation.
- **Constrained Portfolio Optimization**: Instead of faking scores to ensure safety, the engine enforces strict, calibrated mathematical bounds in "Safe Mode" (`eo_total >= 250` and `elite_eo_count >= 1`). This acts as a true "Rank Shield" guaranteeing market defense without suffocating the engine's ability to find alpha.
- **Beam Search Integration**: The Constrained LP Solver runs in perfect harmony with a Multi-Horizon Beam Search. The Beam Search acts as the "Time Traveler" traversing 8-week parallel universes, while the LP Solver acts as the "Accountant," calculating the mathematically perfect legal squad at each simulation step.
- **Variance-Aware Utility Deformation**: The LP solver explicitly calculates variance over the horizon and penalizes or rewards it based on risk mode *before* solving.
- **Terminal Chip Valuation**: Fixes the simulation "Horizon Effect" by assigning abstract holding values to unused chips (e.g., Wildcard = 25pts), preventing the engine from burning them prematurely.
- **News Intelligence**: Employs a background FPL news intelligence layer to aid decision-making.

---

## 2. Data Pipeline: How `data/` Powers the Engine

The engine relies fundamentally on three data files:

### A. `fplform.csv` (The Brain)
- **Source**: Scraped via a headless Playwright script (`scripts/fetch-xp.ts`) from `fplform.com/fpl-predicted-points`.
- **Contents**: ~841 players featuring Merit (composite quality score), Prob. of Appearing, Cost, and other metrics.
- **Role**: This is the single most important file. The `CSVOracle` (`api/_lib/ingestion.ts`) reads this to match FPL API IDs, compute exact appearance probabilities (P90 vs P60), and construct both the **xP Matrix** and **Variance Matrix** projecting 15 gameweeks forward based on fixture difficulty and time-decay factor (0.9^step).

### B. `fplform_scraped.csv` (The Testing Variant)
- **Contents**: The identical player data as `fplform.csv`, but sorted by Merit and enriched with filter metadata headers (team counts, position counts, price bands).
- **Role**: Used exclusively by `run_sim.ts` for standalone simulation testing. Production APIs rely on `fplform.csv`.

### C. `top_1000_eo.json` (The Herd Intelligence)
- **Source**: Constructed by `scripts/fetch-top-1k.ts` which queries the FPL API to analyze the current top 1,000 managers in the world (skipping Free Hit managers).
- **Contents**: Ownership%, Started%, Effective Ownership (EO%), Captain%, and Triple-Captain% for every player.
- **Role**: Feeds the competitive intelligence layer. Integrated by `CSVOracle` so every player has an EO and ownership metric, which is crucial for constraints in the LP solver during specific strategy modes.

---

## 3. Strategy Modes: Brain + Herd Combination

The system features two distinct flows based on whether a user's actual FPL team has been synced.

### Flow A: Pre-Sync (`/api/recommendations`)
Builds an optimal squad from scratch.

- **Free Tier**: Returns simple top-pick selections sorted by raw xP (e.g., top 5 MIDs, top 3 FWDs).
- **Paid / Admin Tiers**: Runs `solveOptimalSquad()`. The mathematical formulation diverges based on Risk Mode:
    - **SAFE**: `Utility = xP - 0.5 * Variance`. Punishes volatility. Enforces Herd constraints (`eo_total >= 250%` and `>= 1` elite EO player).
    - **AGGRESSIVE**: `Utility = xP + 0.7 * Variance`. Rewards volatility. No Herd constraints.
    - **VALUE**: `Utility = xP / Cost`. Maximizes points per million. No Herd constraints.
  
  *Premium Captaincy Boost*: In SAFE and AGGRESSIVE modes, expensive players (>= 10.0m and >= 8.0m) receive artificial utility boosts (1.15x and 1.08x respectively) to simulate the persistent value of having an elite captaincy option.

### Flow B: Post-Sync (`/api/sync/:teamId`)
Recommends transfers based on the existing squad.

- **Initial Setup**: Fetches the user's current 15 picks.
- **Simulator Execution**: Premium tiers leverage the Multi-Horizon Beam Search Simulator (`simulator.ts`) projecting up to 8 gameweeks wide (width: 50 states).
- **Utility & Risk (Lambda)**: 
  Each gameweek's utility is scored as `gwPoints - (lambda * gwVariance) - hitCost`.
    - **SAFE**: lambda = 0.15 (Heavily penalizes variance).
    - **AGGRESSIVE**: lambda = 0.02 (Almost ignores variance).
    - **VALUE**: lambda = 0.05 (Default balanced).
- **Transfer & Chip Logic**:
  The best first action from the simulator becomes the primary recommendation. If the 8-week mathematical simulation path demands a Wildcard, it advises a STRONG BUY on that chip.

---

## Summary
The `fpl-admin` quant engine represents a mature integration of independent data scraping (`fetch-xp.ts`), FPL API crowd wisdom (`fetch-top-1k.ts`), deterministic operations research (LP Solver), and AI-driven parallel universe modeling (Beam Search), packaged into a deployable Vercel/Firebase SaaS layer.
