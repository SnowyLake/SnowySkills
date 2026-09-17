---
name: checkpoint-review
description: Review the actual work referenced by checkpoint files and write REVIEW.md. Use when the user asks to review, audit, evaluate, inspect, or critique a current or specified session folder's work without restoring context or continuing implementation.
---

# checkpoint-review

## 目录

- [概览](#概览)
- [执行前检查](#执行前检查)
- [会话文件夹解析](#会话文件夹解析)
- [访问模式](#访问模式)
- [工作流](#工作流)
- [输出风格](#输出风格)

## 概览

客观审阅当前会话文件夹或指定会话文件夹中 checkpoint 文件指向的实际工作内容, 并将结果写入该文件夹的 `REVIEW.md`. 不恢复上下文, 不继续实现.

## 执行前检查

本 skill 依赖 `checkpoint-save`.

执行前必须读取:

- `../checkpoint-save/references/file-contracts.md`
- `../checkpoint-save/references/common-rules.md`

如果用户还要求输出 status summary, 必须读取:

- `../checkpoint-save/references/status-summary.md`

如果任一 required file 不可用, 停止执行并提示用户先安装 `checkpoint-save`. 不要凭记忆重建 checkpoint contract.

## 会话文件夹解析

解析被审阅会话文件夹:

1. 如果用户没有指定会话文件夹, 将当前会话文件夹解析为被审阅文件夹.
2. 如果用户指定了会话文件夹, 将其作为被审阅文件夹.
3. 如果当前会话文件夹不明确且用户未指定路径, 要求用户指定一个已有会话文件夹.
4. 不创建被审阅会话文件夹.
5. 不要把无路径 review 视为依赖当前对话记忆. Review target 是被审阅会话文件夹中 checkpoint 文件导航到的实际工作内容.

## 访问模式

- 可以读取被审阅会话文件夹中的 checkpoint 文件和相关项目文件.
- 只能写被审阅会话文件夹中的 `REVIEW.md`.
- 不得修改被审阅的 `CONTEXT.md`, 被审阅的 `HISTORY.md`, 其他被审阅会话产物或项目文件, 除非用户明确要求后续工作.
- 用最新审阅结果覆盖已有 `REVIEW.md`.
- 默认不自动归档旧 `REVIEW.md`.
- 始终输出审阅结果, 并写入 `REVIEW.md`.
- 将 checkpoint 文件视为 review brief 和 navigation index. 除非用户明确要求审阅 checkpoint 文件本身, 不要把 checkpoint 文件质量作为主要审阅目标.

## 工作流

1. 解析被审阅会话文件夹.
2. 确认被审阅会话文件夹存在.
3. 确认被审阅会话文件夹包含 `CONTEXT.md`.
4. 如果校验失败, 停止并报告问题. 不要创建 checkpoint 文件, 创建 target folder, 写入 `REVIEW.md`, 修改项目文件或搜索其他文件夹.
5. 读取被审阅的 `CONTEXT.md`.
6. 当被审阅的 `HISTORY.md` 存在时读取它.
7. 如果缺少 `HISTORY.md`, 继续 review, 并说明历史上下文有限.
8. 使用 `CONTEXT.md` 理解目标, 状态, 决策, 约束, 风险, 开放问题, TODO, 下一步行动, 相关文件和 work artifacts.
9. 从 `Current Goal`, `Work Artifacts`, `Relevant Files`, `TODO`, `Next Actions` 以及被审阅会话文件夹内的 artifacts 构建 review scope.
10. 在产出 findings 前, 阅读代表该会话实际工作的项目文件, 生成产物, diff, tests 或配置.
11. 审阅实际工作是否完成 `Current Goal`.
12. 审阅实际工作是否存在缺陷, 边界问题, 遗漏验证, 冲突或不一致.
13. 不要把普通 checkpoint 质量问题列为 `Findings`. 将 checkpoint 清晰度, 新鲜度, 缺失章节或内部一致性问题放入 `Checkpoint Quality`, 除非它们直接阻止目标完成度评估或隐藏工作范围.
14. 只有当用户请求或 `Current Goal` 明确是创建或更新 checkpoint 文件时, 才把 `CONTEXT.md` 和 `HISTORY.md` 作为主要工作产物审阅.
15. 不要将被审阅上下文 restore 成当前活跃工作上下文.
16. 如果已有 `REVIEW.md`, 读取它. 对旧 `Open` findings 按当前工程事实重新验证, 并尽量保留仍成立问题的 ID.
17. 旧 `Open` finding 如果仍成立, 保持 `Open`. 如果不再成立, 标记为 `Resolved`, 添加 `Resolution`, 并保留一轮. 如果用户或项目决策明确不修复, 标记为 `Won't Fix`, 添加 `Resolution`.
18. 旧 `Resolved` 和 `Won't Fix` findings 默认不需要保留在最新 `REVIEW.md`, 除非本次 review 需要说明清理结果.
19. 新发现的问题使用下一个稳定 finding ID, 并使用 `file-contracts.md` 中的 finding 格式.
20. 将审阅结果写入被审阅会话文件夹的 `REVIEW.md`, 覆盖任何已有 `REVIEW.md`, 并在回复中输出同样结果.

## 输出风格

写入并输出这些章节:

```md
## Goal Completion

## Findings

## Checkpoint Quality

## Open Questions

## Summary
```

`REVIEW.md` 还必须在这些章节之前包含 `Reviewed Session` 和 `Review Date`, 具体见 `../checkpoint-save/references/file-contracts.md`.

章节含义:

- `Goal Completion`: 说明目标是 `Completed`, `Partially Completed`, `Not Completed` 还是 `Unclear`, 并简要说明证据.
- `Findings`: 按严重度排序列出实际工作中的具体问题. 包括实现缺陷, 逻辑缺口, 边界问题, 遗漏验证, 项目文件冲突或不一致. 每条 finding 使用 `F-001` 格式, 并包含 `Status`, `Severity`, `Impact`, `Evidence` 和 `Recommended Fix`. 如果检查相关文件后没有发现具体工作问题, 明确说明.
- `Checkpoint Quality`: 评估 `CONTEXT.md` 和可选 `HISTORY.md` 是否足够可靠, 能否支撑后续 restore, handoff 或 review.
- `Open Questions`: 列出无法从 checkpoint 文件和当前项目文件回答的问题.
- `Summary`: 给出简洁, 可行动的结论.
