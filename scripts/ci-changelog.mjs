#!/usr/bin/env node
/**
 * ci-changelog.mjs - changelog discipline gate for Attestto npm packages.
 *
 * Fails a pull request when:
 *   1. Any file under src/** changed but CHANGELOG.md did not.
 *   2. The top "## [x.y.z]" heading in CHANGELOG.md does not equal
 *      "version" in package.json.
 *   3. CHANGELOG.md contains an em-dash (U+2014). These are public repos and
 *      em-dashes read as machine-written prose.
 *
 * Skips entirely when the PR author is dependabot[bot], or when no src/** file
 * changed.
 *
 * Plain Node ESM, zero dependencies, runs on Node 20.
 *
 * Local use:  node scripts/ci-changelog.mjs [--base <ref>]
 */

import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHANGELOG = 'CHANGELOG.md';
const EM_DASH = '—';

// Shipped source. A change under any of these paths requires a changelog entry.
// Every repo that ships from src/ leaves this alone; attestto-trust overrides it
// because its shipped artifact is the countries/ tree, not a src/ directory.
const SOURCE_PATHS = ['src/'];
const isSource = (f) => SOURCE_PATHS.some((p) => (p.endsWith('/') ? f.startsWith(p) : f === p));

const errors = [];

/** Emit a GitHub Actions error annotation (also readable as plain text locally). */
function fail(message, { file, line } = {}) {
  const loc = file ? `file=${file}${line ? `,line=${line}` : ''}` : '';
  console.log(`::error ${loc}::${message}`);
  errors.push(message);
}

function git(args) {
  return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
}

function gitOrNull(args) {
  try {
    return git(args);
  } catch {
    return null;
  }
}

/** PR author, from the event payload when available, else the actor. */
function prAuthor() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (eventPath && existsSync(eventPath)) {
    try {
      const event = JSON.parse(readFileSync(eventPath, 'utf8'));
      const login = event?.pull_request?.user?.login;
      if (login) return login;
    } catch {
      /* fall through to GITHUB_ACTOR */
    }
  }
  return process.env.GITHUB_ACTOR || '';
}

/** The ref this branch should be compared against. */
function baseRef() {
  const flagIndex = process.argv.indexOf('--base');
  if (flagIndex !== -1 && process.argv[flagIndex + 1]) return process.argv[flagIndex + 1];
  if (process.env.GITHUB_BASE_REF) return process.env.GITHUB_BASE_REF;
  if (gitOrNull(['rev-parse', '--verify', '--quiet', 'origin/develop'])) return 'develop';
  return 'main';
}

/**
 * Resolve the base branch to a local commit, fetching it if the checkout is
 * shallow (actions/checkout defaults to depth 1, so origin/<base> is absent).
 */
function resolveBaseCommit(ref) {
  const local = gitOrNull(['rev-parse', '--verify', '--quiet', `origin/${ref}`]);
  if (local) return `origin/${ref}`;
  if (gitOrNull(['fetch', '--no-tags', '--depth=200', 'origin', `+refs/heads/${ref}:refs/remotes/origin/${ref}`]) !== null) {
    const fetched = gitOrNull(['rev-parse', '--verify', '--quiet', `origin/${ref}`]);
    if (fetched) return `origin/${ref}`;
  }
  return gitOrNull(['rev-parse', '--verify', '--quiet', ref]);
}

/** Files changed on this branch relative to the base. */
function changedFiles(ref) {
  const base = resolveBaseCommit(ref);
  if (!base) {
    console.log(`::warning::Could not resolve base ref "${ref}"; changelog gate skipped.`);
    return null;
  }
  const mergeBase = gitOrNull(['merge-base', base, 'HEAD']) || base;
  const out = gitOrNull(['diff', '--name-only', `${mergeBase}...HEAD`]) ?? gitOrNull(['diff', '--name-only', base, 'HEAD']);
  if (out === null) {
    console.log(`::warning::Could not diff against "${base}"; changelog gate skipped.`);
    return null;
  }
  return out.split('\n').filter(Boolean);
}

// --- skip conditions -------------------------------------------------------

const author = prAuthor();
if (author === 'dependabot[bot]') {
  console.log('Changelog gate skipped: dependabot pull request.');
  process.exit(0);
}

const ref = baseRef();
const files = changedFiles(ref);
if (files === null) process.exit(0);

const changedSource = files.filter(isSource);
if (changedSource.length === 0) {
  console.log(`Changelog gate skipped: no changes under ${SOURCE_PATHS.join(', ')} against ${ref}.`);
  process.exit(0);
}

// --- check 1: src/** changed, CHANGELOG.md did not -------------------------

const changelogChanged = files.includes(CHANGELOG);
if (!changelogChanged) {
  const sample = changedSource.slice(0, 5).join(', ');
  fail(
    `Shipped source changed (${sample}${changedSource.length > 5 ? ', ...' : ''}) but ${CHANGELOG} was not updated. ` +
      'Every change to shipped source needs a changelog entry. See the "changelog" skill for the house style.',
    { file: CHANGELOG }
  );
}

// --- checks 2 and 3 require the file to exist ------------------------------

const changelogPath = resolve(REPO_ROOT, CHANGELOG);
const pkgPath = resolve(REPO_ROOT, 'package.json');

if (!existsSync(changelogPath)) {
  fail(`${CHANGELOG} is missing.`, { file: CHANGELOG });
} else if (!existsSync(pkgPath)) {
  fail('package.json is missing; cannot check the changelog version.');
} else {
  const changelog = readFileSync(changelogPath, 'utf8');
  const lines = changelog.split('\n');
  const pkgVersion = JSON.parse(readFileSync(pkgPath, 'utf8')).version;

  // check 2: top released heading must equal package.json version.
  // "## [Unreleased]" is intentionally not matched, so a staging section is allowed.
  let topVersion = null;
  let topLine = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const match = /^##\s*\[(\d+\.\d+\.\d+[^\]]*)\]/.exec(lines[i]);
    if (match) {
      topVersion = match[1];
      topLine = i + 1;
      break;
    }
  }

  if (topVersion === null) {
    fail(`${CHANGELOG} has no "## [x.y.z]" version heading.`, { file: CHANGELOG, line: 1 });
  } else if (topVersion !== pkgVersion) {
    fail(
      `${CHANGELOG} top version is [${topVersion}] but package.json version is ${pkgVersion}. ` +
        'Bump one or the other so the published package and its changelog agree.',
      { file: CHANGELOG, line: topLine }
    );
  }

  // check 3: no em-dashes.
  let emDashCount = 0;
  lines.forEach((text, i) => {
    if (!text.includes(EM_DASH)) return;
    emDashCount += (text.match(/—/g) || []).length;
    fail(
      `Em-dash (U+2014) in ${CHANGELOG}. Rewrite with a comma, a colon, parentheses or a separate sentence. ` +
        'Do not substitute a plain hyphen.',
      { file: CHANGELOG, line: i + 1 }
    );
  });
  if (emDashCount > 0) {
    console.log(`::notice::${emDashCount} em-dash(es) found in ${CHANGELOG}.`);
  }
}

// --- result ----------------------------------------------------------------

if (errors.length > 0) {
  console.log(`Changelog gate FAILED with ${errors.length} error(s).`);
  process.exit(1);
}

console.log(
  `Changelog gate passed: ${CHANGELOG} updated alongside ${changedSource.length} source file(s), top version matches package.json, no em-dashes.`
);
