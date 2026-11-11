# 东京学科考试空位监控：免费方案

此版本使用 **Cloudflare Workers Free 的定时器**，每五分钟调用 GitHub 的运行接口；浏览器扫描由**公开仓库的标准 GitHub Linux 运行器**执行。Mac 可以合盖或关机。

**当前状态（2026-11-06）：已确认连续两轮由 Cloudflare 自动触发、以 `MODE=scan` 完成正式扫描。手机通知此前已测试并由使用者确认收到。**

以下时间均为日本时间；计划触发与实际扫描完成分开记录，平台排队可能造成延迟。

| 计划触发 | 扫描完成 | 结果 |
| --- | --- | --- |
| 2026-11-06 09:30 | 09:35:32 | [正式扫描成功](https://github.com/mimi0209/tokyo-license-watch-free/actions/runs/42137274942) |
| 2026-11-06 09:35 | 09:37:04 | [正式扫描成功](https://github.com/mimi0209/tokyo-license-watch-free/actions/runs/42137898897) |

两轮均检查了江東、鮫洲、府中，以及官网当时可查看的 2026 年 11 月至 2027 年 2 月：没有未确认日期，没有可选时段。以后月份范围随官网可查看范围变化，不固定为这四个月。

[运行时回归验证](https://github.com/mimi0209/tokyo-license-watch-free/actions/runs/42131799870)：15 项单元测试和 3 项真实 `workerd` 引擎测试通过，旧版请求失败可复现，修正版请求和拒绝跳转均验证成功。模拟请求使用假凭据，不代替上面的真实自动任务验证。

[快速启动实测](https://github.com/mimi0209/tokyo-license-watch-free/actions/runs/42137543558)和[正式发布验证](https://github.com/mimi0209/tokyo-license-watch-free/actions/runs/42137908993)均通过：直接安装完整 Chromium，复用标准 Ubuntu 24.04 镜像已有系统库，完成三个考场及全部可见月份的官网扫描。

[手机通知测试记录](https://github.com/mimi0209/tokyo-license-watch-free/actions/runs/42021090465)：使用者已确认收到新主题的测试消息。当前通知规则如下。

## 检查内容

- **每日日本时间 00:00 保留一轮正式扫描。** 即使 `ENABLE_MONITOR="false"` 暂停普通五分钟监控，午夜这一轮仍会执行。它使用独立并发队列，避免被普通扫描占位或被后续待执行任务替换；仍包含在原来的每天 288 次触发中。平台排队或故障可能延迟执行，不能保证 00:00 准秒完成。
- 江東、鮫洲、府中三个考场。
- 教習所卒業等、免許証のみ；日本时间当天起，官网允许查看的所有月份。
- 点击黄色的可选日期后检查受付时间，分别通知「黄色但全部时段 0 人」和「确认有可选时段」。加载失败或不能确认时标记失败，绝不把未确认内容说成 0 人。
- 黄色日期内所有时段均明确显示剩余 0 人时，发送下方提醒，然后继续检查其他日期、全部月份和三个考场。发现真实空位后也继续完成本轮扫描及以后的五分钟监控。
- 只读取公开空位，不选择时段、不填写个人资料、不提交预约。
- 通知使用 ntfy；同一空位会尝试去重。

### 黄色日期、内部时段 0 人的通知

```text
江東試験場 2026-11-12
カレンダーは黄色ですが、受付時間の残り人数はすべて0人です。
予約可能な空き枠はありません。監視を継続しています。
```

日期和会场替换为实际检测结果。此提醒不表示已发现可预约空位。相同会场、相同日期持续为黄色且全部 0 人时，仅提醒一次；后来出现可选时段会另发原有的确认空位通知。黄色日期消失并在完整扫描中确认后重新出现，或状态由有空位变为全 0 人时，可重新提醒。去重依靠状态缓存，缓存丢失或保存失败可能造成重复通知。

日历中的灰色不可选日期、检查时已消失的日期，以及未加载完成或无法确认的时间列表，都不会发送「黄色但 0 人」通知。验证模式不发送通知，不改状态。

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

### 3. 从 GitHub 导入 Cloudflare（手机推荐）

先登录或注册 Cloudflare 免费账号，然后进入 **Workers & Pages → Create application → GitHub**，连接并选择本公开仓库。GitHub 授权范围只需包含本仓库。

配置如下：

| 字段 | 值 |
| --- | --- |
| Worker name | `tokyo-license-watch-free` |
| Branch | `main` |
| Root directory | `cloudflare` |
| Build command | 留空 |
| Deploy command | `npm run deploy` |

选择 Workers Free，保存并部署。仓库已设好目标 GitHub 仓库、启用开关和五分钟 Cron，无需在手机粘贴 Worker 代码。

部署后，在这个 Worker 的 **Settings → Variables and Secrets → Add** 中添加 **Secret**，名称为 `GITHUB_TOKEN`，值为上一步创建的 GitHub fine-grained token。保存并应用到 Production，以新一轮运行日志确认其生效。Build variables 只供构建使用，不能替代运行时 Secret。

GitHub API token 只在 Cloudflare 的 Secret 输入框填写，不提交到仓库、不发到聊天。配置完成后，仍须观察至少两轮 `cloud-timer / scan` 执行记录和扫描结果，才能确认自动检查上线。

### 其他方式：直接配置 Cloudflare 免费定时器

在 Cloudflare **Workers & Pages** 创建一个 Worker，使用 Free 计划。代码为 `cloudflare/worker.mjs`。

添加变量：

| 名称 | 类型 | 值 |
| --- | --- | --- |
| `GITHUB_REPOSITORY` | 普通变量 | 新公开仓库的 `用户名/仓库名` |
| `ENABLE_MONITOR` | 普通变量 | `true` |
| `GITHUB_TOKEN` | Secret | 上一步生成的 fine-grained token |

在 **Settings → Triggers → Cron Triggers** 添加 `*/5 * * * *`，时区为 UTC。它也涵盖日本时间 0:00。

使用 Wrangler 时，先修改 `cloudflare/wrangler.toml` 中的仓库名；token 仍通过 Secret 配置。HTTP 入口不提供触发功能，可保持 workers.dev 和预览 URL 关闭。

修改工作流后会自动执行一次 `deployment-check / verify`，它测试定时器代码并真实检查官网，默认不发送通知。仅当该次提交明确带有 `[phone-test]` 标记时，部署验证另发送一次清楚标注的手机测试消息；定时扫描不会发送这种测试消息。该部署记录不能证明免费定时链已经启用。

## 判断是否正在运行

1. Cloudflare 日志出现 `DISPATCH_ACCEPTED`，表示 GitHub 接受了启动请求。
2. GitHub **Actions → Tokyo license watch** 出现新的 `cloud-timer / scan / 时间` 记录，事件类型会是 `workflow_dispatch`。
3. 打开 **monitor → Check availability or send test**，核实扫描成功或失败。

这是外部定时器调用，因此不依靠 GitHub 的 `schedule` 事件；应检查标题中的来源和计划时间。

- `All venues and accessible months checked; no available reception time.`：本轮完整扫描，无可选时段。
- `NOTIFICATION_OBSERVATION`：包含会场、日期、`calendar-full`（黄色但全 0 人）或 `available`（确认有可选时段），以及 `accepted` / `duplicate-suppressed`。`accepted` 表示 ntfy 已接受，不代替手机实际收到的确认。
- 任务失败或长时间没有新记录时，监控不算正常运行。
- 没有黄色可选日期和真实空位时不发手机通知。黄色但全时段 0 人时按上述规则提醒；当前故障信息记录在平台日志中。

## 暂停与恢复

从 GitHub 导入后，以仓库的 `cloudflare/wrangler.toml` 为配置来源，提交后由 Cloudflare 自动部署：

- 将 `ENABLE_MONITOR` 改为 `"false"`：暂停普通五分钟检查，日本时间 0:00 仍检查一次。
- 将 `[triggers]` 下的 `crons` 改为 `[]`：停止全部自动检查，包括 0:00。
- 将 `crons` 恢复为 `["*/5 * * * *"]` 并设 `ENABLE_MONITOR="true"`：恢复普通检查。

仅在控制台临时修改变量或删除 Cron，可能被下一次 Git 部署覆盖。触发器变更也需要平台传播时间。
- 更换 token 后需在 Cloudflare 更新 Secret；请留意 token 到期时间。

## 已修复的问题

- `GITHUB_TOKEN secret is missing`：运行版本没有读到该绑定。令牌必须配置在对应 Worker 的 Production 运行时 Secret 中。部署配置的名称已与线上 Worker 对齐，并开启 `keep_vars` 保留控制台其他变量；令牌仍应使用 Secret 类型，不能写入代码。
- `GitHub request failed before a response`：旧版使用 Workers 不支持的 `redirect: error`，构造请求时就失败。现改为 `manual` 并拒绝所有 3xx；运行时测试覆盖这个实际差异，错误日志仅返回安全类别。
- 浏览器安装过慢：首轮 09:25 任务在反复安装系统依赖时超时。现使用验证过的快速安装方式，并把正式扫描与发布验证分开排队。标准运行器镜像若更换，应重新验证系统库是否齐全。

## 本地检查

```bash
npm install --no-audit --no-fund
npm test
npx playwright install --no-shell chromium
xvfb-run -a npm run test:browser # Linux；有图形界面的 Mac 可直接 npm run test:browser
npm install --prefix cloudflare --no-audit --no-fund
npm --prefix cloudflare run test
npm --prefix cloudflare run test:runtime
npm --prefix cloudflare run check
```

`npm --prefix cloudflare run deploy` 会先执行两组测试，通过后才发布。测试覆盖普通定时、日本时区午夜、停用开关、私有仓库阻止、固定扫描模式、新旧接口回执、密钥保护，以及真实 Workers 运行时的请求与跳转行为。它们不能代替部署后的连续正式扫描验证。

根目录测试另外覆盖黄色全 0 人文案、重复提醒抑制、状态切换后的真实空位通知、部分扫描失败后的去重保留、日期消失与重现，以及 Chromium 中实际读取日期和时间列表的行为。浏览器测试使用拦截的模拟页面和假通知回执；发布前另以 `MODE=verify` 读取真实官网，不发送测试空位提醒。

官方说明：
- https://docs.github.com/en/billing/concepts/product-billing/github-actions
- https://developers.cloudflare.com/workers/platform/pricing/
- https://developers.cloudflare.com/workers/platform/limits/
- https://developers.cloudflare.com/workers/configuration/cron-triggers/

- https://developers.cloudflare.com/workers/runtime-apis/request/

