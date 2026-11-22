const { cpSync, mkdirSync } = require('fs');
const { join } = require('path');

mkdirSync(join(__dirname, '..', 'dist', 'migrations'), { recursive: true });
cpSync(join(__dirname, '..', 'src', 'migrations'), join(__dirname, '..', 'dist', 'migrations'), {
  recursive: true,
});
