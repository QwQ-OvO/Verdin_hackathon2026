# Skill Gym

**Team Verdin · Airwallex Problem Statement 1: Future Work / Skill Development**

> If AI does the beginner work, where does expertise come from?

Junior tasks deliver work and develop judgement. When AI takes over those tasks, teams also risk losing the practice that helps junior employees become experts. **Skill Gym identifies the decisions worth practising within a work task, explains why they matter, and keeps a manager accountable for the business outcome.**

## Who it is for

Skill Gym is for knowledge-work teams adopting AI while developing junior employees' judgement. A manager decides how a task is divided and reviews its output; a junior employee practises a decision that matters to the team's work. The first use case is a fintech product team's review of merchant onboarding feedback. The current demo uses **synthetic feedback and a simulated task record**, not live Airwallex or merchant data.

## The solution

A company defines a capability it needs, such as **user insight**. For a task, Skill Gym proposes a step-level plan: which preparation can be automated, which judgement should be reserved for the learner, and which decision needs manager approval. **The allocation proposal currently comes from transparent rules, not a model deciding who is allowed to do the work.** The manager confirms or changes the proposal within access and risk constraints.

In the demo, source-preserving groups organise synthetic merchant onboarding comments. The learner identifies two issues worth investigating, explains the priorities, and cites original comments. The server saves this first judgement before any AI issue conclusion can be shown to the learner. Optional hints and evidence checks can support a revision. The planned manager review decides whether the recommendation may enter product discovery and records observations about the learner's reasoning.

The product's central decision is **why a particular judgement should remain with a developing employee when other steps can be automated**. Feedback closes the learning loop; AI-generated feedback is an optional aid to that loop.

**Automate the work where possible. Preserve the judgement where necessary.**

## How the loop works

1. **Define the work and capability:** The manager records the task's source, deadline, risk, reviewer and the judgement the employee needs to develop.
2. **Decide the division of work:** Rules check access, review capacity, time, risk and learning value. The system explains a proposal for each step; the manager confirms or overrides it.
3. **Preserve the first judgement:** The learner reads traceable source material and submits a reasoned recommendation with original evidence. The server protects this first version and withholds any AI issue conclusion until it is saved.
4. **Review the result:** The manager approves or returns the business recommendation and records specific capability observations. Hints, AI evidence checks and revisions can support this process without replacing the first version or the manager's decision.

A later task in a different context can test whether the learner needs less support. **One approved delivery is evidence of performance on that task, not proof of mastery.**

Learning participation never grants authority to publish a conclusion or change risk controls.

## Product flows

These diagrams describe the intended product flow; the implementation status is listed below. The allocation decision is the starting point:

**Decide what the learner should practise and who may approve the outcome:**

![Work allocation and authority](product%20design/02-work-allocation-and-authority.svg)

**Complete the task and review the evidence:**

![Real-work learning loop](product%20design/03-real-work-learning-loop.svg)

Supporting views: [product architecture](product%20design/01-apprenticeship-architecture.svg) · [entry to the first task](product%20design/04-first-real-task-entry.svg).

## Tech and current progress

| Area | Day 3 demo design / current status | Enterprise production direction |
| --- | --- | --- |
| Frontend | React, TypeScript and Vite are planned for four manager and learner screens. Four static layout drafts are complete in [`ui/`](ui/). | Integrate with existing task systems and enterprise identity; refine accessibility and role-based views. |
| Backend | The Node.js/TypeScript API implements guarded task states, transparent step-level allocation, manager confirmation, a protected first judgement, and controlled hints. Append-only revisions and manager review are planned for Step 5. | Integrate with approval workflows, enforce granular access controls, and retain a reviewable audit trail. |
| Storage | SQLite persists tasks, source links, allocation decisions, the immutable first judgement, hints and audit events. Revision and review records are planned for Step 5. | Move to managed enterprise storage with retention policies, access logging and backups. |
| AI | `gpt-4o-mini` is the planned candidate based on expected performance and cost; live quality remains unverified. | Evaluate local-only Ollama deployment with `gemma3:12b` against the same tasks before using sensitive data. Validate quality and data handling; model output remains subject to manager review. |

The runnable backend currently ends after the learner's first judgement and controlled hints. The full manager review loop shown in the diagrams is a **planned MVP milestone**; see the [backend development plan](backend/docs/development-plan.md). Later-task validation and adaptive support require evidence across more than one task.

### Run the current backend

Requires Node.js 22.21 or newer. Node 22 currently labels its built-in SQLite module experimental.

```powershell
cd backend
npm install
$env:DEMO_MANAGER_TOKEN = '<choose-a-secret-manager-token>'
$env:DEMO_LEARNER_TOKEN = '<choose-a-different-secret-learner-token>'
npm start
```

The API listens on `127.0.0.1:3001` by default. `GET /health` is public; task endpoints require a bearer token. The manager can propose and confirm allocation; the learner can start the task, submit a first judgement and request hints using the endpoints in the [demo contract](backend/docs/demo-contract.md). Hints work offline with the synthetic adapter. For optional live post-submission hints, set `OPENAI_API_KEY` and `OPENAI_HINT_MODEL` on the server.

The first start imports synthetic records into `backend/data/demo.sqlite`; later starts preserve the database. Run `npm test` and `npm run typecheck` to verify the backend. Demo tokens are for local use only.

## MVP scope and evidence

The intended end-to-end demo covers **one capability, one simulated business task, one learner, one manager, an explainable step-level allocation and one manager review**. It should show why a judgement was reserved, protect the learner's first evidence-backed submission, and let the manager inspect that submission and decide whether the recommendation can be used. Optional AI hints and evidence checks can be demonstrated, but the core allocation and review loop should also be understandable without them.

The demo can record judgement quality, evidence use, help used and manager review time. A later task in a different context would be needed to test growing independence. These measures are proposed evaluation criteria, not evidence that the product already improves skill development. Every current task record and merchant comment is synthetic; live customer data would require separate access and compliance work.

Detailed specifications: [User story](docs/user-story.md) · [Frontend design](docs/frontend-design.md) · [Backend design](docs/backend-design.md).
