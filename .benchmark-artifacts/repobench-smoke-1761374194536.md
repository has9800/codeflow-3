# Benchmark Report — RepoBench Smoke

- Family: **repobench**
- Variant: **smoke**
- Tasks: **2**
- Duration: **2137 ms**
- Timestamp: 2025-10-25T06:36:34.533Z

## Aggregate Metrics

| Metric | Value |
| --- | --- |
| precisionAtK | 0.0000 |
| recallAtK | 0.0000 |
| f1 | 0.0000 |
| coverage | 0.4612 |
| candidateCount | 5.0000 |
| entropy | 4.8698 |
| snr | 2.2624 |
| relevanceScore | 0.0000 |
| answerAccuracy | 0.0000 |
| exactMatch | 0.0000 |
| perplexity | 0.0000 |
| faithfulness | 0.0000 |
| timeToFirstTokenMs | 0.0000 |

## Task Results

### repobench-auth-001

Query: 
> Refactor authentication service to improve error handling

Target: src/auth/DeviceCodeFlow.ts
Ground truth: src/auth/DeviceCodeFlow.ts, src/auth/AuthManager.ts
Iterations: 2
Pass: ❌

| Metric | Value |
| --- | --- |
| precisionAtK | 0.0000 |
| recallAtK | 0.0000 |
| f1 | 0.0000 |
| coverage | 0.2705 |
| candidateCount | 5.0000 |
| entropy | 4.8751 |
| snr | 3.0998 |
| relevanceScore | 0.0000 |
| answerAccuracy | 0.0000 |
| exactMatch | 0.0000 |
| perplexity | 0.0000 |
| faithfulness | 0.0000 |
| timeToFirstTokenMs | 0.0000 |

Actions: enable_cross_encoder, increase_walk_depth, expand_related, enable_cross_encoder, increase_walk_depth, expand_related

### repobench-ui-002

Query: 
> Audit login UI for missing validation

Target: src/ui/app.tsx
Ground truth: src/ui/app.tsx
Iterations: 2
Pass: ❌

| Metric | Value |
| --- | --- |
| precisionAtK | 0.0000 |
| recallAtK | 0.0000 |
| f1 | 0.0000 |
| coverage | 0.6518 |
| candidateCount | 5.0000 |
| entropy | 4.8645 |
| snr | 1.4249 |
| relevanceScore | 0.0000 |
| answerAccuracy | 0.0000 |
| exactMatch | 0.0000 |
| perplexity | 0.0000 |
| faithfulness | 0.0000 |
| timeToFirstTokenMs | 0.0000 |

Actions: enable_cross_encoder, increase_walk_depth, expand_related, enable_cross_encoder, increase_walk_depth, expand_related
