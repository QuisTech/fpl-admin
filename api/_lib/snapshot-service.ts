import fs from 'fs';
import path from 'path';

export interface SnapshotMetadata {
  gameweek: number;
  timestamp: number;
  fplformFile: string;
  eoFile: string;
}

export class SnapshotService {
  private static getSnapshotsDir(): string {
    return path.resolve(process.cwd(), 'data', 'snapshots');
  }

  /**
   * Save current data files (fplform.csv, top_1000_eo.json) into a point-in-time snapshot directory.
   */
  static saveSnapshot(gameweek: number): { success: boolean; snapshotDir: string; message: string } {
    const snapshotsBase = this.getSnapshotsDir();
    const gwDir = path.join(snapshotsBase, `gw_${gameweek}`);

    if (!fs.existsSync(gwDir)) {
      fs.mkdirSync(gwDir, { recursive: true });
    }

    const sourceCsv = path.resolve(process.cwd(), 'data', 'fplform.csv');
    const sourceEo = path.resolve(process.cwd(), 'data', 'top_1000_eo.json');

    const destCsv = path.join(gwDir, 'fplform.csv');
    const destEo = path.join(gwDir, 'top_1000_eo.json');

    let savedCsv = false;
    let savedEo = false;

    if (fs.existsSync(sourceCsv)) {
      fs.copyFileSync(sourceCsv, destCsv);
      savedCsv = true;
    }

    if (fs.existsSync(sourceEo)) {
      fs.copyFileSync(sourceEo, destEo);
      savedEo = true;
    }

    const metadata: SnapshotMetadata = {
      gameweek,
      timestamp: Date.now(),
      fplformFile: savedCsv ? 'fplform.csv' : '',
      eoFile: savedEo ? 'top_1000_eo.json' : ''
    };

    fs.writeFileSync(path.join(gwDir, 'metadata.json'), JSON.stringify(metadata, null, 2));

    console.log(`[SnapshotService] Archived snapshot for Gameweek ${gameweek} at ${gwDir}`);
    return {
      success: savedCsv || savedEo,
      snapshotDir: gwDir,
      message: `Snapshot for GW${gameweek} saved successfully.`
    };
  }

  /**
   * Check if a snapshot exists for a given Gameweek.
   */
  static hasSnapshot(gameweek: number): boolean {
    const gwDir = path.join(this.getSnapshotsDir(), `gw_${gameweek}`);
    return fs.existsSync(gwDir) && fs.existsSync(path.join(gwDir, 'metadata.json'));
  }

  /**
   * Get relative or absolute file paths for an archived snapshot.
   */
  static getSnapshotPaths(gameweek: number): { csvPath: string; eoPath: string } | null {
    const gwDir = path.join(this.getSnapshotsDir(), `gw_${gameweek}`);
    if (!fs.existsSync(gwDir)) return null;

    const csvPath = path.join(gwDir, 'fplform.csv');
    const eoPath = path.join(gwDir, 'top_1000_eo.json');

    return {
      csvPath: fs.existsSync(csvPath) ? csvPath : path.resolve(process.cwd(), 'data', 'fplform.csv'),
      eoPath: fs.existsSync(eoPath) ? eoPath : path.resolve(process.cwd(), 'data', 'top_1000_eo.json')
    };
  }
}
