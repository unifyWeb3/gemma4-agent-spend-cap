/**
 * Policy engine for agent spend control.
 *
 * This module is the single source of truth for the rules. It is pure, it has
 * no dependencies, and it never touches the network or the filesystem. The
 * Gemma paper harness and the Bound product both run this exact code, so the
 * numbers in the paper are the numbers in the product.
 *
 * The engine answers one question: may this agent pay this receiver this much
 * right now? Every answer carries a reason and the rule that produced it, so a
 * refusal can be audited rather than guessed at.
 *
 * @module policy
 */

/**
 * Denial reasons. The string value is what lands in a receipt and in the
 * paper's result tables, so it must stay stable.
 */
export const Reason = {
  ALLOWED: 'allowed',
  BUDGET_EXCEEDED: 'BudgetExceeded',
  VENDOR_NOT_ALLOWED: 'VendorNotAllowed',
  RATE_LIMITED: 'RateLimited',
  SINGLE_SPEND_EXCEEDED: 'SingleSpendExceeded',
  INVALID_AMOUNT: 'InvalidAmount',
  AGENT_REVOKED: 'AgentRevoked',
  KILL_SWITCH: 'KillSwitch',
  COUNTERPARTY_BLOCKED: 'CounterpartyBlocked',
  COUNTERPARTY_WARNED: 'CounterpartyWarned',
  NONCE_REPLAY: 'NonceReplay',
};

/** Counterparty verdicts, ordered from safest to most dangerous. */
export const Verdict = {
  ALLOW: 'allow',
  WARN: 'warn',
  BLOCK: 'block',
};

/**
 * A spend policy. One policy belongs to one agent.
 *
 * @typedef {object} Policy
 * @property {string} agentId            Account id of the agent this policy governs.
 * @property {number} budget             Spend allowed per period, in the smallest unit.
 * @property {number} periodSeconds      Length of the budget period.
 * @property {string[]} allowedVendors   Receivers the agent may pay.
 * @property {number} rateLimit          Maximum spends allowed per minute.
 * @property {number} maxSingleSpend     Maximum allowed in one spend.
 * @property {boolean} killSwitch        When true every spend is denied.
 * @property {boolean} revoked           When true the agent is locked out.
 * @property {number} warnThreshold      Score below which a counterparty is a warning.
 */

/**
 * Running state for a policy. The engine is stateless between calls, the
 * caller keeps this and passes it in.
 *
 * @typedef {object} PolicyState
 * @property {number} periodStart    Timestamp in seconds when the current period began.
 * @property {number} spent          Amount spent in the current period.
 * @property {number[]} spendTimes   Timestamps of recent spends, used for the rate limit.
 * @property {number} lastNonce      Highest nonce seen, used for replay detection.
 * @property {string[]} seenVendors  Receivers this agent has paid before.
 */

/**
 * Counterparty signals about a receiver. All of them can be gathered from a
 * public RPC or from the local receipt history, so none of them need a paid
 * data source.
 *
 * @typedef {object} CounterpartySignals
 * @property {number} accountAgeBlocks   Blocks since the receiver account was created.
 * @property {number} transactionCount   Transactions the receiver account has made.
 * @property {boolean} isContract        Whether the receiver is a contract.
 * @property {boolean} codeChangedRecent Whether the contract code changed recently.
 * @property {number} priorInteractions  Past interactions between this agent and the receiver.
 * @property {boolean} onBlocklist       Whether the receiver is on the shared blocklist.
 */

/**
 * A spend request.
 *
 * @typedef {object} SpendRequest
 * @property {string} vendor       Receiver account id.
 * @property {number} amount       Amount in the smallest unit.
 * @property {number} nonce        Unique per spend, used for replay detection.
 * @property {number} timestamp    Current time in seconds.
 * @property {CounterpartySignals} [counterparty] Signals about the receiver.
 */

/**
 * The result of evaluating a request.
 *
 * @typedef {object} Decision
 * @property {boolean} allowed    Whether the spend may proceed.
 * @property {string} reason      One of {@link Reason}.
 * @property {string} rule        The rule that decided, in plain words.
 * @property {number} spent       Amount spent in the current period after this decision.
 * @property {number} remaining   Budget left in the current period.
 * @property {string[]} evidence  Facts that led to the decision.
 */

/**
 * Create a policy with safe defaults.
 *
 * @param {Partial<Policy>} [overrides]
 * @returns {Policy}
 */
export function makePolicy(overrides = {}) {
  return {
    agentId: 'agent.testnet',
    budget: 1_000_000_000,
    periodSeconds: 7 * 24 * 60 * 60,
    allowedVendors: [],
    rateLimit: 10,
    maxSingleSpend: 500_000_000,
    killSwitch: false,
    revoked: false,
    warnThreshold: 2,
    ...overrides,
  };
}

/**
 * Create empty state for a policy.
 *
 * @param {number} [now] Current time in seconds.
 * @returns {PolicyState}
 */
export function makeState(now = 0) {
  return {
    periodStart: now,
    spent: 0,
    spendTimes: [],
    lastNonce: -1,
    seenVendors: [],
  };
}

/**
 * Score a receiver and return a verdict with reasons.
 *
 * The scoring is deliberately simple and explainable. Every point of risk adds
 * up, and the total maps to allow, warn, or block. A judge can read the score
 * and the evidence list and disagree with it.
 *
 * @param {CounterpartySignals} signals
 * @param {Policy} policy
 * @returns {{ verdict: string, score: number, reasons: string[] }}
 */
export function scoreCounterparty(signals, policy) {
  const reasons = [];
  let score = 0;

  if (!signals) {
    return { verdict: Verdict.ALLOW, score: 0, reasons: ['no counterparty signals supplied'] };
  }

  if (signals.onBlocklist) {
    score += 10;
    reasons.push('receiver is on the shared blocklist');
  }

  if (signals.accountAgeBlocks !== undefined && signals.accountAgeBlocks < 1000) {
    score += 3;
    reasons.push(`receiver account is young, ${signals.accountAgeBlocks} blocks old`);
  }

  if (signals.transactionCount !== undefined && signals.transactionCount === 0) {
    score += 2;
    reasons.push('receiver has never transacted');
  }

  if (signals.isContract && signals.codeChangedRecent) {
    score += 4;
    reasons.push('receiver is a contract and its code changed recently');
  }

  if (signals.priorInteractions !== undefined && signals.priorInteractions === 0) {
    score += 1;
    reasons.push('agent has never interacted with this receiver before');
  }

  let verdict = Verdict.ALLOW;
  if (score >= 6) {
    verdict = Verdict.BLOCK;
  } else if (score >= policy.warnThreshold) {
    verdict = Verdict.WARN;
  }

  return { verdict, score, reasons };
}

/**
 * Roll the budget period over when the previous one has ended.
 *
 * @param {Policy} policy
 * @param {PolicyState} state
 * @param {number} now
 * @returns {PolicyState} A new state object, the input is not mutated.
 */
export function rollPeriod(policy, state, now) {
  if (now - state.periodStart < policy.periodSeconds) return state;
  return { ...state, periodStart: now, spent: 0 };
}

/**
 * Evaluate a spend request against a policy.
 *
 * The order of the checks matters. The kill switch and revocation come first
 * because they stop everything. The counterparty check comes before the
 * budget check so a dangerous receiver is refused even when money is left.
 *
 * @param {Policy} policy
 * @param {PolicyState} state
 * @param {SpendRequest} request
 * @returns {Decision}
 */
export function evaluate(policy, state, request) {
  const now = request.timestamp;
  const current = rollPeriod(policy, state, now);
  const remaining = Math.max(0, policy.budget - current.spent);

  const decide = (allowed, reason, rule, evidence = []) => ({
    allowed,
    reason,
    rule,
    spent: current.spent,
    remaining,
    evidence,
  });

  if (policy.revoked) {
    return decide(false, Reason.AGENT_REVOKED, 'the agent key was revoked by its owner');
  }

  if (policy.killSwitch) {
    return decide(false, Reason.KILL_SWITCH, 'the kill switch in the policy config is on');
  }

  if (!Number.isInteger(request.amount) || request.amount <= 0) {
    return decide(false, Reason.INVALID_AMOUNT, 'the amount must be more than zero');
  }

  if (request.nonce <= current.lastNonce) {
    return decide(false, Reason.NONCE_REPLAY, 'the nonce was already used by this agent', [
      `last nonce ${current.lastNonce}`,
    ]);
  }

  const counterparty = scoreCounterparty(request.counterparty, policy);
  if (counterparty.verdict === Verdict.BLOCK) {
    return decide(false, Reason.COUNTERPARTY_BLOCKED, 'the receiver failed the counterparty check', counterparty.reasons);
  }
  if (counterparty.verdict === Verdict.WARN) {
    return decide(false, Reason.COUNTERPARTY_WARNED, 'the receiver needs a human check before payment', counterparty.reasons);
  }

  if (policy.allowedVendors.length > 0 && !policy.allowedVendors.includes(request.vendor)) {
    return decide(false, Reason.VENDOR_NOT_ALLOWED, 'the receiver is not on the vendor allowlist', [
      `allowed: ${policy.allowedVendors.join(', ')}`,
    ]);
  }

  if (request.amount > policy.maxSingleSpend) {
    return decide(false, Reason.SINGLE_SPEND_EXCEEDED, 'the amount is above the single spend limit', [
      `limit ${policy.maxSingleSpend}`,
    ]);
  }

  const windowStart = now - 60;
  const recent = current.spendTimes.filter((t) => t > windowStart);
  if (recent.length >= policy.rateLimit) {
    return decide(false, Reason.RATE_LIMITED, 'too many spends in the last minute', [
      `${recent.length} spends in 60s, limit ${policy.rateLimit}`,
    ]);
  }

  if (current.spent + request.amount > policy.budget) {
    return decide(false, Reason.BUDGET_EXCEEDED, 'the spend would exceed the period budget', [
      `spent ${current.spent} of ${policy.budget}`,
      `requested ${request.amount}`,
    ]);
  }

  return {
    allowed: true,
    reason: Reason.ALLOWED,
    rule: 'every policy check passed',
    spent: current.spent + request.amount,
    remaining: Math.max(0, policy.budget - current.spent - request.amount),
    evidence: counterparty.reasons,
  };
}

/**
 * Apply an approved decision to the state, producing the next state.
 *
 * @param {PolicyState} state
 * @param {SpendRequest} request
 * @returns {PolicyState}
 */
export function apply(state, request) {
  return {
    periodStart: state.periodStart,
    spent: state.spent + request.amount,
    spendTimes: [...state.spendTimes, request.timestamp],
    lastNonce: request.nonce,
    seenVendors: state.seenVendors.includes(request.vendor)
      ? state.seenVendors
      : [...state.seenVendors, request.vendor],
  };
}
