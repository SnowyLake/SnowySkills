# checkpoint

## Table of Contents

- [概览](#概览)
- [Skills](#skills)
- [共享 References](#共享-references)
- [名词定义](#名词定义)
  - [会话文件夹](#会话文件夹)
  - [Checkpoint 文件](#checkpoint-文件)
  - [Review 文件](#review-文件)
- [使用示例](#使用示例)
- [功能](#功能)
  - [checkpoint-save](#checkpoint-save)
  - [checkpoint-restore](#checkpoint-restore)
  - [checkpoint-handoff](#checkpoint-handoff)
  - [checkpoint-status](#checkpoint-status)
  - [checkpoint-review](#checkpoint-review)
- [参考工作流](#参考工作流)
  - [单会话持续工作](#单会话持续工作)
  - [共享会话协作](#共享会话协作)
  - [审阅反馈闭环](#审阅反馈闭环)
  - [Handoff 或分支接管](#handoff-或分支接管)
  - [Restore 冲突保护](#restore-冲突保护)
- [工作流边界](#工作流边界)

语言: [English](README.md) | 中文

## 概览

`checkpoint` 是一组用于 long-running, multi-session, handoff-based 或 review-driven agent work 的 skill family.

这个 family 围绕会话文件夹和 Markdown checkpoint 文件组织. 会话文件夹是上下文身份, agent 或会话只是按所运行 skill 读取或写入该上下文的协作者.

每个能力都是独立 skill.

## Skills

这个 family 提供五个 skill:

- `checkpoint-save`: 创建或刷新当前会话 checkpoint.
- `checkpoint-restore`: 只读地从当前 checkpoint 或指定会话文件夹恢复上下文.
- `checkpoint-handoff`: 从另一个会话文件夹重建上下文, 再保存到当前 target session folder.
- `checkpoint-status`: 列出当前目标, 当前状态, 已知风险, 开放问题, TODO, 下一步行动和 open review findings.
- `checkpoint-review`: 审阅 checkpoint 文件指向的实际工作内容, 并写入 `REVIEW.md`.

## 共享 References

`checkpoint-save` 是 root skill. 它保存共享 references, 以下路径相对于本目录:

- `references/file-contracts.md`
- `references/common-rules.md`
- `references/status-summary.md`

其他 `checkpoint-*` skill 依赖 `checkpoint-save`. 如果这些共享 references 不可用, 依赖 skill 必须停止执行并提示用户先安装 `checkpoint-save`. 不要凭记忆重建契约.

## 名词定义

### 会话文件夹

会话文件夹用于保存一条上下文主线:

```text
.agent-sessions/{YYYYMMDD}-{short-kebab-case-session-summary}/
```

解析会话文件夹时, skill 区分明确有, 明确没有和不确定三种状态. 明确有时复用已有文件夹, 明确没有且请求需要写入 checkpoint 时自动创建新文件夹, 不确定时询问用户指定已有文件夹或确认创建新文件夹.

### Checkpoint 文件

Checkpoint 文件用于重建会话上下文:

- `CONTEXT.md`: 只保存当前仍然有效且会影响后续工作的信息, 包括当前目标, 当前状态, 已确认决策, 生效中的约束, 已知风险, 开放问题, TODO, 下一步行动, 相关文件和工作产物.
- `HISTORY.md`: 保存历史摘要, 故障排查记录, 已拒绝或暂缓方案, 假设, 备注和 handoff 审计条目.

`CONTEXT.md` 是重建会话上下文的主入口. `HISTORY.md` 只在需要历史背景时读取.

### Review 文件

`REVIEW.md` 保存一个会话文件夹的最新 review 结果. 它由 `checkpoint-review` 创建, 可被 `checkpoint-restore` 作为导航提示读取.

`REVIEW.md` 不是 checkpoint 文件. 其中 findings 带有稳定 ID, 状态和严重度. 后续工作前必须对照当前项目文件重新核验 `Open` findings.

## 使用示例

按需要的能力直接使用对应 skill:

```text
Use checkpoint-save to save the current session checkpoint.
Use checkpoint-restore to restore context from .agent-sessions/20260605-example-session.
Use checkpoint-handoff to take over context from .agent-sessions/20260605-example-session into the current session.
Use checkpoint-status to list current checkpoint status.
Use checkpoint-review to review .agent-sessions/20260605-example-session.
```

## 功能

### checkpoint-save

`checkpoint-save` 用于创建或刷新当前会话 checkpoint.

权限:

- 可以读取已有 checkpoint 文件和相关项目文件.
- 只可以写当前会话文件夹中的 `CONTEXT.md` 和 `HISTORY.md`.
- 不得修改项目文件或其他会话产物.

行为:

- 解析当前会话文件夹.
- 如果已有 `CONTEXT.md` 和 `HISTORY.md`, 会先读取它们.
- 当项目文件和 checkpoint 内容冲突时, 优先相信当前项目文件.
- 将 `CONTEXT.md` 重写为干净的当前状态快照, 将过时, 被否决或对后续工作无价值的内容移出 `CONTEXT.md`.
- 向 `HISTORY.md` 追加一个新的历史条目, 不把新历史合并进旧条目.
- 成功完成后输出当前会话文件夹的 status summary.

### checkpoint-restore

`checkpoint-restore` 用于从当前会话 checkpoint 或显式指定的会话文件夹中的 checkpoint 文件重建会话上下文.

权限:

- 默认只读.
- 可以读取 checkpoint 文件, `REVIEW.md` 和相关项目文件.
- 不得复制 checkpoint 文件, 写会话文件夹, 修改项目文件或执行 TODO, 除非用户明确要求后续工作.

行为:

- 未提供路径时使用当前会话文件夹.
- 提供路径时使用指定文件夹作为恢复来源.
- 如果用户只说从某个 checkpoint 或会话文件夹"重建上下文", 且没有要求保存, 迁移, 分支, 接管或写入目标会话文件夹, 默认视为 restore.
- 如果当前会话已有 checkpoint 文件, 且用户指定了另一个会话文件夹, 则停止执行.
- 如果存在 `CONTEXT.md`, 优先读取它.
- 只有在需要历史背景时读取 `HISTORY.md`.
- 当存在 `REVIEW.md` 时, 跳过 `Resolved` 和 `Won't Fix` findings, 按指向范围尽力验证 `Open` findings, 并浮出仍符合当前工程事实的问题.
- 缺少或只有部分 checkpoint 文件时明确报告, 不自行猜测.
- 当项目文件和 checkpoint 内容冲突时, 优先相信当前项目文件.
- 成功完成后先输出 restore 来源, 已读取文件, 信息来源和置信度说明, 再输出恢复来源的 status summary.
- 当存在 `REVIEW.md` 时, 会将每条 `Open` finding 的验证结果作为 `Open Review Findings` 子条目输出. 验证结果必须包含分类和说明, 分类只分为 `Still Applies`, `Needs Review`, `No Longer Applies`.

### checkpoint-handoff

`checkpoint-handoff` 用于从另一个会话 checkpoint 重建会话上下文, 并将重建后的 checkpoint 保存到当前 target session folder.

权限:

- 源会话文件夹只读.
- 目标会话文件夹可读写.
- 只可以复制源会话文件夹内仍然有效的 non-checkpoint artifacts.
- 不得复制源会话文件夹外的文件.

行为:

- 要求源会话文件夹必须包含 `CONTEXT.md`.
- 源会话文件夹校验失败时停止执行.
- 如果目标会话文件夹已经存在 `CONTEXT.md` 或 `HISTORY.md`, 则停止执行, 不读取, 合并, 复制或修改任一 checkpoint.
- 需要用户明确表达保存, 迁移, 分支, 接管或写入目标会话文件夹的意图. 只出现"重建"或 `rebuild` 一词不足以选择 `checkpoint-handoff`.
- 不创建缺失的源会话文件夹 checkpoint 文件.
- 不搜索其他文件夹, 除非用户明确要求 discovery.
- 复制前先分类源会话文件夹内的 non-checkpoint artifacts.
- 不把源 `REVIEW.md` 复制为目标 `REVIEW.md`. 如果用户明确要求保留, 只能把它重命名为历史 review 产物, 且不改写 `Reviewed Session`.
- 在目标会话文件夹 `CONTEXT.md` 写入简短 provenance note.
- 向目标会话文件夹 `HISTORY.md` 追加 handoff 审计条目.
- 成功完成后先输出源会话文件夹, 目标会话文件夹, 已更新文件, 已复制产物, 已丢弃产物和引用改写, 再输出目标会话文件夹的 status summary.

### checkpoint-status

`checkpoint-status` 用于只读列出 checkpoint 中的当前状态和待处理事项.

权限:

- 默认读取当前会话文件夹.
- 提供路径时读取指定会话文件夹.
- 可以读取 `CONTEXT.md` 和可选 `REVIEW.md`.
- 不读取 `HISTORY.md`, 除非用户明确要求历史背景.
- 不得写 checkpoint 文件, 写 `REVIEW.md`, 修改项目文件或执行 TODO.

行为:

- 输出 `Current Goal`, `Current State`, `Known Risks`, `Open Questions`, `TODO`, `Next Actions` 和 `Open Review Findings`.
- 除 `Open Review Findings` 外, 其他章节保持 `CONTEXT.md` 中的原文内容.
- `Open Review Findings` 默认列出全部 `Open` findings, 格式为 `[Open][High] F-003: 简短问题标题`.
- 不展开 finding 的影响, 证据或推荐修复方案.
- 不验证 finding 是否仍符合当前工程事实.
- `checkpoint-save`, `checkpoint-restore` 和 `checkpoint-handoff` 成功完成后也会输出同样格式的 status summary. `checkpoint-restore` 和 `checkpoint-handoff` 会先输出各自独有内容, 再输出 status summary.

### checkpoint-review

`checkpoint-review` 用于客观审阅当前会话文件夹或指定会话文件夹中 checkpoint 所指向的实际工作内容, 再将结果写入该文件夹的 `REVIEW.md`, 不恢复上下文, 不继续实现.

权限:

- 未提供路径时使用当前会话文件夹.
- 提供路径时使用指定的被审阅会话文件夹.
- 可以读取 checkpoint 文件, 被审阅会话文件夹 artifacts 和相关项目文件.
- 只可以写被审阅会话文件夹中的 `REVIEW.md`.
- 不得修改被审阅会话文件夹的 checkpoint 文件, 项目文件, 其他 artifacts 或执行 TODO.

行为:

- 要求被审阅会话文件夹必须包含 `CONTEXT.md`.
- 将被审阅会话文件夹的 `HISTORY.md` 视为可选历史背景.
- 将 `CONTEXT.md`, `HISTORY.md` 和 `Work Artifacts` 作为 review brief 和导航索引.
- 审阅实际被引用的工作内容, 例如被修改的项目文件, 生成产物, 测试, 配置或文档.
- 首先判断会话是否完成 `Current Goal`.
- 然后审查是否存在缺陷, 逻辑漏洞, 边界问题, 遗漏验证, 冲突或不一致.
- 每条 finding 使用 `F-001` 形式的稳定 ID, 并包含状态, 严重度, 影响, 证据和推荐修复方案.
- 如果已有 `REVIEW.md`, 会重新验证旧的 `Open` findings. 仍成立的保留, 不再成立的标记为 `Resolved` 并保留一轮, 明确不修复的标记为 `Won't Fix`.
- Checkpoint 自身质量问题放入 `Checkpoint Quality`, 不放入 `Findings`, 除非它直接导致无法评估实际工作或隐藏工作范围.
- 将 `REVIEW.md` 写入被审阅会话文件夹, 覆盖此前的 `REVIEW.md`, 不自动归档旧 review, 并同时在回复中输出 review.

## 参考工作流

### 单会话持续工作

单个会话在上下文压缩前运行 `checkpoint-save`, 将当前仍然有效的信息写入 checkpoint. 上下文压缩后运行 `checkpoint-restore`, 从 checkpoint 重建会话上下文, 避免有用信息因 `/compact` 丢失.

```text
[会话 A 工作]
      |
      v
[checkpoint-save 写入 checkpoint]
      |
      v
[/compact 压缩上下文]
      |
      v
[checkpoint-restore 重建会话上下文]
      |
      v
[继续工作]
      |
      v
[checkpoint-save 刷新 checkpoint]
```

### 共享会话协作

多个 agent 或多个会话使用同一个会话文件夹作为共享上下文主线. 每个协作者对该文件夹运行 `checkpoint-restore`, 继续工作, 再运行 `checkpoint-save` 把新状态写回.

```text
[Agent A 工作]
        |
        v
[Agent A checkpoint-save]
        |
        v
[共享会话文件夹]
        |
        v
[Agent B checkpoint-restore]
        |
        v
[Agent B 工作]
        |
        v
[Agent B checkpoint-save]
        |
        v
[共享会话文件夹]
        |
        v
[Agent A checkpoint-restore]
```

### 审阅反馈闭环

审阅者可以对共享会话文件夹运行 `checkpoint-review`, 将结果写入该文件夹的 `REVIEW.md`. 实现者随后对同一文件夹运行 `checkpoint-restore`, 消费 review findings, 修复或继续工作, 再运行 `checkpoint-save`. 重复这个闭环直到 review 通过. 审阅者最后可以运行一次 `checkpoint-restore`, 重建完成后的共享上下文并收束工作.

```text
[Agent A plan]
          |
          v
[Agent A checkpoint-save]
          |
          v
[共享会话文件夹]
          |
          v
[Agent B checkpoint-restore]
          |
          v
[Agent B implement]
          |
          v
[Agent B checkpoint-save]
          |
          v
[Agent A checkpoint-review 实际工作内容]
          |
          v
[写入 REVIEW.md]
          |
          v
[Agent B checkpoint-restore review findings]
          |
          v
[Agent B fix and checkpoint-save]
          |
          v
[重复直到 review 通过]
          |
          v
[Agent A final checkpoint-restore]
```

### Handoff 或分支接管

一个会话文件夹作为只读源会话文件夹, 当前会话文件夹作为可写目标会话文件夹. 当上下文需要迁移或派生到不同会话文件夹时使用这个工作流.

```text
[源会话文件夹]
  CONTEXT.md
  HISTORY.md
  artifacts
      |
      v
[checkpoint-handoff 重建上下文]
      |
      v
[目标会话文件夹]
  CONTEXT.md
  HISTORY.md
  copied artifacts
```

### Restore 冲突保护

如果当前会话已经有 checkpoint 文件, 又尝试对另一个会话文件夹运行 `checkpoint-restore`, `checkpoint-restore` 会停止, 避免混合两条上下文主线. 需要迁移时使用 `checkpoint-handoff`, 需要协作时共享同一个会话文件夹.

`checkpoint-handoff` 写入目标会话文件夹时同样保护已有 checkpoint. 如果目标会话文件夹已经存在 `CONTEXT.md` 或 `HISTORY.md`, `checkpoint-handoff` 会停止, 需要改用新的空目标会话文件夹.

```text
[当前会话已有 checkpoint]
      |
      v
[checkpoint-restore 另一个会话文件夹]
      |
      v
[停止]
      |
      +-- 迁移或分支: 使用 checkpoint-handoff
      |
      +-- 协作接力: 共享同一会话文件夹
```

后续迭代应保持这些工作流边界, 除非明确要调整工作流模型本身.

## 工作流边界

- 需要持久化当前会话状态时, 使用 `checkpoint-save`.
- 只需要重建上下文且不写文件时, 使用 `checkpoint-restore`.
- 需要迁移, 分支或接管上下文到另一个会话文件夹时, 使用 `checkpoint-handoff`.
- 只需要列出当前状态和待处理工作时, 使用 `checkpoint-status`.
- 需要审阅 checkpoint 指向的实际工作内容时, 使用 `checkpoint-review`.
