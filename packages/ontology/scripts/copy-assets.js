const { existsSync, copyFileSync, mkdirSync, readdirSync, rmSync } = require('fs');
const { join } = require('path');

const src = join(__dirname, '..', 'src', 'graph', 'ontology');
const dest = join(__dirname, '..', 'dist', 'graph', 'ontology');
if (!existsSync(src)) process.exit(0);
rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
for (const entry of readdirSync(src)) {
  if (entry.endsWith('.ttl')) copyFileSync(join(src, entry), join(dest, entry));
}
