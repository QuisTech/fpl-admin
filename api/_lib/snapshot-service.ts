import fs from 'fs';
import path from 'path';

export interface SnapshotMetadata {
  gameweek: number;
  timestamp: number;
  fplformFile: string;
  nativeFile?: string;
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
    const sourceNative = path.resolve(process.cwd(), 'data', 'fpl_native.csv');
    const sourceEo = path.resolve(process.cwd(), 'data', 'top_1000_eo.json');

    const destCsv = path.join(gwDir, 'fplform.csv');
    const destNative = path.join(gwDir, 'fpl_native.csv');
    const destEo = path.join(gwDir, 'top_1000_eo.json');

    let savedCsv = false;
    let savedNative = false;
    let savedEo = false;

    if (fs.existsSync(sourceCsv)) {
      fs.copyFileSync(sourceCsv, destCsv);
      savedCsv = true;
    }

    if (fs.existsSync(sourceNative)) {
      fs.copyFileSync(sourceNative, destNative);
      savedNative = true;
    }

    if (fs.existsSync(sourceEo)) {
      fs.copyFileSync(sourceEo, destEo);
      savedEo = true;
    }

    const metadata: SnapshotMetadata = {
      gameweek,
      timestamp: Date.now(),
      fplformFile: savedCsv ? 'fplform.csv' : '',
      nativeFile: savedNative ? 'fpl_native.csv' : '',
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
  static getSnapshotPaths(gameweek: number): { csvPath: string; nativePath: string; eoPath: string } | null {
    const gwDir = path.join(this.getSnapshotsDir(), `gw_${gameweek}`);
    if (!fs.existsSync(gwDir)) return null;

    const csvPath = path.join(gwDir, 'fplform.csv');
    const nativePath = path.join(gwDir, 'fpl_native.csv');
    const eoPath = path.join(gwDir, 'top_1000_eo.json');

    return {
      csvPath: fs.existsSync(csvPath) ? csvPath : path.resolve(process.cwd(), 'data', 'fplform.csv'),
      nativePath: fs.existsSync(nativePath) ? nativePath : path.resolve(process.cwd(), 'data', 'fpl_native.csv'),
      eoPath: fs.existsSync(eoPath) ? eoPath : path.resolve(process.cwd(), 'data', 'top_1000_eo.json')
    };
  }
}
