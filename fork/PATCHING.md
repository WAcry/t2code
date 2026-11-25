# 维护补丁

补丁栈是以已审阅的 nightly 与分栏 PR 集成提交为起点的一串线性提交。每个编号对应一个目的、一条提交和一份中文文档。编号递增，退役后保留在历史标签中。一个补丁可以携带实现、相关测试和必要的上游兼容性修复。

## 日常修改

1. 在独立 worktree 操作。用 `node fork/tools/t2code.mjs status` 查看当前栈尖，用它创建补丁分支。发布分支的 `main` 记录已验证的版本，补丁编辑以栈尖为起点。
2. 新补丁使用下一个编号，将实现、测试和 `fork/patches/NNNN-<slug>.md` 一起提交。提交标题写成 `fork(NNNN): 中文标题`，尾注为 `T2code-Patch: NNNN`。修改已有补丁时在这条分支上用 `git commit --fixup <补丁提交>` 和 `git rebase -i --autosquash <集成提交>`，把修复归回原补丁。
3. 跑 `node fork/tools/t2code.mjs check --ref HEAD`、`vp run check:changed` 和补丁文档中的行为验证。候选命令读取已提交的树。 [同步与发布流程](SYNC.md)

```powershell
git add -- <源码和测试路径> fork/patches/0005-example.md
git commit -m "fork(0005): 补丁标题" --trailer "T2code-Patch: 0005"
node fork/tools/t2code.mjs check --ref HEAD
```

## 写补丁文档

写清动机、必须保留的行为、解决冲突时的取舍、可以缩小或退役的条件和可复现的验证步骤。同步报告会根据提交本身关联上游改动，也可以在补丁文档中为实现可能迁移到的地方添加一行 `<!-- watch: apps/server/src/example/** -->`。路径写自仓库根目录起算的 Git 路径或通配符。

补丁 `0000` 负责 fork 文档与工具。更新维护机制时修改该提交，并运行 `node --test fork/tools/t2code.test.mjs`。发布清单由候选工具生成。候选构建会检查补丁栈、清单和真正用于构建的树。
