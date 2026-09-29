import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluateStepAllocations, getOwnerBlockers } from '../src/services/allocation-rule-engine.ts';

const steps = [
  { id: 'STEP-ORGANIZE', key: 'organize_feedback', requiresManagerApproval: false },
  { id: 'STEP-PATTERNS', key: 'identify_patterns', requiresManagerApproval: false },
  { id: 'STEP-PRIORITIES', key: 'select_priorities', requiresManagerApproval: false },
  { id: 'STEP-APPROVE', key: 'approve_business_use', requiresManagerApproval: true },
] as const;

function eligibleFacts() {
  return {
    learnerCanReadFeedback: true,
    sourceWithinScope: true,
    reviewerAvailable: true,
    hoursUntilDeadline: 72,
    riskLevel: 'medium' as const,
    isReversible: true,
    capabilityMatch: true,
    learnerReady: true,
    containsPersonalData: false,
  };
}

test('normal demo work keeps source organization with AI, judgment with learner, and approval with manager', () => {
  const proposal = evaluateStepAllocations(steps, eligibleFacts());
  assert.deepEqual(proposal.map((step) => step.suggestedOwner), ['ai', 'learner', 'learner', 'manager']);
  assert.ok(proposal[0].ruleIds.includes('source_in_scope'));
  assert.ok(proposal[1].ruleIds.includes('learner_access_allowed'));
  assert.ok(proposal[1].ruleIds.includes('reviewer_available'));
  assert.ok(proposal[1].ruleIds.includes('time_window_open'));
  assert.ok(proposal[1].ruleIds.includes('risk_reviewable'));
  assert.ok(proposal[1].ruleIds.includes('capability_match'));
  assert.ok(proposal[2].ruleIds.includes('learning_value'));
  assert.equal(proposal[3].requiresManagerApproval, true);
  assert.ok(proposal.every((step) => step.reason.length > 20));
});

test('denied source access keeps judgment away from the learner', () => {
  const proposal = evaluateStepAllocations(steps, { ...eligibleFacts(), learnerCanReadFeedback: false });
  assert.equal(proposal[1].suggestedOwner, 'manager');
  assert.equal(proposal[2].suggestedOwner, 'manager');
  assert.ok(proposal[1].hardBlockers.includes('learner_access_denied'));
});

test('source outside the allowed scope blocks both learner judgment and AI organization', () => {
  const proposal = evaluateStepAllocations(steps, { ...eligibleFacts(), sourceWithinScope: false });
  assert.equal(proposal[0].suggestedOwner, 'manager');
  assert.equal(proposal[1].suggestedOwner, 'manager');
  assert.ok(proposal[0].hardBlockers.includes('source_out_of_scope'));
});

test('missing reviewer, short deadline, and irreversible high risk block learner ownership', () => {
  const proposal = evaluateStepAllocations(steps, {
    ...eligibleFacts(), reviewerAvailable: false, hoursUntilDeadline: 2,
    riskLevel: 'high', isReversible: false,
  });
  assert.equal(proposal[1].suggestedOwner, 'manager');
  assert.deepEqual(proposal[1].hardBlockers, [
    'reviewer_unavailable', 'deadline_too_close', 'high_or_irreversible_risk',
  ]);
});

test('a weak capability link changes the recommendation without becoming a hard access ban', () => {
  const proposal = evaluateStepAllocations(steps, { ...eligibleFacts(), capabilityMatch: false });
  assert.equal(proposal[1].suggestedOwner, 'manager');
  assert.deepEqual(proposal[1].hardBlockers, []);
  assert.ok(proposal[1].ruleIds.includes('capability_not_matched'));
});

test('manager overrides still respect source access and business approval authority', () => {
  assert.deepEqual(getOwnerBlockers('identify_patterns', 'learner', { ...eligibleFacts(), learnerCanReadFeedback: false }), ['learner_access_denied']);
  assert.deepEqual(getOwnerBlockers('organize_feedback', 'ai', { ...eligibleFacts(), sourceWithinScope: false }), ['source_out_of_scope']);
  assert.deepEqual(getOwnerBlockers('approve_business_use', 'learner', eligibleFacts()), ['business_approval_manager_only']);
  assert.deepEqual(getOwnerBlockers('approve_business_use', 'manager', { ...eligibleFacts(), reviewerAvailable: false }), ['reviewer_unavailable']);
});
