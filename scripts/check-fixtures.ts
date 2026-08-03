import fs from 'fs';

const fixtures = JSON.parse(fs.readFileSync('data/fixtures-2026-27.json', 'utf-8'));
const teams = new Set<number>();
fixtures.forEach((f: any) => {
  teams.add(f.team_h);
  teams.add(f.team_a);
});
console.log('Team IDs in fixtures:', Array.from(teams).sort((a, b) => a - b).join(', '));
