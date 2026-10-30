import { spawn } from 'node:child_process';
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const prefix = 'log2sql-host-check-';
const check = (condition, message) => { if (!condition) throw new Error(message); };
const validatorMain = `package main
import (
 "bytes"
 "context"
 "crypto/sha256"
 "encoding/base64"
 "encoding/json"
 "errors"
 "fmt"
 "image/png"
 "os"
 "path/filepath"
 "sort"
 "strings"
 "time"
 "GoNavi-Wails/internal/plugin"
)
func main() {
 if err := run(); err != nil { fmt.Fprintln(os.Stderr, err); os.Exit(1) }
}
func run() (resultErr error) {
 ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
 defer cancel()
 before, err := os.ReadFile(os.Args[1]); if err != nil { return err }
 manager, err := plugin.NewManager(plugin.Options{Root: filepath.Join(os.Args[2], "plugin-store"), HostVersion: "1.2.0"})
 if err != nil { return err }
 defer func() { closeCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second); defer cancel(); resultErr = errors.Join(resultErr, manager.Close(closeCtx)) }()
 inspected, err := manager.Inspect(ctx, os.Args[1]); if err != nil { return err }
 platforms := make([]string, 0)
 if inspected.Manifest.Backend != nil {
  for name := range inspected.Manifest.Backend.Platforms { platforms = append(platforms, name) }
 }
 sort.Strings(platforms)
 iconPath := inspected.Manifest.IconPath()
 inputs := []string{os.Args[1]}
 if len(os.Args) == 4 { inputs = append(inputs, os.Args[3]) }
 var icon []byte
 for _, input := range inputs {
  inspection, err := manager.Inspect(ctx, input); if err != nil { return err }
  if inspection.Digest != inspected.Digest { return fmt.Errorf("directory and ZIP package digest differ") }
  status, err := manager.Install(ctx, plugin.InstallRequest{Path: input, Digest: inspection.Digest, Trusted: true})
  if err != nil { return err }
  if status.Manifest.ID != inspected.Manifest.ID || status.Manifest.Version != inspected.Manifest.Version { return fmt.Errorf("installed package identity differs") }
  if iconPath == "" { return fmt.Errorf("package does not declare an icon") }
  data, err := manager.ReadPackageFile(status.Manifest.ID, iconPath, 64*1024); if err != nil { return err }
  if len(data) == 0 || len(data) > 64*1024 { return fmt.Errorf("invalid icon size") }
  config, err := png.DecodeConfig(bytes.NewReader(data)); if err != nil { return fmt.Errorf("invalid PNG icon: %w", err) }
  if config.Width < 1 || config.Height < 1 { return fmt.Errorf("empty PNG dimensions") }
  if _, err := png.Decode(bytes.NewReader(data)); err != nil { return fmt.Errorf("corrupt PNG icon: %w", err) }
  image := manager.IconDataURL(status.Manifest.ID)
  if image != plugin.RasterIconDataURL(data) || !strings.HasPrefix(image, "data:image/png;base64,") { return fmt.Errorf("installed icon data URL differs or is empty") }
  decoded, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(image, "data:image/png;base64,"))
  if err != nil || !bytes.Equal(decoded, data) { return fmt.Errorf("installed icon data URL bytes differ") }
  if icon != nil && !bytes.Equal(icon, data) { return fmt.Errorf("directory and ZIP icon bytes differ") }
  icon = data
 }
 after, err := os.ReadFile(os.Args[1]); if err != nil { return err }
 if !bytes.Equal(before, after) { return fmt.Errorf("package changed during inspection") }
 hash := sha256.Sum256(before)
 return json.NewEncoder(os.Stdout).Encode(map[string]any{
  "id": inspected.Manifest.ID, "version": inspected.Manifest.Version,
  "platforms": platforms, "sha256": fmt.Sprintf("%x", hash), "size": len(before),
  "packageDigest": inspected.Digest,
  "icon": map[string]any{"path": iconPath, "bytes": len(icon), "readable": true},
 })
}
`;

function execute(binary, args, options, timeoutMs, label) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { ...options, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', bytes = 0, failure;
    const stop = (error) => { failure ??= error; child.kill('SIGKILL'); };
    const timer = setTimeout(() => stop(new Error(label + ' timed out')), timeoutMs);
    child.on('error', error => { failure ??= new Error(label + ' could not start: ' + error.message); });
    for (const [stream, output] of [[child.stdout, true], [child.stderr, false]]) stream.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > 65536) { stop(new Error(label + ' output exceeds 64 KiB')); return; }
      if (output) stdout += chunk.toString('utf8'); else stderr += chunk.toString('utf8');
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (failure) reject(failure);
      else if (code !== 0 || signal) reject(new Error(label + ' failed (exit ' + code + (signal ? ', ' + signal : '') + '): ' + (stderr || stdout).trim().slice(0, 4096)));
      else resolve(stdout);
    });
  });
}

export async function runHostCheck(zip, { source, directory, go = process.env.GO_BINARY || 'go', timeoutMs = 120000 } = {}) {
  check(typeof zip === 'string' && zip.length > 0, 'ZIP path is required');
  check(typeof source === 'string' && source.length > 0, 'host source root is required');
  check(directory === undefined || typeof directory === 'string' && directory.length > 0, 'invalid package directory');
  check(Number.isInteger(timeoutMs) && timeoutMs >= 100 && timeoutMs <= 180000, 'invalid timeout');
  const sourceRoot = await realpath(source).catch(() => { throw new Error('missing host source'); });
  for (const [name, file] of [['go.mod', true], ['internal/plugin', false]]) {
    const info = await lstat(join(sourceRoot, name)).catch(() => { throw new Error('missing host source: ' + name); });
    check(!info.isSymbolicLink() && (file ? info.isFile() : info.isDirectory()), 'invalid host source: ' + name);
  }
  const module = await readFile(join(sourceRoot, 'go.mod'), 'utf8');
  check(/^module GoNavi-Wails\r?$/m.test(module), 'unexpected host module');
  const temporaryRoot = await realpath(tmpdir());
  const root = await mkdtemp(join(temporaryRoot, prefix));
  const ownedRoot = await realpath(root);
  check(dirname(ownedRoot) === temporaryRoot && basename(ownedRoot).startsWith(prefix), 'unsafe temporary path');
  try {
    const moduleRoot = join(ownedRoot, 'module');
    await mkdir(moduleRoot);
    await writeFile(join(moduleRoot, 'go.mod'), 'module GoNavi-Wails/log2sqlhostcheck\n\ngo 1.25\n\nrequire GoNavi-Wails v0.0.0\n\nreplace GoNavi-Wails => ' + JSON.stringify(sourceRoot.replace(/\\/g, '/')) + '\n', 'utf8');
    await writeFile(join(moduleRoot, 'main.go'), validatorMain, 'utf8');
    const env = { ...process.env, GOWORK: 'off', GOTOOLCHAIN: 'local', CGO_ENABLED: '0', GOFLAGS: '' };
    delete env.GOOS; delete env.GOARCH;
    const binary = join(ownedRoot, process.platform === 'win32' ? 'validator.exe' : 'validator');
    await execute(go, ['build', '-mod=mod', '-o', binary, '.'], { cwd: moduleRoot, env }, timeoutMs, 'host validator build');
    const args = [resolve(zip), ownedRoot];
    if (directory) args.push(resolve(directory));
    const output = await execute(binary, args, { cwd: moduleRoot, env }, Math.min(timeoutMs, 35000), 'host package check');
    const result = JSON.parse(output);
    check(result && typeof result.id === 'string' && result.id.length > 0 && typeof result.version === 'string' &&
      Array.isArray(result.platforms) && result.platforms.every(value => typeof value === 'string') &&
      /^[0-9a-f]{64}$/.test(result.sha256) && Number.isSafeInteger(result.size) && result.size > 0 &&
      result.icon?.readable === true && typeof result.icon.path === 'string' && Number.isSafeInteger(result.icon.bytes) && result.icon.bytes > 0 && result.icon.bytes <= 65536,
    'invalid host validator JSON');
    return result;
  } finally {
    check(await realpath(root) === ownedRoot && dirname(ownedRoot) === temporaryRoot && basename(ownedRoot).startsWith(prefix), 'refusing unsafe temporary cleanup');
    await rm(ownedRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [zip, sourceFlag, source, directoryFlag, directory, extra] = process.argv.slice(2);
    check(zip && sourceFlag === '--source' && source && extra === undefined &&
      (directoryFlag === undefined || directoryFlag === '--directory' && directory),
    'Usage: node tools/host-check.mjs <zip> --source <GoNavi checkout> [--directory <package directory>]');
    console.log(JSON.stringify(await runHostCheck(zip, { source, directory })));
  } catch (error) { console.error('host-check:', error.message); process.exitCode = 1; }
}
