# Apprentice — Preserve the Judgement

**Team Verdin · Airwallex Problem Statement 1: Future Work / Skill Development**

> If AI does the beginner work, where does expertise come from?

Junior tasks deliver work **and** develop judgement. As AI automates those tasks, employees may lose the low-risk practice and correction that once helped them become experts. Apprentice keeps the valuable learning moments inside real work.

## Who it is for

Apprentice is for companies adopting AI in knowledge-work teams that still need junior employees to develop sound judgement. Team managers assign and review real work; junior employees practise the decisions that matter. Our first use case is a fintech product team analysing merchant onboarding feedback, but the approach also fits other teams with recurring junior analysis tasks and experienced reviewers. A company does not need to be Airwallex-sized to use it.

## The solution

A company defines a capability it needs, such as **user insight**. For each real task, Apprentice proposes which steps AI should handle, which judgement a learner should make, and which decisions require a manager. The manager confirms the plan and remains accountable for business use of the result.

In our example, AI organises de-identified merchant onboarding feedback while preserving links to every original comment. A junior product analyst identifies the two issues worth investigating and cites the evidence. Their first judgement is saved before any AI conclusion is shown. AI can then offer limited hints and check for missing or conflicting evidence; the analyst revises, and the manager reviews the final output.

**Automate the work where possible. Preserve the judgement where necessary.**

## How the loop works

1. **Define:** The manager selects the target capability and registers a real task, its source, deadline, risk and reviewer.
2. **Allocate:** Transparent rules check access, learning value and business cost. The system explains a step-by-step proposal; the manager confirms or overrides it.
3. **Judge:** The learner reads source material and submits an evidence-backed first judgement before seeing AI's conclusion.
4. **Improve:** Hints, AI evidence checks and revisions are recorded without overwriting the first version.
5. **Review:** The manager approves or returns the business output and gives capability feedback.
6. **Validate:** A later task in a different context tests whether the learner needs less support. One approved delivery does not prove mastery.

Learning participation never grants authority to publish a conclusion or change risk controls.

## Product flows

**MVP product architecture:**

![Product architecture](product%20design/01-apprenticeship-architecture.svg)

**Learning arrangement and execution authority are separate decisions:**

![Work allocation and authority](product%20design/02-work-allocation-and-authority.svg)

**The real-work learning loop:**

![Real-work learning loop](product%20design/03-real-work-learning-loop.svg)

[Entry to the first real task](product%20design/04-first-real-task-entry.svg)

## Tech and current progress

| Area | Day 3 demo design / current status | Enterprise production direction |
| --- | --- | --- |
| Frontend | React, TypeScript and Vite are planned for four manager and learner screens. Four English static mockups are complete in [`ui/`](ui/). | Integrate with existing task systems and enterprise identity; refine accessibility and role-based views. |
| Backend | The Node.js/TypeScript API implements guarded task states, transparent step-level allocation, manager confirmation, a protected first judgement, and controlled hints. Append-only revisions and manager review are planned for Step 5. | Integrate with approval workflows, enforce granular access controls, and retain a reviewable audit trail. |
| Storage | SQLite persists tasks, source links, allocation decisions, the immutable first judgement, hints and audit events. Revision and review records are planned for Step 5. | Move to managed enterprise storage with retention policies, access logging and backups. |
| AI | Curated, source-preserving groups and a deterministic hint adapter keep the synthetic demo repeatable. An optional server-side OpenAI Responses adapter is implemented for post-submission hints; `gpt-4o-mini` is the planned live-model candidate, but live hint quality has not been verified. Permissions and allocation constraints remain rule-based. | Evaluate an Australia-hosted, local-only Ollama deployment with `gemma3:12b` against the same tasks before using sensitive data. Validate quality and data handling; model output remains subject to manager review. |

The backend currently supports manager allocation, first judgement and controlled hints. Revisions, business approval, capability evidence and later-task validation remain planned; see the [backend development plan](backend/docs/development-plan.md).

### Run the current backend

Requires Node.js 22.21 or newer. Node 22 currently labels its built-in SQLite module experimental.

```powershell
cd backend
npm install
$env:DEMO_MANAGER_TOKEN = '<choose-a-secret-manager-token>'
$env:DEMO_LEARNER_TOKEN = '<choose-a-different-secret-learner-token>'
npm start
```

The API listens on `127.0.0.1:3001` by default. `GET /health` is public; task endpoints require a bearer token. The manager can propose and confirm allocation; the learner can start the task, submit a first judgement and request hints using the endpoints in the [demo contract](backend/docs/demo-contract.md). Hints work offline with the synthetic adapter. For optional live post-submission hints, set `OPENAI_API_KEY` and `OPENAI_HINT_MODEL` on the server. Keep the API key out of frontend code and the repository.

The first start imports synthetic records into `backend/data/demo.sqlite`; later starts preserve the database. Run `npm test` and `npm run typecheck` to verify the backend. Demo tokens are for local use only.

## Day 3 MVP

Deliver **one capability, one real task, one learner, one manager, transparent allocation rules, three levels of help and one manager review**. The demo must show that the manager can confirm why a judgement is reserved, the server protects the learner's first submission, and the reviewer can inspect the first judgement, hints, revisions and cited evidence.

We will examine both **delivery quality** and **independent capability** through judgement quality, help used, manager review time, and performance on a later task. Demo material will be de-identified or clearly marked as simulated; connecting live customer data requires separate access and compliance work.

Detailed specifications: [User story](docs/user-story.md) · [Frontend design](docs/frontend-design.md) · [Backend design](docs/backend-design.md).
