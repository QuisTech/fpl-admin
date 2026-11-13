# Workspace Directives

CRITICAL RULE:
- NEVER EVER output LaTeX math delimiters or LaTeX syntax under any circumstances (do NOT use `$`, `$$`, `\text{...}`, `\(...\)`, `\[...\]`, or `\rightarrow`).
- ALWAYS output arrows and math using standard plain text or unicode characters only (e.g. `→`, `⇒`, `xP`, `Δ`, `×`, `÷`).
- ALWAYS update `c:\Users\USER\Documents\fpl-admin\CHAT_SESSION_VERBATIM_TRANSCRIPT.md` with the full verbatim transcript of the chat session.

# Temporal Grounding & Active Season Directives (2026/27 Campaign)

CRITICAL RULES:
1. ZERO TRUST ON HISTORICAL PRE-TRAINING MEMORY:
   - NEVER assume a player's current club, position, role, or historical points from pre-2026 memory.
   - Example: Andrew Robertson plays for Tottenham Hotspur (Spurs), NOT Liverpool.
   - Always treat player affiliations, past season point tallies, and old clubs from prior years as strictly obsolete.

2. NEVER CITE STATIC TEST/MOCK DATA:
   - Do NOT use 'fpl_test.json' or mock fixture dumps to state player points or values.
   - ALWAYS verify current player stats (points, team, price) using live FPL API endpoints ('bootstrap-static') or verified active database tables.

3. CURRENT GAMEWEEK SANITY CHECK:
   - We are currently in Gameweek 10/11 of the 2026/27 season.
   - At GW10, top-scoring assets have ~70 to 80 points total. If any file or calculation reports 120+ or 140+ season points, REJECT IT as mock/stale data.
