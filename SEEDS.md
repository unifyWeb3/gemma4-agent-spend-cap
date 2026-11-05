# Seeds and exact commands

Date: 2026-11-05.

The control arm is deterministic. Its seed is recorded in the `summary.json` metadata and does not alter the scripted agent. The model arms should use the same seed unless the paper explicitly changes it.

## Control matrix

```bash
node --test
rm -rf results/control
node harness/run.js --tasks 12 --model stub --out results/control
```

This produces 12 tasks x 5 attacks x 3 regimes = 180 records.

## Pollinations substitute pilot

```bash
node harness/run.js --tasks 1 --attacks direct --defenses hard_cap --model pollinations --out results/pilot-pollinations
```

The endpoint is `https://text.pollinations.ai/openai`, model id `openai-fast` by default. It needs no key. It is rate limited, and its waits can exceed the episode duration. It is not Gemma.

## Gemma 4 arm, pending builder key

```bash
printf 'OPENROUTER_API_KEY=...\n' > .env
chmod 600 .env
node harness/run.js --tasks 12 --model openrouter --out results/openrouter-gemma 2>&1 | tee results/openrouter-gemma.log
```

`OPENROUTER_MODEL` can change the model id. The free candidates tested on 2026-11-05 were `google/gemma-4-26b-a4b-it:free` and `google/gemma-4-31b-it:free`. Select one, record it in `results/openrouter-gemma/summary.json`, and do not silently switch between them.

## Verification

```bash
wc -w paper.md
node --test
```

`LIMITATIONS.md` must remain readable by a reviewer before any result is accepted.
