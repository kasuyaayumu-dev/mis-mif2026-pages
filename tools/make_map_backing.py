"""フロア画像の背後に敷く「白いぼかしの下地」画像を作る。

背景が透明なフロア画像は、濃い色のページ背景の上だと黒い線が見えにくい。
線で囲まれた建物の内側と、線・アイコンの周りを白くぼかした半透明の画像を作り、
地図ではフロア画像の下に重ねる。

使い方:  python3 tools/make_map_backing.py image/map/floor1_6.png image/map/floor1_back.png
(フロア画像を差し替えたら、同じ手順で下地も作り直す)
"""
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

SCALE = 0.5        # ぼかすので解像度は半分で足りる(ファイルを小さく保つ)
GLOW_RADIUS = 14   # 線・アイコンの外側へ白を広げる距離(縮小後のpx)
CLOSE_RADIUS = 9   # 壁の途切れを埋めて、建物の内側を判定しやすくする(縮小後のpx)
GAP_CLOSE = 14     # 下地にできる細い隙間(紺色のすじ)を埋めてつなぐ幅(縮小後のpx。隙間はこの2倍まで埋まる)
BLUR = 7           # 縁のぼかし(縮小後のpx)
OPACITY = 0.8      # 下地の白の濃さ(小さいほど透ける)


def dilate(mask_img, radius):
    return mask_img.filter(ImageFilter.MaxFilter(radius * 2 + 1))


def build_backing(src_path, dst_path):
    src = Image.open(src_path).convert("RGBA")
    w, h = src.size
    small = src.resize((round(w * SCALE), round(h * SCALE)), Image.LANCZOS)
    ink = small.getchannel("A").point(lambda v: 255 if v > 40 else 0)

    # 建物の内側 = 線で囲まれていて、外側から回り込めない場所
    closed = dilate(ink, CLOSE_RADIUS)
    padded = Image.new("L", (closed.width + 2, closed.height + 2), 0)
    padded.paste(closed, (1, 1))
    ImageDraw.floodfill(padded, (0, 0), 128)  # 外側(画面の縁とつながる空き)だけを塗る
    outside = np.array(padded)[1:-1, 1:-1] == 128
    interior = Image.fromarray((~outside * 255).astype(np.uint8), "L")

    mask = np.maximum(np.array(interior), np.array(dilate(ink, GLOW_RADIUS)))
    # 細い隙間を埋める(膨らませてから縮める=クロージング)。縁で欠けないよう、余白をつけて処理する
    pad = GAP_CLOSE + 2
    padded_mask = Image.fromarray(np.pad(mask, pad), "L")
    closed_mask = padded_mask.filter(ImageFilter.MaxFilter(GAP_CLOSE * 2 + 1)).filter(ImageFilter.MinFilter(GAP_CLOSE * 2 + 1))
    mask = np.array(closed_mask)[pad:-pad, pad:-pad]
    alpha = Image.fromarray(mask, "L").filter(ImageFilter.GaussianBlur(BLUR))
    alpha = alpha.point(lambda v: int(v * OPACITY))

    out = Image.new("RGBA", alpha.size, (255, 255, 255, 0))
    out.putalpha(alpha)
    out.save(dst_path, optimize=True)
    return small.size


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    print(build_backing(sys.argv[1], sys.argv[2]))
