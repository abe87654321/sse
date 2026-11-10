import { execFileSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';

const packageRoot = join(__dirname, '..', '..');
const distEntry = join(packageRoot, 'dist', 'index.js');
const run = existsSync(distEntry) ? it : it.skip;

describe('SHACL validator loading', () => {
  run('requires @sse/ontology without loading the ESM SHACL validator', () => {
    const script = [
      "const loaded = () => Object.keys(require.cache).some((p) => p.includes('rdf-validate-shacl'));",
      'const before = loaded();',
      "require('./dist');",
      'const after = loaded();',
      'process.stdout.write(JSON.stringify({ before, after }));',
    ].join('\n');

    const output = execFileSync(process.execPath, ['-e', script], {
      cwd: packageRoot,
      encoding: 'utf8',
    });
    const result = JSON.parse(output.trim());

    expect(result.before).toBe(false);
    expect(result.after).toBe(false);
  });
});
