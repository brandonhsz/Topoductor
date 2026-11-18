// Tells unit-test failures this change introduced apart from ones its merge base already has.
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { stripVTControlCharacters } from 'node:util'

const FAIL_LINE =
  /^\s*FAIL\s+(?:\|[^|]+\|\s+)?(\S+?\.(?:test|spec)\.[cm]?[jt]sx?)(?:\s+(?:>\s+(.+)|\[.*\]))?\s*$/

/** Failing `file > test` keys from Vitest output; a file-level failure keys as the bare file. */
export function parseVitestFailures(output) {
  const failures = new Set()
  for (const line of stripVTControlCharacters(output).split(/\r?\n/)) {
    const match = FAIL_LINE.exec(line)
    if (match) {
      failures.add(match[2] ? `${match[1]} > ${match[2].trim()}` : match[1])
    }
  }
  return [...failures]
}

export function failureFile(failure) {
  return failure.split(' > ')[0]
}

/** Only failures the base reproduces exactly are preexisting; flaky or new ones stay introduced. */
export function splitPreexistingFailures(branchFailures, baseFailures) {
  const base = new Set(baseFailures)
  return {
    preexisting: branchFailures.filter((failure) => base.has(failure)),
    introduced: branchFailures.filter((failure) => !base.has(failure))
  }
}

/** Runs the failing files on a detached merge-base worktree that borrows this tree's node_modules. */
export async function runFailingFilesOnBase({
  root,
  mergeBase,
  files,
  env,
  runProcess,
  maxWorkers
}) {
  const worktree = mkdtempSync(path.join(tmpdir(), 'check-changed-base-'))
  const git = (args) => runProcess({ program: 'git', args, cwd: root, env }, 'tail')
  try {
    const added = await git(['worktree', 'add', '--detach', '--force', worktree, mergeBase])
    if (added.code !== 0) {
      return null
    }
    symlinkSync(path.join(root, 'node_modules'), path.join(worktree, 'node_modules'), 'junction')
    const result = await runProcess(
      {
        program: process.execPath,
        args: [
          'config/scripts/test-runtime/execution-policy/run-vitest.mjs',
          'run',
          ...files,
          '--config',
          'config/vitest.config.ts',
          '--passWithNoTests',
          `--maxWorkers=${maxWorkers}`
        ],
        cwd: worktree,
        env
      },
      'tail'
    )
    return `${result.stdout}${result.stderr}`
  } finally {
    await git(['worktree', 'remove', '--force', worktree])
    rmSync(worktree, { recursive: true, force: true })
  }
}

/**
 * Reruns a failed unit-test task's failing files on the merge base. The task passes only when every
 * failure parses and the base fails the exact same tests; anything unclassifiable stays failed.
 */
export async function reclassifyUnitTestFailures(result, { runOnBase, mergeBase }) {
  const branchFailures = parseVitestFailures(result.output)
  if (branchFailures.length === 0) {
    return result
  }
  const files = [...new Set(branchFailures.map(failureFile))]
  const baseOutput = await runOnBase(files)
  if (baseOutput === null) {
    return {
      ...result,
      output: `${result.output}\nCould not create a merge-base worktree to check for preexisting failures.`
    }
  }
  const { preexisting, introduced } = splitPreexistingFailures(
    branchFailures,
    parseVitestFailures(baseOutput)
  )
  const base = mergeBase.slice(0, 10)
  const report = [
    ...(preexisting.length > 0
      ? [`Preexisting on ${base} (also fail there, not caused by this change):`]
      : []),
    ...preexisting.map((failure) => `  ≈ ${failure}`),
    ...(introduced.length > 0
      ? [`Not reproduced on ${base} (introduced or flaky; rerun before blaming main):`]
      : []),
    ...introduced.map((failure) => `  ✗ ${failure}`)
  ].join('\n')
  return introduced.length === 0
    ? { ...result, ok: true, preexisting, note: report }
    : { ...result, preexisting, output: `${result.output}\n\n${report}` }
}
