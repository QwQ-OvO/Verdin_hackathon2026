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

## Current progress

| Area | Completed | Next |
| --- | --- | --- |
| Product design | User story, frontend and backend specifications, four product diagrams, and four English UI mockups in [`ui/`](ui/). | Validate the learning loop with a manager and learner. |
| Backend Step 0 | English [demo contract](backend/docs/demo-contract.md), manager rubric, and clearly labelled synthetic task, user, and feedback fixtures. | Keep the contract aligned with implementation changes. |
| Backend Steps 1–2 | Node.js/TypeScript API and SQLite persistence; guarded state transitions, version checks, append-only audit events, role-filtered task reads, transparent step-level allocation, and manager confirmation with hard-constraint rechecks. | Continue using these foundations for hints and review. |
| Backend Step 3 | Learner start and first-judgment APIs; task/source/step authorization at write time; structured two-priority validation; original-feedback citation checks; one atomic, append-only first version; role- and state-filtered readback. Duplicate or concurrent submissions create one version. | Use the protected submission boundary for feedback and revision. |
| Backend Step 4 | Level 1 vetted reflection question before submission; level 2 source clue and level 3 evidence check after submission; server-side model adapter, output/source-ID validation, repeat-safe hint requests, append-only hint and audit records, and role-filtered hint reads. | Add append-only revisions and manager review in Step 5. |
| Frontend | Static mockups show manager assignment, learner judgment, revision, and manager review. | Build the four React/TypeScript screens and connect them to the API. |
| AI | Source-preserving organization groups are curated demo data. Hints use a deterministic synthetic-demo adapter by default; an optional server-side OpenAI Responses adapter can be enabled with credentials. | Evaluate live hint quality on approved data and add the Step 5 revision and review flow. |

The current backend runs manager allocation through saved first judgment and controlled hints. Revision, business approval, capability evidence, and later-task validation remain in the [backend development plan](backend/docs/development-plan.md). An enterprise deployment would also need identity integration, granular data access, retention controls, and a reviewed model/data-hosting choice.

### Run the current backend

Requires Node.js 22.21 or newer. Node 22 currently labels its built-in SQLite module experimental.

```powershell
cd backend
npm install
$env:DEMO_MANAGER_TOKEN = '<choose-a-secret-manager-token>'
$env:DEMO_LEARNER_TOKEN = '<choose-a-different-secret-learner-token>'
npm start
```

The API listens on `127.0.0.1:3001` by default. `GET /health` is public; task endpoints require a bearer token. A manager can propose and confirm allocation, then the learner can call `POST /tasks/TASK-ONB-001/start` and `POST /tasks/TASK-ONB-001/first-judgment` using the request shapes in the [demo contract](backend/docs/demo-contract.md). The first start imports synthetic records into `backend/data/demo.sqlite`; later starts preserve the database. Use `npm test` and `npm run typecheck` to verify the backend. Demo tokens are for local use only.

The learner can also call `POST /tasks/TASK-ONB-001/hints` and `GET /tasks/TASK-ONB-001/hints`. Hints work offline with the synthetic demo adapter. For optional live generation of post-submission hints, set `OPENAI_API_KEY` and `OPENAI_HINT_MODEL` in the server environment. Do not put the API key in frontend code or commit it to the repository. Live model calls have not been verified without credentials.

## Day 3 MVP

Deliver **one capability, one real task, one learner, one manager, transparent allocation rules, three levels of help and one manager review**. The demo must show that the manager can confirm why a judgement is reserved, the server protects the learner's first submission, and the reviewer can inspect the first judgement, hints, revisions and cited evidence.

We will examine both **delivery quality** and **independent capability** through judgement quality, help used, manager review time, and performance on a later task. Demo material will be de-identified or clearly marked as simulated; connecting live customer data requires separate access and compliance work.

Detailed specifications: [User story](docs/user-story.md) · [Frontend design](docs/frontend-design.md) · [Backend design](docs/backend-design.md).
