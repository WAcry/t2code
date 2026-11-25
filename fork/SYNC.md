# 同步上游和发布

同步和检查需要 Git 2.45 或更新版本、Node 24 或更新版本以及 GitHub CLI。构建由本仓库的 GitHub Actions 执行。

## 先看变更

在 fork 的工作区运行。可用 `git fetch --no-tags upstream main` 更新上游主分支引用。候选基线以已发布且有资产的 nightly 为准。同步工具默认沿用上次审阅的 PR 提交。

```powershell
git fetch --no-tags origin main
node fork/tools/t2code.mjs status --ref origin/main
gh pr view 28845 --repo pingdotgg/t3code --json headRefOid,baseRefName,url
node fork/tools/t2code.mjs report
```

报告分开列出 nightly 和 PR 两侧的变化，并标出各补丁相关的代码。要采用新的 PR 提交，先检查相对于旧固定提交的改动，再给 `report` 和 `sync` 传入 `--pr <已审阅的完整 SHA>`。可用 `--upstream-tag <已发布的 nightly 标签>` 检查更早、仍兼容的基线。

## 同步和处理冲突

```powershell
node fork/tools/t2code.mjs sync
```

工具先生成上游集成提交，再在同级的独立 worktree 重放补丁。nightly 保持不变且 PR 向前追加时，沿用上一轮的合并决议，在它上面合入 PR 的增量。更换 nightly 时，先验证新的源码组合，冲突报告会列出受影响路径。

- 若 nightly 和 PR 的合并存在冲突，可用独立的集成 worktree 以目标 nightly 开分支，再执行 `git merge --no-ff <已审阅的 PR 提交>`。确认解决方案后，把合并提交作为 `--integration <ref>` 传给同一条同步命令。它的两个父提交依次是目标 nightly 和已审阅的 PR。
- 若补丁重放发生冲突，工具会保留独立 worktree。按当前补丁文档解决后，`git add` 并运行 `git -c rerere.enabled=true -c rerere.autoupdate=false rebase --continue`，记录本次冲突的解法。上游实现已完全满足补丁的验收行为时，可用 `git rebase --skip` 退役该补丁。放弃本轮用 `git rebase --abort`。
- 用 `git range-diff <旧集成提交>..<旧栈尖> <新集成提交>..<新栈尖>` 查看每个补丁落到新基线后的变化，并按文档验证行为。分栏功能进入已发布 nightly 后，先确认功能和 PR 祖先关系，再调整分栏 pin 和发布标签规则。

## 生成候选和发布

同一 nightly 新发一次时，`--revision` 使用比上次大的编号。换 nightly 时从第 1 次开始。栈上的补丁工作分支也可直接用作候选输入。

```powershell
$stack = Read-Host '输入已验证的补丁栈分支'
$nightly = Read-Host '输入对应的已发布 nightly 标签'
node fork/tools/t2code.mjs candidate --stack $stack --upstream-tag $nightly
$releaseTag = Read-Host '输入候选命令打印的发布标签'
$candidate = "fork-nightly/$releaseTag"
git push origin $candidate
```

等候选的 `Fork nightly` 构建成功。把候选快进到 `main` 后，手动触发发布工作流，复用同一提交的产物。 [候选和发布任务](https://github.com/WAcry/t2code/actions/workflows/fork-nightly.yml)

```powershell
$buildRunId = Read-Host '输入成功的候选构建编号'
$sha = git rev-parse $candidate
$builtSha = gh run view $buildRunId --repo WAcry/t2code --json headSha --jq .headSha
if ($builtSha -ne $sha) { throw '构建提交与候选提交不一致' }
gh run watch $buildRunId --repo WAcry/t2code --exit-status
if ($LASTEXITCODE -ne 0) { throw '候选构建失败' }
git push origin "${candidate}:main"
if ($LASTEXITCODE -ne 0) { throw 'main 推送失败' }
gh workflow run fork-nightly.yml --repo WAcry/t2code --ref main -f publish=true -f "build_run_id=$buildRunId"
```

基线无法通过合并或回归检查时，保留上次通过验证的发布。更换 nightly 的决议和已有补丁的同步依据都保留在新发布的 Git 祖先和补丁文档中。

## GitHub Actions 故障排查

普通 CI 在 fork 上使用 GitHub 托管的 Ubuntu 和 macOS runner。上游增加 CI job 时检查新 job 的 runner 标签。可在 `Changes` job 的 “Set up job” 步骤核对实际分配结果。 [普通 CI](https://github.com/WAcry/t2code/actions/workflows/ci.yml)

如果推送后没有运行记录，手动触发返回 HTTP 422 `Actions has been disabled for this repository`，仓库管理员应查看 Actions 首页。即使 API 显示 `enabled: true`，首页也可能有 `Workflows on this fork have been disabled` 提示。点击 `I understand my workflows, go ahead and re-enable them` 后重新触发。 [Actions 首页](https://github.com/WAcry/t2code/actions)
