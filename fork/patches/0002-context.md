# 切换和引用时保留更多对话原文

切换 harness 时，整条历史或工具结果可能因交接预算而被跳过。引用其他 thread 时，每条正文上限与分页预算也会导致模型只能看到片段。t2code 接受更多缓存未命中和更高输入 token 消耗，以减少信息丢失。

### 同步检查

- 历史准备和实际投递按 4 个 UTF-16 码元估算 1 个 token。默认最多保留 160,000 个估算 token（640,000 个码元，含标注和 JSON 转义）。用 `T3CODE_CONTEXT_HANDOFF_TOKEN_CAP=250000` 可提到 1,000,000 个码元。
- 缺少窗口信息时按 272,000 token 估算。已知的小窗口、压缩阈值、请求、附件和已有用量仍约束投递量。
- `t3_thread_read` 默认读取最近 30 个条目、20 个运行，每条正文最多 8,000 个 UTF-16 码元，整页 UTF-8 JSON 软预算 256 KiB。引用提示用 `beforePosition=earlierPosition` 往前翻页，长正文用同一 `itemId` 和 `textOffset=nextTextOffset` 续读。交接遗漏项的补读也使用这套默认值。

### 冲突与移除条件

沿上游新的入口跟踪历史选择、序列化、原生注入或内联投递，以及服务端读取、分页和正文续读。检查这些路径是否重新套用较小的预算。上游能在同样场景保留同等或更多原文时，可采用它的实现并删除重复修改。

### 验证

完整投递 620,000 个 UTF-16 码元的中文与 emoji 后切回原会话，验证已知小窗口仍受限。引用旧 thread 时，沿游标翻到较早记录并拼回长正文。跨环境委派的取消和中断报告仍顺序翻页。

[交接预算说明](../../docs/user/portable-handoffs.md) · [切换集成测试](../../apps/server/src/orchestration-v2/testkit/ProviderSwitch.integration.test.ts) · [读取测试](../../apps/server/src/mcp/OrchestratorMcpService.activity.test.ts)
