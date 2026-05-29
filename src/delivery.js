import { chargeStore, deliveryStore, grupStore } from './state.js';
import { STORES, idbGet, idbPut, idbDelete, idbGetAll } from './db.js';
import { t } from './i18n.js';
import { isToday, safe } from './utils.js';
import { grupIconSVG } from './icons.js';
import { buildChargePanelHTML } from './charge.js';
import { confirmDialog } from './dialog.js';

export async function loadDeliveries() {
  try {
    deliveryStore.deliveries = await idbGetAll(STORES.deliveries);
    deliveryStore.deliveries.sort((a, b) => (b._ts || 0) - (a._ts || 0));
  } catch { deliveryStore.deliveries = []; }
}

export async function loadDeliveryFolders() {
  try {
    const f = await idbGet(STORES.config, 'deliveryFolders');
    deliveryStore.deliveryFolders = Array.isArray(f) ? f : [];
  } catch { deliveryStore.deliveryFolders = []; }
}

export async function saveDeliveryFolders() {
  await idbPut(STORES.config, deliveryStore.deliveryFolders, 'deliveryFolders');
}

export async function createDeliveryFolder() {
  const inp = document.getElementById('deliveryFolderNameInput');
  const name = inp.value.trim();
  if (!name) return;
  deliveryStore.deliveryFolders.push({ id: Math.random().toString(36).slice(2, 9), name, ids: [] });
  await saveDeliveryFolders();
  inp.value = '';
  renderDeliveries();
}

export async function deleteDeliveryFolder(fid) {
  if (!(await confirmDialog(t('delete_grup') + '?'))) return;
  deliveryStore.deliveryFolders = deliveryStore.deliveryFolders.filter(f => f.id !== fid);
  await saveDeliveryFolders();
  renderDeliveries();
}

export async function removeFromDeliveryFolder(fid, cid) {
  const f = deliveryStore.deliveryFolders.find(f => f.id === fid);
  if (f) f.ids = f.ids.filter(id => id !== cid);
  await saveDeliveryFolders();
  renderDeliveries();
}

export async function deleteDelivery(cid) {
  if (!(await confirmDialog(t('delete_grup') + '?'))) return;
  await idbDelete(STORES.deliveries, cid);
  deliveryStore.deliveries = deliveryStore.deliveries.filter(c => c.id !== cid);
  grupStore.grups.forEach(g => { g.ids = g.ids.filter(id => id !== cid); });
  deliveryStore.deliveryFolders.forEach(f => { f.ids = f.ids.filter(id => id !== cid); });
  await saveDeliveryFolders();
  await idbPut(STORES.config, grupStore.grups, 'grups');
  renderDeliveries();
  if (typeof window.__renderGrupTab === 'function') window.__renderGrupTab();
}

export function renderDeliveries() {
  const poolEl = document.getElementById('deliveryPool');
  if (!poolEl) return;
  const assigned = new Set(deliveryStore.deliveryFolders.flatMap(f => f.ids));
  const free = deliveryStore.deliveries.filter(c => !assigned.has(c.id) && isToday(c.date));

  if (!deliveryStore.deliveries.filter(c => isToday(c.date)).length) {
    poolEl.innerHTML = `<span class="pool-empty">${t('no_deliveries')}</span>`;
  } else if (!free.length) {
    poolEl.innerHTML = `<span class="pool-empty">${t('all_assigned')}</span>`;
  } else {
    poolEl.innerHTML = '';
    free.forEach(c => {
      const chargeRec = chargeStore.chargeCache.find(ch => ch.deliveryId === c.id && ch.active);
      const chip = document.createElement('div');
      chip.className = 'pool-chip-v'; chip.draggable = true; chip.dataset.cid = c.id;
      const timeStr = c.date ? (c.date.split(' ')[1] || '') : '';
      chip.innerHTML = `
        <div style="flex:1">
          <div class="pool-chip-v-name">${safe(c.name)}</div>
        </div>
        <div class="pool-chip-v-meta">
          <div class="pool-chip-v-date">${safe(timeStr)}</div>
          <div class="pool-chip-v-stats">${c.existingPalet > 0 ? (c.palets + c.existingPalet) + 'p (' + c.palets + '+' + c.existingPalet + ')' : c.palets + 'p'} · ${c.avgPct}%</div>
        </div>
        <button style="background:none;border:1px solid ${chargeRec ? '#f97316' : 'var(--border)'};border-radius:5px;cursor:pointer;padding:5px 11px;font-size:12px;color:${chargeRec ? '#f97316' : 'var(--muted)'};transition:.15s;white-space:nowrap;margin-left:4px" title="Şarj Takibi" onclick="event.stopPropagation();window.__toggleChargePanel('${safe(c.id)}')">⚡</button>
        <button style="background:none;border:1px solid var(--border);border-radius:5px;cursor:pointer;padding:5px 11px;font-size:12px;color:var(--muted);transition:.15s;white-space:nowrap;margin-left:4px" title="Sil" onclick="event.stopPropagation();window.__deleteDelivery('${safe(c.id)}')">✕</button>`;
      chip.addEventListener('dragstart', e => { deliveryStore.deliveryDragSrc = { cid: c.id }; chip.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; });
      chip.addEventListener('dragend', () => chip.classList.remove('dragging'));
      chip.addEventListener('dblclick', () => window.__openDeliveryModal(c));
      poolEl.appendChild(chip);
      const panelDiv = document.createElement('div'); panelDiv.id = 'charge-panel-' + c.id; panelDiv.style.display = 'none';
      panelDiv.innerHTML = buildChargePanelHTML(c, chargeRec);
      poolEl.appendChild(panelDiv);
    });
  }

  const areaEl = document.getElementById('deliveryFolderArea');
  if (!areaEl) return;
  areaEl.innerHTML = '';
  const todayDelivIds = new Set(deliveryStore.deliveries.filter(c => isToday(c.date)).map(c => c.id));
  const visibleFolders = deliveryStore.deliveryFolders.filter(folder =>
    folder.ids.length === 0 || folder.ids.some(id => todayDelivIds.has(id))
  );

  visibleFolders.forEach(folder => {
    const members = folder.ids.map(id => deliveryStore.deliveries.find(c => c.id === id)).filter(c => c && isToday(c.date));
    const card = document.createElement('div'); card.className = 'grup-card';
    const membersHTML = members.length
      ? members.map(c => {
        const timeStr = c.date ? (c.date.split(' ')[1] || '') : '';
        const chargeRec = chargeStore.chargeCache.find(ch => ch.deliveryId === c.id && ch.active);
        return `<div>
          <div class="grup-chip-v" draggable="true" data-cid="${safe(c.id)}" data-from="${safe(folder.id)}" ondblclick="window.__openDeliveryModalById('${safe(c.id)}')">
            <div style="flex:1">
              <div class="grup-chip-v-name">${safe(c.name)}</div>
            </div>
            <div class="grup-chip-v-meta">
              <div class="grup-chip-v-date">${safe(timeStr)}</div>
              <div class="grup-chip-v-stats">${c.existingPalet > 0 ? (c.palets + c.existingPalet) + 'p (' + c.palets + '+' + c.existingPalet + ')' : c.palets + 'p'} · ${c.avgPct}%</div>
            </div>
            <button style="background:none;border:1px solid ${chargeRec ? '#f97316' : 'var(--border)'};border-radius:5px;cursor:pointer;padding:5px 11px;font-size:12px;color:${chargeRec ? '#f97316' : 'var(--muted)'};transition:.15s;white-space:nowrap;margin-left:4px" title="Şarj Takibi" onclick="event.stopPropagation();window.__toggleChargePanel('${safe(c.id)}')">⚡</button>
            <button class="grup-chip-v-remove" style="padding:5px 11px;font-size:12px" onclick="window.__removeFromDeliveryFolder('${safe(folder.id)}','${safe(c.id)}')" title="Klasörden çıkar">✕</button>
            <button class="grup-chip-v-remove" style="margin-left:2px;padding:5px 11px;font-size:12px" onclick="event.stopPropagation();window.__deleteDelivery('${safe(c.id)}')" title="Teslimatı sil">✕</button>
          </div>
          <div id="charge-panel-${safe(c.id)}" style="display:none;margin:0 0 4px 0">${buildChargePanelHTML(c, chargeRec)}</div>
        </div>`;
      }).join('')
      : `<span style="font-size:11px;color:var(--muted);font-style:italic;padding:8px 0">${t('no_deliveries_pool')}</span>`;
    card.innerHTML = `
      <div class="grup-card-header">
        <div class="grup-icon">${grupIconSVG()}</div>
        <div class="grup-title-block">
          <div class="grup-name-display" style="cursor:default"><span>${safe(folder.name)}</span></div>
        </div>
        <span class="grup-count">${members.length} ${t('members_label')}</span>
        <div class="grup-actions">
          <button class="grup-action-btn danger" onclick="window.__deleteDeliveryFolder('${safe(folder.id)}')" title="${t('delete_grup')}">✕</button>
        </div>
      </div>
      <div class="grup-body">
        <div class="grup-drop-zone" id="cfdz-${safe(folder.id)}" style="flex-direction:column;align-items:stretch">
          ${membersHTML}
        </div>
      </div>`;
    areaEl.appendChild(card);
    const dz = card.querySelector('.grup-drop-zone');
    dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('drag-over'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'));
    dz.addEventListener('drop', e => {
      e.preventDefault(); dz.classList.remove('drag-over');
      if (!deliveryStore.deliveryDragSrc) return;
      const cid = deliveryStore.deliveryDragSrc.cid;
      if (folder.ids.includes(cid)) return;
      if (deliveryStore.deliveryDragSrc.fromFolder) {
        const ff = deliveryStore.deliveryFolders.find(f => f.id === deliveryStore.deliveryDragSrc.fromFolder);
        if (ff) ff.ids = ff.ids.filter(id => id !== cid);
      }
      folder.ids.push(cid);
      saveDeliveryFolders().then(() => renderDeliveries());
    });
    card.querySelectorAll('.grup-chip-v[draggable]').forEach(chip => {
      chip.addEventListener('dragstart', e => {
        deliveryStore.deliveryDragSrc = { cid: chip.dataset.cid, fromFolder: chip.dataset.from };
        chip.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
      });
      chip.addEventListener('dragend', () => chip.classList.remove('dragging'));
    });
  });
}
