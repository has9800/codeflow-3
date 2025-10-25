# Benchmark Report — RepoBench Smoke

- Family: **repobench**
- Variant: **smoke**
- Tasks: **2**
- Duration: **2222 ms**
- Timestamp: 2025-10-25T06:41:47.038Z

## Aggregate Metrics

| Metric | Value |
| --- | --- |
| precisionAtK | 0.3000 |
| recallAtK | 1.0000 |
| f1 | 0.4524 |
| coverage | 0.1764 |
| candidateCount | 5.0000 |
| entropy | 4.9102 |
| snr | 1.3338 |
| relevanceScore | 0.3000 |
| answerAccuracy | 0.3000 |
| exactMatch | 1.0000 |
| perplexity | 0.0000 |
| faithfulness | 1.0000 |
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
| precisionAtK | 0.4000 |
| recallAtK | 1.0000 |
| f1 | 0.5714 |
| coverage | 0.0775 |
| candidateCount | 5.0000 |
| entropy | 4.8489 |
| snr | 1.4076 |
| relevanceScore | 0.4000 |
| answerAccuracy | 0.4000 |
| exactMatch | 1.0000 |
| perplexity | 0.0000 |
| faithfulness | 1.0000 |
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
| precisionAtK | 0.2000 |
| recallAtK | 1.0000 |
| f1 | 0.3333 |
| coverage | 0.2753 |
| candidateCount | 5.0000 |
| entropy | 4.9714 |
| snr | 1.2600 |
| relevanceScore | 0.2000 |
| answerAccuracy | 0.2000 |
| exactMatch | 1.0000 |
| perplexity | 0.0000 |
| faithfulness | 1.0000 |
| timeToFirstTokenMs | 0.0000 |

Actions: enable_cross_encoder, increase_walk_depth, expand_related, enable_cross_encoder, increase_walk_depth, expand_related
