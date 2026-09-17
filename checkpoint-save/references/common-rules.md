# Common Rules

## 目录

- [适用范围](#适用范围)
- [全局不变量](#全局不变量)
- [Reference 读取规则](#reference-读取规则)
- [语言和格式](#语言和格式)

## 适用范围

这些规则适用于 checkpoint skill family 中的所有 skill.

每个 skill 还必须遵守自己的 `SKILL.md` workflow, 以及 `file-contracts.md` 中定义的文件结构.

## 全局不变量

- Checkpoint 文件存放在项目根目录的 `.agent-sessions/{YYYYMMDD}-{short-kebab-case-session-summary}/` 下. summary 片段使用小写 kebab-case, 并优先保持简洁.
- 当会话文件夹不明确时, 不要检查 `.agent-sessions/` 来猜测语义匹配的文件夹, 除非用户明确要求 discovery 或列出候选.
- 当 checkpoint 文件与当前项目文件冲突时, 优先相信当前项目文件.
- 只把 `Work Artifacts` 当作 navigation index. 它不是完整 diff, 不是事实来源, 也不是 handoff 复制白名单.
- 不要执行 `TODO` 项, 修改项目文件或继续实现, 除非用户明确要求后续工作.

## Reference 读取规则

- 读取, 写入, 校验, 总结或输出 `CONTEXT.md`, `HISTORY.md`, `REVIEW.md`, `Work Artifacts`, handoff entries 或 findings 前, 必须读取 `file-contracts.md`.
- 输出 status summary 前, 必须读取 `status-summary.md`.
- 如果 required reference 缺失或不可用, 停止执行并报告缺失文件. 不要凭记忆重建 contract.
- 依赖 skill 从 `../checkpoint-save/references/` 读取共享 references. 如果该路径不可用, 提示用户先安装 `checkpoint-save`.

## 语言和格式

写入 checkpoint Markdown 文件或 review 输出时:

- 保留 `file-contracts.md` 中要求的文件名和结构标题, 除非项目级指令明确覆盖它们.
- 把英文结构标题视为文件 contract, 不视为正文默认语言.
- 正文语言优先遵循项目级或用户级指令.
- 如果没有项目级或用户级语言指令, 正文使用当前对话语言.
- 这条规则适用于 `CONTEXT.md`, `HISTORY.md`, handoff entries 和 `REVIEW.md`.
