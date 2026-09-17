# Status Summary

## 目录

- [适用范围](#适用范围)
- [固定章节](#固定章节)
- [输出规则](#输出规则)
- [Restore Verification](#restore-verification)

## 适用范围

本说明文件定义 `checkpoint-save`, `checkpoint-restore`, `checkpoint-handoff` 和 `checkpoint-status` 共用的 status summary 输出格式.

## 固定章节

按以下顺序输出这些章节:

```md
## Current Goal

## Current State

## Known Risks

## Open Questions

## TODO

## Next Actions

## Open Review Findings
```

## 输出规则

- 除 `Open Review Findings` 外, 其他章节保持 source `CONTEXT.md` 中的原文内容.
- 如果某个 required source section 缺失, 在对应输出 section 中说明缺失. 不从其他 section 推断.
- 当 `REVIEW.md` 存在时, `Open Review Findings` 列出其中全部 `Open` findings.
- 每条 open finding 使用一行简短格式:

```md
- [Open][High] F-003: 简短问题标题
```

- 普通 status summary 不输出 `Impact`, `Evidence` 或 `Recommended Fix`.
- 如果没有 open findings, 明确说明没有 `Open` review findings.

## Restore Verification

当 `checkpoint-restore` 读取 `REVIEW.md` 时, 在每条 `Open` finding 下追加验证子项:

```md
- [Open][High] F-003: 简短问题标题
  - Restore Verification: Still Applies. 简短说明.
```

`Restore Verification` 必须包含一个分类和简短说明. 分类只允许:

- `Still Applies`: finding 仍符合当前工程事实, 需要继续处理. 如果该问题尚未纳入 `Known Risks`, 提示后续 `checkpoint-save` 应纳入.
- `Needs Review`: restore 无法确认 finding 是否仍成立. 说明无法确认的原因.
- `No Longer Applies`: finding 不再符合当前工程事实. 写明不再成立的依据, 并说明 restore 不会修改 `REVIEW.md`.
