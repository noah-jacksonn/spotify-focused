import { mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
mkdirSync('dist', { recursive: true });
const output = resolve('dist/spotify-focused.zip');
execFileSync('zip', ['-q', '-r', output, '.', '-x', '*.DS_Store'], { cwd: 'extension' });
console.log(output);
