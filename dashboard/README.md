# 東京都 学科試験モニター

東京都全域の運転免許学科試験空き枠監視を確認・操作する、本人用Sitesダッシュボードの実装です。

**公開状況：未公開。** 2026-11-08の作成セッションではSites用の実行環境が初期化エラーとなり、ローカルチェックアウト・Sitesへのソース同期・公開を実施できませんでした。Site IDを発行していません。既存botのmainブランチおよびCloudflare本番設定は、このブランチでは変更していません。

## 画面

- PC・スマートフォン対応。1ページで実行概要、江東・鮫洲・府中、エラー、通知、優先課題、無料条件を確認。
- GitHubの最新30件をページ送り。概要カードはページ送りしても最新の実行を参照。
- 直近の成功・失敗、本日の日本時間00:00の独立実行、確認済み月、未確認日付。
- HTTP、ネットワーク、ページ状態、入力・設定、タイムアウト、未確認日付、通知失敗を分類。
- 空き検出、ntfy受付、通知失敗、重複抑制の履歴。表示範囲のログを明示して、未取得や旧版の未記録を0件と表示しません。
- 5分監視の一時停止では00:00を維持。全停止はCronを削除。起動・通知テストはGitHub Actionsへ明示的な操作で送信。
- 変更はGitHubへの保存・起動受付までを確認。Cloudflareへの反映、スキャン完了、スマートフォン受信は別の状態です。

## 実データと未確認事項

2026-11-08の取得時点で確認した記録：

- 通常スキャン：10:45開始、10:46:28に3会場の全可視月を確認。2026-11〜2027-02、選択可能な日付なし、未確認日付なし。
  https://github.com/mimi0209/tokyo-license-watch-free/actions/runs/42435597602
- 本日00:00の独立スキャン：00:01:15に3会場の全可視月を確認、成功。
  https://github.com/mimi0209/tokyo-license-watch-free/actions/runs/42384216028
- 5分ごとの外部起動履歴あり。GitHub ActionsはPublic / ubuntu-24.04。
- Cloudflare本番のCron設定・契約プラン・使用量・配信ログは直接取得していません。
- ntfyの過去の端末受信は利用者が確認済み。今回の作成では実通知は送っていません。
- 旧版は重複抑制のログを出しません。このPRは動作を変えず、秘密を含まない構造化イベントを追加します。
- 空き枠検出時の早期終了で、後続会場や残りの日付は未走査になる場合があります。ダッシュボードでは確認完了にしません。
- 毎日00:00と通常実行は別キューです。キャッシュを用いる現在の重複抑制には同時実行競合があり得るため、原子的な抑制は今後の確認・改善対象です。
- 11月15日という以前の受験希望はbotの対象日付フィルターには実装されていません。監視対象は公式サイトで可視の全期間です。この実装では対象を変更していません。

画面はこれらのスナップショットを稼働中の数値として埋め込みません。公開後はGitHub APIから取得し、失敗した取得はエラーとして表示します。

## サーバー側の接続

GitHub以外の有料監視サービスや新しいタイマーは追加しません。

| 設定 | 用途 |
| --- | --- |
| BOT_GITHUB_TOKEN | 対象リポジトリだけを許可したfine-grained token。詳細ログにはActions read、操作にはActions writeとContents read/writeが必要 |
| BOT_ALLOW_CONTROL | 初期はfalse。接続とDB移行の完了後、操作を有効にする場合のみtrue |
| DB | 操作履歴と重複送信防止用のD1バインディング。migrations/0001_operations.sqlを公開前に適用 |

トークンはSitesのサーバー環境変数だけに設定します。ソース・ブラウザー・チャット・GitHubファイルに置きません。既存CloudflareのGITHUB_TOKENやGitHubのNTFY_TOPICは取り出しません。

GETは監視を変更しません。POSTはChatGPTの認証済みリクエスト、同一Origin、許可された操作、無料条件を検証します。DBの一意な操作IDにより二重受付を防ぎます。通信結果が不明な操作は自動再送しません。トークン・操作許可・DBのいずれかが未設定なら、操作ボタンは接続案内を表示します。

CloudflareはGitHub mainからcloudflare/を自動配信する既存構成を前提とします。開始・停止はwrangler.tomlをmainへ保存するため、自動配信が動かない場合は設定保存後も本番反映は未確認になります。全停止でも実行中や待機中のジョブをキャンセルしません。

## Sitesでの公開再開

1. 実行環境の復旧後、Sitesの通常フローで新しいプライベートSite用の空ディレクトリを準備。
2. 本ディレクトリのソースをコピー。ID発行後、返された正確なproject_idを.openai/hosting.jsonへ保存。未発行のIDを推測しない。
3. Worker ESMとしてdist/server/index.jsを生成する。本人以外へ公開範囲を変更しない。
4. 操作を有効にする場合は、Sitesが対応するD1バインディングと移行の形式を確認し、上のschema-only SQLを正式な公開前移行として組み込む。リクエスト時にテーブルを作成しない。
5. 環境変数を設定。ソースをSitesの専用ソースリポジトリへ同期し、正確なcommitとビルド成果物で保存・公開。
6. 本人として実行履歴取得、詳細ログ、Refreshを確認。明示的な操作で開始・停止・通知テストを検証してから接続済みと報告。

このGitHubブランチは公開前の保存場所です。Sitesの専用ソースリポジトリへの同期や公開の代わりにはなりません。

## 検証

依存ゼロのWorker / UI：

    node --check dashboard/worker/index.js
    node --test dashboard/test/dashboard.test.mjs

通知イベント（すべてダミーのHTTP応答、実通知なし）：

    npm install --no-audit --no-fund
    node --test dashboard/test/telemetry.test.mjs

Sites IDが保存された後：

    node dashboard/scripts/build.mjs

GitHub ActionsのDashboard checksはPublicの標準Ubuntu runnerでこれらと操作履歴のSQLスキーマを検証します。既存の監視workflowやCloudflare本番を起動・停止するテストは実行しません。ブラウザーによる見た目・クリック・本番認証のQAは未実施です。

## 無料条件

標準GitHub-hosted runnerのPublicリポジトリ利用は無料という公式条件に従います。Larger runnerとPrivate実行を許可しません。

Cloudflareは既存のWorkers Free、1つの5分Cronを前提とします。1日288回、00:00はその内数。Freeは1日100,000リクエストの制限があり、他Workerとの共有・CPU・使用量は別途確認が必要です。有料プランへの変更、使用量超過時の有料サービスへの切替、追加の有料サービスの契約を行うコードはありません。SitesやD1の契約・枠を未確認のまま無料と保証しません。

- https://docs.github.com/en/actions/reference/runners/github-hosted-runners
- https://developers.cloudflare.com/workers/platform/pricing/
- https://developers.cloudflare.com/workers/platform/limits/
