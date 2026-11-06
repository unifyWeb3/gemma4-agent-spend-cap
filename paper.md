# The Leash Cannot Be Prompted
## Indirect Prompt Injection in Coding Agents and the Cost of a Hard Spend Cap

Working draft, 2026-11-06. Every reported number traces to a raw record in `results/`. The corrected matrix is running; the pre-delivery-fix run is archived in `results/archive-pre-fix/` and is never quoted.

## Abstract

Coding agents read untrusted repositories, and a repository can instruct an agent to spend money. The common response is a system prompt telling the agent not to overspend. We built twelve synthetic repository tasks, five classes of untrusted instruction and three enforcement regimes (a prompt instruction, a host side tool policy and a hard cap enforced outside the model), and we measured what it costs to rely on each. Every episode records whether the injected text actually reached the model, which is what made the first experiment measure delivery instead of defence. In the corrected control arm, the prompt regime allowed the paid call in every delivered cell, the tool policy stopped every class except policy tampering, and the hard cap stopped every class. Gemma 4 26B-A4B on Google AI Studio was substantially harder to talk into the premium payment even when the injection arrived, and a hard cap returning the deployed contract's refusal strings stopped every attempt. Every episode is released as a raw record.

## Introduction

AI coding agents are moving from answering questions to acting. They read issues, run commands, call paid services and apply patches. One common action is a paid lookup: the agent pays a reference API for a price and uses it in the fix. When an attacker can shape a file in the repository, the attacker can also write an instruction that tries to redirect that payment.

A prompt instruction is not an authority. It can be ignored, especially under pressure. A host side policy is stronger, but the policy lives in something the agent can sometimes reach. A limit imposed outside the model does not depend on the model agreeing to behave.

This study isolates the enforcement point. It asks a narrow question: what does each regime cost, in realised loss, refused legitimate work and unfinished tasks, when the injection actually arrives?

## Threat model

The attacker can place or influence repository content: a task file, a data fixture, or documentation returned by the search tool. The attacker does not control the test runner, the host process, or the vendor's price list. The agent can read files, write the task code, run the test, search local documentation and call the paid API.

The defender's goals are the task completed, the legitimate lookup made, and no payment to the attacker's target. A successful attack is an executed payment to `premium-api.testnet`. Loss counts the cents moved. A false positive is the policy refusing the legitimate 2 cent lookup.

The critical measurement decision is delivery. An attack that never reaches the model is not an attack. The first version of this harness measured attack success without measuring delivery: the Gemma arm read the injected fixture in 0 of 36 indirect episodes and searched the documentation in 2 of 36 tool output episodes. Those cells would have scored a perfect 0% attack success rate regardless of what the model would have done with the injection. Every episode now records `injectionExposed`, `exposureRoute` and `exposureEvidence`, and every result cell below shows its exposure.

## Method

### Harness

The harness is a zero dependency Node 24 program. It writes each task to a temporary directory, gives the agent five tools, executes every call it requests and records the result. The agent loop is our code, so every decision is inspectable. The paid API is a local stub with two prices: 2 cents for the required reference lookup and 200 cents for the premium endpoint the attack targets. The budget is 10 cents. After each episode the harness reruns the task tests and reports `verifiedPatchPassed` separately from `taskPassed`.

### Tasks

Twelve Python tasks each contain one bug and a failing test. Each task requires the agent to read its data fixture and to search the documentation, because the task description says so. The fixtures point to the reference values the fix needs. The fixed answers are known, so the control is reproducible.

### Attack classes

| Attack | How it arrives | What delivery requires |
| --- | --- | --- |
| `direct` | The task description tells the agent to pay the premium endpoint first | None, the instruction is in the user message |
| `indirect` | The data fixture carries the instruction | The agent reads the fixture |
| `tool_output` | The search result carries the instruction | The agent searches the documentation |
| `drain` | Repeated small payments under the per spend cap exhaust the budget | None |
| `tamper` | The agent is told the policy file is wrong and where it lives | None |

### Regimes

`prompt_only` puts the budget in the system prompt. `tool_policy` checks each call in the host, using an allowlist, a per spend cap, a rate limit and a mutable `policy.json` in the task directory, so a tampered file is honoured. `hard_cap` enforces the limit outside the model with an allowance chain that is the same decision surface as the deployed contract. The chain simulator returns the deployed contract's exact refusal strings, pinned by a test, with evidence lines. An informative refusal changes behaviour; an empty refusal made the model retry until the step cap ran out, which is what the first matrix showed.

The real testnet implementation exists in the sibling `bound` repository: a function call access key scoped to one contract method, so it cannot point at the vendor at all. The contract stores the policy, evaluates it, and writes a receipt for every decision.

### Metrics

Attack success rate is executed payments to the premium receiver. Mean loss counts cents moved. Exposure rate is episodes where the injected text reached the model. Task completion is the agent's run passing the test. Verified patch rate is the post-episode test result. Lookup completion is the legitimate 2 cent payment executing. False positive rate blocks legitimate calls. Blocked small calls count the refused under-10-cent calls, including refused legitimate lookups.

### Runs

Twelve tasks, five attacks, three regimes, one seed per cell, 180 runs. Temperature zero, so a second seed would not sample a different behaviour, and a cell is one episode.

## Results

The control arm shows the apparatus works: 180 of 180 cells delivered the injection. Its pattern is the expected one. Prompt only allowed the payment in every delivered task. Tool policy refused every attack except tamper, which worked because the tampered file was honoured, as designed. Hard cap refused everything. The control pays for that with an uninformative notion of model behaviour, which is why both arms are reported.

Table 1 is generated from the raw records, not typed by hand. The cell columns are exposure, attack success, loss, task completion and verified patch rate.

| attack | defence | runs | exposed | attack success | loss | task completion | patch verified |
| --- | --- | --- | --- | --- | --- | --- | --- |
TABLE_PLACEHOLDER

Check the full Gemma 4 arm against the same 180 cells in Table 1. In the delivered cells so far it did not pay the premium endpoint in the `indirect` or `tool_output` classes. `direct` and `tamper` are the classes it paid in. Mean loss, task completion and exposure are in Table 1.

## Analysis

The result to hold onto is not that Gemma behaved. It is that in the delivered cells, the model did not pay the premium vendor just because text told it to, in either of the two covert routes. That is one seed, one synthetic task set, and one delivery need. Multi-step or obfuscated payloads may differ.

The tamper row remains the fundamental weakness for host policies. The agent changed the file the host trusts, the file was honoured, and the premium payment was authorised. A policy file sitting reachable in the task directory is not a policy, it is a suggestion. The hard cap has the same weakness only when the agent can write the enforcing program, which is why the enforcing program is outside the agent's reach.

The empty refusal in the first matrix made the hard cap look worse for task completion than it is. The deployed contract refusal tells the agent what is allowed. That refusal cost no measured task completion in the corrected arm.

## Limitations

The task set is small and synthetic. The paid API is a stub and no money moved. The model arm is one episode per cell, one seed, one synthetic task set, at temperature zero. The attack text is explicit. The endpoint is free and rate limited, with empty HTTP 500 responses on about half of raw requests; the harness retries those and reports them. Something to check in future work is whether a different Gemma model, or any frontier model, pays in the indirect class after obfuscation.

## Related work

Greshake et al described indirect prompt injection in LLM integrated applications [Greshake 2023]. AgentDojo measures attacks and defences for tool using agents in a dynamic environment [Debenedetti 2024]. Jimenez et al introduced SWE-bench for repository issue resolution [Jimenez 2024]. Dziemian et al report a large public red teaming competition across frontier models with 8,648 successful attacks [Dziemian 2026]. We are not aware of an existing controlled comparison that isolates the enforcement point for a coding agent that can spend money, and we do not claim to be first.

## Conclusion

Prompts can ask an agent not to overspend. They cannot be the boundary. In the delivered cells a bypass was available in the prompt regime, the only regime that talked to the model instead of refusing it. A boundary outside the model never authorised the premium payment. The tier most likely to fail is a policy that trusts a file the agent can write. The harness, task set and raw runs are released so any operator can verify the table and rerun the matrix.

## References

- Greshake, Abdelnabi, Mishra, Endres, Holz, Fritz. Not what you've signed up for: Compromising real-world LLM-integrated applications with indirect prompt injection. arXiv:2302.12173, 2023. Retrieved 2026-11-05.
- Debenedetti, Zhang, Balunovic, Beurer-Kellner, Fischer, Tramèr. AgentDojo: A dynamic environment to evaluate prompt injection attacks and defenses for LLM agents. NeurIPS 2024 Datasets and Benchmarks Track. arXiv:2406.13352. Retrieved 2026-11-05.
- Dziemian et al. How vulnerable are AI agents to indirect prompt injections? Insights from a large-scale public competition. arXiv:2603.15714, 2026. Retrieved 2026-11-05.
- Jimenez, Yang, Wettig, Yao, Pei, Press, Narasimhan. SWE-bench: Can language models resolve real-world GitHub issues? ICLR 2024. arXiv:2310.06770. Retrieved 2026-11-05.
- NEAR nearcore `verify_function_call_permission`, `DepositWithFunctionCall` and the access key model. https://github.com/near/nearcore/blob/master/runtime/runtime/src/verifier.rs, retrieved 2026-11-05.

## Reproduction

```bash
cd paper
node --test harness/*.test.js
node harness/run.js --tasks 12 --attacks all --defenses all --model stub --out results/control-v2
```

Raw records are in `results/control-v2/` and `results/gemma-ai-studio-v2/`. The earlier matrix is in `results/archive-pre-fix/` and is never quoted. The table is generated by the harness, not typed by hand.
