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
  - [checkpoint-read](#checkpoint-read)
- [参考工作流](#参考工作流)
  - [单会话持续工作](#单会话持续工作)
  - [共享会话协作](#共享会话协作)
  - [跨会话审查](#跨会话审查)
- [工作流边界](#工作流边界)

语言: [English](README.md) | 中文

## 概览

`checkpoint` 是一组用于 long-running 或 multi-session agent work 的 skill family.

这个 family 围绕会话文件夹和 Markdown checkpoint 文件组织. 保存记录当前会话, 读取提供当前或其他会话的背景, 用于续接, 审查或回答问题. 读取来源文件夹不会将其设为当前会话的保存位置.

每个能力都是独立 skill.

## Skills

这个 family 提供两个 skill:

- `checkpoint-save`: 创建或刷新当前会话 checkpoint.
- `checkpoint-read`: 只读地读取当前 checkpoint 或指定会话文件夹, 为续接, 审查或回答问题提供背景.

## 共享 References

`checkpoint-save` 是 root skill. 它保存文件结构和信息判断规则的统一契约, 以下路径相对于本目录:

- `references/checkpoint-contract.md`

`checkpoint-read` 依赖 `checkpoint-save`. save 读取写入契约, read 按需读取共享规则和章节含义. 如果该共享契约不可用, 依赖 skill 必须停止执行并提示用户先安装 `checkpoint-save`. 不要凭记忆重建契约.

## 名词定义

### 会话文件夹

会话文件夹用于保存一条上下文主线:

```text
.agent-sessions/{YYYYMMDD}-{short-kebab-case-session-summary}/
```

保存时区分当前会话文件夹明确有, 明确没有和不确定三种状态: 明确有时复用, 明确没有时创建, 不确定时询问. 读取时优先使用指定来源, 未指定时使用已明确的当前会话文件夹; 两者都不明确时要求指定已有文件夹. 仅作为读取来源的路径不作为保存位置的候选.

### Checkpoint 文件

Checkpoint 文件用于记录会话上下文:

- `CONTEXT.md`: 保存当前目标, 要求, 决策, 工作状态, 下一步行动, 相关文件和续接必需的背景.
- `HISTORY.md`: 可选的历史记录, 保存失败证据, 已拒绝或暂缓方案以及重要决策变化. 普通进度更新只写入 `CONTEXT.md`.

`CONTEXT.md` 是读取会话上下文的主入口. `HISTORY.md` 按相关背景读取; 保存时检查已有的相关条目, 再决定追加内容. 历史文件不存在是正常情况.

当前快照采用 [OpenCode v2.3.0 会话压缩](https://github.com/anomalyco/opencode/blob/v2.3.0/packages/core/src/session/compaction.ts#L173-L254) 的七个章节: `Objective`, `Requirements`, `Decisions`, `Work State`, `Next Move`, `Relevant Files` 和 `Important Context`. `Work State` 按已完成, 进行中和阻塞目标组织. 不适用的章节可以省略, 短 checkpoint 无需目录.

文件工作流补充了明确的验证结果与范围, 以及跨会话需要的工作目录或外部产物位置. 可恢复的代码和仓库规则使用引用, 不重复展开. 未完成请求保留在快照中, 已解决或过时内容移除. `Relevant Files` 最多列出 15 个有用入口, 更大范围使用目录或 diff 引用, 不再维护第二份产物列表. 模板及更新规则见[共享契约](references/checkpoint-contract.md).

读取兼容旧章节和历史结构, 不改写文件. 后续保存有实质更新时, 才按当前结构整理该会话快照; 不迁移其他 checkpoint 或重写已有历史.

## 使用示例

按需要的能力直接使用对应 skill:

```text
Use checkpoint-save to save the current session checkpoint.
Use checkpoint-read to read .agent-sessions/20260605-example-session.
Use checkpoint-read to read .agent-sessions/20260605-example-session and review the actual changes.
```

## 功能

### checkpoint-save

`checkpoint-save` 保存供后续读取, 续接或审查的当前状态和历史, 只写当前会话文件夹中的 `CONTEXT.md` 和 `HISTORY.md`.

- 复用已明确的会话文件夹, 明确没有时创建, 存在歧义时询问.
- 读取其他会话不会改变保存位置. 用户明确指定共享文件夹作为当前会话文件夹时, 才按该指定保存.
- 读取当前快照及最近相关历史, 仅在需要追溯时扩大历史阅读范围.
- 优先保存难以从项目文件恢复的信息: 用户决定与范围, 决策理由, 未完成工作, 验证范围和未确认假设.
- 维护精简快照, 同步工作状态与下一步, 清除已解决或过时内容, 保留未完成请求. 验证记录包含范围和有关的未验证部分; 保存本身不要求重新运行测试.
- 首次保存建立 `CONTEXT.md`. 仅在有值得追溯的新背景时创建或追加 `HISTORY.md`, 不重复记录普通进度, 不自动归档从快照删下来的所有内容.
- 保留已有历史, 包括未读取的条目. 无实质变化时保持文件不变, 包括旧格式快照. 缺少可选历史是正常情况; 缺少当前快照或存在明确的信息丢失时说明缺失, 仅重建可确认的信息.
- 目标与授权依据当前用户要求, 实现现状依据当前文件和检查, checkpoint 用于此前状态与决策背景.
- 确认必要写入和结构后, 简要报告路径, 更新文件, 关键变化及未解决事项. 如实报告部分写入, 不默认复述快照.

### checkpoint-read

`checkpoint-read` 读取当前或指定会话的目标, 状态, 决策, 约束和工作产物. 读取阶段不复制 checkpoint, 创建会话文件夹或修改文件. 当前任务由用户本次请求决定, 不自动接管来源会话的目标和 TODO.

- 未提供路径时使用当前会话文件夹, 提供路径时使用指定来源; 两者都不明确时询问.
- 即使当前会话已有 checkpoint, 也允许读取其他会话. 区分读取来源与当前会话文件夹, 保持保存位置不变.
- 优先读取 `CONTEXT.md`, 用 `Relevant Files` 定位相关工作, 按需读取历史. 兼容旧章节和 `Work Artifacts`, 不以符合新模板作为读取前提.
- 只核对影响当前请求的项目事实, 区分已记录背景, 已核对现状与推断, 不为读取而重新调查整个工程.
- 只有 `CONTEXT.md` 时读取该快照; 只有 `HISTORY.md` 时重建背景并说明缺少当前快照, 不把旧历史当作当前状态; 两者都没有时说明没有可用 checkpoint.
- 按共享的信息来源规则处理冲突, 说明重要缺失或不确定性, 不改写源文件.
- 简要报告来源, 来源会话的目标与进度, 以及与当前请求相关的约束或阻塞. 用户要求时再展开完整状态, 仅在需要时说明不确定性.
- 单独请求读取时, 读取完成后结束. 同时要求审查, 续接或回答问题时, 继续完成已授权工作, 不重复请求授权. checkpoint 中的 TODO 本身不构成授权; 读取未完成或缺少关键信息时, 不开始依赖这些信息的工作.
- 审查时核对实际文件, 改动和必要验证. 文件索引只帮助定位工作, checkpoint 中的完成说明和验证结论不能代替独立审查.

## 参考工作流

### 单会话持续工作

单个会话在上下文压缩前运行 `checkpoint-save`, 将当前仍然有效的信息写入 checkpoint. 上下文压缩后运行 `checkpoint-read`, 从 checkpoint 重建会话上下文, 按用户要求继续工作.

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
[checkpoint-read 重建会话上下文]
      |
      v
[继续已授权工作]
      |
      v
[checkpoint-save 刷新 checkpoint]
```

### 共享会话协作

用户明确将同一个文件夹指定为各协作者的当前会话文件夹时, 多个 agent 或会话可以共享一条上下文主线. 每个协作者读取该文件夹, 继续已授权工作, 再保存新状态. 单独读取不会建立这种共享保存关系.

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
[Agent B checkpoint-read]
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
[Agent A checkpoint-read]
```

### 跨会话审查

即使会话 B 已有自己的 checkpoint, 也可以读取会话 A 的 checkpoint. 用户要求审查时, B 根据 A 的记录定位工作范围并核对实际改动. A 的 TODO 不会自动成为 B 的任务, 后续保存仍将 B 的状态写入 B 自己的文件夹.

```text
[会话 B 已有自己的 checkpoint]
      |
      v
[checkpoint-read 会话 A, 用于用户要求的审查]
      |
      v
[审查实际文件与改动]
      |
      v
[按要求 checkpoint-save 会话 B]
```

后续迭代应保持这些工作流边界, 除非明确要调整工作流模型本身.

## 工作流边界

- 需要持久化当前会话状态时, 使用 `checkpoint-save`.
- 需要理解已有工作记录且不写文件时, 使用 `checkpoint-read`; 后续审查, 续接或回答问题由当前请求决定.
