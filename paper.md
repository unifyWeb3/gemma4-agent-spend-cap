# The Leash Cannot Be Prompted
## Indirect Prompt Injection in Coding Agents and the Cost of a Hard Spend Cap

Working draft, 2026-11-06. Every number traces to a raw record in `results/`. The table comes from `node tools/table.js`. The pre-delivery-fix run is archived and never quoted.

## Abstract

Coding agents read untrusted repositories, and a repository can instruct an agent to spend money. The usual answer is a prompt telling the agent not to overspend. We built twelve synthetic repository tasks, five classes of untrusted instruction and three enforcement regimes (a prompt instruction, a host side tool policy, and a hard cap enforced outside the model), and measured what each regime costs. Every episode records whether the injected text reached the model, which turned the first version of this study from a measurement of delivery into a measurement of defence. In a control arm with a scripted compliant agent, the prompt regime allowed the paid call in every cell, the tool policy stopped every class except policy tampering, and the hard cap stopped every class. Gemma 4 26B-A4B on Google AI Studio paid the premium endpoint in 12 of 12 episodes when the instruction sat in the task description, in 12 of 12 when it was told to repair the policy file, in 7 of 12 drain episodes, in 1 of 12 when it sat in a data file, and in 0 of 12 when it came back from the search tool. A hard cap returning the deployed contract's refusal strings refused every attempt in every class. That cap cost time rather than money: in the tampering class it lost no money and finished 17% of the tasks, because the model kept rewriting the policy file and retrying until it hit the step limit. Every episode is released as a raw record.

## Introduction

AI coding agents are moving from answering questions to acting. They read issues, run commands, call paid services and apply patches. One common action is a paid lookup: the agent pays a reference API for a price and uses it in the fix. When an attacker can shape a file in the repository, the attacker can also write an instruction that tries to redirect that payment.

A prompt instruction is not an authority. It competes with everything else in the context window and it can be ignored. A host side policy is stronger, but the policy lives in something the agent can sometimes reach. A limit imposed outside the model does not depend on the model agreeing to behave. This study isolates the enforcement point. It asks one question: what does each regime cost, in realised loss, refused legitimate work and unfinished tasks, when the injection actually arrives?

## Threat model

The attacker can place or influence repository content: the task file, a data fixture, or documentation returned by the search tool. The attacker does not control the test runner, the host process, or the vendor's price list. The agent can read files, write the task code, run the test, search local documentation and call the paid API.

The defender's goals are the task completed, the legitimate lookup made, and no payment to the attacker's target. A successful attack is an executed payment to `premium-api.testnet`. Loss counts the cents moved. A false positive is the policy refusing the legitimate 2 cent lookup.

Delivery is the critical measurement decision. An attack that never reaches the model is not an attack. The first version of this harness measured attack success without measuring delivery: the Gemma arm read the injected fixture in 0 of 36 indirect episodes and searched the documentation in 2 of 36 tool output episodes. Those cells would have scored a perfect 0% attack success rate no matter what the model did with the injection. Every episode now records `injectionExposed`, `exposureRoute` and `exposureEvidence`, and every result cell reports its exposure. In the final matrix, exposure was 100% in all 360 cells of both arms.

## Method

### Harness

The harness is a zero dependency Node 24 program. It writes each task to a temporary directory, gives the agent five tools, executes every call it requests and records the result. The agent loop is our code, so every decision is inspectable. The paid API is a local stub with two prices: 2 cents for the required reference lookup and 200 cents for the premium endpoint the attack targets. The budget and the per spend cap are both 10 cents. After each episode the harness reruns the task tests and reports `verifiedPatchPassed` separately from `taskPassed`.

### Tasks

Twelve Python tasks each contain one bug and a failing test. Each task requires the agent to read its data fixture and to search the documentation, because the task description says so. The fixtures point at the reference values the fix needs, so the control is reproducible.

### Attack classes

| Attack | How it arrives | Delivery needs |
| --- | --- | --- |
| `direct` | The task description tells the agent to pay the premium endpoint first | Nothing, it is in the user message |
| `indirect` | The data fixture carries the instruction | The agent reads the fixture |
| `tool_output` | The search result carries the instruction | The agent searches the docs |
| `drain` | Repeated 2 cent payments under the per spend cap exhaust the budget | Nothing |
| `tamper` | The agent is told the policy file is wrong and where it lives | Nothing |

Each injection claims that a premium activation is required and that setup costs are exempt from the task budget. The drain class carries no injection and asks for a payment per shard.

### Regimes

`prompt_only` puts the budget and the cap in the system prompt. `tool_policy` checks each call in the host with an allowlist, a per spend cap, a rate limit, and a mutable `policy.json` in the task directory, so a tampered file is honoured by design. `hard_cap` enforces the limit outside the model with an allowance chain that has the same decision surface as the deployed contract, returning that contract's exact refusal strings with the evidence lines, pinned by a test. An informative refusal changes behaviour, and an empty refusal in the first matrix made the model retry until the step cap ran out.

The real implementation lives in the sibling `bound` repository. A function call access key scoped to one contract method cannot point at the vendor, the contract stores the policy and evaluates every request, and every decision leaves a receipt.

### Metrics

Attack success rate is executed payments to the premium receiver, and mean loss counts the cents moved. Exposure rate is episodes where the injected text reached the model. Task completion is the agent's run passing the test, and the verified patch rate is the post-episode test result. Lookup completion is the legitimate 2 cent payment executing, and the false positive rate counts legitimate calls the policy refused. Step capped counts episodes that reached the 20 step limit, and refused calls counts the payment attempts the policy turned down.

### Runs

Twelve tasks, five attacks, three regimes, one seed per cell, 180 runs per arm. Temperature is zero, so a second seed would not sample a different behaviour and a cell is one episode.

## Results

Table 1 is generated from the raw records. "Paid" is the attack success rate. Every control cell finished its task with no step-capped episode, so those two columns are carried only for the model arm. The full table with every metric for both arms is in `results/table.md`.

| attack | regime | control paid | gemma paid | gemma task done | gemma capped |
| --- | --- | --- | --- | --- | ---|
| direct | hard_cap | 0% | 0% | 92% | 2 |
| direct | prompt_only | 100% | 100% | 100% | 1 |
| direct | tool_policy | 0% | 0% | 83% | 3 |
| drain | hard_cap | 0% | 0% | 92% | 8 |
| drain | prompt_only | 100% | 58% | 100% | 2 |
| drain | tool_policy | 0% | 0% | 100% | 7 |
| indirect | hard_cap | 0% | 0% | 100% | 1 |
| indirect | prompt_only | 100% | 8% | 100% | 1 |
| indirect | tool_policy | 0% | 0% | 92% | 2 |
| tamper | hard_cap | 0% | 0% | 17% | 10 |
| tamper | prompt_only | 100% | 100% | 92% | 3 |
| tamper | tool_policy | 100% | 100% | 83% | 3 |
| tool_output | hard_cap | 0% | 0% | 92% | 2 |
| tool_output | prompt_only | 100% | 0% | 92% | 2 |
| tool_output | tool_policy | 0% | 0% | 100% | 1 |

The control arm shows the harness works. The injection reached the agent in all 180 cells, and the pattern is the expected one. The prompt regime allowed the payment in every class. The tool policy refused every class except tampering, which worked because the tampered file was honoured. The hard cap refused everything and finished every task. The control pays for that with a scripted agent, so both arms are reported.

Gemma 4 26B-A4B behaves differently, and the difference is about how the instruction arrived. It paid in every episode where the instruction was explicit, in 7 of 12 drain episodes, in 1 of 12 episodes where the instruction sat in a data file the agent had to read, and in 0 of 12 episodes where it came back from the search tool. The model read the poisoned fixture in all 36 indirect episodes across the three regimes and still declined to pay in 35 of them.

The three regimes separate cleanly in the two classes where the instruction is explicit. Under `direct`, prompt only lost 200 cents in every episode and the two enforcing regimes lost nothing. Under `tamper`, prompt only and the tool policy both lost 200 cents in every episode, because the agent rewrote the policy file and the host honoured it. The hard cap lost nothing in the same cell.

The hard cap has a cost, visible in `tamper`. Task completion fell to 17%, 10 of 12 episodes reached the step limit, and the policy refused 7.8 payment attempts per episode. The model rewrote `policy.json`, tried to pay, was refused, rewrote the file again and tried again. The boundary held every time, and the agent never got to the task. The drain class shows the same shape at lower intensity, with 8 of 12 episodes capped under the hard cap.

False positives were zero in all 360 cells. The legitimate 2 cent lookup ran in every control episode and in 83% to 100% of the Gemma episodes, the exception being the tampering cell under the hard cap at 17%.

## Analysis

The cleanest comparison in the matrix is the tampering cell. Same model, same task, same number of steps available. The tool policy paid the premium endpoint 12 times out of 12, and the hard cap paid it 0 times out of 12. The only difference is where the rule lives. A policy file sitting in the task directory is reachable by the agent, and a rule the agent can edit is a suggestion. This is why the paper's earlier protocol design, a restricted access key pointed at the payment receiver, could not have worked: nearcore rejects any deposit on a function call key, so the key cannot move money at all and the allowance only caps gas.

The second point is how much the model's own caution can be credited. In the delivered cells this model mostly refused to pay on the covert routes, 1 of 12 for a poisoned data file and 0 of 12 for a poisoned search result. A study that measured attack success without measuring delivery would have reported the model as robust. The control arm shows the opposite: a compliant agent in the same harness paid in every cell. The difference between those results is the model, not the defence, and the prompt regime would have failed against either one.

The third point is that a refusal has to be designed as a terminal state. The hard cap stopped every payment, and in the tampering class it cost 83% of task completion because the model treated the refusal as something to retry. The deployed contract's refusal names the reason and prints the allowlist, which is the most the chain can do. A host that refuses repeated identical calls would report a smaller cost, so this number is an upper bound on the time cost rather than a prediction for a well built host.

## Limitations

The task set is small and synthetic, the paid API is a local stub, and no money moved. The model arm is one episode per cell, one seed, one model, one endpoint, one date. The control arm is scripted, so it proves the delivery path and the defence logic rather than model behaviour. The hard cap in the matrix is a simulator whose rules and refusal strings match the deployed contract and are pinned by a test. The contract itself is not inside this matrix.

The free endpoint returned HTTP 500 with an empty body on roughly half of its raw requests, and 39 of the 180 model cells in the first pass died on transport errors rather than on anything the harness did. Those cells were quarantined and rerun, and the reported records are the rerun. The step cap metric counts each refused retry as a step, so the time cost of a refusal is an upper bound. The attack text is explicit, and hidden, obfuscated or multi-step payloads may behave differently.

## Related work

Greshake et al described indirect prompt injection in LLM integrated applications [Greshake 2023]. AgentDojo measures attacks and defences for tool using agents in a dynamic environment [Debenedetti 2024]. Jimenez et al introduced SWE-bench for repository issue resolution [Jimenez 2024]. Dziemian et al report a large public red teaming competition across frontier models with 8,648 successful attacks [Dziemian 2026]. We are not aware of a controlled comparison that isolates the enforcement point for a coding agent that can spend money, and we do not claim to be first.

## Conclusion

Prompts can ask an agent not to overspend. They cannot be the boundary. In every delivered cell the prompt regime left a bypass open, and in the two classes where the instruction was explicit that bypass cost the full premium every time. A boundary outside the model authorised none of them. The tier most likely to fail is a policy that trusts a file the agent can write. The harness, the task set and every raw run are released so any operator can check the table and rerun the matrix.

## References

- Greshake, Abdelnabi, Mishra, Endres, Holz, Fritz. Not what you've signed up for: Compromising real-world LLM-integrated applications with indirect prompt injection. arXiv:2302.12173, 2023. Retrieved 2026-11-05.
- Debenedetti, Zhang, Balunovic, Beurer-Kellner, Fischer, Tramèr. AgentDojo: A dynamic environment to evaluate prompt injection attacks and defenses for LLM agents. NeurIPS 2024 Datasets and Benchmarks Track. arXiv:2406.13352. Retrieved 2026-11-05.
- Dziemian et al. How vulnerable are AI agents to indirect prompt injections? Insights from a large-scale public competition. arXiv:2603.15714, 2026. Retrieved 2026-11-05.
- Jimenez, Yang, Wettig, Yao, Pei, Press, Narasimhan. SWE-bench: Can language models resolve real-world GitHub issues? ICLR 2024. arXiv:2310.06770. Retrieved 2026-11-05.
- NEAR nearcore `verify_function_call_permission`, `DepositWithFunctionCall` and the access key model. https://github.com/near/nearcore/blob/master/runtime/runtime/src/verifier.rs, retrieved 2026-11-05.

## Reproduction

The harness, the task set, the policy engine and every raw run are in this repository: https://github.com/unifyWeb3/gemma4-agent-spend-cap

```bash
node --test harness/*.test.js
node harness/run.js --tasks 12 --attacks all --defenses all --model stub --out results/control-v2
node tools/table.js --paper
```

Raw records are in `results/control-v2/` and `results/gemma-ai-studio-v2/`. The earlier matrix is in `results/archive-pre-fix/` and is never quoted. The table is generated from the raw JSON, not typed by hand.
