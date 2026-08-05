import { VaastavProvider } from '../api/_lib/providers/vaastav.js';
import { ProjectionEngine, ProjectionInput } from '../api/_lib/projection.js';
import { loadWeights } from '../api/_lib/weights-loader.js';

async function main() {
    const p = new VaastavProvider();
    await p.loadSeason('2023-24');
    const snap = p.getDeadlineSnapshot(10, 100, 1, {});
    const pId = Object.keys(snap.players)[0];
    const player = snap.players[parseInt(pId)];
    const engine = new ProjectionEngine(loadWeights('baseline'));
    
    // Force historical mode to test the exact logic that returns NaN in train-cleansheet
    const input: ProjectionInput = {
      playerId: parseInt(pId),
      source: 'EYE_TEST',
      features: player
    };
    const result = engine.predict(input, 10);
    
    console.log("Player:", player.name);
    console.log("Fixtures GW10:", JSON.stringify(player.fixturesByGw[10], null, 2));
    console.log("Result:", result);
}
main();
