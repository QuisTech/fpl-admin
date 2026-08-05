import { VaastavProvider } from '../api/_lib/providers/vaastav.js';
import { ProjectionEngine, UtilityParameters, HistoricalOracle } from '../api/_lib/projection.js';
import { loadWeights } from '../api/_lib/weights-loader.js';

async function run() {
  const p = new VaastavProvider();
  await p.loadSeason('2022-23');
  const gw = 10;
  const snapshot = p.getDeadlineSnapshot(gw, 1000, 0, {});
  
  const params = loadWeights('baseline');
  const engine = new ProjectionEngine(params);
  const oracle = new HistoricalOracle(snapshot, engine);
  const validPlayers = oracle.getAllPlayerIds().filter(id => oracle.getCost(id) > 0);

  let c = 0;
  let c2 = 0;
  let c3 = 0;
  for (const id of validPlayers) {
     oracle.getXP(id, gw);
     const fixtures = snapshot.players[id].fixturesByGw?.[gw];
     if (fixtures && fixtures.length > 0) {
        c++;
        const expMins = snapshot.players[id].predictedMinutes;
        if (expMins !== undefined) {
           c2++;
           if (expMins >= 60) {
              c3++;
           }
        }
     }
  }
  console.log('Players with fixtures:', c);
  console.log('Players with predictedMinutes:', c2);
  console.log('Players with predictedMinutes >= 60:', c3);
}

run();
