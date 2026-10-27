# gonavi-log2sql

GoNavi 插件：把 MyBatis / MyBatis-Plus 的 `Preparing:` / `Parameters:` DEBUG 日志
还原成可直接执行的 SQL。

- 插件 ID：`gh-autumnnazi.log2sql`
- 权限：`ui.html-panel`（HTML 沙箱页面）、`ui.pages`（工作台页面导航）、`ai.tools`（Agent 工具）、`host.log`（启动诊断）
- 市场首发修正版：`0.1.1`；已公开的 `v0.1.0` 不覆盖；公开仓库：<https://github.com/AutumnNazi/gonavi-log2sql>
- 许可：Apache-2.0（完整正文见 `LICENSE`，SDK 归属与 Go 标准库许可见 `THIRD_PARTY_NOTICES`）

## 功能

- 粘贴整行日志（时间戳/线程/级别/logger 前缀）或仅 `Preparing:` / `Parameters:` 部分，一次可贴多条语句
- 参数回填 `?` 占位符：数字/布尔裸值，字符串/日期时间加单引号（内部 `'` 转义为 `''`），裸 `null` 输出 `NULL`（`null(String)` 是字面字符串，保留为 `'null'`）
- 兼容短类名 `(String)` 与全类名 `(java.lang.String)`；参数值含逗号、引号、括号可正确解析；值内的空白原样保留（只去掉参数分隔符自身的一个空格）
- SQL 字符串字面量、双引号/反引号标识符与注释里的 `?` 不参与回填；消息标记只在行首或真实日志前缀后的第一个箭头（`==>`/`<==`）之后识别，参数值里出现 `==> Preparing:` 之类的字样不会被误判
- 参数块以已有类型锚点、裸 `null` 和当前方言的 SQL 占位符数量判断是否收齐；完整参数或 `Total` 后的普通应用日志不再追加。未收齐的多行值保留空行、空白、` - ` 和正文内的 `==>`/`<==`；真实日志前缀及 `Row:`/`Columns:` 会终止采集，未收齐时告警提示核对；无边界的手工裸值输入仍兼容
- `<== Total` 优先关联同线程、同 mapper 未取 Total 的语句，再按线程匹配；仅无线程日志回退当前语句，同线程不同 mapper 的嵌套查询行数仍各自保留，未知线程不借用其他线程的同 mapper 语句
- 两种方言：`generic`（默认，标准 `''` 转义）与 `mysql`（额外把参数值里的反斜杠双写，避免 `\'` 逃逸闭合引号或 `\t` 之类的转义改写值），面板与 convert 命令均可指定
- 多线程日志交错时，`Parameters:` 的 mapper 匹配也必须同线程（日志前缀里的 `[http-nio-…]` 等），未知线程不跨线程配对；同一语句收到多条参数行时保留第一条并告警，第一条为空参数也算已收到，绝不静默覆盖
- 提取 mapper 方法名、时间戳（仅行首，不会误取 SQL 日期字面量）、TRACEID、`<== Total` 行数；参数与占位符数量不匹配时告警（值内含「逗号+空格」的误切会自动合并恢复，真实错位保持告警提示人工核对）

## 使用面

| 使用面 | 入口 |
|---|---|
| 工作台页面 | GoNavi 标题栏「插件页面」菜单 →「MyBatis 日志转 SQL」；在工作台标签页打开，粘贴即转换，一键复制 |
| 独立窗口 | 插件详情页「打开窗口」按钮（manifest `window.entry`）；可常驻桌面，**语言/主题/方言设置持久化** |
| Agent 工具 | 声明 `ai.tools`，`convert` 命令进入 Agent 工具目录，可在 AI 对话中直接转换 |
| CLI | `gonavi plugin invoke --args '{"log":"..."}' gh-autumnnazi.log2sql convert` |

`0.1.1` 不再提供插件详情中的 HTML 面板；人工转换请使用工作台页面或独立窗口，
插件详情中的 `convert` 命令执行框仍需输入 `{"log":"..."}` 形式的 JSON。

## 设置持久化

独立窗口通过宿主桥接调用 `getSettings` / `saveSettings`，把偏好原子写入
`GONAVI_PLUGIN_DATA/settings.json`（宿主注入的插件数据目录，`remove --purge` 才删除）：

```json
{ "language": "auto", "theme": "auto", "dialect": "generic" }
```

工作台 HTML 页面没有宿主桥接（沙箱 iframe 无存储、无网络、无桥接），
语言/主题/方言可在当前页面手动调整，但关闭后不持久化；需保存偏好时请使用独立窗口。

初始化读取期间的改动按字段合并：只改主题不会把尚未读回的语言/方言默认值写掉，读取完成后
合并保存一次；读取失败时解除待保存状态，不会永久挂起。

## i18n 与主题（对齐 GoNavi 宿主）

工作台 HTML 页面的沙箱没有运行时桥接（无 postMessage、无法读取宿主设置），界面按下述方式对齐宿主：

- **语言**：支持 GoNavi 全部六语言（`zh-CN / zh-TW / en-US / ja-JP / de-DE / ru-RU`，同
  `shared/i18n/locales.ts`），默认按系统语言归一探测，未命中回退宿主默认 `zh-CN`；右上角可手动切换
  （独立窗口中该选择会持久化）
- **主题**：浅/深两套配色与字体的取值静态对齐 GoNavi v2 主题
  （`frontend/src/styles/v2Theme/v2-theme-01-gonavi-v2.css` 的 `--gn-*` 变量），默认跟随系统
  `prefers-color-scheme`，右上角可三态切换（跟随系统/浅色/深色）
- **已知限制**：manifest 的页面标题是静态单语言（宿主清单无本地化机制）；引擎告警文案
  （参数/占位符不匹配等）当前为中文——界面文案已全部 i18n
- 若上游未来给 HTML 页面增加宿主主题/语言通道，此处可切换为跟随宿主设置

## 架构：一个包，双引擎，单语料

```
gonavi.plugin.json ── manifest（清单内联 HTML 页面，≤256 KiB）
├── bin/<os>-<arch>/plugin(.exe)  各平台 Go 后端：stdio JSON-RPC
├── LICENSE / THIRD_PARTY_NOTICES  项目与第三方许可
├── contributes.pages[].html.source  工作台沙箱页面：内联 JS 引擎（无宿主桥接），粘贴→转换→复制
└── ui/window.html        独立窗口入口：同一份内联文档 + 宿主 window.gonaviPlugin 桥接，
                          负责设置读写（GONAVI_PLUGIN_DATA/settings.json）

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
node --test ui/*.test.mjs tools/build.test.mjs

# 本机组包：无参输出全新 pkg/<timestamp>-<uuid>/，不覆盖旧 pkg 内容
node tools/build.mjs

# 明确输出必须是不存在的路径；编译后端 + 内联共享资源 + 根清单/许可
node tools/build.mjs --out build/local-new --archive build/log2sql-local-new.zip

# 静态校验可选，需要上游 GoNavi 检出；CLI 编译失败直接报告依赖错误
# 每次 CLI/check root 都放在全新 build/check-<uuid>/，不修改主应用
node tools/build.mjs --out build/check-package-new --check --gonavi <GoNavi检出目录>

# 面板 UI 预览：浏览器直接打开（无需安装进 GoNavi）
#   build/panel.preview.html

# 兼容原单平台参数（CI matrix 在对应原生 runner 测试二进制）
node tools/build.mjs --out build/ci/linux-arm64 --goos linux --goarch arm64

# CI 合包：只复制对应 runner 已测二进制，不再交叉编译后端
# 输入：<merged-artifact-root>/bin/<os>-<arch>/plugin[.exe]
node tools/build.mjs --out <fresh> --platforms windows/amd64,linux/amd64,linux/arm64,darwin/amd64,darwin/arm64 --binaries <merged-artifact-root> --archive <zip>
# <zip> 必须是尚不存在、位于成品目录外的 .zip 路径
```

成品仅使用 `backend.platforms`，各平台路径隔离为 `bin/<os>-<arch>/plugin[.exe]`；
共享清单与 `ui/window.html` 每次合包生成一次。ZIP 使用 Go 标准库、固定时间与权限、排序 entry，
同一二进制输入可重复生成字节一致归档；压缩大小超过 64 MiB 会失败。归档只包含根清单、
`LICENSE`、`THIRD_PARTY_NOTICES`、窗口入口和声明的二进制，不包含 Git、缓存或本地设置。

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
- 未验证：桌面工作台 HTML 页面的实际渲染、剪贴板行为、独立窗口渲染与
  设置持久化的桌面交互（上游文档自述该能力仍需平台验收）；Agent 对话中的
  工具调用路径。市场修正版需五个平台对应原生 CI 测试通过，且合并 ZIP 通过固定源码
  commit `790efd9e07804cac6823851c7a8c4338f2b3fc8c` 的市场 `market.ValidatePackage`，
  才创建稳定 `v0.1.1` Release，且只附带一个合并 ZIP；宿主 CLI `valid:true` 不替代市场校验，
  网站最终确认由发布者操作。

## 目录

```
main.go                  后端入口：注册 convert 命令
internal/                Go 引擎：splitter / params / filler / render / convert
testdata/cases.json      共享测试向量（改行为先改这里，双端同步红）
ui/engine.js             前端引擎（ESM，构建时剥导出行内联进面板）
ui/app.js                面板交互（粘贴/防抖/卡片/复制降级链）
ui/panel.html            面板骨架（样式 + 注入占位）
ui/build-embed.mjs       面板组装 + 256 KiB 校验 + 清单生成
tools/manifest.template.json  清单模板
tools/build.mjs          安全单/多平台构建（--binaries 合包，--archive ZIP，--check 可选）
tools/build.test.mjs     打包 CLI 红绿与旧产物保护测试
tools/archive/main.go    Go 标准库确定性 ZIP（64 MiB 压缩上限）
```
