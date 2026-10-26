// 构建编排：编译后端 → 组装面板与清单 → （可选）用 GoNavi CLI 静态校验包。
// 用法：
//   node tools/build.mjs                 # 组包到 pkg/
//   node tools/build.mjs --check         # 组包后构建 gonavi CLI 并跑 plugin check
//   node tools/build.mjs --goos linux --goarch arm64   # 交叉编译（executable 名不带 .exe）
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const val = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback;
};

const goos = val('--goos', process.platform === 'win32' ? 'windows' : process.platform);
const goarch = val('--goarch', process.arch === 'x64' ? 'amd64' : process.arch);
const pkgDir = resolve(root, 'pkg');
const binName = goos === 'windows' ? 'plugin.exe' : 'plugin';

function run(cmd, cmdArgs, opts = {}) {
  console.log('> ' + cmd + ' ' + cmdArgs.join(' '));
  const r = spawnSync(cmd, cmdArgs, { stdio: 'inherit', ...opts });
  if (r.status !== 0) {
    throw new Error(cmd + ' 退出码 ' + r.status);
  }
}

// 1. 后端：清掉旧产物后按目标平台编译
rmSync(resolve(pkgDir, 'bin'), { recursive: true, force: true });
mkdirSync(resolve(pkgDir, 'bin'), { recursive: true });
run('go', ['build', '-trimpath', '-o', resolve(pkgDir, 'bin', binName), '.'], {
  cwd: root, env: { ...process.env, GOOS: goos, GOARCH: goarch },
});

// 2. 面板 + 清单：engine/app 内联进 panel.html，再嵌入 gonavi.plugin.json
run('node', [
  resolve(root, 'ui/build-embed.mjs'),
  '--out', pkgDir,
  '--template', resolve(root, 'tools/manifest.template.json'),
  '--executable', 'bin/' + binName,
]);

// 3. 可选：构建上游 CLI 并对成品包跑静态校验（不执行插件代码）。
//    CLI 已存在则跳过重建（编译要 30 秒级）；上游更新后删除 build/ 下的
//    gonavi 可执行文件即可强制重建。
if (flag('--check')) {
  const gonaviRoot = val('--gonavi', 'E:/code/GoNavi');
  const cliExe = resolve(root, 'build', goos === 'windows' ? 'gonavi.exe' : 'gonavi');
  mkdirSync(resolve(root, 'build'), { recursive: true });
  if (existsSync(cliExe)) {
    console.log('skip: gonavi CLI already built at ' + cliExe);
  } else {
    run('go', ['build', '-o', cliExe, './cmd/gonavi'], { cwd: gonaviRoot });
  }
  const root_ = resolve(root, 'build', 'plugin-root');
  run(cliExe, ['plugin', '--root', root_, 'check', pkgDir]);
}
console.log('done: ' + pkgDir);
