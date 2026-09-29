# Apprentice — Preserve the Judgement

**Team Verdin · Airwallex Problem Statement 1: Future Work / Skill Development**

> If AI does the beginner work, where does expertise come from?

Junior tasks deliver work **and** develop judgement. As AI automates those tasks, employees may lose the low-risk practice and correction that once helped them become experts. Apprentice keeps the valuable learning moments inside real work.

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
| Backend Step 1 | Node.js/TypeScript API, SQLite migrations and seed import, guarded task-state transitions, version checks, append-only audit events, and a role-filtered `GET /tasks/:id`. Eight behavior tests and TypeScript checking pass. | Implement transparent step-level allocation and manager confirmation. |
| Frontend | Static mockups show manager assignment, learner judgment, revision, and manager review. | Build the four React/TypeScript screens and connect them to the API. |
| AI | No live model integration. Source-preserving organization groups are curated demo data. | Add server-side material organization, limited hints, and post-submission evidence checks after the first-judgment boundary is enforced. |

The current backend is a runnable first slice, not yet an end-to-end learning loop. Business approval, capability evidence, and later-task validation remain in the [backend development plan](backend/docs/development-plan.md). An enterprise deployment would also need identity integration, granular data access, retention controls, and a reviewed model/data-hosting choice.

### Run the current backend

Requires Node.js 22.21 or newer. Node 22 currently labels its built-in SQLite module experimental.

```powershell
cd backend
npm install
$env:DEMO_MANAGER_TOKEN = '<choose-a-secret-manager-token>'
$env:DEMO_LEARNER_TOKEN = '<choose-a-different-secret-learner-token>'
npm start
```

The API listens on `127.0.0.1:3001` by default. `GET /health` is public; `GET /tasks/TASK-ONB-001` requires one of the bearer tokens. The first start imports synthetic records into `backend/data/demo.sqlite`; later starts preserve the database. Use `npm test` and `npm run typecheck` to verify the backend. Demo tokens are for local use only.

## Day 3 MVP

Deliver **one capability, one real task, one learner, one manager, transparent allocation rules, three levels of help and one manager review**. The demo must show that the manager can confirm why a judgement is reserved, the server protects the learner's first submission, and the reviewer can inspect the first judgement, hints, revisions and cited evidence.

We will examine both **delivery quality** and **independent capability** through judgement quality, help used, manager review time, and performance on a later task. Demo material will be de-identified or clearly marked as simulated; connecting live customer data requires separate access and compliance work.

Detailed specifications: [User story](docs/user-story.md) · [Frontend design](docs/frontend-design.md) · [Backend design](docs/backend-design.md).
