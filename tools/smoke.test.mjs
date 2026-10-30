import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { runSmoke } from './smoke.mjs';

const fake = String.raw`
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const mode = process.argv[1];
const respond = (message) => process.stdout.write(JSON.stringify(message) + '\n');
let settings = { language: 'auto', theme: 'auto', dialect: 'generic' };
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const request = JSON.parse(line);
  if (mode === 'silent') return;
  if (!request.method) return;
  if (request.method === 'plugin.lifecycle') {
    respond({ jsonrpc: '2.0', id: 'hl-1', method: 'host.log', params: {
      level: 'info', message: (mode === 'bad-log' ? 'wrong' : 'gh-autumnnazi.log2sql') + ' running' } });
    return;
  }
  let result = {};
  if (request.method === 'plugin.initialize') {
    if (mode === 'compatible' && (request.params.version !== '0.1.4' || request.params.hostVersion !== '1.2.0')) {
      respond({ jsonrpc: '2.0', id: request.id, error: { code: -32602, message: 'unsupported initialize versions' } });
      return;
    }
    result = mode === 'missing-api' ? {} : { apiVersion: 1 };
  }
  if (request.method === 'plugin.invoke') {
    if (request.params.commandId === 'convert') result = { statements: [{
      sql: mode === 'bad-sql' ? 'SELECT 0' : "SELECT * FROM smoke_table WHERE id = 7 AND name = 'smoke'",
      total: 1, paramCount: 2, placeholderCount: 2 }] };
    if (request.params.commandId === 'getSettings') result = settings;
    if (request.params.commandId === 'saveSettings') {
      settings = { ...request.params.arguments, language: 'auto', theme: 'auto' };
      fs.writeFileSync(path.join(process.env.GONAVI_PLUGIN_DATA, 'settings.json'), JSON.stringify(settings), 'utf8');
      result = { saved: mode !== 'not-saved' };
    }
  }
  const response = { jsonrpc: '2.0', id: request.id, result };
  if (mode === 'rpc-error') { delete response.result; response.error = { code: -32603, message: 'synthetic failure' }; }
  if (mode === 'missing-rpc') delete response.jsonrpc;
  if (mode === 'missing-result') delete response.result;
  if (mode === 'wrong-id') response.id = 999;
  if (mode === 'both') response.error = { code: -32603, message: 'synthetic failure' };
  if (mode === 'malformed') { process.stdout.write('not JSON\n'); return; }
  respond(response);
  if (request.method === 'plugin.shutdown') process.exit(0);
});
`;

const options = (mode) => ({ args: ['-e', fake, mode], timeoutMs: 1000 });

for (const [mode, error] of [
  ['missing-api', /initialize apiVersion/],
  ['rpc-error', /RPC error/],
  ['both', /RPC error/],
  ['missing-rpc', /jsonrpc/],
  ['missing-result', /result is required/],
  ['wrong-id', /response id/],
  ['malformed', /invalid protocol JSON/],
  ['bad-log', /lifecycle diagnostic/],
  ['bad-sql', /convert output/],
  ['not-saved', /saveSettings saved/],
  ['silent', /timed out/],
]) {
  test('smoke rejects ' + mode, async () => {
    await assert.rejects(runSmoke(process.argv[0], options(mode)), error);
  });
}

test('smoke validates the full flow and cleans its isolated settings directory', async () => {
  const before = new Set(await readdir(tmpdir()));
  const result = await runSmoke(process.argv[0], options('valid'));
  assert.deepEqual(result.flow, ['plugin.initialize', 'plugin.lifecycle', 'host.log', 'convert',
    'getSettings(default)', 'saveSettings', 'getSettings(saved)', 'plugin.shutdown']);
  assert.equal(result.settingsPersisted, true);
  assert.equal(result.exitCode, 0);
  const leaked = (await readdir(tmpdir())).filter((name) => name.startsWith('gonavi-log2sql-smoke-') && !before.has(name));
  assert.deepEqual(leaked, []);
});

test('smoke sends plugin 0.1.4 and the minimum supported host version during initialization', async () => {
  const result = await runSmoke(process.argv[0], options('compatible'));
  assert.equal(result.exitCode, 0);
  assert.equal(result.flow[0], 'plugin.initialize');
});

test('exit zero without protocol output is not a smoke pass', async () => {
  await assert.rejects(runSmoke(process.argv[0], { args: ['-e', 'process.exit(0)'], timeoutMs: 1000 }), /protocol completed/);
});
