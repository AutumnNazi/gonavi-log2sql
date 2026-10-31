// 构建编排：编译后端 → 组装面板与清单 → （可选）用 GoNavi CLI 静态校验包。
// 用法：
//   node tools/build.mjs                 # 组包到全新 pkg/<timestamp>-<uuid>/
//   node tools/build.mjs --check         # 组包后构建 gonavi CLI 并跑 plugin check
//   node tools/build.mjs --goos linux --goarch arm64   # 交叉编译（executable 名不带 .exe）
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, lstatSync, copyFileSync, chmodSync, openSync, closeSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve, dirname, relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const valueFlags = ['--out', '--goos', '--goarch', '--platforms', '--binaries', '--archive', '--gonavi'];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--check') continue;
  if (!valueFlags.includes(args[i]) || !args[i + 1] || args[i + 1].startsWith('--')) {
    throw new Error('invalid argument: ' + args[i]);
  }
  i++;
}
const val = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};

// 对齐宿主 internal/plugin/ai_provider.go 的 maxPackageIconBytes = 5 << 20（36260ba77 起 64 KiB → 5 MiB）。
const maxPackageIconBytes = 5 * 1024 * 1024;

const goos = val('--goos', process.platform === 'win32' ? 'windows' : process.platform);
const goarch = val('--goarch', process.arch === 'x64' ? 'amd64' : process.arch);
const pkgDir = resolve(root, val('--out', 'pkg/' + Date.now() + '-' + randomUUID()));
if (existsSync(pkgDir)) throw new Error('output exists; choose a fresh directory: ' + pkgDir);
if (flag('--platforms') && (flag('--goos') || flag('--goarch'))) throw new Error('use --platforms or --goos/--goarch, not both');
const selectedPlatforms = val('--platforms', `${goos}/${goarch}`).split(',').sort();
const allowedPlatforms = ['windows/amd64', 'linux/amd64', 'linux/arm64', 'darwin/amd64', 'darwin/arm64'];
if (selectedPlatforms.some(platform => !allowedPlatforms.includes(platform)) || new Set(selectedPlatforms).size !== selectedPlatforms.length) {
  throw new Error('invalid platform: ' + selectedPlatforms.join(','));
}
const binaries = val('--binaries', '');
const binaryRoot = binaries ? resolve(root, binaries) : '';
const archive = val('--archive', '');
const archivePath = archive ? resolve(root, archive) : '';
const archiveRelative = archivePath ? relative(pkgDir, archivePath) : '';
const archiveIsInside = archiveRelative !== '..' && !archiveRelative.startsWith('..' + sep) && !isAbsolute(archiveRelative);
if (archivePath && (!archivePath.endsWith('.zip') || existsSync(archivePath) || archiveIsInside)) {
  throw new Error('archive must be a fresh .zip outside the output directory: ' + archivePath);
}
if (flag('--check') && !val('--gonavi', process.env.GONAVI_ROOT || '')) {
  throw new Error('--check requires --gonavi <GoNavi checkout> or GONAVI_ROOT');
}
const licensePaths = ['LICENSE', 'THIRD_PARTY_NOTICES'];
const template = JSON.parse(readFileSync(resolve(root, 'tools/manifest.template.json'), 'utf8'));
const icon = template.icon === undefined ? '' : template.icon;
if (typeof icon !== 'string') throw new Error('invalid package icon path');
const iconPaths = icon ? [icon] : [];
if (icon) {
  const parts = icon.split('/');
  if (Buffer.byteLength(icon, 'utf8') > 256 || !/^[A-Za-z0-9][A-Za-z0-9._/-]*\.(png|jpe?g|webp|gif)$/i.test(icon) ||
      parts.some(part => !part || part === '.' || part === '..')) throw new Error('invalid package icon path');
  for (let i = 1; i <= parts.length; i++) {
    const source = resolve(root, ...parts.slice(0, i));
    if (!existsSync(source)) throw new Error('missing package icon: ' + source);
    const stat = lstatSync(source);
    if (stat.isSymbolicLink() || (i === parts.length
      ? !stat.isFile() || stat.nlink !== 1 || stat.size === 0 || stat.size > maxPackageIconBytes
      : !stat.isDirectory())) throw new Error('invalid package icon: ' + source);
  }
}
// 对齐宿主 internal/plugin/permission_notes.go：说明必须对应已声明权限，且 ≤160 字节、非空、禁 <> 与控制字符。
for (const [key, note] of Object.entries(template.permissionNotes ?? {})) {
  if (!template.permissions?.includes(key) || typeof note !== 'string' || note.trim() === '' ||
      Buffer.byteLength(note, 'utf8') > 160 || /[<>\u0000-\u001f\u007f]/.test(note)) {
    throw new Error('invalid permission note: ' + key);
  }
}
for (const file of licensePaths) {
  if (!existsSync(resolve(root, file))) throw new Error('missing license: ' + file);
}
const targets = selectedPlatforms.map(platform => {
  const [os, arch] = platform.split('/');
  const relative = `bin/${os}-${arch}/plugin${os === 'windows' ? '.exe' : ''}`;
  const source = binaryRoot ? resolve(binaryRoot, relative) : '';
  if (source) {
    if (!existsSync(source)) throw new Error('missing binary: ' + source);
    for (const path of [binaryRoot, resolve(binaryRoot, 'bin'), dirname(source), source]) {
      const stat = lstatSync(path);
      if (stat.isSymbolicLink() || (path === source ? !stat.isFile() || stat.size === 0 || stat.nlink !== 1 : !stat.isDirectory())) {
        throw new Error('invalid binary path: ' + path);
      }
    }
  }
  return { os, arch, relative, source };
});

function run(cmd, cmdArgs, opts = {}) {
  console.log('> ' + cmd + ' ' + cmdArgs.join(' '));
  const r = spawnSync(cmd, cmdArgs, { stdio: 'inherit', ...opts });
  if (r.error) throw r.error;
  if (r.status !== 0) {
    throw new Error(cmd + ' 退出码 ' + r.status);
  }
}

// 输出必须全新；不删除或覆盖既有 pkg/build 内容。
mkdirSync(dirname(pkgDir), { recursive: true });
mkdirSync(pkgDir);
for (const target of targets) {
  const destination = resolve(pkgDir, target.relative);
  mkdirSync(dirname(destination), { recursive: true });
  if (target.source) {
    copyFileSync(target.source, destination);
  } else {
    run('go', ['build', '-mod=readonly', '-trimpath', '-buildvcs=false', '-o', destination, '.'], {
      cwd: root, env: { ...process.env, CGO_ENABLED: '0', GOOS: target.os, GOARCH: target.arch },
    });
  }
  chmodSync(destination, 0o755);
}
for (const file of [...licensePaths, ...iconPaths]) {
  const destination = resolve(pkgDir, file);
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(resolve(root, file), destination);
}

// 2. 页面 + 清单：engine/app 内联进 panel.html，仅嵌入 gonavi.plugin.json
run('node', [
  resolve(root, 'ui/build-embed.mjs'),
  '--out', pkgDir,
  '--template', resolve(root, 'tools/manifest.template.json'),
  '--platforms', selectedPlatforms.join(','),
]);

if (archivePath) {
  run('go', ['run', resolve(root, 'tools/archive/main.go'), pkgDir, archivePath,
    'gonavi.plugin.json', ...licensePaths, ...iconPaths, ...targets.map(target => target.relative)], { cwd: root });
}

// 可选上游校验使用独立 root；CLI 编译依赖失败直接报错，不修改主应用。
if (flag('--check')) {
  const gonaviRoot = resolve(val('--gonavi', process.env.GONAVI_ROOT || ''));
  const checkDir = resolve(root, 'build', 'check-' + randomUUID());
  mkdirSync(checkDir, { recursive: true });
  const cliExe = resolve(checkDir, process.platform === 'win32' ? 'gonavi.exe' : 'gonavi');
  run('go', ['build', '-o', cliExe, './cmd/gonavi'], { cwd: gonaviRoot });
  const logPath = resolve(checkDir, 'plugin-check.json');
  const fd = openSync(logPath, 'wx');
  const result = spawnSync(cliExe, ['plugin', '--root', resolve(checkDir, 'plugin-root'), 'check', archivePath || pkgDir], { stdio: ['ignore', fd, 'inherit'] });
  closeSync(fd);
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error('plugin check failed; output: ' + logPath);
  const verdict = JSON.parse(readFileSync(logPath, 'utf8'));
  if (verdict.valid !== true) throw new Error('plugin check did not return valid:true; output: ' + logPath);
  console.log('plugin check: valid:true; output: ' + logPath);
}
console.log('done: ' + pkgDir);
