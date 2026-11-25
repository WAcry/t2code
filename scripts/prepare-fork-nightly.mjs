#!/usr/bin/env node
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";

const upstreamRepo = "pingdotgg/t3code";
const upstreamGit = `https://github.com/${upstreamRepo}.git`;
const stackRef = "refs/pull/28845/head";
const manifestPath = ".github/fork-nightly.json";
const nightlyPattern = /^v(\d+\.\d+\.\d+)-nightly\.(\d{8})\.(\d+)$/;
const commitPattern = /^[0-9a-f]{40}$/;

const forkPaths = new Set([
  manifestPath,
  ".github/workflows/ci.yml",
  ".github/workflows/fork-nightly.yml",
  ".github/workflows/release-desktop.yml",
  "apps/desktop/src/app/DesktopAppIdentity.ts",
  "apps/desktop/src/app/DesktopEnvironment.ts",
  "apps/desktop/src/updates/DesktopUpdates.ts",
  "apps/desktop/src/updates/DesktopUpdates.test.ts",
  "apps/desktop/src/updates/updatesTestHarness.ts",
  "apps/desktop/vite.config.ts",
  "apps/server/src/git/GitManager.ts",
  "apps/server/src/git/GitManager.test.ts",
  "apps/server/src/mcp/OrchestratorMcpService.ts",
  "apps/server/src/mcp/OrchestratorMcpService.activity.test.ts",
  "apps/server/src/mcp/OrchestratorMcpToolkit.integration.test.ts",
  "apps/server/src/orchestration-v2/ContextHandoffBudget.test.ts",
  "apps/server/src/orchestration-v2/ContextHandoffDelivery.ts",
  "apps/server/src/orchestration-v2/ContextHandoffService.test.ts",
  "apps/server/src/orchestration-v2/ThreadFork.execution.test.ts",
  "apps/server/src/orchestration-v2/testkit/ProviderSwitch.integration.test.ts",
  "apps/server/src/peer/PeerForwarding.test.ts",
  "apps/web/src/appIcon.ts",
  "apps/web/src/appInit.tsx",
  "apps/web/src/branding.ts",
  "apps/web/src/components/ClientSettingsRecoveryGate.tsx",
  "apps/web/src/components/T3Wordmark.tsx",
  "apps/web/src/components/chat/TimelineAssistantRows.tsx",
  "apps/web/src/components/onboarding/WelcomePage.tsx",
  "apps/web/src/components/sidebar/SidebarChrome.tsx",
  "apps/web/src/i18n/translations/de.json",
  "apps/web/src/i18n/translations/en.json",
  "apps/web/src/i18n/translations/es.json",
  "apps/web/src/i18n/translations/fr.json",
  "apps/web/src/i18n/translations/ja.json",
  "apps/web/src/i18n/translations/ko.json",
  "apps/web/src/i18n/translations/pt-BR.json",
  "apps/web/src/i18n/translations/ru.json",
  "apps/web/src/i18n/translations/sv.json",
  "apps/web/src/i18n/translations/zh.json",
  "apps/web/vite.config.ts",
  "docs/user/portable-handoffs.md",
  "FORK.md",
  "knip.jsonc",
  "packages/provider-core/src/server/handoffBudget.ts",
  "packages/shared/src/composerContextReferences.ts",
  "packages/shared/src/composerContextReferences.test.ts",
  "scripts/apply-web-brand-assets.ts",
  "scripts/build-desktop-artifact.ts",
  "scripts/build-desktop-artifact.test.ts",
  "scripts/lib/brand-assets.ts",
  "scripts/prepare-fork-nightly.mjs",
  "scripts/verify-windows-desktop-artifact.ts",
]);

function run(command, args, { input, env } = {}) {
  const result = NodeChildProcess.spawnSync(command, args, {
    encoding: "utf8",
    env: { ...process.env, ...env },
    input,
    maxBuffer: 8 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const details = [result.stderr.trim(), result.stdout.trim()].filter(Boolean).join("\n");
    throw new Error(`${command} ${args[0]} failed${details ? `\n${details}` : ""}`);
  }
  return result.stdout.trim();
}

function git(...args) {
  return run("git", args);
}

const publishedRelease = `select(
  .draft == false and .prerelease == true and .published_at != null
  and any(.assets[]; .state == "uploaded" and .size > 0)
) | { tag: .tag_name, target: .target_commitish }`;

function findNightly(tag) {
  const releasesEndpoint = `repos/${upstreamRepo}/releases`;
  if (tag !== undefined) {
    if (!nightlyPattern.test(tag)) throw new Error(`Invalid upstream nightly tag ${tag}.`);
    const release = run("gh", ["api", `${releasesEndpoint}/tags/${tag}`, "--jq", publishedRelease]);
    if (!release)
      throw new Error(`${tag} is not a published upstream nightly with uploaded assets.`);
    return JSON.parse(release);
  }

  for (let page = 1; ; page++) {
    const result = run("gh", [
      "api",
      `${releasesEndpoint}?per_page=30&page=${page}`,
      "--jq",
      `{ count: length, nightlies: [.[] | ${publishedRelease}] }`,
    ]);
    const { count, nightlies } = JSON.parse(result);
    const nightly = nightlies.find((release) => nightlyPattern.test(release.tag));
    if (nightly) return nightly;
    if (count < 30)
      throw new Error("No published upstream nightly with uploaded assets was found.");
  }
}

function fetchUpstreamRef(ref) {
  const peeledRef = `${ref}^{}`;
  const advertised = new Map(
    git("ls-remote", "--exit-code", upstreamGit, ref, peeledRef)
      .split("\n")
      .map((line) => line.trimEnd().split("\t").reverse()),
  );
  const object = advertised.get(peeledRef) ?? advertised.get(ref);
  if (!object) throw new Error(`Upstream did not advertise ${ref}.`);
  git("fetch", "--no-tags", "--no-write-fetch-head", upstreamGit, ref);
  return git("rev-parse", "--verify", `${object}^{commit}`);
}

function previousIntegration(main, manifest) {
  const release = git("log", "-1", "--first-parent", "--format=%H", main, "--", manifestPath);
  const releaseParents = git("show", "-s", "--format=%P", release).split(" ");
  if (releaseParents.length !== 2)
    throw new Error("The previous release commit must have two parents.");

  const raw = releaseParents[1];
  const parents = git("show", "-s", "--format=%P", raw);
  if (parents !== `${manifest.upstreamCommit} ${manifest.prCommit}`) {
    throw new Error(
      "The previous integration parents do not match the pinned nightly and PR commits.",
    );
  }
  return raw;
}

function checkForkPaths(raw, release) {
  const paths = git("diff", "--name-only", "-z", "--no-renames", raw, release)
    .split("\0")
    .filter(Boolean);
  const unexpected = paths.filter(
    (path) => !forkPaths.has(path) && !path.startsWith("assets/t2code/"),
  );
  if (unexpected.length > 0) {
    throw new Error(`Unexpected fork changes need review\n${unexpected.join("\n")}`);
  }
}

function mergeTree(base, left, right) {
  return git(
    "merge-tree",
    "--write-tree",
    "--no-messages",
    ...(base ? [`--merge-base=${base}`] : []),
    left,
    right,
  );
}

function writeManifest(tree, manifest) {
  const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3code-fork-nightly-"));
  const index = NodePath.join(directory, "index");
  const env = { GIT_INDEX_FILE: index };
  try {
    run("git", ["read-tree", tree], { env });
    const blob = run("git", ["hash-object", "-w", "--stdin"], {
      input: `${JSON.stringify(manifest, null, 2)}\n`,
    });
    run("git", ["update-index", "--add", "--cacheinfo", `100644,${blob},${manifestPath}`], { env });
    return run("git", ["write-tree"], { env });
  } finally {
    NodeFS.rmSync(index, { force: true });
    NodeFS.rmSync(`${index}.lock`, { force: true });
    NodeFS.rmdirSync(directory);
  }
}

function nextReleaseTag(upstreamTag, prCommit, previous, requestedRevision) {
  const prefix = `${upstreamTag}-pr28845.`;
  const sameNightly = previous.upstreamTag === upstreamTag;
  const lastRevision = sameNightly ? Number(previous.releaseTag.slice(prefix.length)) : 0;
  if (
    sameNightly &&
    (!previous.releaseTag.startsWith(prefix) ||
      !Number.isSafeInteger(lastRevision) ||
      lastRevision < 1)
  ) {
    throw new Error(`Invalid version in ${manifestPath}.`);
  }
  if (sameNightly && previous.prCommit === prCommit && requestedRevision === undefined) {
    throw new Error(
      "Main already contains this nightly and PR commit. Supply --revision to rebuild it.",
    );
  }
  const revision = requestedRevision === undefined ? lastRevision + 1 : Number(requestedRevision);
  if (!Number.isSafeInteger(revision) || revision <= lastRevision) {
    throw new Error(`The release revision must be an integer greater than ${lastRevision}.`);
  }
  return `${prefix}${revision}`;
}

function main() {
  const { values } = NodeUtil.parseArgs({
    options: {
      "upstream-tag": { type: "string" },
      pr: { type: "string" },
      "reuse-pr": { type: "boolean" },
      revision: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (values.help) {
    console.log(
      "Usage: node scripts/prepare-fork-nightly.mjs (--pr <reviewed-sha> | --reuse-pr) [--upstream-tag <tag>] [--revision <n>]",
    );
    return;
  }
  const reviewedPr = values.pr !== undefined;
  if (
    reviewedPr === Boolean(values["reuse-pr"]) ||
    (reviewedPr && !commitPattern.test(values.pr))
  ) {
    throw new Error(
      "Supply --pr with the full reviewed commit SHA, or use --reuse-pr to keep the pinned commit.",
    );
  }
  if (values.revision !== undefined && !/^[1-9]\d*$/.test(values.revision)) {
    throw new Error("--revision must be a positive integer.");
  }

  process.chdir(git("rev-parse", "--show-toplevel"));
  git(
    "fetch",
    "--no-tags",
    "--no-write-fetch-head",
    "origin",
    "refs/heads/main:refs/remotes/origin/main",
  );
  const forkMain = git("rev-parse", "refs/remotes/origin/main");
  const previous = JSON.parse(git("show", `${forkMain}:${manifestPath}`));
  const previousRaw = previousIntegration(forkMain, previous);
  checkForkPaths(previousRaw, forkMain);

  const nightly = findNightly(values["upstream-tag"]);
  const upstreamCommit = fetchUpstreamRef(`refs/tags/${nightly.tag}`);
  if (commitPattern.test(nightly.target) && nightly.target !== upstreamCommit) {
    throw new Error(`The published release target for ${nightly.tag} differs from its Git tag.`);
  }
  const prCommit = values.pr ?? previous.prCommit;
  if (reviewedPr && fetchUpstreamRef(stackRef) !== prCommit) {
    throw new Error(
      "PR #28845 has moved. Review its current head, or use --reuse-pr to keep the pinned commit.",
    );
  }
  const releaseTag = nextReleaseTag(nightly.tag, prCommit, previous, values.revision);
  const manifest = { upstreamTag: nightly.tag, upstreamCommit, prCommit, releaseTag };

  // Keep the reviewed conflict resolutions when rebuilding the same pinned sources.
  const raw =
    upstreamCommit === previous.upstreamCommit && prCommit === previous.prCommit
      ? previousRaw
      : git(
          "commit-tree",
          mergeTree(null, upstreamCommit, prCommit),
          "-p",
          upstreamCommit,
          "-p",
          prCommit,
          "-m",
          `Merge ${nightly.tag} and PR #28845`,
        );
  const tree = writeManifest(mergeTree(previousRaw, raw, forkMain), manifest);
  checkForkPaths(raw, tree);
  const candidate = git(
    "commit-tree",
    tree,
    "-p",
    forkMain,
    "-p",
    raw,
    "-m",
    `chore(release): prepare fork nightly ${releaseTag}`,
  );
  const branch = `fork-nightly/${releaseTag}`;
  git("branch", branch, candidate);
  console.log(`Prepared ${branch} at ${candidate}\n${JSON.stringify(manifest, null, 2)}`);
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
