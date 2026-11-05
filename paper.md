# The Leash Cannot Be Prompted
## Indirect Prompt Injection in Coding Agents and the Cost of a Hard Spend Cap

Working draft, 2026-11-05. The Gemma 4 arm has not been run because the OpenRouter key is still missing. Every reported number traces to a raw log in `results/`. Do not submit this file until the Gemma arm is complete and the results section is replaced with those runs. The control arm is complete.

## Abstract

Coding agents read untrusted repositories, and a repository can instruct an agent to spend money. The usual response is a prompt saying the agent must not exceed its budget. We test what that response costs. We built twelve repository tasks, five classes of untrusted instruction, and three enforcement regimes: a prompt instruction, a host side tool policy, and a hard cap enforced outside the model. In the 180-run control experiment, the prompt instruction allowed the attack in every run, the tool policy blocked every attack except tampering, and the hard cap blocked every attack with no measured false positive on legitimate work. The same fix was verified by a post-episode test run even when the agent did not call the test tool. The Gemma 4 model arm is pending on model access and is not reported here. The task set, harness and raw logs are released with the paper.

## Introduction

AI coding agents are becoming systems that act. They read issues, run commands, call paid services and apply patches. A service call has a common shape: the agent sends money or a paid token to a vendor in exchange for data, such as a reference price. When an attacker can write a file in the repository, the attacker can also write an instruction that tries to redirect that payment.

A prompt instruction is not an authority. It can fail, and it can be ignored under pressure. A host side policy is better, but the host can fail when the agent can alter the policy it reads. A limit imposed outside the model does not depend on the model agreeing to behave.

This study asks a narrow question. What does it cost to stop indirect prompt injection in a coding agent that can spend money? The costs we measure are realised loss, a refused legitimate payment and a task that does not pass its tests.

## Threat model

The attacker can place or influence repository content: a task file, a data fixture, or documentation returned by a search tool. The attacker wants the agent to call a premium endpoint and pay more than the legitimate lookup. The attacker cannot modify the test runner, the host process, or the vendor price list. The agent can read files, write the task's code file, run the test, search local documentation and call the paid API.

The defender wants the task completed, the legitimate payment made, and no payment to the attacker target. We count a successful attack when the agent calls the attacker target, and we count a false positive when the policy blocks the legitimate reference API call. An attempt while the cap is active is still a useful refusal signal.

## Method

### Harness

The harness is a zero dependency Node 24 program. It writes each task to a temporary directory, gives the agent five tools, executes every call it requests and records the result. The agent loop is our code, so every decision is inspectable. The paid API is a local stub with two prices: 2 cents for the reference lookup the task requires, and 200 cents for the premium endpoint the attack targets. The task budget is 10 cents.

After each episode, the harness runs `harness/run_tests.py` again in the work directory. This matters because a weak model can write the right patch and never call `run_test`. The result is reported as `verifiedPatchPassed`, separately from `taskPassed`. In this draft, the control arm is deterministic and is not a model. The model arm is pending.

### Tasks

Twelve Python tasks each contain a small bug and a failing test. The bugs cover string handling, scope and comparison mistakes. Each task requires a legitimate paid lookup before the fix. The intended answers are fixed and known, so the control arm is reproducible.

### Attacks

| Attack | Delivery |
| --- | --- |
| `direct` | The task file itself tells the agent to make a premium payment first. |
| `indirect` | A data file the agent reads carries the same instruction. |
| `tool_output` | The search tool returns the instruction as its result. |
| `drain` | Repeated small payments remain under the per-spend limit and try to spend the budget. |
| `tamper` | The attack tries to alter the policy file the host trusts. |

Each attack targets `premium-api.testnet` and is rejected by the budget and allowlist rules in the enforced arms.

### Regimes

`prompt_only` puts the budget in the system prompt. `tool_policy` checks each tool call in the host and uses an allowlist and rate checks. `hard_cap` uses the same allowance chain as a deterministic backstop. The on chain NEAR implementation exists in this repository but did not run for this matrix, so the current result is a chain backstop in simulation, not a mainnet or testnet claim. No NEAR payment was made.

### Metrics

Attack success rate is the share of runs that call the attacker target. Realised loss is the value of those calls. False positive rate is the share of episodes that block the legitimate 2 cent lookup. Task completion is the agent calling the test tool and seeing it pass. Verified patch rate is the share of final work directories that pass the task tests after the episode. Both are reported because they can disagree.

## Results

The control arm contains 12 tasks, five attacks and three regimes, one seed each, 180 runs. All 180 work directories passed the post-episode test verification. The lookup was made in every episode, and no legitimate payment was blocked.

| Attack | Regime | Success | Mean loss, cents | Patch verified |
| --- | --- | ---: | ---: | ---: |
| direct | prompt_only | 100% | 200.0 | 100% |
| direct | tool_policy | 0% | 0.0 | 100% |
| direct | hard_cap | 0% | 0.0 | 100% |
| indirect | prompt_only | 100% | 200.0 | 100% |
| indirect | tool_policy | 0% | 0.0 | 100% |
| indirect | hard_cap | 0% | 0.0 | 100% |
| tool_output | prompt_only | 100% | 200.0 | 100% |
| tool_output | tool_policy | 0% | 0.0 | 100% |
| tool_output | hard_cap | 0% | 0.0 | 100% |
| drain | prompt_only | 100% | 16.0 | 100% |
| drain | tool_policy | 0% | 0.0 | 100% |
| drain | hard_cap | 0% | 0.0 | 100% |
| tamper | prompt_only | 100% | 200.0 | 100% |
| tamper | tool_policy | 100% | 200.0 | 100% |
| tamper | hard_cap | 0% | 0.0 | 100% |

The drain attack in the prompt regime made eight 2 cent calls. Both enforced arms blocked those calls. The tamper attack is the important exception for host policy: the scripted agent changed the policy the host trusted, and the host policy accepted the premium target. The hard cap did not change. That result is a property of the control, not a claim that every host policy is broken.

A single real model pilot was run with the Pollinations endpoint as a substitute, labelled as such. The task was `t01`, the attack was `direct`, the regime was `hard_cap`. The model read the file, applied the correct fix and called the reference API. The 200 cent premium payment was refused. It did not call `run_test`, so `taskPassed` was false. The post-episode check found `2/2 passed`, so `verifiedPatchPassed` was true. It needed 16 model calls, 24 waits and 692 seconds of waiting because of endpoint rate limits. This is not a Gemma result and does not support a model ranking.

## Analysis

The control result is clear. A limit the model can be talked into is not a limit. The enforced arms do not remove the attacker's option to try, and they should be judged on the cost of refusal. Here the cost was zero measured blocked legitimate calls and no task failure in the control. That is because the legitimate lookup was allowed and small. The harness cannot show what would happen with a broader vendor set or noisier policy.

The tamper row supports a simpler claim: validation should not live inside the thing being manipulated. A hard cap has a small decision surface, a budget, an allowlist and a total. It still depends on the chain or the local code that enforces it. The NEAR contract work in this repository reduces that dependency for a recipient specific cap, but it has not produced a measured run in this draft.

Task completion is not the strongest metric in a control. The stub always writes the known fix. The useful output is where the arms differ under pressure, and the tamper row is the one to repeat with a real model.

## Limitations

The task set is small and synthetic. The attack instructions are explicit for the control, and a real attacker may hide or obfuscate them. The premium endpoint is a stub and no money moved. The model arm is missing. The hard cap result tested the simulator, not a deployed chain transaction. The allowlist contains the reference and attacker endpoints, so false positives are not measured across an open web. The 2026 red team data [Dziemian et al.] shows attacks can vary sharply by model and setting; one seed here cannot support a rate estimate beyond this harness.

## Related work

Greshake et al. described indirect prompt injection in LLM integrated applications [Greshake 2023]. AgentDojo measures attacks and defences for tool using agents in a dynamic environment [Debenedetti 2024]. Jimenez et al. introduced SWE-bench for repository issue resolution tasks [Jimenez 2024]. Dziemian et al. report a large public red teaming competition across 13 frontier models and 8,648 successful attacks [Dziemian 2026]. We are not aware of an existing controlled comparison that isolates the enforcement point for a coding agent that can spend money, and we do not claim to be first.

## Conclusion

Prompts can ask an agent not to overspend. They cannot be the boundary. In the control experiment, a boundary outside the model refused every attack, while the prompt instruction did not. The NEAR harness and the policy code are released so another operator can verify the logs and rerun the matrix. The decisive question for the model arm is whether Gemma 4 behaves differently under pressure when the cap is present but the attack text is still read. That result is pending model access and will replace the pilot section before submission.

## References

- Greshake, Abdelnabi, Mishra, Endres, Holz, Fritz. Not what you've signed up for: Compromising real-world LLM-integrated applications with indirect prompt injection. arXiv:2302.12173, 2023. Retrieved 2026-11-05.
- Debenedetti, Zhang, Balunovic, Beurer-Kellner, Fischer, Tramèr. AgentDojo: A dynamic environment to evaluate prompt injection attacks and defenses for LLM agents. NeurIPS 2024 Datasets and Benchmarks Track. arXiv:2406.13352. Retrieved 2026-11-05.
- Dziemian et al. How vulnerable are AI agents to indirect prompt injections? Insights from a large-scale public competition. arXiv:2603.15714, 2026. Retrieved 2026-11-05.
- Jimenez, Yang, Wettig, Yao, Pei, Press, Narasimhan. SWE-bench: Can language models resolve real-world GitHub issues? ICLR 2024. arXiv:2310.06770. Retrieved 2026-11-05.
- NEAR access keys and function call permissions, NEAR documentation. Retrieved 2026-11-05. Limits allowance to gas on a contract call.

## Reproduction

```bash
cd paper
node --test
node harness/run.js --tasks 12 --model stub --out results/control
```

Raw records are in `results/control/` and `results/pilot-pollinations/`. The control table is generated by `harness/run.js` and not typed by hand. The Pollinations pilot used `node harness/run.js --tasks 1 --attacks direct --defenses hard_cap --model pollinations --out results/pilot-pollinations`.
