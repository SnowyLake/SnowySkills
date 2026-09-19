---
name: grok-cli
description: 调用 Grok Build CLI 执行代码任务, 续接会话或通过 ACP 追加运行中要求. 用于 grokbuild 或 grok CLI 调用.
---

# grok-cli

## 目录

- [识别与认证](#识别与认证)
- [非交互任务](#非交互任务)
- [会话与控制](#会话与控制)
- [结果与恢复](#结果与恢复)
- [参考](#参考)

## 识别与认证

Grok Build 的入口是 `grok`, 产品名称 `grokbuild` 不代表有同名命令. 首次用 `--version` / `--help` 核实身份并保存绝对入口路径和版本. 同一任务复用结果, 仅在入口, 版本或环境变化时重查; 同名 `agent` 也可能属于其他产品.

```powershell
Get-Command grok, grokbuild, agent -All -ErrorAction SilentlyContinue
```

POSIX 使用 `command -v grok`. Windows 优先原生入口或已核实的 `.ps1`, `.cmd` 会有二次解析风险, 避免通过 `cmd /c` 传复杂 prompt. 缺失时按官方安装说明处理.

使用已有登录或 `XAI_API_KEY`, 需要登录时运行 `login --device-auth`; 密钥不进入 prompt 或日志. 按任务设置当前版本支持的 `--model` 与 `--reasoning-effort`.

## 非交互任务

单轮使用 `-p` / `--single <PROMPT>`, `--cwd` 指定绝对工作目录. prompt 包含目标, 修改范围与必要验证, CLI 读取工作区规则. 只读分析示例:

```powershell
$grokCli = (Get-Command grok -ErrorAction Stop).Source
$workspace = (Get-Location).Path
$prompt = 'Read the project rules and inspect the relevant code. Suggest the smallest fix without changing files.'
$cliArgs = @('-p', $prompt, '--cwd', $workspace, '--permission-mode', 'dontAsk', '--tools', 'read_file,grep,list_dir', '--deny', 'MCPTool(*)', '--output-format', 'json')
& $grokCli @cliArgs
$cliExitCode = $LASTEXITCODE
```

- `dontAsk` 只允许预先批准或内置只读能力, 未允许请求直接拒绝. `default` / `auto` 可能请求审批或拒绝调用. `plan` 只是兼容接受的权限值, 不保证只读.
- `--tools read_file,grep,list_dir` 限制内置工具, 但仍保留 MCP meta tools; 上例另用 `--deny 'MCPTool(*)'` 禁止 MCP. 工具权限不等于 `--sandbox` 的文件系统与网络隔离.
- 修改任务按授权调整工具与可重复的 `--allow` / `--deny`. 规则为 `ToolPrefix(glob)`, 如 `Edit(src/**)`, `Write(src/**)`, `Bash(npm run test)`, deny 优先. 不为避开拒绝而自动改用 `acceptEdits` 或 `bypassPermissions`.

长 prompt 用 UTF-8 文件和 `--prompt-file <绝对路径>` 替代 `-p`. `--prompt-json` 需核对输入结构, 不假定支持 stdin prompt. 无 stdin 输入时关闭管道. `grok agent headless` 是 WebSocket relay, 普通单轮不用该入口.

## 会话与控制

保存 `sessionId`, 使用 `--resume <ID_OR_TITLE>` 续接并传新 prompt, 相同 `--cwd` 与所需参数. 明确 ID 可避免标题冲突; `sessions list` / `sessions search` 查找会话, `--continue` 选择当前目录的最近会话.

`--session-id` / `-s` 要求新的有效 UUID, 用于新建, 不能替代 resume. 需要中断恢复时预先生成并记录 ID, 流在中断前可能没有可恢复的顶层 ID. `--fork-session` 配合 resume 派生新 ID. `--restore-code` 会恢复仓库快照并改变文件, 不是普通续接所需选项.

持续会话, 运行中追加要求与取消见 [ACP 调用](references/acp.md). `-p` stdin 不是已验证的 steer 接口. ACP 入口为 `grok agent ... stdio`, 不保证与普通 CLI 会话跨入口互通.

## 结果与恢复

| 格式 | 解析与完成依据 |
| --- | --- |
| `json` | 结果字段 `text`, `sessionId`, `requestId`, `stopReason`, 结合退出码判断 |
| `streaming-json` | ACP NDJSON, 等待 `type: "end"` 的 `sessionId` / `stopReason`, 同时检查 error 事件 |
| `streaming-messages-json` | Anthropic wire NDJSON, 使用对应解析器 |
| `plain` | 适合直接阅读 |

失败可输出 `{ "type": "error", "message": "..." }` 并非零退出, 也可能没有合法 JSON. 断流缺少终结事件为结果不确定; 持续读取原进程的 stdout / stderr 至结束.

优先等待进程结束及终结结果. 需要进度时使用 `streaming-json`, 按已消费行数或字节位置读取新增完整事件, 保留 error 事件并等待 `type: "end"`; 不反复解析整个日志或轮询尚未写出的单个 JSON 结果. 日志截断或替换后重新定位. 只有异常或接管需要时检查进程树.

`--max-turns` 上限实测导致非零退出, `stopReason: "cancelled"` 与 stderr `max turns reached`, 属于限制终止. 权限拒绝却可零退出并 `end_turn`, 表示拒绝报告正常结束. `max_tokens` 等截断也不表示任务完成. 修改任务以实际 diff 和验证证据验收, 仅补查缺口, 不默认重跑已充分验证的检查.

取消或超时不回滚文件, 不保证保存全部上下文. 恢复前检查进程和工作区, 在新 prompt 重述关键要求. 失联时终止本次拥有的进程树, 保留输出与 ID; 不重复可能已经发生的外部操作.

## 参考

- [安装与认证](https://docs.x.ai/build/overview)
- [Headless 调用](https://docs.x.ai/build/cli/headless-scripting)
- [官方 headless 文档源码](https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/docs/user-guide/14-headless-mode.md)
- [官方权限文档源码](https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/docs/user-guide/22-permissions-and-safety.md)

公开教程与安装版本不一致时, 以已确认产品的本机帮助为执行依据, 特别核对 session 与权限参数.
