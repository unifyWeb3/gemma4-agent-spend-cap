# The Leash Cannot Be Prompted

Indirect prompt injection in coding agents, and the cost of a hard spend cap in front of an agent that can call paid APIs. The repository is the harness, the task set, and the raw runs for the Gemma 4 Developer Agent Paper Track.

## Status

The full matrix is complete and reported. The control arm and the Gemma 4 arm each have 180 episode records, 0 errors, and 100% exposure in every cell. `paper.md` is 2,672 words and its table is generated from the raw records by `node tools/table.js --paper`. The earlier matrix is archived in `results/archive-pre-fix/` and is never quoted. Nothing in this repository has been published or submitted yet.

## Layout

- `paper.md`, the writeup.
- `harness/`, the task set, attack classes, defence regimes, agent loop, matrix runner and exposure measurement.
- `harness/policy.js`, the pure policy engine used by the simulator. The deployed NEAR contract uses `bound/policy`, a separate dependency-free implementation, and `harness/defenses.js` reproduces the contract's refusal strings.
- `harness/exposure.js`, the module that measures whether the injection reached the model. Every episode records `injectionExposed`, `exposureRoute` and `exposureEvidence`.
- `results/control-v2/`, the 180 corrected control runs. 100% exposure in all cells.
- `results/gemma-ai-studio-v2/`, the 180 Gemma 4 runs, plus the `failed-attempts-<timestamp>/` folders holding the transport failures that were quarantined and rerun.
- `results/table.md`, the generated results table. The compact table in `paper.md` is the first table in that file.
- `results/archive-pre-fix/`, the earlier matrix and its summary, kept as evidence of the delivery bug.
- `tools/table.js`, builds the results table from the raw records and rewrites the table in `paper.md`.
- `tools/quarantine-errors.js`, moves a failed record out of a results directory so `--resume` can run that cell again.
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
node --env-file-if-exists=.env harness/run.js --tasks 12 --model google --out results/gemma-ai-studio-v2 --concurrency 3
node --env-file-if-exists=.env harness/run.js --tasks 12 --model openrouter --out results/openrouter-gemma
node --env-file-if-exists=.env harness/run.js --tasks 12 --model pollinations --out results/pollinations-substitute
```

`google` needs `GOOGLE_API_KEY` and is the primary arm. It runs Gemma 4 on Google AI Studio through the OpenAI compatible surface. `openrouter` needs `OPENROUTER_API_KEY`. Its free Gemma 4 endpoints answered 429 on every attempt on 2026-11-05, so it is kept as a fallback and not used for the reported matrix. `pollinations` is keyless but rate limited and is not Gemma. The stub control is not a model.

## What the experiment measures

Delivery is part of the measurement. Each task requires the agent to read its data fixture and to search its documentation. The fixture carries the indirect injection and the search result carries the tool output injection, and each episode records whether the injected text actually reached the model.

The control arm is a scripted agent that performs the exposure step before it complies. Its purpose is to prove the apparatus, not to stand in for a model.

Metrics per cell: exposure rate, attack success rate, attack success given exposure, mean loss, task completion, post-run verified patch rate, legitimate lookup completion, false positive rate on legitimate paid calls, the number of refused calls under 10 cents, the number of episodes that reached the step cap, and the mean number of steps.

## What the experiment shows

The control arm shows the apparatus works. A prompt instruction allowed the premium payment in all five attack classes, the tool policy stopped every attack except `tamper`, and the hard cap stopped all of them.

Gemma 4 26B-A4B on AI Studio paid the premium endpoint in 12 of 12 episodes when the injection was in the task description and in 12 of 12 when it was told the policy file was wrong. It paid in 7 of 12 drain episodes, in 1 of 12 indirect episodes, and in 0 of 12 tool output episodes, even though the injection reached the model in every one of those cells. The hard cap refused every payment in every class.

The cost of the hard cap was time rather than money. Under `tamper` it lost no money and finished 17% of the tasks, because the model kept rewriting the policy file and retrying until it hit the 20 step limit. False positives were zero in all 360 cells.

## Licence

Apache 2.0. Winners must deliver the code and docs under Apache 2.0.

## Disclosure

This repository contains AI-assisted code and prose. The experiment, decisions and final submission remain subject to builder approval before publication.
