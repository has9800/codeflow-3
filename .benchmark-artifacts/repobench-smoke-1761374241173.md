# Benchmark Report — RepoBench Smoke

- Family: **repobench**
- Variant: **smoke**
- Tasks: **2**
- Duration: **2300 ms**
- Timestamp: 2025-10-25T06:37:21.171Z

## Aggregate Metrics

| Metric | Value |
| --- | --- |
| precisionAtK | 0.0000 |
| recallAtK | 0.0000 |
| f1 | 0.0000 |
| coverage | 0.2654 |
| candidateCount | 5.0000 |
| entropy | 4.9501 |
| snr | 2.0678 |
| relevanceScore | 0.0000 |
| answerAccuracy | 0.0000 |
| exactMatch | 0.0000 |
| perplexity | 0.0000 |
| faithfulness | 0.0000 |
| timeToFirstTokenMs | 0.0000 |

## Task Results

### repobench-auth-001

Query: 
> Refactor DeviceCodeFlow to improve error handling

Target: src/auth/DeviceCodeFlow.ts
Ground truth: src/auth/DeviceCodeFlow.ts, src/auth/AuthManager.ts
Iterations: 2
Pass: ❌

| Metric | Value |
| --- | --- |
| precisionAtK | 0.0000 |
| recallAtK | 0.0000 |
| f1 | 0.0000 |
| coverage | 0.2608 |
| candidateCount | 5.0000 |
| entropy | 4.9289 |
| snr | 2.9075 |
| relevanceScore | 0.0000 |
| answerAccuracy | 0.0000 |
| exactMatch | 0.0000 |
| perplexity | 0.0000 |
| faithfulness | 0.0000 |
| timeToFirstTokenMs | 0.0000 |

Actions: enable_cross_encoder, increase_walk_depth, expand_related, enable_cross_encoder, increase_walk_depth, expand_related

### repobench-ui-002

Query: 
> Review app.tsx login UI for missing validation

Target: src/ui/app.tsx
Ground truth: src/ui/app.tsx
Iterations: 2
Pass: ❌

| Metric | Value |
| --- | --- |
| precisionAtK | 0.0000 |
| recallAtK | 0.0000 |
| f1 | 0.0000 |
| coverage | 0.2700 |
| candidateCount | 5.0000 |
| entropy | 4.9713 |
| snr | 1.2281 |
| relevanceScore | 0.0000 |
| answerAccuracy | 0.0000 |
| exactMatch | 0.0000 |
| perplexity | 0.0000 |
| faithfulness | 0.0000 |
| timeToFirstTokenMs | 0.0000 |

Actions: enable_cross_encoder, increase_walk_depth, expand_related, enable_cross_encoder, increase_walk_depth, expand_related
