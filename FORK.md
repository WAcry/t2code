# t2code 同步与发布

**t2code 是基于 T3 Code 源码的独立、非官方分栏版。** 发布清单记录已发布的上游 nightly、实现工作区分栏和标签页的 PR #28845 提交，以及本仓库的发布标签。发布提交的第一父提交保留 fork 的 `main` 历史，第二父提交记录本次合并的源码。 [发布清单](.github/fork-nightly.json) · [上游发布](https://github.com/pingdotgg/t3code/releases) · [PR #28845](https://github.com/pingdotgg/t3code/pull/28845)

## 同步上游

- 用 `git fetch --no-tags upstream main` 更新上游主分支引用。首次配置可运行 `git remote add upstream https://github.com/pingdotgg/t3code.git`。
- 优先以最新已发布且有安装包的 nightly 为基线，每次重新合并固定的 PR 提交。遇到冲突时，可选用较早的已发布 nightly，并在发布说明里标明版本及原因。
- 更新 PR 固定提交前，核对最新 SHA 和改动。用 `--reuse-pr` 沿用上一次的提交。上游正式发布分栏改版后，可以移除这层合并。
- 分栏 PR 和对话上下文补丁独立维护。即使分栏已进入上游，每次同步 nightly 仍要核对[对话上下文补丁](#对话上下文补丁)的行为。

普通 CI 在 fork 上使用 GitHub 托管的 Ubuntu 和 macOS runner。同步上游时，新加的 CI job 也应能在 fork 的 runner 上运行。可在 `Changes` job 的 “Set up job” 步骤核对实际分配的 runner。[CI 运行记录](https://github.com/WAcry/t2code/actions/workflows/ci.yml)

如果推送后没有生成运行记录，手动触发也返回 HTTP 422 `Actions has been disabled for this repository`，请打开仓库的 Actions 首页。即使设置 API 显示 `enabled: true`、单个工作流显示 `active`，首页也可能提示 `Workflows on this fork have been disabled`。仓库管理员可点击 `I understand my workflows, go ahead and re-enable them` 恢复，再重新触发所需工作流。[Actions 首页](https://github.com/WAcry/t2code/actions)

## 准备候选

在以 fork 为 `origin` 的工作区运行，需要 Git 2.45 或更新版本、Node 24 或更新版本，以及 GitHub CLI。

```powershell
gh pr view 28845 --repo pingdotgg/t3code --json headRefOid --jq .headRefOid
$reviewedPr = Read-Host '输入已核对的完整 PR 提交 SHA'
node scripts/prepare-fork-nightly.mjs --pr $reviewedPr
```

脚本创建本地 `fork-nightly/<发布标签>` 分支。用 `--upstream-tag <标签>` 指定已发布的基线，用 `--revision <编号>` 更新同一 nightly 的发布标签。发生冲突时，保留当前发布，先检查和验证合并结果。

## 发布公开安装包

公开安装包显示 t2code 名称，沿用上游 nightly 的内部应用 ID、版本号、配置和数据目录。内置桌面更新已关闭。新版本可从本仓库下载后手动安装。公开构建支持 Windows 和 Linux x64/arm64，以及 Intel macOS。GitHub 预发布同时提供安装包、`SHA256SUMS` 和源码归档。 [Fork 发布页](https://github.com/WAcry/t2code/releases)

将候选分支推送到 fork，由 `Fork nightly` 工作流构建。若工作流处于手动禁用状态，先在 GitHub Actions 中启用。 [构建记录](https://github.com/WAcry/t2code/actions/workflows/fork-nightly.yml)

```powershell
$releaseTag = Read-Host '输入候选的发布标签'
$candidate = "fork-nightly/$releaseTag"
git push origin $candidate
```

验证通过后，将 `main` 快进到候选提交，并从 `main` 手动触发发布。传入成功的构建编号，工作流会复用同一提交的安装包。

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

## 品牌改动

公开发布工作流通过 `T3CODE_T2CODE_BUILD` 启用独立名称和图标。图标集中在 `assets/t2code/`，桌面打包和 Web 构建各自读取这套资源。同步上游时，保留发布工作流的开关和对应的品牌入口即可。

以前安装的分栏版仍带有官方更新源。换装带此开关的新构建前，可以从设有 `T3CODE_DISABLE_AUTO_UPDATE=true` 的终端启动旧版来关闭该次运行的更新。

## 对话上下文补丁

**维护目标是让接手的模型尽量拿到原文。** 切换 harness 时，之前的决定和工具结果可能因交接预算而被整条跳过。引用另一个 thread 时，过短的每条正文和过小的分页预算会让模型只看到片段。为减少这两处的信息丢失，t2code 接受更多缓存未命中、更高的输入 token 消耗和更大的工具响应。

| 场景                  | 同步后应保留的行为                                                                                                                                                                                                                                                                                                    |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 切换 harness          | 准备历史和实际投递都按 4 个 UTF-16 码元估算 1 个 token。默认携带最多 160,000 个估算 token（640,000 个码元，含标注和 JSON 转义）。`T3CODE_CONTEXT_HANDOFF_TOKEN_CAP=250000` 可将上限提到 1,000,000 个码元。仅在缺少窗口信息时按 272,000 token 估算；已知的小窗口、压缩阈值、当前请求、附件和已有用量仍约束实际投递量。 |
| 引用或读取其他 thread | `t3_thread_read` 默认读取最近 30 个条目、20 个运行，每条正文最多 8,000 个 UTF-16 码元，整页 UTF-8 JSON 软预算为 256 KiB。引用提示从最近一页用 `beforePosition=earlierPosition` 向前翻页；长正文用同一 `itemId` 和 `textOffset=nextTextOffset` 续读。交接遗漏项的补读也使用这套默认值。                                |

### 同步时怎么判断

1. 准备脚本从远端 `origin/main` 取 fork 改动，以前一次合入的 nightly 和 PR 为共同基线，将改动三方合并到新的 nightly 和 PR。新增补丁应先随测试提交并推到 fork 的 `main`。脚本的 `forkPaths` 用于发现意外的文件差异，候选仍需验证实际行为。[候选准备脚本](scripts/prepare-fork-nightly.mjs)
2. 上游修改 provider、令牌估算或 MCP 分页时，沿新调用链检查历史准备、原生注入或内联投递，以及引用提示、服务端分页和正文续读。特别留意后续步骤重新套用较小的字节上限或显式传入过小的读取参数。若上游已经能传递同等或更多原文，可采用其实现并删除重复补丁；若入口迁移，同步移动回归测试并更新 `forkPaths`。[交接预算说明](docs/user/portable-handoffs.md)
3. 候选构建运行交接与读取测试。验收样例包括完整投递 620,000 个 UTF-16 码元的中文与 emoji 后切回原会话、尊重已知小窗口，以及按游标翻到较早记录并拼回长正文。处理合并冲突时，用这些行为判断应保留哪段实现。[切换集成测试](apps/server/src/orchestration-v2/testkit/ProviderSwitch.integration.test.ts) · [读取分页测试](apps/server/src/mcp/OrchestratorMcpService.activity.test.ts)
