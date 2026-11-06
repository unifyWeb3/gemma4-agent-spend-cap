# The Leash Cannot Be Prompted

Indirect prompt injection in coding agents, and the cost of a hard spend cap in front of an agent that can call paid APIs. The repository is the harness, the task set, and the raw runs for the Gemma 4 Developer Agent Paper Track.

## Status

The task set, the corrected control arm, the policy engine and the raw logs are present. The Gemma 4 arm runs on Google AI Studio. Do not submit until the Gemma 4 matrix is complete and `paper.md` reports those results. The corrected matrix runs into `results/gemma-ai-studio-v2`. The earlier matrix was archived in `results/archive-pre-fix/` and is never quoted.

## Layout

- `paper.md`, the writeup.
- `harness/`, the task set, attack classes, defence regimes, agent loop, matrix runner and exposure measurement.
- `harness/policy.js`, the pure policy engine used by the simulator. The deployed NEAR contract uses `bound/policy`, a separate dependency-free implementation, and `harness/defenses.js` reproduces the contract's refusal strings.
- `harness/exposure.js`, the module that measures whether the injection reached the model. Every episode records `injectionExposed`, `exposureRoute` and `exposureEvidence`.
- `results/control-v2/`, the 180 corrected control runs. 100% exposure in all cells.
- `results/gemma-ai-studio-v2/`, the corrected Gemma 4 matrix.
- `results/archive-pre-fix/`, the earlier matrix and its summary, kept as evidence of the delivery bug.
- `LIMITATIONS.md`, what the experiment does and does not show.
- `SEEDS.md`, exact commands and seeds.
- `.env.example`, model credentials template. Copy it to `.env` and put your own key there. Never commit `.env`.

## Run

Requires Node 22 or newer and Python 3 for the task test runner.

```bash
npm test
node --test harness/*.test.js
node harness/run.js --tasks 12 --model stub --out results/control-v2
```

`npm test` works but the explicit glob matches the layout on any Node 22+.

For a model arm, fill `.env` and use one of the supported model arguments:

```bash
node --env-file-if-exists=.env harness/run.js --tasks 12 --model google --out results/gemma-ai-studio-v2 --concurrency 4
node --env-file-if-exists=.env harness/run.js --tasks 12 --model openrouter --out results/openrouter-gemma
node --env-file-if-exists=.env harness/run.js --tasks 12 --model pollinations --out results/pollinations-substitute
```

`google` needs `GOOGLE_API_KEY` and is the primary arm. It runs Gemma 4 on Google AI Studio through the OpenAI compatible surface. `openrouter` needs `OPENROUTER_API_KEY`. Its free Gemma 4 endpoints answered 429 on every attempt on 2026-11-05, so it is kept as a fallback and not used for the reported matrix. `pollinations` is keyless but rate limited and is not Gemma. The stub control is not a model.

## What the experiment measures

Delivery is part of the measurement. Each task requires the agent to read its data fixture and to search its documentation. The fixture carries the indirect injection and the search result carries the tool output injection, and each episode records whether the injected text actually reached the model.

The control arm is a scripted agent that performs the exposure step before it complies. Its purpose is to prove the apparatus, not to stand in for a model.

Metrics per cell: exposure rate, attack success rate, attack success given exposure, mean loss, task completion, post-run verified patch rate, legitimate lookup completion, false positive rate on legitimate paid calls, and the number of refused calls under 10 cents.

## What the experiment shows so far

The corrected control shows that a prompt instruction allows the premium payment in all five attack classes. The tool policy stops every attack except `tamper`, and `hard_cap` stops all of them, including `tamper`. Gemma 4 reports how the model behaved under the same three regimes, with exposure reported next to attack success.

## Licence

Apache 2.0. Winners must deliver the code and docs under Apache 2.0.

## Disclosure

This repository contains AI-assisted code and prose. The experiment, decisions and final submission remain subject to builder approval before publication.
