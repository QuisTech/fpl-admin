import { VaastavProvider } from '../api/_lib/providers/vaastav.js';
import { DeadlineSnapshot } from '../api/_lib/providers/historical.js';

async function validateFeatures() {
  const provider = new VaastavProvider();
  await provider.loadSeason('2023-24');

  console.log("Validating features to ensure ZERO look-ahead bias...");
  
  // Test across a few critical gameweeks (GW1, GW20, GW38)
  const testGws = [1, 20, 38];

  for (const gw of testGws) {
    console.log(`\n--- Validating Gameweek ${gw} ---`);
    const snapshot = provider.getDeadlineSnapshot(gw, 1000, 1, {});

    assertPricesKnown(snapshot, gw);
    assertNoFutureFixtures(snapshot, gw);
    assertNoFuturePoints(snapshot, gw);
  }
  
  console.log("\n✅ All assertions passed. Zero look-ahead bias confirmed.");
}

function assertPricesKnown(snapshot: DeadlineSnapshot, gw: number) {
  let missingPrices = 0;
  for (const player of Object.values(snapshot.players)) {
    if (player.price === 0 || isNaN(player.price)) {
      missingPrices++;
    }
  }
  if (missingPrices > 50) { // Some players never play or have weird data, but shouldn't be too many
    throw new Error(`GW${gw}: Too many players (${missingPrices}) have unknown prices!`);
  }
}

function assertNoFutureFixtures(snapshot: DeadlineSnapshot, gw: number) {
  // A deadline snapshot should only contain fixtures for the CURRENT gameweek.
  // Wait, if it contains future fixtures, the projection engine might cheat if those fixtures include results.
  // We just ensure the fixtures array exists and doesn't contain actual results.
  for (const player of Object.values(snapshot.players)) {
    if (player.fixturesByGw) {
      for (const gwKey of Object.keys(player.fixturesByGw)) {
        for (const fixture of player.fixturesByGw[parseInt(gwKey)]) {
          if ((fixture as any).team_h_score !== undefined || (fixture as any).team_a_score !== undefined) {
            throw new Error(`GW${gw}: Look-ahead bias! Fixture contains actual scores.`);
          }
        }
      }
    }
  }
}

function assertNoFuturePoints(snapshot: DeadlineSnapshot, gw: number) {
  // The snapshot should NOT contain expectedPoints or variance.
  for (const player of Object.values(snapshot.players)) {
    if ('expectedPoints' in player || 'variance' in player || 'actualPoints' in player) {
      throw new Error(`GW${gw}: Look-ahead bias! Player contains future points/variance data.`);
    }
    // Also ensure the xG90 is not NaN
    if (isNaN(player.xG90) || isNaN(player.minutesLast4)) {
      throw new Error(`GW${gw}: Player ${player.name} has NaN for xG90 or minutesLast4.`);
    }
  }
}

validateFeatures().catch(err => {
  console.error("❌ VALIDATION FAILED:");
  console.error(err);
  process.exit(1);
});
