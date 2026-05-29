import { chargeStore, deliveryStore, grupStore } from './state.js';
import { STORES, idbGet, idbPut, idbGetAll, idbClear, idbDelete } from './db.js';
import { t } from './i18n.js';
import { nowStr, downloadJSON } from './utils.js';
import { loadConfig, renderPkgCfgList, renderPaletVolUI } from './config.js';
import { loadDeliveries, loadDeliveryFolders, renderDeliveries } from './delivery.js';
import { loadGrups, renderGrupTab } from './grup.js';
import { renderRecentCalcs } from './sim.js';
import { loadCharges } from './charge.js';
import { confirmDialog, alertDialog } from './dialog.js';

// Yedek dosyasındaki config bölümünün geçerli yapıda olduğunu doğrular.
// Geçersiz tip/array durumunda exception atar; çağıran try/catch ile yakalar.
function _validateConfig(cfg) {
  if (!cfg || typeof cfg !== 'object') throw new Error('invalid config block');
  if (cfg.dims) {
    if (typeof cfg.dims !== 'object' || Array.isArray(cfg.dims)) throw new Error('invalid dims');
    for (const [k, v] of Object.entries(cfg.dims)) {
      if (!Array.isArray(v) || v.length !== 3 || !v.every(n => Number.isFinite(n) && n > 0)) {
        throw new Error(`invalid dims for ${k}`);
      }
    }
  }
  if (cfg.cats) {
    if (typeof cfg.cats !== 'object' || Array.isArray(cfg.cats)) throw new Error('invalid cats');
    for (const key of ['small', 'mid', 'big']) {
      if (cfg.cats[key] != null && !Array.isArray(cfg.cats[key])) throw new Error(`invalid cats.${key}`);
    }
  }
  if (cfg.limits && (typeof cfg.limits !== 'object' || Array.isArray(cfg.limits))) {
    throw new Error('invalid limits');
  }
  if (cfg.palet && typeof cfg.palet !== 'object') throw new Error('invalid palet');
}

export function showIOToast(msg, isErr = false) {
  const tEl = document.getElementById('ioToast');
  tEl.textContent = msg;
  tEl.className = 'cfg-toast' + (isErr ? ' error-toast' : '') + ' show';
  setTimeout(() => tEl.classList.remove('show'), 3500);
}

export async function exportFullBackup() {
  const allDeliveries = await idbGetAll(STORES.deliveries);
  const allHist = await idbGetAll(STORES.history);
  const allCharges = await idbGetAll(STORES.charges);
  const dims = await idbGet(STORES.config, 'dims');
  const cats = await idbGet(STORES.config, 'cats');
  const limits = await idbGet(STORES.config, 'limits');
  const palet = await idbGet(STORES.config, 'palet');
  const grps = await idbGet(STORES.config, 'grups');
  const folders = await idbGet(STORES.config, 'deliveryFolders');
  downloadJSON({
    _type: 'ops_sim_full_backup', _version: 3, _date: nowStr(),
    config: {
      dims: dims || {},
      cats: cats || { small: [], mid: [], big: [] },
      limits: limits || {},
      palet: palet || {}
    },
    deliveries: allDeliveries,
    history: allHist,
    charges: allCharges || [],
    grups: grps || [],
    deliveryFolders: folders || []
  }, 'ops_backup_' + new Date().toISOString().slice(0, 10) + '.json');
  showIOToast('✓ ' + t('toast_exported'));
}

export async function importFullBackup(e) {
  const file = e.target.files[0]; if (!file) return; e.target.value = '';
  try {
    const data = JSON.parse(await file.text());
    if (data._type !== 'ops_sim_full_backup') throw new Error(t('err_invalid_file'));
    _validateConfig(data.config || {});
    if (!Array.isArray(data.deliveries || data.cpts || [])) throw new Error('invalid deliveries');
    if (!Array.isArray(data.history || [])) throw new Error('invalid history');
    if (data.charges != null && !Array.isArray(data.charges)) throw new Error('invalid charges');
    if (!(await confirmDialog('Overwrite all data?'))) return;
    const cfg = data.config || {};
    await idbPut(STORES.config, cfg.dims || {}, 'dims');
    await idbPut(STORES.config, cfg.cats || { small: [], mid: [], big: [] }, 'cats');
    await idbPut(STORES.config, cfg.limits || {}, 'limits');
    await idbPut(STORES.config, cfg.palet || {}, 'palet');
    await idbPut(STORES.config, data.grups || [], 'grups');
    // Geriye dönük uyumluluk: eski yedeklerde cptFolders/cpts olabilir
    await idbPut(STORES.config, data.deliveryFolders || data.cptFolders || [], 'deliveryFolders');
    await idbClear(STORES.deliveries);
    for (const c of (data.deliveries || data.cpts || [])) await idbPut(STORES.deliveries, c);
    await idbClear(STORES.history);
    for (const h of (data.history || [])) await idbPut(STORES.history, h);
    // Charges store v3 yedeklerde mevcut; eski yedeklerle uyumluluk için opsiyonel
    if (Array.isArray(data.charges)) {
      await idbClear(STORES.charges);
      for (const ch of data.charges) await idbPut(STORES.charges, ch);
    }
    await loadConfig();
    await loadDeliveries();
    await loadGrups();
    await loadDeliveryFolders();
    await loadCharges();
    renderRecentCalcs();
    showIOToast('✓ ' + t('toast_restored'));
  } catch (err) { showIOToast('⚠ ' + err.message, true); }
}

export async function exportProfile() {
  const dims = await idbGet(STORES.config, 'dims');
  const cats = await idbGet(STORES.config, 'cats');
  const limits = await idbGet(STORES.config, 'limits');
  const palet = await idbGet(STORES.config, 'palet');
  downloadJSON({
    _type: 'ops_sim_profile', _version: 2, _date: nowStr(),
    config: {
      dims: dims || {},
      cats: cats || { small: [], mid: [], big: [] },
      limits: limits || {},
      palet: palet || {}
    }
  }, 'ops_profile_' + new Date().toISOString().slice(0, 10) + '.json');
  showIOToast('✓ ' + t('toast_profile_exported'));
}

export async function importProfile(e) {
  const file = e.target.files[0]; if (!file) return; e.target.value = '';
  try {
    const data = JSON.parse(await file.text());
    if (data._type !== 'ops_sim_profile') throw new Error(t('err_invalid_profile'));
    _validateConfig(data.config || {});
    if (!(await confirmDialog('Update package and pallet settings?'))) return;
    const cfg = data.config || {};
    await idbPut(STORES.config, cfg.dims || {}, 'dims');
    await idbPut(STORES.config, cfg.cats || { small: [], mid: [], big: [] }, 'cats');
    await idbPut(STORES.config, cfg.limits || {}, 'limits');
    await idbPut(STORES.config, cfg.palet || {}, 'palet');
    await loadConfig();
    renderPkgCfgList();
    renderPaletVolUI();
    showIOToast('✓ ' + t('toast_profile_loaded') + ' (' + Object.keys(cfg.dims || {}).length + ')');
  } catch (err) { showIOToast('⚠ ' + err.message, true); }
}

export async function clearAllData() {
  if (!(await confirmDialog(t('clear_all') + '?'))) return;
  await Promise.all([
    idbClear(STORES.deliveries),
    idbClear(STORES.history),
    idbClear(STORES.charges),
    idbDelete(STORES.config, 'dims'),
    idbDelete(STORES.config, 'cats'),
    idbDelete(STORES.config, 'limits'),
    idbDelete(STORES.config, 'palet'),
    idbDelete(STORES.config, 'grups'),
    idbDelete(STORES.config, 'deliveryFolders')
  ]);
  await loadConfig();
  deliveryStore.deliveries = []; grupStore.grups = []; deliveryStore.deliveryFolders = []; chargeStore.chargeCache = [];
  await alertDialog('Done.');
}

export async function clearDeliveriesData() {
  if (!(await confirmDialog(t('clear_del') + '?'))) return;
  await idbClear(STORES.deliveries);
  deliveryStore.deliveries = [];
  renderDeliveries();
}

export async function clearGroupData() {
  if (!(await confirmDialog(t('clear_grp') + '?'))) return;
  await idbDelete(STORES.config, 'grups');
  grupStore.grups = [];
  renderGrupTab();
}
