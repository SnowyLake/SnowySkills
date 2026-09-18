---
name: unity-shader-analysis
description: 分析指定 Unity Material, Scene, 资产目录或 Shader 的受控变体, 使用 Mali Offline Compiler 比较静态开销并生成源码优化 Excel 报告.
disable-model-invocation: true
---

# Unity Shader Analysis

## 目录

- [范围与前提](#范围与前提)
- [分析与交付](#分析与交付)
- [解释边界](#解释边界)

## 范围与前提

每个 Shader 输出一份中文 Excel, 包含受控变体性能、编译诊断和有源码依据的优化建议. 本技能分析并提出建议, 不直接修改 Shader 或材质.

| 输入 | Scope | 数据来源 |
| --- | --- | --- |
| 一个或多个 `Assets/*.mat` 路径 | `Explicit` | 仅指定 Material |
| `Assets/` 下的 `.unity` 路径 | `Scene` | 该 Scene 中 Renderer 的 `sharedMaterials` |
| `Assets/` 下的资产文件夹 | `Directory` | `AssetDatabase.FindAssets("t:Material", folders)` 递归结果 |
| Shader 名称及关键字分析请求 | `Synthetic` | 无需磁盘 Material 的受控变体 |

范围缺失或存在会改变结果的歧义时询问, 不自行扩大扫描范围. 多 Shader 按 Shader 分组分析. Shader 全名优先精确匹配; 末段简写必须唯一. 默认 `SubShader = 0`, `Pass = ForwardLit`, 找不到时报告而不回退.

运行前阅读 [执行与环境](references/execution.md). 打包脚本依赖 PowerShell、MaliOC 和可连接目标 Unity Editor 的本地 uloop; 工作簿依赖 Node.js、`@oai/artifact-tool` 和 `jszip`. 先发现已安装能力, 再做只读连通性检查. 前提缺失时报告, 不自动安装工具或用静态 YAML 代替 Unity 数据.

## 分析与交付

1. 使用 `analyze-shader.ps1 -Mode Discover` 确认来源、Shader、目标 Pass 和关键字组. 操作参数见 [执行与环境](references/execution.md).
2. 按 [关键字选择与对照](references/keyword-selections.md) 准备 selections. 复用用户已有的合法选择; 仅补问缺失的 Multi Compile 选项或无法证明的 Synthetic 依赖. 再次 Discover 确认状态并报告组合数, 然后 Analyze. 多个组做笛卡尔积, 同组多选表示分开测试.
3. 使用 `collect-code-evidence.mjs` 从分析 JSON 中筛选热点并定位 include 图和条件块. 它取正向 Total Delta 前五项与 Stack Spill Regression 前五项的并集, 去重后最多十项; 这只是审阅入口, 不是建议数量配额.
4. 阅读实际 Shader 条件块、调用函数和数据来源, 按 [源码建议契约](references/code-recommendations-schema.md) 写 `recommendations.json`. 只保留有证据的建议, 最多十项; 无可执行建议时使用空数组并说明证据限制, 不为凑数扩展任务.
5. 按 [工作簿契约](references/workbook-schema.md) 使用 `build-workbook.mjs` 生成报告. 检查脚本输出、公式扫描与全部七张 Sheet 的预览; 回查建议中的路径和行号. 交付工作簿及必要的缺失数据或证据说明.

Scene 未加载时可临时 additive 打开, 收集后关闭且不保存. Synthetic 使用临时内存材质, 不写回资产. 若脚本状态要求补充选择或依赖, 先解决对应缺口, 不将未完成分析当作完整结果.

## 解释边界

- 关键字开销只来自分析 JSON 中显式记录的 `comparisons`. 多关键字变化只归因于整个组合, 不把联合开销分摊到单个关键字.
- MaliOC cycles 仅用于相同编译条件下的静态相对比较, 不等同于 GPU 时间或 FPS, 不跨 VS Position、VS Varying 和 PS Main 相加. 实际收益需真机验证.
- `null` 保持缺失, 不按 `0` 排名; Material 数量不代表运行时频率. 编译失败和 MaliOC 的 warning、note、error 保留在诊断中.
- 证据包是定位辅助, 不能替代源码审阅. 当前代码事实、拟议改动和已验证收益分开描述; 不预测改动后的精确 cycles.
