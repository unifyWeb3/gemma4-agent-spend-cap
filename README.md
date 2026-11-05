# The Leash Cannot Be Prompted

Working draft and harness for the Gemma 4 Developer Agent Paper Track. The repository compares prompt-level spend instructions, a host-side tool policy and a hard spend cap for a coding agent that can call paid APIs.

## Status

The Gemma 4 arm has not been run. The task set, deterministic control arm, Pollinations pilot, policy engine and raw logs are present. Do not submit until the Gemma 4 matrix is complete and `paper.md` reports those results.

## Layout

- `paper.md`, the writeup.
- `harness/`, the task set, attack classes, defence regimes, agent loop and matrix runner.
- `harness/policy.js`, the pure policy engine used by the simulator. The NEAR contract uses `bound/policy`, a separate dependency-free implementation.
- `results/control/`, the 180 generated control runs.
- `results/pilot-pollinations/`, one deliberately labelled substitute-model run.
- `LIMITATIONS.md`, what the experiment does and does not show.
- `SEEDS.md`, exact commands and seeds.
- `.env.example`, model credentials template. Copy it to `.env` and put your own key there. Never commit `.env`.

## Run

Requires Node 22 or newer and Python 3 for the task test runner.

```bash
npm test
node --test
node harness/run.js --tasks 12 --model stub --out results/control
```

For a model arm, fill `.env` and use one of the supported model arguments:

```bash
node harness/run.js --tasks 12 --model openrouter --out results/openrouter-gemma
node harness/run.js --tasks 12 --model pollinations --out results/pollinations-substitute
```

`openrouter` needs `OPENROUTER_API_KEY`. The free endpoint may throttle and is not covered by any service guarantee. `pollinations` is keyless but rate limited and is not Gemma. The stub control is not a model.

## What the experiment shows

The control experiment shows that a prompt instruction allowed the target call in all five attack classes. The enforced arms stopped every attack except `tamper` under `tool_policy`, and `hard_cap` stopped all of them. It does not show how any named model behaves until the Gemma 4 arm is run.

## Licence

Apache 2.0. Winners must deliver the code and docs under Apache 2.0.

## Disclosure

This repository contains AI-assisted code and prose. The experiment, decisions and final submission remain subject to builder approval before publication.
