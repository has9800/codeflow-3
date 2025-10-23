# Beta Readiness Checklist

## Graph & Storage
- [x] Wire `DiffOverlay` lifecycle into the CLI so edits persist as overlay deltas before merges.
- [x] Implement merge/conflict resolution between overlay snapshots and persisted Neo4j history.
- [x] Validate Neo4j connection pooling and add health checks / retries for transient failures.

## Retrieval & Embeddings
- [x] Add persistent embedding cache (disk or Neo4j vector index) with invalidation on rebuilds.
- [x] Expand semantic search to leverage the new call-graph metadata and cross-file exports.
- [x] Benchmark traversal/query performance on large repos; tune token budgeting heuristics.

## Auth & CLI UX
- [x] Stand up the auth backend endpoints to issue device codes and exchange tokens.
- [x] Replace the manual API-key prompt with real device-code polling once the backend is ready.
- [x] Support account switching / logout command and surface login status in the header.

## Testing & Tooling
- [x] Flesh out the unit/integration suites (retrieval, graph persistence, auth flow, E2E).
- [x] Add smoke tests that exercise the Neo4j adapter against a containerised database (verified against ephemeral Aura instance).
- [ ] Configure CI to run type-check, lint, and format with fixtures covering multiple languages.
- [ ] Add CI target that provisions an ephemeral Neo4j instance via API and runs the smoke suite.
- [ ] Extend CI with lint, large-repo fixtures, and nightly `npm run benchmark` to track regressions.

## Observability & Safety
- [ ] Emit structured logs around retrieval decisions and overlay merges.
- [ ] Guardrail API usage limits (rate limiting, retry backoff) for OpenRouter calls.
- [ ] Add telemetry opt-out/in controls before the beta launch.

## Deployment & Cleanup
- [x] Integrate Neo4j provisioning API (create on session start, destroy on logout).
- [x] Support retention window (up to 90 days) with automated cleanup worker.
