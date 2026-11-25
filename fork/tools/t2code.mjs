#!/usr/bin/env node
// Runs before dependencies are installed, including in the release provenance job.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";

const upstream = "pingdotgg/t3code";
const upstreamUrl = `https://github.com/${upstream}.git`;
const prRef = "refs/pull/28845/head";
const manifestPath = ".github/fork-nightly.json";
const forkMain = "refs/remotes/origin/main";
const nightlyPattern = /^v\d+\.\d+\.\d+-nightly\.\d{8}\.\d+$/;
const shaPattern = /^[a-f0-9]{40}$/;
const positiveInteger = /^[1-9]\d*$/;
const trailerFormat = "%(trailers:key=T2code-Patch,valueonly,separator=%x00)";

function run(command, args, { input, env, cwd, inherit = false } = {}) {
  const result = NodeChildProcess.spawnSync(command, args, {
    encoding: "utf8",
    env: { ...process.env, ...env },
    input,
    cwd,
    maxBuffer: 8 * 1024 * 1024,
    windowsHide: true,
    stdio: inherit ? "inherit" : "pipe",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const details = [result.stderr, result.stdout].filter(Boolean).join("\n").trimEnd();
    throw new Error(
      `${command} ${args[0]} failed (${result.status})${details ? `\n${details}` : ""}`,
    );
  }
  return result.stdout?.trimEnd() ?? "";
}

const git = (...args) => run("git", args);
const resolveCommit = (ref) => git("rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`);
const parentsOf = (sha) => git("show", "-s", "--format=%P", sha).split(" ").filter(Boolean);
const trailerOf = (sha) => git("show", "-s", `--format=${trailerFormat}`, sha);
const isAncestor = (older, newer) => git("merge-base", older, newer) === older;

function changedPaths(left, right, ...args) {
  return git("diff", "--name-only", "--no-renames", "-z", ...args, left, right, "--")
    .split("\0")
    .filter(Boolean);
}

function readStack(head) {
  const patches = [];
  let base = head;
  for (let trailer = trailerOf(base); trailer !== ""; trailer = trailerOf(base)) {
    const [parent, ...otherParents] = parentsOf(base);
    if (!/^\d{4}$/.test(trailer) || parent === undefined || otherParents.length !== 0) {
      throw new Error(`补丁提交 ${base} 必须有一个父提交和一个四位 T2code-Patch trailer。`);
    }
    const paths = changedPaths(parent, base);
    if (paths.includes(manifestPath)) {
      throw new Error(`补丁 ${trailer} 修改了候选发布清单 ${manifestPath}。`);
    }
    const subject = git("show", "-s", "--format=%s", base);
    const docs = paths.filter((entry) =>
      new RegExp(`^fork/patches/${trailer}-[a-z0-9]+(?:-[a-z0-9]+)*\\.md$`).test(entry),
    );
    const [doc] = docs;
    if (trailer === "0000") {
      if (paths.some((entry) => entry !== "FORK.md" && !entry.startsWith("fork/"))) {
        throw new Error("0000 仅维护 FORK.md 与 fork/。");
      }
      if (paths.some((entry) => /^fork\/patches\/\d{4}-/.test(entry))) {
        throw new Error("0000 不添加编号补丁的文档。");
      }
    } else {
      if (docs.length !== 1 || !changedPaths(parent, base, "--diff-filter=A").includes(doc)) {
        throw new Error(`补丁 ${trailer} 必须在同一提交新增一份编号文档。`);
      }
      if (
        paths.some((entry) => (entry === "FORK.md" || entry.startsWith("fork/")) && entry !== doc)
      ) {
        throw new Error(`补丁 ${trailer} 超出其维护文档的范围。`);
      }
    }
    if (!subject.startsWith(`fork(${trailer}): `)) {
      throw new Error(`补丁 ${trailer} 的标题须以 fork(${trailer}): 开头。`);
    }
    const watch = doc
      ? Array.from(
          git("show", `${base}:${doc}`).matchAll(/^<!-- watch: ([^\r\n]+) -->$/gm),
          (match) => match[1].trim(),
        )
      : [];
    patches.unshift({ id: trailer, commit: base, subject, paths, watch });
    base = parent;
  }
  if (
    patches[0]?.id !== "0000" ||
    patches.some((patch, index) => index > 0 && patch.id <= patches[index - 1].id)
  ) {
    throw new Error("补丁栈必须从 0000 开始，编号按提交顺序递增，且不能重复。");
  }
  const [upstreamCommit, prCommit, ...otherParents] = parentsOf(base);
  if (upstreamCommit === undefined || prCommit === undefined || otherParents.length !== 0) {
    throw new Error("集成基线必须有两个直接父提交，依次为 upstream nightly 和 PR #28845。");
  }
  return { head, base, upstreamCommit, prCommit, patches };
}

function readManifest(ref) {
  const manifest = JSON.parse(git("show", `${ref}:${manifestPath}`));
  const prefix = `${manifest.upstreamTag}-pr28845.`;
  if (
    !nightlyPattern.test(manifest.upstreamTag) ||
    !shaPattern.test(manifest.upstreamCommit) ||
    !shaPattern.test(manifest.prCommit) ||
    !manifest.releaseTag?.startsWith(prefix) ||
    !positiveInteger.test(manifest.releaseTag.slice(prefix.length)) ||
    (manifest.integrationCommit !== undefined && !shaPattern.test(manifest.integrationCommit))
  ) {
    throw new Error(`无效的发布清单 ${ref}:${manifestPath}。`);
  }
  return manifest;
}

function readRevision(ref) {
  const sha = resolveCommit(ref);
  if (trailerOf(sha) !== "") return { stack: readStack(sha) };
  const manifest = readManifest(sha);
  const [mainParent, stackHead, ...otherParents] = parentsOf(sha);
  if (!manifest.integrationCommit || !mainParent || !stackHead || otherParents.length !== 0) {
    throw new Error("提交未记录新版补丁栈。首次迁移须显式指定 --stack。");
  }
  const stack = readStack(stackHead);
  if (
    stack.base !== manifest.integrationCommit ||
    stack.upstreamCommit !== manifest.upstreamCommit ||
    stack.prCommit !== manifest.prCommit
  ) {
    throw new Error("发布清单中的集成提交和上游来源与补丁栈不符。");
  }
  const drift = changedPaths(stack.head, sha).filter((entry) => entry !== manifestPath);
  if (drift.length > 0) {
    throw new Error(`发布树包含补丁栈之外的改动：\n${drift.join("\n")}`);
  }
  return { stack, manifest };
}

const publishedRelease = `select(
  .draft == false and .prerelease == true and .published_at != null
  and any(.assets[]; .state == "uploaded" and .size > 0)
) | { tag: .tag_name, target: .target_commitish }`;

function fetchUpstreamRef(ref) {
  const peeled = `${ref}^{}`;
  const advertised = new Map(
    git("ls-remote", "--exit-code", upstreamUrl, ref, peeled)
      .split("\n")
      .map((line) => line.trimEnd().split("\t").reverse()),
  );
  const object = advertised.get(peeled) ?? advertised.get(ref);
  if (!object) throw new Error(`上游缺少 ${ref}。`);
  git("fetch", "--no-tags", "--no-write-fetch-head", upstreamUrl, ref);
  return resolveCommit(object);
}

function resolveNightly(tag) {
  const endpoint = `repos/${upstream}/releases`;
  const gh = (endpoint, jq) => run("gh", ["api", endpoint, "--jq", jq]);
  let release;
  if (tag !== undefined) {
    if (!nightlyPattern.test(tag)) throw new Error(`无效的 nightly 标签 ${tag}。`);
    const result = gh(`${endpoint}/tags/${tag}`, publishedRelease);
    if (result) release = JSON.parse(result);
  } else {
    for (let page = 1; ; page++) {
      const { count, nightlies } = JSON.parse(
        gh(
          `${endpoint}?per_page=30&page=${page}`,
          `{count: length, nightlies: [.[] | ${publishedRelease}]}`,
        ),
      );
      release = nightlies.find((candidate) => nightlyPattern.test(candidate.tag));
      if (release || count < 30) break;
    }
  }
  if (!release) throw new Error("没有找到带发行附件的已发布 nightly。");
  const upstreamCommit = fetchUpstreamRef(`refs/tags/${release.tag}`);
  if (shaPattern.test(release.target) && release.target !== upstreamCommit) {
    throw new Error(`发行版 ${release.tag} 的目标与 Git 标签不符。`);
  }
  return { upstreamTag: release.tag, upstreamCommit };
}

function resolvePr(reviewed, pinned) {
  if (reviewed === undefined) return pinned;
  if (!shaPattern.test(reviewed) || fetchUpstreamRef(prRef) !== reviewed) {
    throw new Error("请使用已审查的 PR #28845 当前完整 SHA。");
  }
  return reviewed;
}

function mergeTree(left, right, base) {
  return git(
    "merge-tree",
    "--write-tree",
    "--name-only",
    ...(base ? [`--merge-base=${base}`] : []),
    left,
    right,
  );
}

function makeIntegration(stack, nightly, prCommit, manual) {
  const { upstreamTag, upstreamCommit } = nightly;
  const message = `Merge ${upstreamTag} and PR #28845`;
  const commit = (tree, pr) =>
    git("commit-tree", tree, "-p", upstreamCommit, "-p", pr, "-m", message);
  if (manual !== undefined) {
    const sha = resolveCommit(manual);
    if (parentsOf(sha).join(" ") !== `${upstreamCommit} ${prCommit}`) {
      throw new Error("手动集成提交的父节点须依次是目标 nightly 和固定的 PR。");
    }
    return sha;
  }
  if (stack.upstreamCommit === upstreamCommit && stack.prCommit === prCommit) return stack.base;
  try {
    if (isAncestor(prCommit, upstreamCommit)) {
      return commit(git("rev-parse", `${upstreamCommit}^{tree}`), prCommit);
    }
    if (
      !isAncestor(stack.upstreamCommit, upstreamCommit) ||
      !isAncestor(stack.prCommit, prCommit)
    ) {
      return commit(mergeTree(upstreamCommit, prCommit), prCommit);
    }
    // Retain reviewed resolutions before applying newer nightly and PR history in order.
    const nightlyBase =
      stack.upstreamCommit === upstreamCommit
        ? stack.base
        : commit(mergeTree(upstreamCommit, stack.base, stack.upstreamCommit), stack.prCommit);
    return stack.prCommit === prCommit
      ? nightlyBase
      : commit(mergeTree(nightlyBase, prCommit, stack.prCommit), prCommit);
  } catch (error) {
    throw new Error(
      `集成 nightly 与分栏 PR 时发生冲突。请审查冲突并通过 --integration 指定合并提交。\n${error.message}`,
      { cause: error },
    );
  }
}

function report(stack, nightly, prCommit) {
  const sources = [
    ["nightly", stack.upstreamCommit, nightly.upstreamCommit],
    ["PR #28845", stack.prCommit, prCommit],
  ];
  console.log(`目标 ${nightly.upstreamTag}`);
  for (const [label, old, next] of sources) {
    console.log(
      `${label} ${old} → ${next}（两侧共 ${git("rev-list", "--count", `${old}...${next}`)} 个提交）`,
    );
  }
  for (const patch of stack.patches) {
    console.log(`\n${patch.subject}`);
    const paths = [...new Set([...patch.paths, ...patch.watch])];
    for (const [label, old, next] of sources) {
      const history = git(
        "log",
        "--left-right",
        "--oneline",
        "--max-count=8",
        `${old}...${next}`,
        "--",
        ...paths,
      );
      console.log(history ? `${label}（最多 8 条）\n${history}` : `${label} 无相关提交`);
    }
  }
}

function sync(stack, nightly, prCommit, options) {
  const integration = makeIntegration(stack, nightly, prCommit, options.integration);
  const name = `${nightly.upstreamTag}-${prCommit.slice(0, 8)}-${Date.now()}`;
  const branch = `fork-sync/${name}`;
  const root = git("rev-parse", "--show-toplevel");
  const destination = NodePath.resolve(
    options.worktree ?? NodePath.join(root, "..", `${NodePath.basename(root)}-${name}`),
  );
  const relative = NodePath.relative(root, destination);
  if (
    relative === "" ||
    (!NodePath.isAbsolute(relative) &&
      relative !== ".." &&
      !relative.startsWith(`..${NodePath.sep}`))
  ) {
    throw new Error("请选择当前工作树之外的工作树路径。");
  }
  git("worktree", "add", "-b", branch, destination, stack.head);
  console.log(`补丁工作树 ${destination}（${branch}）`);
  if (stack.base !== integration) {
    console.log(`重放后审查 git range-diff ${stack.base}..${stack.head} ${integration}..${branch}`);
    try {
      run(
        "git",
        [
          "-c",
          "rerere.enabled=true",
          "-c",
          "rerere.autoupdate=false",
          "rebase",
          "--no-update-refs",
          "--reapply-cherry-picks",
          "--empty=stop",
          "--onto",
          integration,
          stack.base,
        ],
        {
          cwd: destination,
          inherit: true,
        },
      );
    } catch (error) {
      throw new Error(
        `重放未完成。请在 ${destination} 审查和解决冲突，再运行 git rebase --continue。\n${error.message}`,
        { cause: error },
      );
    }
  }
  const rebased = readStack(resolveCommit(branch));
  console.log(`补丁栈 ${rebased.head} 已通过结构校验。`);
}

function writeManifest(tree, manifest) {
  const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t2code-candidate-"));
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

function candidate(options) {
  git("fetch", "--no-tags", "--no-write-fetch-head", "origin", `refs/heads/main:${forkMain}`);
  const main = resolveCommit(forkMain);
  const previous = readManifest(main);
  const { stack } = readRevision(options.stack ?? main);
  if (previous.integrationCommit !== undefined) readRevision(main);
  const nightly = resolveNightly(
    options["upstream-tag"] ??
      (stack.upstreamCommit === previous.upstreamCommit ? previous.upstreamTag : undefined),
  );
  if (nightly.upstreamCommit !== stack.upstreamCommit) {
    throw new Error("目标 nightly 与补丁栈的集成基线不符。换用正确的 --upstream-tag 或先同步。");
  }
  if (
    stack.prCommit !== previous.prCommit &&
    !isAncestor(stack.prCommit, fetchUpstreamRef(prRef))
  ) {
    throw new Error("补丁栈的 PR 提交不在 PR #28845 当前的历史中。");
  }
  const prefix = `${nightly.upstreamTag}-pr28845.`;
  const last =
    previous.upstreamTag === nightly.upstreamTag
      ? Number(previous.releaseTag.slice(prefix.length))
      : 0;
  const revision = options.revision === undefined ? last + 1 : Number(options.revision);
  if (!Number.isSafeInteger(revision) || revision <= last) {
    throw new Error(`发布修订号须为大于 ${last} 的整数。`);
  }
  if (parentsOf(main)[1] === stack.head && options.revision === undefined) {
    throw new Error("补丁栈与上次相同。如果要重新发布，请显式指定 --revision。");
  }
  const releaseTag = `${prefix}${revision}`;
  const manifest = {
    ...nightly,
    prCommit: stack.prCommit,
    integrationCommit: stack.base,
    releaseTag,
  };
  const tree = writeManifest(stack.head, manifest);
  const promotion = git(
    "commit-tree",
    tree,
    "-p",
    main,
    "-p",
    stack.head,
    "-m",
    `chore(release): prepare fork nightly ${releaseTag}`,
  );
  readRevision(promotion);
  const branch = `fork-nightly/${releaseTag}`;
  git("branch", branch, promotion);
  console.log(`候选分支 ${branch}\n提交 ${promotion}`);
}

function main([command, ...args]) {
  const readOptions = { ref: { type: "string" } };
  const sourceOptions = { stack: { type: "string" }, "upstream-tag": { type: "string" } };
  const commandOptions = {
    status: readOptions,
    check: readOptions,
    report: { ...sourceOptions, pr: { type: "string" } },
    sync: {
      ...sourceOptions,
      pr: { type: "string" },
      worktree: { type: "string" },
      integration: { type: "string" },
    },
    candidate: { ...sourceOptions, revision: { type: "string" } },
  };
  if (command === undefined || command === "--help" || args.includes("--help")) {
    console.log(`node fork/tools/t2code.mjs status|check [--ref REF]
node fork/tools/t2code.mjs report [--stack REF] [--upstream-tag TAG] [--pr SHA]
node fork/tools/t2code.mjs sync [--stack REF] [--upstream-tag TAG] [--pr SHA] [--worktree PATH] [--integration REF]
node fork/tools/t2code.mjs candidate [--stack REF] [--upstream-tag TAG] [--revision N]`);
    return;
  }
  if (!Object.hasOwn(commandOptions, command)) throw new Error(`未知命令 ${command}。`);
  const { values } = NodeUtil.parseArgs({ args, options: commandOptions[command] });
  if (values.revision !== undefined && !positiveInteger.test(values.revision)) {
    throw new Error("--revision 须为正整数。");
  }
  const worktree = values.worktree === undefined ? undefined : NodePath.resolve(values.worktree);
  if (git("rev-parse", "--is-bare-repository") === "false") {
    process.chdir(git("rev-parse", "--show-toplevel"));
  }
  if (command === "candidate") return candidate(values);
  const { stack, manifest } = readRevision(
    values.ref ?? values.stack ?? (command === "status" || command === "check" ? "HEAD" : forkMain),
  );
  if (command === "status") {
    if (manifest) console.log(`发布 ${manifest.releaseTag}`);
    console.log(
      `补丁栈 ${stack.head}\n集成基线 ${stack.base}\nNightly ${stack.upstreamCommit}\nPR #28845 ${stack.prCommit}`,
    );
    for (const patch of stack.patches) console.log(`${patch.commit.slice(0, 12)} ${patch.subject}`);
  } else if (command === "check") {
    console.log(`结构校验通过，${stack.patches.length} 个补丁。`);
  } else {
    const nightly = resolveNightly(values["upstream-tag"]);
    const prCommit = resolvePr(values.pr, stack.prCommit);
    if (command === "report") report(stack, nightly, prCommit);
    if (command === "sync") sync(stack, nightly, prCommit, { ...values, worktree });
  }
}

try {
  main(process.argv.slice(2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
