import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, mkdirSync, openSync, closeSync, readdirSync, linkSync, realpathSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { inflateRawSync } from 'node:zlib';
import { randomBytes } from 'node:crypto';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const node = process.env.NODE || 'node';
const platforms = ['windows/amd64', 'linux/amd64', 'linux/arm64', 'darwin/amd64', 'darwin/arm64'];

const fixtures = new Set();
test.afterEach(() => {
  for (const root of fixtures) {
    assert.equal(realpathSync(root), root);
    assert.equal(dirname(root), realpathSync(tmpdir()));
    assert.ok(basename(root).startsWith('log2sql-build-test-'));
    rmSync(root, { recursive: true });
    fixtures.delete(root);
  }
});

function fixture() {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'log2sql-build-test-'));
  fixtures.add(root);
  for (const dir of ['tools', 'ui']) mkdirSync(join(root, dir));
  for (const file of ['tools/build.mjs', 'tools/manifest.template.json', 'ui/build-embed.mjs', 'ui/panel.html', 'ui/engine.js', 'ui/app.js']) {
    cpSync(join(source, file), join(root, file));
  }
  if (existsSync(join(source, 'tools/archive'))) cpSync(join(source, 'tools/archive'), join(root, 'tools/archive'), { recursive: true });
  for (const file of ['LICENSE', 'THIRD_PARTY_NOTICES']) {
    if (existsSync(join(source, file))) cpSync(join(source, file), join(root, file));
  }
  return root;
}

function invoke(root, args) {
  const log = join(root, 'test-output.txt');
  const fd = openSync(log, 'w');
  const result = spawnSync(node, [join(root, 'tools/build.mjs'), ...args], { cwd: root, stdio: ['ignore', fd, fd] });
  closeSync(fd);
  assert.ifError(result.error);
  return { status: result.status, output: readFileSync(log, 'utf8') };
}

function binaries(root, selected = platforms) {
  for (const platform of selected) {
    const [os, arch] = platform.split('/');
    const dir = join(root, 'artifacts', 'bin', `${os}-${arch}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, os === 'windows' ? 'plugin.exe' : 'plugin'), `tested:${platform}`, 'utf8');
  }
}

function zipEntries(path) {
  const buffer = readFileSync(path);
  const entries = new Map();
  let offset = 0;
  while (buffer.readUInt32LE(offset) === 0x04034b50) {
    const method = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const nameSize = buffer.readUInt16LE(offset + 26);
    const extraSize = buffer.readUInt16LE(offset + 28);
    const name = buffer.subarray(offset + 30, offset + 30 + nameSize).toString('utf8');
    const start = offset + 30 + nameSize + extraSize;
    let end = start + compressedSize;
    if (buffer.readUInt16LE(offset + 6) & 8) {
      end = buffer.indexOf(Buffer.from([0x50, 0x4b, 0x07, 0x08]), start);
      assert.notEqual(end, -1);
    }
    const content = buffer.subarray(start, end);
    entries.set(name, method === 8 ? inflateRawSync(content) : content);
    offset = end + ((buffer.readUInt16LE(offset + 6) & 8) ? 16 : 0);
  }
  return entries;
}

test('legacy build arguments without --out choose a fresh pkg child and preserve old content', () => {
  const root = fixture();
  binaries(root, ['windows/amd64']);
  mkdirSync(join(root, 'pkg', 'bin'), { recursive: true });
  writeFileSync(join(root, 'pkg', 'bin', 'keep.txt'), 'keep', 'utf8');
  const result = invoke(root, ['--goos', 'windows', '--goarch', 'amd64', '--binaries', 'artifacts']);
  assert.equal(result.status, 0, result.output);
  assert.equal(readFileSync(join(root, 'pkg', 'bin', 'keep.txt'), 'utf8'), 'keep');
  const children = readdirSync(join(root, 'pkg')).filter(name => name !== 'bin');
  assert.equal(children.length, 1);
  assert.ok(existsSync(join(root, 'pkg', children[0], 'gonavi.plugin.json')));
  assert.equal(existsSync(join(root, 'pkg', 'gonavi.plugin.json')), false);
});

test('empty and hard-linked tested binaries fail before output creation', () => {
  const root = fixture();
  binaries(root, ['windows/amd64']);
  const binary = join(root, 'artifacts/bin/windows-amd64/plugin.exe');
  writeFileSync(binary, '');
  let result = invoke(root, ['--out', 'release', '--platforms', 'windows/amd64', '--binaries', 'artifacts']);
  assert.notEqual(result.status, 0);
  assert.match(result.output, /invalid binary path/);
  assert.equal(existsSync(join(root, 'release')), false);
  writeFileSync(binary, 'tested');
  linkSync(binary, join(root, 'linked.exe'));
  result = invoke(root, ['--out', 'release', '--platforms', 'windows/amd64', '--binaries', 'artifacts']);
  assert.notEqual(result.status, 0);
  assert.match(result.output, /invalid binary path/);
  assert.equal(existsSync(join(root, 'release')), false);
});

test('existing and in-package ZIP paths fail without creating output or overwriting files', () => {
  const root = fixture();
  binaries(root, ['windows/amd64']);
  writeFileSync(join(root, 'old.zip'), 'keep archive', 'utf8');
  for (const archive of ['old.zip', 'release/plugin.zip', 'release/..plugin.zip', 'invalid.tgz']) {
    const result = invoke(root, ['--out', 'release', '--platforms', 'windows/amd64', '--binaries', 'artifacts', '--archive', archive]);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /archive.*fresh.*zip/i);
    assert.equal(existsSync(join(root, 'release')), false);
    assert.equal(readFileSync(join(root, 'old.zip'), 'utf8'), 'keep archive');
  }
});

test('archive exceeding 64 MiB compressed fails without writing ZIP', () => {
  const root = fixture();
  binaries(root, ['windows/amd64']);
  writeFileSync(join(root, 'artifacts/bin/windows-amd64/plugin.exe'), randomBytes(65 * 1024 * 1024));
  const result = invoke(root, ['--out', 'release', '--platforms', 'windows/amd64', '--binaries', 'artifacts', '--archive', 'large.zip']);
  assert.notEqual(result.status, 0);
  assert.match(result.output, /exceeds 64 MiB compressed limit/);
  assert.equal(existsSync(join(root, 'large.zip')), false);
});

test('ZIP contains only root manifest, licenses, shared entry and selected binaries reproducibly', () => {
  const root = fixture();
  binaries(root);
  const first = invoke(root, ['--out', 'release', '--platforms', platforms.join(','), '--binaries', 'artifacts', '--archive', 'plugin.zip']);
  assert.equal(first.status, 0, first.output);
  assert.equal(existsSync(join(root, 'plugin.zip')), true);
  const entries = zipEntries(join(root, 'plugin.zip'));
  const expected = ['gonavi.plugin.json', 'LICENSE', 'THIRD_PARTY_NOTICES', 'ui/window.html', ...platforms.map(p => `bin/${p.replace('/', '-')}/plugin${p.startsWith('windows/') ? '.exe' : ''}`)].sort();
  assert.deepEqual([...entries.keys()].sort(), expected);
  assert.ok(readFileSync(join(root, 'plugin.zip')).length < 64 * 1024 * 1024);
  const manifest = JSON.parse(entries.get('gonavi.plugin.json'));
  for (const target of Object.values(manifest.backend.platforms)) assert.ok(entries.has(target.executable));
  assert.ok(entries.has(manifest.window.entry));
  const second = invoke(root, ['--out', 'second', '--platforms', [...platforms].reverse().join(','), '--binaries', 'artifacts', '--archive', 'second.zip']);
  assert.equal(second.status, 0, second.output);
  assert.deepEqual(readFileSync(join(root, 'second.zip')), readFileSync(join(root, 'plugin.zip')));
});

test('tested binaries form one root package with isolated platform paths and shared resources', () => {
  const root = fixture();
  binaries(root);
  mkdirSync(join(root, 'pkg', 'bin'), { recursive: true });
  writeFileSync(join(root, 'pkg', 'bin', 'keep.txt'), 'keep', 'utf8');
  mkdirSync(join(root, 'build'));
  writeFileSync(join(root, 'build', 'panel.preview.html'), 'old preview', 'utf8');
  const result = invoke(root, ['--out', 'release', '--platforms', platforms.join(','), '--binaries', 'artifacts']);
  assert.equal(result.status, 0, result.output);
  const manifest = JSON.parse(readFileSync(join(root, 'release', 'gonavi.plugin.json'), 'utf8'));
  assert.equal(manifest.id, 'gh-autumnnazi.log2sql');
  assert.equal(manifest.backend.default, undefined);
  assert.deepEqual(Object.keys(manifest.backend.platforms).sort(), [...platforms].sort());
  for (const platform of platforms) {
    const [os, arch] = platform.split('/');
    const executable = `bin/${os}-${arch}/plugin${os === 'windows' ? '.exe' : ''}`;
    assert.deepEqual(manifest.backend.platforms[platform], { executable, runtime: 'native' });
    assert.equal(readFileSync(join(root, 'release', executable), 'utf8'), `tested:${platform}`);
  }
  assert.match(readFileSync(join(root, 'release', 'LICENSE'), 'utf8'), /Apache License[\s\S]*Version 2.0/);
  assert.equal(readFileSync(join(root, 'release', manifest.window.entry), 'utf8'), manifest.contributes.panels[0].html.source);
  assert.equal(readFileSync(join(root, 'pkg', 'bin', 'keep.txt'), 'utf8'), 'keep');
  assert.equal(readFileSync(join(root, 'build', 'panel.preview.html'), 'utf8'), 'old preview');
});

test('output root and existing directories are rejected without deleting old files', () => {
  const root = fixture();
  binaries(root, ['windows/amd64']);
  mkdirSync(join(root, 'old', 'bin'), { recursive: true });
  writeFileSync(join(root, 'old', 'bin', 'keep.txt'), 'keep', 'utf8');
  for (const out of ['.', 'old']) {
    const result = invoke(root, ['--out', out, '--platforms', 'windows/amd64', '--binaries', 'artifacts']);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /output.*(exists|fresh)/i);
    assert.equal(readFileSync(join(root, 'old', 'bin', 'keep.txt'), 'utf8'), 'keep');
    assert.equal(existsSync(join(root, 'gonavi.plugin.json')), false);
  }
});

test('invalid platform fails before reading artifacts or creating output', () => {
  const root = fixture();
  for (const platform of ['windows/arm64', '../amd64', 'linux', 'linux/amd64,linux/amd64', 'linux/amd64,']) {
    const result = invoke(root, ['--out', 'release', '--platforms', platform, '--binaries', 'artifacts']);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /invalid platform/i);
    assert.equal(existsSync(join(root, 'release')), false);
  }
});

test('missing tested binary fails before creating output', () => {
  const root = fixture();
  const result = invoke(root, ['--out', 'release', '--platforms', 'linux/arm64', '--binaries', 'artifacts']);
  assert.notEqual(result.status, 0);
  assert.match(result.output, /missing binary.*bin[\\/]linux-arm64[\\/]plugin/i);
  assert.equal(existsSync(join(root, 'release')), false);
});
