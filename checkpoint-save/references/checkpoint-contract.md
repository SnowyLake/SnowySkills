# Checkpoint Contract

## 目录

- [共享规则](#共享规则)
- [语言和格式](#语言和格式)
- [TOC 规则](#toc-规则)
- [CONTEXT.md](#contextmd)
  - [Work Artifacts](#work-artifacts)
- [HISTORY.md](#historymd)

本文件定义两个 skill 共用的信息判断规则和 checkpoint 文件结构. `checkpoint-save` 使用完整写入契约; `checkpoint-read` 使用共享规则及所需的文件含义, 无需把写入模板作为读取已有 checkpoint 的前置条件. 各自的访问范围与完成条件见对应 `SKILL.md`.

## 共享规则

- Checkpoint 文件存放在项目根目录的 `.agent-sessions/{YYYYMMDD}-{short-kebab-case-session-summary}/` 下. summary 片段使用小写 kebab-case, 并优先保持简洁.
- 当会话文件夹不明确时, 不要检查 `.agent-sessions/` 来猜测语义匹配的文件夹, 除非用户明确要求 discovery 或列出候选.
- 目标和授权范围以当前用户要求及仍有效的明确决定为准; 实现现状以当前文件和必要检查为准; checkpoint 提供此前状态与决策背景. 代码的存在不构成执行或发布授权.
- `CONTEXT.md` 是当前状态的主要记录, `HISTORY.md` 用于背景追溯; 两者冲突时优先使用当前快照, 已核实的新事实则应明确指出. 不把未经核对的记录或推断表述为已验证事实.
- 只把 `Work Artifacts` 当作 navigation index. 它不是完整 diff, 不是事实来源.

## 语言和格式

写入 checkpoint Markdown 文件或回复用户时:

- 保留本文中要求的文件名和结构标题, 除非项目级指令明确覆盖它们.
- 把英文结构标题视为文件 contract, 不视为正文默认语言.
- 正文语言优先遵循项目级或用户级指令.
- 如果没有项目级或用户级语言指令, 正文使用当前对话语言.
- 这条规则适用于 `CONTEXT.md`, `HISTORY.md` 和回复.

## TOC 规则

`CONTEXT.md` 和 `HISTORY.md` 必须包含 `## Table of Contents`. TOC 是 checkpoint 文件结构的一部分, 放在一级标题之后, 正文二级章节之前. `## Table of Contents` 是固定结构标题, 不随正文语言翻译.

TOC 必须列出文件中的所有二级章节. 模板中的 `- ...` 表示按实际章节生成 TOC, 不是要保留的字面内容. 每次追加, 删除或重命名章节时, 必须同步更新 TOC.

## CONTEXT.md

`CONTEXT.md` 只保存当前仍然有效, 并且会影响未来工作的当前信息. 使用以下结构:

```md
# CONTEXT.md

## Table of Contents

- ...

## Current Goal

## Current State

## Confirmed Decisions

## Active Constraints

## Known Risks

## Open Questions

## TODO

## Next Actions

## Relevant Files

## Work Artifacts
```

Section 含义:

- `Current Goal`: 当前目标.
- `Current State`: 当前实现状态或会话状态.
- `Confirmed Decisions`: 仍然有效的决策.
- `Active Constraints`: 后续工作仍必须遵守的约束.
- `Known Risks`: 已知风险, 陷阱或注意事项.
- `Open Questions`: 需要讨论, 调研或验证的问题.
- `TODO`: 仍然有效的剩余工作池.
- `Next Actions`: 从 `TODO` 中提炼出的前 1 到 3 个具体下一步动作.
- `Relevant Files`: 与理解当前会话直接相关的文件, 文件夹或资源.
- `Work Artifacts`: 本会话创建, 修改, 删除或移动的主要文件. 它是导航索引, 不是完整 diff, 不是完整事实来源.

每次创建或更新 `CONTEXT.md` 时, 必须同步更新 `Table of Contents`, 确保 TOC 列出所有实际存在的二级章节.

### Work Artifacts

使用以下 `Work Artifacts` 条目结构:

```md
- [Modified] `path/to/file.md`
  - Briefly explain what changed in this file.
```

允许的 `Work Artifacts` 动作:

- `[Created]`: 本会话创建了该文件.
- `[Modified]`: 本会话修改了已有文件.
- `[Deleted]`: 本会话删除了该文件.
- `[Moved]`: 本会话移动或重命名了该文件.

每次 `checkpoint-save` 都必须维护 `Work Artifacts`, 但没有工作产物时可以为空.

## HISTORY.md

`HISTORY.md` 保存历史摘要, 排障记录, 已拒绝或暂缓方案和推理归档. 使用多条目结构:

```md
# HISTORY.md

## Table of Contents

- ...

## {YYYY-MM-DD} - {entry-title}

### Summary

### Important Findings

### Decisions

### Rejected / Deferred Approaches

### Assumptions

### Notes
```

每个新的 history entry:

- 使用 `YYYY-MM-DD` 格式的实际条目日期.
- 使用简短描述性的条目标题.
- 新增一个二级条目. 不要使用重复的 `Entry Date` 或 `Entry Title` 标题.
- 同步更新 `Table of Contents`, 确保 TOC 列出所有实际存在的二级 history entries.
- 显式标记已拒绝和已暂缓项, 例如 `[Rejected]` 或 `[Deferred]`.
- 显式标记假设, 例如 `[Verified]` 或 `[Unverified]`.
