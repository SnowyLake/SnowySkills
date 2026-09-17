---
name: checkpoint-status
description: Read checkpoint status without restoring context or modifying files. Use when the user asks for current checkpoint status, TODO, risks, open questions, next actions, pending work, or open review findings from a session folder.
---

# checkpoint-status

## 目录

- [概览](#概览)
- [执行前检查](#执行前检查)
- [会话文件夹解析](#会话文件夹解析)
- [访问模式](#访问模式)
- [工作流](#工作流)
- [输出风格](#输出风格)

## 概览

只读列出 checkpoint 中的当前目标, 当前状态, 已知风险, 开放问题, TODO, 下一步行动和 open review findings. 不恢复完整上下文, 不审阅实际工作, 不写文件, 不执行 TODO.

## 执行前检查

本 skill 依赖 `checkpoint-save`.

执行前必须读取:

- `../checkpoint-save/references/file-contracts.md`
- `../checkpoint-save/references/common-rules.md`
- `../checkpoint-save/references/status-summary.md`

如果任一文件不可用, 停止执行并提示用户先安装 `checkpoint-save`. 不要凭记忆重建 checkpoint contract.

## 会话文件夹解析

解析 status source session folder:

1. 如果用户没有指定会话文件夹, 解析当前会话文件夹.
2. 如果用户指定了会话文件夹, 将其作为 status source.
3. 如果当前会话文件夹不明确且用户未指定路径, 要求用户指定一个已有会话文件夹.
4. 不创建会话文件夹.

## 访问模式

- 只读.
- 可以读取 status source session folder 中的 `CONTEXT.md`.
- 当 `REVIEW.md` 存在时, 可以读取它并提取 `Open` findings.
- 默认不读取 `HISTORY.md`, 除非用户明确要求历史背景.
- 不得复制 checkpoint 文件, 写入会话文件夹, 修改 `REVIEW.md`, 修改项目文件或执行 TODO.

## 工作流

1. 解析 status source session folder.
2. 确认 source session folder 存在.
3. 确认 source session folder 包含 `CONTEXT.md`.
4. 读取 `CONTEXT.md`.
5. 原文提取 `Current Goal`, `Current State`, `Known Risks`, `Open Questions`, `TODO` 和 `Next Actions`.
6. 如果 `REVIEW.md` 存在, 读取它.
7. 只提取 `Status` 为 `Open` 的 findings. 不展开 `Impact`, `Evidence` 或 `Recommended Fix`, 不验证 finding 是否仍符合当前项目事实.
8. 如果某个必需 section 缺失, 在对应输出 section 中说明缺失. 不从其他 section 推断.

## 输出风格

按 `../checkpoint-save/references/status-summary.md` 输出 status summary.
