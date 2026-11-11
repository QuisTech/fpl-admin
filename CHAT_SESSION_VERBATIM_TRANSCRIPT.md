

---

## User
So I want to know how career tab is powered by any of the mode, strategies and scenarios?

---

## Assistant

### How the Career Tab Is Powered: Modes, Strategies (Fuels & Risk Profiles), and Scenarios

The **Career Tab** is the long-term managerial command center of the application. Unlike single-gameweek static solvers that only pick a 1-week team in isolation, the Career Tab evaluates **temporal continuity across the entire 38-gameweek season**:
- Preserving financial equity and bank balances with official FPL sell-on tax rules (50% profit retention).
- Banking and rolling Free Transfers (accumulating up to 5 FTs under the 2026/27 rules).
- Enforcing zero-hit discipline to prevent the negative 4-point penalty trap.
- Calculating automatic bench substitutions and captaincy multipliers.
- Planning chip deployment across Set 1 (GW1–GW19) and Set 2 (GW20–GW38).

The Career Tab is powered by a 3-dimensional decision matrix: **3 Modes × 3 Fuels × 3 Risk Profiles × 2 Scenarios = 18 Distinct Permutations**.

---

### 1. The 3 Career Modes (How the Simulation Runs)

In [`CareerModeView.tsx`](file:///c:/Users/USER/Documents/fpl-admin/src/components/CareerModeView.tsx#L112-L120) and [`CareerService`](file:///c:/Users/USER/Documents/fpl-admin/api/_lib/career-service.ts#L276-L301), you can toggle between three operational modes:

| Mode | Core Concept | How It Operates |
| :--- | :--- | :--- |
| **Autonomous AI Mode** (`mode: 'autonomous'`) | Pure AI Managerial Career | Builds a fresh £100.0m squad in GW1 and manages the team autonomously across the season with zero human intervention. Solves transfers, captaincy, and lineups week-by-week. |
| **You vs AI Duel / AI Co-Pilot** (`mode: 'synced'`) | Head-to-Head Managerial Duel | Starts from **your actual human squad** in GW1. Every week, it evaluates what the AI Co-Pilot would have done with your exact team vs what you actually did, tracking net point **Alpha**. |
| **Forward Career Roadmap** (`mode: 'forward'`) | 6-Week Predictive Lookahead | Projects a rolling 6-gameweek horizon (GW11 → GW16) using Model Predictive Control (MPC) from either your live squad or the autonomous squad, charting future transfers, captaincy, and chip windows. |

---

### 2. The 3 Predictive Fuels (The Data Engine)

The **Fuel** selection determines which statistical oracle computes expected points (xP) for each player ([`CareerService.getOracleForGw`](file:///c:/Users/USER/Documents/fpl-admin/api/_lib/career-service.ts#L210-L241)):

- **Native FPL (`fuel: 'native'`):**
  - Powered directly by the official Premier League API.
  - Combines official ICT (Influence, Creativity, Threat) metrics, underlying expected goals (xG) and expected assists (xA), official form, fixture difficulty ratings (FDR), and home/away advantage splits.
  - *Best for:* Robust, grounded decision-making that avoids volatile external model swings.
- **FPLForm (`fuel: 'fplform'`):**
  - Powered by machine learning and predictive statistical regression.
  - Uses Bayesian shrinkage to dampen short-term noise and exponential smoothing on historical performance over a rolling window.
  - *Best for:* Chasing emerging form trends and medium-term schedule swings.
- **Eye Test (`fuel: 'eye-test'`):**
  - Qualitative and tactical threat model.
  - Weights box touches, key chances created, positional shifts, and tactical eye-test scouting indicators.
  - *Best for:* Identifying explosive differentials before their points appear on the official stat sheet.

---

### 3. The 3 Risk Profiles (Managerial Risk vs Reward)

In [`getParamsForRiskMode`](file:///c:/Users/USER/Documents/fpl-admin/api/_lib/projection.ts#L68-L125), the risk mode tunes the mathematical objective function of the Linear Programming (LP) solver:

- **Safe (`riskMode: 'safe'`):**
  - **Philosophy:** Low variance, capital preservation, and rank defense.
  - **Behavior:** Anchors the starting XI to elite talisman premiums (e.g. Haaland, Gabriel), avoids taking point hits, demands higher projected point gain before making a transfer, and prioritizes guaranteed minutes.
- **Aggressive (`riskMode: 'aggressive'`):**
  - **Philosophy:** High ceiling, variance chasing, and differential hunting.
  - **Behavior:** Applies a high variance bonus (`betaVariance = 0.8`), rewards explosive low-ownership punts (`betaDifferential = 4.0`), and is willing to execute tactical transfers for high-ceiling matchday fixtures.
- **Value (`riskMode: 'value'`):**
  - **Philosophy:** Economic capital efficiency.
  - **Behavior:** Optimizes for Points-Per-Million (PPM), builds long-term squad value, and maintains bank flexibility to enable effortless future upgrades.

---

### 4. The 2 Strategic Scenarios (Game-Theoretic Defense vs Pure Math)

The scenario controls how the AI reacts to the wider FPL community:

- **Template Shield (`scenario: 'template'`):**
  - **Philosophy:** Game-Theoretic Rank Protection.
  - **Behavior:** Factors in Effective Ownership (EO) among the top 10,000 managers (`betaEO = 2.5`, `minEoTotal = 180`). If an elite player is owned by 70%+ of the top managers, the AI shields your rank by owning them, ensuring you don't plummet down the leaderboard when the consensus template hauls.
- **Quant Optimal (`scenario: 'quant'`):**
  - **Philosophy:** Pure Mathematical Knapsack Optimization.
  - **Behavior:** Completely ignores crowd psychology and ownership percentages (`betaEO = 0.0`). It evaluates players strictly on raw projected points divided by cost, building the mathematically highest-scoring 15-man squad without caring whether a player is 2% owned or 80% owned.

---

### 5. Summary: Why `Native | Safe | Template Shield` Currently Leads

When all 18 permutations are run across the 10 completed gameweeks:
- The **Quant Optimal** models chased volatile mathematical ceilings, which caused variance when budget punts blanked.
- The **Aggressive** models rotated too frequently, sacrificing squad stability.
- **`Native | Safe | Template Shield`** emerged as the undisputed #1 leader (**660 pts Autonomous, 678 pts Co-Pilot Duel**):
  1. It relied on solid Premier League underlying data (`Native`).
  2. It refused to take negative hits and anchored to reliable premium performers (`Safe`).
  3. It protected against rank drops by holding the high-ownership template core (`Template Shield`).
  4. It patiently banked 4 free transfers and kept £8.6m in reserve, leaving it perfectly primed for upcoming gameweeks.
