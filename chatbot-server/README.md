# MIF チャットボット サーバー

STUDIOのイベントページに埋め込む「企画アシスタント」チャットボットの中継サーバー。
OpenAI APIキーをフロントに出さずに、企画情報(`data/groups.json` / `groups.en.json`)を
元にした質問応答APIを提供する。

対になるフロントエンド(埋め込みウィジェット)は `../chatbot/`(日本語)・`../chatbot/en/`(英語)。

## 主な機能

- 通常の質問応答(企画リストを元にした自然文回答)
- `find_project_link` ツール: 特定の企画について「もっと知りたい/ページに行きたい」と言われた時、
  該当企画の `url`(`data/groups.json` 側で管理)を検索してリンクへ誘導する
- `suggest_projects` ツール: 「ダンス系の企画ある？」のように複数の企画が当てはまる質問に対して、
  該当企画をカード形式(アイコン・企画名・説明)でレスポンスの `suggestions` 配列に含めて返す。
  フロント側(`../chatbot/app.js`)がこれを添付ファイル風のカード一覧として表示し、
  `url` が設定されている企画はクリックでそのページへ遷移する。

いずれも `data/groups.json` / `groups.en.json` の各企画に `url` を設定すれば、そのままリンクとして
機能する(現状は未確定のため全件 `null`)。

- `data/venue-info.json` / `venue-info.en.json`: 企画個別ではない、文化祭全体の来場案内データ
  (開催日程・飲食/休憩場所・トイレ・案内所・保健室・アクセス・落とし物・注意事項)。システム
  プロンプトに自動で埋め込まれる。未確定の項目は `"情報なし"` 等にしておき、確定したらこの
  JSONファイルを更新するだけでよい(サーバーのコード修正やデプロイは不要)。
- 企画ごとの開催時間: `data/groups.json` には持たせず、既存の `data/timetable.json` /
  `timetable.en.json`(タイムテーブルページと共通のデータ)を `icon` フィールドで突き合わせて
  取得している。タイムテーブルに載っている企画は日時が全部列挙され、載っていない企画(多くの
  飲食・展示ブースなど)は「情報なし」として案内される。
- 企画の階(フロア): `data/map-pins-floor{1,2,3}.json`(`maps/preview/`用のマップピンデータ)を
  `icon` フィールドで突き合わせて「1階/2階/3階」を取得し、システムプロンプトに含めている。
  ピンがまだ無い企画は「情報なし」として案内される。教室番号・待機場所・チケット/整理券は
  現時点では未確定のため、システムプロンプトには含めていない(聞かれた場合は「登録されて
  いません、当日は企画スタッフ・案内所へ」と案内する)。教室番号が確定したらこのフォールバック
  文言を差し替える。

## ローカルでの動作確認

```bash
cd chatbot-server
npm install
cp .env.example .env
# .env を編集してOPENAI_API_KEYなどを設定
npm start
```

`http://localhost:9877/health` が `{"ok":true}` を返せばOK。

`../chatbot/index.html` の `CHAT_I18N.apiUrl` を `http://localhost:9877/api/chat` に
一時的に変更すれば、ローカルで会話の動作確認ができる。

## ラズパイへのデプロイ手順(想定)

前提: Node.js 20+、pm2かDocker、nginxが使える環境。

### 1. コードを転送

```bash
# ローカルから
rsync -av --exclude node_modules --exclude .env chatbot-server/ <user>@<pi-host>:/opt/mif-chatbot/
```

### 2. サーバー上でセットアップ

```bash
cd /opt/mif-chatbot
npm install --omit=dev
cp .env.example .env
vi .env   # OPENAI_API_KEY, ALLOWED_ORIGINS などを設定
```

### 3. 常駐化(pm2の場合)

```bash
npm install -g pm2
pm2 start server.js --name mif-chatbot
pm2 save
pm2 startup   # OS起動時に自動起動する設定(表示されるコマンドを実行)
```

### 4. nginxでリバースプロキシ

`/etc/nginx/sites-available/mif-chat.<your-domain>` を作成:

```nginx
server {
    listen 80;
    server_name mif-chat.your-domain.com;
    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
        allow all;
    }
    location / {
        return 301 https://$server_name$request_uri;
    }
}

server {
    listen 443 ssl http2;
    server_name mif-chat.your-domain.com;

    ssl_certificate /etc/letsencrypt/live/mif-chat.your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/mif-chat.your-domain.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:9877;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

```bash
ln -s /etc/nginx/sites-available/mif-chat.your-domain.com /etc/nginx/sites-enabled/
certbot --nginx -d mif-chat.your-domain.com
nginx -t && systemctl reload nginx
```

### 5. フロント側の設定を更新

`../chatbot/index.html` と `../chatbot/en/index.html` の `CHAT_I18N.apiUrl` を
実際のエンドポイント(例: `https://mif-chat.your-domain.com/api/chat`)に更新し、
コミット・プッシュする。

`.env` の `ALLOWED_ORIGINS` には、STUDIO側の公開ドメイン(埋め込み先のiframeの
親ページのオリジン)を設定すること。

## セキュリティ上の注意

- `OPENAI_API_KEY` は `.env` にのみ置き、絶対にgitにコミットしない
- `ALLOWED_ORIGINS` を本番用のSTUDIOドメインに限定する(開発中は空でもよいが本番前に必ず設定)
- レート制限(1分20リクエスト/IP)を standard で入れているが、想定来場者数に応じて調整する
