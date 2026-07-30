import fs from 'fs';
import path from 'path';
import https from 'https';

const BASE_URL = 'https://raw.githubusercontent.com/vaastav/Fantasy-Premier-League/master/data/';

async function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    console.log(`Downloading ${url} to ${dest}...`);
    const file = fs.createWriteStream(dest);
    https.get(url, (response) => {
      if (response.statusCode !== 200) {
        return reject(new Error(`Failed to get '${url}' (${response.statusCode})`));
      }
      response.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve();
      });
    }).on('error', (err) => {
      fs.unlink(dest, () => reject(err));
    });
  });
}

async function main() {
  const seasons = ['2021-22', '2022-23', '2023-24'];
  
  for (const season of seasons) {
    const outDir = path.resolve(process.cwd(), 'data', 'vaastav', season);
    
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }

    const files = [
      { urlPath: 'fixtures.csv', dest: 'fixtures.csv' },
      { urlPath: 'players_raw.csv', dest: 'players_raw.csv' },
      { urlPath: 'gws/merged_gw.csv', dest: 'merged_gw.csv' }
    ];

    for (const file of files) {
      const url = `${BASE_URL}${season}/${file.urlPath}`;
      const dest = path.resolve(outDir, file.dest);
      await downloadFile(url, dest);
    }
    
    console.log(`Finished downloading Vaastav data for ${season}`);
  }
}

main().catch(console.error);
