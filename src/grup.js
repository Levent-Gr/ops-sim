// ops_sim — Author: Levent Görgü (github.com/Levent-Gr) — (c) 2026
import { deliveryStore, grupStore } from './state.js';
import { STORES, idbGet, idbPut, idbDelete } from './db.js';
import { t } from './i18n.js';
import { uid, nowStr, isToday, safe } from './utils.js';
import { grupIconSVG } from './icons.js';
import { saveHistory } from './sim.js';
import { saveDeliveryFolders } from './delivery.js';
import { getDeliveryChargeInfo } from './charge.js';
import { confirmDialog, alertDialog, showToast } from './dialog.js';
import { getFolderSuggestions } from './history.js';

// Bir teslimatın sevkiyata palet katkısı: şarjı varsa "şarj dahil nihai tahmin"
// (mevcut + sim + gelen + kalan), yoksa sim + mevcut. Şarj verisinden canlı hesaplanır.
function memberPaletInfo(c) {
  const ci = getDeliveryChargeInfo(c.id, c);
  if (ci.hasCharge && ci.finalPalet != null) return { palet: ci.finalPalet, charged: true };
  return { palet: (c.palets || 0) + (c.existingPalet || 0), charged: false };
}
function memberPaletStr(c) {
  const mp = memberPaletInfo(c);
  if (mp.charged) return mp.palet + 'p ⚡';
  return c.existingPalet > 0 ? (c.palets + c.existingPalet) + 'p (' + c.palets + '+' + c.existingPalet + ')' : c.palets + 'p';
}

// Sevkiyat tahmini vs gerçekleşen sapma rozeti (teslimat modalıyla aynı sınıflar).
function _grpDelta(actual, pred) {
  if (actual == null || actual === '' || pred == null) return '';
  const a = Number(actual), p = Number(pred), err = a - p, abs = Math.abs(err);
  const pct = a > 0 ? Math.round(abs / a * 100) : 0;
  const cls = abs <= 1 ? 'actual-delta-good' : (pct <= 15 ? 'actual-delta-mid' : 'actual-delta-bad');
  const sign = err > 0 ? '+' : (err < 0 ? '−' : '±');
  return `<span class="${cls}">${t('deviation')}: ${sign}${abs} ${t('palet_lbl')} (${pct}%)</span>`;
}

export async function loadGrups() {
  try { const g = await idbGet(STORES.config, 'grups'); grupStore.grups = g || []; }
  catch { grupStore.grups = []; }
}

export async function saveGrups() {
  await idbPut(STORES.config, grupStore.grups, 'grups');
}

export async function createGrup() {
  const inp = document.getElementById('grupNameInput');
  const name = inp.value.trim();
  if (!name) return;
  grupStore.grups.push({ id: uid(), name, ids: [], open: true, note: '', createdAt: nowStr() });
  await saveGrups();
  inp.value = '';
  renderGrupTab();
}

export async function deleteGrup(gid) {
  if (!(await confirmDialog(t('delete_grup') + '?'))) return;
  grupStore.grups = grupStore.grups.filter(g => g.id !== gid);
  await saveGrups();
  renderGrupTab();
}

export async function removeFromGrup(gid, tid) {
  const g = grupStore.grups.find(g => g.id === gid);
  if (g) g.ids = g.ids.filter(id => id !== tid);
  await saveGrups();
  renderGrupTab();
}

export function startEditGrupName(gid) {
  const g = grupStore.grups.find(g => g.id === gid); if (!g) return;
  const disp = document.getElementById('gname-disp-' + gid);
  const edit = document.getElementById('gname-edit-' + gid);
  disp.style.display = 'none'; edit.style.display = 'block';
  edit.value = g.name; edit.focus(); edit.select();
}

export async function saveGrupName(gid) {
  const g = grupStore.grups.find(g => g.id === gid); if (!g) return;
  const edit = document.getElementById('gname-edit-' + gid);
  const newName = edit.value.trim(); if (newName) g.name = newName;
  await saveGrups();
  renderGrupTab();
}

export function toggleGrupNote(gid) {
  const row = document.getElementById('gnote-row-' + gid);
  if (row) row.classList.toggle('open');
}

export async function saveGrupNote(gid) {
  const g = grupStore.grups.find(g => g.id === gid); if (!g) return;
  const inp = document.getElementById('gnote-inp-' + gid);
  g.note = inp.value.trim();
  await saveGrups();
  renderGrupTab();
}

export async function archiveGrup(gid) {
  const g = grupStore.grups.find(gr => gr.id === gid); if (!g) return;
  if (!(await confirmDialog(t('archive_grup') + '?'))) return;
  const members = g.ids.map(id => deliveryStore.deliveries.find(c => c.id === id)).filter(Boolean);
  // Şarj-dahil tahmin toplamını arşive yaz (üyeler silinmeden önce); analiz alanlarını taşı.
  const predictedPalet = members.reduce((a, c) => a + memberPaletInfo(c).palet, 0);
  const histEntry = {
    id: uid(), _type: 'grup_archive',
    grupName: g.name, note: g.note || '', createdAt: g.createdAt || '', archivedAt: nowStr(),
    predictedPalet,
    ...(g.statFolder ? { statFolder: g.statFolder, actualPalet: g.actualPalet, analyzedAt: g.analyzedAt } : {}),
    members: members.map(c => ({
      id: c.id, name: c.name, totalPkg: c.totalPkg, palets: c.palets,
      existingPalet: c.existingPalet || 0, avgPct: c.avgPct, date: c.date,
      note: c.note || '', paletDetails: c.paletDetails || [], counts: c.counts || {}
    }))
  };
  await saveHistory(histEntry);
  const archivedIds = new Set(g.ids);
  for (const id of archivedIds) await idbDelete(STORES.deliveries, id);
  deliveryStore.deliveries = deliveryStore.deliveries.filter(c => !archivedIds.has(c.id));
  grupStore.grups.forEach(gr => gr.ids = gr.ids.filter(id => !archivedIds.has(id)));
  deliveryStore.deliveryFolders.forEach(f => f.ids = f.ids.filter(id => !archivedIds.has(id)));
  await saveDeliveryFolders();
  grupStore.grups = grupStore.grups.filter(gr => gr.id !== gid);
  await saveGrups();
  renderGrupTab();
  if (typeof window.__renderHistory === 'function') window.__renderHistory();
}

// Aktif sevkiyatı analize al: tahmin (şarj-dahil) dondurulur; gerçekleşen + grup kaydedilir.
// Boş gerçekleşen = analizden çıkar. Veriler grup nesnesinde (config store) kalıcı.
export async function saveGrupActual(gid) {
  const g = grupStore.grups.find(gr => gr.id === gid); if (!g) return;
  const actInp = document.getElementById('grpActual-' + gid);
  if (!actInp) return;
  const raw = (actInp.value || '').trim();
  if (raw === '') {
    delete g.actualPalet; delete g.statFolder; delete g.predictedPalet; delete g.analyzedAt; delete g.analyzedAtMs;
  } else {
    const v = parseFloat(raw);
    if (isNaN(v) || v < 0) { await alertDialog(t('valid_total_required')); return; }
    const folder = (document.getElementById('grpFolder-' + gid)?.value || '').trim();
    if (!folder) { await alertDialog(t('folder_required')); return; }
    const members = g.ids.map(id => deliveryStore.deliveries.find(c => c.id === id)).filter(Boolean);
    g.predictedPalet = members.reduce((a, c) => a + memberPaletInfo(c).palet, 0);
    g.actualPalet = v;
    g.statFolder = folder;
    g.analyzedAt = nowStr();
    g.analyzedAtMs = Date.now();
  }
  await saveGrups();
  renderGrupTab();
  showToast('✓ ' + t('saved_toast'));
}

export function renderGrupTab() {
  const poolEl = document.getElementById('grupPool');
  if (!poolEl) return;
  const assigned = new Set(grupStore.grups.flatMap(g => g.ids));
  const free = deliveryStore.deliveries.filter(c => !assigned.has(c.id) && isToday(c.date));

  if (!free.length) {
    poolEl.innerHTML = `<span class="pool-empty">${t(deliveryStore.deliveries.filter(c => isToday(c.date)).length ? 'all_assigned' : 'no_deliveries_pool')}</span>`;
  } else {
    poolEl.innerHTML = '';
    free.forEach(c => {
      const chip = document.createElement('div');
      chip.className = 'pool-chip-v'; chip.draggable = true; chip.dataset.tid = c.id;
      const timeStr = c.date ? (c.date.split(' ')[1] || '') : '';
      chip.innerHTML = `
        <div style="flex:1"><div class="pool-chip-v-name">${safe(c.name)}</div></div>
        <div class="pool-chip-v-meta">
          <div class="pool-chip-v-date">${safe(timeStr)}</div>
          <div class="pool-chip-v-stats">${memberPaletStr(c)} · ${c.avgPct}%</div>
        </div>`;
      chip.addEventListener('dragstart', e => { grupStore.gDragSrc = { tid: c.id }; chip.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; });
      chip.addEventListener('dragend', () => chip.classList.remove('dragging'));
      chip.addEventListener('dblclick', () => window.__openDeliveryModal(c));
      poolEl.appendChild(chip);
    });
  }

  const areaEl = document.getElementById('grupArea');
  areaEl.innerHTML = '';
  const todayIds = new Set(deliveryStore.deliveries.filter(c => isToday(c.date)).map(c => c.id));
  const visibleGrups = grupStore.grups.filter(g => isToday(g.createdAt) || g.ids.some(id => todayIds.has(id)));

  if (!visibleGrups.length) {
    areaEl.innerHTML = `<div style="text-align:center;padding:24px;color:var(--muted);font-size:13px">${t('no_deliveries')}</div>`;
    return;
  }
  visibleGrups.forEach(grup => {
    const members = grup.ids.map(id => deliveryStore.deliveries.find(c => c.id === id)).filter(Boolean);
    const gPred = members.reduce((a, c) => a + memberPaletInfo(c).palet, 0);
    const gFolder = grup.statFolder || '';
    const gActual = (grup.actualPalet != null && grup.actualPalet !== '') ? grup.actualPalet : '';
    const gFolderOpts = getFolderSuggestions().map(n => `<option value="${safe(n)}"></option>`).join('');
    const grupDateStr = grup.createdAt ? `<div style="font-size:10px;color:var(--muted);margin-top:2px;font-family:var(--mono)">${safe(grup.createdAt)}</div>` : '';
    const card = document.createElement('div'); card.className = 'grup-card';
    card.innerHTML = `
      <div class="grup-card-header">
        <div class="grup-icon">${grupIconSVG()}</div>
        <div class="grup-title-block">
          <div class="grup-name-display" id="gname-disp-${safe(grup.id)}" onclick="window.__startEditGrupName('${safe(grup.id)}')">
            <span>${safe(grup.name)}</span><span class="grup-edit-hint">✎</span>
          </div>
          <input class="grup-name-edit" id="gname-edit-${safe(grup.id)}"
            onblur="window.__saveGrupName('${safe(grup.id)}')"
            onkeydown="if(event.key==='Enter')window.__saveGrupName('${safe(grup.id)}')"/>
          ${grupDateStr}
          ${grup.note ? `<div class="grup-note-text">${safe(grup.note)}</div>` : ''}
        </div>
        <span class="grup-count">${members.length} ${t('members_label')}</span>
        <div class="grup-actions">
          <button class="grup-action-btn" onclick="window.__toggleGrupNote('${safe(grup.id)}')" title="${t('add_note')}">📝</button>
          <button class="grup-action-btn archive" onclick="window.__archiveGrup('${safe(grup.id)}')" title="${t('archive_grup')}">📥 ${t('archive_grup')}</button>
          <button class="grup-action-btn danger" onclick="window.__deleteGrup('${safe(grup.id)}')" title="${t('delete_grup')}">✕</button>
        </div>
      </div>
      <div class="grup-note-edit-row" id="gnote-row-${safe(grup.id)}">
        <input class="grup-note-inp" id="gnote-inp-${safe(grup.id)}" placeholder="${safe(t('note_placeholder'))}" value="${safe(grup.note || '')}"/>
        <button class="btn-save-note" onclick="window.__saveGrupNote('${safe(grup.id)}')">${t('save_note')}</button>
      </div>
      <div class="grup-body">
        <div class="grup-drop-zone" id="gdz-${safe(grup.id)}" style="flex-direction:column;align-items:stretch">
          ${members.length
            ? members.map(c => {
              const timeStr = c.date ? (c.date.split(' ')[1] || '') : '';
              return `<div class="grup-chip-v" draggable="true" data-tid="${safe(c.id)}" data-from="${safe(grup.id)}" ondblclick="window.__openDeliveryModalById('${safe(c.id)}')">
                <div style="flex:1"><div class="grup-chip-v-name">${safe(c.name)}</div></div>
                <div class="grup-chip-v-meta">
                  <div class="grup-chip-v-date">${safe(timeStr)}</div>
                  <div class="grup-chip-v-stats">${memberPaletStr(c)} · ${c.avgPct}%</div>
                </div>
                <button class="grup-chip-v-remove" aria-label="${t('remove_member')}" title="${t('remove_member')}" onclick="window.__removeFromGrup('${safe(grup.id)}','${safe(c.id)}')">✕</button>
              </div>`;
            }).join('')
            : `<span style="font-size:11px;color:var(--muted);font-style:italic;padding:8px 0">${t('no_deliveries_pool')}</span>`}
        </div>
        ${members.length ? `<div class="grup-stats">
          <div class="grup-stat">${t('members_label')}: <span>${members.length}</span></div>
          <div class="grup-stat">${t('palet_label')}: <span>${gPred}</span></div>
          <div class="grup-stat">${t('pkg_label')}: <span>${members.reduce((a, c) => a + c.totalPkg, 0)}</span></div>
        </div>
        <div class="grup-analyze">
          <div class="grup-analyze-head">${t('analyze_add')} · ${t('shipment_total')}: <b>${gPred}</b></div>
          <div class="actual-entry-row">
            <span class="charge-label">${t('folder_label')}</span>
            <input class="charge-input actual-folder-input" list="grpFolderSuggest-${safe(grup.id)}" id="grpFolder-${safe(grup.id)}" value="${gFolder !== '' ? safe(gFolder) : ''}" placeholder="${t('folder_label')}…"/>
            <datalist id="grpFolderSuggest-${safe(grup.id)}">${gFolderOpts}</datalist>
          </div>
          <div class="actual-entry-row">
            <span class="charge-label">${t('actual_palet_label')}</span>
            <input class="charge-input" type="number" min="0" step="any" id="grpActual-${safe(grup.id)}" value="${gActual !== '' ? safe(String(gActual)) : ''}" placeholder="${safe(String(gPred))}"/>
            <button class="btn-charge-snapshot" onclick="window.__saveGrupActual('${safe(grup.id)}')">${t('save')}</button>
          </div>
          <div class="actual-delta">${_grpDelta(gActual, gPred)}</div>
        </div>` : ''}
      </div>`;
    areaEl.appendChild(card);
    const dz = card.querySelector('.grup-drop-zone');
    dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('drag-over'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'));
    dz.addEventListener('drop', e => {
      e.preventDefault(); dz.classList.remove('drag-over');
      if (!grupStore.gDragSrc) return;
      const tid = grupStore.gDragSrc.tid;
      if (grup.ids.includes(tid)) return;
      if (grupStore.gDragSrc.fromGrup) {
        const fg = grupStore.grups.find(g => g.id === grupStore.gDragSrc.fromGrup);
        if (fg) fg.ids = fg.ids.filter(id => id !== tid);
      }
      grup.ids.push(tid);
      saveGrups().then(() => renderGrupTab());
    });
    card.querySelectorAll('.grup-chip-v[draggable]').forEach(chip => {
      chip.addEventListener('dragstart', e => {
        grupStore.gDragSrc = { tid: chip.dataset.tid, fromGrup: chip.dataset.from };
        chip.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
      });
      chip.addEventListener('dragend', () => chip.classList.remove('dragging'));
    });
  });
}
