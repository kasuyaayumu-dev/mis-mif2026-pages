# mis-mif2026-pages

文化祭マップの静的ホスティング用リポジトリ(GitHub Pages)。

- `floor1/`, `floor2/`, `floor3/` — 各階のマップページ(`fetch`で `../data/json_*floor.json` を読み込み)
- `data/` — マーカーデータ(JSON、手動更新)
- `image/icon/`, `image/map/` — アイコン・フロア画像アセット

STUDIO側の埋め込み(iframe src)は各 `https://<user>.github.io/mis-mif2026-pages/floor{N}/` を指定する。
