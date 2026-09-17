---
name: checkpoint-save
description: Save or refresh session checkpoints by writing CONTEXT.md and HISTORY.md. Use when the user asks to save, update, refresh, checkpoint, persist, or record current session context for long-running, multi-session, handoff-based, or review-driven agent work.
---

# checkpoint-save

## 目录

- [概览](#概览)
- [执行前检查](#执行前检查)
- [会话文件夹解析](#会话文件夹解析)
- [访问模式](#访问模式)
- [工作流](#工作流)
- [输出风格](#输出风格)

## 概览

创建或刷新当前会话 checkpoint. 本 skill 只写当前会话文件夹中的 `CONTEXT.md` 和 `HISTORY.md`.

`checkpoint-save` 是 checkpoint family 的 root skill. 它保存其他 `checkpoint-*` skill 共用的 reference 文件.

## 执行前检查

写入, 校验, 总结或输出 checkpoint 数据前, 必须读取:

- `references/file-contracts.md`
- `references/common-rules.md`
- `references/status-summary.md`

如果任一 required reference 不可用, 停止执行并报告缺失文件. 不要凭记忆重建 checkpoint contract.

## 会话文件夹解析

将当前会话文件夹解析为三种状态:

- 明确有: 当前对话或用户输入已经明确指向一个当前会话文件夹. 复用它.
- 明确没有: 当前对话没有可用会话文件夹线索, 且用户请求是在创建或刷新当前 checkpoint. 创建新的当前会话文件夹.
- 不确定: 现有线索无法识别唯一当前会话文件夹, 或用户同时提到多个路径但没有标明角色. 询问用户指定已有文件夹或确认创建新文件夹.

不要检查 `.agent-sessions/` 来猜测语义匹配的文件夹, 除非用户明确要求 discovery 或列出候选.

创建新文件夹时, 使用 `.agent-sessions/{YYYYMMDD}-{short-kebab-case-session-summary}/`, 并在输出中说明新建路径.

## 访问模式

- 可以读取相关项目文件, 以及当前会话文件夹中已有的 checkpoint 文件.
- 当前会话文件夹明确没有时, 可以创建当前会话文件夹.
- 只能写入当前会话文件夹中的 `CONTEXT.md` 和 `HISTORY.md`.
- 不得创建或修改其他产物, 除非用户明确要求额外文件.

## 工作流

1. 解析当前会话文件夹.
2. 如果已有 `CONTEXT.md` 和 `HISTORY.md`, 读取它们.
3. 对比 checkpoint 内容, 当前对话状态和当前项目文件.
4. 将 `CONTEXT.md` 重写为干净的当前状态快照. 不要机械追加 history.
5. 维护 `CONTEXT.md` 中的 `Work Artifacts`. 没有 work artifacts 时可以为空.
6. 向 `HISTORY.md` 追加一个新条目. 不要把新 history 合并进旧条目.
7. 保留有用的既有 history. 除非用户明确要求清理, 不要删除旧条目.
8. 将过期过程记录, 已拒绝方案, 已被取代的假设和仍有用的决策依据从 `CONTEXT.md` 移入新的 `HISTORY.md` 条目.
9. 同步每个文件的 `Table of Contents`.

`CONTEXT.md` 和 `HISTORY.md` 必须使用 `references/file-contracts.md` 中的结构.

## 输出风格

成功完成后输出:

- 会话文件夹.
- 已更新文件.
- 当前会话 status summary. 格式见 `references/status-summary.md`.
