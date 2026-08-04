# mis-mif2026-pages

文化祭マップ・タイムテーブルの静的ホスティング用リポジトリ(GitHub Pages)。

- `floor1/`, `floor2/`, `floor3/` — (互換維持用)各階を個別に表示するマップページ。既存のSTUDIO埋め込み(iframe src)がこれらを参照しているため残置。
- `maps/` — 全フロア統合マップ。Googleマップの屋内フロア切り替えのような右下スライダー(1F/2F/3F)でフロアを切り替えられる。マーカーデータは各フロアの `../data/json_*floor.json` をまとめて読み込む。
- `timetable/` — イベントタイムテーブル。`../data/timetable.json` を読み込み、駅の時刻表のようなグリッド形式で表示する。日程(Day1/Day2)タブ切り替え、現在時刻の赤ライン表示、終了済みイベントの自動グレーアウトに対応。
- `data/` — マーカー・タイムテーブルデータ(JSON、手動更新)
- `image/icon/`, `image/map/` — アイコン・フロア画像アセット

STUDIO側の埋め込み(iframe src)は用途に応じて以下を指定する。
- 1階のみ等、個別フロア: `https://<user>.github.io/mis-mif2026-pages/floor{N}/`
- 統合マップ(フロア切り替え付き): `https://<user>.github.io/mis-mif2026-pages/maps/`
- タイムテーブル: `https://<user>.github.io/mis-mif2026-pages/timetable/`

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
        { "key": "av", "label": ["1F", "視聴覚室"] },
        { "key": "hall", "label": "ホール", "children": [
            { "key": "hall_main", "label": "メイン" },
            { "key": "hall_sub", "label": "サブ" }
          ] },
        { "key": "ground", "label": "グラウンド" }
      ],
      "events": [
        { "columns": ["av"], "start": "10:00", "end": "10:40", "title": "キャリアプレゼンテーション", "category": "cyan" },
        { "columns": ["av", "hall_main", "hall_sub"], "start": "15:00", "end": "16:00", "title": "閉園\n完全退園", "category": "closed" }
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

`timetable/?now=13:15&day=day1` のようにクエリを付けると、任意の時刻を「現在時刻」として動作確認できる(デバッグ用、本番では不要)。

現在のデータはサンプルです。実際のイベント情報が確定したら `data/timetable.json` を差し替えてください。
