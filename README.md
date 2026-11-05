# 东京学科考试空位监控：免费方案

此版本使用 **Cloudflare Workers Free 的定时器**，每五分钟调用一次 GitHub 的运行接口；浏览器扫描由**公开仓库的标准 GitHub Linux 运行器**执行。Mac 可以合盖或关机。

**当前状态：准备中，尚未部署这条免费触发链。** 扫描逻辑已在 GitHub Linux 运行器完成官网实测；定时器代码通过本地测试。Cloudflare 到 GitHub 的连续运行必须在部署后确认。

## 检查内容

- 江東、鮫洲、府中三个考场。
- 教習所卒業等、免許証のみ；日本时间当天起，官网允许查看的所有月份。
- 点击可选日期后检查受付时间，只有剩余人数大于 0 且时间确实可选才通知。
- 全部时段 0 人则继续监控；加载失败或不能确认时标记失败，留待下一轮检查。
- 只读取公开空位，不选择时段、不填写个人资料、不提交预约。
- 通知使用 ntfy；同一空位会尝试去重。

## 免费条件

1. 新仓库必须是 **Public**。公开的是本仓库的程序和运行日志。
2. 使用标准 `ubuntu-24.04` 运行器，不启用 Larger runners，不上传运行产物。状态缓存文件很小。
3. Cloudflare 选择 **Workers Free**，只配置一个定时器 `*/5 * * * *`。
4. 密钥通过 GitHub Secrets 和 Cloudflare Secrets 输入，不能写入文件或提交到仓库。

Cloudflare 免费计划有调用和 CPU 限制；免费平台都可能延迟或中断，不能保证准点或永不中断。程序会显示计划时间，便于核实延迟。GitHub 接受启动请求后，新版接口会返回任务 ID；这只表示启动已被接受，仍需查看扫描任务最终是否完成。旧版 HTTP 204 回执也可识别。

为避免误用私有仓库的付费分钟，Cloudflare 每次先确认目标仓库为 Public；工作流也有公开仓库条件。将目标仓库改为 Private 会停止这条自动链。

## 部署顺序

### 1. 新建公开 GitHub 仓库

新建空的 Public 仓库，例如 `tokyo-license-watch-free`。将本目录内文件放到其根目录，默认分支为 `main`。

保留旧私有仓库。新仓库只使用审核过的当前文件，不复制旧提交历史。

在新仓库 **Settings → Secrets and variables → Actions → Secrets → New repository secret** 添加：

- Name：`NTFY_TOPIC`
- Secret：手机 ntfy 当前订阅的主题。只在 GitHub 的 Secret 输入框填写，不要发到聊天。

先运行 **Actions → Tokyo license watch → Run workflow**，模式选择 `scan`；成功后再部署定时器。要单独测试手机通知，选择 `test-notification`。

### 2. 创建仅能触发此仓库的 GitHub token

在 GitHub **Settings → Developer settings → Personal access tokens → Fine-grained tokens** 新建 token：

- Repository access：Only select repositories，仅选择新建的公开仓库。
- Repository permissions：Actions 为 Read and write；Metadata 的 Read-only 默认保留。
- 设置适当有效期，例如 30 天；到期前需更新 Cloudflare Secret。

token 仅在下一步的 Cloudflare Secret 输入框填写，不放进代码、截图或聊天。

### 3. 配置 Cloudflare 免费定时器

在 Cloudflare **Workers & Pages** 创建一个 Worker，使用 Free 计划。代码为 `cloudflare/worker.mjs`。

添加变量：

| 名称 | 类型 | 值 |
| --- | --- | --- |
| `GITHUB_REPOSITORY` | 普通变量 | 新公开仓库的 `用户名/仓库名` |
| `ENABLE_MONITOR` | 普通变量 | `true` |
| `GITHUB_TOKEN` | Secret | 上一步生成的 fine-grained token |

在 **Settings → Triggers → Cron Triggers** 添加 `*/5 * * * *`，时区为 UTC。它也涵盖日本时间 0:00。

使用 Wrangler 时，先修改 `cloudflare/wrangler.toml` 中的仓库名；token 仍通过 Secret 配置。HTTP 入口不提供触发功能，可保持 workers.dev 和预览 URL 关闭。

修改工作流后会自动执行一次 `deployment-check / verify`，它测试定时器代码并真实检查官网，但不发送通知。该记录不能证明免费定时链已经启用。

## 判断是否正在运行

1. Cloudflare 日志出现 `DISPATCH_ACCEPTED`，表示 GitHub 接受了启动请求。
2. GitHub **Actions → Tokyo license watch** 出现新的 `cloud-timer / scan / 时间` 记录，事件类型会是 `workflow_dispatch`。
3. 打开 **monitor → Check availability or send test**，核实扫描成功或失败。

这是外部定时器调用，因此不依靠 GitHub 的 `schedule` 事件；应检查标题中的来源和计划时间。

- `All venues and accessible months checked; no available reception time.`：本轮完整扫描，无可选时段。
- `Confirmed available reception time:`：确认有可选时段。
- 任务失败或长时间没有新记录时，监控不算正常运行。
- 没有空位时不会发送手机通知。当前故障信息记录在平台日志中。

## 暂停与恢复

- Cloudflare 的 `ENABLE_MONITOR=false`：暂停普通五分钟检查，日本时间 0:00 仍检查一次。
- 删除或禁用 Cloudflare Cron Trigger：停止全部自动检查，包括 0:00。
- 恢复 Cron Trigger，并设 `ENABLE_MONITOR=true`：恢复普通检查。
- 更换 token 后需在 Cloudflare 更新 Secret；请留意 token 到期时间。

## 本地检查

`node --test cloudflare/test/worker.test.mjs`

测试覆盖：普通定时、日本时区午夜、停用开关、私有仓库阻止、固定扫描模式、新旧接口回执、错误与密钥保护。它不能代替部署后的连续执行验证。

官方说明：
- https://docs.github.com/en/billing/concepts/product-billing/github-actions
- https://developers.cloudflare.com/workers/platform/pricing/
- https://developers.cloudflare.com/workers/platform/limits/
- https://developers.cloudflare.com/workers/configuration/cron-triggers/
