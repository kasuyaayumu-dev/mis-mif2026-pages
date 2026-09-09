// data-url・表示文言は各ページのTT_I18N(グローバル)から受け取る
const I18N = window.TT_I18N || {};

    const ROW_MIN = 10; // 1行あたりの分数

    // --row-h はメディアクエリで幅に応じて変わるため、都度CSS変数から実際の値を読む
    function getRowH() {
      const v = getComputedStyle(document.documentElement).getPropertyValue('--row-h');
      return parseFloat(v) || 22;
    }

    function toMinutes(t) {
      const [h, m] = t.split(':').map(Number);
      return h * 60 + m;
    }

    // テスト用: ?now=HH:MM&day=day1 で任意の現在時刻を再現できる(本番では未指定でOK)
    function getDebugOverride() {
      const params = new URLSearchParams(location.search);
      const now = params.get('now');
      const day = params.get('day');
      if (!now) return null;
      return { now, day };
    }

    function labelText(label) {
      return Array.isArray(label) ? label.join(' ') : label;
    }

    function leafColumns(columns) {
      const leaves = [];
      columns.forEach(col => {
        if (col.children) {
          col.children.forEach(c => leaves.push(Object.assign({}, c, {
            parentKey: col.key,
            venueLabel: labelText(col.label) + ' ' + labelText(c.label)
          })));
        } else {
          leaves.push(Object.assign({}, col, { venueLabel: labelText(col.label) }));
        }
      });
      return leaves;
    }

    function buildOccupancy(leaves, events, startMin, rows) {
      const occ = {};
      leaves.forEach(l => { occ[l.key] = new Array(rows).fill(null); });

      events.forEach(ev => {
        const colIdxs = ev.columns.map(k => leaves.findIndex(l => l.key === k));
        if (colIdxs.some(i => i === -1)) return;
        const startRow = (toMinutes(ev.start) - startMin) / ROW_MIN;
        const span = (toMinutes(ev.end) - toMinutes(ev.start)) / ROW_MIN;
        if (startRow < 0 || span <= 0) return;

        for (let ro = 0; ro < span; ro++) {
          for (let co = 0; co < colIdxs.length; co++) {
            const key = leaves[colIdxs[co]].key;
            const row = startRow + ro;
            if (row >= rows) continue;
            if (ro === 0 && co === 0) {
              occ[key][row] = { event: ev, span, colSpan: colIdxs.length };
            } else {
              occ[key][row] = 'skip';
            }
          }
        }
      });
      return occ;
    }

    function renderBoard(day, nowInfo) {
      const startMin = toMinutes(day.startTime);
      const endMin = toMinutes(day.endTime);
      const rows = (endMin - startMin) / ROW_MIN;
      const leaves = leafColumns(day.columns);
      const occ = buildOccupancy(leaves, day.events, startMin, rows);

      const board = document.createElement('div');
      board.className = 'board theme-' + day.theme;

      const title = document.createElement('div');
      title.className = 'board-title';
      title.textContent = day.title;
      board.appendChild(title);

      const subtitle = document.createElement('div');
      subtitle.className = 'board-subtitle';
      subtitle.textContent = day.subtitle;
      board.appendChild(subtitle);

      const wrap = document.createElement('div');
      wrap.className = 'grid-wrap';

      const table = document.createElement('table');
      table.className = 'grid';

      // colgroup: hour, minute, + leaves
      const colgroup = document.createElement('colgroup');
      const widths = [8, 7]; // hour, minute (%)
      const remain = 100 - widths[0] - widths[1];
      const each = remain / leaves.length;
      widths.push(...leaves.map(() => each));
      widths.forEach(w => {
        const c = document.createElement('col');
        c.style.width = w + '%';
        colgroup.appendChild(c);
      });
      table.appendChild(colgroup);

      // thead
      const thead = document.createElement('thead');
      const trHead1 = document.createElement('tr');
      const timeTh = document.createElement('th');
      timeTh.colSpan = 2;
      timeTh.rowSpan = 2;
      timeTh.textContent = 'TIME';
      trHead1.appendChild(timeTh);

      const trHead2 = document.createElement('tr');

      day.columns.forEach(col => {
        if (col.children) {
          const th = document.createElement('th');
          th.colSpan = col.children.length;
          th.textContent = col.label;
          trHead1.appendChild(th);
          col.children.forEach(c => {
            const th2 = document.createElement('th');
            th2.textContent = c.label;
            trHead2.appendChild(th2);
          });
        } else {
          const th = document.createElement('th');
          th.rowSpan = 2;
          th.innerHTML = Array.isArray(col.label) ? col.label.join('<br>') : col.label;
          trHead1.appendChild(th);
        }
      });

      thead.appendChild(trHead1);
      thead.appendChild(trHead2);
      table.appendChild(thead);

      // tbody
      const tbody = document.createElement('tbody');
      const startHour = Math.floor(startMin / 60);

      for (let r = 0; r < rows; r++) {
        const tr = document.createElement('tr');
        const rowStartMin = startMin + r * ROW_MIN;
        const isPastRow = nowInfo && nowInfo.isToday && (rowStartMin + ROW_MIN) <= nowInfo.nowMin;

        if (r % 6 === 0) {
          const hourTd = document.createElement('td');
          hourTd.className = 'hour-cell';
          hourTd.rowSpan = 6;
          hourTd.textContent = startHour + Math.floor(r / 6);
          tr.appendChild(hourTd);
        }

        const minTd = document.createElement('td');
        minTd.className = 'min-cell';
        minTd.textContent = rowStartMin % 60;
        tr.appendChild(minTd);

        leaves.forEach(leaf => {
          const cell = occ[leaf.key][r];
          if (cell === 'skip') return;
          if (cell && cell.event) {
            const td = document.createElement('td');
            td.rowSpan = cell.span;
            if (cell.colSpan > 1) td.colSpan = cell.colSpan;
            td.className = 'event-cell cat-' + cell.event.category;
            const evEndMin = toMinutes(cell.event.end);
            if (nowInfo && nowInfo.isToday && evEndMin <= nowInfo.nowMin) {
              td.classList.add('is-past');
            }
            const titleEl = document.createElement('div');
            titleEl.textContent = cell.event.title;
            td.appendChild(titleEl);
            if (cell.event.category !== 'closed') {
              if (cell.event.room) {
                const roomEl = document.createElement('div');
                roomEl.className = 'room-tag';
                roomEl.textContent = cell.event.room;
                td.appendChild(roomEl);
              }
              const timeEl = document.createElement('div');
              timeEl.className = 'time-range';
              timeEl.textContent = cell.event.start + '-' + cell.event.end;
              td.appendChild(timeEl);

              td.classList.add('clickable');
              td.addEventListener('click', e => {
                e.stopPropagation();
                openPopup(cell.event, cell.event.room || leaf.venueLabel, td);
              });
            }
            tr.appendChild(td);
          } else {
            const td = document.createElement('td');
            td.className = 'empty' + (isPastRow ? ' is-past' : '');
            tr.appendChild(td);
          }
        });

        tbody.appendChild(tr);
      }

      table.appendChild(tbody);
      wrap.appendChild(table);
      board.appendChild(wrap);

      // 現在時刻ライン
      if (nowInfo && nowInfo.isToday && nowInfo.nowMin >= startMin && nowInfo.nowMin <= endMin) {
        const line = document.createElement('div');
        line.className = 'now-line';
        const h = String(Math.floor(nowInfo.nowMin / 60)).padStart(2, '0');
        const m = String(nowInfo.nowMin % 60).padStart(2, '0');
        line.dataset.time = h + ':' + m;
        wrap.appendChild(line);

        requestAnimationFrame(() => {
          const theadH = thead.getBoundingClientRect().height;
          const offsetMin = nowInfo.nowMin - startMin;
          const top = theadH + (offsetMin / ROW_MIN) * getRowH();
          line.style.top = top + 'px';
        });
      }

      return board;
    }

    let iconBase = '';

    function openPopup(event, venueLabel, anchorEl) {
      const card = document.getElementById('popupCard');
      card.innerHTML = '';

      const closeBtn = document.createElement('button');
      closeBtn.className = 'popup-close';
      closeBtn.setAttribute('aria-label', I18N.closeLabel);
      closeBtn.textContent = '×';
      closeBtn.addEventListener('click', closePopup);
      card.appendChild(closeBtn);

      const head = document.createElement('div');
      head.className = 'popup-head';

      const img = document.createElement('img');
      img.src = event.icon ? iconBase + event.icon : '';
      img.alt = event.groupName || '';
      head.appendChild(img);

      const body = document.createElement('div');
      body.style.minWidth = '0';
      body.style.flex = '1';

      const venue = document.createElement('span');
      venue.className = 'popup-venue';
      venue.textContent = venueLabel;
      body.appendChild(venue);

      const title = document.createElement('div');
      title.className = 'popup-title';
      title.textContent = event.title;
      body.appendChild(title);

      if (event.groupName) {
        const group = document.createElement('div');
        group.className = 'popup-group';
        group.textContent = event.groupName;
        body.appendChild(group);
      }

      const time = document.createElement('div');
      time.className = 'popup-time';
      time.textContent = event.start + ' - ' + event.end;
      body.appendChild(time);

      head.appendChild(body);
      card.appendChild(head);

      if (event.description) {
        const desc = document.createElement('p');
        desc.className = 'popup-desc';
        desc.textContent = event.description;
        card.appendChild(desc);
      }

      if (event.pageUrl) {
        const link = document.createElement('a');
        link.className = 'popup-link';
        link.href = event.pageUrl;
        link.textContent = I18N.learnMoreLabel;
        link.addEventListener('click', e => {
          e.preventDefault();
          const url = event.pageUrl;
          try {
            if (window.top && window.top !== window) {
              window.top.location.href = url;
            } else {
              window.location.href = url;
            }
          } catch {
            window.location.href = url;
          }
        });
        card.appendChild(link);
      }

      card.classList.remove('hidden');
      positionPopup(card, anchorEl);
    }

    // クリックしたセルの近くにポップアップを表示する(画面中央固定にしない)
    function positionPopup(card, anchorEl) {
      const rect = anchorEl.getBoundingClientRect();
      const scrollX = window.scrollX;
      const scrollY = window.scrollY;
      const viewportW = document.documentElement.clientWidth;
      const viewportH = window.innerHeight;

      const cardW = Math.min(320, viewportW - 24);
      card.style.width = cardW + 'px';

      // 横位置: セルの左端基準、画面外に出ないようclamp
      let left = rect.left + scrollX;
      left = Math.max(scrollX + 8, Math.min(left, scrollX + viewportW - cardW - 8));

      const cardH = card.offsetHeight || 200;
      const spaceBelow = (scrollY + viewportH) - (rect.bottom + scrollY);
      const showBelow = spaceBelow > cardH + 16 || rect.top < cardH + 16;

      let top;
      if (showBelow) {
        top = rect.bottom + scrollY + 10;
      } else {
        top = rect.top + scrollY - cardH - 10;
      }

      card.style.left = left + 'px';
      card.style.top = top + 'px';
    }

    function closePopup() {
      document.getElementById('popupCard').classList.add('hidden');
    }

    document.addEventListener('click', e => {
      const card = document.getElementById('popupCard');
      if (card.classList.contains('hidden')) return;
      if (card.contains(e.target) || e.target.closest('.event-cell.clickable')) return;
      closePopup();
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') closePopup();
    });
    window.addEventListener('scroll', closePopup, { passive: true });
    window.addEventListener('resize', closePopup);

    function todayString(d) {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return y + '-' + m + '-' + day;
    }

    let allDays = [];
    let currentDayId = null;
    const debug = getDebugOverride();

    function computeNowInfo(day) {
      const real = new Date();
      let isToday = todayString(real) === day.date;
      let nowMin;
      if (debug && (!debug.day || debug.day === day.id)) {
        isToday = true;
        nowMin = toMinutes(debug.now);
      } else {
        nowMin = real.getHours() * 60 + real.getMinutes();
      }
      return { isToday, nowMin };
    }

    function render() {
      const tabsEl = document.getElementById('dayTabs');
      tabsEl.innerHTML = '';
      allDays.forEach(day => {
        const btn = document.createElement('button');
        btn.className = 'tab-btn theme-' + day.theme + (day.id === currentDayId ? ' active' : '');
        btn.textContent = day.title;
        btn.addEventListener('click', () => { currentDayId = day.id; render(); });
        tabsEl.appendChild(btn);
      });

      const boardsEl = document.getElementById('boards');
      boardsEl.innerHTML = '';
      const day = allDays.find(d => d.id === currentDayId);
      if (!day) return;
      const nowInfo = computeNowInfo(day);
      boardsEl.appendChild(renderBoard(day, nowInfo));
      postHeightToParent();
    }

    // STUDIO埋め込み用: iframeの外側に実際のコンテンツ高さを伝えて、
    // 埋め込み側でiframeの高さを合わせてもらう(二重スクロール防止)
    function postHeightToParent() {
      if (window.parent === window) return;
      requestAnimationFrame(() => {
        const height = document.documentElement.scrollHeight;
        // 埋め込み先(STUDIOの各公開ドメイン)を事前に特定できないため target origin は '*' を使用。
        // 送信内容はページの高さ(数値)のみで機密情報は含まない。
        window.parent.postMessage({ type: 'mif-timetable-resize', height: height }, '*'); // NOSONAR
      });
    }

    // 幅が変わるとメディアクエリで行の高さ・文字サイズが変わるため、
    // 現在時刻ラインの位置とiframeの高さを再計算する(頻発しすぎないようdebounce)
    let resizeTimer = null;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(render, 150);
    });

    fetch(I18N.dataUrl)
      .then(res => res.json())
      .then(data => {
        iconBase = data.iconBase || '';
        allDays = data.days || [];
        currentDayId = allDays.length ? allDays[0].id : null;
        render();
        setInterval(render, 60000);
      })
      .catch(err => {
        console.error('Error loading timetable:', err);
        document.getElementById('boards').innerHTML =
          '<div style="text-align:center;color:#999;padding:40px 0;">' + I18N.loadErrorMsg + '</div>';
      });
