(() => {
  'use strict';
  const DATA_URL = './data/snapshot.json';
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const MARKET_LABELS = { CN: 'A股', HK: '港股', US: '美股' };
  const KIND_LABELS = { index: '指数', stock: '股票', etf: 'ETF', fund: '基金', macro: '宏观' };
  const STATUS_LABELS = { OK: '正常', FALLBACK: '备用源', STALE: '数据延迟', CACHED: '历史缓存', MISSING: '缺少数据' };
  const state = { snapshot: null, items: [], activeRange: '3m', colorMode: 'cn' };

  function text(tag, value, className) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    node.textContent = value == null ? '' : String(value);
    return node;
  }
  function number(value, digits = 2) {
    return typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString('zh-CN', { maximumFractionDigits: digits, minimumFractionDigits: digits }) : '—';
  }
  function pct(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
    return `${value > 0 ? '+' : ''}${value.toFixed(2)}%`;
  }
  function changeText(item, key) {
    const value = item[key];
    if (item.id === 'us10y' && typeof value === 'number' && Number.isFinite(item.close)) {
      const prior = item.close / (1 + value / 100);
      const delta = item.close - prior;
      return `${delta > 0 ? '+' : ''}${delta.toFixed(2)} pp`;
    }
    return pct(value);
  }
  function signClass(value) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value === 0) return 'neutral';
    return value > 0 ? 'positive' : 'negative';
  }
  function marketLabel(value) { return MARKET_LABELS[value] || value || '—'; }
  function dateLabel(value) { return value || '暂无日期'; }
  function stampLabel(value) {
    if (!value) return '尚无数据';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
  }
  function statusPill(status) {
    const span = text('span', STATUS_LABELS[status] || status || '未知', `status-pill ${(status || '').toLowerCase()}`);
    return span;
  }
  function makeSparkline(values) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 120 30'); svg.setAttribute('preserveAspectRatio', 'none'); svg.classList.add('sparkline');
    const valid = values.filter(v => typeof v === 'number' && Number.isFinite(v));
    if (valid.length < 2) return svg;
    const min = Math.min(...valid), max = Math.max(...valid), span = max - min || 1;
    const points = valid.map((v, i) => `${(i / (valid.length - 1)) * 118 + 1},${27 - ((v - min) / span) * 24}`).join(' ');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', `M ${points.replaceAll(' ', ' L ')}`); svg.append(path); return svg;
  }
  function groupCard(item) {
    const card = document.createElement('article'); card.className = 'market-card'; card.tabIndex = 0; card.setAttribute('role', 'button');
    card.append(text('div', item.name, 'asset-name'));
    card.append(text('div', `${marketLabel(item.market)} · ${dateLabel(item.date)} · ${STATUS_LABELS[item.status] || item.status}`, 'asset-date'));
    card.append(text('div', item.close == null ? '—' : `${number(item.close)} ${item.unit || ''}`, 'asset-value'));
    card.append(text('div', changeText(item, 'ret1'), `asset-change ${signClass(item.ret1)}`));
    const history = item.sparkline || [];
    card.append(makeSparkline(history.slice(-45)));
    card.addEventListener('click', () => openDetail(item));
    card.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openDetail(item); } });
    return card;
  }
  function renderGroup(container, title, code, items) {
    if (!items.length) return;
    const section = document.createElement('section'); section.className = 'market-group';
    const head = document.createElement('div'); head.className = 'group-head';
    const left = document.createElement('div'); left.className = 'group-title'; left.append(text('span', title)); left.append(text('span', code, 'market-code'));
    head.append(left, text('span', `${items.length} 个标的`, 'market-code'));
    const cards = document.createElement('div'); cards.className = 'market-cards';
    items.forEach(item => cards.append(groupCard(item)));
    section.append(head, cards); container.append(section);
  }
  function renderMarket() {
    const container = $('#market-groups'); container.replaceChildren();
    const indexes = state.items.filter(x => x.kind === 'index');
    $('#index-count').textContent = `${indexes.length} 个指数`;
    for (const [market, title] of [['US', '美国市场'], ['HK', '香港市场'], ['CN', '中国内地']]) {
      renderGroup(container, title, market, indexes.filter(x => x.market === market));
    }
    renderGroup(container, '宏观观察', 'MACRO', state.items.filter(x => x.kind === 'macro'));
    if (!indexes.length && !state.items.some(x => x.kind === 'macro')) {
      container.append(text('div', state.snapshot?.publication?.notice || '暂无已发布的市场数据。', 'empty-state'));
    }
  }
  function tableRow(item) {
    const tr = document.createElement('tr'); tr.tabIndex = 0;
    const nameCell = document.createElement('td'); nameCell.append(text('span', item.name, 'table-name'));
    nameCell.append(text('span', `${item.id.toUpperCase()} · ${marketLabel(item.market)}`, 'table-sub'));
    const cells = [nameCell];
    const close = document.createElement('td'); close.textContent = item.close == null ? '—' : `${number(item.close)} ${item.unit || ''}`; cells.push(close);
    for (const key of ['ret1', 'ret5', 'ret20']) {
      const td = document.createElement('td'); td.textContent = changeText(item, key); td.className = signClass(item[key]); cells.push(td);
    }
    const date = document.createElement('td'); date.textContent = dateLabel(item.date); cells.push(date);
    const status = document.createElement('td'); status.append(statusPill(item.status)); cells.push(status);
    cells.forEach(cell => tr.append(cell));
    tr.addEventListener('click', () => openDetail(item));
    tr.addEventListener('keydown', event => { if (event.key === 'Enter') openDetail(item); });
    return tr;
  }
  function renderTable(kind, bodySelector, countSelector, privateSelector) {
    const rows = state.items.filter(x => kind === 'etf' ? ['etf', 'fund'].includes(x.kind) : x.kind === kind);
    const body = $(bodySelector); body.replaceChildren();
    rows.forEach(item => body.append(tableRow(item)));
    $(countSelector).textContent = `${rows.length} ${kind === 'stock' ? '只股票' : '个 ETF / 基金'}`;
    const isPrivate = !state.snapshot?.publication?.personal_watchlist;
    $(privateSelector).classList.toggle('hidden', !(isPrivate && rows.length === 0));
    if (!rows.length && !isPrivate) body.append(emptyTableRow(kind === 'stock' ? '暂无公开的自选股票。' : '暂无公开的 ETF / 基金数据。'));
  }
  function emptyTableRow(message) {
    const tr = document.createElement('tr'), td = document.createElement('td'); td.colSpan = 7; td.append(text('div', message, 'empty-state')); tr.append(td); return tr;
  }
  function renderOverviewWatchlist() {
    const target = $('#overview-watchlist'); target.replaceChildren();
    const rows = state.items.filter(x => ['stock', 'etf', 'fund'].includes(x.kind)).slice(0, 8);
    if (!rows.length) { target.append(text('div', '个人自选列表默认不公开。确认公开授权后，可在此查看关注资产。', 'empty-state')); return; }
    rows.forEach(item => {
      const card = document.createElement('article'); card.className = 'mini-watch-card'; card.tabIndex = 0;
      const line = document.createElement('div'); line.className = 'mini-line'; line.append(text('strong', item.name), text('small', marketLabel(item.market)));
      card.append(line, text('div', item.close == null ? '—' : number(item.close), 'mini-price'), text('small', `${changeText(item, 'ret1')} · ${dateLabel(item.date)} · ${STATUS_LABELS[item.status] || item.status}`));
      card.addEventListener('click', () => openDetail(item)); target.append(card);
    });
  }
  function renderReport() {
    const all = state.items;
    const fresh = all.filter(x => x.freshness === 'CURRENT' || (x.freshness === 'UNKNOWN' && ['OK', 'FALLBACK'].includes(x.status)));
    const attention = all.filter(x => ['STALE', 'CACHED', 'MISSING'].includes(x.status) || x.freshness === 'STALE');
    $('#summary-total').textContent = String(all.length);
    $('#summary-total-note').textContent = `${Object.values(state.snapshot?.counts || {}).reduce((a, b) => a + b, 0)} 个已发布数据项`;
    $('#summary-current').textContent = `${fresh.length}/${all.length || 0}`;
    $('#summary-attention').textContent = String(attention.length);
    $('#summary-markets').textContent = all.some(x => x.market === 'CN') && all.some(x => x.market === 'US') ? '全球' : '市场';
    $('#report-date').textContent = stampLabel(state.snapshot?.generated_at);
    $('#report-title').textContent = all.length ? `市场快照 · ${dateLabel(state.snapshot.generated_at?.slice(0, 10))}` : '等待首份市场快照';
    const indexes = all.filter(x => x.kind === 'index');
    const strongest = [...indexes].filter(x => typeof x.ret1 === 'number').sort((a, b) => b.ret1 - a.ret1)[0];
    const weakest = [...indexes].filter(x => typeof x.ret1 === 'number').sort((a, b) => a.ret1 - b.ret1)[0];
    const intro = all.length ? `当前公开展示 ${all.length} 个标的，其中 ${fresh.length} 个达到当前数据日期要求，${attention.length} 个需要留意。不同市场按各自交易日计算，不代表同一时点的同步行情。` : (state.snapshot?.publication?.notice || '等待行情采集及公开发布授权。');
    $('#report-intro').textContent = intro;
    const highlights = $('#report-highlights'); highlights.replaceChildren();
    [["当日相对强势指数", strongest], ["当日相对弱势指数", weakest]].forEach(([label, item]) => {
      const row = document.createElement('div'); row.className = 'highlight-row';
      row.append(text('span', label)); row.append(text('strong', item ? `${item.name} ${pct(item.ret1)}` : '暂无可用数据', item ? signClass(item.ret1) : 'neutral')); highlights.append(row);
    });
    const quality = $('#quality-list'); quality.replaceChildren();
    const statuses = ['OK', 'FALLBACK', 'STALE', 'CACHED', 'MISSING'];
    statuses.forEach(status => {
      const count = all.filter(x => x.status === status).length;
      const row = document.createElement('div'); row.className = 'quality-row'; row.append(text('span', STATUS_LABELS[status])); row.append(text('span', String(count))); quality.append(row);
    });
    $('#coverage-note').textContent = all.length ? `公开 ${all.length} 个标的 · 数据日期独立` : '尚未发布行情数据';
  }
  async function openDetail(item) {
    const dialog = $('#detail-dialog');
    $('#detail-market').textContent = `${marketLabel(item.market)} / ${KIND_LABELS[item.kind] || item.kind}`;
    $('#detail-name').textContent = item.name;
    $('#detail-meta').textContent = `数据日期 ${dateLabel(item.date)} · ${STATUS_LABELS[item.status] || item.status}`;
    $('#detail-close').textContent = item.close == null ? '—' : `${number(item.close)} ${item.unit || ''}`;
    const change = $('#detail-change'); change.textContent = changeText(item, 'ret1'); change.className = signClass(item.ret1);
    const metrics = $('#detail-metrics'); metrics.replaceChildren();
    const detailRows = [["近5日变化", changeText(item, 'ret5')], ["近20日变化", changeText(item, 'ret20')], ["近60日变化", changeText(item, 'ret60')], ["距历史高点", item.kind === 'macro' ? '—' : pct(item.drawdown)]];
    if (typeof item.volume_ratio === 'number') detailRows.push(["成交量比值", `${item.volume_ratio.toFixed(2)} 倍`]);
    detailRows.forEach(([label, value]) => {
      const cell = document.createElement('div'); cell.className = 'detail-metric'; cell.append(text('small', label), text('strong', value)); metrics.append(cell);
    });
    $('#detail-chart').replaceChildren(text('div', '读取历史走势…', 'empty-state'));
    dialog.showModal();
    let history = [];
    if (item.history_url) {
      try {
        const response = await fetch(`./${item.history_url}`, { cache: 'no-store' });
        if (response.ok) history = await response.json();
      } catch (_) { /* History is optional; keep the current snapshot usable. */ }
    }
    item._history = Array.isArray(history) ? history : [];
    renderDetailChart(item._history, state.activeRange);
  }
  function renderDetailChart(history, range) {
    const container = $('#detail-chart'); container.replaceChildren();
    const days = { '1m': 21, '3m': 63, '6m': 126, '1y': 260 }[range] || 63;
    const rows = history.slice(-days);
    if (rows.length < 2) { container.append(text('div', '暂无足够的历史数据绘制走势图。', 'empty-state')); return; }
    const values = rows.map(x => Number(x.close)).filter(Number.isFinite);
    if (values.length < 2) { container.append(text('div', '历史数据格式不完整。', 'empty-state')); return; }
    const width = 620, height = 180, pad = 12, min = Math.min(...values), max = Math.max(...values), span = max - min || 1;
    const points = values.map((v, i) => [pad + i / (values.length - 1) * (width - pad * 2), height - pad - (v - min) / span * (height - pad * 2)]);
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', `0 0 ${width} ${height}`); svg.classList.add('detail-chart-svg');
    for (let i = 1; i <= 3; i++) { const line = document.createElementNS(svg.namespaceURI, 'line'); const y = i * height / 4; line.setAttribute('x1', '0'); line.setAttribute('x2', String(width)); line.setAttribute('y1', String(y)); line.setAttribute('y2', String(y)); line.setAttribute('class', 'chart-grid'); svg.append(line); }
    const defs = document.createElementNS(svg.namespaceURI, 'defs'); const gradient = document.createElementNS(svg.namespaceURI, 'linearGradient'); gradient.id = 'chartFill'; gradient.setAttribute('x1', '0'); gradient.setAttribute('x2', '0'); gradient.setAttribute('y1', '0'); gradient.setAttribute('y2', '1');
    const s1 = document.createElementNS(svg.namespaceURI, 'stop'); s1.setAttribute('offset', '0%'); s1.setAttribute('stop-color', '#c98748'); s1.setAttribute('stop-opacity', '.24');
    const s2 = document.createElementNS(svg.namespaceURI, 'stop'); s2.setAttribute('offset', '100%'); s2.setAttribute('stop-color', '#c98748'); s2.setAttribute('stop-opacity', '0'); gradient.append(s1, s2); defs.append(gradient); svg.append(defs);
    const pathData = points.map((p, i) => `${i ? 'L' : 'M'} ${p[0].toFixed(2)} ${p[1].toFixed(2)}`).join(' ');
    const area = document.createElementNS(svg.namespaceURI, 'path'); area.setAttribute('d', `${pathData} L ${points.at(-1)[0]} ${height} L ${points[0][0]} ${height} Z`); area.setAttribute('class', 'chart-area'); svg.append(area);
    const path = document.createElementNS(svg.namespaceURI, 'path'); path.setAttribute('d', pathData); path.setAttribute('class', 'chart-line'); svg.append(path);
    container.append(svg);
    const labels = document.createElement('div'); labels.className = 'chart-labels'; labels.style.cssText = 'display:flex;justify-content:space-between;color:#8a96a5;font-size:9px;margin-top:3px';
    labels.append(text('span', rows[0].date), text('span', rows.at(-1).date)); container.append(labels);
  }
  function applyColorMode() {
    document.body.classList.toggle('alt-colors', state.colorMode === 'western');
    $('#color-mode').textContent = state.colorMode === 'cn' ? '红涨绿跌' : '绿涨红跌';
  }
  function showView(name) {
    $$('.nav-link').forEach(button => button.classList.toggle('active', button.dataset.view === name));
    $$('.view-panel').forEach(panel => panel.classList.toggle('active', panel.id === `view-${name}`));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function render() {
    const snap = state.snapshot || {};
    state.items = Array.isArray(snap.items) ? snap.items : [];
    const pub = snap.publication || {};
    const notice = $('#publication-notice');
    if (!pub.market_data) { notice.classList.remove('hidden'); $('#publication-notice-text').textContent = pub.notice || '公开行情数据尚未启用。'; }
    else notice.classList.add('hidden');
    $('#generated-at').textContent = stampLabel(snap.generated_at);
    $('#update-label').textContent = snap.generated_at ? '快照已生成' : '等待数据';
    $('.update-indicator').classList.toggle('ready', Boolean(snap.generated_at));
    renderMarket(); renderTable('stock', '#stock-rows', '#stock-count', '#stock-private'); renderTable('etf', '#etf-rows', '#etf-count', '#etf-private');
    renderOverviewWatchlist(); renderReport();
  }
  async function loadData() {
    $('#refresh-data').classList.add('loading');
    try {
      const response = await fetch(DATA_URL, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      state.snapshot = await response.json(); render();
    } catch (error) {
      $('#market-groups').replaceChildren(text('div', `无法读取行情数据：${error.message}。请稍后刷新。`, 'empty-state'));
      $('#generated-at').textContent = '数据读取失败';
    } finally { $('#refresh-data').classList.remove('loading'); }
  }

  $$('.nav-link').forEach(button => button.addEventListener('click', () => showView(button.dataset.view)));
  $$('[data-go]').forEach(button => button.addEventListener('click', () => showView(button.dataset.go)));
  $('#refresh-data').addEventListener('click', loadData);
  $('#color-mode').addEventListener('click', () => { state.colorMode = state.colorMode === 'cn' ? 'western' : 'cn'; try { localStorage.setItem('mw-color-mode', state.colorMode); } catch (_) {} applyColorMode(); });
  $('#close-detail').addEventListener('click', () => $('#detail-dialog').close());
  $('#detail-dialog').addEventListener('click', event => { if (event.target === $('#detail-dialog')) $('#detail-dialog').close(); });
  $$('#range-switch button').forEach(button => button.addEventListener('click', () => {
    state.activeRange = button.dataset.range; $$('#range-switch button').forEach(x => x.classList.toggle('active', x === button));
    const current = $('#detail-name').textContent; const item = state.items.find(x => x.name === current); if (item) renderDetailChart(item._history || [], state.activeRange);
  }));
  $('#stock-search').addEventListener('input', filterStocks);
  $('#stock-market').addEventListener('change', filterStocks);
  function filterStocks() {
    const q = $('#stock-search').value.trim().toLowerCase(), market = $('#stock-market').value;
    $$('#stock-rows tr').forEach(row => {
      const item = state.items.find(x => x.name === row.querySelector('.table-name')?.textContent);
      const match = item && (!q || `${item.name} ${item.id}`.toLowerCase().includes(q)) && (market === 'all' || item.market === market);
      row.classList.toggle('hidden', !match);
    });
  }
  try { state.colorMode = localStorage.getItem('mw-color-mode') || 'cn'; } catch (_) { state.colorMode = 'cn'; } applyColorMode(); loadData();
})();
