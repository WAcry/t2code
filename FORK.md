# Fork 同步与发布

`WAcry/t3code` 是基于 T3 Code 源码的非官方分栏版，与 T3 Tools, Inc. 无隶属关系。[发布清单](.github/fork-nightly.json)记录已发布的上游 nightly、包含六层改版的 PR #28845 提交，以及本仓库的发布标签。发布提交的第一父提交保留 fork 的 `main` 历史，第二父提交记录本次合并的源码。 [上游发布](https://github.com/pingdotgg/t3code/releases) · [PR #28845](https://github.com/pingdotgg/t3code/pull/28845)

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

## 发布源码

验证候选后，将 fork 的 `main` 快进到同一个提交。在 GitHub 创建预发布，写明上游 nightly、PR 提交和候选 SHA。GitHub 会自动生成源码 ZIP 和 tar.gz。 [Fork 发布页](https://github.com/WAcry/t3code/releases)

```powershell
$releaseTag = Read-Host '输入候选的发布标签'
$candidate = "fork-nightly/$releaseTag"
$pins = git show "${candidate}:.github/fork-nightly.json" | ConvertFrom-Json
$sha = git rev-parse $candidate
if (git ls-remote origin "refs/tags/$releaseTag") { throw '发布标签已存在' }
git push origin "${candidate}:main"
if ($LASTEXITCODE -ne 0) { throw 'main 推送失败' }
gh release create $releaseTag --repo WAcry/t3code --target $sha --prerelease `
  --title "WAcry 分栏版 $releaseTag（源码）" `
  --notes "上游 nightly $($pins.upstreamTag)，PR 提交 $($pins.prCommit)，发布提交 $sha。"
```

## 本地自用构建与更新

自用安装包沿用上游版本、名称、图标和配置目录。打包时设定 `T3CODE_DESKTOP_DISABLE_AUTO_UPDATE=true`，应用会跳过内置更新。更新时获取新发布的源码，再运行本地打包。以下是 Windows x64 的命令，先准备[打包工具](docs/operations/00_development.md#windows-installer-prerequisites)，再从发布标签的检出目录运行 `vp install`。

```powershell
$version = (Get-Content -Raw .github/fork-nightly.json | ConvertFrom-Json).upstreamTag.TrimStart('v')
$env:T3CODE_DESKTOP_DISABLE_AUTO_UPDATE = 'true'
node scripts/build-desktop-artifact.ts --platform win --target nsis --arch x64 --build-version $version
```

以前安装的分栏版仍带有官方更新源。换装带此开关的新构建前，可以从设有 `T3CODE_DISABLE_AUTO_UPDATE=true` 的终端启动旧版来关闭该次运行的更新。
