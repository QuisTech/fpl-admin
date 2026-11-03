import { ScoredPlayer, PlannerStepDetail, FPLFixture } from '../types';

export interface FPLMonteCarloResult {
  mean: number;
  median: number;
  p10: number;
  p90: number;
  confidenceInterval: [number, number];
  simulatedScores: number[];
  haulProbability: number; // Probability score >= 75
  blankProbability: number; // Probability score <= 40
}

/**
 * Runs a 1,000-iteration Monte Carlo simulation for an FPL squad in a given Gameweek.
 * Evaluates individual player variance, FDR difficulty swings, rotation risk, and captain boost.
 */
export function runFPLMonteCarloSimulation(
  starters: ScoredPlayer[],
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
      
      // Standard deviation calibrated to FPL asset volatility (attacking mids/forwards have higher variance)
      let stdDev = baseXp * 0.55;
      if (player.position === 'MID' || player.position === 'FWD') {
        stdDev = baseXp * 0.65;
      } else if (player.position === 'GKP') {
        stdDev = baseXp * 0.45;
      }

      // Box-Muller transform for normal distribution random sampling
      const u1 = Math.max(0.0001, Math.random());
      const u2 = Math.random();
      const z = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);

      // Raw simulated score
      let playerSim = baseXp + z * stdDev;

      // Random event modeling:
      // 1. Haul chance (hat-trick / brace / double bonus)
      if (Math.random() < 0.08 && (player.position === 'MID' || player.position === 'FWD')) {
        playerSim += Math.random() * 8.0 + 3.0;
      }

      // 2. Early sub / benching / red card / conceded penalty
      if (Math.random() < 0.05) {
        playerSim = Math.max(0, playerSim - 4.0);
      }

      // Floor points at 0 (rarely negative in FPL)
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

/**
 * Generate a client-side multi-horizon beam plan if backend plan is not yet loaded,
 * or when the user dynamically adjusts horizon in the sandbox.
 */
export function generateClientMultiWeekPlan(
  initialSquad: ScoredPlayer[],
  candidatePool: ScoredPlayer[],
  startGw: number,
  horizon: number = 5,
  initialBank: number = 0.5,
  strategyMode: 'safe' | 'aggressive' | 'value' = 'safe'
): PlannerStepDetail[] {
  const steps: PlannerStepDetail[] = [];
  let currentSquad = [...initialSquad];
  let currentBank = initialBank;
  let freeTransfers = 1;

  for (let step = 0; step < horizon; step++) {
    const gw = startGw + step;
    let actionType: 'ROLL' | 'TRANSFER' | 'CHIP' = 'ROLL';
    let actionDesc = 'Roll Free Transfer (+1 FT Banked)';
    let chipName: string | undefined = undefined;
    let transfersIn: number[] = [];
    let transfersOut: number[] = [];
    let inDetails: any[] = [];
    let outDetails: any[] = [];
    let hitCost = 0;

    // 1. Calculate fixture-adjusted xP for each player in this specific gameweek (gw)
    // Defensive calibration: Differentiate between elite defensive units (ARS, MCI, LIV)
    // and promoted/lower-tier defenses to prevent artificial FDR over-inflation.
    const getPlayerGwXp = (p: ScoredPlayer): number => {
      const base = Number(p.xP || p.score || 4.5);
      const fix = p.next_fixtures?.find(f => f.event === gw) || p.next_fixtures?.[step];
      if (!fix) return base;

      const isDefensive = p.position === 'DEF' || p.position === 'GKP';
      const team = (p.team_short_name || '').toUpperCase();
      const isEliteDefense = ['ARS', 'MCI', 'LIV'].includes(team);

      let fdrMultiplier = 1.0;
      let venueMultiplier = 1.0;

      if (isDefensive) {
        if (isEliteDefense) {
          // Tier-1 elite defenses maintain high clean sheet probability across all matchups
          // and carry elite set-piece/attacking goal threat (Calafiori, Gabriel, Gvardiol).
          // Floor protection ensures they are not penalized excessively in moderate fixtures.
          if (fix.difficulty <= 2) fdrMultiplier = 1.15;
          else if (fix.difficulty === 3) fdrMultiplier = 1.02;
          else if (fix.difficulty === 4) fdrMultiplier = 0.92;
          else fdrMultiplier = 0.85;

          venueMultiplier = fix.is_home ? 1.08 : 0.95;
        } else {
          // Promoted / bottom-half defenses regularly concede even in favorable home matches.
          // Capping their fixture boost prevents unrealistic inflation over elite assets.
          if (fix.difficulty <= 2) fdrMultiplier = 1.08;
          else if (fix.difficulty === 3) fdrMultiplier = 0.95;
          else if (fix.difficulty === 4) fdrMultiplier = 0.80;
          else fdrMultiplier = 0.65;

          venueMultiplier = fix.is_home ? 1.05 : 0.90;
        }
      } else {
        // Attackers (MID, FWD): maintain high dynamic ceiling against porous opponents
        if (fix.difficulty <= 2) fdrMultiplier = 1.22;
        else if (fix.difficulty === 3) fdrMultiplier = 1.00;
        else if (fix.difficulty === 4) fdrMultiplier = 0.85;
        else fdrMultiplier = 0.70;

        venueMultiplier = fix.is_home ? 1.10 : 0.92;
      }

      return Math.round(base * fdrMultiplier * venueMultiplier * 10) / 10;
    };

    // Sort squad by fixture-adjusted xP ascending to identify candidates for transfer upgrade
    const sortedByXpAsc = [...currentSquad].sort((a, b) => getPlayerGwXp(a) - getPlayerGwXp(b));
    const lowestStarter = sortedByXpAsc[0];

    // Look for high-impact upgrade in candidate pool
    const viableUpgrade = candidatePool.find(c => 
      c.position === lowestStarter?.position &&
      !currentSquad.some(p => p.id === c.id) &&
      (c.xP || 0) > (lowestStarter?.xP || 0) + 1.5 &&
      (c.now_cost || 50) <= (lowestStarter?.now_cost || 50) + currentBank * 10
    );

    if (viableUpgrade && lowestStarter && step > 0 && step % 2 === 1) {
      actionType = 'TRANSFER';
      transfersOut = [lowestStarter.id];
      transfersIn = [viableUpgrade.id];
      
      inDetails = [{
        id: viableUpgrade.id,
        name: viableUpgrade.web_name,
        cost: viableUpgrade.now_cost,
        position: viableUpgrade.position,
        team: viableUpgrade.team_short_name
      }];

      outDetails = [{
        id: lowestStarter.id,
        name: lowestStarter.web_name,
        cost: lowestStarter.now_cost,
        position: lowestStarter.position,
        team: lowestStarter.team_short_name
      }];

      actionDesc = `In: ${viableUpgrade.web_name} | Out: ${lowestStarter.web_name}`;
      
      // Update bank
      const diffCost = ((lowestStarter.now_cost || 50) - (viableUpgrade.now_cost || 50)) / 10;
      currentBank = Math.max(0, Math.round((currentBank + diffCost) * 10) / 10);
      
      // Swap squad
      currentSquad = currentSquad.map(p => p.id === lowestStarter.id ? viableUpgrade : p);
      freeTransfers = Math.min(5, freeTransfers);
    } else {
      freeTransfers = Math.min(5, freeTransfers + 1);
    }

    // Form optimal Starting XI (11) and Bench (4) under FPL constraints:
    // Exactly 1 GKP, min 3 DEF, min 2 MID, min 1 FWD, total 11 starters.
    const gkps = currentSquad.filter(p => p.position === 'GKP').sort((a, b) => getPlayerGwXp(b) - getPlayerGwXp(a));
    const defs = currentSquad.filter(p => p.position === 'DEF').sort((a, b) => getPlayerGwXp(b) - getPlayerGwXp(a));
    const mids = currentSquad.filter(p => p.position === 'MID').sort((a, b) => getPlayerGwXp(b) - getPlayerGwXp(a));
    const fwds = currentSquad.filter(p => p.position === 'FWD').sort((a, b) => getPlayerGwXp(b) - getPlayerGwXp(a));

    let starterPlayers: ScoredPlayer[] = [];
    let benchPlayers: ScoredPlayer[] = [];

    if (gkps.length >= 1 && defs.length >= 3 && mids.length >= 2 && fwds.length >= 1) {
      // 1 starting GKP
      const startingGkp = gkps[0];
      const benchGkp = gkps.slice(1);

      // Core outfield requirements: 3 DEF, 2 MID, 1 FWD = 6 outfielders (+ 1 GKP = 7 players)
      const coreDefs = defs.slice(0, 3);
      const coreMids = mids.slice(0, 2);
      const coreFwds = fwds.slice(0, 1);

      // Remaining outfield candidates (max 5 DEF, max 5 MID, max 3 FWD)
      const remainingOutfield = [
        ...defs.slice(3, 5),
        ...mids.slice(2, 5),
        ...fwds.slice(1, 3)
      ].sort((a, b) => getPlayerGwXp(b) - getPlayerGwXp(a));

      // Pick top 4 flex outfielders to complete the 11 starters
      const flexOutfield = remainingOutfield.slice(0, 4);
      const benchOutfield = remainingOutfield.slice(4);

      starterPlayers = [
        startingGkp,
        ...coreDefs,
        ...coreMids,
        ...coreFwds,
        ...flexOutfield
      ];

      benchPlayers = [
        ...benchGkp,
        ...benchOutfield
      ];
    } else {
      // Fallback if squad positions are incomplete or non-standard
      const sortedAll = [...currentSquad].sort((a, b) => getPlayerGwXp(b) - getPlayerGwXp(a));
      starterPlayers = sortedAll.slice(0, 11);
      benchPlayers = sortedAll.slice(11, 15);
    }

    // Rank starters for captaincy hierarchy:
    // In quant game theory and FPL, attackers (FWD/MID) have uncapped right-tail ceilings (hat-tricks/braces)
    // and cannot lose points when the opponent scores, unlike defenders whose clean sheet is fragile.
    // Matching the backend solver (posMultiplier in lp-solver.ts), we apply an attacking ceiling multiplier (1.25x for FWD/MID).
    const getCaptaincyScore = (p: ScoredPlayer): number => {
      const gwXp = getPlayerGwXp(p);
      const isAttacker = p.position === 'FWD' || p.position === 'MID';
      return gwXp * (isAttacker ? 1.25 : 0.85);
    };

    const sortedForCaptaincy = [...starterPlayers].sort((a, b) => getCaptaincyScore(b) - getCaptaincyScore(a));
    
    // Captain: Top projected attacking starter
    const captain = sortedForCaptaincy[0] || currentSquad[0];

    // Vice-Captain: Second highest projected starter (guaranteed distinct from captain)
    const viceCaptain = sortedForCaptaincy.find(p => p.id !== captain?.id) || 
      (sortedForCaptaincy.length > 1 ? sortedForCaptaincy[1] : (benchPlayers[0] || captain));

    const starters = starterPlayers.map(p => p.id);
    const bench = benchPlayers.map(p => p.id);

    // Compute weekly score and variance
    const mc = runFPLMonteCarloSimulation(starterPlayers, captain?.id || 0, false, 500);

    steps.push({
      stepIndex: step,
      gameweek: gw,
      actionType,
      actionDesc,
      chipName,
      transfersIn,
      transfersOut,
      transfersInDetails: inDetails,
      transfersOutDetails: outDetails,
      hitCost,
      weeklyScore: mc.mean,
      weeklyVariance: Math.round(Math.pow((mc.p90 - mc.mean) / 1.28, 2) * 10) / 10,
      starters,
      bench,
      captainId: captain?.id || 0,
      viceCaptainId: viceCaptain?.id || 0,
      bank: currentBank,
      freeTransfers,
      confidenceInterval: [mc.p10, mc.p90]
    });
  }

  return steps;
}
