# t2code 同步与发布

**t2code 是基于 T3 Code 源码的独立、非官方分栏版。** 发布清单记录已发布的上游 nightly、实现工作区分栏和标签页的 PR #28845 提交，以及本仓库的发布标签。发布提交的第一父提交保留 fork 的 `main` 历史，第二父提交记录本次合并的源码。 [发布清单](.github/fork-nightly.json) · [上游发布](https://github.com/pingdotgg/t3code/releases) · [PR #28845](https://github.com/pingdotgg/t3code/pull/28845)

## 同步上游

- 用 `git fetch --no-tags upstream main` 更新上游主分支引用。首次配置可运行 `git remote add upstream https://github.com/pingdotgg/t3code.git`。
- 优先以最新已发布且有安装包的 nightly 为基线，每次重新合并固定的 PR 提交。遇到冲突时，可选用较早的已发布 nightly，并在发布说明里标明版本及原因。
- 更新 PR 固定提交前，核对最新 SHA 和改动。用 `--reuse-pr` 沿用上一次的提交。上游正式发布分栏改版后，可以移除这层合并。

## 准备候选

在以 fork 为 `origin` 的工作区运行，需要 Git 2.45 或更新版本、Node 24 或更新版本，以及 GitHub CLI。

```powershell
gh pr view 28845 --repo pingdotgg/t3code --json headRefOid --jq .headRefOid
$reviewedPr = Read-Host '输入已核对的完整 PR 提交 SHA'
node scripts/prepare-fork-nightly.mjs --pr $reviewedPr
```

脚本创建本地 `fork-nightly/<发布标签>` 分支。用 `--upstream-tag <标签>` 指定已发布的基线，用 `--revision <编号>` 更新同一 nightly 的发布标签。发生冲突时，保留当前发布，先检查和验证合并结果。

## 发布公开安装包

公开安装包显示 t2code 名称，沿用上游 nightly 的内部应用 ID、版本号、配置和数据目录。内置桌面更新已关闭。新版本可从本仓库下载后手动安装。公开构建支持 Windows 和 Linux x64/arm64，以及 Intel macOS。GitHub 预发布同时提供安装包、`SHA256SUMS` 和源码归档。 [Fork 发布页](https://github.com/WAcry/t3code/releases)

将候选分支推送到 fork，由 `Fork nightly` 工作流构建。若工作流处于手动禁用状态，先在 GitHub Actions 中启用。 [构建记录](https://github.com/WAcry/t3code/actions/workflows/fork-nightly.yml)

```powershell
$releaseTag = Read-Host '输入候选的发布标签'
$candidate = "fork-nightly/$releaseTag"
git push origin $candidate
```

验证通过后，将 `main` 快进到候选提交，并从 `main` 手动触发发布。传入成功的构建编号，工作流会复用同一提交的安装包。

```powershell
$buildRunId = Read-Host '输入成功的候选构建编号'
$sha = git rev-parse $candidate
$builtSha = gh run view $buildRunId --repo WAcry/t3code --json headSha --jq .headSha
if ($builtSha -ne $sha) { throw '构建提交与候选提交不一致' }
gh run watch $buildRunId --repo WAcry/t3code --exit-status
if ($LASTEXITCODE -ne 0) { throw '候选构建失败' }
git push origin "${candidate}:main"
if ($LASTEXITCODE -ne 0) { throw 'main 推送失败' }
gh workflow run fork-nightly.yml --repo WAcry/t3code --ref main -f publish=true -f "build_run_id=$buildRunId"
```

## 品牌改动

公开发布工作流通过 `T3CODE_T2CODE_BUILD` 启用独立名称和图标。图标集中在 `assets/t2code/`，桌面打包和 Web 构建各自读取这套资源。同步上游时，保留发布工作流的开关和对应的品牌入口即可。

以前安装的分栏版仍带有官方更新源。换装带此开关的新构建前，可以从设有 `T3CODE_DISABLE_AUTO_UPDATE=true` 的终端启动旧版来关闭该次运行的更新。
