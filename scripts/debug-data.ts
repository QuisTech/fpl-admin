import fs from 'fs';
import path from 'path';
import Papa from 'papaparse';

const dataDir = path.resolve(process.cwd(), 'data', 'vaastav', '2023-24');

// Check merged_gw.csv
const gwPath = path.join(dataDir, 'merged_gw.csv');
const gwContent = fs.readFileSync(gwPath, 'utf-8');
const gwResult = Papa.parse(gwContent, { header: true, skipEmptyLines: true });

console.log('=== Merged GW Data Sample ===');
console.log('Total records:', gwResult.data.length);
console.log('Columns:', Object.keys(gwResult.data[0] || {}));
console.log('\nFirst 3 records:');
gwResult.data.slice(0, 3).forEach((row: any, i: number) => {
  console.log(`Record ${i + 1}:`);
  console.log('  element:', row.element, 'name:', row.name, 'GW:', row.GW, 'total_points:', row.total_points, 'minutes:', row.minutes);
});

// Check players_raw.csv
const playersPath = path.join(dataDir, 'players_raw.csv');
const playersContent = fs.readFileSync(playersPath, 'utf-8');
const playersResult = Papa.parse(playersContent, { header: true, skipEmptyLines: true });

console.log('\n=== Players Raw Data Sample ===');
console.log('Total players:', playersResult.data.length);
console.log('Columns:', Object.keys(playersResult.data[0] || {}));
console.log('\nFirst 3 players:');
playersResult.data.slice(0, 3).forEach((row: any, i: number) => {
  console.log(`Player ${i + 1}:`);
  console.log('  id:', row.id, 'name:', row.first_name, row.second_name, 'element_type:', row.element_type);
});