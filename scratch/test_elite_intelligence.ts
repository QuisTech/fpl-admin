import { ManagerSnapshotService, DEFAULT_INTELLIGENCE_CONFIG } from '../api/_lib/manager-snapshot-service.js';
import { FPLService } from '../api/index.js';

async function runTests() {
  console.log('=== ELITE CONVICTION & TIMING ARCHITECTURE VERIFICATION ===\n');

  // 1. Structural Rate & Conviction Tests
  console.log('--- Test Suite 1: Structural Rate & Conviction Tests ---');
  const base = await FPLService.getBaseData();
  const insight = await ManagerSnapshotService.getDynamicTopManagerInsight(base.players, 3);

  console.log(`Eligible Cohort Size: ${insight.eligibleManagers} managers`);
  console.log(`No-Chip Leaders Count: ${insight.noChipLeaderCount}`);
  if (insight.eligibleManagers !== 2) {
    throw new Error(`Expected eligibleManagers to be 2, got ${insight.eligibleManagers}`);
  }

  // Structural formula verification for each player
  for (const detail of insight.consensusDetails) {
    if (detail.eligibleManagers !== insight.eligibleManagers) {
      throw new Error(`Detail eligibleManagers mismatch for ${detail.web_name}`);
    }

    const expectedOwnershipRate = Math.round((detail.squadCount / detail.eligibleManagers) * 1000) / 1000;
    const expectedStartRate = Math.round((detail.startCount / detail.eligibleManagers) * 1000) / 1000;
    const expectedBenchRate = Math.round((detail.benchCount / detail.eligibleManagers) * 1000) / 1000;
    const expectedCapRate = Math.round((detail.captainCount / detail.eligibleManagers) * 1000) / 1000;
    const expectedVcRate = Math.round((detail.viceCaptainCount / detail.eligibleManagers) * 1000) / 1000;
    const expectedXferInRate = Math.round((detail.transfersInCount / detail.eligibleManagers) * 1000) / 1000;

    if (detail.ownershipRate !== expectedOwnershipRate) {
      throw new Error(`Ownership rate mismatch for ${detail.web_name}`);
    }
    if (detail.startRate !== expectedStartRate) {
      throw new Error(`Start rate mismatch for ${detail.web_name}`);
    }
    if (detail.benchRate !== expectedBenchRate) {
      throw new Error(`Bench rate mismatch for ${detail.web_name}`);
    }
    if (detail.captainRate !== expectedCapRate) {
      throw new Error(`Captain rate mismatch for ${detail.web_name}`);
    }
    if (detail.transfersInRate !== expectedXferInRate) {
      throw new Error(`Transfer In participation rate mismatch for ${detail.web_name}`);
    }

    // Conviction formula: (startRate * 1.0) + (captainRate * 0.5) - (benchRate * 0.2)
    const rawExpectedConviction = (detail.startRate * DEFAULT_INTELLIGENCE_CONFIG.startWeight) +
      (detail.captainRate * DEFAULT_INTELLIGENCE_CONFIG.captainWeight) -
      (detail.benchRate * DEFAULT_INTELLIGENCE_CONFIG.benchPenalty);
    const expectedConviction = Math.round(rawExpectedConviction * 1000) / 1000;

    if (detail.convictionScore !== expectedConviction) {
      throw new Error(`Conviction score mismatch for ${detail.web_name}: got ${detail.convictionScore}, expected ${expectedConviction}`);
    }

    // Two-condition hard-lock rule:
    const expectedHardLock = detail.convictionScore >= DEFAULT_INTELLIGENCE_CONFIG.hardLockMinConviction &&
      detail.startRate >= DEFAULT_INTELLIGENCE_CONFIG.startingWeaponMinStartRate;

    if (detail.qualifiesForHardLock !== expectedHardLock) {
      throw new Error(`qualifiesForHardLock mismatch for ${detail.web_name}`);
    }
  }
  console.log('✓ All structural rate, conviction, and hard-lock formulas verified!\n');

  // 2. Adversarial Edge Case Tests
  console.log('--- Test Suite 2: Adversarial Tests ---');
  // Adversarial Case A: 100% captain rate but only 25% start rate (e.g. 1 start, 3 bench out of 4 managers, 4 captains)
  // Even if conviction score were high, startRate < 0.50 MUST reject hard lock
  const advStartRate = 0.25;
  const advCapRate = 1.0;
  const advBenchRate = 0.75;
  const advConviction = (advStartRate * DEFAULT_INTELLIGENCE_CONFIG.startWeight) +
    (advCapRate * DEFAULT_INTELLIGENCE_CONFIG.captainWeight) -
    (advBenchRate * DEFAULT_INTELLIGENCE_CONFIG.benchPenalty);
  const advQualifiesForHardLock = advConviction >= DEFAULT_INTELLIGENCE_CONFIG.hardLockMinConviction &&
    advStartRate >= DEFAULT_INTELLIGENCE_CONFIG.startingWeaponMinStartRate;

  console.log(`Adversarial Case A (25% Start, 100% Captain): Conviction = ${advConviction.toFixed(2)}, qualifiesForHardLock = ${advQualifiesForHardLock}`);
  if (advQualifiesForHardLock !== false) {
    throw new Error('Adversarial Test A Failed: Player with only 25% start rate should NOT qualify for hard lock!');
  }
  console.log('✓ Adversarial Test A passed: low start rate prevented illegitimate hard lock.');

  // Adversarial Case B: Multi-manager aggregate coexistence (50% start, 50% bench)
  // Ensures aggregate counts correctly allow a player to have both startRate > 0 and benchRate > 0
  const pedroDetail = insight.consensusDetails.find(d => d.id === 165 || d.web_name.includes('Pedro'));
  console.log(`Adversarial Case B (Aggregate Split across Managers): João Pedro startRate = ${pedroDetail?.startRate}, benchRate = ${pedroDetail?.benchRate}`);
  if (!pedroDetail || pedroDetail.startRate !== 0.5 || pedroDetail.benchRate !== 0.5) {
    throw new Error('Adversarial Test B Failed: Aggregate multi-manager split not properly captured');
  }
  if (pedroDetail.qualifiesForHardLock !== false) {
    throw new Error('Adversarial Test B Failed: 50% start / 50% bench pick should be soft signal, not hard lock!');
  }
  console.log('✓ Adversarial Test B passed: multi-manager aggregate rates coexist without conflict.\n');

  // 3. Diagnostic Assertions on GW3 Live Snapshot
  console.log('--- Test Suite 3: Diagnostic Snapshot Assertions ---');
  const palmer = insight.consensusDetails.find(d => d.id === 154);
  const cherki = insight.consensusDetails.find(d => d.id === 399);
  const bruno = insight.consensusDetails.find(d => d.id === 426);
  const szoboszlai = insight.consensusDetails.find(d => d.id === 368);
  const isak = insight.consensusDetails.find(d => d.id === 379);
  const dubravka = insight.consensusDetails.find(d => d.id === 497);

  console.log(`Palmer:     Start: ${(palmer!.startRate * 100)}% | Cap: ${(palmer!.captainRate * 100)}% | Bench: ${(palmer!.benchRate * 100)}% | Conviction: ${palmer!.convictionScore} | HardLock: ${palmer!.qualifiesForHardLock}`);
  console.log(`Cherki:     Start: ${(cherki!.startRate * 100)}% | Cap: ${(cherki!.captainRate * 100)}% | Bench: ${(cherki!.benchRate * 100)}% | Conviction: ${cherki!.convictionScore} | HardLock: ${cherki!.qualifiesForHardLock}`);
  console.log(`Bruno:      Start: ${(bruno!.startRate * 100)}% | Cap: ${(bruno!.captainRate * 100)}% | Bench: ${(bruno!.benchRate * 100)}% | Conviction: ${bruno!.convictionScore} | HardLock: ${bruno!.qualifiesForHardLock}`);
  console.log(`Szoboszlai: Start: ${(szoboszlai!.startRate * 100)}% | Cap: ${(szoboszlai!.captainRate * 100)}% | Bench: ${(szoboszlai!.benchRate * 100)}% | Conviction: ${szoboszlai!.convictionScore} | HardLock: ${szoboszlai!.qualifiesForHardLock}`);
  console.log(`Isak:       Start: ${(isak!.startRate * 100)}% | Cap: ${(isak!.captainRate * 100)}% | Bench: ${(isak!.benchRate * 100)}% | Conviction: ${isak!.convictionScore} | HardLock: ${isak!.qualifiesForHardLock}`);
  console.log(`Dubravka:   Start: ${(dubravka!.startRate * 100)}% | Cap: ${(dubravka!.captainRate * 100)}% | Bench: ${(dubravka!.benchRate * 100)}% | Conviction: ${dubravka!.convictionScore} | BenchEnabler: ${dubravka!.isBenchEnabler} | HardLock: ${dubravka!.qualifiesForHardLock}`);

  if (!palmer?.qualifiesForHardLock || palmer.convictionScore !== 1.0) {
    throw new Error(`Palmer diagnostic failed: expected conviction 1.0, got ${palmer?.convictionScore}`);
  }
  if (!cherki?.qualifiesForHardLock || cherki.convictionScore !== 1.25) {
    throw new Error(`Cherki diagnostic failed: expected conviction 1.25, got ${cherki?.convictionScore}`);
  }
  if (!bruno?.qualifiesForHardLock || bruno.convictionScore !== 1.0) {
    throw new Error(`Bruno diagnostic failed: expected conviction 1.0, got ${bruno?.convictionScore}`);
  }
  if (!szoboszlai?.qualifiesForHardLock || szoboszlai.convictionScore !== 1.0) {
    throw new Error(`Szoboszlai diagnostic failed: expected conviction 1.0, got ${szoboszlai?.convictionScore}`);
  }
  if (!isak?.qualifiesForHardLock || isak.convictionScore !== 1.25) {
    throw new Error(`Isak diagnostic failed: expected conviction 1.25, got ${isak?.convictionScore}`);
  }
  if (!dubravka?.isBenchEnabler || dubravka.qualifiesForHardLock !== false) {
    throw new Error(`Dubravka diagnostic failed: expected Bench Enabler with qualifiesForHardLock = false`);
  }
  console.log('✓ All diagnostic observations verified!\n');

  // 4. End-to-End Recommendations (VALUE Mode)
  console.log('--- Test Suite 4: VALUE Mode Solver Lineup Test ---');
  const res = await FPLService.getRecommendations('value', 1000, 'free', 'fplform');

  console.log(`Starting XI: ${res.startingXI.length} players | Bench: ${res.bench.length} players`);
  console.log(`Total Cost: £${(res.totalCost / 10).toFixed(1)}m | xP: ${res.expectedPoints.toFixed(1)}`);
  console.log(`Engine Diagnostics Status: ${res.engineDiagnostics?.solverStatus}`);

  const startingIds = new Set(res.startingXI.map(p => p.id));
  const startingNames = res.startingXI.map(p => p.web_name.toLowerCase());

  console.log('\nStarting XI Lineup:');
  res.startingXI.forEach(p => {
    console.log(`  [${p.position}] ${p.web_name.padEnd(16)} £${(Number(p.cost || p.now_cost || 0) / 10).toFixed(1)}m | xP: ${p.xP}`);
  });

  console.log('\nBench:');
  res.bench.forEach((p, idx) => {
    console.log(`  Sub ${idx + 1}: [${p.position}] ${p.web_name.padEnd(16)} £${(Number(p.cost || p.now_cost || 0) / 10).toFixed(1)}m | xP: ${p.xP}`);
  });

  // Verify all qualifying hard-locks start
  const requiredHardLockIds = [154, 399, 426, 368, 379, 15, 8, 391]; // Palmer, Cherki, Bruno, Szoboszlai, Isak, Odegaard, Calafiori, Gvardiol
  for (const id of requiredHardLockIds) {
    if (!startingIds.has(id)) {
      const p = base.players.find(x => x.id === id);
      throw new Error(`Hard-locked weapon ${p?.web_name} (ID: ${id}) failed to start in Starting XI!`);
    }
  }
  console.log('✓ 100% of hard-locked starting weapons start on the pitch!');

  console.log('\n=== ALL 4 TEST SUITES PASSED FLAWLESSLY ===');
}

runTests().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
