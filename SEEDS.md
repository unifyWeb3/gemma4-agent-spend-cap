# Seeds and exact commands

Date: 2026-11-06.

The control arm is deterministic. Its seed is recorded in the `summary.json` metadata and does not alter the scripted agent. The model arm uses the same seed unless the paper explicitly changes it.

## Control matrix

```bash
node --test harness/*.test.js
rm -rf results/control-v2
node harness/run.js --tasks 12 --attacks all --defenses all --model stub --out results/control-v2
```

This produces 12 tasks x 5 attacks x 3 regimes = 180 records. All cells must report `injectionExposed: true`.

## Gemma 4 arm, primary

```bash
printf 'GOOGLE_API_KEY=...\n' > .env
printf 'GEMINI_MODEL=gemma-4-26b-a4b-it\n' >> .env
chmod 600 .env
GEMINI_MIN_GAP_MS=4000 node --env-file=.env harness/run.js --tasks 12 --attacks all --defenses all \
  --model google --out results/gemma-ai-studio-v2 --work /tmp/opencode/work-gemma-v2 --concurrency 3 \
  2>&1 | tee /tmp/opencode/gemma-matrix-v2.log
```

The endpoint is the OpenAI compatible surface of Google AI Studio:

```
https://generativelanguage.googleapis.com/v1beta/openai/chat/completions
```

`GEMINI_MODEL` selects the model. `gemma-4-26b-a4b-it` is used. Do not silently switch between models, because the model id is part of the result.

`--concurrency` runs several episodes at once and `--resume` skips a cell that already has a record, so an interrupted matrix can be restarted without paying for the same episode twice. `GEMINI_MIN_GAP_MS` sets the shared gap between requests, 3000 by default. The gap exists because AI Studio applies a per project request limit and a parallel matrix can cross it.

The endpoint returns an empty HTTP 500 on roughly half of raw requests. The runner retries those calls with an escalating backoff of at most 16 attempts, and a request that still fails is recorded as an error and excluded from the table.

### Quarantine and rerun, the exact procedure used on 2026-11-06

The first pass left 39 of the 180 cells with a transport error record. An error record is not a result, and `--resume` skips any cell that already has a record, so those cells have to be moved out before the matrix is resumed.

```bash
node tools/quarantine-errors.js results/gemma-ai-studio-v2
GEMINI_MIN_GAP_MS=4000 node --env-file=.env harness/run.js --tasks 12 --attacks all --defenses all \
  --model google --out results/gemma-ai-studio-v2 --work /tmp/opencode/work-gemma-v2 --concurrency 3 --resume
```

The moved records stay in `results/gemma-ai-studio-v2/failed-attempts-<timestamp>/` as evidence. The reported records are the ones in the parent directory. A second quarantine and resume pass was needed for 3 further cells. The final matrix has 180 records and 0 errors.

The box has 3.8 GB of memory and no spare swap. Run the matrix with `--concurrency 3` or lower. A higher concurrency has been killed mid-run, and a killed run leaves the matrix short of records rather than producing wrong ones.

### Why not OpenRouter

The free Gemma 4 endpoints on OpenRouter are `google/gemma-4-26b-a4b-it:free` and `google/gemma-4-31b-it:free`. On 2026-11-05 both returned HTTP 429 on every attempt, with the body saying the model is temporarily rate limited upstream and that the limit source is a shared upstream pool. The key was valid and the model list returned the model with zero pricing. The arm was moved to AI Studio rather than kept on an endpoint that cannot serve the matrix.

The OpenRouter backend is still in the harness and can still be run:

```bash
node --env-file-if-exists=.env harness/run.js --tasks 12 --model openrouter --out results/openrouter-gemma
```

## Pollinations substitute pilot

```bash
node harness/run.js --tasks 1 --attacks direct --defenses hard_cap --model pollinations --out results/pilot-pollinations
```

The endpoint is `https://text.pollinations.ai/openai`, model id `openai-fast` by default. It needs no key. It is rate limited. It is not Gemma.

## Verification

```bash
wc -w paper.md
node --test harness/*.test.js
node tools/table.js
```

`tools/table.js` regenerates `results/table.md` from the raw JSON and, with `--paper`, rewrites the compact table inside `paper.md` in place. No number in the writeup is typed by hand.

```bash
node tools/table.js --paper
```

`LIMITATIONS.md` must remain readable by a reviewer before any result is accepted. The delivery check is part of that read: every reported cell must show its exposure.
