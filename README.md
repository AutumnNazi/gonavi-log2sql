# gonavi-log2sql

GoNavi 插件：把 MyBatis / MyBatis-Plus 的 `Preparing:` / `Parameters:` DEBUG 日志
还原成可直接执行的 SQL。

- 插件 ID：`gh-autumnnazi.log2sql`
- 权限：`ai.tools`（Agent 工具）、`host.log`（启动诊断）、`ui.pages`（工作区页面）、`ui.html-panel`（内联 HTML）；不申请网络、数据库或额外凭据权限
- 当前版本：`0.1.5`（补回标题栏入口、对齐宿主 `5d4402903` 契约），已发布 <https://github.com/AutumnNazi/gonavi-log2sql/releases/tag/v0.1.5>；仅工作区标签页，不提供独立窗口；已公开的 `v0.1.0`–`v0.1.4` 资产不覆盖；公开仓库：<https://github.com/AutumnNazi/gonavi-log2sql>
- 许可：Apache-2.0（完整正文见 `LICENSE`，SDK 归属与 Go 标准库许可见 `THIRD_PARTY_NOTICES`）

## 功能

- 粘贴整行日志（时间戳/线程/级别/logger 前缀）或仅 `Preparing:` / `Parameters:` 部分，一次可贴多条语句
- 参数回填 `?` 占位符：数字/布尔裸值，字符串/日期时间加单引号（内部 `'` 转义为 `''`），裸 `null` 输出 `NULL`（`null(String)` 是字面字符串，保留为 `'null'`）
- 兼容短类名 `(String)` 与全类名 `(java.lang.String)`；参数值含逗号、引号、括号可正确解析；值内的空白原样保留（只去掉参数分隔符自身的一个空格）
- SQL 字符串字面量、双引号/反引号标识符与注释里的 `?` 不参与回填；消息标记只在行首或真实日志前缀后的第一个箭头（`==>`/`<==`）之后识别，参数值里出现 `==> Preparing:` 之类的字样不会被误判
- 参数块以已有类型锚点、裸 `null` 和当前方言的 SQL 占位符数量判断是否收齐；完整参数或 `Total` 后的普通应用日志不再追加。未收齐的多行值保留空行、空白、` - ` 和正文内的 `==>`/`<==`；真实日志前缀及 `Row:`/`Columns:` 会终止采集，未收齐时告警提示核对；无边界的手工裸值输入仍兼容
- `<== Total` 优先关联同线程、同 mapper 未取 Total 的语句，再按线程匹配；仅无线程日志回退当前语句，同线程不同 mapper 的嵌套查询行数仍各自保留，未知线程不借用其他线程的同 mapper 语句
- 「MySQL 反斜杠转义」开关默认关闭：关闭时使用 `generic` 标准单引号双写（`''`）；开启时复用 `mysql` 规则，额外把参数值里的反斜杠双写，避免 `\'` 逃逸闭合引号或 `\t` 之类的转义改写值。`convert` 命令仍兼容 `generic` / `mysql`；不增加其他数据库选项，不翻译 SQL 或日期内容
- 多线程日志交错时，`Parameters:` 的 mapper 匹配也必须同线程（日志前缀里的 `[http-nio-…]` 等），未知线程不跨线程配对；同一语句收到多条参数行时保留第一条并告警，第一条为空参数也算已收到，绝不静默覆盖
- 提取 mapper 方法名、时间戳（仅行首，不会误取 SQL 日期字面量）、TRACEID、`<== Total` 行数；参数与占位符数量不匹配时告警（值内含「逗号+空格」的误切会自动合并恢复，真实错位保持告警提示人工核对）

## 使用面

| 使用面 | 入口 |
|---|---|
| 工作区标签页（唯一界面入口） | 标题栏 AI 后方的 Log2SQL 插件入口打开 `workbench` 标签页；重复点击聚焦已有标签页，保留日志输入，粘贴即转换、一键复制；语言与主题始终跟随 GoNavi，仅保存 MySQL 反斜杠转义开关 |
| Agent 工具 | 声明 `ai.tools`，`convert` 命令进入 Agent 工具目录，可在 AI 对话中直接转换 |
| CLI | `gonavi plugin invoke --args '{"log":"..."}' gh-autumnnazi.log2sql convert` |

`contributes.pages` 只提供页面内容，标题栏入口必须由 `contributes.navigation`（`location: "tools"`，v1 唯一取值）
单独声明：宿主自 `4a357e453`「顶栏只显示插件显式声明的导航入口」起不再按 `pages` / `window` 推断，
`0.1.2`–`0.1.4` 删掉 navigation 后顶栏按钮随之消失，本构建已补回指向 `workbench` 的 `location: "tools"` 入口。
不声明 `panels`，不声明 `window`，包内没有 `ui/window.html` 或其他 HTML 文件；界面仅内联到页面 `html.source`。
插件详情中的 `convert` 命令执行框仍需输入 `{"log":"..."}` 形式的 JSON。

包内透明图标 `icons/log2sql.png`（256×256 PNG，深浅主题通用蓝色）同时供插件卡片与顶栏按钮使用：宿主自
`b42aea971` / `6c6694263` 起顶栏按钮显示各插件自己的栅格图标——只读取 manifest `icon` 指向的包内栅格文件，
按内容嗅探判定 mime（png / jpeg / webp / gif，禁 SVG），路径须为包内相对路径且不超过 256 字节；
字节上限自 `36260ba77` 起由 64 KiB 放宽到 5 MiB，读取上限同步提到 8 MiB（`internal/plugin/manager_assets.go`）。
缺失、超限或浏览器解码失败时回退宿主默认图标。转换、设置和页面权限保持不变。

`0.1.5` 本次仅发布 GitHub Release，不登记插件市场；本次补回被 `0.1.2` 删掉的 `contributes.navigation`（顶栏入口恢复），并把图标上限（5 MiB）、说明长度（160 字节）与校验基线对齐宿主现行契约。发布候选须通过五个平台原生测试、安装包结构与摘要检查，以及固定宿主源码 `5d4402903ce1f5635949c17a9341e4bf1e5a8d70`（2026-10-31 的 dev，含图标上限放宽与单一图标校验实现）的真实目录/ZIP 隔离安装和图标读取校验。此宿主校验不等同于市场上架校验；独立市场契约未同步顶层 `icon` 时，不宣称通过市场上架校验。

## GoNavi 兼容版本与入口

- 本版本最低宿主版本为 **GoNavi 1.2.0**（manifest `minHostVersion: "1.2.0"`），对齐当前开发版本。
  **标题栏 AI 后方的插件入口（`contributes.navigation` + `location: "tools"`）、页面设置桥与实时偏好同步必须使用包含本次宿主改动的开发/后续构建**；
  仅有版本号 `1.2.0` 不代表构建已包含这些功能，不预告尚未发布的宿主版本。
- [官方 v1.1.5](https://github.com/Syngnat/GoNavi/releases/tag/v1.1.5) 的
  [PluginCommandsPanel](https://github.com/Syngnat/GoNavi/blob/v1.1.5/frontend/src/components/pluginManager/PluginCommandsPanel.tsx#L24)
  缺少本次安全页面 `plugin.invoke` 与 navigation 驱动的 AI 后方插件入口；本版本不使用旧版独立窗口能力；
  **不能宣称官方 v1.1.5 支持本版本完整页面保存设置**，已发布 `v0.1.0` / `v0.1.1` 资产不变。
- 不要求先选中数据库；插件安装、启用并进入 running 且清单声明了 navigation 后显示入口，未安装/卸载后不显示，
  无插件且网络失败也不会生成占位。安全模式或插件管理禁用时入口不可用；
  桌面与 Web 模式均仅使用可用标签页。Agent / CLI 仍受宿主插件启用与权限策略约束。

## 设置持久化

标签页通过宿主桥接调用 `getSettings` / `saveSettings`，把转义偏好原子写入
`GONAVI_PLUGIN_DATA/settings.json`（宿主注入的插件数据目录，`remove --purge` 才删除）：

```json
{ "language": "auto", "theme": "auto", "dialect": "generic" }
```

`language` / `theme` 保留兼容字段，但后端读写始终归一为 `auto`，旧手选偏好不能覆盖宿主；
`dialect` 仍仅保存 `generic` / `mysql`，加载已有 `mysql` 时开关为开启。页面不提供语言或主题选择控件。
本机浏览器预览没有宿主桥接，语言与主题跟随系统，开关仅在当前预览中调整、不持久化；
正式标签页通过 `window.gonavi.call('plugin.invoke', {command, arguments})`，
页面桥仅执行本插件清单声明的命令，由宿主绑定插件 ID/generation，
不绕过只读策略或请求通用网络、存储、Wails 反射能力。拒绝/未知能力、无效响应或超时会显示本地化
失败提示；保存必须返回 `saved: true`，10 秒超时不自动重试可能已落盘的写入。

初始化只读取并应用 `dialect`，不重设语言或主题；读取期间切换开关会等读取完成后合并保存一次，
延后的旧设置读取不能覆盖用户新选择。每次写入均为 `{language: 'auto', theme: 'auto', dialect}`；
读取失败时解除待保存状态，不会永久挂起。

## i18n 与主题（对齐 GoNavi 宿主）

宿主在标签页脚本执行前安全注入 `window.gonaviHostPrefs = {locale, theme, palette?}`
（六语言、light/dark 与可选的已解析非敏感颜色）；变化后在 frame 内触发 `gonavi:host-preferences`。
界面始终跟随初始与实时宿主偏好，不提供手选控件，旧设置不覆盖宿主；偏好变化不重建输入或已有结果节点。
本机预览无桥时回退系统偏好：

- **语言**：支持 GoNavi 全部六语言（`zh-CN / zh-TW / en-US / ja-JP / de-DE / ru-RU`，同
  `shared/i18n/locales.ts`），优先宿主 locale，无宿主偏好时按系统语言归一探测，未命中回退宿主默认 `zh-CN`
- **主题**：优先宿主 theme 与 palette，支持初始和实时自定义配色（包括 light → light 变色）；
  palette 仅接收 `bg / panel / input / code / text / muted / border / border1 / accent / accentSoft / ok / warn / warnBg / chip / hover`，
  映射到对应固定 CSS 变量（`border1 / accentSoft / warnBg` 对应 `--border-1 / --accent-soft / --warn-bg`）。
  页面再次白名单净化：每色不超过 128 字符，须为浏览器可解析的 hex、rgb(a)、hsl(a) 或安全现代颜色字面量；
  拒绝 CSS 引用、URL、声明、HTML、反斜杠及未知键，不接收原始自定义 CSS。缺失或非法颜色会清除旧 inline 覆盖，
  使用原 GoNavi v2 浅/深色默认值；无 palette 的旧桥仍兼容，无宿主 theme 时跟随系统 `prefers-color-scheme`。
  安全 appearance 可同步界面/代码字体列表（不超过 512 字符）、字号（8–48 px）、圆角（0–32 px）；
  非法或缺失字段清除覆盖，沿用原字体、字号与圆角，不复制任意 CSS 选择器、布局或字体资源。
  窗口 opacity（0.1–1）仅用于缺少 palette 的面层回退，实际 palette 颜色已包含宿主计算的 alpha，
  不会再次相乘，也不会把文字整体变透明。背景启用时页面 body 透明，复用父工作区已绘制背景；
  输入、卡片和代码面使用受控 tint（0.7–0.95）一次遮罩保证可读性，背景关闭或偏好缺失即恢复回退。
  换图、偏移与开关由宿主背景绘制实时更新，不向页面传图片路径、URL 或 base64，
  不请求额外网络、存储或样式权限，不持久化宿主 appearance。
- **已知限制**：引擎告警文案（参数/占位符不匹配等）当前为中文；界面文案 i18n 不改写 SQL 或日期

## 架构：一个包，双引擎，单语料

```
gonavi.plugin.json ── 仅 workbench 内联页面与三个后端命令（最终清单 ≤256 KiB）
│                        页面 HTML ≤256 KiB，内联 JS 引擎与安全桥接适配
│                        设置读写走宿主声明命令（GONAVI_PLUGIN_DATA/settings.json）
├── bin/<os>-<arch>/plugin(.exe)  各平台 Go 后端：stdio JSON-RPC
└── LICENSE / THIRD_PARTY_NOTICES  项目与第三方许可

testdata/cases.json       共享测试向量（单一事实源）
                          Go（internal/convert_test.go）与 JS（ui/engine.test.mjs）
                          跑同一份数据，双端行为一致性由测试保证
```

Go 后端与前端 JS 引擎逐层同构（splitLog / parseParameters / fillSQL / renderValue），
转换逻辑是纯函数、无副作用（`effect: "read"`）。

## 开发

环境：Go 1.26.1+、Node 20+。`go.mod` 固定远程 GoNavi SDK
`v0.0.0-20261027030648-790efd9e0780`（上游 commit `790efd9e07804cac6823851c7a8c4338f2b3fc8c`，
SDK 自身要求 Go 1.22）；`go.sum` 验证下载内容，不依赖本机绝对路径或 `replace`。

```sh
# 测试（双端同一份向量 + 打包安全回归）
go test ./... -count=1
go vet ./...
node --test ui/*.test.mjs tools/*.test.mjs

# 本机组包：无参输出全新 pkg/<timestamp>-<uuid>/，不覆盖旧 pkg 内容
node tools/build.mjs

# 明确输出必须是不存在的路径；编译后端 + 内联共享资源 + 根清单/许可
node tools/build.mjs --out build/local-new --archive build/log2sql-local-new.zip

# 静态校验可选，需要上游 GoNavi 检出；CLI 编译失败直接报告依赖错误
# 每次 CLI/check root 都放在全新 build/check-<uuid>/，不修改主应用
node tools/build.mjs --out build/check-package-new --check --gonavi <GoNavi检出目录>

# 本机 UI 预览：浏览器直接打开（无需安装进 GoNavi；已有预览文件不覆盖）
#   build/panel.preview.html

# 兼容原单平台参数（CI matrix 在对应原生 runner 测试二进制）
node tools/build.mjs --out build/ci/linux-arm64 --goos linux --goarch arm64

# CI 合包：只复制对应 runner 已测二进制，不再交叉编译后端
# 输入：<merged-artifact-root>/bin/<os>-<arch>/plugin[.exe]
node tools/build.mjs --out <fresh> --platforms windows/amd64,linux/amd64,linux/arm64,darwin/amd64,darwin/arm64 --binaries <merged-artifact-root> --archive <zip>
# <zip> 必须是尚不存在、位于成品目录外的 .zip 路径
```

成品仅使用 `backend.platforms`，各平台路径隔离为 `bin/<os>-<arch>/plugin[.exe]`；
共享清单（含唯一 workbench 内联 HTML）每次合包生成一次，不写出包内 HTML 文件。ZIP 使用 Go 标准库、固定时间与权限、排序 entry，
同一二进制输入可重复生成字节一致归档；压缩大小超过 64 MiB 会失败。归档只包含根清单、
`LICENSE`、`THIRD_PARTY_NOTICES` 和声明的二进制，不包含 HTML 文件、Git、缓存或本地设置。

安装到 GoNavi（桌面：设置 → 插件 → 本地安装选择脚本输出目录或 ZIP；或 CLI）：

```sh
gonavi plugin --root <插件根> inspect <成品目录或ZIP>       # 取 digest
gonavi plugin --root <插件根> install --digest <digest> --trust <成品目录或ZIP>
gonavi plugin --root <插件根> enable gh-autumnnazi.log2sql
```

## 已验证 / 未验证

- 核心 Go/Node 双端 73 组共享向量已审查通过；早期本机包曾验证 `plugin check` `valid:true`；
  独立 root 下 install/replace/enable/invoke 端到端真跑——含「值内逗号+空格」
  合并恢复、mysql 方言 `\'` 字面量保留、getSettings/saveSettings 读写往返
  （settings.json 真实落盘插件数据目录）
- 后端 stdio smoke 仅验证初始化、诊断、转换、`auto/auto/mysql` 设置落盘与关闭，不验证页面 UI。
- 未验证：标签页的宿主实际渲染、剪贴板行为、开关持久化交互与 AI 后方插件入口的原生全平台行为（宿主侧只验证到「安装成功 + 图标可回读为栅格 data URL」，未点开界面）；
  Agent 对话中的工具调用路径。本机测试不替代五个平台对应的原生 CI 测试。
- `0.1.5` 已作为**最新稳定版**发布（<https://github.com/AutumnNazi/gonavi-log2sql/releases/tag/v0.1.5>）：
  五个平台原生测试与 stdio smoke 全部通过，候选 ZIP 的结构、导航/图标/说明断言与五平台二进制摘要一致性检查通过；
  固定宿主源码 `5d4402903ce1f5635949c17a9341e4bf1e5a8d70` 的隔离安装与图标回读校验通过；CI run `41196602895` 结论为 success。
  本次仅发布 GitHub Release，未登记插件市场，不宣称通过市场上架校验。
  发布资产 SHA-256 `181dc61696460fe89daab53e893075f68bd5217a6a4905545b84814b5b806e17`（11,437,419 字节）；`0.1.2`–`0.1.4` 缺失的 `contributes.navigation` 已补回，顶栏入口恢复。
- `0.1.4` 已发布（<https://github.com/AutumnNazi/gonavi-log2sql/releases/tag/v0.1.4>）：
  五个平台原生测试和 stdio smoke 全部通过，候选 ZIP 的结构、图标与二进制摘要一致性检查通过；
  CI run `41015509740` 的最终结论为 failure，仅固定旧市场校验步骤报 `unknown manifest field "icon"`。
  本次仅发布 GitHub Release，未登记插件市场，不宣称通过市场上架校验。
  发布资产 SHA-256 `c599b076e24cf4b18d8fd0f071a7e781bb7052d5091dee7aeb1e4cf63e232d08`（11,437,343 字节），包内包含深浅主题通用蓝色透明图标。
  已发布 `v0.1.0` / `v0.1.1` / `v0.1.2` / `v0.1.3` 资产不覆盖。
- `0.1.3` 已发布（<https://github.com/AutumnNazi/gonavi-log2sql/releases/tag/v0.1.3>）：
  五个平台对应原生 CI 全部通过，单个合并 ZIP 通过固定源码
  commit `790efd9e07804cac6823851c7a8c4338f2b3fc8c` 的市场 `market.ValidatePackage`，
  发布资产 SHA-256 `b14251e8872a18ffb92ed11269dc96f4fe9283394fe38b4a41da3f7b11c3a040`（11,428,652 字节）。
  本次把入口说明同步为「标题栏 AI 后方」；已发布 `v0.1.0` / `v0.1.1` / `v0.1.2` 资产不覆盖；本次未更新插件市场登记。
- `0.1.2` 已发布（<https://github.com/AutumnNazi/gonavi-log2sql/releases/tag/v0.1.2>）：
  五个平台对应原生 CI 全部通过，单个合并 ZIP 通过固定源码
  commit `790efd9e07804cac6823851c7a8c4338f2b3fc8c` 的市场 `market.ValidatePackage`，
  发布资产 SHA-256 `f91c32ccda7192468cc826ce88ac153017b677b1336a349f96f0576dbb9408e6`（11,428,636 字节）。
  已发布 `v0.1.0` / `v0.1.1` 资产不覆盖；本次未更新插件市场登记，宿主 CLI `valid:true` 不替代市场校验。

## 目录

```
main.go                  后端入口：注册 convert 命令
internal/                Go 引擎：splitter / params / filler / render / convert
testdata/cases.json      共享测试向量（改行为先改这里，双端同步红）
ui/engine.js             前端引擎（ESM，构建时剥导出行内联进页面）
ui/app.js                标签页交互（粘贴/防抖/卡片/复制降级链）
ui/panel.html            标签页骨架（样式 + 注入占位，不作为包内 HTML 入口）
ui/build-embed.mjs       页面内联组装 + HTML/清单各 256 KiB 校验
tools/manifest.template.json  清单模板
tools/build.mjs          安全单/多平台构建（--binaries 合包，--archive ZIP，--check 可选）
tools/build.test.mjs     打包 CLI 红绿与旧产物保护测试
tools/archive/main.go    Go 标准库确定性 ZIP（64 MiB 压缩上限）
```
