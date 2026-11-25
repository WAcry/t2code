# 使用 Xcode 27 ARM runner 打包 fork

GitHub 多次在 macOS ARM runner 接手任务前结束候选构建。fork 的 ARM64 打包改用 GitHub 托管的 `xcode-27` ARM runner。

### 同步与退役

恢复原有 ARM runner 后可退役此补丁。参见 [GitHub 托管 runner 列表](https://docs.github.com/en/actions/reference/runners/github-hosted-runners#standard-github-hosted-runners-for-public-repositories)。

### 验证

运行完整候选构建，核对 macOS arm64 安装包和独立服务端的启动检查及发布校验和。
