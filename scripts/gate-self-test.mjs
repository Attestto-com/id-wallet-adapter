#!/usr/bin/env node
/**
 * Prove this repo's quality gates can FAIL.
 *
 * ## Why this file exists in every repo
 *
 * On 2026-08-11 an audit of eight Attestto repositories found that **every
 * blocker was a control that existed and had never executed**. None were
 * missing. All were decorative, and each one hid the next:
 *
 *   - `pnpm lint` had been red on `main` since 19 May, so every PR inherited a
 *     failure it did not cause and nobody read the lint result again.
 *   - A workflow triggered on `branches: [main]`, so a PR based on another
 *     branch ran **no job at all** — every step in it was skipped, not failed.
 *   - `wxt prepare` failed and `|| true` swallowed it, producing 46 downstream
 *     type errors that pointed everywhere except at the cause.
 *   - `tsconfig.json` excluded the test directory, so `tsc --noEmit` had never
 *     type-checked a single spec.
 *   - `npm ci` ran in a repo carrying only a pnpm lockfile: **CI had never
 *     installed, ever.**
 *   - Two published packages had no CI whatsoever; 48 tests, zero of them run.
 *   - A `SONAR_TOKEN` expired in April and the scan had been skipped since.
 *
 * A green check is not evidence. Evidence is a red you caused on purpose.
 *
 * ## What it does
 *
 * Two halves, which catch different things and neither subsumes the other.
 *
 * **Static.** Reads this repo's own workflows, `package.json` and lockfiles and
 * asserts the wiring: that the gate runs at all, on every branch, before the
 * build, without a swallowed exit code, with an install command that matches
 * the lockfile actually present. A dynamic check cannot see any of this,
 * because it runs the gate directly rather than the way CI runs it.
 *
 * **Dynamic.** For each configured gate, writes a file that violates exactly
 * what that gate is for, runs the gate, and requires a NON-ZERO exit; then
 * removes the file and requires zero. A static check cannot see this, because
 * a step can be present, correctly ordered, and still be checking an empty
 * file set.
 *
 * ## Configuration
 *
 * All per-repo knowledge lives in `package.json` under `gateSelfTest`, so this
 * file is byte-identical in every repository and cannot drift between them:
 *
 *     "gateSelfTest": {
 *       "workflow": ".github/workflows/ci.yml",
 *       "testScript": "test",
 *       "buildScript": "build",
 *       "gates": [
 *         { "name": "type-check", "script": "type-check", "seed": "src/__gate__.ts",
 *           "content": "export const wrong: number = 'no'\n" }
 *       ]
 *     }
 *
 * Run: `npm run gate-self-test` (or `pnpm gate-self-test`)
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf-8'))
const config = pkg.gateSelfTest ?? {}

const failures = []
const notes = []

const check = (ok, message) => {
  if (ok) return true
  failures.push(message)
  return false
}

// ── Package manager ─────────────────────────────────────────────────
// Derived from the lockfile in the tree, never from what CI claims. The
// mismatch between the two is the defect: `cr-vc-sdk` ran `npm ci` against a
// pnpm-only repo, so its install step had failed on every run since the repo
// was created and no test had ever executed.

const hasNpmLock = existsSync(resolve(ROOT, 'package-lock.json'))
const hasPnpmLock = existsSync(resolve(ROOT, 'pnpm-lock.yaml'))
const hasYarnLock = existsSync(resolve(ROOT, 'yarn.lock'))
const pm = hasPnpmLock ? 'pnpm' : hasYarnLock ? 'yarn' : 'npm'

check(
  [hasNpmLock, hasPnpmLock, hasYarnLock].filter(Boolean).length === 1,
  `expected exactly one lockfile; found ${[
    hasNpmLock && 'package-lock.json',
    hasPnpmLock && 'pnpm-lock.yaml',
    hasYarnLock && 'yarn.lock',
  ]
    .filter(Boolean)
    .join(', ') || 'none'} — CI installs with whichever it was told about, not whichever is here`,
)

// ── Static: the workflow ────────────────────────────────────────────

const workflowPath = config.workflow ?? '.github/workflows/ci.yml'
const workflowAbs = resolve(ROOT, workflowPath)

if (!check(existsSync(workflowAbs), `${workflowPath} does not exist — this repo has no gate to self-test`)) {
  report()
}

const workflow = readFileSync(workflowAbs, 'utf-8')

/**
 * The workflow with its comment lines removed.
 *
 * Every assertion below looks for a pattern that a comment ABOUT that pattern
 * necessarily contains. Scanning the raw file made this script fail against the
 * very repos whose comments explained the defect being asserted on: a note
 * reading "the previous `npm ci` could never install" was read as an `npm ci`
 * step, and a note explaining why `continue-on-error: true` was removed was
 * read as it still being there. A checker that reddens because someone
 * documented the fix teaches people to delete the documentation.
 */
const code = workflow
  .split('\n')
  .map((line) => (/^\s*#/.test(line) ? '' : line))
  .join('\n')

const triggers = code.slice(0, code.search(/^jobs:/m))

// A step is worthless on a branch CI never hears about. `branches: [main]`
// meant a PR whose base was another feature branch ran no job at all, so every
// gate was SKIPPED rather than failed — the cheapest possible way to disable an
// entire pipeline without touching a single step.
const branchFilters = triggers.match(/^\s*branches:.*$/gm) ?? []
for (const line of branchFilters) {
  check(
    line.includes('**'),
    `${workflowPath} would skip branches outside ${line.trim()} — stacked PRs merge un-gated`,
  )
}

// `continue-on-error` and `|| true` both turn a failing gate into a passing
// job. They are how a red step becomes a green check without anyone deciding
// to remove it.
check(
  !/continue-on-error:\s*true/.test(code),
  `${workflowPath} has continue-on-error: true — that step cannot fail the build`,
)
const swallowed = (code.match(/^\s*run:.*\|\|\s*true\s*$/gm) ?? []).map((l) => l.trim())
check(
  swallowed.length === 0,
  `${workflowPath} swallows exit codes with \`|| true\`: ${swallowed.join(' / ')}`,
)

// The install command must match the lockfile that is actually here.
if (/^\s*(?:-\s+)?run:.*\bnpm ci\b/m.test(code)) {
  check(hasNpmLock, `${workflowPath} runs \`npm ci\` but there is no package-lock.json — install fails on every run`)
}
if (/^\s*(?:-\s+)?run:.*\bpnpm (?:install|i)\b/m.test(code)) {
  check(hasPnpmLock, `${workflowPath} installs with pnpm but there is no pnpm-lock.yaml`)
}

// The test step must exist, and run before the build. A build that succeeds
// after a failed test is a wasted signal.
const testScript = config.testScript ?? 'test'
const buildScript = config.buildScript ?? 'build'
const runsScript = (name) =>
  // `- run: pnpm test` and `        run: npm test` are the same step written
  // two ways. Anchoring on `run:` alone missed every inline form, so this
  // script reported "never runs test" about a workflow whose test step was
  // right there. Found by running it against vc-sdk.
  new RegExp(`^\\s*(?:-\\s+)?run:.*\\b(?:npm|pnpm|yarn)\\s+(?:run\\s+)?${escape(name)}\\b`, 'm')

const testAt = code.search(runsScript(testScript))
check(testAt >= 0, `${workflowPath} never runs \`${testScript}\` — every suite in this repo is decorative`)

if (pkg.scripts?.[buildScript]) {
  const buildAt = code.search(runsScript(buildScript))
  if (buildAt >= 0 && testAt >= 0) {
    check(testAt < buildAt, `${workflowPath} builds before it tests; the failure should land on the cheaper step`)
  } else if (buildAt < 0) {
    // Say so rather than skip. A check that quietly does not apply is the
    // shape of every defect this script exists to find: some repos invoke the
    // bundler directly (`pnpm exec electron-vite build`) instead of the named
    // script, and the ordering assertion silently evaluated to nothing.
    notes.push(
      `test-before-build ordering was NOT checked: ${workflowPath} never invokes \`${buildScript}\` by name`,
    )
  }
}

// Each configured gate must also be wired into CI. A gate that only a developer
// can run is one nobody runs.
for (const gate of config.gates ?? []) {
  check(
    code.search(runsScript(gate.script)) >= 0,
    `${workflowPath} never runs \`${gate.script}\`, so that gate protects nothing on a pull request`,
  )
}

// This file must itself be wired in, or it is one more control that exists and
// never executes — which would be a joke it is not worth making.
check(
  code.search(runsScript('gate-self-test')) >= 0,
  `${workflowPath} never runs \`gate-self-test\`, so the gates stop being checked the moment one is removed`,
)

// ── Static: the tests are type-checked ──────────────────────────────
// `tsconfig.json` excluding the test directory is invisible: `tsc --noEmit`
// passes, and the specs it never opened stay broken. Either the root config
// includes them or a second pass must.

const tsconfigPath = resolve(ROOT, 'tsconfig.json')
if (existsSync(tsconfigPath)) {
  const raw = readFileSync(tsconfigPath, 'utf-8')
  const excludesTests = /"exclude"\s*:\s*\[[^\]]*"[^"]*(tests?|__tests__|spec)[^"]*"/s.test(raw)
  if (excludesTests) {
    const referenced = code.match(/tsconfig\.(?:test|spec)\.json/)?.[0]
    check(
      Boolean(referenced) || existsSync(resolve(ROOT, 'tests/tsconfig.json')),
      'tsconfig.json excludes the tests and nothing type-checks them separately — ' +
        'a type error inside a spec is invisible',
    )
    // The step naming a config is not the same as the config existing. Deleting
    // the file leaves the step in place, and the difference between "this gate
    // is gone" and "this gate errors for an unrelated reason" is exactly the
    // kind of red people learn to scroll past.
    if (referenced) {
      check(
        existsSync(resolve(ROOT, referenced)),
        `${workflowPath} type-checks with ${referenced}, which does not exist`,
      )
    }
  }
}

// ── Static: no path out of this repository ──────────────────────────
// A tracked symlink to an absolute path publishes one machine's filesystem
// layout and dangles in every other checkout. Both instances found were named
// in .gitignore with a trailing slash, which does not match a symlink, so
// neither ever showed up as untracked.

try {
  const tracked = execFileSync('git', ['ls-files', '-s'], {
    cwd: ROOT,
    encoding: 'utf-8',
    maxBuffer: 32 * 1024 * 1024,
  })
  const escaping = tracked
    .split('\n')
    .filter((line) => line.startsWith('120000'))
    .map((line) => line.split('\t')[1])
    .filter(Boolean)
    .filter((path) => {
      const target = execFileSync('git', ['cat-file', '-p', `:${path}`], {
        cwd: ROOT,
        encoding: 'utf-8',
      })
      if (target.startsWith('/')) return true
      const depth = path.split('/').length - 1
      const up = (target.match(/(^|\/)\.\.(\/|$)/g) ?? []).length
      return up > depth
    })
  check(
    escaping.length === 0,
    `tracked symlink(s) point outside the repo: ${escaping.join(', ')}`,
  )
} catch {
  notes.push('git was unavailable; the symlink check did not run')
}

// ── Dynamic: each gate must fail on a seeded violation ──────────────

/**
 * Run a gate and return its exit code. Never throws on a failing gate.
 *
 * `execFileSync` with an argument array, so no shell parses anything: the
 * script name comes out of `package.json`, and a repo that can edit its own
 * package.json can already run whatever it likes, but there is no reason to
 * hand it a shell to do it with. The package manager still runs the script's
 * own `&&` and quoting exactly as CI does.
 */
function runGate(script) {
  try {
    execFileSync(pm, ['run', script], { cwd: ROOT, stdio: 'pipe' })
    return 0
  } catch (error) {
    return error.status ?? 1
  }
}

for (const gate of config.gates ?? []) {
  const seedPath = resolve(ROOT, gate.seed)
  if (existsSync(seedPath)) {
    failures.push(`${gate.seed} already exists; refusing to overwrite it to seed a violation`)
    continue
  }

  let seededExit
  try {
    writeFileSync(seedPath, gate.content)
    seededExit = runGate(gate.script)
  } finally {
    // A `finally` so a crash cannot leave a poisoned tree behind. The seeded
    // file violates the gate by construction; leaving it would redden every
    // subsequent run for a reason that looks like a real defect.
    rmSync(seedPath, { force: true })
  }

  check(
    seededExit !== 0,
    `\`${gate.script}\` PASSED with a deliberate violation in ${gate.seed} — ` +
      'it is not reading what it claims to read',
  )
}

// The clean tree must still pass, or the run above proves nothing: a gate that
// fails on everything is as useless as one that passes on everything, and it
// would satisfy every assertion made so far.
for (const gate of config.gates ?? []) {
  check(
    runGate(gate.script) === 0,
    `\`${gate.script}\` fails on a clean tree, so its failure above is not evidence of anything`,
  )
}

report()

function escape(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function report() {
  for (const note of notes) console.warn(`note: ${note}`)

  if (failures.length === 0) {
    const gates = (config.gates ?? []).map((g) => g.script).join(', ')
    console.log(`gate-self-test: OK${gates ? ` (proven able to fail: ${gates})` : ''}`)
    process.exit(0)
  }

  console.error(`gate-self-test: ${failures.length} problem(s)\n`)
  for (const failure of failures) console.error(`  - ${failure}`)
  console.error('')
  process.exit(1)
}
