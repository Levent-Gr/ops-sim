// ops_sim — Author: Levent Görgü (github.com/Levent-Gr) — (c) 2026
import Chart from 'chart.js/auto';
import { historyStore } from './state.js';
import { STORES, idbGetAll, idbPut } from './db.js';
import { t } from './i18n.js';
import { safe } from './utils.js';
import { findArchivedChargeForDelivery, getPredictedFinalPalet } from './charge.js';
import { openDeliveryModal } from './history.js';
import { confirmDialog, alertDialog, showToast } from './dialog.js';

let _statsChart = null;
let _allRows = [];
let _period = 'all';        // all | 7 | 30 | month
let _search = '';
let _selectedFolder = null; // drill modunda klasör adı
let _sortKey = 'date';      // date | name | folder | delta
let _sortDir = 'desc';
let _editingId = null;
let _editGroups = false;    // "Grupları düzenle" paneli açık mı

function destroyStatsChart() {
  if (_statsChart) { try { _statsChart.destroy(); } catch {} _statsChart = null; }
}

// TES kayıtlarından, gerçekleşen palet girilmiş satırları üretir.
function buildRows() {
  const all = historyStore.histCache || [];
  const tesItems = all.filter(h => h._type !== 'grup_archive' && h._type !== 'charge_archive');
  const rows = [];
  for (const tes of tesItems) {
    if (tes.actualPalet == null || tes.actualPalet === '') continue;
    const actual = Number(tes.actualPalet);
    if (isNaN(actual)) continue;
    const simPalet = (tes.palets || 0) + (tes.existingPalet || 0);
    const arch = findArchivedChargeForDelivery(tes.id, tes);
    const chargePred = arch ? getPredictedFinalPalet(arch, tes) : null;
    const toolPred = chargePred != null ? chargePred : simPalet;
    const err = actual - toolPred;
    const absErr = Math.abs(err);
    const pct = actual > 0 ? Math.round(absErr / actual * 100) : 0;
    rows.push({
      id: tes.id, name: tes.deliveryName || tes.name || '—',
      folder: tes.statFolder || t('unclassified'),
      date: (tes.date || '').split(' ')[0] || '—',
      ts: tes._ts || 0,
      sim: simPalet, charge: chargePred, actual, toolPred, err, absErr, pct,
      rec: tes
    });
  }
  return rows;
}

function applyPeriodSearch(rows) {
  const now = Date.now();
  let out = rows;
  if (_period === '7') out = out.filter(r => r.ts >= now - 7 * 864e5);
  else if (_period === '30') out = out.filter(r => r.ts >= now - 30 * 864e5);
  else if (_period === 'month') {
    const d = new Date();
    out = out.filter(r => { const rd = new Date(r.ts); return rd.getFullYear() === d.getFullYear() && rd.getMonth() === d.getMonth(); });
  }
  if (_search) {
    const q = _search.toLowerCase();
    out = out.filter(r => r.name.toLowerCase().includes(q) || r.folder.toLowerCase().includes(q));
  }
  return out;
}

function groupByFolder(rows) {
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.folder)) map.set(r.folder, []);
    map.get(r.folder).push(r);
  }
  const groups = [];
  for (const [name, list] of map) {
    const n = list.length;
    const avgPred = list.reduce((a, r) => a + r.toolPred, 0) / n;
    const avgActual = list.reduce((a, r) => a + r.actual, 0) / n;
    const mae = Math.round(list.reduce((a, r) => a + r.absErr, 0) / n * 10) / 10;
    const mape = Math.round(list.reduce((a, r) => a + r.pct, 0) / n);
    const hit = Math.round(list.filter(r => r.absErr <= 1).length / n * 100);
    groups.push({ name, n, avgPred: Math.round(avgPred * 10) / 10, avgActual: Math.round(avgActual * 10) / 10, mae, mape, hit, ts: Math.max(...list.map(r => r.ts)) });
  }
  groups.sort((a, b) => a.name.localeCompare(b.name, 'tr'));
  return groups;
}

function kpiOf(rows) {
  const n = rows.length;
  if (!n) return { n: 0, mae: 0, mape: 0, hit: 0 };
  return {
    n,
    mae: Math.round(rows.reduce((a, r) => a + r.absErr, 0) / n * 10) / 10,
    mape: Math.round(rows.reduce((a, r) => a + r.pct, 0) / n),
    hit: Math.round(rows.filter(r => r.absErr <= 1).length / n * 100)
  };
}

function deltaClass(absErr, pct) {
  return absErr <= 1 ? 'stats-good' : (pct <= 15 ? 'stats-mid' : 'stats-bad');
}
function signStr(err) { return err > 0 ? '+' : (err < 0 ? '−' : '±'); }

function sortRows(rows) {
  const dir = _sortDir === 'asc' ? 1 : -1;
  const r = [...rows];
  r.sort((a, b) => {
    let av, bv;
    if (_sortKey === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
    else if (_sortKey === 'folder') { av = a.folder.toLowerCase(); bv = b.folder.toLowerCase(); }
    else if (_sortKey === 'delta') { av = a.absErr; bv = b.absErr; }
    else { av = a.ts; bv = b.ts; }
    if (av < bv) return -1 * dir;
    if (av > bv) return 1 * dir;
    return 0;
  });
  return r;
}

export async function renderStats() {
  const el = document.getElementById('statsContent');
  if (!el) return;
  destroyStatsChart();
  try {
    const all = await idbGetAll(STORES.history);
    all.sort((a, b) => (b._ts || 0) - (a._ts || 0));
    historyStore.histCache = all;
  } catch {}
  _allRows = buildRows();
  _editingId = null;
  paint();
}

function paint() {
  const el = document.getElementById('statsContent');
  if (!el) return;
  destroyStatsChart();

  if (!_allRows.length) {
    el.innerHTML = `<div class="stats-empty">${t('stats_empty')}</div>`;
    return;
  }

  const base = applyPeriodSearch(_allRows);
  const folders = groupByFolder(base);
  // Seçili klasör artık görünmüyorsa drill'den çık
  if (_selectedFolder && !folders.some(f => f.name === _selectedFolder)) _selectedFolder = null;
  const view = _selectedFolder ? base.filter(r => r.folder === _selectedFolder) : base;
  const k = kpiOf(view);

  const periodBtns = [['all', t('period_all')], ['7', t('period_7')], ['30', t('period_30')], ['month', t('period_month')]]
    .map(([v, lbl]) => `<button class="stats-period-btn ${_period === v ? 'on' : ''}" data-period="${v}">${lbl}</button>`).join('');

  const sortArrow = key => _sortKey === key ? (_sortDir === 'asc' ? ' ▲' : ' ▼') : '';

  const rowsHtml = sortRows(view).map(r => {
    const editing = r.id === _editingId;
    const actualCell = editing
      ? `<div class="stats-td stats-edit-cell">
           <input type="number" min="0" step="any" class="stats-edit-input" id="statsEdit-${safe(r.id)}" value="${r.actual}"/>
           <button class="stats-edit-save" data-save="${safe(r.id)}" title="${t('save')}">✓</button>
           <button class="stats-edit-cancel" data-cancel="${safe(r.id)}" title="${t('dlg_cancel')}">✕</button>
         </div>`
      : `<div class="stats-td stats-td-actual">${r.actual}
           <button class="stats-row-edit" data-edit="${safe(r.id)}" title="${t('edit_data')}" aria-label="${t('edit_data')}">✎</button>
           <button class="stats-row-del" data-del="${safe(r.id)}" title="${t('delete_grup')}" aria-label="${t('delete_grup')}">×</button>
         </div>`;
    return `<div class="stats-trow" data-id="${safe(r.id)}" role="button" tabindex="0">
      <div class="stats-td stats-td-name">${safe(r.name)}</div>
      <div class="stats-td stats-td-folder">${safe(r.folder)}</div>
      <div class="stats-td stats-td-date">${safe(r.date)}</div>
      <div class="stats-td">${r.sim}</div>
      <div class="stats-td">${r.charge != null ? r.charge : '—'}</div>
      ${actualCell}
      <div class="stats-td ${deltaClass(r.absErr, r.pct)}">${signStr(r.err)}${r.absErr}</div>
      <div class="stats-td ${deltaClass(r.absErr, r.pct)}">${r.pct}%</div>
    </div>`;
  }).join('');

  // Grup düzenleme: tüm gruplar (dönem filtresinden bağımsız), "Grupsuz" hariç.
  const allGroups = groupByFolder(_allRows).filter(g => g.name !== t('unclassified'));
  const grpEditPanel = _editGroups ? `
    <div class="stats-grpedit">
      <div class="stats-grpedit-head">${t('edit_groups')} <span class="stats-hint">${t('edit_groups_hint')}</span></div>
      <div class="stats-grpedit-list">
        ${allGroups.length ? allGroups.map((g, i) => `
          <div class="stats-grpedit-row">
            <input class="stats-grpedit-input" id="grpEdit-${i}" value="${safe(g.name)}" data-old="${safe(g.name)}" list="grpEditSuggest"/>
            <span class="stats-grpedit-n">${g.n}</span>
            <button class="stats-grpedit-save" data-grpsave="${i}">${t('save')}</button>
          </div>`).join('') : `<div class="stats-hint">—</div>`}
      </div>
      <datalist id="grpEditSuggest">${allGroups.map(g => `<option value="${safe(g.name)}"></option>`).join('')}</datalist>
    </div>` : '';

  el.innerHTML = `
    <div class="stats-filterbar">
      <div class="stats-period">${periodBtns}</div>
      <button class="stats-grpedit-toggle ${_editGroups ? 'on' : ''}" id="statsGrpEditBtn">${t('edit_groups')}</button>
      ${_selectedFolder ? `<button class="stats-back-btn" id="statsBack">${t('back_to_summary')}</button>` : ''}
    </div>
    ${grpEditPanel}

    <div class="stats-kpi-strip">
      <div class="stats-kpi"><div class="stats-kpi-label">${t('stats_count')}</div><div class="stats-kpi-val">${k.n}</div></div>
      <div class="stats-kpi"><div class="stats-kpi-label">${t('stats_mae')}</div><div class="stats-kpi-val">${k.mae} <span class="stats-kpi-unit">${t('palet_lbl')}</span></div></div>
      <div class="stats-kpi"><div class="stats-kpi-label">${t('stats_mape')}</div><div class="stats-kpi-val">${k.mape}<span class="stats-kpi-unit">%</span></div></div>
      <div class="stats-kpi"><div class="stats-kpi-label">${t('stats_hit')}</div><div class="stats-kpi-val">${k.hit}<span class="stats-kpi-unit">%</span></div></div>
    </div>

    <div class="stats-section-label">${_selectedFolder ? safe(_selectedFolder) + ' — ' + t('stats_trend') : t('stats_trend')}${!_selectedFolder && folders.length ? ` <span class="stats-hint">${t('chart_hint')}</span>` : ''}</div>
    <div class="stats-chart-scroll"><div class="stats-chart-inner" id="statsChartInner"><canvas id="statsTrendChart"></canvas></div></div>

    <div class="stats-section-label">${t('stats_table')}</div>
    <div class="stats-table-scroll">
      <div class="stats-table">
        <div class="stats-trow stats-thead">
          <div class="stats-td stats-td-name stats-sort" data-sort="name">${t('col_delivery')}${sortArrow('name')}</div>
          <div class="stats-td stats-td-folder stats-sort" data-sort="folder">${t('col_folder')}${sortArrow('folder')}</div>
          <div class="stats-td stats-td-date stats-sort" data-sort="date">${t('col_date')}${sortArrow('date')}</div>
          <div class="stats-td">${t('col_sim')}</div>
          <div class="stats-td">${t('col_charge')}</div>
          <div class="stats-td">${t('col_actual')}</div>
          <div class="stats-td stats-sort" data-sort="delta">${t('col_delta')}${sortArrow('delta')}</div>
          <div class="stats-td">${t('col_pct')}</div>
        </div>
        ${rowsHtml}
      </div>
    </div>`;

  wireEvents(el, view);
  drawChart(folders, view);
}

function wireEvents(el, view) {
  el.querySelectorAll('.stats-period-btn').forEach(b => b.addEventListener('click', () => { _period = b.dataset.period; _selectedFolder = null; _editingId = null; paint(); }));
  el.querySelector('#statsBack')?.addEventListener('click', () => { _selectedFolder = null; _editingId = null; paint(); });

  el.querySelectorAll('.stats-folder-card').forEach(c => {
    const go = () => { _selectedFolder = c.dataset.folder; _editingId = null; paint(); };
    c.addEventListener('click', go);
    c.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
  });

  el.querySelectorAll('.stats-sort').forEach(h => h.addEventListener('click', () => {
    const key = h.dataset.sort;
    if (_sortKey === key) _sortDir = _sortDir === 'asc' ? 'desc' : 'asc';
    else { _sortKey = key; _sortDir = key === 'name' || key === 'folder' ? 'asc' : 'desc'; }
    paint();
  }));

  // Grupları düzenle (yeniden adlandır / birleştir)
  el.querySelector('#statsGrpEditBtn')?.addEventListener('click', () => { _editGroups = !_editGroups; paint(); });
  el.querySelectorAll('[data-grpsave]').forEach(b => b.addEventListener('click', () => saveGroupRename(b.dataset.grpsave)));
  el.querySelectorAll('.stats-grpedit-input').forEach(i => i.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); saveGroupRename(i.id.replace('grpEdit-', '')); }
  }));

  // Satır içi düzenle / sil / kaydet / iptal
  el.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); _editingId = b.dataset.edit; paint(); setTimeout(() => { const i = document.getElementById('statsEdit-' + _editingId); if (i) { i.focus(); i.select(); } }, 0); }));
  el.querySelectorAll('[data-cancel]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); _editingId = null; paint(); }));
  el.querySelectorAll('[data-save]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); saveInline(b.dataset.save); }));
  el.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); deleteActual(b.dataset.del); }));
  el.querySelectorAll('.stats-edit-input').forEach(i => i.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); saveInline(i.id.replace('statsEdit-', '')); }
    else if (e.key === 'Escape') { e.preventDefault(); _editingId = null; paint(); }
  }));

  // Satıra tıkla → modal (buton/inputlar hariç)
  el.querySelectorAll('.stats-trow[data-id]').forEach(rowEl => {
    const open = e => {
      if (e && (e.target.closest('button') || e.target.closest('input'))) return;
      const r = view.find(x => x.id === rowEl.dataset.id);
      if (r) openDeliveryModal(r.rec, 'hist');
    };
    rowEl.addEventListener('click', open);
    rowEl.addEventListener('keydown', e => { if (e.key === 'Enter') { open(e); } });
  });
}

async function saveInline(id) {
  const input = document.getElementById('statsEdit-' + id);
  if (!input) return;
  const v = parseFloat((input.value || '').trim());
  if (isNaN(v) || v < 0) { await alertDialog(t('valid_total_required')); return; }
  const rec = (historyStore.histCache || []).find(h => h.id === id);
  if (!rec) return;
  rec.actualPalet = v;
  await idbPut(STORES.history, rec);
  _allRows = buildRows();
  _editingId = null;
  paint();
  showToast('✓ ' + t('saved_toast'));
}

async function deleteActual(id) {
  const rec = (historyStore.histCache || []).find(h => h.id === id);
  if (!rec) return;
  if (!(await confirmDialog(t('delete_grup') + '?'))) return;
  delete rec.actualPalet; delete rec.actualPaletAt;
  await idbPut(STORES.history, rec);
  _allRows = buildRows();
  _editingId = null;
  paint();
}

// Bir grubu toplu yeniden adlandır. Yeni ad mevcut bir grupla aynıysa → birleşir.
async function saveGroupRename(idx) {
  const input = document.getElementById('grpEdit-' + idx);
  if (!input) return;
  const oldName = input.dataset.old;
  const newName = (input.value || '').trim();
  if (!newName || newName === oldName) return;
  let changed = 0;
  for (const rec of (historyStore.histCache || [])) {
    if (rec.statFolder === oldName) { rec.statFolder = newName; await idbPut(STORES.history, rec); changed++; }
  }
  if (changed) {
    _allRows = buildRows();
    paint();
    showToast('✓ ' + t('saved_toast'));
  }
}

// ─── Grafik ──────────────────────────────────────────────────────
function chartTheme() {
  const dark = document.body.classList.contains('theme-dark');
  return {
    dark,
    gridColor: dark ? 'rgba(255,255,255,0.07)' : 'rgba(15,23,42,0.07)',
    textColor: dark ? '#9ca3af' : '#6b7280',
    predColor: dark ? '#60a5fa' : '#4a90d9',
    actualColor: dark ? '#34d399' : '#10b981',
    predRGB: dark ? '96,165,250' : '74,144,217',
    actualRGB: dark ? '52,211,153' : '16,185,129',
    mono: 'SF Mono, Menlo, monospace'
  };
}

function drawChart(folders, view) {
  const canvas = document.getElementById('statsTrendChart');
  if (!canvas) return;
  // Yatay kaydırma: nokta sayısına göre iç kapsayıcı genişliğini ayarla (20-30 klasörde gez).
  const inner = document.getElementById('statsChartInner');
  const pointCount = _selectedFolder ? view.length : folders.length;
  if (inner) {
    const scroll = inner.parentElement;
    const avail = (scroll ? scroll.clientWidth : 600) - 22;
    inner.style.width = Math.max(avail, pointCount * 78) + 'px';
  }
  const th = chartTheme();
  const ctx = canvas.getContext && canvas.getContext('2d');
  const grad = (rgb, a1, a2) => {
    if (!ctx || !ctx.createLinearGradient) return 'transparent';
    const g = ctx.createLinearGradient(0, 0, 0, canvas.height || 240);
    g.addColorStop(0, `rgba(${rgb},${a1})`); g.addColorStop(1, `rgba(${rgb},${a2})`);
    return g;
  };

  let labels, predData, actualData, devOf;
  if (_selectedFolder) {
    const rows = [...view].sort((a, b) => a.ts - b.ts);
    labels = rows.map(r => r.date);
    predData = rows.map(r => r.toolPred);
    actualData = rows.map(r => r.actual);
    devOf = i => { const r = rows[i]; return `${t('deviation')}: ${signStr(r.err)}${r.absErr} ${t('palet_lbl')} (${r.pct}%)`; };
  } else {
    labels = folders.map(f => f.name);
    predData = folders.map(f => f.avgPred);
    actualData = folders.map(f => f.avgActual);
    devOf = i => { const f = folders[i]; return `${f.n} ${t('col_delivery').toLowerCase()} · ${t('stats_hit')}: ${f.hit}%`; };
  }

  const mkDataset = (label, data, color, rgb, fill) => ({
    label, data, borderColor: color,
    backgroundColor: fill ? grad(rgb, '0.18', '0') : 'transparent',
    fill: fill ? 'origin' : false, tension: 0.35, borderWidth: 2.5,
    pointRadius: 4, pointHoverRadius: 6,
    pointBackgroundColor: th.dark ? '#0f172a' : '#fff', pointBorderColor: color, pointBorderWidth: 2
  });

  const maxV = Math.max(1, ...predData, ...actualData);
  destroyStatsChart();
  _statsChart = new Chart(canvas, {
    type: 'line',
    data: { labels, datasets: [
      mkDataset(t('series_pred'), predData, th.predColor, th.predRGB, false),
      mkDataset(t('series_actual'), actualData, th.actualColor, th.actualRGB, true)
    ] },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      layout: { padding: { top: 18, right: 14, left: 6, bottom: 4 } },
      onClick: (evt, els) => {
        if (_selectedFolder) return;
        if (els && els.length) { const lbl = labels[els[0].index]; if (lbl) { _selectedFolder = lbl; _editingId = null; paint(); } }
      },
      plugins: {
        legend: { display: true, align: 'end', labels: { color: th.textColor, usePointStyle: true, pointStyle: 'circle', boxWidth: 8, boxHeight: 8, padding: 16, font: { size: 11, family: '-apple-system, sans-serif' } } },
        tooltip: {
          backgroundColor: th.dark ? '#1f2937' : '#fff', titleColor: th.dark ? '#fff' : '#0f172a',
          bodyColor: th.dark ? '#d1d5db' : '#374151', borderColor: th.dark ? 'rgba(255,255,255,0.12)' : 'rgba(15,23,42,0.12)', borderWidth: 1,
          padding: 10, cornerRadius: 8, usePointStyle: true,
          callbacks: {
            label: c => ` ${c.dataset.label}: ${c.parsed.y} ${t('palet_lbl')}`,
            afterBody: items => devOf(items[0].dataIndex)
          }
        }
      },
      scales: {
        x: { grid: { display: false }, border: { color: th.gridColor }, ticks: { color: th.textColor, font: { size: 10, family: th.mono }, maxRotation: 0, autoSkip: true } },
        y: { grid: { color: th.gridColor }, border: { display: false }, ticks: { color: th.textColor, font: { size: 10, family: th.mono }, padding: 6 }, beginAtZero: true, suggestedMax: Math.ceil(maxV * 1.15) }
      },
      animation: { duration: 700, easing: 'easeOutCubic' }
    }
  });
}
