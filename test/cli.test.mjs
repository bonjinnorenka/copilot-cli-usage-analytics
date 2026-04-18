import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const cliPath = fileURLToPath(new URL('../analyze.mjs', import.meta.url));
const stripAnsi = value => value.replace(/\x1B\[[0-9;]*m/g, '');

test('CLI renders session metrics and skipped sessions using cached pricing', () => {
  const tempHome = join(tmpdir(), `copilot-usage-test-${Date.now()}`);
  const cacheDir = join(tempHome, '.cache', 'copilot-analytics');
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(
    join(cacheDir, 'pricing.json'),
    JSON.stringify(
      {
        'openai/gpt-4o': {
          input_cost_per_token: 0.000001,
          cache_read_input_token_cost: 0.0000001,
          cache_creation_input_token_cost: 0.00000125,
          output_cost_per_token: 0.000002
        }
      },
      null,
      2
    )
  );

  const fixtureDir = join(tempHome, 'session-state');
  cpSync(new URL('./fixtures/session-state', import.meta.url), fixtureDir, {
    recursive: true
  });

  const result = spawnSync(
    process.execPath,
    [cliPath, '--path', fixtureDir],
    {
      cwd: repoRoot,
      env: { ...process.env, HOME: tempHome, FORCE_COLOR: '0', COLUMNS: '200' },
      encoding: 'utf8'
    }
  );
  const stdout = stripAnsi(result.stdout);

  assert.equal(result.status, 0, result.stderr);
  assert.match(stdout, /Model/);
  assert.match(stdout, /gpt-4o/);
  assert.match(stdout, /1,350/);
  assert.match(stdout, /\$0\.001482/);
  assert.match(stdout, /Skipped \(no session\.shutdown\):/);
  assert.match(stdout, /Premium request unit price: \$0\.04/);
});
