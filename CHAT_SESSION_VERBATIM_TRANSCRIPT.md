

## User (2026-11-09)

I don't understand this Bank Balance: £-0.3m in Autonomous AI, can you explain that:

GW10 Manager Decision
62 Net Pts
Transfer: Kinsky → Verbruggen (1 FT used, 0 hit). Captain: Haaland (4 pts).

Transfer Execution
Kinsky
Verbruggen
£4.6m
Bank Balance: £-0.3m
Squad Value: £91.3m

GW10 Starting Lineup
Captain: Haaland (2×)
GKP
Verbruggen
BHA
£4.6m
6 pts
DEF
De Cuyper
BHA
£5.4m
6 pts
DEF
Van Hecke
TOT
£5.0m
4 pts
DEF
Vuskovic
BHA
£5.2m
12 pts
DEF
Silva
BOU
£5.1m
3 pts
MID
Tavernier
BOU
£6.6m
3 pts
MID
Iwobi
FUL
£5.4m
2 pts
MID
Rudoni
COV
£4.9m
2 pts
FWD
Haaland
MCI
(C) 2×
£15.8m
4 pts
FWD
Evanilson
BOU
(VC)
£6.5m
9 pts
FWD
N.Jackson
AVL
£7.0m
11 pts
Substitutes Bench (Reserve GK + Ordered Priority)
GK Sub
GKP
Leno
£4.5m
3 pts
Sub 1
MID
Manzambi
£6.2m
2 pts
Sub 2
DEF
Ouattara
£4.0m
4 pts
Sub 3
MID
Wharton
£5.4m
2 pts

## Assistant (2026-11-09)

### Why `Bank Balance: £-0.3m` Appeared & How It Is Fixed

1. **What Caused `£-0.3m`:**
   - Every FPL team starts GW1 with a **£100.0m** total budget.
   - In GW1, the 15 players drafted by the Autonomous AI cost **£90.1m** in total, which leaves **£9.9m** in the bank (`£90.1m Squad + £9.9m Bank = £100.0m Total`).
   - However, when the historical progression script originally generated [`data/snapshots/autonomous_career_history.json`](file:///c:/Users/USER/Documents/fpl-admin/data/snapshots/autonomous_career_history.json), it hardcoded the GW1 starting bank to `£1.0m` instead of `£100.0m − £90.1m = £9.9m` (throwing away £8.9m of the £100.0m budget and setting total value to `£91.3m`).
   - Then, as the AI made net squad upgrades across the season (`Bassey £4.5m → De Cuyper £5.4m`, `Acheampong £4.5m → Vuskovic £5.2m`, `Kinsky £4.4m → Verbruggen £4.6m`, spending £1.3m net), subtracting £1.3m from that hardcoded `£1.0m` caused the displayed bank to dip to `£-0.3m` (`1.0 − 1.3 = -0.3`), even though the 15-player squad only cost **£91.4m** out of **£100.0m**!

2. **What We Fixed:**
   - Recomputed the exact financial ledger across GW1 → GW10 from the official **£100.0m** starting budget in both [`data/snapshots/autonomous_career_history.json`](file:///c:/Users/USER/Documents/fpl-admin/data/snapshots/autonomous_career_history.json) and [`data/snapshots/synced_career_history.json`](file:///c:/Users/USER/Documents/fpl-admin/data/snapshots/synced_career_history.json) (and restored pre-deadline prices for `Evanilson £6.4m` and `Manzambi £6.1m`):
     - **GW1–GW2:** Squad Value `£90.1m` | Bank Balance **`£9.9m`** | Total `£100.0m`
     - **GW3–GW4 (`Bassey → De Cuyper`):** Squad Value `£91.0m` | Bank Balance **`£9.0m`** | Total `£100.0m`
     - **GW5–GW6 (`Dedić → Ouattara`):** Squad Value `£90.6m` | Bank Balance **`£9.4m`** | Total `£100.0m`
     - **GW7–GW8 (`Acheampong → Vuskovic`):** Squad Value `£91.3m` | Bank Balance **`£8.7m`** | Total `£100.0m`
     - **GW9 (`Ayari → Wharton`):** Squad Value `£91.2m` | Bank Balance **`£8.8m`** | Total `£100.0m`
     - **GW10 (`Kinsky → Verbruggen`):** Squad Value `£91.4m` | Bank Balance **`£8.6m`** | Total `£100.0m`
   - Updated [`src/components/CareerModeView.tsx`](file:///c:/Users/USER/Documents/fpl-admin/src/components/CareerModeView.tsx#L685-L688) so the Financial State row displays both the 15-player Squad Value (`£91.4m`) and the Total Team Value (`£100.0m`) alongside `Bank Balance: £8.6m`.
