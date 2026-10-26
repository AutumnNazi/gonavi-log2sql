# gonavi-log2sql

GoNavi 插件：把 MyBatis / MyBatis-Plus 的 `Preparing:` / `Parameters:` DEBUG 日志
还原成可直接执行的 SQL。

- 插件 ID：`autumnnazi.log2sql`
- 权限：`ui.html-panel`（沙箱面板）、`ai.tools`（Agent 工具）、`host.log`（启动诊断）
- 许可：Apache-2.0

## 功能

- 粘贴整行日志（时间戳/线程/级别/logger 前缀）或仅 `Preparing:` / `Parameters:` 部分，一次可贴多条语句
- 参数回填 `?` 占位符：数字/布尔裸值，字符串/日期时间加单引号（内部 `'` 转义为 `''`），`null` 输出 `NULL`
- 兼容短类名 `(String)` 与全类名 `(java.lang.String)`；参数值含逗号、引号、括号可正确解析
- SQL 字符串字面量、双引号/反引号标识符与注释里的 `?` 不参与回填
- 两种方言：`generic`（默认，标准 `''` 转义）与 `mysql`（额外支持字符串字面量 `\'` 反斜杠转义），面板与 convert 命令均可指定
- 提取 mapper 方法名、时间戳（仅行首，不会误取 SQL 日期字面量）、TRACEID、`<== Total` 行数；参数与占位符数量不匹配时告警（值内含「逗号+空格」的误切会自动合并恢复，真实错位保持告警提示人工核对）

## 使用面

| 使用面 | 入口 |
|---|---|
| 内嵌面板 | GoNavi 设置中心 → 插件 → log2sql 详情 → "MyBatis 日志转 SQL" 标签页；粘贴即转换，一键复制 |
| 独立窗口 | 插件详情页「打开窗口」按钮（manifest `window.entry`）；可常驻桌面，**语言/主题/方言设置持久化** |
| Agent 工具 | 声明 `ai.tools`，`convert` 命令进入 Agent 工具目录，可在 AI 对话中直接转换 |
| CLI | `gonavi plugin invoke --args '{"log":"..."}' autumnnazi.log2sql convert` |

## 设置持久化

独立窗口通过宿主桥接调用 `getSettings` / `saveSettings`，把偏好原子写入
`GONAVI_PLUGIN_DATA/settings.json`（宿主注入的插件数据目录，`remove --purge` 才删除）：

```json
{ "language": "auto", "theme": "auto", "dialect": "generic" }
```

内嵌 html 面板没有宿主桥接（沙箱 iframe 无存储、无网络、无桥接），设置只能使用默认值——
这是宿主能力边界，不是配置缺失。

## i18n 与主题（对齐 GoNavi 宿主）

宿主没有给 html-panel 留任何运行时桥接（无 postMessage、无法读取宿主设置），界面按下述方式对齐宿主：

- **语言**：支持 GoNavi 全部六语言（`zh-CN / zh-TW / en-US / ja-JP / de-DE / ru-RU`，同
  `shared/i18n/locales.ts`），默认按系统语言归一探测，未命中回退宿主默认 `zh-CN`；右上角可手动切换
  （独立窗口中该选择会持久化）
- **主题**：浅/深两套配色与字体的取值静态对齐 GoNavi v2 主题
  （`frontend/src/styles/v2Theme/v2-theme-01-gonavi-v2.css` 的 `--gn-*` 变量），默认跟随系统
  `prefers-color-scheme`，右上角可三态切换（跟随系统/浅色/深色）
- **已知限制**：manifest 的面板标题是静态单语言（宿主清单无本地化机制）；引擎告警文案
  （参数/占位符不匹配等）当前为中文——界面文案已全部 i18n
- 若上游未来给 html-panel 增加宿主主题/语言通道，此处可无缝切换为跟随宿主设置

## 架构：一个包，双引擎，单语料

```
gonavi.plugin.json ── manifest（清单内联 HTML 面板，≤256 KiB）
├── bin/plugin(.exe)      Go 后端：convert + getSettings/saveSettings，stdio JSON-RPC
├── panels[].html.source  内嵌沙箱面板：内联 JS 引擎（无宿主桥接），粘贴→转换→复制
└── ui/window.html        独立窗口入口：同一份内联文档 + 宿主 window.gonaviPlugin 桥接，
                          负责设置读写（GONAVI_PLUGIN_DATA/settings.json）

testdata/cases.json       共享测试向量（单一事实源）
                          Go（internal/convert_test.go）与 JS（ui/engine.test.mjs）
                          跑同一份数据，双端行为一致性由测试保证
```

Go 后端与前端 JS 引擎逐层同构（splitLog / parseParameters / fillSQL / renderValue），
转换逻辑是纯函数、无副作用（`effect: "read"`）。

## 开发

环境：Go 1.22+、Node 20+；`go.mod` 的 replace 指向本地 GoNavi 检出（`E:/code/GoNavi/sdk/go`，
按需修改）。

```sh
# 测试（双端同一份向量）
go test ./internal/ -count=1
node --test ui/engine.test.mjs

# 组包到 pkg/（编译后端 + 内联面板 + 生成清单）
node tools/build.mjs

# 组包并用上游 CLI 静态校验（首次会构建 gonavi CLI 到 build/，已存在则跳过）
node tools/build.mjs --check

# 面板 UI 预览：浏览器直接打开（无需安装进 GoNavi）
#   build/panel.preview.html

# 交叉编译示例
node tools/build.mjs --goos linux --goarch arm64
```

安装到 GoNavi（桌面：设置 → 插件 → 本地安装选择 `pkg/`；或 CLI）：

```sh
gonavi plugin --root <插件根> inspect pkg       # 取 digest
gonavi plugin --root <插件根> install --digest <digest> --trust pkg
gonavi plugin --root <插件根> enable autumnnazi.log2sql
```

## 已验证 / 未验证

- 已实测：Go/Node 双端 34 组共享向量全绿；`plugin check` `valid:true`；
  独立 root 下 install/replace/enable/invoke 端到端真跑——含「值内逗号+空格」
  合并恢复、mysql 方言 `\'` 字面量保留、getSettings/saveSettings 读写往返
  （settings.json 真实落盘插件数据目录）
- 未验证：桌面 Wails 窗口内 HTML 面板的实际渲染、剪贴板行为、独立窗口渲染与
  设置持久化的桌面交互（上游文档自述该能力仍需平台验收）；Agent 对话中的
  工具调用路径；Linux/macOS 构建

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
tools/build.mjs          构建编排（--check 附带 CLI 校验）
```
