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
// 画像サイズは去年の会場写真(image/map/floorX_2.png)の実寸に合わせている。
// ※現時点では校舎レイアウトの参考として去年の写真を仮で流用しているだけで、
//   今年の企画配置(ピン)はまだ確定していないため map-pins-*.json は空。
const floorOrder = ['3階', '2階', '1階'];
const floorConfig = {
  '3階': { image: `${imageBase}floor3_2.png`, json: `${dataBase}map-pins-floor3.json`, width: 2127, height: 1385 },
  '2階': { image: `${imageBase}floor2_2.png`, json: `${dataBase}map-pins-floor2.json`, width: 4126, height: 2740 },
  '1階': { image: `${imageBase}floor1_2.png`, json: `${dataBase}map-pins-floor1.json`, width: 5270, height: 3504 }
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
  map.setView(initialCenter, initialZoom, { animate: false });

  // パン可能範囲。広すぎるとズームイン時に画像の外側の余白まで延々とドラッグできてしまうため、
  // 画像からはみ出す余白は少しだけ(1割程度)に絞る。
  const boundsPadding = cfg.width * 0.1;
  map.setMaxBounds([[-boundsPadding, -boundsPadding], [cfg.height + boundsPadding, cfg.width + boundsPadding]]);
}

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
    const url  = pages[i]    || '';

    let itemHtml = '<div style="display:flex; gap:10px; align-items:flex-start; margin-bottom:14px; padding-bottom:14px; border-bottom:1px solid #ddd;">';

    if (icon) {
      itemHtml += `<img src="${icon}" alt="${grp}" style="width:50px; height:50px; border-radius:50%;">`;
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

  return `<div style="max-height:340px; overflow-y:auto; width:300px;">${items.join('')}</div>`;
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
      maxWidth: 320, autoPan: false,
      offset: data.popupDirection === 'top' ? [0, -50] : [0, 10],
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
}

function loadMarkerData(floor, data) {
  if (!Array.isArray(data)) {
    throw new Error('JSONのトップレベルが配列ではありません');
  }
  for (let i = 0; i < data.length; i++) {
    // データ内の "floor" 値は当てにせず、読み込んだファイルに対応する階を使う
    addMarkerFromJson(data[i], floor);
  }
}

floorOrder.forEach(function (floor) {
  fetch(floorConfig[floor].json)
    .then(function (res) { return res.json(); })
    .then(function (data) { loadMarkerData(floor, data); })
    .catch(function () {
      // ピンデータは今年まだ確定していないため、取得・読込に失敗しても地図自体は表示を続ける
      console.error('企画ピンデータの読み込みに失敗しました:', floor);
    });
});

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
