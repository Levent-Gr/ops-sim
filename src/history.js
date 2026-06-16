// ops_sim — Author: Levent Görgü (github.com/Levent-Gr) — (c) 2026
import { configStore, deliveryStore, historyStore, uiStore } from './state.js';
import { STORES, idbGetAll, idbDelete, idbClear, idbPut } from './db.js';
import { t } from './i18n.js';
import { isToday, safe, nowStr } from './utils.js';
import { svgIconBox, svgIconCalendar, svgIconFolder, ICON_BOLT, ICON_LIST, ICON_DOWNLOAD } from './icons.js';
import { cat, getCatOfPkg } from './config.js';
import { drawDonutTo } from './sim.js';
import {
  drawChargeChart, calcForecastAtIndex, calcShippedSoFar,
  buildEditorialHeadRight, buildKpiStrip, buildPaketGaugeHTML,
  buildForecastHistoryHTML, buildCalibrationHistoryReadOnlyHTML,
  renderModalChargeSection, destroyChargeCharts,
  getDeliveryChargeInfo
} from './charge.js';
import { confirmDialog, alertDialog, showToast } from './dialog.js';

async function _loadAndCacheHistory() {
  try {
    const all = await idbGetAll(STORES.history);
    all.sort((a, b) => (b._ts || 0) - (a._ts || 0));
    historyStore.histCache = all;
    return all;
  } catch { return []; }
}

function _getHistById(id) {
  return historyStore.histCache.find(h => h.id === id) || null;
}

// Katlanabilir geçmiş bölümü oluşturur (akordeon: aynı anda tek bölüm açık).
// headerInnerHTML: mevcut icon + title + count HTML'i. Döner: { section, body }.
// İçerik (date-group / item) section'a değil body'ye eklenir.
function makeHistSection(headerInnerHTML) {
  const section = document.createElement('div');
  section.className = 'hist-section';

  const header = document.createElement('div');
  header.className = 'hist-section-header';
  header.setAttribute('role', 'button');
  header.setAttribute('tabindex', '0');
  header.setAttribute('aria-expanded', 'false');
  header.innerHTML = headerInnerHTML +
    `<span class="hist-section-chevron" aria-hidden="true"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"></polyline></svg></span>`;

  const body = document.createElement('div');
  body.className = 'hist-section-body';
  const inner = document.createElement('div');
  inner.className = 'hist-section-body-inner';
  body.appendChild(inner);

  section.appendChild(header);
  section.appendChild(body);

  const toggle = () => {
    const willOpen = !section.classList.contains('open');
    // Akordeon: tıklanan dışındaki açık bölümleri kapat
    const list = document.getElementById('historyList');
    if (list) list.querySelectorAll('.hist-section.open').forEach(s => {
      if (s !== section) {
        s.classList.remove('open');
        const h = s.querySelector('.hist-section-header');
        if (h) h.setAttribute('aria-expanded', 'false');
      }
    });
    section.classList.toggle('open', willOpen);
    header.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
  };
  header.addEventListener('click', toggle);
  header.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
  });

  return { section, body: inner };
}

// Bölüm içindeki tarih grubu için akordeon (bölüm akordeonunun ikizi). Aynı bölümde tek
// tarih açık kalır. headerInnerHTML: tarih etiketi + çizgi + sayaç. Döner: { group, body }.
function makeDateGroup(headerInnerHTML) {
  const group = document.createElement('div');
  group.className = 'hist-date-group';

  const header = document.createElement('div');
  header.className = 'hist-date-header';
  header.setAttribute('role', 'button');
  header.setAttribute('tabindex', '0');
  header.setAttribute('aria-expanded', 'false');
  header.innerHTML = headerInnerHTML +
    `<span class="hist-date-chevron" aria-hidden="true"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"></polyline></svg></span>`;

  const body = document.createElement('div');
  body.className = 'hist-date-body';
  const inner = document.createElement('div');
  inner.className = 'hist-date-body-inner';
  body.appendChild(inner);

  group.appendChild(header);
  group.appendChild(body);

  const toggle = () => {
    const willOpen = !group.classList.contains('open');
    const parent = group.parentElement; // bölüm gövdesi
    if (parent) parent.querySelectorAll(':scope > .hist-date-group.open').forEach(g => {
      if (g !== group) {
        g.classList.remove('open');
        const h = g.querySelector('.hist-date-header');
        if (h) h.setAttribute('aria-expanded', 'false');
      }
    });
    group.classList.toggle('open', willOpen);
    header.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
  };
  header.addEventListener('click', toggle);
  header.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
  });

  return { group, body: inner };
}

export async function deleteHistItem(id, e) {
  if (e) e.stopPropagation();
  await idbDelete(STORES.history, id);
  renderHistory();
}

export async function clearHistory() {
  if (await confirmDialog(t('clear_all_hist') + '?')) {
    await idbClear(STORES.history);
    renderHistory();
  }
}

export async function renderHistory() {
  const el = document.getElementById('historyList');
  if (!el) return;
  const hist = await _loadAndCacheHistory();
  if (!hist.length) { el.innerHTML = `<div class="hist-empty">${t('no_hist')}</div>`; return; }

  const tesItems = hist.filter(h => h._type !== 'grup_archive' && h._type !== 'charge_archive');
  const grpItems = hist.filter(h => h._type === 'grup_archive');
  const chaItems = hist.filter(h => h._type === 'charge_archive');

  const deliveryToGrupName = {};
  grpItems.forEach(g => { (g.members || []).forEach(m => { deliveryToGrupName[m.id] = g.grupName; }); });

  el.innerHTML = '';

  if (tesItems.length) {
    const { section: tesSec, body: tesBody } = makeHistSection(`
      <div class="hist-section-icon">${svgIconBox('var(--muted)')}</div>
      <div class="hist-section-title">${uiStore.currentLang === 'en' ? 'Deliveries' : 'Teslimatlar'}</div>
      <div class="hist-section-count">${tesItems.length}</div>`);

    const byDate = {};
    tesItems.forEach(h => { const d = (h.date || '').split(' ')[0] || '—'; if (!byDate[d]) byDate[d] = []; byDate[d].push(h); });
    Object.entries(byDate).forEach(([day, items]) => {
      const { group: dg, body: dgBody } = makeDateGroup(`
        <div class="hist-date-label">${svgIconCalendar('var(--muted)')}${day}</div>
        <div class="hist-date-line"></div>
        <div class="hist-date-count">${items.length}</div>`);
      items.forEach(h => {
        const grupName = deliveryToGrupName[h.id];
        const div = document.createElement('div'); div.className = 'hist-item';
        div.ondblclick = () => openDeliveryModal(h, 'hist'); div.title = 'Çift tıkla → Detay';
        div.innerHTML = `
          <div class="hist-header">
            <span class="hist-badge hist-badge-tes">TES</span>
            <div class="hist-name">${safe(h.deliveryName)}</div>
            ${grupName ? `<div style="font-family:var(--mono);font-size:9px;color:var(--muted);background:var(--surface3);border:1px solid var(--border);border-radius:4px;padding:1px 6px;white-space:nowrap">${safe(grupName)}</div>` : ''}
            <div class="hist-time">${safe((h.date || '').split(' ')[1] || '')}</div>
            <button class="hist-del" aria-label="${t('delete_grup')}" title="${t('delete_grup')}" onclick="window.__deleteHistItem('${safe(h.id)}',event)">✕</button>
          </div>
          <div class="hist-stats">
            <div class="hist-stat">${t('pkg_label')}: <span>${h.totalPkg}</span></div>
            <div class="hist-stat">${t('palet_label')}: <span>${h.existingPalet > 0 ? (h.palets + h.existingPalet) + ' (' + h.palets + '+' + h.existingPalet + ')' : h.palets}</span></div>
            <div class="hist-stat">${t('fill_label')}: <span>${h.avgPct}%</span></div>
          </div>`;
        dgBody.appendChild(div);
      });
      tesBody.appendChild(dg);
    });
    el.appendChild(tesSec);
  }

  if (grpItems.length) {
    const { section: grpSec, body: grpBody } = makeHistSection(`
      <div class="hist-section-icon">${svgIconFolder('var(--muted)')}</div>
      <div class="hist-section-title">${uiStore.currentLang === 'en' ? 'Archived Shipments' : 'Arşivlenen Sevkiyatlar'}</div>
      <div class="hist-section-count">${grpItems.length}</div>`);

    const byDate2 = {};
    grpItems.forEach(h => { const d = (h.archivedAt || '').split(' ')[0] || '—'; if (!byDate2[d]) byDate2[d] = []; byDate2[d].push(h); });
    Object.entries(byDate2).forEach(([day, items]) => {
      const { group: dg, body: dgBody } = makeDateGroup(`
        <div class="hist-date-label">${svgIconCalendar('var(--muted)')}${day}</div>
        <div class="hist-date-line"></div>
        <div class="hist-date-count">${items.length}</div>`);
      items.forEach(h => {
        const div = document.createElement('div'); div.className = 'hist-item';
        div.ondblclick = () => toggleHistDetail('hd-' + h.id); div.title = 'Çift tıkla → Detay';
        const aPred = (typeof h.predictedPalet === 'number') ? h.predictedPalet : (h.members || []).reduce((a, m) => a + (m.palets || 0) + (m.existingPalet || 0), 0);
        const aFolder = h.statFolder || '';
        const aActual = (h.actualPalet != null && h.actualPalet !== '') ? h.actualPalet : '';
        const aFolderOpts = getFolderSuggestions().map(n => `<option value="${safe(n)}"></option>`).join('');
        div.innerHTML = `
          <div class="hist-header">
            <span class="hist-badge hist-badge-grp">SVK</span>
            <div class="hist-name">${safe(h.grupName)}</div>
            <div class="hist-time">${safe((h.archivedAt || '').split(' ')[1] || '')}</div>
            <button class="hist-del" aria-label="${t('delete_grup')}" title="${t('delete_grup')}" onclick="window.__deleteHistItem('${safe(h.id)}',event)">✕</button>
          </div>
          <div class="hist-stats">
            <div class="hist-stat">${t('members_label')}: <span>${(h.members || []).length}</span></div>
            ${h.note ? `<div class="hist-stat">${t('note_label')}: <span>${safe(h.note)}</span></div>` : ''}
          </div>
          <div class="hist-detail" id="hd-${safe(h.id)}">
            ${h.note ? `<div class="hist-note-block" style="margin-bottom:10px"><div class="hist-note-label">${t('note_label')}</div><div class="hist-note-text">${safe(h.note)}</div></div>` : ''}
            <div class="grup-analyze" onclick="event.stopPropagation()">
              <div class="grup-analyze-head">${t('analyze_add')} · ${t('shipment_total')}: <b>${aPred}</b></div>
              <div class="actual-entry-row">
                <span class="charge-label">${t('folder_label')}</span>
                <input class="charge-input actual-folder-input" list="ghFolderSuggest-${safe(h.id)}" id="ghFolder-${safe(h.id)}" value="${aFolder !== '' ? safe(aFolder) : ''}" placeholder="${t('folder_label')}…"/>
                <datalist id="ghFolderSuggest-${safe(h.id)}">${aFolderOpts}</datalist>
              </div>
              <div class="actual-entry-row">
                <span class="charge-label">${t('actual_palet_label')}</span>
                <input class="charge-input" type="number" min="0" step="any" id="ghActual-${safe(h.id)}" value="${aActual !== '' ? safe(String(aActual)) : ''}" placeholder="${safe(String(aPred))}"/>
                <button class="btn-charge-snapshot" onclick="event.stopPropagation();window.__saveGrupArchiveActual('${safe(h.id)}')">${t('save')}</button>
              </div>
              <div class="actual-delta" id="ghDelta-${safe(h.id)}">${_actualDeltaHTML(aActual, aPred)}</div>
            </div>
            <div style="font-size:9px;color:var(--muted);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:8px">${t('members_label')}</div>
            <div class="hist-grup-members">
              ${(h.members || []).map(m => `
                <div class="hist-grup-member" ondblclick="event.stopPropagation();window.__openDeliveryModalFromObj(${safe(JSON.stringify(m))})">
                  <div class="hist-grup-member-name">${safe(m.name)}</div>
                  <div class="hist-grup-member-stats">${t('pkg_label')}: <span>${m.totalPkg}</span> · ${t('palet_label')}: <span>${m.palets}</span> · ${t('fill_label')}: <span>${m.avgPct}%</span></div>
                </div>`).join('')}
            </div>
          </div>`;
        dgBody.appendChild(div);
      });
      grpBody.appendChild(dg);
    });
    el.appendChild(grpSec);
  }

  const pastFolders = deliveryStore.deliveryFolders.filter(folder => {
    const members = folder.ids.map(id => deliveryStore.deliveries.find(c => c.id === id)).filter(Boolean);
    return members.length > 0 && members.some(c => !isToday(c.date));
  });

  if (pastFolders.length) {
    const { section: klsSec, body: klsBody } = makeHistSection(`
      <div class="hist-section-icon">${svgIconFolder('var(--muted)')}</div>
      <div class="hist-section-title">${uiStore.currentLang === 'en' ? 'Delivery Lines' : 'Teslimat Hatları'}</div>
      <div class="hist-section-count">${pastFolders.length}</div>`);

    pastFolders.forEach(folder => {
      const allMembers = folder.ids.map(id => deliveryStore.deliveries.find(c => c.id === id)).filter(Boolean);
      const pastMembers = allMembers.filter(c => !isToday(c.date));
      const fid = 'cf-' + folder.id;
      const folderDiv = document.createElement('div'); folderDiv.className = 'hist-item'; folderDiv.style.marginBottom = '5px';
      folderDiv.innerHTML = `
        <div class="hist-header" ondblclick="window.__toggleHistDetail('${safe(fid)}')">
          <span class="hist-badge hist-badge-kls">HAT</span>
          <div class="hist-name">${safe(folder.name)}</div>
          <div class="hist-time">${pastMembers.length} ${uiStore.currentLang === 'en' ? 'past' : 'geçmiş'}</div>
        </div>
        <div class="hist-stats">
          ${pastMembers.slice(0, 3).map(c => `<div class="hist-stat">${safe(c.name)}: <span>${c.existingPalet > 0 ? (c.palets + c.existingPalet) : c.palets}p · ${c.avgPct}%</span></div>`).join('')}
          ${pastMembers.length > 3 ? `<div class="hist-stat" style="opacity:.5">+${pastMembers.length - 3} ${uiStore.currentLang === 'en' ? 'more' : 'daha'}</div>` : ''}
        </div>
        <div class="hist-detail" id="${safe(fid)}">
          <div style="font-size:9px;color:var(--muted);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:8px">${uiStore.currentLang === 'en' ? 'Past Deliveries' : 'Geçmişteki Teslimatlar'}</div>
          <div class="hist-grup-members">
            ${pastMembers.map(c => `
              <div class="hist-grup-member" ondblclick="event.stopPropagation();window.__openDeliveryModalById('${safe(c.id)}')">
                <div class="hist-grup-member-name">${safe(c.name)}</div>
                <div class="hist-grup-member-stats">${t('pkg_label')}: <span>${c.totalPkg}</span> · ${t('palet_label')}: <span>${c.existingPalet > 0 ? (c.palets + c.existingPalet) : c.palets}</span> · ${t('fill_label')}: <span>${c.avgPct}%</span> · <span>${safe((c.date || '').split(' ')[0] || '')}</span></div>
              </div>`).join('')}
          </div>
        </div>`;
      klsBody.appendChild(folderDiv);
    });
    el.appendChild(klsSec);
  }

  if (chaItems.length) {
    const { section: chaSec, body: chaBody } = makeHistSection(`
      <div class="hist-section-icon">${ICON_BOLT}</div>
      <div class="hist-section-title">${t('charge_history')}</div>
      <div class="hist-section-count">${chaItems.length}</div>`);

    const byDateC = {};
    chaItems.forEach(h => { const d = (h.startedAt || '').split(' ')[0] || '—'; if (!byDateC[d]) byDateC[d] = []; byDateC[d].push(h); });
    Object.entries(byDateC).forEach(([day, items]) => {
      const { group: dg, body: dgBody } = makeDateGroup(`
        <div class="hist-date-label">${svgIconCalendar('var(--muted)')}${day}</div>
        <div class="hist-date-line"></div>
        <div class="hist-date-count">${items.length}</div>`);
      items.forEach(h => {
        const totalSent = (h.snapshots || []).reduce((a, s) => a + (s.shipped || 0), 0);
        const lastTotal = h.snapshots?.[h.snapshots.length - 1]?.total || 0;
        const div = document.createElement('div'); div.className = 'hist-item';
        div.ondblclick = () => openChargeArchiveModal(h); div.title = 'Çift tıkla → Detay';
        div.innerHTML = `
          <div class="hist-header">
            <span class="hist-badge hist-badge-cha">CHA</span>
            <div class="hist-name">${safe(h.deliveryName)}</div>
            <div class="hist-time">${safe((h.startedAt || '').split(' ')[1] || '')} → ${safe((h.stoppedAt || '').split(' ')[1] || '')}</div>
            <button class="hist-del" aria-label="${t('delete_grup')}" title="${t('delete_grup')}" onclick="window.__deleteHistItem('${safe(h.id)}',event)">✕</button>
          </div>
          <div class="hist-stats">
            <div class="hist-stat">${t('data_total')}: <span>${lastTotal.toLocaleString('tr-TR')}</span></div>
            <div class="hist-stat">${t('kpi_total_sent')}: <span>${totalSent.toLocaleString('tr-TR')}</span></div>
            <div class="hist-stat">${uiStore.currentLang === 'en' ? 'Records' : 'Veri'}: <span>${(h.snapshots || []).length}</span></div>
          </div>`;
        dgBody.appendChild(div);
      });
      chaBody.appendChild(dg);
    });
    el.appendChild(chaSec);
  }
}

export function toggleHistDetail(id) {
  const det = document.getElementById(id);
  if (!det) return;
  const isOpen = det.classList.contains('open');
  document.querySelectorAll('.hist-detail').forEach(d => d.classList.remove('open'));
  if (!isOpen) {
    det.classList.add('open');
    const h = _getHistById(id.replace('hd-', ''));
    if (h && h._type === 'charge_archive' && Array.isArray(h.snapshots) && h.snapshots.length) {
      const recLike = {
        id: h.chargeId, deliveryId: h.deliveryId, deliveryName: h.deliveryName,
        snapshots: h.snapshots, calibrations: h.calibrations || [],
        avgPkgPerPalet: h.avgPkgPerPalet, chargeEndTime: h.chargeEndTime,
        startedAt: h.startedAt, startedAtMs: h._ts
      };
      const deliveryLike = deliveryStore.deliveries.find(c => c.id === h.deliveryId) || historyStore.histCache.find(x => x.id === h.deliveryId && x._type !== 'charge_archive' && x._type !== 'grup_archive') || {
        id: h.deliveryId, name: h.deliveryName, palets: 0, existingPalet: 0, totalPkg: 0, avgPkgPerPalet: h.avgPkgPerPalet
      };
      setTimeout(() => { try { drawChargeChart(recLike, deliveryLike, 'chaChart-' + h.id); } catch (e) { console.warn('CHA chart hatası:', e); } }, 80);
    }
    if (h && h.counts && Object.keys(h.counts).length) {
      const catCounts = {};
      const catKeys = [t('cat_small'), t('cat_mid'), t('cat_big'), uiStore.currentLang === 'en' ? 'Other' : 'Diğer'];
      catKeys.forEach(k => catCounts[k] = 0);
      for (const [code, cnt] of Object.entries(h.counts)) { catCounts[cat(code)] = (catCounts[cat(code)] || 0) + cnt; }
      if (document.getElementById('hdoNut-' + h.id)) drawDonutTo('hdoNut-' + h.id, 'hdoLeg-' + h.id, catCounts, h.totalPkg);
      const barsEl = document.getElementById('hbars-' + h.id);
      if (barsEl) {
        barsEl.innerHTML = '';
        const order = configStore.ALL_ORDER.filter(p => h.counts[p]);
        if (order.length && h.totalPkg > 0) {
          const max = Math.max(...order.map(p => h.counts[p]));
          const colorArr = ['#38bdf8', '#34d399', '#fbbf24'];
          order.forEach(p => {
            const v = h.counts[p], pct = Math.round(v / h.totalPkg * 100), w = max > 0 ? Math.round(v / max * 100) : 0;
            const catK = getCatOfPkg(p); const color = catK === 'small' ? colorArr[0] : catK === 'mid' ? colorArr[1] : colorArr[2];
            const row = document.createElement('div'); row.className = 'bar-row'; row.style.cssText = 'opacity:1;transform:none';
            row.innerHTML = `<div class="bar-code">${safe(p)}</div><div class="bar-track"><div class="bar-fill" style="background:${color};width:${w}%"></div></div><div class="bar-pct">${pct}%</div>`;
            barsEl.appendChild(row);
          });
        }
      }
    }
  }
}

export function openDeliveryModal(item, src) {
  const overlay = document.getElementById('detailModal');
  if (overlay.dataset.mode === 'cha') _resetModalToTesMode();

  const name = item.deliveryName || item.name || '—';
  const totalPkg = item.totalPkg || 0;
  const palets = item.palets || 0;
  const existingPalet = item.existingPalet || 0;
  const totalPaletDisp = palets + existingPalet;
  const avgPct = item.avgPct || 0;
  const date = item.date || item.archivedAt || '';
  const note = item.note || '';
  const paletDetails = item.paletDetails || [];
  const counts = item.counts || {};

  document.getElementById('modalTitle').textContent = name;
  document.getElementById('modalDate').textContent = date;
  document.getElementById('modalPkg').textContent = totalPkg;
  document.getElementById('modalPalet').textContent = existingPalet > 0 ? totalPaletDisp : palets;
  // Ortalama paket/palet: yalnızca HESAPLANAN palete bölünür (mevcut palet DAHİL EDİLMEZ) —
  // Hesaplama ekranıyla tutarlı. Mevcut paletler sahada zaten var; paketleme yoğunluğuna girmez.
  const avgPpp = palets > 0 ? Math.round(totalPkg / palets) : 0;
  document.getElementById('modalFill').textContent = avgPpp;
  document.getElementById('modalLblPkg').textContent = t('kpi_pkg');
  document.getElementById('modalLblPalet').textContent = t('kpi_palets');
  document.getElementById('modalLblFill').textContent = t('kpi_avg_ppp');
  document.getElementById('modalLblCatDist').textContent = t('cat_dist');
  document.getElementById('modalLblPkgPct').textContent = t('pkg_pct');
  document.getElementById('modalLblPaletResult').textContent = t('palet_result');
  document.getElementById('modalLblNote').textContent = t('note_label');

  const mpb = document.getElementById('modalPaletBreakdown');
  if (existingPalet > 0) {
    mpb.style.display = 'flex';
    document.getElementById('modalLblCalcPalet').textContent = t('calculated_palet');
    document.getElementById('modalLblExistPalet').textContent = t('existing_palet_short');
    document.getElementById('modalCalcPalet').textContent = palets;
    document.getElementById('modalExistPalet').textContent = existingPalet;
  } else { mpb.style.display = 'none'; }

  const noteBlock = document.getElementById('modalNoteBlock');
  if (note) { noteBlock.style.display = 'block'; document.getElementById('modalNote').textContent = note; }
  else noteBlock.style.display = 'none';

  const paletEl = document.getElementById('modalPaletList');
  paletEl.innerHTML = '';
  if (paletDetails.length) {
    paletDetails.forEach(s => {
      const row = document.createElement('div'); row.className = 'sd-row';
      row.innerHTML = `<div class="sd-name">${safe(s.name)}</div><div class="sd-track"><div class="sd-fill" style="width:${s.pct}%"></div></div><div class="sd-pkg">${s.pkg != null ? safe(String(s.pkg)) + ' ' + safe(t('pkg_label').toLowerCase()) : ''}</div><div class="sd-pct">${s.pct}%</div>`;
      paletEl.appendChild(row);
    });
  } else { paletEl.innerHTML = `<div style="font-size:11px;color:var(--muted);font-style:italic">—</div>`; }

  const catCounts = {};
  const catKeys = [t('cat_small'), t('cat_mid'), t('cat_big'), uiStore.currentLang === 'en' ? 'Other' : 'Diğer'];
  catKeys.forEach(k => catCounts[k] = 0);
  if (Object.keys(counts).length) {
    for (const [code, cnt] of Object.entries(counts)) { catCounts[cat(code)] = (catCounts[cat(code)] || 0) + cnt; }
    drawDonutTo('modalDonut', 'modalLegend', catCounts, totalPkg);
  } else {
    document.getElementById('modalDonut').innerHTML = '';
    document.getElementById('modalLegend').innerHTML = `<span style="font-size:11px;color:var(--muted)">—</span>`;
  }

  const barsEl = document.getElementById('modalBars'); barsEl.innerHTML = '';
  const orderM = configStore.ALL_ORDER.filter(p => counts[p]);
  if (orderM.length && totalPkg > 0) {
    const max = Math.max(...orderM.map(p => counts[p]));
    const colorArr = ['#38bdf8', '#34d399', '#fbbf24'];
    orderM.forEach(p => {
      const v = counts[p], pct = Math.round(v / totalPkg * 100), w = max > 0 ? Math.round(v / max * 100) : 0;
      const catK = getCatOfPkg(p); const color = catK === 'small' ? colorArr[0] : catK === 'mid' ? colorArr[1] : colorArr[2];
      const row = document.createElement('div'); row.className = 'bar-row'; row.style.opacity = '1'; row.style.transform = 'none';
      row.innerHTML = `<div class="bar-code">${safe(p)}</div><div class="bar-track"><div class="bar-fill" style="background:${color};width:${w}%"></div></div><div class="bar-pct">${pct}%</div>`;
      barsEl.appendChild(row);
    });
  } else { barsEl.innerHTML = `<span style="font-size:11px;color:var(--muted)">—</span>`; }

  overlay.classList.add('open');
  if (item && item.id) renderModalChargeSection(item.id, item);
  else document.getElementById('modalChargeSection').style.display = 'none';

  // Gerçekleşen palet girişi yalnız Geçmiş'ten açılınca (TES kaydı) gösterilir.
  const actualBlock = document.getElementById('modalActualBlock');
  if (src === 'hist' && item && item.id) renderModalActualBlock(item);
  else if (actualBlock) actualBlock.style.display = 'none';
}

// ─── Gerçekleşen palet girişi + tahmin kıyası (Geçmiş modalı) ─────
function _actualDeltaHTML(actual, toolPred) {
  if (actual == null || actual === '' || toolPred == null) return '';
  const a = Number(actual), p = Number(toolPred);
  const err = a - p;
  const abs = Math.abs(err);
  const pct = a > 0 ? Math.round(abs / a * 100) : 0;
  const cls = abs <= 1 ? 'actual-delta-good' : (pct <= 15 ? 'actual-delta-mid' : 'actual-delta-bad');
  const sign = err > 0 ? '+' : (err < 0 ? '−' : '±');
  return `<span class="${cls}">${t('deviation')}: ${sign}${abs} ${t('palet_lbl')} (${pct}%)</span>`;
}

// Klasör adı önerileri: mevcut teslimat klasörleri ∪ geçmişte kullanılmış statFolder'lar.
export function getFolderSuggestions() {
  const set = new Set();
  (deliveryStore.deliveryFolders || []).forEach(f => { if (f && f.name) set.add(f.name); });
  (historyStore.histCache || []).forEach(h => { if (h && h.statFolder) set.add(h.statFolder); });
  return [...set].sort((a, b) => a.localeCompare(b, 'tr'));
}

function renderModalActualBlock(item) {
  const block = document.getElementById('modalActualBlock');
  if (!block) return;
  const simPalet = (item.palets || 0) + (item.existingPalet || 0);
  const ci = getDeliveryChargeInfo(item.id, item);
  const chargePred = ci.hasCharge ? ci.finalPalet : null;
  const toolPred = chargePred != null ? chargePred : simPalet;
  const actual = (item.actualPalet != null && item.actualPalet !== '') ? item.actualPalet : '';
  const folder = item.statFolder || '';
  const opts = getFolderSuggestions().map(name => `<option value="${safe(name)}"></option>`).join('');
  const badge = ci.hasCharge
    ? `<div class="actual-charge-badge on">${ICON_BOLT} ${ci.active ? t('charge_active_badge') : t('charge_used_badge')}</div>`
    : `<div class="actual-charge-badge off">${t('no_charge_badge')}</div>`;
  block.style.display = 'block';
  block.innerHTML = `<div class="card" style="padding:14px">
    <div class="modal-section-label">${t('actual_result')}</div>
    ${badge}
    <div class="actual-pred-row">
      <div class="actual-pred-item ${chargePred == null ? 'pred-primary' : ''}"><span class="actual-pred-lbl">${t('sim_prediction')}</span><b>${simPalet}</b></div>
      ${chargePred != null ? `<div class="actual-pred-item pred-primary"><span class="actual-pred-lbl">${t('charge_final_prediction')}</span><b>${chargePred}</b></div>` : ''}
    </div>
    <div class="actual-entry-row">
      <span class="charge-label">${t('folder_label')}</span>
      <input class="charge-input actual-folder-input" list="folderSuggest" id="actualFolder-${safe(item.id)}" value="${folder !== '' ? safe(folder) : ''}" placeholder="${t('folder_label')}…"/>
      <datalist id="folderSuggest">${opts}</datalist>
    </div>
    <div class="actual-entry-row">
      <span class="charge-label">${t('actual_palet_label')}</span>
      <input class="charge-input" type="number" min="0" step="any" id="actualPalet-${safe(item.id)}" value="${actual !== '' ? safe(String(actual)) : ''}" placeholder="${safe(String(toolPred))}"/>
      <button class="btn-charge-snapshot" onclick="window.__saveActualPalet('${safe(item.id)}')">${t('save')}</button>
    </div>
    <div id="actualDelta-${safe(item.id)}" class="actual-delta">${_actualDeltaHTML(actual, toolPred)}</div>
  </div>`;
}

export async function saveActualPalet(id) {
  const input = document.getElementById('actualPalet-' + id);
  if (!input) return;
  const item = _getHistById(id);
  if (!item) return;
  const raw = (input.value || '').trim();
  if (raw === '') {
    // Boş bırakma = kaydı istatistikten çıkar
    delete item.actualPalet; delete item.actualPaletAt;
  } else {
    const v = parseFloat(raw);
    if (isNaN(v) || v < 0) { await alertDialog(t('valid_total_required')); return; }
    const folder = (document.getElementById('actualFolder-' + id)?.value || '').trim();
    if (!folder) { await alertDialog(t('folder_required')); return; }
    item.actualPalet = v;
    item.statFolder = folder;
    item.actualPaletAt = nowStr();
  }
  await idbPut(STORES.history, item);
  const idx = historyStore.histCache.findIndex(h => h.id === id);
  if (idx >= 0) historyStore.histCache[idx] = item;
  renderModalActualBlock(item);
  showToast('✓ ' + t('saved_toast'));
}

// Arşivlenmiş sevkiyatı (grup_archive) analize al: gerçekleşen total + grup.
// Boş = analizden çıkar. Tahmin (predictedPalet) arşivde saklı; yoksa üyelerden türetilir.
export async function saveGrupArchiveActual(id) {
  const input = document.getElementById('ghActual-' + id);
  if (!input) return;
  const item = _getHistById(id);
  if (!item || item._type !== 'grup_archive') return;
  const raw = (input.value || '').trim();
  if (raw === '') {
    delete item.actualPalet; delete item.statFolder; delete item.analyzedAt;
  } else {
    const v = parseFloat(raw);
    if (isNaN(v) || v < 0) { await alertDialog(t('valid_total_required')); return; }
    const folder = (document.getElementById('ghFolder-' + id)?.value || '').trim();
    if (!folder) { await alertDialog(t('folder_required')); return; }
    if (typeof item.predictedPalet !== 'number') {
      item.predictedPalet = (item.members || []).reduce((a, m) => a + (m.palets || 0) + (m.existingPalet || 0), 0);
    }
    item.actualPalet = v;
    item.statFolder = folder;
    item.analyzedAt = nowStr();
  }
  await idbPut(STORES.history, item);
  const idx = historyStore.histCache.findIndex(h => h.id === id);
  if (idx >= 0) historyStore.histCache[idx] = item;
  // Sapmayı yerinde güncelle (akordeon kapanmasın)
  const deltaEl = document.getElementById('ghDelta-' + id);
  if (deltaEl) deltaEl.innerHTML = (raw === '') ? '' : _actualDeltaHTML(item.actualPalet, item.predictedPalet);
  showToast('✓ ' + t('saved_toast'));
}

export function closeModal(e) {
  if (e.target === document.getElementById('detailModal')) closeModalDirect();
}
export function closeModalDirect() {
  document.getElementById('detailModal').classList.remove('open');
  // Chart instance memory leak'i önle: modal kapanırken bellekte kalan grafik objelerini yık
  try { destroyChargeCharts(); } catch {}
}

export function openChargeArchiveModal(h) {
  if (!h || !h.snapshots) return;
  const overlay = document.getElementById('detailModal');
  const totalSent = (h.snapshots || []).reduce((a, s) => a + (s.shipped || 0), 0);
  const lastTotal = h.snapshots?.[h.snapshots.length - 1]?.total || 0;
  const firstTotal = h.snapshots?.[0]?.total || 0;
  const recLike = {
    id: h.chargeId, deliveryId: h.deliveryId, deliveryName: h.deliveryName,
    snapshots: h.snapshots, calibrations: h.calibrations || [],
    avgPkgPerPalet: h.avgPkgPerPalet, chargeEndTime: h.chargeEndTime,
    startedAt: h.startedAt, startedAtMs: h._ts
  };
  const deliveryLike = deliveryStore.deliveries.find(c => c.id === h.deliveryId) || historyStore.histCache.find(x => x.id === h.deliveryId && x._type !== 'charge_archive' && x._type !== 'grup_archive') || {
    id: h.deliveryId, name: h.deliveryName, palets: 0, existingPalet: 0, totalPkg: 0, avgPkgPerPalet: h.avgPkgPerPalet
  };
  const finalPalet = lastTotal > 0 ? Math.ceil((lastTotal + totalSent) / (h.avgPkgPerPalet || 150)) : 0;
  const chartId = 'chaModalChart-' + h.id;

  // textContent zaten escape eder; deliveryName burada güvenli
  document.getElementById('modalTitle').textContent = (h.deliveryName || '') + ' · ' + t('charge_history').replace(' Geçmişi', '').replace(' History', '');
  document.getElementById('modalDate').textContent = (h.startedAt || '') + ' → ' + (h.stoppedAt || '');

  document.getElementById('modalLblPkg').textContent = uiStore.currentLang === 'en' ? 'Start total' : 'Başlangıç total';
  document.getElementById('modalPkg').textContent = firstTotal.toLocaleString('tr-TR');
  document.getElementById('modalLblPalet').textContent = uiStore.currentLang === 'en' ? 'End total' : 'Bitiş total';
  document.getElementById('modalPalet').textContent = lastTotal.toLocaleString('tr-TR');
  document.getElementById('modalPaletBreakdown').style.display = 'none';
  document.getElementById('modalLblFill').textContent = t('kpi_total_sent');
  document.getElementById('modalFill').textContent = totalSent.toLocaleString('tr-TR');

  const row2 = document.querySelector('#detailModal .modal-row2');
  if (row2) {
    row2.innerHTML = `
      <div class="card" style="padding:14px;grid-column:span 2">
        <div class="modal-section-label">${t('trend_analysis')}</div>
        <div class="ed-chart-header" style="margin-top:0;padding-bottom:8px">
          <div>
            <div class="ed-chart-sub">${h.snapshots.length} ${t('trend_sub')}</div>
          </div>
          <div class="ed-head-right">
            <div class="ed-head-big">${finalPalet}<span class="ed-head-unit">${t('palet_lbl')}</span></div>
            <div class="ed-delta-flat">${uiStore.currentLang === 'en' ? 'final result' : 'son sonuç'}</div>
          </div>
        </div>
        <div class="charge-chart-wrap-palet-lg"><canvas id="${chartId}-palet"></canvas></div>
        <div class="ed-kpi-strip">
          <div class="ed-kpi-item">
            <div class="ed-kpi-label">${t('kpi_pkg_lbl')}</div>
            <div class="ed-kpi-val ed-kpi-paket">${lastTotal.toLocaleString('tr-TR')}</div>
          </div>
          <div class="ed-kpi-item">
            <div class="ed-kpi-label">${t('kpi_total_with_sent')}</div>
            <div class="ed-kpi-val">${(lastTotal + totalSent).toLocaleString('tr-TR')}</div>
          </div>
          <div class="ed-kpi-item">
            <div class="ed-kpi-label">${t('kpi_total_sent')}</div>
            <div class="ed-kpi-val">${totalSent.toLocaleString('tr-TR')}</div>
          </div>
        </div>
        ${buildPaketGaugeHTML(recLike)}
      </div>`;
  }

  const paletCard = document.querySelector('#detailModal .card[style*="margin-bottom:12px"]');
  if (paletCard) {
    paletCard.innerHTML = `
      <div class="ed-section-title">${ICON_LIST} ${t('forecast_hist')}</div>
      ${buildForecastHistoryHTML(recLike, deliveryLike)}
      ${buildCalibrationHistoryReadOnlyHTML(recLike)}
      <div style="display:flex;justify-content:flex-end;margin-top:14px">
        <button onclick="event.stopPropagation();window.__downloadChargeCSV('${h.id}')" class="btn-download-csv">${ICON_DOWNLOAD} ${t('download_csv')}</button>
      </div>`;
  }

  document.getElementById('modalNoteBlock').style.display = 'none';
  document.getElementById('modalChargeSection').style.display = 'none';

  overlay.dataset.mode = 'cha';
  overlay.classList.add('open');

  setTimeout(() => { try { drawChargeChart(recLike, deliveryLike, chartId); } catch (e) { console.warn('CHA modal chart hatası:', e); } }, 80);
}

function _resetModalToTesMode() {
  const overlay = document.getElementById('detailModal');
  if (overlay.dataset.mode !== 'cha') return;
  const row2 = document.querySelector('#detailModal .modal-row2');
  if (row2) {
    row2.innerHTML = `
      <div class="card" style="padding:14px">
        <div class="modal-section-label" id="modalLblCatDist">${t('cat_dist')}</div>
        <div class="donut-wrap">
          <svg class="donut-svg" id="modalDonut" viewBox="0 0 180 180"></svg>
          <div class="legend" id="modalLegend"></div>
        </div>
      </div>
      <div class="card" style="padding:14px">
        <div class="modal-section-label" id="modalLblPkgPct">${t('pkg_pct')}</div>
        <div class="bars" id="modalBars"></div>
      </div>`;
  }
  const paletCard = document.querySelector('#detailModal .card[style*="margin-bottom:12px"]');
  if (paletCard) {
    paletCard.innerHTML = `
      <div class="modal-section-label" id="modalLblPaletResult">${t('palet_result')}</div>
      <div class="modal-palet-scroll" id="modalPaletList"></div>`;
  }
  overlay.dataset.mode = 'tes';
}

// Yardımcı: id'ye göre delivery aç
export function openDeliveryModalById(cid) {
  const c = deliveryStore.deliveries.find(x => x.id === cid);
  if (c) openDeliveryModal(c);
}
// Yardımcı: serialize edilen objeden aç (arşivlenmiş grup üyesi)
export function openDeliveryModalFromObj(obj) {
  openDeliveryModal({ ...obj, deliveryName: obj.name, counts: obj.counts || {} });
}
// Yardımcı: teslimat modalındaki "Şarj Geçmişi" butonundan arşiv kaydını aç
export function openChargeArchiveById(histId) {
  const h = historyStore.histCache.find(x => x.id === histId && x._type === 'charge_archive');
  if (h) openChargeArchiveModal(h);
}
