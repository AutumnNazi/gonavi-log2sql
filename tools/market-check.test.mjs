import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import test from 'node:test';

const prefix = 'gonavi-log2sql-market-test-';

test('missing market source fails without changing the ZIP or leaking temporary files', async () => {
  const parent = await realpath(tmpdir());
  const root = await mkdtemp(join(parent, prefix));
  const owned = await realpath(root);
  assert.equal(dirname(owned), parent);
  assert.ok(basename(owned).startsWith(prefix));
  try {
    const zip = join(root, 'package.zip');
    await writeFile(zip, 'user package bytes', 'utf8');
    const before = (await readdir(parent)).filter((name) => name.startsWith('gonavi-log2sql-market-check-'));
    const { runMarketCheck } = await import('./market-check.mjs');
    await assert.rejects(runMarketCheck(zip, { source: root }), /missing source file: artifact\.go/);
    assert.deepEqual((await readdir(parent)).filter((name) => name.startsWith('gonavi-log2sql-market-check-')), before);
    assert.deepEqual(await readdir(root), ['package.zip']);
  } finally {
    assert.equal(await realpath(root), owned);
    await rm(owned, { recursive: true, force: true });
  }
});

const sourceFiles = ['artifact.go', 'artifact_ai_provider.go', 'artifact_datasource.go',
  'artifact_exporter.go', 'artifact_manifest.go', 'artifact_manifest_json.go', 'artifact_manifest_ui.go',
  'artifact_pages.go', 'artifact_permission_notes.go', 'artifact_skill.go', 'artifact_tgz.go', 'artifact_zip.go'];
const fixture = `package market
import ("context"; "crypto/sha256"; "encoding/hex"; "fmt"; "os"; "strings")
type ValidatedPackage struct { ID, Version, SHA256 string; Platforms []string; SizeBytes int64 }
func ValidatePackage(ctx context.Context, filename string) (ValidatedPackage, error) {
 data, err := os.ReadFile(filename); if err != nil { return ValidatedPackage{}, err }
 if strings.Contains(string(data), "reject") { return ValidatedPackage{}, fmt.Errorf("fixture validation rejected package") }
 hash := sha256.Sum256(data)
 return ValidatedPackage{ID: "fixture.plugin", Version: "0.1.1", Platforms: []string{"linux/amd64"}, SHA256: hex.EncodeToString(hash[:]), SizeBytes: int64(len(data))}, nil
}
`;

test('calls the supplied Go validator and reports its exact package hash', async () => {
  const parent = await realpath(tmpdir());
  const root = await mkdtemp(join(parent, prefix));
  const owned = await realpath(root);
  assert.equal(dirname(owned), parent);
  assert.ok(basename(owned).startsWith(prefix));
  try {
    const market = join(root, 'internal', 'market');
    await mkdir(market, { recursive: true });
    for (const name of sourceFiles) await writeFile(join(market, name), name === 'artifact.go' ? fixture : 'package market\n', 'utf8');
    const zip = join(root, 'package.zip');
    await writeFile(zip, 'validator input bytes', 'utf8');
    const before = (await readdir(parent)).filter((name) => name.startsWith('gonavi-log2sql-market-check-'));
    const { runMarketCheck } = await import('./market-check.mjs');
    assert.deepEqual(await runMarketCheck(zip, { source: root }), {
      id: 'fixture.plugin', version: '0.1.1', platforms: ['linux/amd64'],
      sha256: createHash('sha256').update(await readFile(zip)).digest('hex'), size: 21,
    });
    await writeFile(zip, 'reject these bytes', 'utf8');
    await assert.rejects(runMarketCheck(zip, { source: root }), /market\.ValidatePackage failed \(exit 1\): fixture validation rejected package/);
    await assert.rejects(runMarketCheck(join(root, 'missing.zip'), { source: root }), /market\.ValidatePackage failed \(exit 1\)/);
    assert.equal(await readFile(zip, 'utf8'), 'reject these bytes');
    for (const content of ['package different\n', 'package market\nimport _ "notstdlib"\n',
      'package market\nimport _ "example.com/external/dependency"\n', 'package market\nimport _ "C"\n']) {
      await writeFile(join(market, 'artifact_zip.go'), content, 'utf8');
      await assert.rejects(runMarketCheck(zip, { source: root }), /source inspection failed \(exit 1\): (source package must be market|non-standard import)/);
    }
    await writeFile(join(market, 'artifact_zip.go'), 'package market\n', 'utf8');
    await rm(join(market, 'artifact_zip.go'));
    await assert.rejects(runMarketCheck(zip, { source: root }), /missing source file: artifact_zip\.go/);
    await mkdir(join(market, 'artifact_zip.go'));
    await assert.rejects(runMarketCheck(zip, { source: root }), /source must be regular and not a symlink/);
    await rm(join(market, 'artifact_zip.go'), { recursive: true });
    if (process.platform !== 'win32') {
      await symlink(join(market, 'artifact.go'), join(market, 'artifact_zip.go'));
      await assert.rejects(runMarketCheck(zip, { source: root }), /source must be regular and not a symlink/);
      await rm(join(market, 'artifact_zip.go'));
    }
    await writeFile(join(market, 'artifact_zip.go'), 'package market\n', 'utf8');
    await writeFile(join(market, 'artifact.go'), fixture + '\nfunc broken() { missingSymbol() }\n', 'utf8');
    await assert.rejects(runMarketCheck(zip, { source: root }), /validator build failed \(exit 1\):/);
    await assert.rejects(runMarketCheck(zip, { source: root, go: join(root, 'missing-go') }), /source inspection could not start/);
    assert.deepEqual((await readdir(parent)).filter((name) => name.startsWith('gonavi-log2sql-market-check-')), before);
  } finally {
    assert.equal(await realpath(root), owned);
    await rm(owned, { recursive: true, force: true });
  }
});
