import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { SnapshotService } from '../api/_lib/snapshot-service.js';
import type { 
  MonteCarloAuditDataset, 
  MonteCarloGwArchive, 
  MonteCarloModeResult, 
  MonteCarloAuditPlayer 
} from '../src/types/monteCarloAudit.js';

export interface FPLMonteCarloResult {
  mean: number;
  median: number;
  p10: number;
  p90: number;
  confidenceInterval: [number, number];
  simulatedScores: number[];
  haulProbability: number;
  blankProbability: number;
}

/**
 * Self-contained 1,000-iteration Monte Carlo simulation for squad actual reconciliation.
 * Avoids runtime ESM dependency on frontend /src/ modules in serverless runtimes.
 */
export function runFPLMonteCarloSimulation(
  starters: any[],
  captainId: number,
  isTripleCaptain: boolean = false,
  numSimulations: number = 1000
): FPLMonteCarloResult {
  const scores: number[] = [];
  const captainMultiplier = isTripleCaptain ? 3 : 2;

  for (let i = 0; i < numSimulations; i++) {
    let simTotal = 0;

    for (const player of starters) {
      const baseXp = Number(player.xP || player.score || 4.5);
      
      let stdDev = baseXp * 0.55;
      if (player.position === 'MID' || player.position === 'FWD') {
        stdDev = baseXp * 0.65;
      } else if (player.position === 'GKP') {
        stdDev = baseXp * 0.45;
      }

      const u1 = Math.max(0.0001, Math.random());
      const u2 = Math.random();
      const z = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);

      let playerSim = baseXp + z * stdDev;

      if (Math.random() < 0.08 && (player.position === 'MID' || player.position === 'FWD')) {
        playerSim += Math.random() * 8.0 + 3.0;
      }

      if (Math.random() < 0.05) {
        playerSim = Math.max(0, playerSim - 4.0);
      }

      playerSim = Math.max(0, playerSim);

      const isCap = player.id === captainId;
      simTotal += isCap ? playerSim * captainMultiplier : playerSim;
    }

    scores.push(Math.round(simTotal));
  }

  scores.sort((a, b) => a - b);
  const mean = Math.round((scores.reduce((sum, s) => sum + s, 0) / scores.length) * 10) / 10;
  const p10 = scores[Math.floor(scores.length * 0.10)];
  const median = scores[Math.floor(scores.length * 0.50)];
  const p90 = scores[Math.floor(scores.length * 0.90)];
  const haulCount = scores.filter(s => s >= 75).length;
  const blankCount = scores.filter(s => s <= 40).length;

  return {
    mean,
    median,
    p10,
    p90,
    confidenceInterval: [p10, p90],
    simulatedScores: scores,
    haulProbability: Math.round((haulCount / scores.length) * 100),
    blankProbability: Math.round((blankCount / scores.length) * 100)
  };
}

let cachedFPLService: any = null;

async function getFPLService(passedService?: any): Promise<any> {
  if (passedService) return passedService;
  if (cachedFPLService) return cachedFPLService;
  try {
    const mod = await import('../api/index.js');
    cachedFPLService = mod.FPLService;
    return cachedFPLService;
  } catch (err: any) {
    try {
      const mod = await import('../api/index');
      cachedFPLService = mod.FPLService;
      return cachedFPLService;
    } catch {
      throw new Error(`Failed to resolve FPLService: ${err.message}`);
    }
  }
}

function safeWriteFile(filePath: string, content: string): void {
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, content, 'utf-8');
  } catch (err: any) {
    console.warn(`[MC Archive] Note: could not write to ${filePath} (${err.message}). Expected in read-only serverless environment.`);
  }
}

interface PlayerLiveStat {
  points: number;
  minutes: number;
}

// Fetch live actual points and minutes for each player in a completed gameweek
async function fetchLiveStatsForGw(gameweek: number, latestFinishedGw: number): Promise<Record<number, PlayerLiveStat>> {
  const statsMap: Record<number, PlayerLiveStat> = {};

  // Check if saved snapshot player_points already exists
  const snapshotPlayerPointsPath = path.resolve(process.cwd(), 'data', 'snapshots', `gw_${gameweek}`, 'player_points.json');
  if (fs.existsSync(snapshotPlayerPointsPath)) {
    try {
      const savedPoints = JSON.parse(fs.readFileSync(snapshotPlayerPointsPath, 'utf-8'));
      for (const [idStr, pts] of Object.entries(savedPoints)) {
        statsMap[parseInt(idStr)] = { points: Number(pts), minutes: Number(pts) > 0 ? 90 : 0 };
      }
    } catch {
      // Fallback to live fetch
    }
  }

  if (gameweek > latestFinishedGw) {
    return statsMap;
  }

  try {
    const url = `https://fantasy.premierleague.com/api/event/${gameweek}/live/`;
    const response = await fetch(url, {
      signal: AbortSignal.timeout(5000),
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    if (response.ok) {
      const data = await response.json();
      if (data.elements && Array.isArray(data.elements)) {
        for (const el of data.elements) {
          statsMap[el.id] = {
            points: el.stats?.total_points ?? 0,
            minutes: el.stats?.minutes ?? 0
          };
        }
        return statsMap;
      }
    }
  } catch (err: any) {
    console.warn(`[MC Archive] Could not fetch live points for GW${gameweek} (${err.message}). Using local snapshot stats.`);
  }

  return statsMap;
}

// Detect latest finished Gameweek from FPL bootstrap-static
async function detectLatestFinishedGameweek(): Promise<number> {
  try {
    const res = await fetch('https://fantasy.premierleague.com/api/bootstrap-static/', {
      signal: AbortSignal.timeout(5000),
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });
    if (res.ok) {
      const data = await res.json();
      const finishedEvents = data.events?.filter((e: any) => e.finished && e.data_checked) ?? [];
      if (finishedEvents.length > 0) {
        return Math.max(...finishedEvents.map((e: any) => e.id));
      }
    }
  } catch (err: any) {
    console.warn(`[MC Archive] Could not detect latest finished GW: ${err.message}`);
  }
  return 6;
}

// Fetch average score per GW from bootstrap-static
async function fetchGameweekAverageScores(): Promise<Record<number, number>> {
  const avgMap: Record<number, number> = {};
  try {
    const res = await fetch('https://fantasy.premierleague.com/api/bootstrap-static/', {
      signal: AbortSignal.timeout(5000),
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });
    if (res.ok) {
      const data = await res.json();
      if (data.events && Array.isArray(data.events)) {
        for (const ev of data.events) {
          if (ev.average_entry_score) {
            avgMap[ev.id] = ev.average_entry_score;
          }
        }
      }
    }
  } catch {
    // default fallbacks
  }
  return avgMap;
}

// Simulate authentic FPL bench autosubstitutions
function executeFPLAutosubs(
  starters: MonteCarloAuditPlayer[],
  bench: MonteCarloAuditPlayer[]
): { finalStarters: MonteCarloAuditPlayer[]; finalBench: MonteCarloAuditPlayer[] } {
  const finalStarters = starters.map(p => ({ ...p }));
  const finalBench = bench.map(p => ({ ...p }));

  // 1. Goalkeeper replacement
  const startingGkp = finalStarters.find(p => p.position === 'GKP');
  const benchGkp = finalBench.find(p => p.position === 'GKP');
  if (startingGkp && benchGkp && !startingGkp.played && benchGkp.played) {
    startingGkp.subbedIn = false;
    benchGkp.subbedIn = true;
    const gkpIdx = finalStarters.findIndex(p => p.id === startingGkp.id);
    const bGkpIdx = finalBench.findIndex(p => p.id === benchGkp.id);
    if (gkpIdx !== -1 && bGkpIdx !== -1) {
      finalStarters[gkpIdx] = benchGkp;
      finalBench[bGkpIdx] = startingGkp;
    }
  }

  // 2. Outfield substitutions (bench order matters)
  const benchOutfield = finalBench.filter(p => p.position !== 'GKP');
  for (let sIdx = 0; sIdx < finalStarters.length; sIdx++) {
    const starter = finalStarters[sIdx];
    if (starter.position === 'GKP' || starter.played) continue;

    for (let bIdx = 0; bIdx < benchOutfield.length; bIdx++) {
      const subCandidate = benchOutfield[bIdx];
      if (!subCandidate.played || subCandidate.subbedIn) continue;

      // Verify formation viability: min 3 DEF, min 2 MID, min 1 FWD
      const tempStarters = [...finalStarters];
      tempStarters[sIdx] = subCandidate;

      const defCount = tempStarters.filter(p => p.position === 'DEF').length;
      const midCount = tempStarters.filter(p => p.position === 'MID').length;
      const fwdCount = tempStarters.filter(p => p.position === 'FWD').length;

      if (defCount >= 3 && midCount >= 2 && fwdCount >= 1) {
        subCandidate.subbedIn = true;
        starter.subbedIn = false;
        finalStarters[sIdx] = subCandidate;

        const originalBenchIdx = finalBench.findIndex(p => p.id === subCandidate.id);
        if (originalBenchIdx !== -1) {
          finalBench[originalBenchIdx] = starter;
        }
        break;
      }
    }
  }

  return { finalStarters, finalBench };
}

export interface ArchiveOptions {
  fuel?: string;
  startGw?: number;
  endGw?: number;
  fplService?: any;
  snapshotService?: any;
}

export async function runMonteCarloArchiveDirect(options: ArchiveOptions = {}) {
  const effectiveFPLService = await getFPLService(options.fplService);
  const effectiveSnapshotService = options.snapshotService || SnapshotService;
  const generatedDatasets: Record<string, MonteCarloAuditDataset> = {};

  const args = process.argv.slice(2);
  let requestedFuel = options.fuel || 'all';
  let startGw = options.startGw || 1;
  let endGw: number | null = options.endGw ?? null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--fuel' && args[i + 1]) requestedFuel = args[i + 1];
    if (args[i] === '--start-gw' && args[i + 1]) startGw = parseInt(args[i + 1]);
    if (args[i] === '--end-gw' && args[i + 1]) endGw = parseInt(args[i + 1]);
  }

  const latestFinishedGw = await detectLatestFinishedGameweek();
  if (endGw === null) {
    endGw = latestFinishedGw;
  }

  const averageScoresMap = await fetchGameweekAverageScores();

  const fuelList = requestedFuel === 'all' 
    ? ['fplform', 'native', 'eye-test'] 
    : [requestedFuel];

  const scenarios: ('quant' | 'template')[] = ['quant', 'template'];
  const modes: ('safe' | 'aggressive' | 'value')[] = ['safe', 'aggressive', 'value'];

  console.log(`\n===============================================================`);
  console.log(`  MONTE CARLO MULTI-WEEK PLANNER ARCHIVE & RECONCILIATION RUNNER`);
  console.log(`  Gameweeks: GW${startGw} -> GW${endGw} | Fuels: ${fuelList.join(', ').toUpperCase()}`);
  console.log(`  Scenarios: QUANT OPTIMAL + RISKY TEMPLATE SHIELD`);
  console.log(`  Modes: SAFE, RISKY (Aggressive), VALUE`);
  console.log(`===============================================================\n`);

  for (const fuel of fuelList) {
    console.log(`\n>>> Processing Fuel Model: ${fuel.toUpperCase()} <<<`);
    const gwArchives: MonteCarloGwArchive[] = [];
    const cumulativePoints: Record<string, { totalPoints: number; netAlpha: number }> = {};

    // Initialize cumulative tracking keys
    for (const sc of scenarios) {
      for (const m of modes) {
        const key = `${sc}_${m}`;
        cumulativePoints[key] = { totalPoints: 0, netAlpha: 0 };
      }
    }

    for (let gw = startGw; gw <= endGw; gw++) {
      console.log(`\n--- Simulating & Auditing Gameweek ${gw} [${fuel.toUpperCase()}] ---`);

      // Ensure snapshot exists
      if (gw <= latestFinishedGw && !effectiveSnapshotService.hasSnapshot(gw)) {
        console.log(`[MC Archive] Point-in-time snapshot missing for GW${gw}. Archiving...`);
        try {
          effectiveSnapshotService.saveSnapshot(gw);
        } catch (err: any) {
          console.warn(`[MC Archive] Notice: could not save snapshot for GW${gw} (${err.message}). Continuing with available data.`);
        }
      }


      const snapshotPaths = effectiveSnapshotService.getSnapshotPaths(gw);
      const eoFilePath = snapshotPaths?.eoPath || path.resolve(process.cwd(), 'data', 'top_1000_eo.json');

      // Load Top 1k EO map for template score
      let top1kEoMap: Record<number, number> = {};
      if (fs.existsSync(eoFilePath)) {
        try {
          const eoData = JSON.parse(fs.readFileSync(eoFilePath, 'utf-8'));
          if (eoData.players) {
            for (const [idStr, p] of Object.entries(eoData.players as Record<string, any>)) {
              top1kEoMap[parseInt(idStr)] = p.eo ?? 0;
            }
          }
        } catch {
          // ignore
        }
      }

      // Live stats for GW
      const liveStats = await fetchLiveStatsForGw(gw, latestFinishedGw);
      const hasLiveStats = Object.keys(liveStats).length > 0;

      // Calculate Top 1k Template score
      let templateScore = 0;
      if (hasLiveStats) {
        for (const [id, eoPct] of Object.entries(top1kEoMap)) {
          const pStat = liveStats[parseInt(id)];
          const pts = pStat ? pStat.points : 0;
          templateScore += pts * (eoPct / 100);
        }
        templateScore = Math.round(templateScore * 10) / 10;
      }

      const gwResults: Record<string, MonteCarloModeResult> = {};

      for (const scenario of scenarios) {
        for (const mode of modes) {
          const key = `${scenario}_${mode}`;
          const scenarioLabel = scenario === 'quant' ? 'Quant Optimal' : 'Risky Template Shield';

          try {
            // Solve point-in-time recommendation for this (mode, fuel, scenario, gw)
            const rec = await effectiveFPLService.getRecommendations(
              mode, 
              1000, 
              'admin', 
              fuel, 
              scenario, 
              [], 
              [], 
              gw, 
              true // skip heavy comparison for backtest speed
            );

            const startersRaw = rec.startingXI || [];
            const benchRaw = rec.bench || [];
            const captainRaw = rec.captain || startersRaw[0];
            const viceCaptainRaw = rec.viceCaptain || startersRaw[1] || startersRaw[0];

            // Map players with live actuals
            const starters: MonteCarloAuditPlayer[] = startersRaw.map(p => {
              const stat = liveStats[p.id];
              const pts = stat ? stat.points : (hasLiveStats ? 0 : Math.round((p.xP || 0) * 10) / 10);
              const played = stat ? stat.minutes > 0 : false;
              return {
                id: p.id,
                name: p.web_name,
                team: p.team_short_name || '',
                position: p.position,
                projectedXp: Math.round((p.xP || p.score || 4.5) * 10) / 10,
                actualPoints: Math.round(pts * 10) / 10,
                played
              };
            });

            const bench: MonteCarloAuditPlayer[] = benchRaw.map((p, idx) => {
              const stat = liveStats[p.id];
              const pts = stat ? stat.points : (hasLiveStats ? 0 : Math.round((p.xP || 0) * 10) / 10);
              const played = stat ? stat.minutes > 0 : false;
              return {
                id: p.id,
                name: p.web_name,
                team: p.team_short_name || '',
                position: p.position,
                projectedXp: Math.round((p.xP || p.score || 4.5) * 10) / 10,
                actualPoints: Math.round(pts * 10) / 10,
                played
              };
            });

            // Run 1,000 Monte Carlo match simulations
            const mcResult = runFPLMonteCarloSimulation(startersRaw as any, captainRaw?.id || 0, false, 1000);

            // Reconcile autosubs
            const { finalStarters, finalBench } = executeFPLAutosubs(starters, bench);

            // Resolve captain multiplier (double points if captain played; if captain 0 mins, pass to VC)
            const origCap = starters.find(p => p.id === captainRaw?.id);
            const capPlayed = origCap ? origCap.played : ((liveStats[captainRaw?.id || 0]?.minutes ?? 0) > 0);

            const vcInFinal = finalStarters.find(p => p.id === viceCaptainRaw?.id);
            const vcPlayed = vcInFinal ? vcInFinal.played : ((liveStats[viceCaptainRaw?.id || 0]?.minutes ?? 0) > 0);

            let activeCapId = captainRaw?.id || 0;
            let isVcPromoted = false;

            if (!capPlayed && vcInFinal && vcPlayed) {
              activeCapId = vcInFinal.id;
              isVcPromoted = true;
            }

            // Calculate actual starting XI points
            let actualScore = 0;
            for (const p of finalStarters) {
              const isCap = p.id === activeCapId;
              actualScore += isCap ? p.actualPoints * 2 : p.actualPoints;
            }
            actualScore = Math.round(actualScore * 10) / 10;

            const hitCost = 0; // Baseline initial / rolling transfer cost
            const netActualScore = actualScore - hitCost;
            const insideConfidenceInterval = netActualScore >= mcResult.p10 && netActualScore <= mcResult.p90;
            const predictionError = Math.round((netActualScore - mcResult.mean) * 10) / 10;
            const haulAchieved = netActualScore >= 75;
            const blankOccurred = netActualScore <= 40;
            const alphaVsTemplate = Math.round((netActualScore - (templateScore || mcResult.mean * 0.95)) * 10) / 10;

            const activeCapPlayer = finalStarters.find(p => p.id === activeCapId) || starters.find(p => p.id === captainRaw?.id);

            const modeResult: MonteCarloModeResult = {
              mode,
              scenario,
              scenarioLabel,
              startingXI: finalStarters,
              bench: finalBench,
              captain: {
                id: activeCapId,
                name: activeCapPlayer?.name || captainRaw?.web_name || 'Captain',
                actualPoints: activeCapPlayer?.actualPoints ?? (liveStats[activeCapId]?.points ?? 0),
                multiplier: (capPlayed || isVcPromoted) ? 2 : 1,
                originalName: isVcPromoted ? (captainRaw?.web_name || 'Original Captain') : undefined,
                isVcPromoted
              },
              viceCaptain: {
                id: viceCaptainRaw?.id || 0,
                name: viceCaptainRaw?.web_name || 'Vice-Captain',
                actualPoints: liveStats[viceCaptainRaw?.id || 0]?.points ?? 0
              },
              transfers: {
                in: [],
                out: [],
                hitCost
              },
              monteCarlo: {
                meanXp: mcResult.mean,
                median: mcResult.median,
                p10: mcResult.p10,
                p90: mcResult.p90,
                confidenceInterval: [mcResult.p10, mcResult.p90],
                haulProbability: mcResult.haulProbability,
                blankProbability: mcResult.blankProbability,
                variance: Math.round(Math.pow((mcResult.p90 - mcResult.mean) / 1.28, 2) * 10) / 10
              },
              reconciliation: {
                actualScore,
                netActualScore,
                insideConfidenceInterval,
                predictionError,
                haulAchieved,
                blankOccurred,
                alphaVsTemplate
              }
            };

            gwResults[key] = modeResult;
            cumulativePoints[key].totalPoints = Math.round((cumulativePoints[key].totalPoints + netActualScore) * 10) / 10;
            cumulativePoints[key].netAlpha = Math.round((cumulativePoints[key].netAlpha + alphaVsTemplate) * 10) / 10;

            console.log(`  [${scenarioLabel.toUpperCase()} - ${mode.toUpperCase()}]: Mean xP=${mcResult.mean} | 80% CI=[${mcResult.p10}, ${mcResult.p90}] | Actual=${netActualScore} pts | In CI? ${insideConfidenceInterval ? 'YES' : 'NO'} | Alpha=${alphaVsTemplate > 0 ? '+' : ''}${alphaVsTemplate}`);
          } catch (err: any) {
            console.error(`  [MC Archive] Error solving ${key} for GW${gw}:`, err.message);
          }
        }
      }

      gwArchives.push({
        gameweek: gw,
        templateScore: templateScore || 0,
        averageScore: averageScoresMap[gw] || 50,
        results: gwResults
      });
    }

    // Compute calibration stats across all evaluated gameweeks
    let totalEvaluated = 0;
    let ciHitCount = 0;
    let totalAbsError = 0;
    let haulHitCount = 0;
    let haulPredictedCount = 0;

    for (const g of gwArchives) {
      for (const res of Object.values(g.results) as any[]) {
        totalEvaluated++;
        if (res.reconciliation?.insideConfidenceInterval) ciHitCount++;
        totalAbsError += Math.abs(res.reconciliation?.predictionError || 0);
        if (res.reconciliation?.haulAchieved) haulHitCount++;
        if ((res.monteCarlo?.haulProbability || 0) >= 20) haulPredictedCount++;
      }
    }

    const ciCoverageRate = totalEvaluated > 0 
      ? Math.round((ciHitCount / totalEvaluated) * 1000) / 10 
      : 0;

    const avgAbsoluteError = totalEvaluated > 0 
      ? Math.round((totalAbsError / totalEvaluated) * 10) / 10 
      : 0;

    const dataset: MonteCarloAuditDataset = {
      generatedAt: new Date().toISOString(),
      fuel,
      startGw,
      endGw,
      hasLivePoints: gwArchives.length > 0 && gwArchives[0].gameweek <= latestFinishedGw,
      scenarios,
      modes,
      calibrationSummary: {
        totalEvaluated,
        ciHitCount,
        ciCoverageRate,
        avgAbsoluteError,
        haulHitCount,
        haulPredictedCount
      },
      cumulativeTotals: cumulativePoints,
      gameweeks: gwArchives
    };

    // Output files
    const fuelSuffix = fuel === 'eye-test' ? 'eyetest' : fuel;
    const outputFileName = `monte_carlo_audit_${fuelSuffix}.json`;
    const jsonStr = JSON.stringify(dataset, null, 2);

    const dataPath = path.resolve(process.cwd(), 'data', outputFileName);
    safeWriteFile(dataPath, jsonStr);
    console.log(`[MC Archive] Saved ${fuel.toUpperCase()} dataset to ${dataPath}`);

    const publicDataDir = path.resolve(process.cwd(), 'public', 'data');
    const publicPath = path.resolve(publicDataDir, outputFileName);
    safeWriteFile(publicPath, jsonStr);
    console.log(`[MC Archive] Synced to ${publicPath}`);

    // If default or fplform, also mirror to main monte_carlo_history.json
    if (fuel === 'fplform' || requestedFuel !== 'all') {
      const historyDataPath = path.resolve(process.cwd(), 'data', 'monte_carlo_history.json');
      const historyPublicPath = path.resolve(publicDataDir, 'monte_carlo_history.json');
      safeWriteFile(historyDataPath, jsonStr);
      safeWriteFile(historyPublicPath, jsonStr);
      console.log(`[MC Archive] Updated default monte_carlo_history.json`);
    }

    generatedDatasets[fuelSuffix] = dataset;
    generatedDatasets[fuel] = dataset;
  }

  console.log(`\n===============================================================`);
  console.log(`  MONTE CARLO AUDIT & RECONCILIATION COMPLETE!`);
  console.log(`===============================================================\n`);

  return {
    success: true,
    fuelList,
    startGw,
    endGw,
    message: `Monte Carlo audit completed successfully for GW${startGw} to GW${endGw} (${fuelList.join(', ').toUpperCase()}).`,
    datasets: generatedDatasets
  };
}

const isCli = process.argv[1] && (
  process.argv[1].endsWith('run_monte_carlo_archive.ts') || 
  process.argv[1].endsWith('run_monte_carlo_archive.js')
);

if (isCli) {
  runMonteCarloArchiveDirect().catch(err => {
    console.error('[MC Archive Runner Fatal Error]:', err);
    process.exit(1);
  });
}
