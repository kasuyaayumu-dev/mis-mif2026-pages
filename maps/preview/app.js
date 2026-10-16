// data-url・表示文言は各ページのMAPS_CONFIG/MAPS_I18N(グローバル)から受け取る。
// 建物のフロア画像・レイアウトはJP/ENで共通のため、パス以外はここに1つだけ持つ。
const CONFIG = window.MAPS_CONFIG || {};
const I18N = window.MAPS_I18N || {};
const imageBase = CONFIG.imageBase || '';
const dataBase = CONFIG.dataBase || '';

L.Icon.Default.imagePath = 'https://unpkg.com/leaflet@1.9.4/dist/images/';

const CustomCRS = L.extend({}, L.CRS.Simple, {
  transformation: new L.Transformation(1, 0, -1, 10000)
});

const map = L.map('map', {
  crs: CustomCRS,
  attributionControl: false,
  center: [500, 500],
  zoom: 0,
  // 去年の写真より画像サイズが大きいフロアもあるため、初期のfitBounds()がデフォルトの
  // minZoom(0)でクランプされて全体表示できなくならないよう、先に広めの範囲を許可しておく
  // (実際に使う範囲はfitToWholeMap()内でfitZoom基準に絞り直す)。
  minZoom: -10,
  maxZoom: 10,
  maxBoundsViscosity: 0.8
});

// 表示順は「上の階が上」= Googleマップの屋内フロア切り替えと同じ並び。
// width/height は画像(image/map/floorX_3.png)の実寸。ピンの座標(latlng)は
// この画像の左下を原点とするピクセル値で持っている。
const floorOrder = ['3階', '2階', '1階'];
// viewOrigin: 開始時に地図の左上隅へ置く画像上の点 [左端のx, 上端のy] (画像の左上が原点、下向きがyの正)。
//   指定した階は、画像全体の中心ではなく、この点を左上に揃えた位置から表示を始める。
const floorConfig = {
  '3階': { image: `${imageBase}floor3_5.png`, json: `${dataBase}map-pins-floor3.json`, width: 2127, height: 1384, viewOrigin: [-168, 457] },
  '2階': { image: `${imageBase}floor2_5.png`, json: `${dataBase}map-pins-floor2.json`, width: 1981, height: 1077, viewOrigin: [-168, 149] },
  '1階': { image: `${imageBase}floor1_5.png`, json: `${dataBase}map-pins-floor1.json`, width: 2635, height: 1752 }
};

const overlayLayers = {};
const markerLayers = {};
let currentFloor = '1階';

floorOrder.forEach(function (floor) {
  const cfg = floorConfig[floor];
  overlayLayers[floor] = L.imageOverlay(cfg.image, [[0, 0], [cfg.height, cfg.width]]);
  markerLayers[floor] = L.layerGroup();
});

// ?floor=2 や ?floor=2階 のようなクエリで初期表示フロアを指定できるようにする
function getInitialFloor() {
  const params = new URLSearchParams(location.search);
  let f = params.get('floor');
  if (!f) return '1階';
  f = decodeURIComponent(f).trim();
  if (floorConfig[f]) return f;
  if (/^[1-3]$/.test(f)) return f + '階';
  return '1階';
}

function setFloor(floor) {
  if (!floorConfig[floor]) return;
  floorOrder.forEach(function (f) {
    map.removeLayer(overlayLayers[f]);
    map.removeLayer(markerLayers[f]);
  });
  overlayLayers[floor].addTo(map);
  markerLayers[floor].addTo(map);
  currentFloor = floor;
  updateSwitcherUI();
}

let initialZoom = null;
let initialCenter = null;

// 表示中のフロアの画像全体が収まるズームを基準(fitZoom)に、
// ズームアウトはfitZoomまで(それ以上引くと画像より外側の余白しか見えなくなるため)、
// ホーム位置(初期表示・リセット時)はfitZoomより1段階ズームインした位置にする
function fitToWholeMap() {
  map.invalidateSize();
  const cfg = floorConfig[currentFloor];
  const bounds = L.latLngBounds([[0, 0], [cfg.height, cfg.width]]);
  // fitBounds()の直後にsetZoom()すると、fitBounds自体のズームアニメーションと
  // 競合して表示が乱れることがあるため、getBoundsZoom()で目標ズームだけ算出し、
  // 中心・ズームをsetView()で一度に確定させる(アニメーションなし)。
  const fitZoom = map.getBoundsZoom(bounds, false, [10, 10]);
  map.setMinZoom(fitZoom);
  map.setMaxZoom(fitZoom + 2);

  initialZoom = fitZoom + 1;
  initialCenter = bounds.getCenter();
  if (cfg.viewOrigin) {
    // 画像上の viewOrigin を地図の左上隅に置く中心を求める(CRS.Simpleの縮尺は 2^zoom)
    const size = map.getSize();
    const scale = Math.pow(2, initialZoom);
    const x = cfg.viewOrigin[0] + (size.x / 2) / scale;
    const yTop = cfg.viewOrigin[1] + (size.y / 2) / scale;
    initialCenter = L.latLng(cfg.height - yTop, x);
  }
  map.setView(initialCenter, initialZoom, { animate: false });

  applyTightBounds();
}

// パン可能範囲。普段は広すぎるとズームイン時に画像の外側の余白まで延々とドラッグできて
// しまうため狭め(1割程度)に絞っているが、この狭さのままだとポップアップを開いた時に
// autoPanが画面内へパンしきれず、ポップアップ自体が画面端で見切れることがある。
// そのため、ポップアップの開閉に合わせて一時的に範囲を広げ/戻す(setTightBounds参照)。
function tightBoundsFor(cfg) {
  const p = cfg.width * 0.1;
  return [[-p, -p], [cfg.height + p, cfg.width + p]];
}
function looseBoundsFor(cfg) {
  const p = cfg.width * 0.6;
  return [[-p, -p], [cfg.height + p, cfg.width + p]];
}
function applyTightBounds() {
  map.setMaxBounds(tightBoundsFor(floorConfig[currentFloor]));
}
function applyLooseBounds() {
  map.setMaxBounds(looseBoundsFor(floorConfig[currentFloor]));
}

// ポップアップ表示中だけパン範囲を広げ、autoPanが画面内へきちんとパンできるようにする。
// 閉じたら通常のパン範囲に戻す。
// LeafletのbindPopup側のautoPanは、狭いmaxBoundsの内側で計算されてしまい
// (かつ二重に呼ぶと今度は行き過ぎる)、はみ出したポップアップをうまく画面内に
// 収めきれないことがあるため、autoPanは切って自前でパン量を計算する。
map.on('popupopen', function (e) {
  applyLooseBounds();
  requestAnimationFrame(function () {
    const popupEl = e.popup._container;
    if (!popupEl) return;
    const popupRect = popupEl.getBoundingClientRect();
    const mapRect = map.getContainer().getBoundingClientRect();
    const pad = 12;
    let dx = 0, dy = 0;
    if (popupRect.left < mapRect.left + pad) dx = popupRect.left - (mapRect.left + pad);
    else if (popupRect.right > mapRect.right - pad) dx = popupRect.right - (mapRect.right - pad);
    if (popupRect.top < mapRect.top + pad) dy = popupRect.top - (mapRect.top + pad);
    else if (popupRect.bottom > mapRect.bottom - pad) dy = popupRect.bottom - (mapRect.bottom - pad);
    if (dx !== 0 || dy !== 0) map.panBy([dx, dy], { animate: false });
  });
});
map.on('popupclose', applyTightBounds);

function resetView() {
  if (initialZoom == null) return;
  map.setView(initialCenter, initialZoom, { animate: false });
}

// iframe埋め込み直後はコンテナのサイズや画像読み込みがまだ確定していないことがあるため、
// window の load 完了後(画像込みで読み込み終わったタイミング)に実行する。
// それでもレイアウトが確定しきっていないことが稀にあるため、少し遅れてもう一度
// 補正する(基準位置がずれたまま「初期表示に戻す」ボタンの基準になるのを防ぐ)。
function runInitialFit() {
  fitToWholeMap();
  setTimeout(fitToWholeMap, 200);
}
if (document.readyState === 'complete') {
  runInitialFit();
} else {
  window.addEventListener('load', runInitialFit);
}
window.addEventListener('resize', function () { map.invalidateSize(); });

const toArray = function (v) {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
};

// アイコンはjsDelivr経由(CDN)で配信しているが、キャッシュ更新の遅れなどで一部の画像だけ
// 取得に失敗することがあるため、失敗時は同じファイルをGitHub Pages側から取得し直す。
const ICON_CDN = 'https://cdn.jsdelivr.net/gh/kasuyaayumu-dev/mis-mif2026-pages@main/';
const ICON_PAGES = 'https://kasuyaayumu-dev.github.io/mis-mif2026-pages/';
function iconFallback(url) {
  return url.startsWith(ICON_CDN) ? ICON_PAGES + url.slice(ICON_CDN.length) : '';
}

function buildPopupHTML(data) {
  const iconUrls = toArray(data.iconUrl);
  const groups   = toArray(data.groupName);
  const events   = toArray(data.eventName);
  const descs    = toArray(data.description);
  const pages    = toArray(data.pageUrl);

  const count = Math.max(iconUrls.length, groups.length, events.length, descs.length, pages.length);
  const items = [];

  for (let i = 0; i < count; i++) {
    const icon = iconUrls[i] || '';
    const grp  = groups[i]   || '';
    const evt  = events[i]   || '';
    const dsc  = descs[i]    || '';
    // ピンのpageUrlは日本語ページ(/jp/detail/…)で持ち、英語マップでは英語ページ(/en/detail/…)に読み替える
    const url  = (pages[i] || '').replace('/jp/detail/', `/${I18N.detailLang || 'jp'}/detail/`);

    let itemHtml = `<div class="popup-item" data-idx="${i}" style="display:flex; gap:10px; align-items:flex-start; margin-bottom:14px; padding-bottom:14px; border-bottom:1px solid #ddd;">`;

    if (icon) {
      itemHtml += `<img src="${icon}" alt="${grp}" data-fb="${iconFallback(icon)}" ` +
        'onerror="if(this.dataset.fb&&this.src!==this.dataset.fb){this.src=this.dataset.fb}else{this.onerror=null}" ' +
        'style="width:50px; height:50px; border-radius:50%;">';
    } else {
      itemHtml += '<div style="width:50px; height:50px; border-radius:50%; background:#eee;"></div>';
    }

    itemHtml += '<div style="flex:1; min-width:0;">';
    itemHtml += `<div style="font-weight:700; font-size:1.05em; line-height:1.3">${evt}</div>`;
    itemHtml += `<div style="font-size:0.85em; color:#555; margin-bottom:6px;">${grp}</div>`;

    if (dsc) {
      itemHtml += `<p style="font-size:13px; margin:0 0 8px 0;">${dsc}</p>`;
    }
    if (url) {
      itemHtml += `<a href="#" class="popup-link" data-url="${url}" ` +
          'style="display:inline-block; padding:8px 10px; background:#007bff; color:#fff; ' +
          `text-decoration:none; border-radius:6px; font-size:13px; cursor:pointer;">${I18N.popupLinkLabel || 'View details'}</a>`;
    }

    itemHtml += '</div></div>';
    items.push(itemHtml);
  }

  // 高さの制限はLeafletのbindPopup側のmaxHeightオプションに任せる(そちらは
  // 地図コンテナ自体の高さも考慮してスクロール可否を判定してくれるため)。
  return `<div style="width:300px;">${items.join('')}</div>`;
}

// JSONから「表示用バッジ配列」を作る(どの記法でもOKにする)
function badgesFromData(d) {
  if (Array.isArray(d.badges)) return d.badges.map(b => ({ n: String(b.n ?? b.num ?? ''), color: b.color || '#6C5CE7' }));
  const nums   = (Array.isArray(d.badgeNumbers) ? d.badgeNumbers : (Array.isArray(d.number) ? d.number : (d.number != null ? [d.number] : []))).map(String);
  const colors = (Array.isArray(d.badgeColors)  ? d.badgeColors  : (Array.isArray(d.color)  ? d.color  : (d.color  != null ? [d.color]  : [])));
  const len = Math.max(nums.length, colors.length);
  const DEF = '#6C5CE7';
  const out = [];
  for (let i = 0; i < len; i++) out.push({ n: String(nums[i] ?? ''), color: colors[i] || DEF });
  return out.length ? out : [{ n: '', color: DEF }];
}

// バッジHTMLを作成(2列で横並び。1件は大きめ)
function makeBadgeHTML(badges) {
  const many = badges.length > 1;
  const sizeClass = many ? 'sm' : 'lg';
  const cols = many ? 2 : 1;
  const gap = many ? 4 : 0;
  const rows = Math.ceil(badges.length / cols);
  const unit = many ? 22 : 28;
  const width  = cols * unit + (cols - 1) * gap;
  const height = rows * unit + (rows - 1) * gap;

  const items = badges.map(b =>
    `<span class="badge ${sizeClass}" style="background:${b.color}">${b.n}</span>`
  ).join('');

  const gridStyle =
    `grid-template-columns: repeat(${cols}, ${unit}px);` +
    `gap:${gap}px;width:${width}px;height:${height}px`;

  return { html: `<div class="badge-grid" style="${gridStyle}">${items}</div>`,
           size: [width, height] };
}

// DivIcon でバッジマーカーを作る
function buildBadgeIcon(badges) {
  const { html, size } = makeBadgeHTML(badges);
  return L.divIcon({
    className: 'badge-marker',
    html,
    iconSize: size,
    iconAnchor: [size[0] / 2, size[1] / 2]
  });
}

function addMarkerFromJson(data, floor) {
  const layer = markerLayers[floor];
  if (!layer) return;

  const badges = badgesFromData(data);
  const icon = buildBadgeIcon(badges);

  const marker = L.marker(data.latlng, { icon })
    .addTo(layer)
    .bindPopup(buildPopupHTML(data), {
      // Leaflet標準のautoPanは狭いmaxBoundsの内側で計算されて画面内に収めきれない
      // ことがあるため無効にし、代わりに下のpopupopenハンドラで自前にパンする。
      // 複数企画をまとめたポップアップは中身が長くなり、地図コンテナ自体より
      // 高くなるとどれだけパンしても収まりきらないため、maxHeightで上限を決め打ちし、
      // はみ出す分はポップアップ内スクロールにする(STUDIO埋め込み時の小さい高さでも
      // 収まるよう、あえて控えめな値にしている)。
      maxWidth: 320, maxHeight: 200,
      autoPan: false,
      offset: data.popupDirection === 'top' ? [0, -20] : [0, 10],
      className: 'custom-popup'
    });

  marker.on('mouseover', function () {
    const el = this._icon;
    if (el) el.style.filter = 'drop-shadow(0 4px 10px rgba(0,0,0,.35))';
  });
  marker.on('mouseout', function () {
    const el = this._icon;
    if (el) el.style.filter = '';
  });
  return marker;
}

const iconUrlsByFloor = {};
// サイドメニュー(企画番号と企画名の一覧)用。1ピンに複数企画があれば企画ごとに1件ずつ持つ。
const menuEntries = [];

function loadMarkerData(floor, data) {
  if (!Array.isArray(data)) {
    throw new Error('JSONのトップレベルが配列ではありません');
  }
  iconUrlsByFloor[floor] = [];
  for (let i = 0; i < data.length; i++) {
    // データ内の "floor" 値は当てにせず、読み込んだファイルに対応する階を使う
    const marker = addMarkerFromJson(data[i], floor);
    if (marker) {
      const badges = badgesFromData(data[i]);
      const groups = toArray(data[i].groupName);
      toArray(data[i].eventName).forEach(function (name, j) {
        const badge = badges[j] || badges[0];
        menuEntries.push({ floor: floor, n: badge.n, color: badge.color, name: name, group: groups[j] || '', index: j, marker: marker });
      });
    }
    toArray(data[i].iconUrl).forEach(function (u) { if (u) iconUrlsByFloor[floor].push(u); });
  }
}

// 英語マップでは、ピン(日本語のみ)の企画名・団体名・説明文を、英語の企画データ(groups.en.json)で
// 置き換える。企画名が一致した企画は3つとも、団体名だけが一致した企画(企画名が変わったもの)は
// 団体名だけを英語にし、どちらも一致しなければ日本語のまま表示する。
function normKey(v) {
  return String(v || '').normalize('NFKC').replace(/\s+/g, '').replace(/['’]/g, '');
}

function buildTranslator(jaItems, enItems) {
  const enById = {};
  enItems.forEach(function (it) { enById[it.id] = it; });
  const byName = new Map();
  const byGroup = new Map();
  jaItems.forEach(function (it) {
    const en = enById[it.id];
    if (!en) return;
    byName.set(normKey(it.name), en);
    if (!byGroup.has(normKey(it.group))) byGroup.set(normKey(it.group), en);
  });
  return function (pin) {
    const groups = toArray(pin.groupName).slice();
    const events = toArray(pin.eventName).slice();
    const descs = toArray(pin.description).slice();
    events.forEach(function (name, j) {
      const full = byName.get(normKey(name));
      if (full) {
        events[j] = full.name || name;
        groups[j] = full.group || groups[j];
        if (full.description) descs[j] = full.description;
        return;
      }
      const g = byGroup.get(normKey(groups[j]));
      if (g && g.group) groups[j] = g.group;
    });
    pin.groupName = Array.isArray(pin.groupName) ? groups : groups[0];
    pin.eventName = Array.isArray(pin.eventName) ? events : events[0];
    pin.description = Array.isArray(pin.description) ? descs : descs[0];
  };
}

function loadTranslator() {
  if (I18N.detailLang !== 'en') return Promise.resolve(null);
  return Promise.all([
    fetch(`${dataBase}groups.json`).then(function (r) { return r.json(); }),
    fetch(`${dataBase}groups.en.json`).then(function (r) { return r.json(); })
  ]).then(function (res) {
    return buildTranslator(res[0].items || [], res[1].items || []);
  }).catch(function () {
    // 英語データが取れなくても、日本語のまま地図は表示する
    return null;
  });
}

const translatorReady = loadTranslator();
const pinLoads = floorOrder.map(function (floor) {
  return translatorReady
    .then(function (translate) {
      return fetch(floorConfig[floor].json)
        .then(function (res) { return res.json(); })
        .then(function (data) {
          if (translate && Array.isArray(data)) data.forEach(function (pin) { translate(pin); });
          loadMarkerData(floor, data);
        });
    })
    .catch(function () {
      // ピンデータは今年まだ確定していないため、取得・読込に失敗しても地図自体は表示を続ける
      console.error('企画ピンデータの読み込みに失敗しました:', floor);
    });
});

// 本番は回線が混み合って遅くなりやすいため、初期表示が済んだあとに、まだ見ていない
// フロアの画像とポップアップのアイコンをバックグラウンドで先に読み込んでおく。
// 表示中のフロアの読み込みを邪魔しないよう優先度を下げ、同時取得数も絞っている。
// 通信量を抑えたい設定(データセーバー)の端末では行わない。
const preloadedUrls = new Set();

function preloadImage(url) {
  if (!url || preloadedUrls.has(url)) return Promise.resolve();
  preloadedUrls.add(url);
  return new Promise(function (resolve) {
    const img = new Image();
    img.decoding = 'async';
    if ('fetchPriority' in img) img.fetchPriority = 'low';
    img.onload = img.onerror = resolve;
    img.src = url;
  });
}

function preloadAll(urls, concurrency) {
  const queue = urls.slice();
  const worker = function () {
    if (!queue.length) return Promise.resolve();
    return preloadImage(queue.shift()).then(worker);
  };
  return Promise.all(Array.from({ length: concurrency }, worker));
}

function floorsNearestFirst() {
  const idx = floorOrder.indexOf(currentFloor);
  return floorOrder.slice().sort(function (a, b) {
    return Math.abs(floorOrder.indexOf(a) - idx) - Math.abs(floorOrder.indexOf(b) - idx);
  });
}

function startBackgroundPreload() {
  const conn = navigator.connection;
  if (conn?.saveData) return;
  const floors = floorsNearestFirst();
  const floorImages = floors.map(function (f) { return floorConfig[f].image; });
  const icons = [];
  floors.forEach(function (f) { (iconUrlsByFloor[f] || []).forEach(function (u) { icons.push(u); }); });
  // 大きいフロア画像を先に1枚ずつ、そのあとでアイコンを3並列で読む
  void preloadAll(floorImages, 1).then(function () { return preloadAll(icons, 3); });
}

function whenIdle(fn) {
  return window.requestIdleCallback ? window.requestIdleCallback(fn) : setTimeout(fn, 500);
}
function schedulePreload() {
  void Promise.all(pinLoads).then(function () { whenIdle(startBackgroundPreload); });
}
if (document.readyState === 'complete') {
  schedulePreload();
} else {
  window.addEventListener('load', schedulePreload);
}

// Googleマップ風のフロア切り替えスライダー(右上に配置)
// ※STUDIO埋め込み時、ボックスの高さが実際のマップより低いと右下は
//   見切れてクリックできなくなることがあるため、常に見える右上にしている
const FloorSwitcherControl = L.Control.extend({
  options: { position: 'topright' },
  onAdd: function () {
    const container = L.DomUtil.create('div', 'floor-switcher');
    L.DomEvent.disableClickPropagation(container);
    L.DomEvent.disableScrollPropagation(container);

    floorOrder.forEach(function (floor) {
      const btn = L.DomUtil.create('button', '', container);
      btn.type = 'button';
      btn.textContent = floor.replace('階', 'F');
      btn.dataset.floor = floor;
      L.DomEvent.on(btn, 'click', function () {
        setFloor(floor);
        fitToWholeMap();
        setMenuOpen(true);
      });
    });

    this._container = container;
    return container;
  }
});

const switcherControl = new FloorSwitcherControl();
map.addControl(switcherControl);

// ズームを初期表示(マップ全体表示)に戻すボタン。ズームボタンの下に並べる
const ResetViewControl = L.Control.extend({
  options: { position: 'topleft' },
  onAdd: function () {
    const container = L.DomUtil.create('div', 'leaflet-bar reset-view-control');
    L.DomEvent.disableClickPropagation(container);

    const btn = L.DomUtil.create('a', '', container);
    btn.href = '#';
    btn.title = I18N.resetTitle || 'Reset view';
    btn.setAttribute('role', 'button');
    btn.setAttribute('aria-label', I18N.resetTitle || 'Reset view');
    btn.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
      '<path d="M4 11.5L12 4l8 7.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<path d="M6 10v9a1 1 0 0 0 1 1h3v-6h4v6h3a1 1 0 0 0 1-1v-9" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
      '</svg>';
    L.DomEvent.on(btn, 'click', function (e) {
      L.DomEvent.preventDefault(e);
      resetView();
    });

    return container;
  }
});
map.addControl(new ResetViewControl());

// 企画番号と企画名の一覧を出し入れできるサイドメニュー。
// 項目を押すとメニューを閉じて、該当フロアに切り替えたうえでその企画のポップアップを開く。
const menuPanel = L.DomUtil.create('aside', 'map-menu', map.getContainer());
menuPanel.setAttribute('aria-label', I18N.menuTitle || 'Project list');
menuPanel.setAttribute('aria-hidden', 'true');
L.DomEvent.disableClickPropagation(menuPanel);
L.DomEvent.disableScrollPropagation(menuPanel);

const menuHeader = L.DomUtil.create('div', 'map-menu-header', menuPanel);
const menuTitleEl = L.DomUtil.create('span', 'map-menu-title', menuHeader);
menuTitleEl.textContent = I18N.menuTitle || 'Project list';
const menuCloseBtn = L.DomUtil.create('button', 'map-menu-close', menuHeader);
menuCloseBtn.type = 'button';
menuCloseBtn.setAttribute('aria-label', I18N.menuClose || 'Close');
menuCloseBtn.textContent = '×';
const menuBody = L.DomUtil.create('div', 'map-menu-body', menuPanel);

function isMenuOpen() { return menuPanel.classList.contains('open'); }
function setMenuOpen(open) {
  menuPanel.classList.toggle('open', open);
  menuPanel.setAttribute('aria-hidden', open ? 'false' : 'true');
  if (menuToggleBtn) menuToggleBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
  if (open) {
    // 開くたびに、いま表示している階を先頭にして一覧を作り直す(階の切り替えに合わせるため)
    buildMenu();
    menuBody.scrollTop = 0;
  }
}

function openEntry(entry) {
  setMenuOpen(false);
  if (entry.floor !== currentFloor) setFloor(entry.floor);
  fitToWholeMap();
  map.setView(entry.marker.getLatLng(), initialZoom, { animate: false });
  entry.marker.openPopup();
  scrollPopupToEntry(entry);
}

// 複数企画をまとめたポップアップは中身がスクロールになるため、選んだ企画が先頭に見えるよう合わせる。
function scrollPopupToEntry(entry) {
  const popup = entry.marker.getPopup();
  const root = popup && popup.getElement();
  if (!root) return;
  const content = root.querySelector('.leaflet-popup-content');
  const item = content && content.querySelector('[data-idx="' + entry.index + '"]');
  if (!item) return;
  content.querySelectorAll('.popup-item-selected').forEach(function (el) { el.classList.remove('popup-item-selected'); });
  if (content.querySelectorAll('.popup-item').length > 1) item.classList.add('popup-item-selected');
  content.scrollTop += item.getBoundingClientRect().top - content.getBoundingClientRect().top;
}

function buildMenu() {
  menuBody.textContent = '';
  const floorsInMenu = ['1階', '2階', '3階'];
  floorsInMenu.sort(function (a, b) {
    return (a === currentFloor ? -1 : 0) - (b === currentFloor ? -1 : 0);
  });
  floorsInMenu.forEach(function (floor) {
    // 複数の教室に同じ企画のピンがある場合(例: 6教室ぶんの同一プレゼン)は1件にまとめ、最初のピンを開く。
    const seen = new Set();
    const entries = menuEntries
      .filter(function (e) {
        if (e.floor !== floor) return false;
        const key = [e.n, e.name, e.group].join('|');
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort(function (a, b) { return (Number(a.n) || 0) - (Number(b.n) || 0); });
    if (!entries.length) return;
    const section = L.DomUtil.create('section', 'map-menu-section', menuBody);
    section.dataset.floor = floor;
    const h = L.DomUtil.create('h2', '', section);
    h.textContent = I18N.floorLabels ? I18N.floorLabels[floor] : floor;
    entries.forEach(function (e) {
      const btn = L.DomUtil.create('button', 'map-menu-item', section);
      btn.type = 'button';
      const num = L.DomUtil.create('span', 'badge sm', btn);
      num.style.background = e.color;
      num.textContent = e.n;
      const text = L.DomUtil.create('span', 'map-menu-text', btn);
      const nameEl = L.DomUtil.create('span', 'map-menu-name', text);
      nameEl.textContent = e.name;
      if (e.group) {
        const groupEl = L.DomUtil.create('span', 'map-menu-group', text);
        groupEl.textContent = e.group;
      }
      L.DomEvent.on(btn, 'click', function () { openEntry(e); });
    });
  });
}

let menuToggleBtn = null;
const MenuToggleControl = L.Control.extend({
  options: { position: 'topleft' },
  onAdd: function () {
    const container = L.DomUtil.create('div', 'leaflet-bar menu-toggle-control');
    L.DomEvent.disableClickPropagation(container);
    const btn = L.DomUtil.create('a', '', container);
    btn.href = '#';
    btn.title = I18N.menuTitle || 'Project list';
    btn.setAttribute('role', 'button');
    btn.setAttribute('aria-label', I18N.menuTitle || 'Project list');
    btn.setAttribute('aria-expanded', 'false');
    btn.textContent = I18N.menuButton || 'List';
    L.DomEvent.on(btn, 'click', function (e) {
      L.DomEvent.preventDefault(e);
      setMenuOpen(!isMenuOpen());
    });
    menuToggleBtn = btn;
    return container;
  }
});
map.addControl(new MenuToggleControl());
L.DomEvent.on(menuCloseBtn, 'click', function () { setMenuOpen(false); });
document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape' && isMenuOpen()) setMenuOpen(false);
});
// 起動時(ピン読み込み後)にメニューを表示する。階の切り替え時にも、切替ボタン側で開く。
void Promise.all(pinLoads).then(function () {
  setMenuOpen(true);
});

function updateSwitcherUI() {
  if (!switcherControl._container) return;
  switcherControl._container.querySelectorAll('button').forEach(function (btn) {
    btn.classList.toggle('active', btn.dataset.floor === currentFloor);
  });
}

setFloor(getInitialFloor());

document.addEventListener('click', function (e) {
  const a = e.target.closest('a.popup-link');
  if (!a) return;
  e.preventDefault();
  const url = a.getAttribute('data-url');
  try {
    if (window.top && window.top !== window) {
      window.top.location.href = url;
    } else {
      window.location.href = url;
    }
  } catch {
    window.location.href = url;
  }
}, { passive: false });

// STUDIO埋め込み用: iframeの外側に実際のコンテンツ高さを伝えて、
// 埋め込み側でiframeの高さを合わせてもらう
function postHeightToParent() {
  if (window.parent === window) return;
  requestAnimationFrame(() => {
    const height = document.documentElement.scrollHeight;
    // 埋め込み先(STUDIOの各公開ドメイン)を事前に特定できないため target origin は '*' を使用。
    // 送信内容はページの高さ(数値)のみで機密情報は含まない。
    window.parent.postMessage({ type: 'mif-maps-resize', height: height }, '*'); // NOSONAR
  });
}
window.addEventListener('load', postHeightToParent);
window.addEventListener('resize', postHeightToParent);
