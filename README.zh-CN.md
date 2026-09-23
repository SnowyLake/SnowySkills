# SnowyAgentSkills

语言: [English](README.md) | 中文

## Table of Contents

- [概览](#概览)
- [可用 Skills](#可用-skills)
  - [checkpoint](#checkpoint)
  - [cursor-cli](#cursor-cli)
  - [grok-cli](#grok-cli)
  - [hybrid-work](#hybrid-work)
  - [unity-shader-analysis](#unity-shader-analysis)
  - [snapdragon-profiler-statistics](#snapdragon-profiler-statistics)
- [新增 Skills](#新增-skills)
- [仓库结构](#仓库结构)

## 概览

SnowyAgentSkills 是一个可复用 agent skills 集合仓库.

每个 skill 都位于仓库根目录的 `<skill-name>/` 下, 并作为自包含目录独立维护. 仓库目标是保持 agent-neutral, 让不同 agent runtime 都能按自己的加载模型采用合适的 skill 内容.

## 可用 Skills

### [checkpoint](checkpoint-save/README.zh-CN.md)

- 简介: checkpoint skill family, 用于在 long-running, multi-session, handoff-based 或 review-driven agent work 中保存, 恢复, 接管, 查看状态和审阅会话上下文.

- Skills: `checkpoint-save`, `checkpoint-restore`, `checkpoint-handoff`, `checkpoint-status`, `checkpoint-review`.

- 适用范围: All agents.

### [cursor-cli](cursor-cli/SKILL.md)

通过 Cursor 的 agent CLI 执行非交互代码任务, 获取结构化输出并续接会话.

### [grok-cli](grok-cli/SKILL.md)

通过 Grok Build CLI (`grok`) 执行非交互代码任务, 获取结构化输出并续接会话.

### [hybrid-work](hybrid-work/SKILL.md)

- 简介: 主代理负责决策与验收, 动态创建使用 `gpt-6-sol` 和 `xhigh` 推理强度的子代理, 完成有界的实现, 调试与验证, 无需持久化执行子代理配置.
- 运行前提: 仅适用于 Codex, 需要 `spawn_agent` 支持显式指定模型及 `fork_turns: "none"`. 调用一次 `$hybrid-work` 后在当前会话持续启用, 直到用户明确暂停, 后续任务无需再次调用; 所需能力不可用时由主代理接管.

### [unity-shader-analysis](unity-shader-analysis/SKILL.md)

- 简介: 使用 Mali Offline Compiler 分析 Unity 受控 Shader 变体, 生成包含源码优化建议的 Excel 报告.
- 运行前提: PowerShell, 已连接 uloop 的 Unity Editor, MaliOC; 报告生成需要 Node.js、`@oai/artifact-tool` 和 `jszip`. 仅显式调用.

### [snapdragon-profiler-statistics](snapdragon-profiler-statistics/SKILL.md)

- 简介: 将 Unity URP 的 Snapdragon Profiler CSV 汇总为每场景一张 Sheet 的 Excel, 统计 Pass Clocks 与主相机 ALU/EFU.
- 运行前提: Node.js、`@oai/artifact-tool`, 以及包含受支持相机标记的 CSV.

## 新增 Skills

新增 skill 时放入:

```text
<skill-name>/
```

每个 skill 文件夹必须包含:

- `SKILL.md`: 必需的 skill 元数据和说明.

只有在 skill 需要时才添加可选资源:

- `README.md`
- `README.zh-CN.md`
- `agents/`
- `scripts/`
- `references/`
- `assets/`

`agents/` 用于可选 runtime-specific metadata, 例如 `agents/openai.yaml`.

保持每个 skill 自包含, 不要把 skill 专属文档放在仓库根目录.

## 仓库结构

```text
SnowyAgentSkills/
|-- checkpoint-save/
|   |-- README.md
|   |-- README.zh-CN.md
|   |-- SKILL.md
|   |-- agents/
|   `-- references/
|-- checkpoint-restore/
|-- checkpoint-handoff/
|-- checkpoint-status/
|-- checkpoint-review/
|-- cursor-cli/
|-- grok-cli/
|-- hybrid-work/
|-- unity-shader-analysis/
|-- snapdragon-profiler-statistics/
|-- README.md
|-- README.zh-CN.md
|-- LICENSE
`-- .gitignore
```
