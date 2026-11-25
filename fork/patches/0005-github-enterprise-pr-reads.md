# 修复 GitHub Enterprise 的 PR 读取

部分 GitHub Enterprise Server 尚未提供 `PullRequest.stack` 和 `PullRequest.stackEntry`。GraphQL 在执行 `@include` 前就会验证字段，因此传 `false` 仍会让 PR 搜索、列表和摘要读取失败。

### 同步检查

搜索和摘要保留能读取堆叠信息的查询。主机明确报告缺少字段时，回退到基础查询，短期缓存该结果，并在过期后重新尝试。单仓库列表仍批量补齐可见行的堆叠信息，同样遵循主机的字段支持情况。上游在这些入口都采用等效回退后，可退役补丁。

### 验证

运行 `vp test run packages/source-control-github/src/server/GitHubPullRequestApi.test.ts`。用 Enterprise 仓库核对 PR 列表和摘要，测试覆盖缓存过期后重新读取堆叠信息。
