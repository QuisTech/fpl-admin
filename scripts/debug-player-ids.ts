import fs from 'fs';
import path from 'path';
import Papa from 'papaparse';

const dataDir = path.resolve(process.cwd(), 'data', 'vaastav', '2023-24');

// Load players_raw.csv
const playersPath = path.join(dataDir, 'players_raw.csv');
const playersContent = fs.readFileSync(playersPath, 'utf-8');
const playersResult = Papa.parse(playersContent, { header: true, skipEmptyLines: true });

console.log('=== Checking Player IDs from backtest ===');
const testIds = [866, 861, 865, 851, 864, 857, 848, 850, 846, 854, 856, 859, 860, 862, 863];

testIds.forEach(id => {
  const player: any = playersResult.data.find((p: any) => parseInt(p.id) === id);
  if (player) {
    console.log(`ID ${id}: ${player.first_name} ${player.second_name} (${player.web_name}), Position: ${player.element_type}, Cost: £${player.now_cost/10}m`);
  } else {
    console.log(`ID ${id}: NOT FOUND`);
  }
});

console.log('\n=== Checking Top Players ===');
const sortedByCost = [...playersResult.data].sort((a: any, b: any) => parseInt(b.now_cost) - parseInt(a.now_cost));
console.log('Top 10 most expensive players:');
sortedByCost.slice(0, 10).forEach((player: any, i: number) => {
  console.log(`${i+1}. ${player.web_name} (ID: ${player.id}): £${player.now_cost/10}m, Position: ${player.element_type}`);
});

// Check Haaland
const haaland: any = playersResult.data.find((p: any) => p.web_name === 'Haaland');
if (haaland) {
  console.log(`\nHaaland found: ID ${haaland.id}, Cost: £${haaland.now_cost/10}m`);
}