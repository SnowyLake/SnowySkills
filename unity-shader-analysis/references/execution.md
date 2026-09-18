# 执行与环境

## 目录

- [能力检查](#能力检查)
- [发现与编译](#发现与编译)
- [源码证据与工作簿](#源码证据与工作簿)
- [维护验证](#维护验证)

## 能力检查

以下路径相对于本技能目录. 从其他工作目录调用时使用脚本绝对路径, 输出放在可写会话目录. Unity Editor 必须打开目标项目, uloop 必须连接该 Editor.

`analyze-shader.ps1` 的 Preflight 分两阶段, Discover 和 Analyze 也会执行相同检查:

1. 通过 `Get-Command malioc` 发现 MaliOC, 查找已安装的 `uloop` / `uloop-cli`, 或用 `npm cache ls` 检查本地缓存 `uloop-cli@2.2.0`. 此阶段不调用 Unity bridge; 任一能力缺失则停止.
2. 能力齐备后执行 `malioc --version`, 并通过 uloop 读取 `Application.unityVersion`. 已安装命令直接执行; 缓存路径使用 `npx --no-install uloop-cli@2.2.0`. 检查失败则不扫描资产或编译.

```powershell
& ./scripts/analyze-shader.ps1 -Mode Preflight
```

不要使用 `npx --yes`、在线下载或安装补齐环境. 打包脚本只实现 uloop 执行路径; 其他 Unity MCP/CLI 不能直接替换命令, 需有覆盖同等 Editor API 操作的适配实现. 工具缺失时报告具体前提.

## 发现与编译

按输入选择一条 Discover 命令, 示例资产名替换为实际项目路径:

```powershell
& ./scripts/analyze-shader.ps1 -Mode Discover -Scope Explicit -MaterialPath 'Assets/Example.mat' -OutputPath discovery.json
& ./scripts/analyze-shader.ps1 -Mode Discover -Scope Scene -ScenePath 'Assets/Scenes/Example.unity' -OutputPath discovery.json
& ./scripts/analyze-shader.ps1 -Mode Discover -Scope Directory -Directory 'Assets/Materials' -OutputPath discovery.json
& ./scripts/analyze-shader.ps1 -Mode Discover -Scope Synthetic -ShaderName 'Example/Lit' -OutputPath discovery.json
```

多 Shader 请求用 `-ShaderName` 限定各组. 使用 Discover 返回的真实 `groupId` 准备 [selections](keyword-selections.md), 不从示例猜测 GUID 或 pragma 序号. 同样的范围和 selections 用于复查与分析:

```powershell
& ./scripts/analyze-shader.ps1 -Mode Discover -Scope Synthetic -ShaderName 'Example/Lit' -SelectionsPath selections.json -OutputPath discovery.json
& ./scripts/analyze-shader.ps1 -Mode Analyze -Scope Synthetic -ShaderName 'Example/Lit' -SelectionsPath selections.json -OutputPath analysis.json
```

默认 `BuildTarget = Android`, `CompilerPlatform = GLES3x`, `MaliCore = Mali-G78`, `SubShader = 0`, `PassName = ForwardLit`; 对应同名参数可指定目标条件. 完整链路仅支持 `GLES3x`, 其他平台报错而不回退. 编译使用 `pass.CompileVariant(shaderType, keywords, ShaderCompilerPlatform.GLES3x, BuildTarget.Android)`, 不传 `GraphicsTier`. GLES3 输出拆分 VS/PS 后分别调用 MaliOC:

```powershell
malioc --vertex --opengles --core Mali-G78 --format json --detailed -
malioc --fragment --opengles --core Mali-G78 --format json --detailed -
```

这些 MaliOC 示例对应默认条件, 实际由脚本传入 Shader 源码与所选 Core. 保留所有 Unity ShaderMessage; MaliOC JSON schema 必须为 `performance`.

## 源码证据与工作簿

```powershell
node ./scripts/collect-code-evidence.mjs analysis.json code-evidence.json 'F:/ExampleUnityProject'
```

第三个参数为含 `Assets` 和 `Packages` 的 Unity 项目根目录. 省略时从当前目录和分析 JSON 所在目录的祖先查找, 同时支持其 `UnityProj` 子目录. 迁移到其他仓库后建议显式指定. 证据路径当前相对于 Unity 项目根目录的父目录, 回查源码时使用同一基准; 无法解析的 include 记录在 `unresolvedIncludes`.

源码审阅完成后按 [建议契约](code-recommendations-schema.md) 准备 JSON, 再生成工作簿:

```powershell
node ./scripts/build-workbook.mjs analysis.json malioc-analysis.xlsx previews recommendations.json
```

工作簿生成需可导入 `@oai/artifact-tool` 和 `jszip` 的 Node.js 环境. 若宿主提供依赖加载器, 使用其返回的实际路径; 若提供表格 Skill, 仅在生成工作簿时遵循其适用要求. 不假定所有宿主都存在 `spreadsheets:Spreadsheets` 或专用埋点脚本.

ESM 依赖从脚本所在目录解析. 若现有依赖只位于外部 `node_modules`, 将全部 `.mjs` 脚本复制到可写会话目录, 保留相邻的 `comparison-ranking.mjs`, 并在该目录创建指向实际 packages 路径的 `node_modules` junction (Windows) 或符号链接. 不只更改 cwd, 不把运行时依赖写入技能目录. 所需包不可用时报告, 不声称已生成工作簿.

## 维护验证

修改脚本后运行与改动相关的检查. 以下自测无需 Unity 或 MaliOC:

```powershell
& ./scripts/analyze-shader.ps1 -SelfTest
node ./scripts/collect-code-evidence.mjs --self-test
node ./scripts/test-recommendations.mjs
```

Preflight 是真实环境检查, 不代替离线自测. 实际交付还需核对 suggestions 与 comparisons、源码位置、工作簿关键范围及七张 Sheet 的可读性.
