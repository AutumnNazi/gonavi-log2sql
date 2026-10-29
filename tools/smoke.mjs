import { spawn } from 'node:child_process';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const pluginId = 'gh-autumnnazi.log2sql';
const maxFrameBytes = 1 << 20;
const check = (condition, message) => { if (!condition) throw new Error(message); };

function bounded(promise, timeoutMs, label) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(label + ' timed out')), timeoutMs);
  })]).finally(() => clearTimeout(timer));
}

export async function runSmoke(binary, { args = [], timeoutMs = 5000 } = {}) {
  check(typeof binary === 'string' && binary.length > 0, 'binary path is required');
  check(Number.isInteger(timeoutMs) && timeoutMs >= 100 && timeoutMs <= 30000, 'invalid timeout');
  const temporaryRoot = await realpath(tmpdir());
  const dataRoot = await mkdtemp(join(temporaryRoot, 'gonavi-log2sql-smoke-'));
  const ownedRoot = await realpath(dataRoot);
  check(dirname(ownedRoot) === temporaryRoot && basename(ownedRoot).startsWith('gonavi-log2sql-smoke-'), 'unsafe temporary path');
  let child;
  let closed;
  let didClose = false;
  let failure;
  let buffer = Buffer.alloc(0);
  let outputBytes = 0;
  let stderrBytes = 0;
  let sequence = 0;
  let logWaiter;
  const pending = new Map();
  const flow = [];
  const fail = (error) => {
    if (!failure) failure = error;
    for (const waiter of pending.values()) waiter.reject(failure);
    pending.clear();
    if (logWaiter) { logWaiter.reject(failure); logWaiter = undefined; }
  };
  const send = (message) => {
    if (failure) throw failure;
    const frame = Buffer.from(JSON.stringify(message) + '\n', 'utf8');
    check(frame.length <= maxFrameBytes, 'outgoing frame exceeds limit');
    child.stdin.write(frame);
  };
  const request = async (method, params, validate, label = method) => {
    if (failure) throw failure;
    const id = ++sequence;
    const promise = new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); });
    try {
      send({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) });
      const result = await bounded(promise, timeoutMs, label);
      validate(result);
      flow.push(label);
      return result;
    } finally { pending.delete(id); }
  };
  const invoke = (commandId, arguments_, validate, label = commandId) =>
    request('plugin.invoke', { commandId, arguments: arguments_ }, validate, label);
  const settingsMatch = (value, expected) => value && Object.keys(value).length === 3 &&
    Object.entries(expected).every(([key, entry]) => value[key] === entry);
  try {
    child = spawn(resolve(binary), args, { shell: false, windowsHide: true, cwd: dataRoot,
      env: { ...process.env, GONAVI_PLUGIN_DATA: dataRoot }, stdio: ['pipe', 'pipe', 'pipe'] });
    closed = new Promise((resolve) => child.once('close', (code, signal) => {
      didClose = true;
      if (buffer.length) fail(new Error('incomplete protocol frame'));
      if (pending.size || logWaiter) fail(new Error('plugin exited before protocol completed'));
      resolve({ code, signal });
    }));
    child.on('error', () => fail(new Error('plugin could not start')));
    child.stdin.on('error', () => fail(new Error('plugin stdin failed')));
    child.stdout.on('error', () => fail(new Error('plugin stdout failed')));
    child.stderr.on('error', () => fail(new Error('plugin stderr failed')));
    child.stderr.on('data', (chunk) => {
      stderrBytes += chunk.length;
      if (stderrBytes > maxFrameBytes) fail(new Error('plugin stderr exceeds limit'));
    });
    child.stdout.on('data', (chunk) => {
      if (failure) return;
      try {
        outputBytes += chunk.length;
        check(outputBytes <= 2 * maxFrameBytes, 'plugin stdout exceeds limit');
        buffer = Buffer.concat([buffer, chunk]);
        let end;
        while ((end = buffer.indexOf(10)) !== -1) {
          check(end > 0 && end <= maxFrameBytes, 'invalid protocol frame length');
          const raw = buffer.subarray(0, end);
          buffer = buffer.subarray(end + 1);
          let message;
          try { message = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)); }
          catch { throw new Error('invalid protocol JSON'); }
          check(message && message.jsonrpc === '2.0', 'response jsonrpc is required');
          if (message.method !== undefined) {
            check(message.method === 'host.log' && logWaiter && typeof message.id === 'string' && /^hl-[1-9][0-9]*$/.test(message.id), 'unexpected host request');
            check(message.params?.level === 'info' && message.params?.message === pluginId + ' running', 'lifecycle diagnostic mismatch');
            send({ jsonrpc: '2.0', id: message.id, result: {} });
            flow.push('host.log');
            logWaiter.resolve();
            logWaiter = undefined;
            continue;
          }
          check(pending.has(message.id), 'response id does not match a pending request');
          check(!Object.hasOwn(message, 'error'), 'plugin returned RPC error');
          check(Object.hasOwn(message, 'result'), 'response result is required');
          const waiter = pending.get(message.id);
          pending.delete(message.id);
          waiter.resolve(message.result);
        }
        check(buffer.length <= maxFrameBytes, 'protocol frame exceeds limit');
      } catch (error) { fail(error); }
    });

    await request('plugin.initialize', { apiVersion: 1, pluginId, version: '0.1.3', generation: 1,
      config: {}, hostVersion: '1.2.0', locale: 'en-US', permissions: ['ai.tools', 'host.log'] },
    (value) => check(value?.apiVersion === 1, 'initialize apiVersion is required'));
    const logged = new Promise((resolve, reject) => { logWaiter = { resolve, reject }; });
    send({ jsonrpc: '2.0', method: 'plugin.lifecycle', params: { event: 'running', generation: 1 } });
    flow.push('plugin.lifecycle');
    await bounded(logged, timeoutMs, 'host.log');
    const expectedSQL = "SELECT * FROM smoke_table WHERE id = 7 AND name = 'smoke'";
    await invoke('convert', { log: 'Preparing: SELECT * FROM smoke_table WHERE id = ? AND name = ?\nParameters: 7(Integer), smoke(String)\nTotal: 1', dialect: 'generic' }, (value) => {
      check(Array.isArray(value?.statements) && value.statements.length === 1, 'convert statements are required');
      const statement = value.statements[0];
      check(statement.sql === expectedSQL && statement.total === 1 && statement.paramCount === 2 &&
        statement.placeholderCount === 2 && (!statement.warnings || statement.warnings.length === 0) &&
        (!value.warnings || value.warnings.length === 0), 'convert output mismatch');
    });
    const defaults = { language: 'auto', theme: 'auto', dialect: 'generic' };
    await invoke('getSettings', {}, (value) => check(settingsMatch(value, defaults), 'default settings mismatch'), 'getSettings(default)');
    const changed = { language: 'auto', theme: 'auto', dialect: 'mysql' };
    await invoke('saveSettings', changed, (value) => check(value?.saved === true, 'saveSettings saved is required'));
    await invoke('getSettings', {}, (value) => check(settingsMatch(value, changed), 'persisted settings mismatch'), 'getSettings(saved)');
    const persisted = JSON.parse(await readFile(join(dataRoot, 'settings.json'), 'utf8'));
    check(settingsMatch(persisted, changed), 'settings file mismatch');
    await request('plugin.shutdown', undefined, (value) => check(value && Object.keys(value).length === 0, 'shutdown result must be an empty object'));
    child.stdin.end();
    const exit = await bounded(closed, timeoutMs, 'plugin exit');
    if (failure) throw failure;
    check(exit.code === 0 && exit.signal === null, 'plugin did not exit successfully');
    return { flow, sql: expectedSQL, settingsPersisted: true, exitCode: exit.code };
  } finally {
    if (child && !didClose) {
      child.kill('SIGKILL');
      await bounded(closed, timeoutMs, 'owned child cleanup');
    }
    await rm(ownedRoot, { recursive: true, force: false });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    check(process.argv.length === 3, 'usage: node tools/smoke.mjs <binary>');
    const result = await runSmoke(process.argv[2]);
    console.log(JSON.stringify({ smoke: 'passed', ...result }));
  } catch (error) {
    console.error('smoke failed: ' + error.message);
    process.exitCode = 1;
  }
}
