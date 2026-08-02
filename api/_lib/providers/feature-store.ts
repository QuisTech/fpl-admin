import fs from 'fs';
import path from 'path';

export interface TeamFeatures {
  attack: number;
  defense: number;
  confidence: number;
  // Future extensibility:
  // homeStrength?: number;
  // pressing?: number;
}

// Data structure: Season -> Gameweek -> TeamId -> TeamFeatures
export type FeatureStoreData = Record<string, Record<number, Record<number, TeamFeatures>>>;

export class FeatureStoreRepository {
  private storePath: string;
  private data: FeatureStoreData = {};

  constructor() {
    this.storePath = path.resolve(process.cwd(), 'data', 'feature-store.json');
    this.load();
  }

  public load() {
    if (fs.existsSync(this.storePath)) {
      try {
        const fileContent = fs.readFileSync(this.storePath, 'utf-8');
        this.data = JSON.parse(fileContent);
      } catch (err) {
        console.warn(`[FeatureStore] Failed to load feature store: ${(err as Error).message}`);
        this.data = {};
      }
    }
  }

  public save() {
    const dir = path.dirname(this.storePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(this.storePath, JSON.stringify(this.data, null, 2));
  }

  public getFeatures(season: string, gameweek: number, teamId: number): TeamFeatures {
    // Attempt to get exact gameweek features
    if (this.data[season]?.[gameweek]?.[teamId]) {
      return this.data[season][gameweek][teamId];
    }
    
    // If exact gameweek isn't found, look for the most recent gameweek in the same season
    if (this.data[season]) {
      const gws = Object.keys(this.data[season]).map(Number).filter(gw => gw <= gameweek).sort((a, b) => b - a);
      if (gws.length > 0) {
        return this.data[season][gws[0]][teamId] || { attack: 1.5, defense: 1.5, confidence: 0.1 };
      }
    }

    // For current/future seasons, use the final gameweek of 2023-24 as a reasonable baseline
    if (season !== '2021-22' && season !== '2022-23' && season !== '2023-24') {
      if (this.data['2023-24']?.[38]?.[teamId]) {
        return this.data['2023-24'][38][teamId];
      }
    }

    // Default baseline if completely missing
    return { attack: 1.5, defense: 1.5, confidence: 0.1 };
  }

  public setFeatures(season: string, gameweek: number, teamId: number, features: TeamFeatures) {
    if (!this.data[season]) {
      this.data[season] = {};
    }
    if (!this.data[season][gameweek]) {
      this.data[season][gameweek] = {};
    }
    this.data[season][gameweek][teamId] = features;
  }
}
