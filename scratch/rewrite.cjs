const fs = require('fs');

let content = fs.readFileSync('api/_lib/ingestion.ts', 'utf-8');

// 1. Rename CSVOracle to BaseCSVOracle and make it abstract
content = content.replace('export class CSVOracle implements XPOracle {', 'export abstract class BaseCSVOracle implements XPOracle {');

// 2. Change private members to protected
content = content.replace('private xpMatrix', 'protected xpMatrix');
content = content.replace('private playerPositions', 'protected playerPositions');
content = content.replace('private playerCosts', 'protected playerCosts');
content = content.replace('private playerTeams', 'protected playerTeams');
content = content.replace('private allIds', 'protected allIds');
content = content.replace('private top1kData', 'protected top1kData');
content = content.replace('private featuresMatrix', 'protected featuresMatrix');
content = content.replace('private projectionEngine', 'protected projectionEngine');

// 3. Remove fuel property
content = content.replace("private fuel: string = 'fplform';", 'protected abstract get fuelSource(): "NATIVE" | "EYE_TEST" | "FPLFORM";\n  protected abstract populateXP(fplId: number, cols: string[], meritScore: number, nextEventId: number): void;');
content = content.replace("this.fuel = fuel;", "");
content = content.replace("fuel: string = 'fplform',", "");
content = content.replace("fuel: string,", "");

// 4. Update loadData signature and usages of fuel
content = content.replace(/fuel === 'eye-test'/g, "this.fuelSource === 'EYE_TEST'");
content = content.replace(/this\.fuel === 'native'/g, "this.fuelSource === 'NATIVE'");
content = content.replace(/this\.fuel === 'eye-test'/g, "this.fuelSource === 'EYE_TEST'");
content = content.replace(/this\.fuel === 'fplform'/g, "this.fuelSource === 'FPLFORM'");
content = content.replace(/fuel !== 'eye-test'/g, "this.fuelSource !== 'EYE_TEST'");

content = content.replace("this.loadData(filePath, players, fixtures, teams, nextEventId, riskMode, fuel, fixturesFilePath);", "this.loadData(filePath, players, fixtures, teams, nextEventId, riskMode, fixturesFilePath);");
content = content.replace("    fuel: string = 'fplform',\n    fixturesFilePath?: string", "    fixturesFilePath?: string");

// 5. Replace the populateXP loop inside loadData
const xpLoop = `        // Store external xp from CSV directly
        this.xpMatrix[fplId] = {};
        for (let step = 0; step < 15; step++) {
          const gw = nextEventId + step;
          const decayFactor = Math.pow(0.9, step);
          this.xpMatrix[fplId][gw] = meritScore * decayFactor;
        }`;

const newXpLoop = `        this.populateXP(fplId, cols, meritScore, nextEventId);`;
content = content.replace(xpLoop, newXpLoop);

// 6. Fix getProjectionInput
content = content.replace(/source: this\.fuelSource === 'NATIVE' \? 'NATIVE' : \(this\.fuelSource === 'EYE_TEST' \? 'EYE_TEST' : 'FPLFORM'\)/g, "source: this.fuelSource");

// 7. Append subclasses and factory
content += `

export class FplformOracle extends BaseCSVOracle {
  protected get fuelSource() { return 'FPLFORM' as const; }
  protected populateXP(fplId: number, cols: string[], meritScore: number, nextEventId: number): void {
    this.xpMatrix[fplId] = {};
    for (let step = 0; step < 15; step++) {
      const gw = nextEventId + step;
      // FPLForm has columns for each gameweek starting at index 6
      const xpVal = parseFloat(cols[6 + step]) || 0; 
      this.xpMatrix[fplId][gw] = xpVal;
    }
  }
}

export class NativeOracle extends BaseCSVOracle {
  protected get fuelSource() { return 'NATIVE' as const; }
  protected populateXP(fplId: number, cols: string[], meritScore: number, nextEventId: number): void {
    this.xpMatrix[fplId] = {};
    for (let step = 0; step < 15; step++) {
      const gw = nextEventId + step;
      // Native API only gives GW1 ep_next, so we decay it for future gameweeks
      const decayFactor = Math.pow(0.9, step);
      this.xpMatrix[fplId][gw] = meritScore * decayFactor;
    }
  }
}

export class EyeTestOracle extends BaseCSVOracle {
  protected get fuelSource() { return 'EYE_TEST' as const; }
  protected populateXP(fplId: number, cols: string[], meritScore: number, nextEventId: number): void {
    // Eye Test relies entirely on ProjectionEngine's ML models, so no external XP is stored.
    this.xpMatrix[fplId] = {};
  }
}

export class OracleFactory {
  static create(
    csvFileName: string, 
    players: any[], 
    fuel: string, 
    fixtures: any[], 
    teams: any[], 
    nextEventId: number,
    riskMode: string = 'safe',
    fixturesFilePath?: string
  ): XPOracle {
    if (fuel === 'native') return new NativeOracle(csvFileName, players, riskMode, fixtures, teams, nextEventId, fixturesFilePath);
    if (fuel === 'eye-test') return new EyeTestOracle(csvFileName, players, riskMode, fixtures, teams, nextEventId, fixturesFilePath);
    return new FplformOracle(csvFileName, players, riskMode, fixtures, teams, nextEventId, fixturesFilePath);
  }
}
`;

fs.writeFileSync('api/_lib/ingestion.ts', content, 'utf-8');
console.log('Done!');
