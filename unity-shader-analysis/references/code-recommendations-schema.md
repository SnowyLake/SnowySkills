# Shader 代码优化建议

## 目录

- [用途](#用途)
- [输入结构](#输入结构)
- [字段要求](#字段要求)
- [质量门槛](#质量门槛)

## 用途

`recommendations.json` 保存代码审阅后形成的可执行优化建议. `build-workbook.mjs` 只负责校验和渲染该文件, 不根据关键字名称自动生成修改方案.

建议应优先覆盖 `collect-code-evidence.mjs` 输出的 comparison 候选. 候选由正向 Total Delta 前五项和 Stack Spill Regression 前五项取并集, 去重后最多十项, 并按最大正向 Total Delta 从高到低排列. 建议数量由证据决定, 最多十项; 无可执行建议时使用空数组, 不用泛泛建议补足数量.

## 输入结构

```json
{
  "schemaVersion": 1,
  "shader": "Example/Lit",
  "recommendations": [
    {
      "priority": "P1",
      "expectedBenefit": "High",
      "title": "Reuse the normalized view direction",
      "comparison": "_AOFIELD_ON",
      "performanceEvidence": "PS Main Total 25.25 -> 33.05 cycles, +7.80 cycles under the recorded controlled comparison.",
      "sourceLocations": [
        "UnityProj/Packages/example/Shaders/example_pass.hlsl:217-219",
        "UnityProj/Packages/example/Shaders/example_feature.hlsl:24-36"
      ],
      "codeEvidence": "The caller already owns a normalized view direction, while the callee rebuilds and normalizes the same direction.",
      "proposedChange": "Pass the existing normalized view direction into the helper and remove the duplicate subtraction and normalize operation.",
      "risk": "The existing helper flips the normal by view side, so the sign convention must remain unchanged.",
      "acceptance": "Re-run the same _AOFIELD_ON comparison. Total cycles must decrease without new stack spilling, and AO orientation must match reference captures.",
      "confidence": "High"
    }
  ]
}
```

## 字段要求

- `schemaVersion`: 固定为 `1`.
- `shader`: 必须与 Analysis JSON 中的唯一 Shader 完全一致.
- `recommendations`: 可包含零到十项有源码依据的建议.
- `priority`: 只允许 `P0`, `P1`, `P2`, `P3`.
- `expectedBenefit`: 只允许 `High`, `Medium`, `Low`.
- `title`: 简短描述本次代码改动, 不重复泛化目标.
- `comparison`: 使用 Analysis JSON 中存在的实际关键字. 单关键字直接写关键字, 同一建议覆盖多个独立 comparison 时逐项写出真实关键字, 变体组合按 Shader pragma 顺序使用 ` | ` 连接全部 `addedKeywords`. 不允许人工关键字或 label.
- `performanceEvidence`: 写明阶段, baseline, candidate 和 Delta. 不跨阶段相加 cycles.
- `sourceLocations`: 至少一个可定位的源码路径和精确行号, 明确相对路径基准 (证据脚本默认使用 Unity 项目根目录的父目录). 应同时覆盖功能入口和待修改实现位置.
- `codeEvidence`: 只写当前源码中已经确认的事实.
- `proposedChange`: 写清修改哪个函数, 数据流或表达式, 以及如何修改.
- `risk`: 写明可能改变的视觉, 精度, 分支或资源行为.
- `acceptance`: 至少包含相同 comparison 复测条件和功能或视觉回归条件.
- `confidence`: 使用 `High`, `Medium` 或 `Low`, 并与证据完整度一致.

Builder 先按 `priority` 从 `P0` 到 `P3` 排序, 再按 `expectedBenefit` 从 `High` 到 `Low` 排序. 同级项目保持输入顺序, 因此输入文件应把更重要或预期收益更高的同级项目放在前面.

## 质量门槛

- 优先考虑局部可验收的改动, 如复用方向或基向量, 消除同一路径重复计算或采样, 缩短临时值存活区间. 涉及材质语义, 画质规格, Pass 结构或 package API 的方案需明确相应风险.
- 缺少 `sourceLocations`, `proposedChange` 或 `acceptance` 时, 不得进入工作簿的可执行建议列表.
- 先读 `code-evidence.json` 中的条件块, 再打开实际源码并追踪被调用函数. 证据包中的局部 excerpt 不能替代源码审阅.
- `codeEvidence` 和 `proposedChange` 必须分开. 前者是事实, 后者是待验证方案.
- 不预测具体可节省的 cycles. 只有复测结果可以写成已实现收益.
- 对变体组合必须说明实际 baseline 和 candidate, 不创建人工关键字, 也不把组合成本错误归因给单个关键字.
- 证据不足时保留已有性能报告, 明确说明未形成建议的原因; 空建议数组不等于没有优化空间.
- 仅能修改项目拥有的 Shader 代码. 对 Unity package 源码只给出调用侧规避或升级建议, 除非该 package 是项目内维护的 fork.
