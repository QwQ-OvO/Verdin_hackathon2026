export type AllocationOwner = 'ai' | 'learner' | 'manager';
export type StepKey = 'organize_feedback' | 'identify_patterns' | 'select_priorities' | 'approve_business_use';

export type AllocationFacts = {
  learnerCanReadFeedback: boolean;
  sourceWithinScope: boolean;
  reviewerAvailable: boolean;
  hoursUntilDeadline: number;
  riskLevel: 'low' | 'medium' | 'high';
  isReversible: boolean;
  capabilityMatch: boolean;
  learnerReady: boolean;
  containsPersonalData: boolean;
};

export type AllocationStep = {
  id: string;
  key: StepKey;
  requiresManagerApproval: boolean;
};

export type StepAllocationProposal = {
  stepId: string;
  suggestedOwner: AllocationOwner;
  ruleIds: string[];
  hardBlockers: string[];
  reason: string;
  requiresManagerApproval: boolean;
};

const MIN_LEARNER_HOURS = 24;

/** Hard blockers are checked before learning value and cannot be waived by an override. */
function learnerBlockers(facts: AllocationFacts): string[] {
  const blockers: string[] = [];
  if (!facts.learnerCanReadFeedback) blockers.push('learner_access_denied');
  if (!facts.sourceWithinScope) blockers.push('source_out_of_scope');
  if (facts.containsPersonalData) blockers.push('personal_data_restricted');
  if (!facts.reviewerAvailable) blockers.push('reviewer_unavailable');
  if (!Number.isFinite(facts.hoursUntilDeadline) || facts.hoursUntilDeadline < MIN_LEARNER_HOURS) blockers.push('deadline_too_close');
  if (facts.riskLevel === 'high' || !facts.isReversible) blockers.push('high_or_irreversible_risk');
  return blockers;
}

/** Return source and data restrictions that also apply to AI organization. */
function aiBlockers(facts: AllocationFacts): string[] {
  const blockers: string[] = [];
  if (!facts.sourceWithinScope) blockers.push('source_out_of_scope');
  if (facts.containsPersonalData) blockers.push('personal_data_restricted');
  return blockers;
}

/** Recheck a manager's chosen owner against current hard constraints. */
export function getOwnerBlockers(stepKey: StepKey, owner: AllocationOwner, facts: AllocationFacts): string[] {
  if (stepKey === 'approve_business_use') {
    if (owner !== 'manager') return ['business_approval_manager_only'];
    return facts.reviewerAvailable ? [] : ['reviewer_unavailable'];
  }
  if (owner === 'learner') return learnerBlockers(facts);
  if (owner === 'ai') return aiBlockers(facts);
  return [];
}

/** Produce a traceable proposal for each fixed demo step without using a model. */
export function evaluateStepAllocations(steps: readonly AllocationStep[], facts: AllocationFacts): StepAllocationProposal[] {
  return steps.map((step) => {
    if (step.key === 'approve_business_use') {
      return {
        stepId: step.id, suggestedOwner: 'manager', ruleIds: ['business_approval_manager_only'],
        hardBlockers: facts.reviewerAvailable ? [] : ['reviewer_unavailable'],
        reason: 'Only the assigned manager may approve a recommendation for business use; learning participation does not grant approval authority.',
        requiresManagerApproval: true,
      };
    }
    if (step.key === 'organize_feedback') {
      const hardBlockers = aiBlockers(facts);
      return {
        stepId: step.id, suggestedOwner: hardBlockers.length ? 'manager' : 'ai',
        ruleIds: hardBlockers.length ? hardBlockers : ['source_in_scope', 'no_personal_data', 'source_preserving_automation'],
        hardBlockers,
        reason: hardBlockers.length
          ? `AI organization is blocked by ${hardBlockers.join(', ')}; the manager must handle source material within the approved scope.`
          : 'AI can link repeated comments while keeping every original feedback ID available for human judgment.',
        requiresManagerApproval: step.requiresManagerApproval,
      };
    }

    const hardBlockers = learnerBlockers(facts);
    const usefulPractice = facts.capabilityMatch && facts.learnerReady;
    const ruleIds = [...hardBlockers];
    if (facts.learnerCanReadFeedback) ruleIds.push('learner_access_allowed');
    if (facts.sourceWithinScope) ruleIds.push('source_in_scope');
    if (!facts.containsPersonalData) ruleIds.push('no_personal_data');
    if (facts.reviewerAvailable) ruleIds.push('reviewer_available');
    if (Number.isFinite(facts.hoursUntilDeadline) && facts.hoursUntilDeadline >= MIN_LEARNER_HOURS) ruleIds.push('time_window_open');
    if (facts.riskLevel !== 'high' && facts.isReversible) ruleIds.push('risk_reviewable');
    ruleIds.push(facts.capabilityMatch ? 'capability_match' : 'capability_not_matched');
    ruleIds.push(facts.learnerReady ? 'learner_ready' : 'learner_not_ready');
    if (usefulPractice) ruleIds.push('learning_value');
    const suggestedOwner = hardBlockers.length === 0 && usefulPractice ? 'learner' : 'manager';
    const reason = hardBlockers.length
      ? `The learner cannot own this judgment step because ${hardBlockers.join(', ')}; manager-led work preserves the business boundary.`
      : usefulPractice
        ? 'The step exercises the target user-insight capability with reviewable, reversible evidence-based judgment.'
        : 'The learner has no demonstrated capability match or starting basis for this judgment, so manager-led work is recommended.';
    return { stepId: step.id, suggestedOwner, ruleIds, hardBlockers, reason, requiresManagerApproval: step.requiresManagerApproval };
  });
}
