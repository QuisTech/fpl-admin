import fs from 'fs';
const lines = fs.readFileSync('data/fplform.csv', 'utf8').split('\n');
let emptyCount = 0;
for (let line of lines) {
  const cols = line.split(',');
  if (cols.length >= 9 && cols[3] && cols[3].length >= 3) {
    const c1 = cols[1]?.trim().replace(/^"|"$/g, '');
    if (!c1) {
      console.log('Empty name row:', line);
      emptyCount++;
    }
  }
}
console.log('Total empty names:', emptyCount);
