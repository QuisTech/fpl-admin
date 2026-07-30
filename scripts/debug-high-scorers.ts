import fs from 'fs';
import path from 'path';
import Papa from 'papaparse';

const dataDir = path.resolve(process.cwd(), 'data', 'vaastav', '2023-24');

// Check merged_gw.csv for high scorers
const gwPath = path.join(dataDir, 'merged_gw.csv');
const gwContent = fs.readFileSync(gwPath, 'utf-8');
const gwResult = Papa.parse(gwContent, { header: true, skipEmptyLines: true });

console.log('=== High Scorers Analysis ===');

// Group by player and sum total points
const playerPoints: Record<number, { name: string; totalPoints: number; gws: number[] }> = {};

gwResult.data.forEach((row: any) => {
  const playerId = parseInt(row.element);
  const points = parseInt(row.total_points) || 0;
  const gw = parseInt(row.GW);
  
  if (!playerPoints[playerId]) {
    playerPoints[playerId] = { name: row.name, totalPoints: 0, gws: [] };
  }
  playerPoints[playerId].totalPoints += points;
  playerPoints[playerId].gws.push(gw);
});

// Sort by total points
const sortedPlayers = Object.entries(playerPoints)
  .map(([id, data]) => ({ id: parseInt(id), ...data }))
  .sort((a, b) => b.totalPoints - a.totalPoints);

console.log('Top 10 scorers:');
sortedPlayers.slice(0, 10).forEach((player, i) => {
  console.log(`${i + 1}. ${player.name} (ID: ${player.id}): ${player.totalPoints} points across ${player.gws.length} GWs`);
});

// Check a specific high scorer (e.g., Haaland - likely ID around 300-400)
const haaland = sortedPlayers.find(p => p.name.toLowerCase().includes('haaland'));
if (haaland) {
  console.log(`\n=== Haaland Details ===`);
  console.log(`Haaland (ID: ${haaland.id}): ${haaland.totalPoints} total points`);
  
  // Show specific GW performances
  const haalandData = gwResult.data.filter((row: any) => parseInt(row.element) === haaland.id);
  console.log('\nSample GW performances:');
  haalandData.slice(0, 5).forEach((row: any) => {
    console.log(`  GW${row.GW}: ${row.total_points} pts, ${row.minutes} mins, ${row.goals_scored} goals`);
  });
}