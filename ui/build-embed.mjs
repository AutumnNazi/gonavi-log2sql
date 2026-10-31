// 组装标签页内联 HTML 并写入插件清单：
//   ui/panel.html + ui/engine.js + ui/app.js  ->  contributes.pages[0].html.source
// 页面 HTML 与最终清单分别遵守市场的 256 KiB UTF-8 字节上限。
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

const html = panel
  .replace('<!-- __ENGINE_JS__ -->', () => inlineScript(engineSource))
  .replace('<!-- __APP_JS__ -->', () => inlineScript(appSource));
if (html.includes('__ENGINE_JS__') || html.includes('__APP_JS__')) {
  throw new Error('panel.html 的注入占位未被替换');
}

const htmlBytes = Buffer.byteLength(html, 'utf8');
const limit = 256 * 1024;
if (htmlBytes > limit) {
  throw new Error(`页面 HTML ${htmlBytes} 字节超出构建上限 ${limit}`);
}
console.log(`page html: ${htmlBytes} bytes / ${limit} limit`);

const manifest = JSON.parse(readFileSync(templatePath, 'utf8'));
// 标题栏入口只能来自 navigation：宿主不再按 pages/window 推断，漏声明就等于没有入口。
const navigation = manifest.contributes.navigation;
if (manifest.contributes.pages?.length !== 1 || manifest.contributes.pages[0].id !== 'workbench' ||
    manifest.contributes.pages[0].html?.source !== '__WORKBENCH_HTML__' ||
    Object.hasOwn(manifest.contributes, 'panels') ||
    navigation?.length !== 1 || navigation[0].page !== 'workbench' || navigation[0].location !== 'tools') {
  throw new Error('清单必须声明 workbench HTML 页面，并以 contributes.navigation（location: tools）指向它，且不声明 panels');
}
manifest.contributes.pages[0].html.source = html;
manifest.backend = { platforms: {} };
for (const platform of platforms) {
  const [os, arch] = platform.split('/');
  manifest.backend.platforms[platform] = {
    executable: executable || `bin/${os}-${arch}/plugin${os === 'windows' ? '.exe' : ''}`,
    runtime: 'native',
  };
}

const manifestJSON = JSON.stringify(manifest, null, 2) + '\n';
const manifestBytes = Buffer.byteLength(manifestJSON, 'utf8');
if (manifestBytes > limit) throw new Error(`清单 ${manifestBytes} 字节超出市场上限 ${limit}`);
console.log(`manifest: ${manifestBytes} bytes / ${limit} limit`);
mkdirSync(outDir, { recursive: true });
const manifestPath = resolve(outDir, 'gonavi.plugin.json');
writeFileSync(manifestPath, manifestJSON, 'utf8');
console.log(`manifest written: ${manifestPath}`);
// 本机预览文件放在包目录之外（build/），避免混进插件包污染内容摘要；
// 浏览器直接打开即可预览 UI，无需安装进 GoNavi。
const previewDir = resolve(root, 'build');
mkdirSync(previewDir, { recursive: true });
if (!existsSync(resolve(previewDir, 'panel.preview.html'))) {
  writeFileSync(resolve(previewDir, 'panel.preview.html'), html, { encoding: 'utf8', flag: 'wx' });
}
console.log(`panel preview available: ${resolve(previewDir, 'panel.preview.html')}`);
