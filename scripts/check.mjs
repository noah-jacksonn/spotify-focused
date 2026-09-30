import { readFileSync, existsSync } from 'node:fs';
import assert from 'node:assert/strict';
const manifest = JSON.parse(readFileSync('extension/manifest.json', 'utf8'));
assert.equal(manifest.manifest_version, 3);
assert.deepEqual(manifest.permissions, ['storage']);
assert.deepEqual(manifest.content_scripts[0].matches, ['https://open.spotify.com/*']);
for (const path of [...manifest.content_scripts[0].js, ...manifest.content_scripts[0].css, ...Object.values(manifest.icons), manifest.action.default_popup, manifest.background.service_worker, 'store.js']) {
  assert.ok(existsSync('extension/' + path), `Missing manifest resource: ${path}`);
}
const popup = readFileSync('extension/popup.html', 'utf8');
assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/i.test(popup), 'MV3 forbids inline popup scripts');
console.log('Manifest, resources, permissions, and popup CSP checks passed.');
