---
name: snapdragon-profiler-statistics
description: 将 Snapdragon Profiler 导出的场景 CSV 汇总为 Excel, 统计全部相机的 Pass Clocks 和主相机 Opaque + Transparent 的 ALU/EFU.
---

# Snapdragon Profiler Statistics

## 目录

- [输入与适用边界](#输入与适用边界)
- [执行](#执行)
- [统计口径](#统计口径)
- [交付](#交付)

## 输入与适用边界

使用 `scripts/build.mjs` 校验 CSV 并生成一个工作簿, 每个有效场景一张 Sheet. 样式和标准 Pass 顺序已内置, 不依赖额外的基准 `.xlsx` 文件.

先按表头识别数据, 再按用户指定场景名或去除 `clocks` / `alu` 后的共同文件名前缀配对. 只有配对歧义会改变结果时才询问. 脚本通过重复的 `--scene` 参数接收配对结果, 不自动配对文件.

| 面板 | 必需列 | 有效数据要求 |
| --- | --- | --- |
| Clocks | `ID`, `Name`, `Clocks` | 相机范围内至少一个可识别直接 Pass |
| ALU/EFU | `ID`, `Name`, `ALU / Fragment`, `ALU / Vertex`, `EFU / Fragment`, `EFU / Vertex` | 主相机的 `DrawOpaqueObjects` 和 `DrawTransparentObjects` 均有带 ID 的 `gl*Draw*` 明细, 且计数校验通过 |

当前解析器针对含 `UniversalRenderPipeline.RenderSingleCameraInternal: <相机名>` 标记的 Unity URP CSV. 相机范围截止到下一个相机标记或 `PlayerEndOfFrame`. 直接 Pass 通过空 ID、数值列和容器/嵌套标记排除表识别, 不是通用层级解析器. 不匹配该结构或出现未识别嵌套标记时, 先核对 CSV 范围和汇总口径, 不把未知层级当作确定的直接 Pass.

## 执行

依赖 Node.js 和 `@oai/artifact-tool`. 宿主提供依赖加载器时使用其返回路径; 有表格 Skill 时仅在生成工作簿阶段遵循其适用要求, 不假定特定 Skill 或埋点脚本一定存在.

ESM 从脚本所在目录解析依赖. 若依赖位于外部 packages 目录, 将 `scripts/build.mjs` 复制到可写会话目录, 并在同目录创建指向该 packages 路径的 `node_modules` junction (Windows) 或符号链接. 不只更改 cwd, 不自动安装缺失依赖, 不修改已安装 Skill 来处理单次任务.

先检查配对后的所有场景, 再用相同参数生成文件:

```powershell
node build.mjs --check-only --scene "社区" --clocks "社区clocks.csv" --alu "社区alu.csv" --scene "家园" --clocks "家园clocks.csv"
node build.mjs --output "snapdragon-profiler-statistics.xlsx" --preview-dir "previews" --scene "社区" --clocks "社区clocks.csv" --alu "社区alu.csv" --scene "家园" --clocks "家园clocks.csv"
```

读取 JSON 诊断: 每个场景两组都有效则输出两面板; 仅一组有效则保留该面板; 都无效则跳过. 所有场景无有效数据时退出码为 `2`, 不创建空工作簿; 其他执行失败为 `1`. 修正影响结果的缺口后只重跑受影响检查. 修改统计脚本时可运行 `node build.mjs --self-test`.

## 统计口径

- Clocks 覆盖所有相机, 排除相机/Renderer 容器、`RenderLoop.*` 及 `NESTED_MARKERS` 中的嵌套阶段, 避免重复计数. 内置 `PASS_ALIASES` 合并别名; 同一相机范围内同名 Pass 求和.
- `STANDARD_PASSES` 固定 MainCamera/UICamera 的展示顺序. 有效采样中未出现的标准 Pass 显示 `0`, 新 Pass 追加其后; 补零不能使没有 Pass 数据的采样变为有效.
- Clocks 除以 `10000`, 以 `W` (万 clocks) 显示, 不换算为毫秒. Total 求和与逐 Pass 占比使用工作表公式.
- ALU/EFU 优先使用名为 MainCamera 的范围, 否则使用唯一同时含两个目标 Pass 的相机; 多个候选时报告歧义. 合并两个 Pass 中带 ID 的 `gl*Draw*` 明细, 分别计算四个计数器的 Max、Min 和算术 Avg, 不做 draw 大小加权.
- 空白或非数值计数器不参与统计, 明确的 `0` 保留. 每项计数器的明细和与两 Pass 汇总和比较, 容差为 `max(0.11, 有效明细数 * 0.005 + 0.02)`, 对应两位小数累积舍入; 超限则省略整个 ALU/EFU 面板.

## 交付

保留内置样式: 深蓝标题、浅蓝表头、灰色 Total 行、细灰边框; Clocks 和百分比一位小数, ALU/EFU 两位小数. 两面板分别位于 `A:D` 和 `F:I`, 单面板位于 `A:D`. 场景 Sheet 名清理 Excel 禁止字符并限制在 31 字符内, 保证唯一.

生成后查看每个 Sheet 的预览, 核对标题、数据和来源说明是否可读, 同时检查公式错误扫描结果. 如需版式调整, 修改会话目录中的脚本副本并重跑. 交付单个 `.xlsx`, 简述省略的统计及原因; 默认不附运行脚本、预览图、原始数据页或额外图表.
