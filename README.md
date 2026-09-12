# mis-mif2026-pages

文化祭マップ・タイムテーブルの静的ホスティング用リポジトリ(GitHub Pages)。

- `floor1/`, `floor2/`, `floor3/` — (互換維持用)各階を個別に表示するマップページ。既存のSTUDIO埋め込み(iframe src)がこれらを参照しているため残置。
- `maps/` — STUDIOに実際に埋め込まれている本番用マップ(日本語)。今はまだ準備段階のため意図的に "Coming Soon" プレースホルダーを表示している。
  - `maps/en/` — 英語版。表示文言のみ英語化した同一構成のプレースホルダー。
  - `maps/preview/` — 本番切り替え前の開発中プレビュー。Leafletベースのフロア切り替えマップ(Googleマップの屋内フロア切り替えのような右上のスライダーで1F/2F/3Fを切り替え)を実装済み。企画の配置(ピン)は今年分がまだ確定していないため`data/map-pins-floor{1,2,3}.json`は空配列のプレースホルダーで、フロア背景画像は`image/map/floor{1,2,3}_2.png`(昨年の会場写真)を暫定的に流用している(ページ上部にその旨のバナー表示あり)。今年のピンデータが揃い次第、該当JSONを`data/json_1floor.json`等と同じ形式で埋めればそのまま表示される。**準備が整ったら`maps/preview/`の内容を`maps/`に昇格させ、STUDIO側にも公開する。**
    - `maps/preview/en/` — 英語版。表示文言のみ英語化した同一構成のページ(`maps/preview/style.css` / `maps/preview/app.js`をJP/ENで共有)。
- `timetable/` — イベントタイムテーブル(日本語)。`../data/timetable.json` を読み込み、駅の時刻表のようなグリッド形式で表示する。日程(Day1/Day2)タブ切り替え、現在時刻の赤ライン表示、終了済みイベントの自動グレーアウトに対応。
  - `timetable/en/` — 英語版。`../../data/timetable.en.json` を読み込む同一構成のページ。
- `data/` — マーカー・タイムテーブルデータ(JSON、手動更新)
  - `groups.json` / `groups.en.json` — 2026 MIFデザイン部情報フォームの回答を元にした企画・団体情報一覧(各63件)。日本語版/英語版で完全に分離したファイルで、`groups.en.json`側には日本語テキストを含めていない(団体名・カテゴリ・形式・企画名なども英訳済み。公式回答に英語版がない項目は独自に翻訳)。企画名・団体名・短い概要・カテゴリ・形式・`icon`(image/icon/内のファイル名、63件全て設定済み)など。Map等では短い概要のみ使用するため、長い説明文(企画説明)は含めていない。`floor`/`room`/`latlng`はマップ座標未確定のため`null`のプレースホルダーで、確定次第そのまま埋めればマップ用データとしても使える。
  - `timetable.json` / `timetable.en.json` — タイムテーブルの日本語版/英語版データ。構造(時刻・カテゴリ・列構成)は共通で、表示文言のみ翻訳している。片方を編集したらもう片方にも同じ変更(時刻・追加/削除)を反映すること。
- `image/icon/`, `image/map/` — アイコン・フロア画像アセット
- `chatbot/` — 企画アシスタントチャットボットの埋め込みウィジェット(フロントのみ、静的)。`chatbot/en/`が英語版。`data/groups.json`を元にした質問応答を`chatbot-server/`のAPIに問い合わせる。**`CHAT_I18N.apiUrl`は現状プレースホルダーのため、サーバーをデプロイしたら実URLに差し替えること。**
- `chatbot-server/` — チャットボットの中継サーバー(Node.js/Express)。OpenAI APIキーを保持しGitHub Pagesでは動かない別プロセス。ラズパイ等の常時稼働サーバーに別途デプロイする想定(手順は`chatbot-server/README.md`参照、未デプロイ)。GitHub Pagesのビルド対象には含めない。

STUDIO側の埋め込み(iframe src)は用途に応じて以下を指定する。日英の切り替えはembedコードのURLを出し分けることで行う。
- 1階のみ等、個別フロア: `https://<user>.github.io/mis-mif2026-pages/floor{N}/`
- 統合マップ(フロア切り替え付き): `https://<user>.github.io/mis-mif2026-pages/maps/`(英語版は`/maps/en/`)
- タイムテーブル: `https://<user>.github.io/mis-mif2026-pages/timetable/`(英語版は`/timetable/en/`)
- 企画アシスタント: `https://<user>.github.io/mis-mif2026-pages/chatbot/`(英語版は`/chatbot/en/`)※サーバー未デプロイのため現状は動作しない

## data/timetable.json のフォーマット

トップレベルは `days` 配列。1要素が1日分(Day1/Day2)のグリッド全体を表す。

```json
{
  "days": [
    {
      "id": "day1",
      "date": "2026-09-05",
      "title": "Day 1",
      "subtitle": "9:00-16:00　最終受付 15:00",
      "theme": "purple",
      "startTime": "09:00",
      "endTime": "16:00",
      "columns": [
        { "key": "av", "label": ["教室棟", "視聴覚"] },
        { "key": "hall", "label": "ホール棟", "children": [
            { "key": "hall_main", "label": "メインホール" },
            { "key": "hall_sub", "label": "サブホール" }
          ] },
        { "key": "ground", "label": "屋外" }
      ],
      "events": [
        { "columns": ["av"], "start": "10:00", "end": "10:40", "title": "キャリアプレゼンテーション", "category": "cyan" },
        { "columns": ["ground"], "start": "09:30", "end": "10:30", "title": "LET'S 陸上！", "category": "purple", "room": "グラウンド" },
        { "columns": ["av", "hall_main", "hall_sub", "ground"], "start": "15:00", "end": "16:00", "title": "閉園\n完全退園", "category": "closed" }
      ]
    }
  ]
}
```

- `date` — その日の実際の日付(`YYYY-MM-DD`)。ブラウザの今日の日付と一致する場合のみ、現在時刻の赤ラインと終了済みイベントのグレーアウトが有効になる。
- `theme` — `purple` か `cyan`(バナー・見出しの配色)。
- `columns` — グリッドの列構成。`children` を持つ列は見出しがグループ化される(例: 「ホール」→「メイン」「サブ」)。
- `events.columns` — 複数指定すると列をまたいで結合表示される(閉園ブロックなど)。
- `events.category` — `pink` / `cyan` / `purple` / `closed` のいずれか(色分け)。
- `events.room` — 同じ列を複数の実会場が共有する場合(例: 「屋外」列の中の「グラウンド」「テニスコート」)に、セル表示・ポップアップで列名の代わりに表示する会場名。

`timetable/?now=13:15&day=day1` のようにクエリを付けると、任意の時刻を「現在時刻」として動作確認できる(デバッグ用、本番では不要)。

現在のデータはサンプルです。実際のイベント情報が確定したら `data/timetable.json` を差し替えてください。
