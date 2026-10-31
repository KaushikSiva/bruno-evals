# What comes next

Bruno currently runs locally. Public replay review, browser recording, saved-video evaluation, durable live state, and the two-agent message flow are implemented. The Decisions evaluator and Responses fallback are working.

The next work should make the judgments more useful, not just add more UI.

1. **A human-labeled evaluation set.** Gather permitted clips across tasks, record multiple human judgments, and measure false passes, false failures, and appropriate uncertainty. The demo checks are too small to support accuracy claims.
2. **Faster handoff.** Measure where Agent Relay delivery time is spent, handle overload cleanly, and track end-to-end p50/p95 alongside model latency.
3. **Better evidence.** Select more informative motion windows and multiple relevant views. A single useful frame is a start, but many robot outcomes depend on a sequence.
4. **A verified live-camera run.** The public connector is implemented; an available Dream Labs station is needed for a physical-camera validation.
5. **Policy regression review.** Compare repeated runs under explicit task criteria, retain human corrections, and surface changed failure patterns. This is planned, not part of the current UI.
6. **Deployment for a team.** Add authentication, access controls, hosted actor storage, and media retention rules before making the local service publicly accessible.

Useful contributions include a reproducible wrong judgment, a clearer criterion, a robust source adapter, or a recovery test. See [CONTRIBUTING.md](../CONTRIBUTING.md).
