// ops_sim — Author: Levent Görgü (github.com/Levent-Gr) — (c) 2026
import './styles/main.css';

import { chargeStore, uiStore } from './state.js';
import { setLang, applyI18N } from './i18n.js';
import { todayDateStr } from './utils.js';
import {
  loadConfig, renderPkgCfgList, renderPaletVolUI,
  savePaletVol, resetPaletVol,
  markPkgChanged, savePkgEdit, deletePkg, addNewPackage,
  updateSvResult
} from './config.js';
import { applyStoredTheme, setTheme, renderThemeBtns } from './theme.js';
import { runSim, renderRecentCalcs } from './sim.js';
import {
  loadDeliveries, loadDeliveryFolders, renderDeliveries,
  createDeliveryFolder, deleteDeliveryFolder, removeFromDeliveryFolder, deleteDelivery
} from './delivery.js';
import {
  loadGrups, renderGrupTab,
  createGrup, deleteGrup, removeFromGrup,
  startEditGrupName, saveGrupName, toggleGrupNote, saveGrupNote,
  archiveGrup, saveGrupActual
} from './grup.js';
import {
  renderHistory, toggleHistDetail, deleteHistItem, clearHistory,
  openDeliveryModal, openDeliveryModalById, openDeliveryModalFromObj,
  closeModal, closeModalDirect, openChargeArchiveModal, openChargeArchiveById,
  saveActualPalet, saveGrupArchiveActual
} from './history.js';
import { renderStats } from './stats.js';
import {
  loadCharges, startCharge, startChargeFromSim, stopCharge,
  toggleChargePanel, manualAddSnapshot, recalibrateAvg, toggleRecalibForm,
  downloadChargeCSV, dismissChargeAlert, saveAlertSnapshot,
  startChargeAlertTimer, checkChargeAlerts, autoStopExpiredCharges,
  startEditEndTime, cancelEndTimeEdit, saveChargeEndTime,
  startEditSnapshot, cancelEditSnapshot, saveEditSnapshot
} from './charge.js';
import {
  exportFullBackup, importFullBackup, exportProfile, importProfile,
  clearAllData, clearDeliveriesData, clearGroupData
} from './io.js';

// ─── Inline onclick handlers için window expose ─────────────────
// Template literal'ler içindeki onclick="..." çağrıları için global referans
Object.assign(window, {
  __renderDeliveries: renderDeliveries,
  __renderHistory: renderHistory,
  __renderGrupTab: renderGrupTab,
  __openDeliveryModal: openDeliveryModal,
  __openDeliveryModalById: openDeliveryModalById,
  __openDeliveryModalFromObj: openDeliveryModalFromObj,
  __closeModalDirect: closeModalDirect,
  __toggleHistDetail: toggleHistDetail,
  __deleteHistItem: deleteHistItem,
  __toggleChargePanel: toggleChargePanel,
  __startCharge: startCharge,
  __startChargeFromSim: startChargeFromSim,
  __stopCharge: stopCharge,
  __manualAddSnapshot: manualAddSnapshot,
  __recalibrateAvg: recalibrateAvg,
  __toggleRecalibForm: toggleRecalibForm,
  __downloadChargeCSV: downloadChargeCSV,
  __saveAlertSnapshot: saveAlertSnapshot,
  __startEditEndTime: startEditEndTime,
  __cancelEndTimeEdit: cancelEndTimeEdit,
  __saveChargeEndTime: saveChargeEndTime,
  __startEditSnapshot: startEditSnapshot,
  __cancelEditSnapshot: cancelEditSnapshot,
  __saveEditSnapshot: saveEditSnapshot,
  __openChargeArchiveFromDelivery: openChargeArchiveById,
  __saveActualPalet: saveActualPalet,
  __startEditGrupName: startEditGrupName,
  __saveGrupName: saveGrupName,
  __toggleGrupNote: toggleGrupNote,
  __saveGrupNote: saveGrupNote,
  __archiveGrup: archiveGrup,
  __saveGrupActual: saveGrupActual,
  __saveGrupArchiveActual: saveGrupArchiveActual,
  __deleteGrup: deleteGrup,
  __removeFromGrup: removeFromGrup,
  __deleteDeliveryFolder: deleteDeliveryFolder,
  __removeFromDeliveryFolder: removeFromDeliveryFolder,
  __deleteDelivery: deleteDelivery,
  __markPkgChanged: markPkgChanged,
  __savePkgEdit: savePkgEdit,
  __deletePkg: deletePkg
});

// ─── Tab geçişi ─────────────────────────────────────────────────
async function showTab(id, el) {
  document.querySelectorAll('.tab-view').forEach(tv => tv.classList.remove('active'));
  document.querySelectorAll('.nav').forEach(n => n.classList.remove('on'));
  document.getElementById('tab-' + id).classList.add('active');
  el.classList.add('on');
  if (id === 'gecmis') renderHistory();
  if (id === 'istatistik') { await loadDeliveries(); await loadDeliveryFolders(); await loadGrups(); renderStats(); }
  if (id === 'delivery') { await autoStopExpiredCharges(); await loadDeliveries(); await loadDeliveryFolders(); renderDeliveries(); }
  if (id === 'grup') { await autoStopExpiredCharges(); await loadDeliveries(); await loadGrups(); renderGrupTab(); }
  if (id === 'ayarlar') { renderThemeBtns(); renderPaletVolUI(); renderPkgCfgList(); }
}

// ─── Event listener kurulumu ─────────────────────────────────────
function wireEvents() {
  // Sidebar navigation
  document.querySelectorAll('.nav[data-tab]').forEach(navEl => {
    navEl.addEventListener('click', () => showTab(navEl.dataset.tab, navEl));
  });

  // Dil butonları
  document.getElementById('langTR')?.addEventListener('click', () => setLang('tr'));
  document.getElementById('langEN')?.addEventListener('click', () => setLang('en'));

  // Simülasyon
  document.getElementById('runBtn')?.addEventListener('click', runSim);

  // Hesaplama ekranı — şarj ⚡ butonu: aktifse alanları göster (pasif=soluk, aktif=turuncu)
  document.getElementById('simChargeToggle')?.addEventListener('click', e => {
    const btn = e.currentTarget;
    const on = !btn.classList.contains('active');
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    const f = document.getElementById('simChargeFields');
    if (f) f.style.display = on ? 'block' : 'none';
  });

  // Input — satır sayısı
  const inputEl = document.getElementById('input');
  if (inputEl) {
    inputEl.addEventListener('input', () => {
      const lines = inputEl.value.trim().split('\n').filter(Boolean);
      const lc = document.getElementById('lineCount');
      if (lc) lc.innerHTML = lines.length + ' <span data-i18n="lines">satır</span>';
      if (lines.length) document.getElementById('inputWarn')?.classList.remove('show');
      applyI18N();
    });
  }

  // Title → Enter input'a odaklan
  document.getElementById('titleInput')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('input').focus();
  });

  // Grup oluştur — Enter
  document.getElementById('grupNameInput')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') createGrup();
  });
  document.getElementById('btnCreateGrup')?.addEventListener('click', createGrup);

  // Klasör oluştur
  document.getElementById('btnCreateDeliveryFolder')?.addEventListener('click', createDeliveryFolder);

  // Ayarlar — tema butonları
  document.querySelectorAll('.theme-btn').forEach(btn => {
    btn.addEventListener('click', () => setTheme(btn.dataset.theme));
  });

  // Ayarlar — palet hacmi
  ['svLen', 'svWid', 'svHgt'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', updateSvResult);
  });
  document.getElementById('btnSavePaletVol')?.addEventListener('click', savePaletVol);
  document.getElementById('btnResetPaletVol')?.addEventListener('click', resetPaletVol);

  // Ayarlar — paket ekle
  document.getElementById('btnAddPkg')?.addEventListener('click', addNewPackage);

  // Ayarlar — backup/import
  document.getElementById('btnExportFull')?.addEventListener('click', exportFullBackup);
  document.getElementById('fileInputFull')?.addEventListener('change', importFullBackup);
  document.getElementById('btnExportProfile')?.addEventListener('click', exportProfile);
  document.getElementById('fileInputProfile')?.addEventListener('change', importProfile);
  document.getElementById('btnImportFullTrigger')?.addEventListener('click', () =>
    document.getElementById('fileInputFull').click());
  document.getElementById('btnImportProfileTrigger')?.addEventListener('click', () =>
    document.getElementById('fileInputProfile').click());

  // Ayarlar — veri sıfırlama
  document.getElementById('btnClearAll')?.addEventListener('click', clearAllData);
  document.getElementById('btnClearDeliveries')?.addEventListener('click', clearDeliveriesData);
  document.getElementById('btnClearGroups')?.addEventListener('click', clearGroupData);

  // Geçmiş — tümünü sil
  document.getElementById('btnClearHist')?.addEventListener('click', clearHistory);

  // Modal — overlay tıklanırsa kapat, ESC
  document.getElementById('detailModal')?.addEventListener('click', closeModal);
  document.getElementById('modalClose')?.addEventListener('click', closeModalDirect);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && document.getElementById('detailModal').classList.contains('open')) closeModalDirect();
  });

  // Alert dismiss
  document.getElementById('chargeAlertDismiss')?.addEventListener('click', dismissChargeAlert);

  // Sekme yeniden görünür olunca tazele:
  //  • "bugün" filtrelerinin gece yarısı geçişinde bayatlamasını giderir (B3)
  //  • arka planda throttle olan şarj alarmını anında yeniden kontrol eder (B4)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshOnVisible();
  });

  // Gün değişimi izleyici (B3 — açık/görünür kalan sekme):
  //  visibilitychange yalnız sekme gizlenip geri gelince tetiklenir. Uygulama tüm
  //  gece açık ve görünür kalırsa (örn. duvardaki ekran) o olay hiç gerçekleşmez ve
  //  "bugün" filtreleri gece yarısı geçişinde bayatlardı. Bu hafif tick (60sn) gün
  //  string'i değişince aktif sekmeyi tazeler — ekstra render yalnız günde bir kez olur.
  startDayChangeWatcher();
}

let _lastDayStr = todayDateStr();
function startDayChangeWatcher() {
  setInterval(() => {
    const today = todayDateStr();
    if (today !== _lastDayStr) {
      _lastDayStr = today;
      refreshOnVisible();
    }
  }, 60 * 1000);
}

async function refreshOnVisible() {
  try {
    const active = document.querySelector('.nav.on')?.dataset.tab;
    // Bitişi geçen aktif şarjları otomatik durdur (⚡ soluğa döner) — sekmeye dönünce de geçerli.
    await autoStopExpiredCharges();
    // Açık bir şarj paneli varsa teslimat listesini yeniden çizme: panel (ve
    // yazılmakta olan veri) kapanmasın. Panel yalnız ⚡ butonuyla kapatılır.
    const chargePanelOpen = active === 'delivery' &&
      [...document.querySelectorAll('[id^="charge-panel-"]')].some(p => p.style.display === 'block');
    if (active === 'delivery') {
      if (!chargePanelOpen) { await loadDeliveries(); await loadDeliveryFolders(); renderDeliveries(); }
    } else if (active === 'grup') {
      await loadDeliveries(); await loadGrups(); renderGrupTab();
    } else if (active === 'gecmis') {
      renderHistory();
    } else {
      renderRecentCalcs();
    }
    if (chargeStore.chargeCache.some(c => c.active)) checkChargeAlerts();
  } catch (e) {
    console.warn('[ops-sim] refreshOnVisible hatası:', e);
  }
}

// ─── Init ───────────────────────────────────────────────────────
(async () => {
  applyStoredTheme();
  setLang(uiStore.currentLang);
  await loadConfig();
  await loadDeliveries();
  await loadGrups();
  await loadDeliveryFolders();
  await loadCharges();
  await autoStopExpiredCharges();
  wireEvents();
  renderRecentCalcs();
  if (chargeStore.chargeCache.some(c => c.active)) startChargeAlertTimer();
})();
