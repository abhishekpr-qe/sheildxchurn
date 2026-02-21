# GUARDRAILS.md — ShieldXChurn

> Anti-patterns and constraints from past experience. Read before any task. Don't repeat these mistakes.

---

## From Principle: Zero Logic Mutation (2025-01)
**Mistake:** Adding metrics/logging that changes exception types, control flow, or return values.
**Impact:** Downstream systems depend on specific exception types and method signatures. Changing them breaks production silently.
**Rule:** NEVER change functional behavior when adding observability. Instrumentation is purely additive — wrap, observe, record, never modify.
**Detection:** If removing all metrics/logging would change program behavior, the instrumentation is broken.

## From Principle: Domain Purity (2025-01)
**Mistake:** Importing `requests` or `redshift_connector` in domain layer modules.
**Impact:** Domain logic becomes untestable without live external services. Tests become slow, flaky, and coupled to infrastructure.
**Rule:** NEVER import I/O libraries in `src/churn/domain/`. Domain functions accept data, return data — no side effects.
**Detection:** Run `grep -r "import requests\|import redshift" src/churn/domain/` — should return zero results.

## From Principle: Immutable Domain Objects (2025-01)
**Mistake:** Using mutable dataclasses or modifying domain objects after creation.
**Impact:** Shared references cause subtle bugs in pipeline processing — one stage modifies data that another stage depends on.
**Rule:** ALWAYS use `@dataclass(frozen=True)` for domain models. Create new objects instead of mutating existing ones.
**Detection:** Any `FrozenInstanceError` in tests means someone tried to mutate a frozen object — this is working as designed.

## From Principle: Order-Preserving Funnel Integrity (2025-01)
**Mistake:** Using set-based or timestamp-only matching for funnel step progression.
**Impact:** Users who visit screens out of order (e.g., Dashboard before SignUp) are falsely counted as completing the funnel, inflating completion rates.
**Rule:** ALWAYS use index-based forward search (`list.index(step, search_from)`) for funnel step matching. Steps must appear in sequence.
**Detection:** Test with out-of-order screen visits — `test_order_preserving` in test_funnel.py covers this.

## From Principle: Secret Management (2025-01)
**Mistake:** Hardcoding API keys, passwords, or connection strings in source code.
**Impact:** Secrets committed to git are permanently exposed. Rotation requires code changes and redeployment.
**Rule:** NEVER hardcode secrets. ALWAYS load from environment variables or secret files. Secrets go in `.env` (gitignored), not in code.
**Detection:** `grep -rn "password\|api_key\|secret" src/ --include="*.py"` should only show config loading patterns, not literal values.

## From Principle: Config Precedence (2025-01)
**Mistake:** Ignoring environment variable overrides when loading config.
**Impact:** Deployment-time configuration changes don't take effect. Dev config leaks into production.
**Rule:** ALWAYS follow precedence: Environment variables > YAML config > defaults. Use `os.environ.get()` with YAML value as fallback.
**Detection:** Set an env var and verify it overrides the YAML value in a test.

## From Principle: Data Pipeline Idempotency (2025-02)
**Mistake:** Rewriting or "improving" existing SQL queries, Mixpanel API calls, or feature extraction logic without being asked.
**Impact:** Subtle changes to data pipelines can shift feature distributions, break model calibration, or produce different results than expected.
**Rule:** NEVER rewrite data queries or extraction logic unless explicitly asked. Reproduce exactly.
**Detection:** Diff the query/logic before and after — any change requires explicit approval.

## From Principle: Population Filters for Training Data (2025-02)
**Mistake:** Training on all users regardless of activity level or KYC status.
**Impact:** Including inactive or unverified users dilutes signal and produces a model that predicts "user never engaged" rather than "user churned."
**Rule:** ALWAYS apply population filters before training: kyc_verified == 1, total_orders >= 1, days_since_first_event >= 30.
**Detection:** Check row counts before and after filtering — if no rows are dropped, filters may not be working.

## GR-009: Tier Threshold Changes Require Human Review (2026-02)
**Mistake:** Auto-adjusting risk tier thresholds (CRITICAL >= 0.80) based on feedback loop data without human approval.
**Impact:** Threshold changes affect which users get interventions. Miscalibrated auto-adjustment floods ops with false positives or misses actual churners.
**Rule:** NEVER deploy tier threshold changes without explicit human review. Feedback loop proposes; human decides.
**Detection:** Any change to CRITICAL/HIGH/MEDIUM/LOW thresholds must go through PR review.

## GR-010: Cost Tracking Mandatory for All LLM Calls (2026-02)
**Mistake:** Adding LLM calls (Gemini Flash, Haiku) without tracking token usage and cost.
**Impact:** Untracked LLM calls cause cost overruns. With tiered processing, per-tier cost visibility is essential.
**Rule:** ALWAYS log model, token count (input/output), and estimated cost for every LLM call via recordCost().
**Detection:** Any new fetch() to an LLM provider must have corresponding cost logging in llm-cost.js.

## GR-011: No Auto Rule Mutation Without Approval (2026-02)
**Mistake:** Self-learning loop automatically modifying rules.yaml or intervention mappings based on outcome analysis.
**Impact:** Unchecked rule changes can cascade through scoring → tier assignment → interventions, affecting all users.
**Rule:** NEVER auto-mutate rules. Feedback loop PROPOSES new rules as suggestions. Human reviews and commits changes.
**Detection:** rules.yaml changes must appear in git diff. No programmatic writes to rules.yaml.
