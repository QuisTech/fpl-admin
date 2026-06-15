const fs = require('fs');
const path = require('path');

const apiDir = path.join(__dirname, '..', 'api');
const libDir = path.join(apiDir, '_lib');

if (!fs.existsSync(libDir)) {
  fs.mkdirSync(libDir);
}

const filesToMove = [
  'gemini-agent.ts',
  'index.test.ts',
  'ingestion.ts',
  'lp-solver.ts',
  'run_sim.ts',
  'simulator.ts',
  'types.ts'
];

// Move files
for (const file of filesToMove) {
  const oldPath = path.join(apiDir, file);
  const newPath = path.join(libDir, file);
  if (fs.existsSync(oldPath)) {
    fs.renameSync(oldPath, newPath);
    console.log(`Moved ${file} to _lib`);
  }
}

// Helper to replace contents
function replaceInFile(filePath, replacements) {
  if (!fs.existsSync(filePath)) return;
  let content = fs.readFileSync(filePath, 'utf8');
  for (const [from, to] of replacements) {
    content = content.replace(from, to);
  }
  fs.writeFileSync(filePath, content, 'utf8');
}

// Update imports in endpoints
const endpoints = fs.readdirSync(apiDir).filter(f => f.endsWith('.ts'));
for (const endpoint of endpoints) {
  replaceInFile(path.join(apiDir, endpoint), [
    [/(from\s+['"]\.\/)(gemini-agent|ingestion|lp-solver|run_sim|simulator|types)((\.js)?['"])/g, '$1_lib/$2$3']
  ]);
}

// Update imports in the moved files
for (const movedFile of filesToMove) {
  const filePath = path.join(libDir, movedFile);
  
  // They are now in api/_lib, so imports to '../lib/...' become '../../lib/...'
  replaceInFile(filePath, [
    [/(from\s+['"])\.\.\/lib\//g, '$1../../lib/']
  ]);
  
  // index.test.ts imports from './index' which is now '../index'
  if (movedFile === 'index.test.ts') {
    replaceInFile(filePath, [
      [/(from\s+['"])\.\/index(['"])/g, '$1../index$2']
    ]);
  }
}

console.log("Refactoring complete");
