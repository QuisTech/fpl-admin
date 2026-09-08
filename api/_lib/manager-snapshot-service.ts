import fs from 'fs';
import path from 'path';
import axios from 'axios';

export interface ManagerGWDecisionSnapshot {
  season: string;
  gameweek: number;
  manager_id: number;
  manager_name: string;
  team_name: string;
  overall_rank: number;
  gw_rank?: number;
  total_points: number;
  gw_points?: number;
  chips_used: Array<{ name: string; time: string; event: number }>;
  active_chip?: string | null;
  squad_15: number[];
  starting_xi: number[];
  captain_id: number | null;
  vice_captain_id: number | null;
  transfers_in: number[];
  transfers_out: number[];
  bank: number;
  team_value: number;
  timestamp: number;
}

export interface EliteCohortArchive {
  season: string;
  gameweek: number;
  sample_size: number;
  last_updated: number;
  decisions: ManagerGWDecisionSnapshot[];
}

export class ManagerSnapshotService {
  private static FPL_BASE_URL = "https://fantasy.premierleague.com/api";

  private static getHeaders() {
    return {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      "Accept": "application/json, text/plain, */*"
    };
  }

  /**
   * Save a snapshot of raw manager decision history for a given season & gameweek
   */
  public static saveSnapshot(season: string, gameweek: number, decisions: ManagerGWDecisionSnapshot[]) {
    const dir = path.resolve(process.cwd(), 'data', 'snapshots', `gw_${gameweek}`);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const archivePath = path.join(dir, 'manager_decisions.json');
    const archive: EliteCohortArchive = {
      season,
      gameweek,
      sample_size: decisions.length,
      last_updated: Date.now(),
      decisions
    };
    fs.writeFileSync(archivePath, JSON.stringify(archive, null, 2));
    console.log(`[ManagerSnapshotService] Archived ${decisions.length} raw manager decision records to ${archivePath}`);
  }

  /**
   * Load archived manager decision snapshot
   */
  public static loadSnapshot(gameweek: number): EliteCohortArchive | null {
    const archivePath = path.resolve(process.cwd(), 'data', 'snapshots', `gw_${gameweek}`, 'manager_decisions.json');
    if (!fs.existsSync(archivePath)) {
      return null;
    }
    try {
      const raw = fs.readFileSync(archivePath, 'utf-8');
      return JSON.parse(raw);
    } catch (err: any) {
      console.warn(`[ManagerSnapshotService] Failed to load snapshot for GW${gameweek}: ${err.message}`);
      return null;
    }
  }

  /**
   * Capture live pre-deadline manager decision snapshots for top 0-chip / elite veteran managers
   */
  public static async captureTopManagerSnapshots(season: string = '2026-27', targetGw: number = 3, sampleLimit: number = 50): Promise<ManagerGWDecisionSnapshot[]> {
    const decisions: ManagerGWDecisionSnapshot[] = [];
    try {
      const standingsUrl = `${this.FPL_BASE_URL}/leagues-classic/314/standings/?page_standings=1`;
      const standingsRes = await axios.get(standingsUrl, { headers: this.getHeaders(), timeout: 10000 });
      const results = standingsRes.data.standings?.results || [];

      for (let i = 0; i < Math.min(sampleLimit, results.length); i++) {
        const mgr = results[i];
        try {
          const [histRes, picksRes, xfersRes] = await Promise.all([
            axios.get(`${this.FPL_BASE_URL}/entry/${mgr.entry}/history/`, { headers: this.getHeaders(), timeout: 8000 }),
            axios.get(`${this.FPL_BASE_URL}/entry/${mgr.entry}/event/${targetGw}/picks/`, { headers: this.getHeaders(), timeout: 8000 }),
            axios.get(`${this.FPL_BASE_URL}/entry/${mgr.entry}/transfers/`, { headers: this.getHeaders(), timeout: 8000 })
          ]);

          const chipsUsed = histRes.data.chips || [];
          const currentPickData = picksRes.data;
          const picks = currentPickData.picks || [];

          const squad_15 = picks.map((p: any) => p.element);
          const starting_xi = picks.filter((p: any) => p.position <= 11).map((p: any) => p.element);
          const capObj = picks.find((p: any) => p.is_captain);
          const vcObj = picks.find((p: any) => p.is_vice_captain);

          const gwTransfers = (xfersRes.data || []).filter((t: any) => t.event === targetGw);
          const transfers_in = gwTransfers.map((t: any) => t.element_in);
          const transfers_out = gwTransfers.map((t: any) => t.element_out);

          const snap: ManagerGWDecisionSnapshot = {
            season,
            gameweek: targetGw,
            manager_id: mgr.entry,
            manager_name: mgr.player_name,
            team_name: mgr.entry_name,
            overall_rank: mgr.rank,
            gw_rank: currentPickData.entry_history?.rank,
            total_points: mgr.total,
            gw_points: currentPickData.entry_history?.points,
            chips_used: chipsUsed,
            active_chip: currentPickData.active_chip || null,
            squad_15,
            starting_xi,
            captain_id: capObj ? capObj.element : null,
            vice_captain_id: vcObj ? vcObj.element : null,
            transfers_in,
            transfers_out,
            bank: currentPickData.entry_history?.bank || 0,
            team_value: currentPickData.entry_history?.value || 1000,
            timestamp: Date.now()
          };

          decisions.push(snap);
        } catch (mgrErr: any) {
          // ignore rate limits per manager
        }
      }

      if (decisions.length > 0) {
        this.saveSnapshot(season, targetGw, decisions);
      }
    } catch (err: any) {
      console.warn(`[ManagerSnapshotService] Live capture failed: ${err.message}`);
    }
    return decisions;
  }
}
