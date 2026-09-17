---
name: checkpoint-restore
description: Restore session context read-only from checkpoint files. Use when the user asks to restore, read, recover, resume, or rebuild context from the current checkpoint or a specified session folder without saving, migrating, branching, or writing a target checkpoint.
---

# checkpoint-restore

## 目录

- [概览](#概览)
- [执行前检查](#执行前检查)
- [会话文件夹解析](#会话文件夹解析)
- [访问模式](#访问模式)
- [工作流](#工作流)
- [输出风格](#输出风格)

## 概览

只读读取 checkpoint 文件并重建当前会话上下文. 不修改 checkpoint 文件, `REVIEW.md`, 项目文件或会话产物.

当用户要求保存, 迁移, 分支, 接管或写入 target session folder 时, 使用 `checkpoint-handoff`, 不使用本 skill.

## 执行前检查

本 skill 依赖 `checkpoint-save`.

执行前必须读取:

- `../checkpoint-save/references/file-contracts.md`
- `../checkpoint-save/references/common-rules.md`
- `../checkpoint-save/references/status-summary.md`

如果任一文件不可用, 停止执行并提示用户先安装 `checkpoint-save`. 不要凭记忆重建 checkpoint contract.

## 会话文件夹解析

解析 restore source session folder:

1. 如果用户没有指定会话文件夹, 解析当前会话文件夹.
2. 如果用户指定了会话文件夹, 将其作为 restore source.
3. 如果用户指定了另一个会话文件夹, 且当前对话自己的会话文件夹已经有 checkpoint 文件, 停止并报告冲突. 不要读取, 合并, 复制或修改任一 checkpoint.
4. 如果指定的会话文件夹就是当前会话文件夹, 允许 restore.
5. 如果当前文件夹不明确且用户未指定路径, 要求用户指定一个已有会话文件夹.
6. 不创建会话文件夹.

## 访问模式

- 只读.
- 可以读取 restore source session folder 中的 checkpoint 文件和相关项目文件.
- 当存在 `REVIEW.md` 时, 可以读取它, 按 referenced scope 验证 `Open` findings, 并浮出仍符合当前项目事实的问题.
- 不得复制 checkpoint 文件, 写入会话文件夹, 修改 `REVIEW.md`, 修改项目文件或执行 TODO, 除非用户明确要求后续工作.

## 工作流

1. 解析 restore source session folder.
2. 如果用户指定了不同 source folder, 且当前对话自己的会话文件夹已经有 checkpoint 文件, 停止并报告冲突.
3. 当 `CONTEXT.md` 存在时, 先读取它.
4. 只有在需要理解决策背景, 排障依据, 已拒绝方案或历史不确定性时, 才读取 `HISTORY.md`.
5. 读取 `Work Artifacts`, 用于快速理解之前的工作范围.
6. 当 `REVIEW.md` 存在时读取它. 跳过 `Resolved` 和 `Won't Fix` findings. 按 referenced scope 对照当前工程事实验证 `Open` findings.
7. 将每条 `Open` finding 的验证结果规范化为 `Still Applies`, `Needs Review` 或 `No Longer Applies`, 并按 `status-summary.md` 输出到 `Open Review Findings`.
8. 如果只有 `CONTEXT.md` 存在, 从它 restore.
9. 如果只有 `HISTORY.md` 存在, 尽可能重建背景, 并说明缺少当前状态快照.
10. 如果两个文件都不存在, 说明该会话文件夹中没有可用 checkpoint 文件.
11. 不要把旧 history 当作当前状态.
12. 不要把未验证假设当作事实.
13. 如果 `HISTORY.md` 与 `CONTEXT.md` 冲突, 以 `CONTEXT.md` 作为当前状态依据.
14. 当恢复出的状态不完整, 来自推断或受冲突影响时, 说明信息来源和重建置信度.

## 输出风格

先输出 restore 独有内容:

- Restore source session folder.
- 已读取的 checkpoint 文件.
- 信息来源和置信度说明.

然后按 `../checkpoint-save/references/status-summary.md` 输出 restore source 的 status summary.
