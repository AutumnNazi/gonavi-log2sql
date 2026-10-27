// 组装最终面板并写入插件清单：
//   ui/panel.html + ui/engine.js + ui/app.js  ->  <out>/gonavi.plugin.json
// 面板 HTML 是清单内联文本，宿主上限 256 KiB（UTF-8 字节），超限直接失败。
// 用法：node ui/build-embed.mjs --out pkg --template tools/manifest.template.json
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);

function argValue(flag, fallback) {
  const i = args.indexOf(flag);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback;
}

const outDir = resolve(root, argValue('--out', 'pkg'));
const templatePath = resolve(root, argValue('--template', 'tools/manifest.template.json'));
const executable = argValue('--executable', '');
const platforms = argValue('--platforms', `${process.platform === 'win32' ? 'windows' : process.platform}/${process.arch === 'x64' ? 'amd64' : process.arch}`).split(',').sort();
const allowedPlatforms = ['windows/amd64', 'linux/amd64', 'linux/arm64', 'darwin/amd64', 'darwin/arm64'];
if (platforms.some(platform => !allowedPlatforms.includes(platform)) || new Set(platforms).size !== platforms.length) {
  throw new Error('invalid platform: ' + platforms.join(','));
}
if (executable && (platforms.length !== 1 || !/^bin\/[a-z0-9_./-]+$/.test(executable) || executable.split('/').includes('..'))) {
  throw new Error('--executable must be a relative bin path for a single platform');
}

// engine.js 剥掉 ESM 导出行并挂到 window；面板脚本不是 module。
// 校验捕获行首任何 export 形式（export {}、export function、export const），
// 防止未来写法变化漏出 ESM 语法到无 module 的面板脚本里。
const engineSource = readFileSync(resolve(root, 'ui/engine.js'), 'utf8')
  .replace(/\/\/ __EXPORT_LINE__\s*\nexport \{ engine as default \};\s*$/m, '')
  .concat('\nwindow.log2sql = engine;\n');
if (/^\s*export\s/m.test(engineSource)) {
  throw new Error('engine.js 的 ESM 导出语句未被剥离，检查 __EXPORT_LINE__ 标记位置');
}

const appSource = readFileSync(resolve(root, 'ui/app.js'), 'utf8');
const panel = readFileSync(resolve(root, 'ui/panel.html'), 'utf8');

// 防御：内联脚本中出现 </script> 会提前终止标签
function inlineScript(code) {
  if (/<\/script/i.test(code)) {
    throw new Error('内联脚本包含 </script>，会破坏面板 HTML');
  }
  return '<script>\n' + code + '\n</script>';
}

let html = panel
  .replace('<!-- __ENGINE_JS__ -->', () => inlineScript(engineSource))
  .replace('<!-- __APP_JS__ -->', () => inlineScript(appSource));
if (html.includes('__ENGINE_JS__') || html.includes('__APP_JS__')) {
  throw new Error('panel.html 的注入占位未被替换');
}

const panelBytes = Buffer.byteLength(html, 'utf8');
const limit = 256 * 1024;
if (panelBytes > limit) {
  throw new Error(`面板 HTML ${panelBytes} 字节超出宿主上限 ${limit}`);
}
console.log(`panel html: ${panelBytes} bytes / ${limit} limit`);

const manifest = JSON.parse(readFileSync(templatePath, 'utf8'));
manifest.contributes.panels[0].html.source = html;
// 插件页面（工作台标签页 + 标题栏菜单）复用同一份面板文档
for (const page of manifest.contributes.pages ?? []) {
  if (page.html) page.html.source = html;
}
manifest.backend = { platforms: {} };
for (const platform of platforms) {
  const [os, arch] = platform.split('/');
  manifest.backend.platforms[platform] = {
    executable: executable || `bin/${os}-${arch}/plugin${os === 'windows' ? '.exe' : ''}`,
    runtime: 'native',
  };
}

mkdirSync(outDir, { recursive: true });
const manifestPath = resolve(outDir, 'gonavi.plugin.json');
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
console.log(`manifest written: ${manifestPath}`);
// 独立窗口入口：与内嵌面板同一份内联文档，作为包内资产由 window.entry 引用。
// 窗口里宿主注入 window.gonaviPlugin 桥接，设置持久化走 getSettings/saveSettings。
const windowDir = resolve(outDir, 'ui');
mkdirSync(windowDir, { recursive: true });
const windowPath = resolve(windowDir, 'window.html');
writeFileSync(windowPath, html, 'utf8');
console.log(`window entry written: ${windowPath}`);
// 面板预览文件放在包目录之外（build/），避免混进插件包污染内容摘要；
// 浏览器直接打开即可预览 UI，无需安装进 GoNavi。
const previewDir = resolve(root, 'build');
mkdirSync(previewDir, { recursive: true });
if (!existsSync(resolve(previewDir, 'panel.preview.html'))) {
  writeFileSync(resolve(previewDir, 'panel.preview.html'), html, { encoding: 'utf8', flag: 'wx' });
}
console.log(`panel preview available: ${resolve(previewDir, 'panel.preview.html')}`);
