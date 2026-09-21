# Cursor ACP 调用

## 目录

- [入口与传输](#入口与传输)
- [会话配置](#会话配置)
- [权限请求](#权限请求)
- [取消与改发](#取消与改发)

## 入口与传输

使用已核实的 `cursor-agent` 入口运行 `cursor-agent acp`, 参数以当前 `cursor-agent acp --help` 为准, `--trust` 仅用于已获准信任的目录.

stdin / stdout 是 UTF-8 换行分隔的 JSON-RPC 2.0, stderr 分开记录. 保持 stdin 打开并持续消费 stdout; request 使用唯一 ID 关联 response, notification 不带 ID. `session/update` 与服务端 request 可穿插在 response 之间. 一轮结束依据是对应 `session/prompt` 的 response / `stopReason`, 更新流只表示进度.

## 会话配置

握手与建会话有依赖, 按顺序等待每个请求成功:

1. `initialize`: 传支持的 `protocolVersion`, `clientInfo`, 真实 `clientCapabilities`. 未实现客户端 fs / terminal 时声明 `fs.readTextFile: false`, `fs.writeTextFile: false`, `terminal: false`.
2. `authenticate`: 从返回的 `authMethods` 选择已有认证方法; 已登录版本支持 `cursor_login` 与 `_meta.headless: true`, 按实际广告选择.
3. `session/new`: 传绝对 `cwd` 和 `mcpServers` 数组, 无额外服务器时为 `[]`. 保存 `sessionId` 及可用模型与模式.
4. 按需要 `session/set_model` / `session/set_mode`: 使用会话广告的 `modelId` / `modeId`, 如 `ask` / `agent`. ACP 模型 ID 可与 CLI 别名不同, 不能直接复用别名.
5. `session/prompt`: 传同一会话 ID 与内容块. 正常多轮等待上一轮 response 后再发送下一轮.

```json
{"jsonrpc":"2.0","id":5,"method":"session/prompt","params":{"sessionId":"SESSION_ID","prompt":[{"type":"text","text":"Inspect the relevant code and report the smallest fix."}]}}
```

支持 `loadSession` 时可尝试 `session/load` 并传 `sessionId`, `cwd`, `mcpServers`, 但广告支持不保证目标 ID 可见. Headless ID 跨入口加载实测返回 `Session not found`. ACP 内从 Ask 转修改需明确 `session/set_mode`, 省略 CLI 模式参数不能切换已有模式.

## 权限请求

`session/request_permission` 是带 ID 的服务端 request. 核对 `toolCall` 的路径, 命令与已有授权, 从该请求的 `options` 选择 `allow_once` / `reject_once` 对应 `optionId`, 用原 ID 返回 `result.outcome: {"outcome":"selected","optionId":"OPTION_ID"}`. 无合适选项时返回 cancelled:

```json
{"jsonrpc":"2.0","id":100,"result":{"outcome":{"outcome":"cancelled"}}}
```

未实现的其他服务端 request 返回 JSON-RPC method-not-found, 不宣告或伪造 fs / terminal 能力.

## 取消与改发

取消为 notification:

```json
{"jsonrpc":"2.0","method":"session/cancel","params":{"sessionId":"SESSION_ID"}}
```

等待原 prompt 的终结 response: `cancelled` 表示取消; 若原轮已自然结束可返回 `end_turn`, 不再等额外 cancelled response. 原请求结束后在同一会话发新 prompt, 重述关键要求, 取消轮文本可能未持久化.

Cursor Agent `2026.07.23-e383d2b` 并发发送第二个 prompt 实测取消原轮后执行新轮, 属于取消后改发, 不是不中断 steer 保证. 默认采用显式取消并等待原轮结束. JSON-RPC error 与其他 stop reason 分别处理; 取消不会回滚文件, 修改仍需核对 diff 与验证.

失联或超时时终止本次拥有的进程树, 保留 transcript 与会话 ID, 检查工作区后恢复.

协议参考 [Cursor ACP](https://cursor.com/docs/cli/acp) 与 [ACP prompt turn](https://agentclientprotocol.com/protocol/v1/prompt-turn).
