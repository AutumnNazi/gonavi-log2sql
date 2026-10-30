import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

const prefix = 'log2sql-host-check-test-';

async function isolateTemporaryDirectory(t, root) {
  const directory = join(root, 'temporary');
  await mkdir(directory);
  const names = ['TEMP', 'TMP', 'TMPDIR'];
  const original = names.map(name => [name, process.env[name]]);
  t.after(() => {
    for (const [name, value] of original) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
  for (const name of names) process.env[name] = directory;
  return realpath(directory);
}

test('missing host source fails before temporary work or package changes', async (t) => {
  const parent = await realpath(tmpdir());
  const root = await mkdtemp(join(parent, prefix));
  const temporary = await isolateTemporaryDirectory(t, root);
  try {
    const zip = join(root, 'package.zip');
    await writeFile(zip, 'unchanged');
    const before = (await readdir(temporary)).filter(name => name.startsWith('log2sql-host-check-'));
    const { runHostCheck } = await import('./host-check.mjs');
    await assert.rejects(runHostCheck(zip, { source: root }), /missing host source/);
    assert.equal(await readFile(zip, 'utf8'), 'unchanged');
    assert.deepEqual((await readdir(temporary)).filter(name => name.startsWith('log2sql-host-check-')), before);
  } finally { await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); }
});

const fixture = `package plugin
import("context";"crypto/sha256";"encoding/base64";"fmt";"os";"strings")
type Entry struct { Executable string }
type Backend struct { Platforms map[string]Entry }
type Manifest struct { ID, Version, Icon string; Backend *Backend }
func(m Manifest) IconPath()string{return m.Icon}
type Inspection struct {Manifest Manifest; Digest string}
type Status struct {Manifest Manifest}
type Options struct {Root,HostVersion string}
type InstallRequest struct {Path,Digest string;Trusted bool}
type Manager struct {source string}
func NewManager(o Options)(*Manager,error){if o.HostVersion!="1.2.0"{return nil,fmt.Errorf("unexpected host version")};return &Manager{},nil}
func(m *Manager) Close(context.Context)error{if strings.Contains(m.source,"close-fail"){return fmt.Errorf("fixture close failed")};return nil}
func(m *Manager) Inspect(ctx context.Context,p string)(Inspection,error){b,e:=os.ReadFile(p);if e!=nil{return Inspection{},e};if strings.Contains(string(b),"reject"){return Inspection{},fmt.Errorf("fixture package rejected")};m.source=string(b);hash:=sha256.Sum256(b);return Inspection{Manifest:Manifest{ID:"fixture.plugin",Version:"0.1.4",Icon:"icons/logo.png",Backend:&Backend{Platforms:map[string]Entry{"linux/amd64":{Executable:"bin/plugin"}}}},Digest:fmt.Sprintf("%x",hash)},nil}
func(m *Manager) Install(ctx context.Context,r InstallRequest)(Status,error){if !r.Trusted{return Status{},fmt.Errorf("trust required")};if strings.Contains(m.source,"install-fail"){return Status{},fmt.Errorf("fixture installation failed")};return Status{Manifest:Manifest{ID:"fixture.plugin",Version:"0.1.4"}},nil}
func(m *Manager) ReadPackageFile(id,path string,limit int)([]byte,error){if strings.Contains(m.source,"bad-icon"){return []byte("invalid"),nil};data,err:=base64.StdEncoding.DecodeString("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGMwqXjLAAAEFwGaDHJA1QAAAABJRU5ErkJggg==");if err==nil&&strings.Contains(m.source,"truncated-icon"){data=data[:33]};return data,err}
func RasterIconDataURL(b []byte)string{if len(b)<8{return ""};return "data:image/png;base64,"+base64.StdEncoding.EncodeToString(b)}
func(m *Manager) IconDataURL(id string)string{if strings.Contains(m.source,"empty-icon"){return ""};b,_:=m.ReadPackageFile(id,"icons/logo.png",65536);return RasterIconDataURL(b)}
`;

test('host checker installs the exact package, verifies icon data and propagates failures', async (t) => {
  const parent = await realpath(tmpdir());
  const root = await mkdtemp(join(parent, prefix));
  const temporary = await isolateTemporaryDirectory(t, root);
  try {
    const host = join(root, 'host');
    await mkdir(join(host, 'internal/plugin'), { recursive: true });
    await writeFile(join(host, 'go.mod'), 'module GoNavi-Wails\n\ngo 1.25\n');
    await writeFile(join(host, 'internal/plugin/plugin.go'), fixture);
    const zip = join(root, 'package.zip');
    await writeFile(zip, 'accepted package');
    const before = (await readdir(temporary)).filter(name => name.startsWith('log2sql-host-check-'));
    const { runHostCheck } = await import('./host-check.mjs');
    const result = await runHostCheck(zip, { source: host });
    assert.equal(result.id, 'fixture.plugin');
    assert.equal(result.version, '0.1.4');
    assert.equal(result.sha256, createHash('sha256').update('accepted package').digest('hex'));
    assert.equal(result.icon.path, 'icons/logo.png');
    assert.equal(result.icon.readable, true);
    assert.deepEqual(result.platforms, ['linux/amd64']);
    for (const content of ['reject', 'install-fail', 'bad-icon', 'empty-icon', 'truncated-icon', 'close-fail']) {
      await t.test('rejects ' + content, async () => {
        await writeFile(zip, content);
        await assert.rejects(runHostCheck(zip, { source: host }), /host package check failed/);
        assert.equal(await readFile(zip, 'utf8'), content);
      });
    }
    const directory = join(root, 'directory'); await mkdir(directory);
    await assert.rejects(runHostCheck(zip, { source: host, directory }), /host package check failed/);
    await assert.rejects(runHostCheck(zip, { source: host, go: join(root, 'missing-go') }), /could not start/);
    assert.deepEqual((await readdir(temporary)).filter(name => name.startsWith('log2sql-host-check-')), before);
    assert.deepEqual((await readdir(host)).sort(), ['go.mod','internal']);
  } finally {
    assert.equal(dirname(await realpath(root)), parent);
    await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
});
