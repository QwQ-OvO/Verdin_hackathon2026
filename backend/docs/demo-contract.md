# Demo contract: merchant onboarding feedback review

## Purpose and provenance

This is the fixed Step 0 contract for the Apprentice Day 3 demo. It represents a plausible product-analysis task at a global payments company. Every merchant comment and internal work record in `backend/seed/onboarding-demo/` is **synthetic**. The demo must display that label and must not describe these records as Airwallex customer data or as evidence from a live team.

The task is to review feedback about merchant onboarding and verification, then recommend two experience issues for further investigation. It is a research recommendation, not a decision to change identity checks, payment activation, fraud controls, or compliance requirements.

This contract implements the scope in [`development-plan.md`](./development-plan.md): one capability, one task, one learner, one manager, and one review. The existing frontend mockups use the same feedback IDs and journey stages.

## Fixed records

| Record | ID | Meaning |
| --- | --- | --- |
| Task | `TASK-ONB-001` | Merchant onboarding feedback review |
| Capability | `CAP-USER-INSIGHT-001` | Identify patterns, weigh evidence, and choose investigation priorities |
| Learner | `USER-LEARNER-001` | Junior product analyst |
| Manager and reviewer | `USER-MANAGER-001` | Product manager accountable for business use |

`task.json`, `users.json`, `feedback.json`, and `organization.json` are the seed source of truth. IDs are stable across the API, interface, audit trail, and review. Do not renumber feedback to make the demo narrative easier.

## Task input and output

The learner receives the task brief, allowed source comments, and traceable duplicate groups. The required first judgment contains:

1. A short description of observed issue patterns.
2. Exactly two proposed investigation priorities, each with a reason and at least one valid original feedback ID.
3. Contrary evidence, journey-stage distinctions, and uncertainties that could change the recommendation.

The learner recommends **what to investigate**, not a definitive root cause or a verification-policy change. The manager reviews evidence and decides whether the recommendation may enter product planning. A separate owner must approve any operational, verification, fraud, or compliance change.

## Data vocabulary

Use these names consistently in seed data, persistence, and API payloads:

| Field | Type / allowed values | Rule |
| --- | --- | --- |
| `id` | Stable string ID | Never reuse an ID for a different record. |
| `source_type` | `simulated_product_feedback` | Required on the task and every comment. |
| `is_simulated` | Boolean `true` | Required on the task and every comment; surface it in the UI. |
| `journey_stage` | `application`, `document_upload`, `verification_review`, `account_activation` | Describes where the reported experience occurred; it is not an issue label. |
| `risk_level` | `low`, `medium`, `high` | The seed task is `medium` because conclusions could influence future product decisions. |
| `status` | State listed below | Server-owned; clients cannot set it directly. |
| `evidence_ids` | Array of feedback IDs | Every ID must exist in this task's allowed feedback set. |

Each feedback item has `id`, `text`, `journey_stage`, `source_type`, and `is_simulated`. `organization.json` contains only source-preserving duplicate or near-duplicate links. It must not contain an issue ranking, an inferred root cause, or a model's final answer. The learner can always open every original comment in a group.

## Roles, learning arrangement, and authority

| Action | Learner | Manager |
| --- | --- | --- |
| Read assigned task and allowed original feedback | Yes, after assignment | Yes |
| Read source-preserving organization groups | Yes, after assignment | Yes |
| Read an AI issue ranking or private review rubric before first judgment | No | Manager rubric only |
| Request a pre-submission reflection question | Yes, if enabled; usage is recorded | No |
| Submit first judgment and append revisions | Yes, on assigned task only | No |
| Confirm or override step allocation | No | Yes, with a reason for overrides |
| Approve the recommendation for business use or request changes | No | Yes |
| Change verification, fraud, compliance, or payment activation rules | No | Outside this demo and its approval flow |

The four fixed task steps are `organize_feedback`, `identify_patterns`, `select_priorities`, and `approve_business_use`. The default learning arrangement assigns organization to AI, pattern recognition and priority selection to the learner, and business-use approval to the manager. The manager may change a soft recommendation with a recorded reason, but cannot waive data-access or reviewer requirements.

The demo role selector is only a way to choose a fixed server-side identity. A submitted role, header, or browser state is not proof of authority. Every read and write endpoint must enforce the authenticated actor, task assignment, and state.

## Lifecycle and information boundary

The server owns the task lifecycle:

`draft -> proposed -> assigned -> in_progress -> first_submitted -> revision_in_progress -> pending_review -> approved`

A manager can return a reviewed version to `changes_requested`, after which the learner appends a new revision. `first_submitted` is an irreversible milestone: the first version cannot be updated, deleted, or replaced.

Before the first judgment is committed, **no learner-accessible response** may include an AI-generated issue classification, ranking, priority, hidden reference answer, or manager-only review guidance. This applies to task reads, history, hints, and any future list or search endpoint. Hiding a field in the frontend is insufficient. The only allowed pre-submission help is a general reflection question that does not name a preferred issue or source ID; its use is recorded and the judgment is marked as assisted.

After the first judgment is committed, the server may expose narrower source clues and an AI evidence check. The evidence check may point out missing or conflicting source IDs and uncertain assumptions. It is not business approval. All model-produced IDs must resolve to allowed original comments before display or storage.

## API payload decisions for Step 1 onward

Keep the routes already specified in [`backend-design.md`](../../docs/backend-design.md). Their first implementation should use this contract:

- `GET /tasks/:id` returns a role- and state-filtered view, including `allowed_actions`; it never serializes private fields and relies on authorization at the server.
- `POST /tasks/:id/proposal` returns a recommendation per task step with `suggested_owner`, `rule_ids`, `reason`, and `requires_manager_approval`.
- `POST /tasks/:id/assignment` records the manager's choice for each step and an `override_reason` where it differs from the proposal.
- `POST /tasks/:id/first-judgment` accepts `expected_version`, `patterns`, exactly two `priorities`, `uncertainties`, and source `evidence_ids`. It atomically creates version 1 once.
- `POST /tasks/:id/hints` accepts a requested help level; the server checks the state and appends a hint event.
- `POST /tasks/:id/revisions` appends a version with `change_reason` and a parent version ID.
- `POST /tasks/:id/review` records `approved` or `changes_requested`, feedback, and business-use scope. Capability evidence and the next-support recommendation are separate from this decision.
- `GET /tasks/:id/history` returns only entries the actor may see at the current state.

All writes record actor ID and timestamp. The initial judgment needs a database uniqueness constraint and transaction, not a frontend disabled button, to prevent two first versions from concurrent clicks.

## Step 0 acceptance

Step 0 is complete when a teammate can use these files to explain the task's provenance, the learner's capability target, every feedback ID and stage, the default allocation, the review owner, the evaluation criteria, and which data is withheld before first submission. The seeded record must be explicitly synthetic in storage and UI.
