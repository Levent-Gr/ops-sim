import { CAT_COLORS, configStore, deliveryStore, historyStore, uiStore } from './state.js';
import { STORES, idbPut, idbDelete, idbGetAll } from './db.js';
import { t } from './i18n.js';
import { uid, nowStr, isToday, delay, safe } from './utils.js';
import { cat, vol, getCatOfPkg } from './config.js';
import { alertDialog } from './dialog.js';

// Kayıt sınırı uyarısı oturumda en fazla bir kez gösterilir (her kayıtta nag etmemek için).
let _limitWarnShown = false;

// ─── Saf çekirdek ────────────────────────────────────────────────
export function seeded(s) {
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

export function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

// Saf simülasyon çekirdeği — UI'ye dokunmaz
export function simulatePacking(packagesArr) {
  if (!Array.isArray(packagesArr) || !packagesArr.length) return null;
  if (configStore.PALET_VOL <= 0) return null;
  const counts = {};
  for (const p of packagesArr) counts[p] = (counts[p] || 0) + 1;
  const oversized = [], unknown = [];
  const items = [];
  for (const [k, v2] of Object.entries(counts)) {
    if (!configStore.DIMS[k]) { unknown.push(k); continue; }
    const h = vol(k);
    if (h > configStore.PALET_VOL) { oversized.push(k); continue; }
    for (let i = 0; i < v2; i++) items.push({ code: k, vol: h });
  }
  if (!items.length) return { paletCount: 0, totalPkg: packagesArr.length, avgPkgPerPalet: 0, oversized, unknown, sPkg: [] };
  const rng = seeded(1234);
  shuffle(items, rng);
  const totalVol = items.reduce((a, b) => a + b.vol, 0);
  const estPalets = Math.max(1, Math.ceil(totalVol / configStore.PALET_VOL));
  const sDol = new Array(estPalets).fill(0);
  const sIcerik = Array.from({ length: estPalets }, () => ({}));
  const sPkg = new Array(estPalets).fill(0);
  for (const { code, vol: h } of items) {
    const valid = [];
    for (let i = 0; i < sDol.length; i++) {
      if (sDol[i] + h > configStore.PALET_VOL) continue;
      const lim = configStore.LIMITS[code]; if (lim && lim > 0 && (sIcerik[i][code] || 0) >= lim) continue;
      valid.push(i);
    }
    if (!valid.length) { sDol.push(h); sPkg.push(1); sIcerik.push({ [code]: 1 }); continue; }
    const minD = Math.min(...valid.map(i => sDol[i]));
    const pool = [];
    for (const i of valid) {
      const diff = sDol[i] - minD;
      const w = Math.max(1, 100 - Math.floor(diff * 100 / configStore.PALET_VOL));
      for (let j = 0; j < w; j++) pool.push(i);
    }
    const sel = pool[Math.floor(rng() * pool.length)];
    sDol[sel] += h; sPkg[sel] += 1; sIcerik[sel][code] = (sIcerik[sel][code] || 0) + 1;
  }
  const paletCount = sDol.length;
  const totalPkg = items.length;
  return {
    paletCount, totalPkg,
    avgPkgPerPalet: paletCount > 0 ? Math.round(totalPkg / paletCount) : 0,
    oversized, unknown, sPkg
  };
}

// ─── UI yardımcıları ─────────────────────────────────────────────
export function setProgress(pct, label) {
  const wrap = document.getElementById('globalWrap');
  const fill = document.getElementById('globalFill');
  const lbl = document.getElementById('phaseLabel');
  wrap.classList.add('visible'); lbl.classList.add('visible');
  fill.style.width = pct + '%';
  if (label) lbl.textContent = '▸ ' + label;
}

export function addLog(html, type = '') {
  const el = document.getElementById('logList');
  const div = document.createElement('div');
  div.className = 'log-item' + (type === 'phase' ? ' phase-log' : type === 'warn' ? ' warn-log' : '');
  div.innerHTML = html;
  el.appendChild(div);
  el.scrollTop = el.scrollHeight;
  requestAnimationFrame(() => requestAnimationFrame(() => div.classList.add('in')));
}

export function countUp(elId, target, duration, suffix = '') {
  const el = document.getElementById(elId);
  if (!el) return;
  const start = performance.now();
  const isFloat = target % 1 !== 0;
  const finalText = (isFloat ? Number(target).toFixed(1) : Math.round(target)) + suffix;
  function step(now) {
    const tt = Math.min(1, (now - start) / duration);
    const ease = 1 - Math.pow(1 - tt, 3);
    el.textContent = (isFloat ? (ease * target).toFixed(1) : Math.round(ease * target)) + suffix;
    if (tt < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
  // Garanti: tab arkaplanda iken rAF throttle/durdurulursa veya
  // headless ortamda rAF hiç tetiklenmezse final değer kaybolmasın.
  setTimeout(() => { el.textContent = finalText; }, duration + 50);
}

export function showWarn(msg) {
  const w = document.getElementById('inputWarn');
  w.textContent = msg;
  w.classList.add('show');
  setTimeout(() => w.classList.remove('show'), 3000);
}

export function drawDonut(catCounts, total) {
  const entries = Object.entries(catCounts).filter(([, v]) => v > 0);
  const colorMap = {};
  [t('cat_small'), t('cat_mid'), t('cat_big'), uiStore.currentLang === 'en' ? 'Other' : 'Diğer'].forEach((k, i) => {
    colorMap[k] = ['#38bdf8', '#34d399', '#fbbf24', '#6b7280'][i];
  });
  const cx = 90, cy = 90, r = 64, sw = 18, circ = 2 * Math.PI * r;
  let angle = -Math.PI / 2, paths = '';
  entries.forEach(([k, v], idx) => {
    const pct = v / total, arc = pct * circ, startA = angle, endA = angle + pct * 2 * Math.PI;
    const x1 = cx + r * Math.cos(startA), y1 = cy + r * Math.sin(startA);
    const x2 = cx + r * Math.cos(endA), y2 = cy + r * Math.sin(endA);
    const large = pct > .5 ? 1 : 0, dashLen = arc;
    const color = colorMap[k] || '#6b7280';
    paths += `<path d="M${x1.toFixed(2)},${y1.toFixed(2)} A${r},${r} 0 ${large},1 ${x2.toFixed(2)},${y2.toFixed(2)}" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="butt" stroke-dasharray="${dashLen.toFixed(2)}" stroke-dashoffset="${dashLen.toFixed(2)}" style="animation:dashIn .9s ${idx * 180 + 300}ms cubic-bezier(.4,0,.2,1) forwards;--dash-len:${dashLen.toFixed(2)}"/>`;
    angle += pct * 2 * Math.PI;
  });
  document.getElementById('donutSvg').innerHTML = paths +
    `<text x="90" y="85" text-anchor="middle" font-size="22" font-weight="700" fill="currentColor" font-family="JetBrains Mono">${total}</text>` +
    `<text x="90" y="102" text-anchor="middle" font-size="11" fill="#6b7280" font-family="DM Sans">${t('pkg_label').toLowerCase()}</text>`;
  const leg = document.getElementById('donutLegend'); leg.innerHTML = '';
  const colorArr = ['#38bdf8', '#34d399', '#fbbf24', '#6b7280'];
  entries.forEach(([k, v], i) => {
    const d = document.createElement('div'); d.className = 'leg-row';
    d.innerHTML = `<div class="leg-dot" style="background:${colorArr[i] || '#6b7280'}"></div><div class="leg-name">${safe(k)}</div><div class="leg-pct">${v} · ${Math.round(v / total * 100)}%</div>`;
    leg.appendChild(d);
    setTimeout(() => d.classList.add('in'), i * 120 + 600);
  });
}

export function drawDonutTo(svgId, legendId, catCounts, total) {
  const entries = Object.entries(catCounts).filter(([, v]) => v > 0);
  const colorMap = {};
  [t('cat_small'), t('cat_mid'), t('cat_big'), uiStore.currentLang === 'en' ? 'Other' : 'Diğer'].forEach((k, i) => {
    colorMap[k] = ['#38bdf8', '#34d399', '#fbbf24', '#6b7280'][i];
  });
  const cx = 90, cy = 90, r = 64, sw = 18, circ = 2 * Math.PI * r;
  let angle = -Math.PI / 2, paths = '';
  entries.forEach(([k, v]) => {
    const pct = v / total, arc = pct * circ, startA = angle, endA = angle + pct * 2 * Math.PI;
    const x1 = cx + r * Math.cos(startA), y1 = cy + r * Math.sin(startA);
    const x2 = cx + r * Math.cos(endA), y2 = cy + r * Math.sin(endA);
    const large = pct > .5 ? 1 : 0, dashLen = arc;
    const color = colorMap[k] || '#6b7280';
    paths += `<path d="M${x1.toFixed(2)},${y1.toFixed(2)} A${r},${r} 0 ${large},1 ${x2.toFixed(2)},${y2.toFixed(2)}" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="butt" stroke-dasharray="${dashLen.toFixed(2)}" stroke-dashoffset="0"/>`;
    angle += pct * 2 * Math.PI;
  });
  document.getElementById(svgId).innerHTML = paths +
    `<text x="90" y="85" text-anchor="middle" font-size="22" font-weight="700" fill="currentColor" font-family="JetBrains Mono">${total}</text>` +
    `<text x="90" y="102" text-anchor="middle" font-size="11" fill="#6b7280" font-family="DM Sans">${t('pkg_label').toLowerCase()}</text>`;
  const leg = document.getElementById(legendId); leg.innerHTML = '';
  const colorArr = ['#38bdf8', '#34d399', '#fbbf24', '#6b7280'];
  entries.forEach(([k, v], i) => {
    const d = document.createElement('div'); d.className = 'leg-row';
    d.style.opacity = '1'; d.style.transform = 'none';
    d.innerHTML = `<div class="leg-dot" style="background:${colorArr[i] || '#6b7280'}"></div><div class="leg-name">${safe(k)}</div><div class="leg-pct">${v} · ${Math.round(v / total * 100)}%</div>`;
    leg.appendChild(d);
  });
}

export function drawBars(counts, total) {
  const order = configStore.ALL_ORDER.filter(p => counts[p]);
  const container = document.getElementById('barChart');
  container.innerHTML = '';
  if (!order.length || total <= 0) return;
  const max = Math.max(...order.map(p => counts[p]));
  const colorArr = ['#38bdf8', '#34d399', '#fbbf24'];
  order.forEach((p, i) => {
    const v = counts[p], pct = Math.round(v / total * 100), w = max > 0 ? Math.round(v / max * 100) : 0;
    const catK = getCatOfPkg(p);
    const color = catK === 'small' ? colorArr[0] : catK === 'mid' ? colorArr[1] : colorArr[2];
    const safeP = safe(p);
    const row = document.createElement('div'); row.className = 'bar-row';
    row.innerHTML = `<div class="bar-code">${safeP}</div><div class="bar-track"><div class="bar-fill" id="bf-${safeP}" style="background:${color}"></div></div><div class="bar-pct">${pct}%</div>`;
    container.appendChild(row);
    setTimeout(() => {
      row.classList.add('in');
      setTimeout(() => { const el = document.getElementById('bf-' + p); if (el) el.style.width = w + '%'; }, 80);
    }, i * 60 + 200);
  });
}

export function drawPalets(sDol, sPkg, sIcerik) {
  const el = document.getElementById('paletList'); el.innerHTML = '';
  sDol.forEach((d, i) => {
    const pct = Math.round(d / configStore.PALET_VOL * 100);
    const div = document.createElement('div'); div.className = 'palet-card'; div.id = 'sc' + i;
    div.innerHTML = `<div class="sh-head"><div class="sh-name">Palet #${i + 1}</div><div class="sh-pkg">${sPkg[i]} ${safe(t('pkg_label').toLowerCase())}</div></div><div class="sh-track"><div class="sh-fill" id="sf${i}"></div></div><div class="sh-pct">${pct}% dolu</div>`;
    div.onclick = () => toggleDetail(i, sIcerik[i]);
    el.appendChild(div);
    setTimeout(() => {
      div.classList.add('in');
      setTimeout(() => { document.getElementById('sf' + i).style.width = pct + '%'; }, 100);
    }, i * 90 + 200);
  });
}

export function toggleDetail(i, content) {
  const prev = uiStore.openIdx;
  if (prev >= 0) document.getElementById('sc' + prev)?.classList.remove('open');
  const det = document.getElementById('detail');
  if (prev === i) { det.classList.remove('open'); uiStore.openIdx = -1; return; }
  uiStore.openIdx = i;
  document.getElementById('sc' + i).classList.add('open');
  document.getElementById('detailTitle').textContent = `Palet #${i + 1}`;
  document.getElementById('detailTags').innerHTML = configStore.ALL_ORDER.filter(p => content[p])
    .map(p => `<span class="tag ${configStore.CAT_CLASS[p] || 'uk'}">${safe(p)} ×${content[p]}</span>`).join('');
  det.classList.add('open');
}

// ─── Geçmiş kayıt yardımcıları (history modülünden ayrı, sim sonrası kullanılır) ─────
async function loadHistory() {
  try { const all = await idbGetAll(STORES.history); all.sort((a, b) => (b._ts || 0) - (a._ts || 0)); return all; } catch { return []; }
}
export async function saveHistory(entry) {
  entry._ts = Date.now();
  const all = await loadHistory();
  let limitHit = false;
  if (all.length >= 200) {
    limitHit = true;
    console.warn('[ops-sim] Geçmiş 200 kayıt sınırına ulaştı; en eski kayıt siliniyor. Veri kaybını önlemek için Ayarlar > Yedekle ile dışa aktarın.');
    await idbDelete(STORES.history, all[all.length - 1].id);
  }
  await idbPut(STORES.history, entry);
  return limitHit;
}

async function saveDeliveryEntry(entry) {
  const existing = deliveryStore.deliveries.find(c => c.name === entry.name && c.date === entry.date);
  let limitHit = false;
  if (!existing) {
    entry._ts = Date.now();
    if (deliveryStore.deliveries.length >= 100) {
      limitHit = true;
      console.warn('[ops-sim] Teslimat 100 kayıt sınırına ulaştı; en eski kayıt siliniyor. Veri kaybını önlemek için Ayarlar > Yedekle ile dışa aktarın.');
      const old = deliveryStore.deliveries[deliveryStore.deliveries.length - 1];
      await idbDelete(STORES.deliveries, old.id);
    }
    await idbPut(STORES.deliveries, entry);
    deliveryStore.deliveries.unshift(entry);
  }
  return limitHit;
}

// ─── Recent calcs ────────────────────────────────────────────────
export async function renderRecentCalcs() {
  const el = document.getElementById('recentList');
  if (!el) return;
  const all = await idbGetAll(STORES.history);
  all.sort((a, b) => (b._ts || 0) - (a._ts || 0));
  historyStore.histCache = all;
  const todayItems = all.filter(h => h._type !== 'grup_archive' && h._type !== 'charge_archive' && isToday(h.date)).slice(0, 5);
  if (!todayItems.length) {
    el.innerHTML = `<div style="font-size:12px;color:var(--muted);font-style:italic">${t('no_recent')}</div>`;
    return;
  }
  el.innerHTML = '';
  todayItems.forEach(h => {
    const timeStr = h.date ? (h.date.split(' ')[1] || '') : '';
    const ep = h.existingPalet || 0;
    const paletDisp = ep > 0 ? `${h.palets}+${ep}` : h.palets;
    const div = document.createElement('div'); div.className = 'recent-item';
    div.innerHTML = `
      <div class="recent-badge">TES</div>
      <div class="recent-name">${safe(h.deliveryName)}</div>
      <div class="recent-time">${safe(timeStr)}</div>
      <div class="recent-palets">${paletDisp} ${t('palet_label').toLowerCase()}</div>`;
    div.addEventListener('dblclick', () => window.__openDeliveryModal(h, 'hist'));
    div.title = 'Çift tıkla → Detay';
    el.appendChild(div);
  });
}

// ─── runSim ──────────────────────────────────────────────────────
export async function runSim() {
  if (uiStore.simRunning) return;
  const titleVal = document.getElementById('titleInput').value.trim();
  if (!titleVal) {
    const row = document.getElementById('titleRow');
    row.style.borderColor = 'rgba(248,113,113,.5)';
    document.getElementById('titleInput').focus();
    showWarn(t('warn_no_title'));
    setTimeout(() => row.style.borderColor = '', 2500);
    return;
  }
  const rawLines = document.getElementById('input').value.trim().split('\n').map(s => s.trim()).filter(Boolean);
  if (!rawLines.length) { showWarn(t('warn_no_input')); return; }
  if (configStore.PALET_VOL <= 0) { showWarn(t('warn_no_vol')); return; }

  const existingPalet = Math.max(0, parseInt(document.getElementById('existingPaletInput').value) || 0);

  uiStore.simRunning = true;
  const btn = document.getElementById('runBtn');
  const spinner = document.getElementById('spinner');
  const runLabel = document.getElementById('runLabel');
  btn.disabled = true; spinner.style.display = 'block'; runLabel.textContent = t('running');
  try {
  document.getElementById('logList').innerHTML = '';
  document.getElementById('paletList').innerHTML = '';
  document.getElementById('barChart').innerHTML = '';
  document.getElementById('donutLegend').innerHTML = '';
  document.getElementById('donutSvg').innerHTML = '';
  document.getElementById('detail').classList.remove('open');
  uiStore.openIdx = -1;
  ['donutCard', 'barCard', 'paletCard', 'logCard'].forEach(id => document.getElementById(id).classList.add('scanning'));

  setProgress(5, 'Girdi okunuyor...');
  addLog(`▸ <span>${t('log_engine_start')}</span>`, 'phase');
  await delay(400);

  const counts = {};
  for (const p of rawLines) counts[p] = (counts[p] || 0) + 1;
  const known = Object.keys(counts).filter(p => configStore.DIMS[p]);
  const unknown = Object.keys(counts).filter(p => !configStore.DIMS[p]);

  setProgress(15, 'Kodlar doğrulanıyor...'); await delay(300);
  addLog(`▸ <span>${rawLines.length}</span> ${t('lines')} · <span>${Object.keys(counts).length}</span> ${t('log_unique')}`);
  if (unknown.length) addLog(`⚠ ${t('unknown_pkg')}: <span>${safe(unknown.join(', '))}</span>`, 'warn');
  known.forEach(p => addLog(`· ${safe(p)} <span>×${counts[p]}</span> · ${(vol(p) / 1e6).toFixed(2)}L`));

  setProgress(28, 'Hacim...'); addLog(`▸ <span>${t('log_vol_analysis')}</span>`, 'phase'); await delay(600);
  const items = [];
  const oversized = [];
  for (const [k, v2] of Object.entries(counts)) {
    if (!configStore.DIMS[k]) continue;
    const h = vol(k);
    if (h > configStore.PALET_VOL) { oversized.push(k); continue; }
    for (let i = 0; i < v2; i++) items.push({ code: k, vol: h });
  }
  if (oversized.length) addLog(`⚠ ${t('log_oversized')}: <span>${safe(oversized.join(', '))}</span>`, 'warn');
  if (!items.length) {
    addLog(`✗ <span>${t('log_no_valid_pkg')}</span>`, 'warn');
    setProgress(100, t('log_done'));
    document.getElementById('globalWrap').style.opacity = '0';
    document.getElementById('phaseLabel').style.opacity = '0';
    ['donutCard', 'barCard', 'paletCard', 'logCard'].forEach(id => document.getElementById(id).classList.remove('scanning'));
    document.getElementById('sideTotal').textContent = rawLines.length;
    document.getElementById('sidePalet').textContent = '0';
    document.getElementById('kpiPkg').textContent = rawLines.length;
    document.getElementById('kpiPalet').textContent = '0';
    document.getElementById('kpiAvg').textContent = '—';
    return;
  }
  const rng = seeded(1234); shuffle(items, rng);
  const totalVol = items.reduce((a, b) => a + b.vol, 0);
  const estPalets = Math.max(1, Math.ceil(totalVol / configStore.PALET_VOL));
  setProgress(38, 'Kapasite...'); await delay(400);
  addLog(`· ${t('log_total_vol')}: <span>${(totalVol / 1e9).toFixed(3)} m³</span>`);
  addLog(`· ${t('log_palet_cap')}: <span>${(configStore.PALET_VOL / 1e9).toFixed(3)} m³</span>`);
  addLog(`· ${t('log_est_palet')}: <span>${estPalets}</span>`);

  setProgress(48, 'Dağıtım...'); addLog(`▸ <span>${t('log_dist')}</span>`, 'phase'); await delay(300);
  const sDol = new Array(estPalets).fill(0);
  const sIcerik = Array.from({ length: estPalets }, () => ({}));
  const sPkg = new Array(estPalets).fill(0);
  const chunkSize = Math.ceil(items.length / 4);
  for (let chunk = 0; chunk < 4; chunk++) {
    const start = chunk * chunkSize, end = Math.min(start + chunkSize, items.length);
    for (let idx = start; idx < end; idx++) {
      const { code, vol: h } = items[idx];
      const valid = [];
      for (let i = 0; i < sDol.length; i++) {
        if (sDol[i] + h > configStore.PALET_VOL) continue;
        const lim = configStore.LIMITS[code];
        if (lim && lim > 0 && (sIcerik[i][code] || 0) >= lim) continue;
        valid.push(i);
      }
      if (!valid.length) { sDol.push(h); sPkg.push(1); sIcerik.push({ [code]: 1 }); continue; }
      const minD = Math.min(...valid.map(i => sDol[i]));
      const pool2 = [];
      for (const i of valid) {
        const diff = sDol[i] - minD;
        const w = Math.max(1, 100 - Math.floor(diff * 100 / configStore.PALET_VOL));
        for (let j = 0; j < w; j++) pool2.push(i);
      }
      const sel = pool2[Math.floor(rng() * pool2.length)];
      sDol[sel] += h; sPkg[sel] += 1; sIcerik[sel][code] = (sIcerik[sel][code] || 0) + 1;
    }
    setProgress(48 + chunk * 9, `${t('log_block')} ${chunk + 1}/4`);
    addLog(`· ${t('log_block')} ${chunk + 1}/4 → <span>${end}/${items.length}</span>`);
    await delay(500);
  }

  const nS = sDol.length;
  const avgPct = Math.round(sDol.reduce((a, b) => a + b / configStore.PALET_VOL, 0) / nS * 100);
  const totalPalet = nS + existingPalet;
  // Geçerli paket sayısı = palette gerçekten paketlenenler (unknown/oversized hariç)
  const validPkgCount = items.length;
  setProgress(82, t('log_results')); addLog(`▸ <span>${t('log_results')}</span>`, 'phase'); await delay(400);
  ['donutCard', 'barCard', 'paletCard', 'logCard'].forEach(id => document.getElementById(id).classList.remove('scanning'));
  document.getElementById('sideTotal').textContent = validPkgCount;
  // Sidebar palet sayısı KPI ile tutarlı olsun (mevcut palet varsa toplam göster)
  document.getElementById('sidePalet').textContent = existingPalet > 0 ? totalPalet : nS;
  if (existingPalet > 0) {
    document.getElementById('sideBreakdown').style.display = 'block';
    document.getElementById('sideCalcPalet').textContent = nS;
    document.getElementById('sideExistPalet').textContent = existingPalet;
    document.getElementById('kpiPaletBreakdown').style.display = 'flex';
    document.getElementById('kpiCalcPalet').textContent = nS;
    document.getElementById('kpiExistPalet').textContent = existingPalet;
  } else {
    document.getElementById('sideBreakdown').style.display = 'none';
    document.getElementById('kpiPaletBreakdown').style.display = 'none';
  }
  countUp('kpiPkg', validPkgCount, 900);
  countUp('kpiPalet', existingPalet > 0 ? totalPalet : nS, 900);
  const avgPkgPerPaletKpi = nS > 0 ? Math.round(validPkgCount / nS) : 0;
  setTimeout(() => countUp('kpiAvg', avgPkgPerPaletKpi, 900), 200);
  setProgress(88, t('log_charts')); await delay(300);
  const catCounts = {};
  [t('cat_small'), t('cat_mid'), t('cat_big'), uiStore.currentLang === 'en' ? 'Other' : 'Diğer'].forEach(k => catCounts[k] = 0);
  // Sadece geçerli (paketlenmiş) paketleri kategori dağılımına dahil et
  for (const [code, cnt] of Object.entries(counts)) {
    if (configStore.DIMS[code] && vol(code) <= configStore.PALET_VOL) {
      catCounts[cat(code)] = (catCounts[cat(code)] || 0) + cnt;
    }
  }
  drawDonut(catCounts, validPkgCount); await delay(250);
  // drawBars: counts içinden sadece geçerli kodlar zaten configStore.ALL_ORDER filtresinde elenecek
  drawBars(counts, validPkgCount); await delay(200);
  setProgress(95, t('log_palets'));
  drawPalets(sDol, sPkg, sIcerik);
  for (let i = 0; i < sDol.length; i++) {
    addLog(`${t('palet_label')} <span>#${i + 1}</span> → <span>${sPkg[i]} ${t('pkg_label').toLowerCase()}</span> · <span>${Math.round(sDol[i] / configStore.PALET_VOL * 100)}%</span>`);
    await delay(80);
  }
  if (existingPalet > 0) {
    addLog(`▸ <span>${t('calculated_palet')}: ${nS}</span> + <span>${t('existing_palet_short')}: ${existingPalet}</span> = <span>${t('total_palet')}: ${totalPalet}</span>`, 'phase');
  }
  setProgress(100, t('log_done')); addLog(`✓ <span>${t('log_complete')}</span>`, 'phase'); await delay(400);
  document.getElementById('globalWrap').style.opacity = '0';
  document.getElementById('phaseLabel').style.opacity = '0';

  const note = document.getElementById('noteInput').value.trim();
  const paletDetails = sDol.map((d, i) => ({ name: `Palet #${i + 1}`, pct: Math.round(d / configStore.PALET_VOL * 100), pkg: sPkg[i] }));
  const avgPkgPerPalet = nS > 0 ? Math.round(validPkgCount / nS) : 150;
  // Sadece geçerli kod sayılarını sakla (XSS/NaN için temizlik)
  const validCounts = {};
  for (const [code, cnt] of Object.entries(counts)) {
    if (configStore.DIMS[code] && vol(code) <= configStore.PALET_VOL) validCounts[code] = cnt;
  }
  const histLimit = await saveHistory({ id: uid(), deliveryName: titleVal, totalPkg: validPkgCount, palets: nS, existingPalet, avgPct, date: nowStr(), note, paletDetails, counts: validCounts, avgPkgPerPalet });
  const delLimit = await saveDeliveryEntry({ id: uid(), name: titleVal, totalPkg: validPkgCount, palets: nS, existingPalet, avgPct, date: nowStr(), note, paletDetails, counts: validCounts, grups: [], avgPkgPerPalet });
  renderRecentCalcs();
  // Kayıt sınırı aşıldıysa kullanıcıyı bir kez uyar (sim bittikten sonra, akışı bölmeden)
  if ((histLimit || delLimit) && !_limitWarnShown) {
    _limitWarnShown = true;
    await alertDialog(t('limit_warn'));
  }
  } finally {
    btn.disabled = false;
    spinner.style.display = 'none';
    runLabel.textContent = t('run_again');
    uiStore.simRunning = false;
  }
}
