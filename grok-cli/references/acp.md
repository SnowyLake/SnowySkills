# Grok ACP 调用

## 目录

- [入口与传输](#入口与传输)
- [会话配置](#会话配置)
- [权限请求](#权限请求)
- [运行中追加要求](#运行中追加要求)
- [取消与恢复](#取消与恢复)

## 入口与传输

使用 `grok agent --model <CLI_MODEL_ID> --reasoning-effort <EFFORT> --no-leader stdio`, 按任务选择模型与 effort, 参数先核对 `agent --help`. 该 stdio 入口与 `agent headless` WebSocket relay 不同.

stdin / stdout 是 UTF-8 换行分隔的 JSON-RPC 2.0, stderr 分开记录. 保持 stdin 打开并持续消费 stdout; request 使用唯一 ID 关联 response, notification 不带 ID. 处理中途穿插的 `session/update` 与服务端 request. 普通 `-p --output-format streaming-json` 不因此具备 ACP 控制输入能力.

## 会话配置

按依赖顺序等待各请求成功:

1. `initialize`: 传支持的 `protocolVersion`, `clientInfo` 与真实 `clientCapabilities`. 未实现客户端 fs / terminal 时声明 `fs.readTextFile: false`, `fs.writeTextFile: false`, `terminal: false`.
2. `authenticate`: 从 `authMethods` 和 `_meta.defaultAuthMethodId` 选择已有认证; 已登录环境支持 `cached_token` 与 `_meta.headless: true`, 按实际广告选择.
3. `session/new`: 传绝对 `cwd` 和 `mcpServers` 数组, 无额外服务器时为 `[]`, 保存 `sessionId` 与配置能力.
4. `session/set_model`: 传支持的 `modelId`, 可用 `_meta.reasoningEffort` 字符串设置 effort, 也可在启动时设置. 核对返回 `configOptions` 中 `id: "reasoning_effort"` 的 `currentValue` 或模型 `_meta.reasoningEffort`; 无效扩展值可能被忽略, 请求成功不证明生效.
5. `session/prompt`: 传同一会话 ID 与内容块. 正常多轮等上一轮 response 后再发送下一轮.

```json
{"jsonrpc":"2.0","id":5,"method":"session/prompt","params":{"sessionId":"SESSION_ID","prompt":[{"type":"text","text":"Inspect the relevant implementation and report your findings."}]}}
```

加载已有会话需核对 `loadSession` 与目标 ID 可见性; 不保证普通 CLI resume ID 可跨入口用于 ACP.

## 权限请求

`session/request_permission` 是带 ID 的服务端 request. 核对 `toolCall` 的路径, 命令与已有授权, 从请求 `options` 选 `allow_once` / `reject_once` 对应 `optionId`, 用原 ID 返回 `result.outcome: {"outcome":"selected","optionId":"OPTION_ID"}`. 无合适选项时返回 cancelled:

```json
{"jsonrpc":"2.0","id":100,"result":{"outcome":{"outcome":"cancelled"}}}
```

未实现的其他服务端 request 返回 JSON-RPC method-not-found, 不宣告或伪造 fs / terminal 能力.

## 运行中追加要求

Grok Build `1.0.30` 支持 `_x.ai/interject` request, 开头下划线不可省略; `x.ai/interject` 返回 method not found.

```json
{"jsonrpc":"2.0","id":6,"method":"_x.ai/interject","params":{"sessionId":"SESSION_ID","text":"Update the requirement: keep the files unchanged and return the revised answer briefly.","interjectionId":"UNIQUE_INTERJECTION_ID"}}
```

queued 回执只表示排队. 保持原 prompt 请求的关联并等待其终结 response, 通过最终输出或文件行为确认新要求被采用. 当前版本实测可不中断原轮并采用修正要求. 扩展不可用时可取消原轮, 等其结束后另发 prompt.

## 取消与恢复

取消为 notification:

```json
{"jsonrpc":"2.0","method":"session/cancel","params":{"sessionId":"SESSION_ID"}}
```

等待原 prompt 的终结 response: `cancelled` 表示取消, 若原轮已自然结束可返回 `end_turn`, 不再等额外 cancelled response. 原轮结束后使用同一 ID 发新 prompt; error 与其他 stop reason 分别处理. `session/update` 只表示进度.

取消不回滚文件, 不保证保存全部上下文; 新轮重述关键要求并核对文件与验证. 失联或超时时终止本次拥有的进程树, 保存 transcript 与会话 ID, 检查工作区后恢复.

协议参考 [ACP 扩展](https://agentclientprotocol.com/protocol/v1/extensibility), [prompt turn](https://agentclientprotocol.com/protocol/v1/prompt-turn), [Grok interject 实现](https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-shell/src/extensions/interject.rs) 与 [动态 reasoning 配置](https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-shell/src/agent/mvp_agent/acp_agent.rs).
