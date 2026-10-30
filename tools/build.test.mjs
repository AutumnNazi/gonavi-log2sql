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
  if (existsSync(join(source, 'icons'))) cpSync(join(source, 'icons'), join(root, 'icons'), { recursive: true });
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

// 产品入口仅保留标签页；内联 HTML 不再作为独立窗口文件输出。
test('0.1.4 package declares only workbench with GoNavi 1.2.0 minimum', () => {
  const root = fixture();
  binaries(root, ['windows/amd64']);
  const result = invoke(root, ['--out', 'release', '--platforms', 'windows/amd64', '--binaries', 'artifacts']);
  assert.equal(result.status, 0, result.output);
  const manifest = JSON.parse(readFileSync(join(root, 'release', 'gonavi.plugin.json'), 'utf8'));
  assert.deepEqual({
    version: manifest.version, minHostVersion: manifest.minHostVersion,
    permissions: manifest.permissions, permissionNotes: Object.keys(manifest.permissionNotes),
    pages: Object.hasOwn(manifest.contributes, 'pages'), navigation: Object.hasOwn(manifest.contributes, 'navigation'),
    panels: Object.hasOwn(manifest.contributes, 'panels'), window: Object.hasOwn(manifest, 'window'),
    commands: manifest.contributes.commands.map(command => command.id),
  }, {
    version: '0.1.4', minHostVersion: '1.2.0',
    permissions: ['ai.tools', 'host.log', 'ui.pages', 'ui.html-panel'], permissionNotes: ['ai.tools', 'host.log', 'ui.pages', 'ui.html-panel'],
    pages: true, navigation: false, panels: false, window: false,
    commands: ['convert', 'getSettings', 'saveSettings'],
  });
  assert.match(manifest.contributes.pages[0].html.source, /window\.log2sql = engine;/);
  assert.equal(existsSync(join(root, 'release', 'ui')), false);
});

test('market packages embed only workbench HTML on all five platforms', () => {
  const root = fixture();
  binaries(root);
  let sharedManifest;
  for (const platform of platforms) {
    const out = `release-${platform.replace('/', '-')}`;
    const result = invoke(root, ['--out', out, '--platforms', platform, '--binaries', 'artifacts']);
    assert.equal(result.status, 0, result.output);
    const manifest = JSON.parse(readFileSync(join(root, out, 'gonavi.plugin.json'), 'utf8'));
    assert.equal(Object.hasOwn(manifest.contributes, 'panels'), false, `${platform}: market manifest must omit contributes.panels`);
    assert.equal(manifest.version, '0.1.4');
    assert.equal(manifest.minHostVersion, '1.2.0');
    assert.deepEqual(Object.keys(manifest.backend.platforms), [platform]);
    assert.deepEqual(manifest.contributes.commands.map(command => command.id), ['convert', 'getSettings', 'saveSettings']);
    assert.deepEqual(manifest.permissions, ['ai.tools', 'host.log', 'ui.pages', 'ui.html-panel']);
    assert.deepEqual(Object.keys(manifest.permissionNotes), manifest.permissions);
    assert.equal(Object.hasOwn(manifest.contributes, 'navigation'), false);
    assert.equal(Object.hasOwn(manifest.contributes, 'pages'), true);
    assert.equal(Object.hasOwn(manifest, 'window'), false);
    assert.equal(existsSync(join(root, out, 'ui')), false);
    const html = manifest.contributes.pages[0].html.source;
    assert.equal(typeof html, 'string');
    assert.ok(Buffer.byteLength(html, 'utf8') <= 256 * 1024);
    assert.match(html, /window\.log2sql = engine;/);
    assert.doesNotMatch(html, /__ENGINE_JS__|__APP_JS__/);
    assert.deepEqual(manifest.contributes.pages.map(page => ({ id: page.id, title: page.title })), [{ id: 'workbench', title: 'Log2SQL' }]);
    assert.doesNotMatch(html, /<script[^>]+src=/i);
    assert.ok(Buffer.byteLength(JSON.stringify(manifest), 'utf8') <= 256 * 1024);
    const { contributes, ...metadata } = manifest;
    assert.ok(Buffer.byteLength(JSON.stringify({ ...metadata, contributes: { commands: contributes.commands } }), 'utf8') < 8 * 1024);
    const { backend, ...shared } = manifest;
    if (sharedManifest) assert.deepEqual(shared, sharedManifest);
    else sharedManifest = shared;
  }
});

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

test('ZIP contains only inline-page manifest, licenses and selected binaries reproducibly', () => {
  const root = fixture();
  binaries(root);
  const first = invoke(root, ['--out', 'release', '--platforms', platforms.join(','), '--binaries', 'artifacts', '--archive', 'plugin.zip']);
  assert.equal(first.status, 0, first.output);
  assert.equal(existsSync(join(root, 'plugin.zip')), true);
  const entries = zipEntries(join(root, 'plugin.zip'));
  const expected = ['gonavi.plugin.json', 'LICENSE', 'THIRD_PARTY_NOTICES', 'icons/log2sql.png', ...platforms.map(p => `bin/${p.replace('/', '-')}/plugin${p.startsWith('windows/') ? '.exe' : ''}`)].sort();
  assert.deepEqual([...entries.keys()].sort(), expected);
  assert.ok(readFileSync(join(root, 'plugin.zip')).length < 64 * 1024 * 1024);
  const manifest = JSON.parse(entries.get('gonavi.plugin.json'));
  for (const target of Object.values(manifest.backend.platforms)) assert.ok(entries.has(target.executable));
  assert.equal(Object.hasOwn(manifest, 'window'), false);
  assert.equal([...entries.keys()].some(name => name.endsWith('.html')), false);
  assert.match(manifest.contributes.pages[0].html.source, /window\.log2sql = engine;/);
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
  assert.equal(Object.hasOwn(manifest.contributes, 'panels'), false);
  assert.equal(Object.hasOwn(manifest.contributes, 'pages'), true);
  assert.equal(Object.hasOwn(manifest.contributes, 'navigation'), false);
  assert.equal(Object.hasOwn(manifest, 'window'), false);
  assert.match(manifest.contributes.pages[0].html.source, /window\.log2sql = engine;/);
  assert.equal(existsSync(join(root, 'release', 'ui')), false);
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


test('settings command schema follows host preferences and keeps the escape mode interface', () => {
  const root = fixture();
  binaries(root, ['windows/amd64']);
  const result = invoke(root, ['--out', 'release', '--platforms', 'windows/amd64', '--binaries', 'artifacts']);
  assert.equal(result.status, 0, result.output);
  const manifest = JSON.parse(readFileSync(join(root, 'release', 'gonavi.plugin.json'), 'utf8'));
  const commands = manifest.contributes.commands;
  const properties = commands.find(command => command.id === 'saveSettings').inputSchema.properties;
  assert.deepEqual(Object.keys(properties), ['language', 'theme', 'dialect']);
  assert.deepEqual(properties.language.enum, ['auto']);
  assert.deepEqual(properties.theme.enum, ['auto']);
  assert.match(properties.language.description, /宿主/);
  assert.match(properties.theme.description, /宿主/);
  assert.deepEqual(properties.dialect.enum, ['generic', 'mysql']);
  const convert = commands.find(command => command.id === 'convert');
  assert.deepEqual(convert.inputSchema.properties.dialect.enum, ['generic', 'mysql']);
  assert.equal(convert.inputSchema.properties.dialect.default, 'generic');
  assert.match(convert.inputSchema.properties.dialect.description, /反斜杠/);
  assert.doesNotMatch(commands.map(command => command.description).join(' '), /独立窗口|SQL 方言/);
});

test('serialized manifest cannot exceed the real market 256 KiB limit even with valid HTML', () => {
  const root = fixture(); binaries(root, ['windows/amd64']);
  const app = join(root, 'ui/app.js');
  writeFileSync(app, readFileSync(app, 'utf8') + '\n//' + '\n//'.repeat(60000), 'utf8');
  const result = invoke(root, ['--out', 'release', '--platforms', 'windows/amd64', '--binaries', 'artifacts']);
  assert.equal(result.status, 1, result.output);
  const htmlBytes = Number(result.output.match(/page html: (\d+) bytes/)?.[1]);
  assert.ok(htmlBytes > 0 && htmlBytes <= 256 * 1024, result.output);
  assert.match(result.output, /清单 \d+ 字节超出市场上限 262144/);
  assert.equal(existsSync(join(root, 'release/gonavi.plugin.json')), false);
});


test('package icon is copied into the output and ZIP without changing its bytes', () => {
  const root = fixture();
  binaries(root, ['windows/amd64']);
  mkdirSync(join(root, 'icons'), { recursive: true });
  const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGMwqXjLAAAEFwGaDHJA1QAAAABJRU5ErkJggg==', 'base64');
  writeFileSync(join(root, 'icons/log2sql.png'), image);
  const templatePath = join(root, 'tools/manifest.template.json');
  const template = JSON.parse(readFileSync(templatePath, 'utf8'));
  template.icon = 'icons/log2sql.png';
  writeFileSync(templatePath, JSON.stringify(template));
  const result = invoke(root, ['--out', 'release', '--platforms', 'windows/amd64', '--binaries', 'artifacts', '--archive', 'plugin.zip']);
  assert.equal(result.status, 0, result.output);
  assert.ok(existsSync(join(root, 'release/icons/log2sql.png')), 'declared package icon must be copied');
  assert.deepEqual(readFileSync(join(root, 'release/icons/log2sql.png')), image);
  const entries = zipEntries(join(root, 'plugin.zip'));
  assert.deepEqual(entries.get('icons/log2sql.png'), image);
  assert.equal(JSON.parse(entries.get('gonavi.plugin.json')).icon, 'icons/log2sql.png');
});

test('package icon rejects traversal and oversized images before creating output', () => {
  for (const variant of ['traversal', 'oversized']) {
    const root = fixture();
    binaries(root, ['windows/amd64']);
    mkdirSync(join(root, 'icons'), { recursive: true });
    const templatePath = join(root, 'tools/manifest.template.json');
    const template = JSON.parse(readFileSync(templatePath, 'utf8'));
    template.icon = variant === 'traversal' ? '../outside.png' : 'icons/log2sql.png';
    writeFileSync(templatePath, JSON.stringify(template));
    writeFileSync(join(root, 'icons/log2sql.png'), Buffer.alloc(64 * 1024 + 1));
    const result = invoke(root, ['--out', 'release', '--platforms', 'windows/amd64', '--binaries', 'artifacts']);
    assert.notEqual(result.status, 0, variant + ': invalid package icon must fail');
    assert.equal(existsSync(join(root, 'release')), false);
    assert.match(result.output, /icon/i);
  }
});


test('package icon rejects null metadata before output creation', () => {
  const root = fixture();
  binaries(root, ['windows/amd64']);
  const templatePath = join(root, 'tools/manifest.template.json');
  const template = JSON.parse(readFileSync(templatePath, 'utf8'));
  template.icon = null;
  writeFileSync(templatePath, JSON.stringify(template));
  const result = invoke(root, ['--out', 'release', '--platforms', 'windows/amd64', '--binaries', 'artifacts']);
  assert.notEqual(result.status, 0, 'null icon must not silently pass through into the host manifest');
  assert.match(result.output, /icon/i);
  assert.equal(existsSync(join(root, 'release')), false);
});

test('packages without an icon retain the existing build behavior', () => {
  const root = fixture();
  binaries(root, ['windows/amd64']);
  const templatePath = join(root, 'tools/manifest.template.json');
  const template = JSON.parse(readFileSync(templatePath, 'utf8'));
  delete template.icon;
  writeFileSync(templatePath, JSON.stringify(template));
  const result = invoke(root, ['--out', 'release', '--platforms', 'windows/amd64', '--binaries', 'artifacts', '--archive', 'plugin.zip']);
  assert.equal(result.status, 0, result.output);
  const entries = zipEntries(join(root, 'plugin.zip'));
  assert.equal(Object.hasOwn(JSON.parse(entries.get('gonavi.plugin.json')), 'icon'), false);
  assert.equal(entries.has('icons/log2sql.png'), false);
});


test('release candidate is uploaded after package verification and before the retained market gate', () => {
  const workflow = readFileSync(join(source, '.github/workflows/release.yml'), 'utf8');
  const verification = workflow.indexOf('      - name: Verify the only ZIP, platform manifest and binary digests');
  const upload = workflow.indexOf('      - name: Upload the single ZIP for coordinator review');
  const market = workflow.indexOf('      - name: Gate the candidate with real market.ValidatePackage');
  assert.ok(verification >= 0 && verification < upload && upload < market);
  assert.match(workflow, /needs: native/);
  assert.match(workflow, /node tools\/market-check\.mjs "\$ARCHIVE"/);
  assert.doesNotMatch(workflow, /continue-on-error/);
});
