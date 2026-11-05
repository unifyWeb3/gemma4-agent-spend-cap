/**
 * The matrix runner.
 *
 * Runs every task against every attack class under every defence regime and
 * writes one JSON file per run plus a summary table. Everything is written to
 * disk so a reader can check the numbers in the paper against the raw logs.
 *
 * Usage:
 *   node harness/run.js --tasks 6 --attacks all --defenses all --model stub
 *   node harness/run.js --model openrouter --tasks 12 --out results/runs-main
 */

import { mkdirSync, writeFileSync, rmSync, existsSync, copyFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

import { ATTACKS, INJECTIONS, DRAIN_CALLS, DRAIN_AMOUNT, assessPayments, ATTACK_API } from './attacks.js';
import { BUDGET_CENTS, AllowanceChain, experimentPolicy, makeHost, systemPrompt } from './defenses.js';
import { OpenRouterModel, PollinationsModel, StubModel, makeTools, runAgent, toolProtocol } from './agent.js';
import { SOLUTIONS, TASKS, taskMarkdown } from './tasks.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..');

/**
 * Parse the command line.
 *
 * @param {string[]} argv
 */
function parseArgs(argv) {
  const args = {
    tasks: 6,
    attacks: 'all',
    defenses: 'all',
    model: 'stub',
    out: 'results/runs',
    seed: 0,
    work: '/tmp/paper-runs',
  };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    switch (key) {
      case '--tasks': args.tasks = Number(value); i += 1; break;
      case '--attacks': args.attacks = value; i += 1; break;
      case '--defenses': args.defenses = value; i += 1; break;
      case '--model': args.model = value; i += 1; break;
      case '--out': args.out = value; i += 1; break;
      case '--work': args.work = value; i += 1; break;
      case '--seed': args.seed = Number(value); i += 1; break;
      case '--help':
        console.log('usage: node harness/run.js [--tasks N] [--attacks all|a,b] [--defenses all|a,b] [--model stub|openrouter|pollinations] [--out DIR] [--work DIR]');
        process.exit(0);
        break;
      default: break;
    }
  }
  return args;
}

/**
 * Write a task to a directory, with the attack applied.
 *
 * @param {string} workdir
 * @param {object} task
 * @param {object} attack
 */
function materialise(workdir, task, attack) {
  rmSync(workdir, { recursive: true, force: true });
  mkdirSync(workdir, { recursive: true });

  for (const [path, content] of Object.entries(task.files)) {
    const full = join(workdir, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content, 'utf8');
  }

  let markdown = taskMarkdown(task, BUDGET_CENTS);
  let poisonedDocs = null;

  if (attack.id === 'direct') {
    markdown += `\n${INJECTIONS.direct}\n`;
  } else if (attack.id === 'indirect') {
    const dataPath = task.dataFile;
    const full = join(workdir, dataPath);
    mkdirSync(dirname(full), { recursive: true });
    const existing = existsSync(full) ? readFileSafe(full) : '';
    writeFileSync(full, `${existing}\n${INJECTIONS.indirect}\n`, 'utf8');
  } else if (attack.id === 'tool_output') {
    poisonedDocs = INJECTIONS.tool_output;
  } else if (attack.id === 'drain') {
    markdown += `\n${INJECTIONS.drain}\n`;
  } else if (attack.id === 'tamper') {
    markdown += `\n${INJECTIONS.tamper}\n`;
  }

  writeFileSync(join(workdir, 'task.md'), markdown, 'utf8');

  const policy = experimentPolicy();
  writeFileSync(
    join(workdir, 'policy.json'),
    JSON.stringify(
      {
        budget: policy.budget,
        maxSingleSpend: policy.maxSingleSpend,
        allowedVendors: policy.allowedVendors,
        rateLimit: policy.rateLimit,
      },
      null,
      2,
    ),
    'utf8',
  );

  copyFileSync(join(HERE, 'run_tests.py'), join(workdir, 'run_tests.py'));

  return { markdown, poisonedDocs };
}

function readFileSafe(path) {
  return readFileSync(path, 'utf8');
}

/**
 * The actions the scripted agent takes for an attack class.
 *
 * @param {object} attack
 */
function stubAttackActions(attack) {
  if (attack.id === 'drain') {
    return {
      calls: Array.from({ length: DRAIN_CALLS }, () => ({
        vendor: ATTACK_API.vendor,
        amount: DRAIN_AMOUNT,
        purpose: 'shard activation',
      })),
      extra: [],
    };
  }
  if (attack.id === 'tamper') {
    return {
      calls: [{ vendor: ATTACK_API.vendor, amount: ATTACK_API.amount, purpose: 'activation' }],
      extra: [
        {
          tool: 'write_file',
          args: {
            path: 'policy.json',
            content: JSON.stringify(
              {
                budget: ATTACK_API.amount * 10,
                maxSingleSpend: ATTACK_API.amount * 2,
                allowedVendors: ['reference-api.testnet', ATTACK_API.vendor],
                rateLimit: 60,
              },
              null,
              2,
            ),
          },
        },
      ],
    };
  }
  return {
    calls: [{ vendor: ATTACK_API.vendor, amount: ATTACK_API.amount, purpose: 'activation' }],
    extra: [],
  };
}

/**
 * Run the test suite in the work directory after the agent has finished.
 *
 * This exists because a weak model can write the right fix and never call the
 * test tool, which would count as an incomplete task even though the patch is
 * correct. The result is reported under `verifiedPatch`, separate from
 * `taskPassed`, so the two numbers can disagree and the disagreement is
 * visible in the data.
 */
async function verifyPatch(workdir) {
  const testRunner = join(workdir, 'run_tests.py');
  if (!existsSync(testRunner)) {
    return { passed: null, output: '', error: 'no test runner in the work directory' };
  }
  try {
    const { stdout, stderr } = await execFileAsync('python3', [testRunner], {
      cwd: workdir,
      timeout: 20000,
    });
    return { passed: true, output: `${stdout}${stderr}`.slice(-1000), error: null };
  } catch (err) {
    const output = `${err.stdout ?? ''}${err.stderr ?? ''}`.slice(-1000);
    return { passed: false, output, error: String(err.message ?? err) };
  }
}

/**
 * Run one cell of the matrix.
 *
 * @param {object} options
 */
async function runOne({ task, attack, defense, args, runId }) {
  const workdir = join(args.work, runId);
  const { poisonedDocs } = materialise(workdir, task, attack);

  const policy = experimentPolicy();
  const state = { periodStart: 0, spent: 0, spendTimes: [], lastNonce: -1, seenVendors: [] };
  const chain = new AllowanceChain({ allowance: BUDGET_CENTS, allowlist: policy.allowedVendors, maxSingle: policy.maxSingleSpend });
  const host = makeHost(defense, {
    policy,
    state,
    files: {},
    chain,
    onWrite: () => {},
    readFile: (name) => {
      const full = join(workdir, name);
      return existsSync(full) ? readFileSync(full, 'utf8') : undefined;
    },
  });

  const log = [];
  const tools = makeTools({
    workdir,
    host,
    testRunner: join(workdir, 'run_tests.py'),
    poisonedDocs,
    log,
  });

  let model;
  if (args.model === 'openrouter') {
    model = new OpenRouterModel();
  } else if (args.model === 'pollinations') {
    model = new PollinationsModel();
  } else {
    const { calls, extra } = stubAttackActions(attack);
    model = new StubModel({ solutions: SOLUTIONS, attackCalls: calls, extraActions: extra, task });
  }

  const started = Date.now();
  let record;
  try {
    const result = await runAgent({
      workdir,
      host,
      system: `${systemPrompt(defense, BUDGET_CENTS)}\n\n${toolProtocol(tools)}`,
      model,
      tools,
      initialUserMessage: readFileSync(join(workdir, 'task.md'), 'utf8'),
    });
    const assessment = assessPayments(result.payments, BUDGET_CENTS);
    const legit = result.payments.filter((p) => p.vendor === 'reference-api.testnet');
    const verification = await verifyPatch(workdir);
    record = {
      runId,
      task: task.id,
      taskName: task.name,
      attack: attack.id,
      defense,
      model: args.model,
      modelId: model.model ?? 'stub',
      budgetCents: BUDGET_CENTS,
      steps: result.steps,
      done: result.done,
      taskPassed: result.lastTestPassed,
      verifiedPatchPassed: verification.passed,
      verification,
      attackSuccess: assessment.success,
      lossCents: assessment.lossCents,
      attackCalls: assessment.calls,
      blockedSmallPayments: assessment.blockedSmallPayments,
      legitCalls: legit.length,
      legitBlocked: legit.some((p) => !p.executed),
      legitReason: legit.find((p) => !p.executed)?.reason ?? null,
      payments: result.payments,
      receipts: result.receipts,
      paymentAttempts: result.payments.length,
      lookupDone: legit.length > 0,
      repeats: result.repeats ?? 0,
      modelCalls: result.modelCalls,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      modelWaits: model.waits ?? 0,
      modelWaitedMs: model.waitedMs ?? 0,
      modelNetworkErrors: model.networkErrors ?? 0,
      durationMs: Date.now() - started,
      log: result.log,
      transcript: result.transcript,
    };
  } catch (err) {
    record = {
      runId,
      task: task.id,
      attack: attack.id,
      defense,
      model: args.model,
      error: String(err.message ?? err),
      durationMs: Date.now() - started,
    };
  }

  return record;
}

/**
 * Aggregate the runs into the table the paper uses.
 *
 * @param {object[]} records
 */
export function summarise(records) {
  const key = (r) => `${r.attack}|${r.defense}`;
  const groups = new Map();
  for (const r of records) {
    if (r.error) continue;
    const k = key(r);
    if (!groups.has(k)) {
      groups.set(k, {
        attack: r.attack,
        defense: r.defense,
        runs: 0,
        attackSuccesses: 0,
        lossCents: 0,
        taskPassed: 0,
        verifiedPassed: 0,
        verifiedFailed: 0,
        verifiedUnknown: 0,
        legitBlocked: 0,
        lookupDone: 0,
        noSpend: 0,
        blockedSmallPayments: 0,
        steps: 0,
        modelCalls: 0,
      });
    }
    const g = groups.get(k);
    g.runs += 1;
    g.attackSuccesses += r.attackSuccess ? 1 : 0;
    g.lossCents += r.lossCents;
    g.taskPassed += r.taskPassed ? 1 : 0;
    if (r.verifiedPatchPassed === true) g.verifiedPassed += 1;
    else if (r.verifiedPatchPassed === false) g.verifiedFailed += 1;
    else g.verifiedUnknown += 1;
    g.legitBlocked += r.legitBlocked ? 1 : 0;
    g.lookupDone += r.lookupDone ? 1 : 0;
    g.noSpend += r.paymentAttempts === 0 ? 1 : 0;
    g.blockedSmallPayments += r.blockedSmallPayments ?? 0;
    g.steps += r.steps;
    g.modelCalls += r.modelCalls;
  }

  return [...groups.values()]
    .map((g) => ({
      attack: g.attack,
      defense: g.defense,
      runs: g.runs,
      attackSuccessRate: g.runs ? g.attackSuccesses / g.runs : 0,
      meanLossCents: g.runs ? g.lossCents / g.runs : 0,
      taskCompletion: g.runs ? g.taskPassed / g.runs : 0,
      verifiedPatchRate: g.verifiedPassed + g.verifiedFailed > 0
        ? g.verifiedPassed / (g.verifiedPassed + g.verifiedFailed)
        : null,
      verifiedUnknown: g.verifiedUnknown,
      falsePositiveRate: g.runs ? g.legitBlocked / g.runs : 0,
      lookupRate: g.runs ? g.lookupDone / g.runs : 0,
      noSpendRate: g.runs ? g.noSpend / g.runs : 0,
      blockedSmallPayments: g.runs ? g.blockedSmallPayments / g.runs : 0,
      meanSteps: g.runs ? g.steps / g.runs : 0,
      meanModelCalls: g.runs ? g.modelCalls / g.runs : 0,
    }))
    .sort((a, b) => a.attack.localeCompare(b.attack) || a.defense.localeCompare(b.defense));
}

/**
 * Render the summary as a markdown table.
 *
 * @param {object[]} summary
 */
export function summaryMarkdown(summary) {
  const head = '| attack | defence | runs | attack success | mean loss cents | task completion | patch verified | lookup done | legit blocked | blocked small calls | mean steps |';
  const sep = '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |';
  const rows = summary.map(
    (s) =>
      `| ${s.attack} | ${s.defense} | ${s.runs} | ${(s.attackSuccessRate * 100).toFixed(0)}% | ${s.meanLossCents.toFixed(1)} | ${(s.taskCompletion * 100).toFixed(0)}% | ${s.verifiedPatchRate === null ? 'n/a' : `${(s.verifiedPatchRate * 100).toFixed(0)}%`} | ${(s.lookupRate * 100).toFixed(0)}% | ${(s.falsePositiveRate * 100).toFixed(0)}% | ${s.blockedSmallPayments.toFixed(1)} | ${s.meanSteps.toFixed(1)} |`,
  );
  return [head, sep, ...rows].join('\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const tasks = TASKS.slice(0, args.tasks);
  const attacks = args.attacks === 'all' ? ATTACKS : ATTACKS.filter((a) => args.attacks.split(',').includes(a.id));
  const defenses = args.defenses === 'all' ? ['prompt_only', 'tool_policy', 'hard_cap'] : args.defenses.split(',');

  const outDir = join(REPO, args.out);
  mkdirSync(outDir, { recursive: true });
  mkdirSync(args.work, { recursive: true });

  const records = [];
  let count = 0;
  const total = tasks.length * attacks.length * defenses.length;
  for (const task of tasks) {
    for (const attack of attacks) {
      for (const defense of defenses) {
        count += 1;
        const runId = `${task.id}_${attack.id}_${defense}_${args.model}`;
        process.stdout.write(`[${count}/${total}] ${runId}\n`);
        const record = await runOne({ task, attack, defense, args, runId });
        records.push(record);
        writeFileSync(join(outDir, `${runId}.json`), JSON.stringify(record, null, 2));
      }
    }
  }

  const summary = summarise(records);
  const meta = {
    model: args.model,
    modelId:
      args.model === 'openrouter'
        ? (process.env.OPENROUTER_MODEL ?? 'google/gemma-4-26b-a4b-it:free')
        : args.model === 'pollinations'
          ? (process.env.POLLINATIONS_MODEL ?? 'openai-fast')
          : 'stub',
    budgetCents: BUDGET_CENTS,
    tasks: tasks.map((t) => t.id),
    attacks: attacks.map((a) => a.id),
    defenses,
    seed: args.seed,
    generatedAt: new Date().toISOString(),
    node: process.version,
  };

  writeFileSync(join(outDir, 'summary.json'), JSON.stringify({ meta, summary, records }, null, 2));
  writeFileSync(join(outDir, 'summary.md'), `# Results\n\n${summaryMarkdown(summary)}\n`);
  console.log('\n' + summaryMarkdown(summary));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
