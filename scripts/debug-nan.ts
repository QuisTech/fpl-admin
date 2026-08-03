import { VaastavProvider } from '../api/_lib/providers/vaastav.js';
import { ProjectionEngine } from '../api/_lib/projection.js';

async function main() {
    const p = new VaastavProvider();
    await p.loadSeason('2023-24');
    const snap = p.getDeadlineSnapshot(10, 100, 1, {});
    const pId = Object.keys(snap.players)[0];
    const player = snap.players[parseInt(pId)];
    const engine = new ProjectionEngine();
    
    // We want to force historical mode to test the exact logic that returns NaN in train-cleansheet
    // Wait, the projection engine automatically picks up historical mode if it's not NATIVE/FPLFORM.
    const result = engine.predict(player, 'EYE_TEST', { gameweek: 10 } as any);
    
    console.log("Player:", player.name);
    console.log("Fixtures GW10:", JSON.stringify(player.fixturesByGw[10], null, 2));
    console.log("Result:", result);
}
main();
