# 关键字选择与对照

## 目录

- [Multi compile](#multi-compile)
- [Material keywords](#material-keywords)
- [Synthetic combinations](#synthetic-combinations)
- [依赖确认](#依赖确认)
- [去重与排序](#去重与排序)


## Multi compile

- 支持 `multi_compile`, `multi_compile_local`, `multi_compile_vertex`, `multi_compile_fragment`, `multi_compile_local_vertex` 和 `multi_compile_local_fragment`.
- selections 中的 `selected` 必须是数组, 可包含一个或多个选项. `OFF` 与 `_` 等价.
- 同一 pragma 内的选项互斥. 每个被选选项生成一个分支, 不把同组多个选项同时加入 Variant.
- 不同 pragma 的分支做笛卡尔积. 编译前向用户明确组合总数.

## Material keywords

- `Explicit`, `Scene`, `Directory` 使用 `material.enabledKeywords` 作为实际 Material Keywords.
- `Synthetic` 为每个 `shader_feature` 组建立 baseline 和 candidate. 有 `_` 的组和只声明一个关键字的组以 OFF 为 baseline. 同组非 OFF 选项互斥.
- 根关键字 `B` 比较 `OFF -> B`. 如果 `C` 可靠依赖 `B`, 则比较 `B -> B+C`. 更深依赖使用传递闭包.
- 同一个 Variant 可以同时作为某个对照的 candidate 和另一个对照的 baseline, 只编译一次.

## Synthetic combinations

- `syntheticCombinations` 只用于 `Synthetic` 入口, 用于比较显式 baseline 和包含 baseline 的 candidate 关键字集合.
- 不接受人工 `label`. 组合身份由规范排序后的 `baselineKeywords` 和 `candidateKeywords` 唯一确定.
- `baselineKeywords` 可以为空. `candidateKeywords` 必须非空, 严格包含 baseline, 并至少新增两个关键字.
- 两侧关键字都必须属于目标 Pass, 满足已确认的依赖闭包, 且不得同时启用同一 `shader_feature` 组中的互斥选项.
- 每个合法组合在每个 Multi Compile 上下文中生成一条 `SyntheticKeywordCombination` 对照. 完整有效关键字相同的 Variant 仍只编译一次.

## 依赖确认

- 只把明确的预处理嵌套关系作为自动依赖. 同一条件中的并列关键字, Material 共现和命名相似都不是可靠证明.
- 出现方向不明, 多个候选父级, 循环, 同组冲突或缺少可证明 baseline 时, 状态设为 `NeedsKeywordDependencyConfirmation`, 写出候选关系并停止.
- 用户通过 `keywordDependencies` 显式确认后继续. 用户确认优先于自动推断, 但仍检查循环和同组冲突.
- `requires: []` 表示用户明确确认该关键字为独立根功能. 没有依赖证据不等于独立, 因此未被可靠证明且未显式确认的关键字仍会中止 Synthetic 分析.
- 对没有显式 OFF 且包含多个选项的 `shader_feature` 组, 在 `featureBaselines` 中用实际 `groupId` 确认 `baseline: "OFF"`. 当前脚本不支持指定某个非 OFF 选项作为该组基线.

Selections JSON:

```json
{
  "selections": [
    {
      "groupId": "shader-guid|0|ForwardLit|multi_compile|0",
      "selected": ["OFF", "_SCENE_LOD_HIGH"]
    }
  ],
  "keywordDependencies": [
    {
      "keyword": "_DETAIL_ON",
      "requires": ["_NORMALMAP"]
    }
  ],
  "featureBaselines": [
    {
      "groupId": "shader-guid|0|ForwardLit|shader_feature|3",
      "baseline": "OFF"
    }
  ],
  "syntheticCombinations": [
    {
      "baselineKeywords": ["_ANISOTROPY_ON"],
      "candidateKeywords": [
        "_ANISOTROPY_ON",
        "_ANISOTROPY_NORMALMAP_ON",
        "_ANISOTROPYUV_2U",
        "_SHIFTMAP_ON",
        "_SECOND_ANISOTROPY_ON"
      ]
    }
  ]
}
```

## 去重与排序

- Variant ID 输入为 Shader GUID, SubShader, Pass, Material Keywords, Multi Compile Keywords, BuildTarget, ShaderCompilerPlatform 和 Mali Core.
- 完整有效关键字相同的 Variant 只编译一次. Material 入口记录复用该 Variant 的 Material 数量和实际资产路径.
- Multi Compile Keywords 和 Material Keywords 分段排序. 每段都按目标 Pass 中的 pragma 顺序比较, 前缀较短者优先, Variant ID 仅作最终兜底.
