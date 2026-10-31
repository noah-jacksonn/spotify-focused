import { mkdirSync, mkdtempSync, cpSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, join, basename } from 'node:path';
import { tmpdir } from 'node:os';
mkdirSync('dist', { recursive: true });
const output = resolve('dist/spotify-unslopified.zip');
const staging = mkdtempSync(join(tmpdir(), 'unslopified-package-'));
try {
  cpSync('extension', staging, { recursive: true, filter: path => !basename(path).startsWith('Debug') });
  rmSync(output, { force: true });
  execFileSync('zip', ['-q', '-r', output, '.', '-x', '*.DS_Store'], { cwd: staging });
} finally {
  rmSync(staging, { recursive: true, force: true });
}
console.log(output);
