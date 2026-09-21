---
name: cursor-cli
description: 调用 Cursor Agent CLI 执行代码任务, 续接会话或通过 ACP 控制运行中的任务. 不用于启动 Cursor 编辑器.
---

# cursor-cli

## 目录

- [识别与认证](#识别与认证)
- [非交互任务](#非交互任务)
- [会话与控制](#会话与控制)
- [结果与恢复](#结果与恢复)
- [参考](#参考)

## 识别与认证

入口命令固定为 `cursor-agent`, 不回退到 `agent` 或 `cursor`. 首次用 `--version` / `--help` 核实身份后保存绝对入口路径和版本. 同一任务复用结果, 仅在入口, 版本或环境变化时重查.

```powershell
Get-Command cursor-agent -All -ErrorAction Stop
```

POSIX 使用 `command -v cursor-agent`. Windows 优先已核实的 `.ps1` 或原生入口; `.cmd` 可能二次解析参数, 参数数组也不能消除包装层风险, 避免通过 `cmd /c` 传复杂 prompt. 缺失时按官方安装说明处理.

`status` 检查认证, `login` 完成登录, 也可使用已有 `CURSOR_API_KEY`; 密钥不进入 prompt 或日志. `models` / `--list-models` 列出可选模型, 按任务需要设置 `--model`.

## 非交互任务

使用 `--print` 执行单轮, `--workspace` 指定目标绝对目录. prompt 包含具体目标, 修改范围与必要验证, CLI 读取该工作区规则. 下例以已核实的 `cursor-agent` 入口执行只读分析:

```powershell
$cursorCli = (Get-Command cursor-agent -ErrorAction Stop).Source
$workspace = (Get-Location).Path
$prompt = 'Read the project rules and inspect the relevant code. Suggest the smallest fix without changing files.'
$cliArgs = @('--print', '--mode', 'ask', '--output-format', 'json', '--workspace', $workspace, $prompt)
& $cursorCli @cliArgs
$cliExitCode = $LASTEXITCODE
```

- `--mode ask` 与 `--mode plan` 为只读模式. 首次修改使用新的 Agent 会话并省略只读模式; 省略 `--force` 本身不保证只读.
- `--force` 自动批准通常需审批的能力, 仅按已有授权选择. `--sandbox enabled|disabled`, `--trust`, `--approve-mcps` 同样按既有执行与信任边界选择.
- 报 `Workspace Trust Required` 时, 可对已经获准信任的目标目录添加 `--trust`.
- 多行 prompt 作为一个参数传递; 以 `-` 开头时调整为普通文本开头, 避免选项解析. 不假定存在 prompt-file 或 stdin prompt 支持. 无 stdin 输入时关闭管道, 避免包装器等待 EOF.

Cursor Agent `2026.07.23-e383d2b` 在 Windows 实测 `Write(denied.txt)` 与 `Write(**/denied.txt)` 未阻止创建, 模型却声称拒绝; `Write(**)` 仅在该次测试阻止写入. 根因未明, deny 规则需在隔离目录核对实际匹配和文件变化. 硬只读边界使用 Ask 模式结合外部文件系统沙箱.

## 会话与控制

保存 `session_id`, 使用 `--resume <chatId>` 续接明确会话, 保持目标工作目录并传入新 prompt 与所需参数. `--continue` 选择最近会话, 仅在目标明确时使用. 需要中断恢复时, 可先 `create-chat` 建立并记录 ID.

Ask 会话 resume 时保留模式, 移除 `--mode` 仍不会变成 Agent, 即使退出码为零且标记 success. 从分析转修改可新建 Agent 会话并带入结论; ACP 会话按支持的 `session/set_mode` 明确切换.

需要持续会话, 模式切换或运行中取消与改发要求时, 读取 [ACP 调用](references/acp.md). `--print` stdin 不是已验证的 steer 接口. Headless ID 载入 ACP 实测返回 `Session not found`, 不保证跨入口互通.

## 结果与恢复

| 格式 | 解析与完成依据 |
| --- | --- |
| `json` | 单个结果对象, 成功为 `type: "result"`, `subtype: "success"`, `is_error: false`, 含 `result` / `session_id`; 同时检查退出码 |
| `stream-json` | NDJSON, 等待最终 `result` 事件; 缺少终结事件为结果不确定 |
| `text` | 适合直接阅读, 不作为结构化结果 |

`--stream-partial-output` 会加入增量文本, 解析时避免与完整文本重复拼接. 失败可能只有非零退出码与 stderr, 没有合法 JSON; 持续读取原进程的 stdout / stderr 至结束.

优先等待进程结束及终结结果. 需要进度时使用 `stream-json`, 按已消费行数或字节位置读取新增完整事件; 不反复解析整个日志或轮询尚未写出的单个 JSON 结果. 日志截断或替换后重新定位. 只有异常或接管需要时检查进程树.

成功结果只表示该轮正常返回, 修改任务以实际 diff 和验证证据验收, 仅补查缺口, 不默认重跑已充分验证的检查. 超时或取消不回滚文件, 也不保证取消轮文本持久化: 先核对进程和工作区, 恢复时重述关键要求. 协议失联时终止本次拥有的进程树, 保留输出与会话 ID; 不重复可能已经发生的外部操作.

## 参考

- [参数](https://cursor.com/docs/cli/reference/parameters)
- [权限](https://cursor.com/docs/cli/reference/permissions)
- [Headless 调用](https://cursor.com/docs/cli/headless)
- [输出格式](https://cursor.com/docs/cli/reference/output-format)
