# 发布自有桌面包和远端运行时

t2code 用自己的名称、图标和 GitHub Release 提供安装包。桌面端沿用上游 nightly 的应用标识、版本和数据目录。桌面与独立服务端的内置更新入口关闭，用户可以保留原配置和对话数据手动更新。

### 同步检查

- Fork CI 使用 GitHub 托管 runner，上游私有 runner 只留给上游。构建任务从已校验的提交出包；发布任务只允许从本仓库 main 复用同一提交通过验证的产物。
- 桌面端和打包脚本只在 fork 构建启用品牌资源。确认 Windows 安装器、macOS DMG、Linux 桌面包和 Web 界面显示 t2code。
- 独立服务端、SSH 自动部署和 Windows 内嵌的 WSL 运行时用完整 fork 标签去掉开头的 v 作为版本。SSH 默认下载匹配的 fork 包，旧缓存和同版本的官方安装不能冒充 fork。保留独立运行的服务由原主机管理员换装的行为。
- 远端更新入口与 CLI 更新命令不得把 fork 运行时换成官方版本。先看实际 SSH 与服务启动路径，再改下载源和版本字段。

### 冲突与移除条件

上游重构发布流程时，保留版本来源、runner 选择和发布授权条件，按新的打包入口重新挂载品牌和禁用更新逻辑。若上游提供可覆盖这些行为的正式 fork 配置，可用配置替换对应修改。Intel macOS 的独立 CLI 以可运行的上游打包支持为前提。

### 验证

在 GitHub Actions 构建 Windows、Linux 和 macOS 桌面包并校验组件。启动每个受支持平台的独立服务端并核对完整 fork 版本。检查 Windows 内嵌的 Linux 归档和 SSH 的下载源，核对发布附件与 SHA256SUMS。

[发布工作流](../../.github/workflows/fork-nightly.yml) · [SSH 脚本](../../apps/desktop/src/ssh/DesktopSshEnvironment.ts) · [安装器打包](../../scripts/build-desktop-artifact.ts)
