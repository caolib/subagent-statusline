# 子代理状态行 Mod

需要 Claude Code 2.1.326 或更新版本；开发接口按 2.1.327 验证。

## 安装

在 Claude Code 终端会话中执行：

```text
/plugin install subagent-statusline --marketplace caolib/subagent-statusline
```

从 shell：

```sh
claude plugin install subagent-statusline --marketplace caolib/subagent-statusline
```

桌面应用：点击输入框旁的 `+` → Plugins → Add marketplace，输入 `caolib/subagent-statusline`，再 Add plugin。

安装后在该会话立即生效，无需重启；user scope 下之后的新会话自动加载。

参考原 `subagent-statusline.js`，保留配色、双空格分隔及顺序：

```text
Explore  claude-sonnet-5-5(medium)  2m 5s  ↓ 85.5k  检查渲染逻辑  读取状态栏脚本
```

- 使用原生 `AgentRow`，保留打开/停止操作、行指针、嵌套连接线和显隐。
- token 使用引擎的 `tokenCount` 与 `tokenSamples`；增长为 ↓，静止/下降为 ↑。
- 不运行 shell/Node 子进程，不读取配置、凭据、环境变量或会话文件。
- 使用 `$.clock.now()`；数据通常约每 5 秒更新，状态变化也会触发更新。
- effort 缺失时仅使用 `lastRequest.effort`；引擎未提供时不猜测。
- `killed` 显示 stopped；其他状态保留原脚本的 done/failed/pending 表示。
- 不修改主状态栏 `statusline.js`，也不修改或删除旧 `subagentStatusLine` 配置。
- 旧命令仍配置时可能继续执行，本 Mod 覆盖它传入的 body；确认效果后再移除旧配置。
- 行末以正常前景色显示子代理当前工具动作，如 `Read hooks/register.ts`：由 `tool.call` 的 `agentId` 记录到 `$.state`，仅运行中显示。
- 不显示上下文占用百分比。
- 按引擎给出的 `columns` 收窄各字段，总宽不超出；窄行（<100 列）只保留进度摘要，不显示任务描述。
- 不显示费用或缓存指标。

当前会话允许 Mods 后会在回合结束加载。其他会话可通过以下方式加载：

```sh
claude --plugin-dir "<本 Mod 文件夹>"
```

检查与测试：

```sh
claude plugin validate "<本 Mod 文件夹>"
claude plugin test "<本 Mod 文件夹>"
```

API 仍为 early access；升级后若接口变化，需要重新验证。
