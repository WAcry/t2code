# 使用 macOS 15 ARM runner 打包 fork

GitHub 多次在 `macos-26` ARM runner 接手任务前结束了候选构建。fork 的 ARM64 打包改用 `macos-15`，并选择镜像中的 Xcode 26.3，以便用 macOS 26 SDK 编译系统语音助手。

### 同步与退役

更新 GitHub runner 镜像时核对 Xcode 路径。`macos-26` 可稳定分配时，可以恢复原有 runner 并退役此补丁。参见 [GitHub 的 macOS 15 ARM 镜像](https://github.com/actions/runner-images/blob/main/images/macos/macos-15-arm64-Readme.md#xcode)。

### 验证

运行完整候选构建，核对 macOS arm64 安装包和独立服务端的启动检查及发布校验和。
