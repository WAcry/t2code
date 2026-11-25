import * as NodeAssert from "node:assert/strict";
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeTest from "node:test";
import * as NodeURL from "node:url";

const cli = NodeURL.fileURLToPath(new URL("./t2code.mjs", import.meta.url));
const upstreamTag = "v0.1.12-nightly.20261123.5165";
const manifestPath = ".github/fork-nightly.json";

function fixture(t, { reverseParents = false } = {}) {
  const cwd = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t2code-stack-test-"));
  t.after(() => NodeFS.rmSync(cwd, { recursive: true, force: true }));

  function run(command, args) {
    const result = NodeChildProcess.spawnSync(command, args, {
      cwd,
      encoding: "utf8",
      windowsHide: true,
    });
    if (result.error) throw result.error;
    return result;
  }

  function git(...args) {
    const result = run("git", args);
    NodeAssert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  }

  function write(path, contents) {
    NodeFS.mkdirSync(NodePath.dirname(NodePath.join(cwd, path)), { recursive: true });
    NodeFS.writeFileSync(NodePath.join(cwd, path), contents);
    git("add", "--", path);
  }

  function commitTree(title, parents, trailer) {
    return git(
      "commit-tree",
      git("write-tree"),
      ...parents.flatMap((parent) => ["-p", parent]),
      "-m",
      title,
      ...(trailer ? ["-m", trailer] : []),
    );
  }

  git("init", "-q");
  git("config", "user.name", "Fork Test");
  git("config", "user.email", "fork-test@example.invalid");
  write("upstream.txt", "shared source\n");
  const common = commitTree("Common base", []);
  write("upstream.txt", "nightly source\n");
  const upstreamCommit = commitTree("Nightly", [common]);
  write("panes.txt", "workspace panes\n");
  const prCommit = commitTree("Workspace panes PR", [common]);
  const integrationCommit = commitTree(
    "Integrate nightly and PR",
    reverseParents ? [prCommit, upstreamCommit] : [upstreamCommit, prCommit],
  );

  function patch(parent, id, slug, withDoc = true) {
    git("read-tree", parent);
    if (withDoc) write(`fork/patches/${id}-${slug}.md`, `# ${slug}\n\nRequired behavior.\n`);
    write(id === "0000" ? "fork/tools/example.mjs" : `${slug}.txt`, "fork change\n");
    return commitTree(`fork(${id}): ${slug}`, [parent], `T2code-Patch: ${id}`);
  }

  const maintenance = patch(integrationCommit, "0000", "maintenance", false);
  const stack = patch(maintenance, "0001", "first");
  function promote(tip, extra = false) {
    git("read-tree", tip);
    write(
      manifestPath,
      `${JSON.stringify({
        upstreamTag,
        upstreamCommit,
        prCommit,
        integrationCommit,
        releaseTag: `${upstreamTag}-pr28845.1`,
      })}\n`,
    );
    if (extra) write("unreviewed.txt", "outside the patch stack\n");
    return commitTree("Publish fork nightly", [integrationCommit, tip]);
  }

  const check = (ref) => run(process.execPath, [cli, "check", "--ref", ref]);
  return { check, patch, promote, stack };
}

NodeTest.test("checks an exact promotion and its linear patch stack without a checkout", (t) => {
  const { check, promote, stack } = fixture(t);
  for (const ref of [stack, promote(stack)]) {
    const result = check(ref);
    NodeAssert.equal(result.status, 0, result.stderr);
  }
});

NodeTest.test("rejects an integration with the PR and nightly parents reversed", (t) => {
  const { check, promote, stack } = fixture(t, { reverseParents: true });
  const result = check(promote(stack));
  NodeAssert.equal(result.status, 1);
  NodeAssert.match(result.stderr, /集成提交和上游来源/);
});

NodeTest.test("rejects a promotion that adds source outside the selected patch stack", (t) => {
  const { check, promote, stack } = fixture(t);
  const result = check(promote(stack, true));
  NodeAssert.equal(result.status, 1);
  NodeAssert.match(result.stderr, /补丁栈之外[\s\S]*unreviewed\.txt/);
});

NodeTest.test("rejects duplicate IDs and patches without their own document", (t) => {
  const { check, patch, stack } = fixture(t);
  for (const ref of [
    patch(stack, "0001", "duplicate"),
    patch(stack, "0002", "no-document", false),
  ]) {
    const result = check(ref);
    NodeAssert.equal(result.status, 1);
    NodeAssert.match(result.stderr, /编号按提交顺序递增|同一提交新增一份编号文档/);
  }
});
