# Retrieval Overhaul Roadmap

## High-Level Checklist
- ✅ Assess current architecture and identify mandatory subsystems for high-recall retrieval.
- ☐ Implement advanced graph + retrieval foundations (ANN/BM25 fusion, overlays, reranking).
- ☐ Orchestrate the pipeline with LangGraph and retrieval-quality agent loop.
- ☐ Build benchmarking harness (RepoBench + CoIR) and reporting workflow.
- ☐ Polish UX and developer tooling for beta launch (docs, configs, automation).

---

## Phase 1 – Graph & Retrieval Foundations
- 🔁 Establish regression tests (unit + snapshot of current retrieval stats) before exiting the phase.
- Rework Tree-sitter graph build to capture AST-enriched nodes and edges suitable for hybrid retrieval.
- Implement overlay management: single active overlay per change-set, merge-on-commit, with persistence-ready hooks.
- Standing ANN index (HNSW or FAISS binding) seeded from symbol embeddings; BM25 inverted index for lexical fallback.
- Candidate pooling: ANN + BM25 (and semantic) with reciprocal rank fusion and optional reranker (cross-encoder, locality-sensitive hashing check).
- Enforce retrieval constraints: hybrid search primary/secondary fallback, token budget 6–12k, walk depth ≤2, breadth ≤3.
- Instrument context packager to emit stats (token counts, seed sources) for downstream evaluation.

## Phase 2 – LangGraph Orchestration & Agent Oversight
- 🔁 Add integration tests covering LangGraph flows and agent decisions; gate merges on passing trace checks.
- Model the entire retrieval pipeline in LangGraph nodes (graph build, candidate pool, fusion, rerank, walk expansion).
- Implement evaluation agent: compute precision@k, recall@k, F1 (ground truth fixtures or pseudo labels).
- Controlled expansion strategies when thresholds fail: adjust walk depth/breadth, enlarge ANN pool, add cross-encoder reranking pass.
- Telemetry/logging for agent decisions, search parameters, and resulting metrics.
- Continuous integration hooks to run targeted LangGraph traces for regression detection.

## Phase 3 – Benchmarking & Reporting
- 🔁 Run smoke benchmarks (reduced dataset slice) after each major change to detect metric drift early.
- Integrate RepoBench datasets and CoIR suites; create repeatable benchmark runner.
- Define SNR test conditions (A/B/C/D) at fixed 10k tokens; generate contextual mixes with relevant/noise proportions.
- Collect metrics: answer accuracy, relevance score, PPL, Entropy, SNR, TFTT, Faithfulness, F1, EM; visualize expected degradation curves vs. baseline.
- Automate report generation (tables/plots) for investor updates; archive benchmark artifacts per build.
- Plan SWE downstream tasks (repair/patch benchmarks) once retrieval stabilizes.

## Phase 4 – Productization & Beta Readiness
- 🔁 Maintain nightly end-to-end tests (offline + online modes) throughout this phase to guard against regressions.
- Finalize configuration defaults (model selection, thresholds, expansion knobs).
- Update developer docs, README, and onboarding scripts to explain retrieval modes and benchmarking usage.
- Add guardrails for GPU-dependent components (embedding downloads, ANN builds) with graceful fallbacks/offline support.
- Polish Ink UI: actionable edit review controls, key hints, status banners, `/benchmark` command for quick runs.
- Compose launch checklist (QA sign-off, investor-facing slide deck with metrics, beta cohort onboarding).

---

## Support Tasks & Open Questions
- Choose production-ready embedding model hosting strategy (self-hosted weights vs. alternative provider).
- Determine ANN library (native binding or service-backed) and assess deployment implications.
- Curate/label ground-truth retrieval datasets to compute precision & recall reliably.
- Define thresholds for agent-triggered expansion and document escape hatches.
- Evaluate storage backend (Neo4j) requirements for overlay persistence and multi-user scenarios.
