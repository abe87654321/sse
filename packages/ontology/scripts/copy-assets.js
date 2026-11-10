const { existsSync, cpSync, mkdirSync } = require('fs');
const { join } = require('path');

const src = join(__dirname, '..', 'src', 'graph', 'ontology');
const dest = join(__dirname, '..', 'dist', 'graph', 'ontology');
if (!existsSync(src)) process.exit(0);
mkdirSync(dest, { recursive: true });
cpSync(src, dest, { recursive: true });
