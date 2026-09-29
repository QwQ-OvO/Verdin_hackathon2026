# Manager review rubric: TASK-ONB-001

**Manager-only demo guidance.** This document helps a reviewer evaluate the learner's work. It must never be bundled into a learner-facing response before the first judgment. Repository visibility is not runtime authorization; the backend must enforce the boundary described in [`demo-contract.md`](./demo-contract.md).

## Review decision

The manager decides whether the learner's recommendation is sufficiently supported to enter product planning, or must be revised. Approval permits further investigation and discussion only. It does not authorize a change to onboarding verification, payment activation, fraud, or compliance controls.

## Observable criteria

Use `strong`, `adequate`, or `needs_revision` for each criterion, with a short evidence-based note. Do not calculate an automatic mastery score.

| Criterion | Strong evidence | Reason to request changes |
| --- | --- | --- |
| Source traceability | Each proposed priority cites original feedback IDs and the original text supports the stated observation. Duplicate groups can be opened back to every original. | Missing, invalid, or misleading citations; treating a summary as the only source. |
| Pattern and stage distinction | Separates document-upload confirmation, later verification progress, and post-verification activation where the evidence warrants it. | Combines different stages into one cause without justification, especially `FB-036` with verification review. |
| Priority reasoning | Explains why two issues deserve investigation using impact, recurrence, uncertainty, and feasibility of learning more. | Chooses two issues solely because they have the most mentions or states a root cause as fact. |
| Contrary evidence | Considers the normal upload in `FB-018` and any comments that complicate a broad claim; narrows or tests the hypothesis accordingly. | Omits conflicting evidence or presents every merchant as affected. |
| Uncertainty and scope | Identifies what cannot be established from comments alone and proposes a safe next check, such as journey analytics or a usability review. | Recommends removing a required check or changing a risk rule from anecdotal feedback. |
| Revision quality | Explains what changed after hints or review and preserves the first judgment for comparison. | Replaces the first version or copies a suggested conclusion without reasoning. |

## Evidence map for the fixed demo

This is a review aid, **not** an answer string to send to the model or learner before submission.

- `FB-014` and `FB-027` describe similar uncertainty immediately after uploading a document. They may be organized as near-duplicates, while retaining both originals.
- `FB-018` describes a normal upload confirmation. It does not erase the other reports, but limits a universal claim.
- `FB-021` and `FB-024` concern visibility or next steps during verification review, later than upload confirmation.
- `FB-036` concerns first-payment setup after verification. Its stage should be examined separately.
- Other comments add context, alternative explanations, or additional stages. A different pair of priorities can be acceptable if the learner argues from the full evidence set and respects the task scope.

The comments are synthetic and have no valid prevalence estimate. Multiple comments do not establish a population-level rate, actual processing time, or the cause of a delay. The manager should approve a **testable investigation recommendation**, not a claim that a particular product or compliance defect has been proven.

## Business and capability records stay separate

For the business review, record `decision`, `feedback`, `business_use_scope`, `reviewer_id`, and `reviewed_at`. For capability evidence, record observations about source use, reasoning, help used, revision quality, and context difficulty. Recommend `reduce`, `maintain`, or `increase` support for a later task with a reason; the manager confirms or changes it. One approved delivery does not mean the learner has mastered the capability.
