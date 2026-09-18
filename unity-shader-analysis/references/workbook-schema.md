# MaliOC 分析工作簿

## 目录

- [输入契约](#输入契约)
- [工作簿结构](#工作簿结构)
- [Summary](#summary)
- [Analysis](#analysis)
- [阶段 Sheet](#阶段-sheet)
- [Manifest](#manifest)
- [Glossary](#glossary)

## 输入契约

Builder 的 Analysis 输入只接受 `schemaVersion: 4`. 顶层字段为 `status`, `run`, `variantSummaries`, `variants`, `comparisons` 和 `diagnostics`.

`comparisons` 是唯一的受控开销归因来源. 每项包含:

- `baselineVariantId`: 基线 Variant.
- `candidateVariantId`: 受控变化后的 Variant.
- `baselineKeywords`: 基线的实际 Material Keywords.
- `candidateKeywords`: 候选的实际 Material Keywords.
- `addedKeywords`: candidate 相对 baseline 新增的实际关键字.
- `removedKeywords`: candidate 相对 baseline 移除的实际关键字.
- `dependencyChain`: candidate 必须携带的依赖闭包.
- `multiCompileContext`: 当前对照使用的 Multi Compile Keywords.
- `comparisonType`: `SyntheticKeywordSweep`, `SyntheticKeywordCombination` 或 `ObservedExactDifference`.

所有 comparison 使用同一组实际关键字字段, 不允许 `keyword` 人工标签. 单关键字 comparison 的 `addedKeywords` 固定包含一项. `SyntheticKeywordCombination` 至少包含两项 `addedKeywords`, 其身份由规范排序后的 baseline 和 candidate 集合确定.

Builder 不再通过任意 Variant 两两比较推断因果. baseline 或 candidate 编译失败时保留对照, 但不计算数值开销.

Builder 同时要求一个 `schemaVersion: 1` 的 `recommendations.json`. 该文件由源码审阅产生, 可包含零到十项有源码依据的建议可执行建议. 每项必须包含 Priority, Expected Benefit, Comparison, Performance Evidence, Source Locations, Code Evidence, Proposed Change, Risk, Acceptance 和 Confidence. 详细结构见 [code-recommendations-schema.md](code-recommendations-schema.md).

Builder 只校验和渲染建议, 不读取 Shader 源码, 也不根据关键字名称自动推断代码改动.

## 工作簿结构

每个工作簿只包含一个 Shader, 固定包含 `Summary`, `Analysis`, `VS Position`, `VS Varying`, `PS Main`, `Manifest`, `Glossary`. 多 Shader 请求生成多份工作簿.

## Summary

记录 Source Type, Source Paths, Shader, BuildTarget, ShaderCompilerPlatform, Mali Core, SubShader, Pass, Multi Compile Combination Count, Variant Combination Count, Material Count, Variant Count, Comparison Count, Unity Version, MaliOC Producer, Build, Documentation, Schema 和最终状态.

Source Type 取 `Explicit`, `Scene`, `Directory` 或 `Synthetic Keyword Sweep`. Scene, Directory 和 Material 路径都从 `Assets/` 开始. Synthetic 的 Source Paths 记录 Shader asset path.

## Analysis

`Analysis` 使用中文撰写用户可读的当前测试报告, 固定包含三个章节:

- 结论摘要: 数据完整性, 三阶段范围, 首要变体组合热点, 最高资源风险, `最大变体组合开销`, `最大单关键字开销`和候选选择口径.
- 优化清单: 使用结构化建议文件, 展示精确源码位置, 当前代码证据, 修改方案, 风险, 验收标准, 预期收益和置信度. 可包含零到十项有源码依据的建议, 先按 Priority 从 `P0` 到 `P3` 排序, 再按 Expected Benefit 从 `High` 到 `Low` 排序.
- 性能证据: 在一张紧凑表中同时展示三阶段范围, 多关键字变体组合, 单关键字开销和 Resources 或 Shader Flags 风险. 三阶段范围和 `SyntheticKeywordCombination` 都显示为 `变体组合`; 多关键字项目名称直接使用 `addedKeywords` 并只归因于整个联合变化. 单关键字 comparison 显示为 `关键字`. 候选由正向 Total Delta 前五项和 Stack Spill Regression 前五项取并集, 去重后最多十项. 候选关键字覆盖数量对所有 `addedKeywords` 去重. `变体组合` 和 `关键字` 分别按变化值从高到低排序.

性能证据末尾保留解释边界: cycles 不跨阶段相加, Material Count 不代表运行时频率, `null` 不按 `0` 处理, 代码建议需要复测, 最终收益需要真机 GPU Profiler 验证.

`Analysis` 不冻结顶部行. 报告保留阶段 Sheet 来源行, 不生成综合分数.

## 阶段 Sheet

三个阶段 Sheet 使用完全一致的 Variant 顺序. Multi Compile Keywords 和 Material Keywords 均按 pragma 顺序比较, 前缀较短者优先. 每个 Variant 固定占三行:

1. `Total`: `performance.total_cycles`.
2. `Shortest`: `performance.shortest_path_cycles`.
3. `Longest`: `performance.longest_path_cycles`.

每条 path 输出全部 pipeline 的 `cycle_count`, `bound_pipelines` 和由 pipeline 最大值计算的 `Bottleneck Cycles`. Variant Properties 和 Shader Properties 根据 MaliOC 返回字段动态生成, 不使用固定白名单.

列分组为:

- Keywords: Multi Compile Keywords, Material Keywords.
- Performance: Path, Bottleneck Cycles, Bound Pipelines, 全部 pipeline cycles.
- Resources: MaliOC 返回的全部 Variant Properties.
- Shader Flags: MaliOC 返回的全部 Shader Properties.
- Environment: Driver, Filename, Architecture, Core, Revision, API, Shader Type.

顶部三行和第一列 Keywords 冻结. Keywords 左对齐, Path 居中, 其余数据右对齐.

## Manifest

Manifest 列顺序为 Keywords, Material Count, Compiled Material Path, Phase, Severity 和 Message. Variant 顺序与三张阶段表一致, 顶部三行和第一列 Keywords 冻结.

每个 Variant 使用一个数据块. Keywords, Material Count 和 Compiled Material Path 在子行间纵向合并. 每条 Diagnostic 占一个子行. 没有 Diagnostic 时保留一个空子行. 无 Variant 归属的 Discovery Diagnostic 放在末尾.

Material 入口使用实际参与编译的代表 Material 资产路径. Synthetic 使用 `Material Count = 0` 和 `Compiled Material Path = In-memory temporary material, not saved`.

## Glossary

Glossary 是固定术语表, 列顺序为 Category, Parameter, JSON Field, Unit, Meaning, Interpretation 和 Official Source. 内容覆盖报告中的 Performance, Resources 和 Shader Flags 字段, 包括本技能派生的 Bottleneck Cycles.

定义固定保存在 Builder 中, 不随单次分析数据变化. 每份工作簿稳定输出相同内容和 Arm 官方来源 URL. 顶部四行冻结.
