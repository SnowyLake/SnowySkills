---
name: checkpoint-handoff
description: Handoff, migrate, branch, or take over checkpoint context from a source session folder into a target current session folder. Use when the user asks to save restored context into a new session, transfer checkpoint context, or branch a session.
---

# checkpoint-handoff

## 目录

- [概览](#概览)
- [执行前检查](#执行前检查)
- [会话文件夹解析](#会话文件夹解析)
- [访问模式](#访问模式)
- [工作流](#工作流)
- [源会话文件夹保护规则](#源会话文件夹保护规则)
- [非 Checkpoint 产物处理](#非-checkpoint-产物处理)
- [目标 Checkpoint 处理](#目标-checkpoint-处理)
- [输出风格](#输出风格)

## 概览

读取 source session folder, 重建其中仍然有效的上下文, 并将重建后的 checkpoint 保存到 target session folder.

如果用户只要求读取或重建上下文, 没有要求保存, 迁移, 分支, 接管或写入 target session folder, 使用 `checkpoint-restore`, 不使用本 skill.

## 执行前检查

本 skill 依赖 `checkpoint-save`.

执行前必须读取:

- `../checkpoint-save/references/file-contracts.md`
- `../checkpoint-save/references/common-rules.md`
- `../checkpoint-save/references/status-summary.md`

如果任一文件不可用, 停止执行并提示用户先安装 `checkpoint-save`. 不要凭记忆重建 checkpoint contract.

## 会话文件夹解析

`checkpoint-handoff` 解析两个会话文件夹:

- Source session folder: handoff 读取的旧会话文件夹.
- Target session folder: handoff 写入的当前对话会话文件夹.

解析 source session folder:

1. 如果用户指定了 source folder, 使用它.
2. 如果用户没有指定 source folder, 要求用户指定一个已有 source session folder.
3. 不创建 source session folder.

解析 target session folder:

1. 将 target 解析为明确有, 明确没有或不确定.
2. 明确有: 当前对话或用户输入已经明确指向 target session folder. 使用它.
3. 明确没有: 当前对话没有可用 target folder 线索, 且用户要求接管, 迁移或分支到新会话. 创建新的 target session folder.
4. 不确定: 询问用户指定已有 target folder 或确认创建新文件夹.
5. 不要检查 `.agent-sessions/` 来猜测语义匹配的 target, 除非用户明确要求 discovery 或列出候选.
6. 创建新的 target folder 后, 在输出中说明路径.
7. 如果 target 已经包含 checkpoint 文件, 停止并报告冲突. 不要读取, 合并, 复制或修改任一 checkpoint.
8. 不要把 source folder 用作 target folder.

## 访问模式

- Source session folder 只读.
- Target session folder 可读写.
- 只可以复制 source session folder 内部的 non-checkpoint artifacts.
- 不得复制项目文件或 source session folder 外部的任何文件, 即使 `Work Artifacts` 引用了它们.
- 不得修改项目文件, 除非用户明确要求后续工作.

## 工作流

1. 解析 source session folder.
2. 确认 source session folder 存在.
3. 确认 source session folder 包含 `CONTEXT.md`.
4. 如果 source 校验失败, 停止并报告问题. 不要创建 checkpoint 文件, 创建 target folder, 分类 artifacts, 复制文件或搜索其他文件夹.
5. 解析 target session folder.
6. 如果 target 包含 `CONTEXT.md` 或 `HISTORY.md`, 停止并报告冲突. 不要读取, 合并, 复制或修改任一 checkpoint.
7. 读取 source `CONTEXT.md`.
8. 当 source `HISTORY.md` 存在时读取它.
9. 读取 `Work Artifacts`, 用于快速理解之前的工作范围.
10. 扫描 source session folder 中的其他文件.
11. 将 source folder 内部的 non-checkpoint 文件分类为仍然相关的 artifacts 或历史 / 过期 artifacts. 对 source `REVIEW.md` 使用下方专门规则.
12. 根据分类决定复制或丢弃哪些 source-folder artifacts, 不等待用户确认.
13. 在 handoff entry 中记录 copied 和 discarded artifacts, 方便用户后续要求修正.
14. 创建或更新 target session folder.
15. 将 target `CONTEXT.md` 写为干净的当前状态快照.
16. 写入 target `HISTORY.md`, 保留有用的 source history, 并追加一个 handoff entry.
17. 将仍然相关的 artifacts 从 source folder 复制到 target folder.
18. 必要时改写 target `CONTEXT.md`, target `HISTORY.md` 和 copied artifacts 中的引用. 不得改写保留下来的 source review history 文件中的 `Reviewed Session`.
19. 校验 copied files 和 rewritten references.
20. 报告 source, target, updated files, copied artifacts, discarded artifacts 和 reference rewrites, 然后输出 target status summary.

## 源会话文件夹保护规则

- Source files 只读.
- Source session folder 必须包含 `CONTEXT.md`.
- 如果 source folder 不存在, 停止并报告问题.
- 如果 source folder 存在但不包含 `CONTEXT.md`, 停止并报告缺少 `CONTEXT.md`.
- 如果 source folder 只包含 `HISTORY.md` 或其他生成文档, 停止并报告缺少 `CONTEXT.md`.
- 当 source 校验失败时, 不要创建 checkpoint 文件, 推断缺失 checkpoint 内容, 创建 target folder, 分类 artifacts, 复制文件或搜索其他文件夹.

## 非 Checkpoint 产物处理

- 只分类 source session folder 内部的 non-checkpoint 文件.
- 不要复制项目文件或 source session folder 外部的文件.
- 使用 source `CONTEXT.md` 中的 `Relevant Files`, `Work Artifacts`, `TODO`, `Next Actions` 和 `Known Risks` 等章节来分类 source-folder artifacts.
- 仍会影响未来决策或实现的 source-folder 文件视为仍然相关的 artifacts.
- 已拒绝, 已暂缓, 已被取代, 过期或纯历史过程文档视为历史 / 过期 artifacts.
- 复制或丢弃 non-checkpoint source artifacts 前, 不停下来请求确认.
- `Discarded` 表示没有复制到 target. 绝不删除 source files.
- Source `REVIEW.md` 默认视为历史 / 过期 artifact 并丢弃, 因为它审阅的是 source folder, 不是 target folder.
- 不得将 source `REVIEW.md` 复制为 target `REVIEW.md`.
- 如果用户明确要求保留 source `REVIEW.md`, 只能把它复制为历史文件, 例如 `REVIEW.from-{source-session-folder-name}.md`, 并记录在 copied files 中. `{source-session-folder-name}` 只取 source folder 末段名称.
- 保留 source `REVIEW.md` 时, 不得改写 `Reviewed Session`.
- Target `REVIEW.md` 只能由 `checkpoint-review` 生成, 不由 handoff 复制得到.

## 目标 Checkpoint 处理

- 如果 target session folder 已经包含 `CONTEXT.md` 或 `HISTORY.md`, 停止并报告冲突. 不要读取, 合并, 复制或修改任一 checkpoint.
- Target `CONTEXT.md` 必须是干净的当前状态快照, 不是 source `CONTEXT.md` 的机械复制.
- Target `CONTEXT.md` 必须在 `Current State` 下包含一条简洁 provenance note, 标明 source session folder.
- 详细 handoff records 属于 target `HISTORY.md`, 不属于 target `CONTEXT.md`.
- Target `HISTORY.md` 必须保留有用的 source history, 并追加一个 handoff entry.
- Handoff entry 必须记录 source folder, target folder, copied checkpoint files, copied artifacts, discarded artifacts, reference rewrites, user overrides, missing optional source files 和 unresolved uncertainty.

## 输出风格

先输出 handoff 独有内容:

- Source session folder.
- Target session folder.
- Updated files.
- Copied artifacts.
- Discarded artifacts.
- Reference rewrites.

然后按 `../checkpoint-save/references/status-summary.md` 输出 target session 的 status summary.
