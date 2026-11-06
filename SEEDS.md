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
node --env-file-if-exists=.env harness/run.js --tasks 12 --model google --out results/gemma-ai-studio-v2 --concurrency 4 2>&1 | tee /tmp/opencode/gemma-matrix-v2.log
```

The endpoint is the OpenAI compatible surface of Google AI Studio:

```
https://generativelanguage.googleapis.com/v1beta/openai/chat/completions
```

`GEMINI_MODEL` selects the model. `gemma-4-26b-a4b-it` is used. Do not silently switch between models, because the model id is part of the result.

`--concurrency` runs several episodes at once and `--resume` skips a cell that already has a record, so an interrupted matrix can be restarted without paying for the same episode twice. `GEMINI_MIN_GAP_MS` sets the shared gap between requests, 3000 by default. The gap exists because AI Studio applies a per project request limit and a parallel matrix can cross it.

The endpoint returns an empty HTTP 500 on roughly half of raw requests. The runner retries those calls (exponential backoff, at most 12 attempts) and a request that still fails is recorded as an error and excluded from the table.

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
```

`LIMITATIONS.md` must remain readable by a reviewer before any result is accepted. The delivery check is part of that read: every reported cell must show its exposure.
