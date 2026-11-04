import test from 'node:test';
import assert from 'node:assert/strict';

import {
  Reason,
  Verdict,
  apply,
  evaluate,
  makePolicy,
  makeState,
  rollPeriod,
  scoreCounterparty,
} from './policy.js';

const NOW = 1_700_000_000;

function policy(overrides = {}) {
  return makePolicy({
    agentId: 'agent.testnet',
    budget: 1000,
    periodSeconds: 3600,
    allowedVendors: ['vendor-a.testnet', 'vendor-b.testnet'],
    rateLimit: 3,
    maxSingleSpend: 600,
    ...overrides,
  });
}

function request(overrides = {}) {
  return {
    vendor: 'vendor-a.testnet',
    amount: 100,
    nonce: 0,
    timestamp: NOW,
    counterparty: {
      accountAgeBlocks: 100_000,
      transactionCount: 500,
      isContract: false,
      codeChangedRecent: false,
      priorInteractions: 3,
      onBlocklist: false,
    },
    ...overrides,
  };
}

test('a clean spend inside every limit is allowed', () => {
  const decision = evaluate(policy(), makeState(NOW), request());
  assert.equal(decision.allowed, true);
  assert.equal(decision.reason, Reason.ALLOWED);
  assert.equal(decision.remaining, 900);
});

test('a spend above the remaining budget is denied with BudgetExceeded', () => {
  const state = { ...makeState(NOW), spent: 950 };
  const decision = evaluate(policy(), state, request({ amount: 100 }));
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, Reason.BUDGET_EXCEEDED);
  assert.equal(decision.remaining, 50);
  assert.ok(decision.evidence.some((e) => e.includes('950')));
});

test('a receiver outside the allowlist is denied with VendorNotAllowed', () => {
  const decision = evaluate(policy(), makeState(NOW), request({ vendor: 'stranger.testnet' }));
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, Reason.VENDOR_NOT_ALLOWED);
});

test('an empty allowlist means no vendor restriction', () => {
  const decision = evaluate(policy({ allowedVendors: [] }), makeState(NOW), request({ vendor: 'anyone.testnet' }));
  assert.equal(decision.allowed, true);
});

test('spends above the single spend limit are denied with SingleSpendExceeded', () => {
  const decision = evaluate(policy(), makeState(NOW), request({ amount: 601 }));
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, Reason.SINGLE_SPEND_EXCEEDED);
});

test('a non positive amount is denied with InvalidAmount', () => {
  for (const amount of [0, -5, 1.5]) {
    const decision = evaluate(policy(), makeState(NOW), request({ amount }));
    assert.equal(decision.allowed, false);
    assert.equal(decision.reason, Reason.INVALID_AMOUNT);
  }
});

test('the rate limit denies the fourth spend in a minute', () => {
  let state = makeState(NOW);
  state = apply(state, request({ nonce: 0, amount: 10, timestamp: NOW }));
  state = apply(state, request({ nonce: 1, amount: 10, timestamp: NOW + 1 }));
  state = apply(state, request({ nonce: 2, amount: 10, timestamp: NOW + 2 }));
  const decision = evaluate(policy(), state, request({ nonce: 3, amount: 10, timestamp: NOW + 3 }));
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, Reason.RATE_LIMITED);
});

test('spends outside the rate window are allowed again', () => {
  let state = makeState(NOW);
  state = apply(state, request({ nonce: 0, amount: 10, timestamp: NOW }));
  state = apply(state, request({ nonce: 1, amount: 10, timestamp: NOW + 1 }));
  state = apply(state, request({ nonce: 2, amount: 10, timestamp: NOW + 2 }));
  const decision = evaluate(policy(), state, request({ nonce: 3, amount: 10, timestamp: NOW + 120 }));
  assert.equal(decision.allowed, true);
});

test('a reused nonce is denied with NonceReplay', () => {
  const state = apply(makeState(NOW), request({ nonce: 7, amount: 10 }));
  const decision = evaluate(policy(), state, request({ nonce: 7, amount: 10 }));
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, Reason.NONCE_REPLAY);
});

test('a revoked agent cannot spend', () => {
  const decision = evaluate(policy({ revoked: true }), makeState(NOW), request());
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, Reason.AGENT_REVOKED);
});

test('the kill switch blocks everything', () => {
  const decision = evaluate(policy({ killSwitch: true }), makeState(NOW), request());
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, Reason.KILL_SWITCH);
});

test('a blocklisted receiver is blocked before the budget check runs', () => {
  const state = { ...makeState(NOW), spent: 999 };
  const decision = evaluate(policy(), state, request({
    amount: 100,
    counterparty: {
      accountAgeBlocks: 10,
      transactionCount: 0,
      isContract: true,
      codeChangedRecent: true,
      priorInteractions: 0,
      onBlocklist: true,
    },
  }));
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, Reason.COUNTERPARTY_BLOCKED);
  assert.ok(decision.evidence.some((e) => e.includes('blocklist')));
});

test('a risky but not blocklisted receiver returns a warning that needs a human', () => {
  const decision = evaluate(policy(), makeState(NOW), request({
    counterparty: {
      accountAgeBlocks: 500,
      transactionCount: 1,
      isContract: false,
      codeChangedRecent: false,
      priorInteractions: 0,
      onBlocklist: false,
    },
  }));
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, Reason.COUNTERPARTY_WARNED);
});

test('counterparty scoring adds up and explains itself', () => {
  const signals = {
    accountAgeBlocks: 10,
    transactionCount: 0,
    isContract: true,
    codeChangedRecent: true,
    priorInteractions: 0,
    onBlocklist: false,
  };
  const scored = scoreCounterparty(signals, policy());
  assert.equal(scored.verdict, Verdict.BLOCK);
  assert.equal(scored.reasons.length, 4);
  assert.ok(scored.reasons.some((r) => r.includes('young')));
  assert.ok(scored.reasons.some((r) => r.includes('code changed')));
});

test('counterparty scoring allows a known, established receiver', () => {
  const scored = scoreCounterparty(request().counterparty, policy());
  assert.equal(scored.verdict, Verdict.ALLOW);
  assert.equal(scored.score, 0);
});

test('the budget period rolls over and resets the spend', () => {
  const state = { ...makeState(NOW), spent: 900 };
  const rolled = rollPeriod(policy(), state, NOW + 3601);
  assert.equal(rolled.spent, 0);
  assert.equal(rolled.periodStart, NOW + 3601);
});

test('state is not mutated by a decision', () => {
  const state = makeState(NOW);
  const before = JSON.stringify(state);
  evaluate(policy(), state, request());
  assert.equal(JSON.stringify(state), before);
});

test('applying an approved spend updates spent, nonce and the vendor list', () => {
  const state = apply(makeState(NOW), request({ nonce: 3, amount: 250 }));
  assert.equal(state.spent, 250);
  assert.equal(state.lastNonce, 3);
  assert.deepEqual(state.seenVendors, ['vendor-a.testnet']);
});

test('every denial reason has a rule attached', () => {
  const cases = [
    [policy({ revoked: true }), makeState(NOW), request()],
    [policy({ killSwitch: true }), makeState(NOW), request()],
    [policy(), makeState(NOW), request({ amount: 0 })],
    [policy(), makeState(NOW), request({ vendor: 'nope.testnet' })],
    [policy(), makeState(NOW), request({ amount: 999 })],
    [policy(), { ...makeState(NOW), spent: 1000 }, request()],
  ];
  for (const [p, s, r] of cases) {
    const decision = evaluate(p, s, r);
    assert.equal(decision.allowed, false);
    assert.ok(decision.rule.length > 10, `rule too short for ${decision.reason}`);
    assert.ok(decision.reason.length > 0);
  }
});
