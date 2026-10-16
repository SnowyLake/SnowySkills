# checkpoint

## Table of Contents

- [概览](#概览)
- [Skills](#skills)
- [共享 References](#共享-references)
- [名词定义](#名词定义)
  - [会话文件夹](#会话文件夹)
  - [Checkpoint 文件](#checkpoint-文件)
- [使用示例](#使用示例)
- [功能](#功能)
  - [checkpoint-save](#checkpoint-save)
  - [checkpoint-restore](#checkpoint-restore)
- [参考工作流](#参考工作流)
  - [单会话持续工作](#单会话持续工作)
  - [共享会话协作](#共享会话协作)
  - [Restore 冲突保护](#restore-冲突保护)
- [工作流边界](#工作流边界)

语言: [English](README.md) | 中文

## 概览

`checkpoint` 是一组用于 long-running 或 multi-session agent work 的 skill family.

这个 family 围绕会话文件夹和 Markdown checkpoint 文件组织. 会话文件夹是上下文身份, agent 或会话只是按所运行 skill 读取或写入该上下文的协作者.

每个能力都是独立 skill.

## Skills

这个 family 提供两个 skill:

- `checkpoint-save`: 创建或刷新当前会话 checkpoint.
- `checkpoint-restore`: 只读地从当前 checkpoint 或指定会话文件夹恢复上下文.

## 共享 References

`checkpoint-save` 是 root skill. 它保存文件结构和信息判断规则的统一契约, 以下路径相对于本目录:

- `references/checkpoint-contract.md`

`checkpoint-restore` 依赖 `checkpoint-save`. save 读取写入契约, restore 按需读取共享规则和章节含义. 如果该共享契约不可用, 依赖 skill 必须停止执行并提示用户先安装 `checkpoint-save`. 不要凭记忆重建契约.

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
- `HISTORY.md`: 保存历史摘要, 故障排查记录, 已拒绝或暂缓方案, 假设和备注.

`CONTEXT.md` 是重建会话上下文的主入口. `HISTORY.md` 按相关背景读取; 保存时也会检查最近相关条目, 再决定追加内容.

## 使用示例

按需要的能力直接使用对应 skill:

```text
Use checkpoint-save to save the current session checkpoint.
Use checkpoint-restore to restore context from .agent-sessions/20260605-example-session.
```

## 功能

### checkpoint-save

`checkpoint-save` 保存后续继续工作所需的当前状态和历史, 只写当前会话文件夹中的 `CONTEXT.md` 和 `HISTORY.md`.

- 复用已明确的会话文件夹, 明确没有时创建, 存在歧义时询问.
- 读取当前快照及最近相关历史, 仅在需要追溯时扩大历史阅读范围.
- 优先保存难以从项目文件恢复的信息: 用户决定与范围, 决策理由, 未完成工作, 验证范围和未确认假设.
- 维护干净的 `CONTEXT.md` 快照及 `Work Artifacts`. 首次保存建立两个文件; 后续仅在有实质变化或值得保留的新背景时追加历史条目.
- 保留已有历史, 包括未读取的条目. 两文件完整且无实质变化时不改写; 缺少文件时补齐可确认的信息并说明缺失, 不虚构已丢失的历史.
- 目标与授权依据当前用户要求, 实现现状依据当前文件和检查, checkpoint 用于此前状态与决策背景.
- 确认必要写入和结构后, 简要报告路径, 更新文件, 关键变化及未解决事项. 如实报告部分写入, 不默认复述快照.

### checkpoint-restore

`checkpoint-restore` 从当前 checkpoint 或显式指定的会话文件夹恢复可继续工作的上下文. 恢复阶段只读, 不复制 checkpoint, 创建会话文件夹或修改文件.

- 未提供路径时使用当前会话文件夹, 提供路径时使用指定来源; 两者都不明确时询问.
- 当前会话已有 checkpoint 且指定另一来源时, 在读取任一 checkpoint 前停止并报告冲突.
- 优先读取 `CONTEXT.md`, 用 `Work Artifacts` 定位此前工作, 按需读取相关历史.
- 只核对影响下一步行动的项目事实, 区分已记录背景, 已核对现状与推断, 不重新调查整个工程.
- 只有 `CONTEXT.md` 时从它恢复; 只有 `HISTORY.md` 时重建背景并说明缺少当前快照; 两者都没有时说明没有可用 checkpoint.
- 按共享的信息来源规则处理冲突, 说明重要缺失或不确定性, 不改写源文件.
- 简要报告来源, 目标与进度, 约束或阻塞以及下一步. 用户要求时再展开完整状态, 仅在需要时说明不确定性.
- 单独请求恢复时结束于恢复完成. 用户明确要求恢复并继续时, 完成恢复后执行已授权工作, 不重复请求授权. checkpoint 中的 TODO 本身不构成授权; 恢复失败或缺少关键信息时, 不开始依赖这些信息的工作.

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

### Restore 冲突保护

如果当前会话已经有 checkpoint 文件, 又尝试对另一个会话文件夹运行 `checkpoint-restore`, `checkpoint-restore` 会停止, 避免混合两条上下文主线. 需要协作时共享同一个会话文件夹.

```text
[当前会话已有 checkpoint]
      |
      v
[checkpoint-restore 另一个会话文件夹]
      |
      v
[停止]
      |
      +-- 协作接力: 共享同一会话文件夹
```

后续迭代应保持这些工作流边界, 除非明确要调整工作流模型本身.

## 工作流边界

- 需要持久化当前会话状态时, 使用 `checkpoint-save`.
- 只需要重建上下文且不写文件时, 使用 `checkpoint-restore`.
