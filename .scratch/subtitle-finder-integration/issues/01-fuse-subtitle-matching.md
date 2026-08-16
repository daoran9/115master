# 融合 SubtitleFinder 字幕匹配

Status: needs-triage

## 背景

115Master 与 SubtitleFinder 对同一番号返回的字幕结果和排序不同。后续应比较两边的识别、来源、去重和排序策略，再决定复用或融合边界。

## 已知来源

- 迅雷字幕
- SubtitleCat
- AVSubtitles
- 爱译网

## 待做

1. 用同一批番号比较两个项目的检索词、命中结果和排序。
2. 区分来源覆盖差异与番号提取差异。
3. 统一视频相关字幕优先、语言、格式、可信度和重复项规则。
4. 明确共享逻辑放在 `packages/subtitle-source`、`packages/utils`，还是由 SubtitleFinder 单独适配。
5. 为确定的融合规则补单测和真实来源验活。

## 边界

当前先完成 115Master 适配。本 issue 只留档，不在 Fusion beta.82 基线中继续扩展功能。
