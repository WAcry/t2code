# t2code 同步与发布

**t2code 是基于 T3 Code 的独立、非官方分栏版。** 每次发布固定一个已发布的上游 nightly、一个已审阅的分栏 PR 提交和一组编号补丁。公开 `main` 保留发布历史。发布提交的第一父提交指向之前的 `main`，第二父提交指向这次实际构建的补丁栈。 [发布清单](.github/fork-nightly.json) · [上游发布](https://github.com/pingdotgg/t3code/releases) · [分栏 PR](https://github.com/pingdotgg/t3code/pull/28845)

- [同步上游、构建候选和发布](fork/SYNC.md)
- [新增、修改和退役补丁](fork/PATCHING.md)
- [补丁文档](fork/patches/)

## 桌面安装包

安装包显示 t2code 名称，沿用上游 nightly 的桌面应用 ID、版本号、配置和数据目录。桌面自动更新已关闭，通过本仓库下载新版。桌面包支持 Windows、Linux 和 macOS 的 x64/arm64。发布同时提供独立服务端、`SHA256SUMS` 和源码归档。 [下载 Release](https://github.com/WAcry/t2code/releases)

## 在远端运行服务端

独立服务端文件名以 `t3-` 开头，版本号对应 fork 发布标签去掉开头的 `v`。选择 Linux 或 Windows 的 x64/arm64 包，或 Apple Silicon 的 macOS arm64 包。用同一发布的 `SHA256SUMS` 校验，整目录解压后运行其中的 `t3 serve`（Windows 为 `t3.exe serve`）。包自带运行时和 Web 客户端。[下载页](https://github.com/WAcry/t2code/releases)

升级自管主机时，保留原启动参数、账户和 `T3CODE_HOME`，将启动命令指向新解压目录的可执行文件，再重启原进程。若使用 `t3 service`，可用新版本的可执行文件运行 `service install` 更新已注册的后台服务。更新会中断运行中的任务和远端连接。用新二进制的 `--version` 和后台服务的 `service status` 核对 fork 版本。

桌面自动部署的 SSH 运行时从本仓库下载匹配版本，Windows 上的 WSL 使用同版本的内嵌 Linux 包。接入已自行启动的服务器时，先在对应主机升级运行中的服务，再重新连接。独立 fork 版本的 `t3 update` 会指向本仓库的下载页，升级时手动选择新包。

## 遥测补丁

t2code 强制关闭项目自身的遥测，包括统计、代理反馈、T3 Connect 客户端追踪、OTLP 导出与移动端崩溃和启动上报。本地诊断日志仍可用。模型请求、授权和远端连接按各自的协议运行。独立运行的模型提供商 CLI、官方客户端和官方托管服务有各自的遥测规则。 [保留行为和验证](fork/patches/0004-telemetry.md)

## 对话上下文补丁

维护目标是在切换 harness 和引用其他 thread 时尽量传递原文。t2code 接受更多缓存未命中、更高的输入 token 消耗和更大的工具响应，以减少这些路径的信息丢失。 [交接与读取预算](fork/patches/0002-context.md)
