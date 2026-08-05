import { FPLService } from '../api/index.js';
import { CSVOracle } from '../api/_lib/ingestion.js';
import path from 'path';

async function run() {
  const baseData = await (FPLService as any).getBaseData();
  const oracle = new CSVOracle(
    path.resolve(process.cwd(), 'data', 'fplform.csv'),
    baseData.players,
    'safe',
    baseData.fixtures,
    baseData.teams,
    baseData.nextEventId
  );
  
  for (const id of oracle.getAllPlayerIds()) {
    const fplPlayer = baseData.players.find((p: any) => p.id === id);
    if (fplPlayer) {
      const csvName = (oracle as any).playerNames[id];
      if (csvName.toLowerCase() !== fplPlayer.web_name.toLowerCase()) {
         console.log(`Mismatch: CSV Name = "${csvName}", FPL Name = "${fplPlayer.web_name} ${fplPlayer.second_name}" (ID: ${id})`);
      }
    }
  }
}
run();
