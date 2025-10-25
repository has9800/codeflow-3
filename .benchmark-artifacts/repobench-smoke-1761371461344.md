# Benchmark Report — RepoBench Smoke

- Family: **repobench**
- Variant: **smoke**
- Tasks: **2**
- Duration: **2540 ms**
- Timestamp: 2025-10-25T05:51:01.341Z

## Aggregate Metrics

| Metric | Value |
| --- | --- |
| precisionAtK | 0.0000 |
| recallAtK | 0.0000 |
| f1 | 0.0000 |
| coverage | 0.5182 |
| candidateCount | 5.0000 |
| entropy | 4.8479 |
| snr | 2.2990 |
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

Target: src/auth.ts
Ground truth: src/auth.ts, src/login.ts
Iterations: 2
Pass: ❌

| Metric | Value |
| --- | --- |
| precisionAtK | 0.0000 |
| recallAtK | 0.0000 |
| f1 | 0.0000 |
| coverage | 0.2525 |
| candidateCount | 5.0000 |
| entropy | 4.8632 |
| snr | 2.7511 |
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

Target: src/ui.ts
Ground truth: src/ui.ts
Iterations: 2
Pass: ❌

| Metric | Value |
| --- | --- |
| precisionAtK | 0.0000 |
| recallAtK | 0.0000 |
| f1 | 0.0000 |
| coverage | 0.7838 |
| candidateCount | 5.0000 |
| entropy | 4.8326 |
| snr | 1.8468 |
| relevanceScore | 0.0000 |
| answerAccuracy | 0.0000 |
| exactMatch | 0.0000 |
| perplexity | 0.0000 |
| faithfulness | 0.0000 |
| timeToFirstTokenMs | 0.0000 |

Actions: enable_cross_encoder, increase_walk_depth, expand_related, enable_cross_encoder, increase_walk_depth, expand_related
