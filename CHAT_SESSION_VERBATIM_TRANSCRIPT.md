

---

### User (Turn 192 - 2026-11-01T22:22:32+01:00)

Vercel seems to be working but localhost is producing this:

Application Encountered an Error
The interface caught an unhandled runtime error. Your squad data and settings remain safe.

TypeError: Cannot read properties of undefined (reading 'length')


Reload Application

---

### Assistant (Turn 192)

### The Cause of the Error
This error occurs because your local `npm run dev` server was running in the background from **before** the new `/api/career` backend route was added to `server.ts`:

1. **Stale Local Express Process**: `tsx server.ts` only re-evaluates server-level routes when the process is restarted. Since the dev server had not been restarted, Express didn't match the new `/api/career` endpoint and fell through to Vite's SPA middleware, which returned `index.html` (raw HTML text) instead of JSON.
2. **The Undefined Property**: When `CareerModeView.tsx` received HTML instead of a JSON object, `data.gameweeks` was undefined, which triggered `TypeError: Cannot read properties of undefined (reading 'length')`.
3. **Why Vercel Worked**: Vercel deploys serverless API functions independently from git, so `/api/career` was live immediately on Vercel.

---

### Fixes Applied to the Codebase
1. **Response Validation**: `CareerModeView.tsx` now verifies that the response is a valid JSON payload containing a `gameweeks` array. If an HTML SPA fallback is ever returned, it handles it cleanly with a clear notification instead of crashing.
2. **Safe Array Guards**: Added defensive optional chaining and fallback empty arrays across all gameweek data properties (`data?.gameweeks?.length`, `activeGwData?.transfersIn?.length`, `activeGwData?.autoSubs?.length`, etc.).
3. **Error Diagnostics**: Updated `ErrorBoundary.tsx` to display the full error message and stack trace.

---

### How to Fix on Localhost
Simply restart your local development server so that Node reloads `server.ts`:

1. In your local terminal, press **`Ctrl + C`** to stop the dev server.
2. Run **`npm run dev`**.
3. Refresh `http://localhost:3000` (or `http://localhost:5173`) in your browser.
