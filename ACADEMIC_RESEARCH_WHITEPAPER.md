# Two-Stage Matheuristic & Sequential Decision-Making under Stochastic Non-Differentiable Rewards
## Technical Architecture & Mathematical Specification
**Author:** Michael Marquis  
**Platform:** FPL Horizon / FPL Admin V3 Quant Architecture  
**Target Domain:** High-Dimensional Discrete Combinatorial Portfolio Optimization & Sequential Stochastic Games

---

## 1. Abstract

This research formalizes a hybrid **Neuro-Symbolic and Matheuristic Optimization Architecture** designed to solve high-dimensional discrete portfolio allocation and sequential multi-period lookahead problems under non-differentiable stochastic rewards.

While conventional fantasy sports and portfolio allocation algorithms rely on unconstrained Expected Value (EV) heuristics or manually distorted multipliers, this architecture separates the **Probabilistic Alpha Predictive Engine** from the **Structural Risk Constraint Matrix**. The pipeline integrates:
1. **Stage 1 (Metaheuristic Learning)**: Population-based **Evolutionary Strategies (ES-v001)** for non-linear parameter weight discovery across noisy, discrete match features.
2. **Stage 2 (Exact Combinatorial Optimization)**: **Mixed-Integer Linear Programming (MILP)** enforcing strict capital, formation, team quotas, and behavioral rank-hedging constraints.
3. **Sequential Stochastic Search**: An 8-period lookahead **Markov Decision Process (MDP)** solved via **Multi-Horizon Beam Search**, incorporating non-linear time-decayed chip valuation functions.
4. **Neuro-Symbolic Grounding**: An autonomous Large Language Model (LLM) agent constrained to deterministic solver outputs to eliminate generative hallucination.

---

## 2. Mathematical Formulation

### 2.1 Layer 1: The Probabilistic Alpha Engine (Evolutionary Strategies ES-v001)

Football match rewards (goals, assists, clean sheets, bonus points) form a discrete, non-convex, and non-differentiable fitness landscape. Standard gradient descent algorithms (SGD, Adam) encounter vanishing gradients and local minima on discrete reward step functions.

The system utilizes an Evolutionary Strategy to optimize the feature weight vector `W = [w_1, w_2, ..., w_k]` across raw underlying metrics (xG, xA, xGI3, xGI5, minutes EWMA, set-piece involvement, home/away splits, opponent defensive index):

```
Player_xP_i = Σ (w_j × Feature_ij) × P(Minutes_i ≥ 60)
```

Each player distribution `D_i` is modeled probabilistically, extracting expected value, variance `σ_i^2`, and right-tail haul probability:
```
P_Tail_i = P(Points_i ≥ 15)
```

### 2.2 Layer 2: Mixed-Integer Linear Programming (MILP) Formulation

Let `x_i ∈ {0, 1}` denote a binary decision variable indicating the selection of player `i ∈ P` (where `|P| = 800+` candidates).

#### Objective Function (Risk-Adjusted Utility Maximization):
```
Maximize U = Σ (x_i × ExpectedPoints_i) - λ × Σ (x_i × Variance_i)
```
Where `λ ≥ 0` is the user-selected Risk Aversion Coefficient.

#### Hard Structural Constraints:
1. **Total Squad Size:** `Σ x_i = 15`
2. **Positional Quotas:**
   - Goalkeepers: `Σ (x_i | Pos_i = GKP) = 2`
   - Defenders: `Σ (x_i | Pos_i = DEF) = 5`
   - Midfielders: `Σ (x_i | Pos_i = MID) = 5`
   - Forwards: `Σ (x_i | Pos_i = FWD) = 3`
3. **Capital Budget Bound:** `Σ (x_i × Cost_i) ≤ Budget_Cap` (where `Budget_Cap = £100.0m + Bank`)
4. **Team Quota Constraint:** `Σ (x_i | Team_i = T) ≤ 3` for all Premier League teams `T`

### 2.3 Layer 3: The Behavioral Hedge & Template Shield Constraints

To prevent unconstrained solvers from taking catastrophic negative variance against heavily-owned consensus assets, the system injects behavioral risk bounds without modifying raw `xP`:

```
// Portfolio Rank Shield
Σ (x_i × EffectiveOwnership_i) ≥ Min_EO_Total      (e.g. Min_EO_Total = 250%)
Σ (x_i | EffectiveOwnership_i ≥ 40%) ≥ Min_Elite_Count

// Template Anchor Invariant (Anchor Equality Bound)
x_i = 1   for all i where EffectiveOwnership_i ≥ 60% and i ∉ Excluded_Set
```

#### Dual Shadow Price / "Cost of Insurance" Metric:
```
ΔxP = ExpectedPoints(Template_Shield) - ExpectedPoints(Quant_Optimum)
ΔEO = AverageEO(Template_Shield) - AverageEO(Quant_Optimum)
```

### 2.4 Vice-Captain Covariance Hedging

To mitigate single-point-of-failure risk from postponed fixtures, red cards, or benchings, the Vice-Captain selection incorporates a pairwise team covariance penalty:

```
ViceCaptainScore_k = CaptainScore_k - γ × Cov(Team_Captain, Team_k)
```
Where `Cov(Team_A, Team_B) = 1` if `Team_A = Team_B` and `0` otherwise, guaranteeing asset independence between Captain and Vice-Captain.

---

## 3. Multi-Horizon Markov Lookahead & Chip Residual Valuation

Squad state transitions across gameweeks `t ∈ {1, 2, ..., H}` (horizon `H = 8`) are modeled as a discrete-time Markov Decision Process:
```
State S_t = (Squad_t, Bank_t, FreeTransfers_t, ChipInventory_t, PurchasePrices_t)
```

At each stage, the **Multi-Horizon Beam Search** (beam width `K = 50`) evaluates:
1. Rolling free transfers (accumulating up to 5 FTs under 2024-2026 rules).
2. 1-to-3 player transfer permutations with capital reallocation.
3. Chip activations governed by non-linear time-decayed residual opportunity valuations:

```
Residual_BB(t) = 26.0 × (0.5 + 0.5 × (Remaining_GWs / 38))
Residual_TC(t) = 18.0 × (0.5 + 0.5 × (Remaining_GWs / 38))
Residual_WC(t) = 28.0 × (0.4 + 0.6 × (Remaining_GWs / 38))
Residual_FH(t) = 22.0 × (0.4 + 0.6 × (Remaining_GWs / 38))
```

#### Gating Conditions:
- **Bench Boost:** Explored in step 0 only if `Bench_xP ≥ 16.0` (Double Gameweek threshold).
- **Triple Captain:** Explored in step 0 only if `Captain_xP ≥ 9.5`.

---

## 4. Neuro-Symbolic LLM Agent Architecture

The natural language strategic advisor (`llm-agent.ts`) executes under a **Deterministic-First Constraint Protocol**:
1. The mathematical solver executes first, establishing proven optimal lineups, transfer vectors, and chip state invariants.
2. The LLM receives structured JSON diagnostics (Delta xP, variance, solver status, player metrics) within its system prompt.
3. The LLM generates natural language reasoning strictly within the mathematical bounds solved in Step 1, eliminating generative hallucinations.

---

## 5. Statistical Backtesting & Evaluation Methodology

The architecture includes a self-auditing backtesting engine (`BacktestDashboard.tsx` & `PerformanceView.tsx`):
* **Mean Absolute Error (MAE):** Validates point projection accuracy across out-of-sample historical seasons.
* **Ablation Testing:** Compares predictive power across the 3 modular fuels (`FPLFORM` scraped regression, `EYE-TEST` proprietary ML features, and `NATIVE` official baseline).
* **Pre-Deadline Snapshot Auditing:** Logs exact algorithmic recommendations before match kickoff and tracks real-world Cumulative Alpha generated against global top-10k averages.

---

## 6. Research Summary & Evaluation Request

This system demonstrates the effective convergence of:
1. Non-linear parameter estimation using **Evolutionary Computation**.
2. Exact combinatorial operations research via **Mixed-Integer Linear Programming**.
3. Sequential decision search using **Markov Lookahead Beam Optimization**.
4. Risk-bounded **Neuro-Symbolic Agentic AI**.

**Live Platform References:**
* Production System: [https://fplhorizon.app](https://fplhorizon.app)
* Quant Architecture Whitepaper: [https://fplhorizon.app/fpl_v3_quant_playbook.html](https://fplhorizon.app/fpl_v3_quant_playbook.html)
* Strategic Playbook: [https://fplhorizon.app/fpl_strategy_manual_updated.html](https://fplhorizon.app/fpl_strategy_manual_updated.html)
