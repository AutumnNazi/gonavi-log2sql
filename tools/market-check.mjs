import { spawn } from 'node:child_process';
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const sourceFiles = ['artifact.go', 'artifact_ai_provider.go', 'artifact_datasource.go',
  'artifact_exporter.go', 'artifact_manifest.go', 'artifact_manifest_json.go', 'artifact_manifest_ui.go',
  'artifact_pages.go', 'artifact_permission_notes.go', 'artifact_skill.go', 'artifact_tgz.go', 'artifact_zip.go'];
const prefix = 'gonavi-log2sql-market-check-';
const check = (condition, message) => { if (!condition) throw new Error(message); };

const inspectSource = `package main
import ("fmt"; "go/build"; "go/parser"; "go/token"; "os"; "path/filepath"; "strconv")
func main() {
 files, err := filepath.Glob(filepath.Join(os.Args[1], "*.go")); if err != nil { fail(err) }
 for _, filename := range files {
  file, err := parser.ParseFile(token.NewFileSet(), filename, nil, parser.ImportsOnly); if err != nil { fail(fmt.Errorf("invalid source: %s", filepath.Base(filename))) }
  if file.Name.Name != "market" { fail(fmt.Errorf("source package must be market: %s", filepath.Base(filename))) }
  for _, entry := range file.Imports {
   name, err := strconv.Unquote(entry.Path.Value); if err != nil { fail(err) }
   pkg, err := build.Default.Import(name, "", build.FindOnly)
   if err != nil || !pkg.Goroot { fail(fmt.Errorf("non-standard import in %s: %s", filepath.Base(filename), name)) }
  }
 }
}
func fail(err error) { fmt.Fprintln(os.Stderr, err); os.Exit(1) }
`;
const validatorMain = `package main
import ("context"; "encoding/json"; "fmt"; "os"; "time"; "marketcheck/internal/market")
func main() {
 ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second); defer cancel()
 result, err := market.ValidatePackage(ctx, os.Args[1])
 if err != nil { fmt.Fprintln(os.Stderr, err); os.Exit(1) }
 if err := json.NewEncoder(os.Stdout).Encode(map[string]any{
  "id": result.ID, "version": result.Version, "platforms": result.Platforms, "sha256": result.SHA256, "size": result.SizeBytes,
 }); err != nil { fmt.Fprintln(os.Stderr, err); os.Exit(1) }
}
`;

function execute(binary, args, options, timeoutMs, label) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { ...options, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let bytes = 0;
    let failure;
    const stop = (error) => { failure ??= error; child.kill('SIGKILL'); };
    const timer = setTimeout(() => stop(new Error(label + ' timed out')), timeoutMs);
    child.on('error', (error) => { failure ??= new Error(label + ' could not start: ' + error.message); });
    for (const [stream, output] of [[child.stdout, true], [child.stderr, false]]) {
      stream.on('data', (chunk) => {
        bytes += chunk.length;
        if (bytes > 65536) { stop(new Error(label + ' output exceeds 64 KiB')); return; }
        if (output) stdout += chunk.toString('utf8'); else stderr += chunk.toString('utf8');
      });
    }
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (failure) reject(failure);
      else if (code !== 0 || signal) reject(new Error(label + ' failed (exit ' + code + (signal ? ', ' + signal : '') + '): ' + (stderr || stdout).trim().slice(0, 4096)));
      else resolve(stdout);
    });
  });
}

export async function runMarketCheck(zip, { source, go = process.env.GO_BINARY || 'go', timeoutMs = 120000 } = {}) {
  check(typeof zip === 'string' && zip.length > 0, 'ZIP path is required');
  check(typeof source === 'string' && source.length > 0, 'GoNavi source root is required');
  check(Number.isInteger(timeoutMs) && timeoutMs >= 100 && timeoutMs <= 180000, 'invalid timeout');
  const sourceDir = join(resolve(source), 'internal', 'market');
  const sources = [];
  for (const name of sourceFiles) {
    const filename = join(sourceDir, name);
    let info;
    try { info = await lstat(filename); } catch { throw new Error('missing source file: ' + name); }
    check(info.isFile() && !info.isSymbolicLink(), 'source must be regular and not a symlink: ' + name);
    check(info.size <= 1 << 20, 'source file exceeds 1 MiB: ' + name);
    const bytes = await readFile(filename);
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    sources.push([name, bytes]);
  }
  const temporaryRoot = await realpath(tmpdir());
  const root = await mkdtemp(join(temporaryRoot, prefix));
  const ownedRoot = await realpath(root);
  check(dirname(ownedRoot) === temporaryRoot && basename(ownedRoot).startsWith(prefix), 'unsafe temporary path');
  try {
    const moduleRoot = join(ownedRoot, 'module');
    const marketDir = join(moduleRoot, 'internal', 'market');
    const temp = join(ownedRoot, 'tmp');
    await mkdir(marketDir, { recursive: true });
    await mkdir(temp);
    const cache = process.env.GOCACHE && process.env.GOCACHE !== 'off' ? resolve(process.env.GOCACHE) : join(ownedRoot, 'cache');
    await mkdir(cache, { recursive: true });
    for (const [name, bytes] of sources) await writeFile(join(marketDir, name), bytes);
    await writeFile(join(moduleRoot, 'go.mod'), 'module marketcheck\n\ngo 1.23\n', 'utf8');
    await writeFile(join(ownedRoot, 'inspect.go'), inspectSource, 'utf8');
    await writeFile(join(moduleRoot, 'main.go'), validatorMain, 'utf8');
    const env = { ...process.env, GOWORK: 'off', GOTOOLCHAIN: 'local', GOPROXY: 'off', CGO_ENABLED: '0',
      GOSUMDB: 'off', GOENV: 'off', GOFLAGS: '', GOCACHE: cache, TEMP: temp, TMP: temp, TMPDIR: temp };
    delete env.GOOS;
    delete env.GOARCH;
    const options = { cwd: moduleRoot, env };
    await execute(go, ['run', join(ownedRoot, 'inspect.go'), marketDir], options, timeoutMs, 'source inspection');
    const binary = join(ownedRoot, process.platform === 'win32' ? 'validator.exe' : 'validator');
    await execute(go, ['build', '-o', binary, '.'], options, timeoutMs, 'validator build');
    const output = await execute(binary, [resolve(zip)], options, Math.min(timeoutMs, 35000), 'market.ValidatePackage');
    const result = JSON.parse(output);
    check(result && typeof result.id === 'string' && result.id.length > 0 && typeof result.version === 'string' &&
      Array.isArray(result.platforms) && result.platforms.every((value) => typeof value === 'string') &&
      /^[0-9a-f]{64}$/.test(result.sha256) && Number.isSafeInteger(result.size) && result.size > 0, 'invalid validator JSON');
    return result;
  } finally {
    check(await realpath(root) === ownedRoot && dirname(ownedRoot) === temporaryRoot && basename(ownedRoot).startsWith(prefix), 'refusing unsafe temporary cleanup');
    await rm(ownedRoot, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [zip, flag, source, ...extra] = process.argv.slice(2);
    check(zip && flag === '--source' && source && extra.length === 0, 'Usage: node tools/market-check.mjs <zip> --source <GoNavi-checkout-root>');
    console.log(JSON.stringify(await runMarketCheck(zip, { source })));
  } catch (error) {
    console.error('market-check: ' + error.message.slice(0, 4096));
    process.exitCode = 1;
  }
}
