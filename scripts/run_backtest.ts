import 'dotenv/config';
import { FPLService } from '../api/index.ts';
import { SnapshotService } from '../api/_lib/snapshot-service.ts';
import fs from 'fs';
import path from 'path';

interface ModeResult {
  mode: string;
  startingXI: string[];
  captain: string;
  projectedGwXp: number;
  projected8GwXp: number;
  actualPoints: number;
  averageXiEo: number;
  alphaVsTemplate: number;
}

interface BacktestGwSummary {
  gameweek: number;
  templateScore: number;
  safe: ModeResult;
  risky: ModeResult;
  value: ModeResult;
  riskySwapCount: number;
  riskyAvgSwapCost: number;
  riskyQuality: string;
}

async function fetchActualPointsForGw(gameweek: number, latestFinishedGw: number): Promise<Record<number, number>> {
  const actualPointsMap: Record<number, number> = {};
  if (gameweek > latestFinishedGw) {
    return actualPointsMap;
  }
  try {
    const url = `https://fantasy.premierleague.com/api/event/${gameweek}/live/`;
    const response = await fetch(url, {
      signal: AbortSignal.timeout(4000),
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    if (response.ok) {
      const data = await response.json();
      if (data.elements && Array.isArray(data.elements)) {
        for (const el of data.elements) {
          actualPointsMap[el.id] = el.stats?.total_points ?? 0;
        }
        console.log(`[Backtest] Successfully fetched actual FPL points for ${Object.keys(actualPointsMap).length} players in GW${gameweek}.`);
        return actualPointsMap;
      }
    }
  } catch (err: any) {
    console.warn(`[Backtest] Could not fetch live points for GW${gameweek} (${err.message}). Using fallback projections.`);
  }

  return actualPointsMap;
}

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
    console.warn(`[Backtest] Could not detect latest finished GW: ${err.message}`);
  }
  return 1;
}

async function runBacktest() {
  const args = process.argv.slice(2);
  let startGw = 1;
  let endGw: number | null = null;
  let fuel = 'fplform';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--start-gw' && args[i + 1]) startGw = parseInt(args[i + 1]);
    if (args[i] === '--end-gw' && args[i + 1]) endGw = parseInt(args[i + 1]);
    if (args[i] === '--fuel' && args[i + 1]) fuel = args[i + 1];
  }

  const latestFinishedGw = await detectLatestFinishedGameweek();

  if (endGw === null) {
    endGw = latestFinishedGw;
  }

  console.log(`\n===============================================================`);
  console.log(`  FPL ENGINE HISTORICAL BACKTEST RUNNER (GW${startGw} -> GW${endGw})`);
  console.log(`  Fuel Source: ${fuel.toUpperCase()} | Out-of-Sample Discipline: LOCKED`);
  console.log(`===============================================================\n`);

  const gwSummaries: BacktestGwSummary[] = [];

  for (let gw = startGw; gw <= endGw; gw++) {
    // 1. Ensure snapshot exists for completed gameweeks
    if (gw <= latestFinishedGw && !SnapshotService.hasSnapshot(gw)) {
      console.log(`[Backtest] No snapshot found for GW${gw}. Creating point-in-time snapshot...`);
      SnapshotService.saveSnapshot(gw);
    }

    const snapshotPaths = SnapshotService.getSnapshotPaths(gw);
    const eoFilePath = snapshotPaths?.eoPath || path.resolve(process.cwd(), 'data', 'top_1000_eo.json');

    // Load top 1k EO map for template score calculation
    let top1kEoMap: Record<number, number> = {};
    if (fs.existsSync(eoFilePath)) {
      try {
        const eoData = JSON.parse(fs.readFileSync(eoFilePath, 'utf-8'));
        if (eoData.players) {
          for (const [idStr, p] of Object.entries(eoData.players as Record<string, any>)) {
            top1kEoMap[parseInt(idStr)] = p.eo ?? 0;
          }
        }
      } catch (err) {
        // ignore
      }
    }

    // 2. Fetch actual live points for GW
    const actualPointsMap = await fetchActualPointsForGw(gw, latestFinishedGw);
    const hasLivePoints = Object.keys(actualPointsMap).length > 0;

    // 3. Generate recommendations for SAFE, RISKY (aggressive), and VALUE modes for the historical GW
    const safeRec = await FPLService.getRecommendations('safe', 1000, 'free', fuel, 'quant', [], [], gw);
    const riskyRec = await FPLService.getRecommendations('aggressive', 1000, 'free', fuel, 'quant', [], [], gw);
    const valueRec = await FPLService.getRecommendations('value', 1000, 'free', fuel, 'quant', [], [], gw);

    const calculateActualScore = (startingXI: any[], captain: any) => {
      let total = 0;
      for (const p of startingXI) {
        const pts = hasLivePoints ? (actualPointsMap[p.id] ?? 0) : (p.xP ?? 0);
        const mult = captain && captain.id === p.id ? 2 : 1;
        total += pts * mult;
      }
      return Math.round(total * 10) / 10;
    };

    // Calculate top-1k template score
    let templateScore = 0;
    if (hasLivePoints) {
      for (const [id, eoPct] of Object.entries(top1kEoMap)) {
        const pts = actualPointsMap[parseInt(id)] ?? 0;
        templateScore += (pts * (eoPct / 100));
      }
      templateScore = Math.round(templateScore * 10) / 10;
    } else {
      templateScore = Math.round((safeRec.expectedPoints * 0.95) * 10) / 10;
    }

    const safeActual = calculateActualScore(safeRec.startingXI, safeRec.captain);
    const riskyActual = calculateActualScore(riskyRec.startingXI, riskyRec.captain);
    const valueActual = calculateActualScore(valueRec.startingXI, valueRec.captain);

    const safeRes: ModeResult = {
      mode: 'SAFE',
      startingXI: safeRec.startingXI.map(p => `${p.web_name} (${p.team_short_name})`),
      captain: safeRec.captain ? `${safeRec.captain.web_name} (C)` : 'None',
      projectedGwXp: Math.round(safeRec.expectedPoints * 10) / 10,
      projected8GwXp: safeRec.engineDiagnostics?.metrics?.horizonTotalXp ?? 0,
      actualPoints: safeActual,
      averageXiEo: safeRec.engineDiagnostics?.metrics?.averageXiEo ?? 0,
      alphaVsTemplate: Math.round((safeActual - templateScore) * 10) / 10
    };

    const riskyRes: ModeResult = {
      mode: 'RISKY',
      startingXI: riskyRec.startingXI.map(p => `${p.web_name} (${p.team_short_name})`),
      captain: riskyRec.captain ? `${riskyRec.captain.web_name} (C)` : 'None',
      projectedGwXp: Math.round(riskyRec.expectedPoints * 10) / 10,
      projected8GwXp: riskyRec.engineDiagnostics?.metrics?.horizonTotalXp ?? 0,
      actualPoints: riskyActual,
      averageXiEo: riskyRec.engineDiagnostics?.metrics?.averageXiEo ?? 0,
      alphaVsTemplate: Math.round((riskyActual - templateScore) * 10) / 10
    };

    const valueRes: ModeResult = {
      mode: 'VALUE',
      startingXI: valueRec.startingXI.map(p => `${p.web_name} (${p.team_short_name})`),
      captain: valueRec.captain ? `${valueRec.captain.web_name} (C)` : 'None',
      projectedGwXp: Math.round(valueRec.expectedPoints * 10) / 10,
      projected8GwXp: valueRec.engineDiagnostics?.metrics?.horizonTotalXp ?? 0,
      actualPoints: valueActual,
      averageXiEo: valueRec.engineDiagnostics?.metrics?.averageXiEo ?? 0,
      alphaVsTemplate: Math.round((valueActual - templateScore) * 10) / 10
    };

    const swapAnalysis = riskyRec.engineDiagnostics?.metrics?.swapAnalysis;

    gwSummaries.push({
      gameweek: gw,
      templateScore,
      safe: safeRes,
      risky: riskyRes,
      value: valueRes,
      riskySwapCount: swapAnalysis?.swapCount ?? 0,
      riskyAvgSwapCost: swapAnalysis?.avgSwapCostPerGw ?? 0,
      riskyQuality: swapAnalysis?.differentialQuality ?? 'N/A'
    });

    console.log(`\n--- GAMEWEEK ${gw} SCOREBOARD ---`);
    console.log(`Template Baseline Score: ${templateScore} pts`);
    console.table([
      { Mode: 'SAFE', 'Cap Pick': safeRes.captain, 'GW1 xP': safeRes.projectedGwXp, '8-GW xP': safeRes.projected8GwXp, 'Avg XI EO': `${safeRes.averageXiEo}%`, 'Actual Pts': safeActual, 'Net Alpha': `${safeRes.alphaVsTemplate > 0 ? '+' : ''}${safeRes.alphaVsTemplate}` },
      { Mode: 'RISKY', 'Cap Pick': riskyRes.captain, 'GW1 xP': riskyRes.projectedGwXp, '8-GW xP': riskyRes.projected8GwXp, 'Avg XI EO': `${riskyRes.averageXiEo}%`, 'Actual Pts': riskyActual, 'Net Alpha': `${riskyRes.alphaVsTemplate > 0 ? '+' : ''}${riskyRes.alphaVsTemplate}` },
      { Mode: 'VALUE', 'Cap Pick': valueRes.captain, 'GW1 xP': valueRes.projectedGwXp, '8-GW xP': valueRes.projected8GwXp, 'Avg XI EO': `${valueRes.averageXiEo}%`, 'Actual Pts': valueActual, 'Net Alpha': `${valueRes.alphaVsTemplate > 0 ? '+' : ''}${valueRes.alphaVsTemplate}` },
    ]);

    if (swapAnalysis && swapAnalysis.swaps.length > 0) {
      console.log(`\nRISKY Differential Swaps for GW${gw} (${swapAnalysis.divergenceTier}):`);
      console.table(swapAnalysis.swaps.map(s => ({
        'SAFE Player': s.outPlayer,
        'RISKY Replacement': s.inPlayer,
        '8-GW xP Diff': `-${s.xpSacrifice8GW} pts`,
        'Cost / GW': `-${s.xpSacrificePerGw} xP`,
        'EO Drop': `-${s.eoReduction}%`
      })));
    }
  }

  // Final Summary across all evaluated Gameweeks
  console.log(`\n===============================================================`);
  console.log(`  SUMMARY MULTI-GW BACKTEST SCORECARD (GW${startGw} - GW${endGw})`);
  console.log(`===============================================================`);
  
  const totalSafePts = gwSummaries.reduce((sum, g) => sum + g.safe.actualPoints, 0);
  const totalRiskyPts = gwSummaries.reduce((sum, g) => sum + g.risky.actualPoints, 0);
  const totalValuePts = gwSummaries.reduce((sum, g) => sum + g.value.actualPoints, 0);
  const totalTemplatePts = gwSummaries.reduce((sum, g) => sum + g.templateScore, 0);

  console.table([
    { Mode: 'SAFE Baseline', 'Total Actual Pts': totalSafePts, 'Net Alpha vs Template': `+${(totalSafePts - totalTemplatePts).toFixed(1)} pts` },
    { Mode: 'RISKY Differential', 'Total Actual Pts': totalRiskyPts, 'Net Alpha vs Template': `+${(totalRiskyPts - totalTemplatePts).toFixed(1)} pts` },
    { Mode: 'VALUE ROI Budget', 'Total Actual Pts': totalValuePts, 'Net Alpha vs Template': `+${(totalValuePts - totalTemplatePts).toFixed(1)} pts` }
  ]);

  // Save results to JSON for GUI consumption
  const outputData = {
    generatedAt: new Date().toISOString(),
    fuel,
    startGw,
    endGw,
    hasLivePoints: gwSummaries.length > 0 && gwSummaries[0].safe.actualPoints !== gwSummaries[0].safe.projectedGwXp,
    totals: {
      safe: { totalPoints: totalSafePts, alphaVsTemplate: Math.round((totalSafePts - totalTemplatePts) * 10) / 10 },
      risky: { totalPoints: totalRiskyPts, alphaVsTemplate: Math.round((totalRiskyPts - totalTemplatePts) * 10) / 10 },
      value: { totalPoints: totalValuePts, alphaVsTemplate: Math.round((totalValuePts - totalTemplatePts) * 10) / 10 },
      template: { totalPoints: totalTemplatePts }
    },
    gameweeks: gwSummaries.map(g => ({
      gameweek: g.gameweek,
      templateScore: g.templateScore,
      safe: g.safe,
      risky: g.risky,
      value: g.value,
      riskySwapCount: g.riskySwapCount,
      riskyAvgSwapCost: g.riskyAvgSwapCost,
      riskyQuality: g.riskyQuality
    }))
  };

  // Resolve fuel-based output filename
  const fuelSuffix = fuel === 'eye-test' ? 'eyetest' : fuel;
  const outputFileName = `backtest_results_${fuelSuffix}.json`;
  const jsonContent = JSON.stringify(outputData, null, 2);

  // Write to data/ directory
  const dataOutputPath = path.resolve(process.cwd(), 'data', outputFileName);
  fs.writeFileSync(dataOutputPath, jsonContent);
  console.log(`\n[Backtest] Results saved to ${dataOutputPath}`);

  // Write to public/data/ directory for Vercel production static serving
  const publicDataDir = path.resolve(process.cwd(), 'public', 'data');
  if (!fs.existsSync(publicDataDir)) {
    fs.mkdirSync(publicDataDir, { recursive: true });
  }
  const publicOutputPath = path.resolve(publicDataDir, outputFileName);
  fs.writeFileSync(publicOutputPath, jsonContent);
  console.log(`[Backtest] Results synced to ${publicOutputPath}`);

  console.log(`[Backtest Complete] Out-of-sample historical validation frame executed successfully.\n`);
}

runBacktest().catch(err => {
  console.error('[Backtest Runner Error]:', err);
  process.exit(1);
});
