---
name: checkpoint-restore
description: Read a saved session checkpoint to recover context without modifying files.
---

# checkpoint-restore

## 目录

- [目标与边界](#目标与边界)
- [会话文件夹解析](#会话文件夹解析)
- [恢复](#恢复)
- [完成与续接](#完成与续接)

## 目标与边界

从 checkpoint 重建可继续工作的目标, 状态, 约束和下一步. 恢复阶段只读, 不复制 checkpoint, 创建会话文件夹或修改任何文件.

本 skill 依赖 `checkpoint-save` 的 [checkpoint-contract.md](../checkpoint-save/references/checkpoint-contract.md). 读取其中的共享规则, 按需查看文件与章节含义; 不必为只读恢复加载全部写入格式. 若文件不可用, 停止并提示先安装 `checkpoint-save`, 不凭记忆重建契约.

## 会话文件夹解析

解析 restore source session folder:

1. 如果用户没有指定会话文件夹, 解析当前会话文件夹.
2. 如果用户指定了会话文件夹, 将其作为 restore source.
3. 如果用户指定了另一个会话文件夹, 且当前对话自己的会话文件夹已经有 checkpoint 文件, 停止并报告冲突. 不要读取, 合并, 复制或修改任一 checkpoint.
4. 如果指定的会话文件夹就是当前会话文件夹, 允许 restore.
5. 如果当前文件夹不明确且用户未指定路径, 要求用户指定一个已有会话文件夹.

## 恢复

- 优先读取 `CONTEXT.md`, 用 `Work Artifacts` 定位此前工作范围. 需要理解决策背景, 排障依据, 已拒绝方案或历史不确定性时, 再读取相关 `HISTORY.md` 条目.
- 只核对影响下一步行动的关键项目事实, 不为恢复而重新调查整个工程. 区分 checkpoint 记录, 已核对的现状和推断, 不把未验证假设当作事实.
- 只有 `CONTEXT.md` 时从它恢复. 只有 `HISTORY.md` 时尽可能重建背景, 说明缺少当前快照, 不把旧历史直接当作当前状态. 两个文件都不存在时报告没有可用 checkpoint, 不宣称恢复成功.
- 若文件不完整或存在冲突, 按共享规则判断信息来源, 指出影响续接的缺失, 过时记录或不确定性, 不改写源文件.

## 完成与续接

简要说明恢复来源, 当前目标与进度, 关键约束或阻塞, 以及可以接着做什么. 仅在存在重要缺失, 冲突或推断时说明依据和不确定性; 不固定输出置信度模板, 不默认逐段复述快照. 用户要求完整状态时再展开.

单独请求恢复时, 恢复完成后结束. 用户同时要求恢复并继续时, 完成恢复后执行已授权的后续任务, 不再次请求同一授权. 仅从 checkpoint 读到 TODO 不构成执行授权; 恢复未完成或关键信息不足时, 不据此开始依赖这些信息的工作.
