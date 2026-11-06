/**
 * Move failed episode records out of a results directory.
 *
 * A cell that ended in a network error is not a result. The runner writes a
 * record with an `error` field for it, and `--resume` skips any cell that
 * already has a record, so a failed cell has to be moved aside before the
 * matrix is resumed.
 *
 * Usage:
 *   node tools/quarantine-errors.js results/gemma-ai-studio-v2
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Split a results directory into good records and failed records. */
export function split(dir) {
  const full = join(REPO, dir);
  const failed = [];
  for (const name of readdirSync(full)) {
    if (!name.endsWith('.json') || name === 'summary.json') continue;
    const record = JSON.parse(readFileSync(join(full, name), 'utf8'));
    if (record.error) failed.push(name);
  }
  return failed;
}

/** Move the failed records into a timestamped folder inside the results dir. */
export function quarantine(dir, label = 'failed-attempts') {
  const full = join(REPO, dir);
  const failed = split(dir);
  if (failed.length === 0) return { moved: [], folder: null };
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = join(full, `${label}-${stamp}`);
  mkdirSync(target, { recursive: true });
  for (const name of failed) {
    renameSync(join(full, name), join(target, name));
  }
  writeFileSync(
    join(target, 'README.md'),
    `# Failed attempts, ${stamp}\n\nThese ${failed.length} records ended in a transport error, not a result. The endpoint was unreachable or returned an error for every retry attempt. They were moved out of the results directory so \`--resume\` could run those cells again. The rerun records are in the parent folder.\n`,
  );
  return { moved: failed, folder: target };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = process.argv[2] ?? 'results/gemma-ai-studio-v2';
  const { moved, folder } = quarantine(dir);
  console.log(`moved ${moved.length} failed records to ${folder ?? 'nothing to move'}`);
  if (moved.length) console.log(moved.join('\n'));
}
