#!/usr/bin/env node
/**
 * Cut a production release for vitrine.
 *
 * A "release" here is just a semver git tag: pushing `vX.Y.Z` is picked up by a
 * Flux `GitRepository` (semver ref) on the Civitai cluster, which triggers a
 * Tekton `build-and-push` PipelineRun → `ghcr.io/civitai/vitrine:<ts-sha>` →
 * Flux ImagePolicy bumps the Deployment → rollout to vitrine.civitai.com.
 *
 * This script bumps `package.json` version, commits it, creates an annotated
 * `vX.Y.Z` tag, and pushes both (branch + tag) to origin.
 *
 *   node scripts/release.mjs [patch|minor|major|X.Y.Z] [--dry-run]
 *
 * Defaults to `patch`. `--dry-run` runs every preflight check and prints the
 * planned actions but performs NO git write (no commit, tag, or push).
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PKG_PATH = path.join(REPO_ROOT, 'package.json');
const RELEASE_BRANCH = 'main';

function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

/** Run a command, capturing stdout. Throws (with stderr) on non-zero exit. */
function run(cmd, args) {
  return execFileSync(cmd, args, { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
}

/** Run a git command; returns { ok, out } instead of throwing. */
function tryGit(args) {
  try {
    return { ok: true, out: run('git', args) };
  } catch (err) {
    return { ok: false, out: (err.stderr || err.stdout || String(err)).trim() };
  }
}

/** Parse a `X.Y.Z` string into [major, minor, patch]; fail on anything else. */
function parseVersion(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v);
  if (!m) fail(`Not a valid X.Y.Z version: "${v}"`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** Compute the next version from the current one + a bump type or explicit version. */
function computeNextVersion(current, bump) {
  if (/^\d+\.\d+\.\d+$/.test(bump)) return bump; // explicit target version
  const [major, minor, patch] = parseVersion(current);
  switch (bump) {
    case 'major':
      return `${major + 1}.0.0`;
    case 'minor':
      return `${major}.${minor + 1}.0`;
    case 'patch':
      return `${major}.${minor}.${patch + 1}`;
    default:
      fail(`Unknown bump type "${bump}". Use patch | minor | major | X.Y.Z.`);
  }
}

function parseArgs(argv) {
  let dryRun = false;
  let bump = 'patch';
  let sawBump = false;
  for (const arg of argv) {
    if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg.startsWith('-')) {
      fail(`Unknown flag "${arg}". Usage: release.mjs [patch|minor|major|X.Y.Z] [--dry-run]`);
    } else if (!sawBump) {
      bump = arg;
      sawBump = true;
    } else {
      fail(`Unexpected extra argument "${arg}".`);
    }
  }
  return { bump, dryRun };
}

function preflight(tag) {
  // Must be inside a git work tree.
  if (!tryGit(['rev-parse', '--is-inside-work-tree']).ok) {
    fail('Not a git repository.');
  }

  // Working tree must be clean.
  const dirty = tryGit(['status', '--porcelain']);
  if (dirty.ok && dirty.out) {
    fail(`Working tree is not clean — commit or stash first:\n${dirty.out}`);
  }

  // Must be on the release branch.
  const branch = tryGit(['rev-parse', '--abbrev-ref', 'HEAD']).out;
  if (branch !== RELEASE_BRANCH) {
    fail(`On branch "${branch}", but releases must be cut from "${RELEASE_BRANCH}".`);
  }

  // Fetch so the up-to-date check is meaningful.
  console.log('→ git fetch origin');
  const fetched = tryGit(['fetch', 'origin', RELEASE_BRANCH, '--tags']);
  if (!fetched.ok) fail(`git fetch failed:\n${fetched.out}`);

  // Local main must match origin/main exactly (no ahead/behind/diverged).
  const localRef = tryGit(['rev-parse', RELEASE_BRANCH]);
  const remoteRef = tryGit(['rev-parse', `origin/${RELEASE_BRANCH}`]);
  if (!remoteRef.ok) fail(`Cannot resolve origin/${RELEASE_BRANCH}. Is the remote configured?`);
  if (localRef.out !== remoteRef.out) {
    const range = `origin/${RELEASE_BRANCH}...HEAD`;
    const counts = tryGit(['rev-list', '--left-right', '--count', range]);
    fail(
      `Local ${RELEASE_BRANCH} is not in sync with origin/${RELEASE_BRANCH} ` +
        `(behind/ahead: ${counts.out || '?'}). Pull/rebase first.`,
    );
  }

  // Tag must not already exist (locally or on the remote).
  if (tryGit(['rev-parse', '--verify', '--quiet', `refs/tags/${tag}`]).ok) {
    fail(`Tag ${tag} already exists locally. Bump to a new version or delete the stale tag.`);
  }
  const remoteTag = tryGit(['ls-remote', '--tags', 'origin', tag]);
  if (remoteTag.ok && remoteTag.out) {
    fail(`Tag ${tag} already exists on origin.`);
  }
}

function main() {
  const { bump, dryRun } = parseArgs(process.argv.slice(2));

  const pkgRaw = readFileSync(PKG_PATH, 'utf8');
  const pkg = JSON.parse(pkgRaw);
  const current = pkg.version;
  if (!current) fail('package.json has no "version" field.');

  const next = computeNextVersion(current, bump);
  parseVersion(next); // validate shape
  if (next === current) fail(`Computed version ${next} equals the current version.`);
  const tag = `v${next}`;

  console.log(`vitrine release: ${current} → ${next}  (tag ${tag})${dryRun ? '  [dry-run]' : ''}`);

  preflight(tag);

  if (dryRun) {
    console.log('\n[dry-run] Would perform:');
    console.log(`  • write package.json version = ${next}`);
    console.log(`  • git commit -am "chore(release): ${tag}"`);
    console.log(`  • git tag -a ${tag} -m "${tag}"`);
    console.log(`  • git push --follow-tags origin ${RELEASE_BRANCH}`);
    console.log('\n[dry-run] No changes made. Re-run without --dry-run to release.');
    return;
  }

  // 1. Bump package.json (preserve 2-space indent + trailing newline).
  pkg.version = next;
  writeFileSync(PKG_PATH, `${JSON.stringify(pkg, null, 2)}\n`);

  // 2. Commit the bump.
  const commitMsg = `chore(release): ${tag}`;
  const committed = tryGit(['commit', '-am', commitMsg]);
  if (!committed.ok) {
    // Roll the version file back so a failed run leaves no half-state.
    writeFileSync(PKG_PATH, pkgRaw);
    fail(`git commit failed:\n${committed.out}`);
  }
  console.log(`✓ committed "${commitMsg}"`);

  // 3. Annotated tag.
  const tagged = tryGit(['tag', '-a', tag, '-m', tag]);
  if (!tagged.ok) {
    fail(
      `git tag failed:\n${tagged.out}\n\n` +
        `The release commit is on ${RELEASE_BRANCH} but was NOT tagged/pushed. ` +
        `Undo with: git reset --hard HEAD~1`,
    );
  }
  console.log(`✓ created annotated tag ${tag}`);

  // 4. Push branch + tag together.
  const pushed = tryGit(['push', '--follow-tags', 'origin', RELEASE_BRANCH]);
  if (!pushed.ok) {
    fail(
      `git push failed:\n${pushed.out}\n\n` +
        `The commit + tag ${tag} exist LOCALLY but were not pushed.\n` +
        `Retry:   git push --follow-tags origin ${RELEASE_BRANCH}\n` +
        `Abort:   git tag -d ${tag} && git reset --hard HEAD~1`,
    );
  }

  console.log(`\n✓ Pushed ${tag} to origin/${RELEASE_BRANCH}.`);
  console.log(
    'Tekton will build ghcr.io/civitai/vitrine and Flux will roll it out to vitrine.civitai.com.',
  );
  console.log('  Watch the build:  https://tekton.civitai.com  (PipelineRun build-and-push)');
  console.log('  Verify live:      curl -s https://vitrine.civitai.com  (once rollout completes)');
  console.log('Note: the tag is pushed — the deploy is NOT yet confirmed.');
}

main();
