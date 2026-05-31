import Chart from 'chart.js/auto';
import { chargeStore, deliveryStore, historyStore, uiStore } from './state.js';
import { STORES, idbGetAll, idbPut } from './db.js';
import { t } from './i18n.js';
import { uid, nowStr, safe } from './utils.js';
import { simulatePacking } from './sim.js';
import { alertDialog } from './dialog.js';
import {
  ICON_BOLT, ICON_TREND, ICON_LIST, ICON_EDIT, ICON_BOX,
  ICON_STATUS, ICON_DOWNLOAD, ICON_GEAR
} from './icons.js';

// ─── Veri katmanı ────────────────────────────────────────────────
export async function loadCharges() {
  try { chargeStore.chargeCache = await idbGetAll(STORES.charges); }
  catch { chargeStore.chargeCache = []; }
  // Bugünden önce başlamış aktif şarjları kapat
  const today = new Date();
  const todayKey = today.getFullYear() + '-' + today.getMonth() + '-' + today.getDate();
  for (const rec of chargeStore.chargeCache) {
    if (!rec.active) continue;
    const startMs = rec.startedAtMs || rec.snapshots?.[0]?.tsMs || 0;
    if (!startMs) continue;
    const sd = new Date(startMs);
    const sk = sd.getFullYear() + '-' + sd.getMonth() + '-' + sd.getDate();
    if (sk !== todayKey) {
      rec.active = false;
      rec.stoppedAt = rec.stoppedAt || nowStr();
      rec.stoppedAtMs = rec.stoppedAtMs || Date.now();
      try { await idbPut(STORES.charges, rec); } catch {}
      try { await saveChargeToHistory(rec); } catch {}
    }
  }
}

export async function saveCharge(rec) {
  await idbPut(STORES.charges, rec);
  const idx = chargeStore.chargeCache.findIndex(c => c.id === rec.id);
  if (idx >= 0) chargeStore.chargeCache[idx] = rec;
  else chargeStore.chargeCache.push(rec);
}

async function saveChargeToHistory(rec) {
  try {
    const cpt = deliveryStore.deliveries.find(c => c.id === rec.deliveryId) || {};
    const st = calcArchivedFinalStatus(rec, cpt);
    const histRec = {
      _type: 'charge_archive',
      id: 'cha_' + rec.id,
      chargeId: rec.id,
      deliveryId: rec.deliveryId,
      deliveryName: rec.deliveryName,
      chargeEndTime: rec.chargeEndTime,
      avgPkgPerPalet: rec.avgPkgPerPalet,
      startedAt: rec.startedAt,
      stoppedAt: rec.stoppedAt || nowStr(),
      snapshots: rec.snapshots || [],
      calibrations: rec.calibrations || [],
      predictedFinalPalet: st.finalPalet,
      predictedFinalPkg: st.arrivedPkg + st.remainingPkg,
      date: rec.startedAt || nowStr(),
      _ts: rec.startedAtMs || Date.now()
    };
    await idbPut(STORES.history, histRec);
  } catch (e) { console.warn('saveChargeToHistory hatası:', e); }
}

// ─── Hesaplamalar ────────────────────────────────────────────────
export function calcShippedSoFar(rec) {
  if (!rec.snapshots || rec.snapshots.length < 1) return { pkg: 0, palet: 0 };
  const first = rec.snapshots[0];
  const last = rec.snapshots[rec.snapshots.length - 1];
  const totalShipped = rec.snapshots.reduce((a, s) => a + (s.shipped || 0), 0);
  const arrivedPkg = Math.max(0, (last.total - first.total) + totalShipped);
  const ppp = rec.avgPkgPerPalet || 150;
  return { pkg: arrivedPkg, palet: Math.floor(arrivedPkg / ppp) };
}

export function calcAvgRateFromStart(rec, untilIdx) {
  const snaps = rec.snapshots;
  if (!snaps || untilIdx < 1 || untilIdx >= snaps.length) return 0;
  const first = snaps[0];
  const target = snaps[untilIdx];
  const dtMin = (target.tsMs - first.tsMs) / 60000;
  if (dtMin <= 0) return 0;
  let totalShipped = 0;
  for (let i = 1; i <= untilIdx; i++) totalShipped += (snaps[i].shipped || 0);
  const totalIncoming = (target.total - first.total) + totalShipped;
  return Math.max(0, totalIncoming / dtMin);
}

export function calcForecastAtIndex(rec, cpt, idx) {
  const snaps = rec.snapshots;
  if (idx < 1 || idx >= snaps.length) return null;
  const ratePerMin = calcAvgRateFromStart(rec, idx);
  const snapTs = snaps[idx].tsMs;
  const [eh, em] = rec.chargeEndTime.split(':').map(Number);
  const snapDate = new Date(snapTs);
  const endMs = new Date(snapDate.getFullYear(), snapDate.getMonth(), snapDate.getDate(), eh, em, 0).getTime();
  const remainMin = Math.max(0, (endMs - snapTs) / 60000);
  const extraPkg = Math.round(ratePerMin * remainMin);
  const ppp = snaps[idx].avgAtTime || rec.avgPkgPerPalet || 150;
  const extraPalet = Math.ceil(extraPkg / ppp);
  return { ratePerMin: Math.round(ratePerMin * 10) / 10, remainMin: Math.round(remainMin), extraPkg, extraPalet, avgUsed: ppp };
}

export function calcRateFromSnapshots(prev, curr) {
  const dt = (curr.tsMs - prev.tsMs) / 60000;
  if (dt <= 0) return 0;
  const realIncoming = (curr.total - prev.total) + (curr.shipped || 0);
  return Math.max(0, realIncoming / dt);
}

export function calcForecast(rec, cpt) {
  if (rec.snapshots.length < 2) return null;
  const lastIdx = rec.snapshots.length - 1;
  const ratePerMin = calcAvgRateFromStart(rec, lastIdx);
  const now = new Date();
  const [eh, em] = rec.chargeEndTime.split(':').map(Number);
  const endMs = new Date(now.getFullYear(), now.getMonth(), now.getDate(), eh, em, 0).getTime();
  const remainMin = Math.max(0, (endMs - Date.now()) / 60000);
  const extraPkg = Math.round(ratePerMin * remainMin);
  const ppp = rec.avgPkgPerPalet || 150;
  const extraPalet = Math.ceil(extraPkg / ppp);
  return { extraPkg, extraPalet, ratePerMin: Math.round(ratePerMin * 10) / 10, remainMin: Math.round(remainMin), avgPkgPerPalet: ppp };
}

export function calcCurrentStatus(rec, cpt) {
  const existingPalet = cpt.existingPalet || 0;
  const simPalet = cpt.palets || 0;
  const arrived = calcShippedSoFar(rec);
  const fc = calcForecast(rec, cpt);
  const remainingPkg = fc ? fc.extraPkg : 0;
  const remainingPalet = fc ? fc.extraPalet : 0;
  const finalPalet = existingPalet + simPalet + arrived.palet + remainingPalet;
  return {
    existingPalet, simPalet,
    arrivedPkg: arrived.pkg, arrivedPalet: arrived.palet,
    remainingPkg, remainingPalet,
    finalPalet,
    avgPkgPerPalet: rec.avgPkgPerPalet || 0
  };
}

// Bir teslimata ait arşivlenmiş şarj kaydını bulur. TES kaydı ile charge_archive ayrı
// uid aldığından eşleşme isim (+ aynı gün önceliği) ile yapılır.
export function findArchivedChargeForDelivery(deliveryId, deliveryObj) {
  const name = deliveryObj && (deliveryObj.deliveryName || deliveryObj.name);
  const dayOf = s => String(s || '').split(/[\s,]+/)[0];
  const wantDay = deliveryObj ? dayOf(deliveryObj.date || deliveryObj.archivedAt) : '';
  let candidates = historyStore.histCache.filter(h =>
    h._type === 'charge_archive' && Array.isArray(h.snapshots) && h.snapshots.length &&
    (h.deliveryId === deliveryId || (name && h.deliveryName === name)));
  if (!candidates.length) return null;
  if (wantDay) {
    const sameDay = candidates.filter(h => dayOf(h.startedAt) === wantDay || dayOf(h.stoppedAt) === wantDay);
    if (sameDay.length) candidates = sameDay;
  }
  candidates.sort((a, b) => (b._ts || 0) - (a._ts || 0));
  return candidates[0];
}

// charge_archive kaydından şarj sonu tahmini palet: kayıtta saklıysa onu, yoksa anında hesapla.
export function getPredictedFinalPalet(h, cpt) {
  if (!h) return null;
  if (typeof h.predictedFinalPalet === 'number') return h.predictedFinalPalet;
  const recLike = {
    id: h.chargeId || h.id, deliveryId: h.deliveryId, deliveryName: h.deliveryName,
    snapshots: h.snapshots, calibrations: h.calibrations || [],
    avgPkgPerPalet: h.avgPkgPerPalet, chargeEndTime: h.chargeEndTime,
    startedAt: h.startedAt, startedAtMs: h._ts
  };
  return calcArchivedFinalStatus(recLike, cpt || {}).finalPalet;
}

// Bu teslimatın AKTİF şarjını bulur. Geçmiş'ten açılınca TES id'si şarjın deliveryId'siyle
// eşleşmez; bu yüzden id BULAMAZSA isim (+ aynı gün) ile arar.
export function findActiveChargeForDelivery(deliveryId, deliveryObj) {
  const direct = chargeStore.chargeCache.find(c => c.active && c.deliveryId === deliveryId);
  if (direct) return direct;
  const name = deliveryObj && (deliveryObj.deliveryName || deliveryObj.name);
  if (!name) return null;
  const dayOf = s => String(s || '').split(/[\s,]+/)[0];
  const wantDay = deliveryObj ? dayOf(deliveryObj.date || deliveryObj.archivedAt) : '';
  const byName = chargeStore.chargeCache.filter(c => c.active && c.deliveryName === name);
  if (!byName.length) return null;
  return byName.find(c => !wantDay || dayOf(c.startedAt) === wantDay) || byName[0];
}

// Bir teslimatın şarj durumu + şarj sonu tahmini palet (aktif şarj VEYA arşiv).
// { hasCharge, active, finalPalet }
export function getDeliveryChargeInfo(deliveryId, deliveryObj) {
  const act = findActiveChargeForDelivery(deliveryId, deliveryObj);
  if (act) {
    const cpt = deliveryStore.deliveries.find(c => c.id === act.deliveryId) || deliveryObj || {};
    return { hasCharge: true, active: true, finalPalet: calcCurrentStatus(act, cpt).finalPalet };
  }
  const arch = findArchivedChargeForDelivery(deliveryId, deliveryObj);
  if (arch) return { hasCharge: true, active: false, finalPalet: getPredictedFinalPalet(arch, deliveryObj) };
  return { hasCharge: false, active: false, finalPalet: null };
}

// Geçmiş (durmuş) şarj için "şarj sonu tahmini" durumu — canlı calcCurrentStatus'un
// dondurulmuş hali. calcForecast "şimdi"yi kullandığından geçmişte kalan süre 0 verir;
// bunun yerine SON snapshot'taki tahmin (kendi zaman damgasıyla) kullanılır. Sonuç,
// renderStatusHTML ile birebir uyumlu alanlar döner (existing+sim+gelen+kalan = final).
export function calcArchivedFinalStatus(rec, cpt) {
  cpt = cpt || {};
  const cal0 = (rec.calibrations && rec.calibrations[0]) || {};
  const existingPalet = (cpt.existingPalet != null && cpt.existingPalet > 0) ? cpt.existingPalet : (cal0.existingPalet || 0);
  const simPalet = (cpt.palets != null && cpt.palets > 0) ? cpt.palets : (cal0.paletCount || 0);
  const arrived = calcShippedSoFar(rec);
  const lastIdx = (rec.snapshots || []).length - 1;
  const fc = lastIdx >= 1 ? calcForecastAtIndex(rec, cpt, lastIdx) : null;
  const remainingPalet = fc ? fc.extraPalet : 0;
  const remainingPkg = fc ? fc.extraPkg : 0;
  const finalPalet = existingPalet + simPalet + arrived.palet + remainingPalet;
  return {
    existingPalet, simPalet,
    arrivedPkg: arrived.pkg, arrivedPalet: arrived.palet,
    remainingPkg, remainingPalet,
    finalPalet,
    avgPkgPerPalet: rec.avgPkgPerPalet || 0
  };
}

// ─── HTML render ─────────────────────────────────────────────────
// Aktif şarj başlığında bitiş saati — düzenlenebilir (görüntü + gizli time input)
function buildChargeEndTimeHTML(rec) {
  return `${t('charge_end_at')}: <span class="charge-endtime-disp" id="cetDisp-${rec.id}">${safe(rec.chargeEndTime)}</span>` +
    `<input class="charge-endtime-input" type="time" id="cetInput-${rec.id}" value="${safe(rec.chargeEndTime)}" style="display:none" ` +
    `onblur="window.__saveChargeEndTime('${rec.id}')" ` +
    `onkeydown="if(event.key==='Enter'){event.preventDefault();window.__saveChargeEndTime('${rec.id}')}else if(event.key==='Escape'){window.__cancelEndTimeEdit('${rec.id}')}"/>` +
    `<button type="button" class="btn-edit-endtime" title="${t('edit_endtime')}" aria-label="${t('edit_endtime')}" onclick="window.__startEditEndTime('${rec.id}')">✎</button>`;
}

export function buildChargePanelHTML(cpt, chargeRec) {
  const ppp = cpt.avgPkgPerPalet || Math.round(cpt.totalPkg / Math.max(1, cpt.palets)) || 150;
  if (!chargeRec) {
    return `<div class="charge-panel">
      <div class="charge-panel-title">${ICON_BOLT} ${t('charge_tracking')}</div>
      <div class="charge-row">
        <span class="charge-label">${t('charge_end_label')}</span>
        <input class="charge-input" type="time" id="cend-${cpt.id}" value="13:30"/>
      </div>
      <div class="charge-row">
        <span class="charge-label">${t('charge_now_total')}</span>
        <input class="charge-input" type="number" min="0" id="ctotal-${cpt.id}" placeholder="1200"/>
      </div>
      <div style="font-size:10px;color:var(--muted);margin-bottom:10px;padding:6px 10px;background:var(--surface3);border-radius:6px;border:1px solid var(--border)">
        ${t('avg_pkg_per_palet')}: <b style="color:var(--text)">${ppp}</b> <span style="opacity:.7">${t('auto_from_sim')}</span>
      </div>
      <div>
        <button class="btn-charge-start" onclick="window.__startCharge('${cpt.id}')">${ICON_BOLT} ${t('charge_start_btn')}</button>
      </div>
    </div>`;
  }
  const status = calcCurrentStatus(chargeRec, cpt);
  const forecast = calcForecast(chargeRec, cpt);
  const historyHTML = buildForecastHistoryHTML(chargeRec, cpt);
  const chartId = 'chargeChart-' + chargeRec.id;
  return `<div class="charge-panel">
    <div class="charge-panel-title" style="display:flex;justify-content:space-between;align-items:center">
      <span>${ICON_BOLT} ${t('charge_active')} — ${buildChargeEndTimeHTML(chargeRec)}</span>
      <button class="btn-charge-stop" onclick="window.__stopCharge('${chargeRec.id}')">${t('stop_btn')}</button>
    </div>

    ${renderStatusHTML(status)}

    ${forecast ? renderForecastHTML(forecast, cpt) : '<div style="font-size:11px;color:var(--muted);margin:10px 0">' + t('min_2_data') + '</div>'}

    <div class="ed-chart-header">
      <div>
        <div class="ed-chart-title">${ICON_TREND} ${t('trend_analysis')}</div>
        <div class="ed-chart-sub">${chargeRec.snapshots.length} ${t('trend_sub')}</div>
      </div>
      ${buildEditorialHeadRight(chargeRec, cpt)}
    </div>
    <div class="charge-chart-wrap-palet"><canvas id="${chartId}-palet"></canvas></div>
    ${buildKpiStrip(chargeRec, cpt)}
    ${buildPaketGaugeHTML(chargeRec, true)}

    <div class="ed-section-title">${ICON_LIST} ${t('forecast_hist')}</div>
    ${historyHTML}

    ${buildCalibrationSectionHTML(chargeRec)}

    <div class="ed-section-title">${ICON_EDIT} ${t('new_data_entry')}</div>
    <div class="charge-manual-form">
      <div class="charge-row">
        <span class="charge-label">${t('data_total')}</span>
        <input class="charge-input" type="number" min="0" id="mtotal-${chargeRec.id}" placeholder=""/>
      </div>
      <div class="charge-row">
        <span class="charge-label">${t('data_sent')}</span>
        <input class="charge-input" type="number" min="0" id="mshipped-${chargeRec.id}" placeholder="0" value="0"/>
      </div>
      <button class="btn-charge-snapshot" onclick="window.__manualAddSnapshot('${chargeRec.id}')">+ ${t('data_add_btn')}</button>
    </div>
  </div>`;
}

export function buildEditorialHeadRight(rec, cpt) {
  const snaps = rec.snapshots;
  if (snaps.length === 0) return '';
  const idx = snaps.length - 1;
  let finalPalet, deltaTxt = '';
  if (idx === 0) {
    finalPalet = (cpt.existingPalet || 0) + (cpt.palets || 0);
    deltaTxt = `<span class="ed-delta-flat">${t('first_data_only')}</span>`;
  } else {
    const fc = calcForecastAtIndex(rec, cpt, idx);
    const arrived = calcShippedSoFar(rec);
    finalPalet = (cpt.existingPalet || 0) + (cpt.palets || 0) + arrived.palet + (fc ? fc.extraPalet : 0);
    if (idx === 1) {
      deltaTxt = `<span class="ed-delta-flat">${t('first_forecast')}</span>`;
    } else {
      const fcPrev = calcForecastAtIndex(rec, cpt, idx - 1);
      if (fcPrev && fc) {
        const arrivedPrev = calcShippedSoFar({ ...rec, snapshots: snaps.slice(0, idx), avgPkgPerPalet: rec.avgPkgPerPalet });
        const prevFinal = (cpt.existingPalet || 0) + (cpt.palets || 0) + arrivedPrev.palet + fcPrev.extraPalet;
        const diff = finalPalet - prevFinal;
        if (diff > 0) deltaTxt = `<span class="ed-delta-up">+${diff} ${t('last_data_inc')}</span>`;
        else if (diff < 0) deltaTxt = `<span class="ed-delta-down">${diff} ${t('last_data_dec')}</span>`;
        else deltaTxt = `<span class="ed-delta-flat">${t('last_data_flat')}</span>`;
      }
    }
  }
  return `<div class="ed-head-right">
    <div class="ed-head-big">${finalPalet}<span class="ed-head-unit">${t('palet_lbl')}</span></div>
    ${deltaTxt}
  </div>`;
}

export function buildKpiStrip(rec, cpt) {
  const lastTotal = rec.snapshots[rec.snapshots.length - 1]?.total || 0;
  const totalSent = rec.snapshots.reduce((a, s) => a + (s.shipped || 0), 0);
  const totalWithSent = lastTotal + totalSent;
  return `<div class="ed-kpi-strip">
    <div class="ed-kpi-item">
      <div class="ed-kpi-label">${t('kpi_pkg_lbl')}</div>
      <div class="ed-kpi-val ed-kpi-paket">${lastTotal.toLocaleString('tr-TR')}</div>
    </div>
    <div class="ed-kpi-item">
      <div class="ed-kpi-label">${t('kpi_total_with_sent')}</div>
      <div class="ed-kpi-val">${totalWithSent.toLocaleString('tr-TR')}</div>
    </div>
    <div class="ed-kpi-item">
      <div class="ed-kpi-label">${t('kpi_total_sent')}</div>
      <div class="ed-kpi-val">${totalSent.toLocaleString('tr-TR')}</div>
    </div>
  </div>`;
}

export function buildCalibrationHistoryReadOnlyHTML(rec) {
  const calibs = rec.calibrations || [];
  if (!calibs.length) return '';
  const rows = calibs.map(c => {
    const srcLabel = c.source === 'sim' ? t('calib_src_sim') : t('calib_src_manual');
    return `<div class="calib-row">
      <span class="calib-time">${c.time}</span>
      <span class="calib-val">${c.avgPkgPerPalet} <span class="calib-unit">${t('pkg_per_palet_short')}</span></span>
      <span class="calib-src">${srcLabel}</span>
      <span class="calib-meta">${(c.pkgCount || 0).toLocaleString('tr-TR')} ${t('paket_lbl')} / ${(c.paletCount || 0).toLocaleString('tr-TR')} ${t('palet_lbl')}</span>
    </div>`;
  }).join('');
  return `
    <div class="ed-section-title">${ICON_GEAR} ${t('calib_history')}</div>
    <div class="calib-list">${rows}</div>`;
}

export function buildCalibrationSectionHTML(rec) {
  const calibs = rec.calibrations || [];
  const curAvg = rec.avgPkgPerPalet || 0;
  const rows = calibs.map(c => {
    const srcLabel = c.source === 'sim' ? t('calib_src_sim') : t('calib_src_manual');
    return `<div class="calib-row">
      <span class="calib-time">${c.time}</span>
      <span class="calib-val">${c.avgPkgPerPalet} <span class="calib-unit">${t('pkg_per_palet_short')}</span></span>
      <span class="calib-src">${srcLabel}</span>
      <span class="calib-meta">${(c.pkgCount || 0).toLocaleString('tr-TR')} ${t('paket_lbl')} / ${(c.paletCount || 0).toLocaleString('tr-TR')} ${t('palet_lbl')}</span>
    </div>`;
  }).join('');
  return `
    <div class="ed-section-title">${ICON_GEAR} ${t('calib_history')}</div>
    <div class="calib-list">${rows || '<div class="calib-empty">' + t('no_calib') + '</div>'}</div>
    <button class="btn-recalib-toggle" onclick="window.__toggleRecalibForm('${rec.id}')">${ICON_GEAR} ${t('recalib_btn')}</button>
    <div class="recalib-form" id="recalibForm-${rec.id}" style="display:none">
      <div class="recalib-info">
        <div>${t('cur_avg')}: <b>${curAvg}</b> ${t('pkg_per_palet_short')}</div>
        <div class="recalib-hint">${t('recalib_hint')}</div>
      </div>
      <div class="charge-row" style="align-items:flex-start">
        <span class="charge-label">${t('recalib_pkg_label')}</span>
        <textarea class="recalib-textarea" id="recalibPkg-${rec.id}" placeholder="LM1&#10;LM1&#10;EUP&#10;U10..." rows="6"></textarea>
      </div>
      <div class="charge-row">
        <span class="charge-label">${t('recalib_palet_label')}</span>
        <input class="charge-input" type="number" min="1" id="recalibPalet-${rec.id}" placeholder=""/>
      </div>
      <button class="btn-recalib-apply" onclick="window.__recalibrateAvg('${rec.id}')">${ICON_GEAR} ${t('recalib_apply')}</button>
    </div>`;
}

export function buildPaketGaugeHTML(rec, editable = false) {
  const snaps = rec.snapshots;
  if (!snaps.length) return '';
  const maxTotal = Math.max(...snaps.map(s => s.total));
  const lastTotal = snaps[snaps.length - 1].total;
  const rows = snaps.map((s, i) => {
    const pct = maxTotal > 0 ? Math.round((s.total / maxTotal) * 100) : 0;
    const isLast = i === snaps.length - 1;
    let deltaTxt = '';
    if (i > 0) {
      const diff = s.total - snaps[i - 1].total;
      if (diff > 0) deltaTxt = `<span class="pkt-delta-up">+${diff}</span>`;
      else if (diff < 0) deltaTxt = `<span class="pkt-delta-down">${diff}</span>`;
    }
    const editBtn = editable
      ? `<button type="button" class="btn-edit-snap" title="${t('edit_data')}" aria-label="${t('edit_data')}" onclick="window.__startEditSnapshot('${rec.id}',${i})">✎</button>`
      : '';
    const editRow = editable
      ? `<div class="pkt-edit-row" id="pktEdit-${rec.id}-${i}" style="display:none">
          <span class="pkt-edit-lbl">${t('data_total')}</span>
          <input class="charge-input pkt-edit-inp" type="number" min="0" id="pktEditTotal-${rec.id}-${i}" value="${s.total}"/>
          <span class="pkt-edit-lbl">${t('data_sent')}</span>
          <input class="charge-input pkt-edit-inp" type="number" min="0" id="pktEditShipped-${rec.id}-${i}" value="${s.shipped || 0}"/>
          <div class="pkt-edit-actions">
            <button type="button" class="btn-pkt-save" onclick="window.__saveEditSnapshot('${rec.id}',${i})">${t('save')}</button>
            <button type="button" class="btn-pkt-cancel" onclick="window.__cancelEditSnapshot('${rec.id}',${i})">${t('dlg_cancel')}</button>
          </div>
        </div>`
      : '';
    return `<div class="pkt-row" id="pktRow-${rec.id}-${i}">
      <div class="pkt-time ${isLast ? 'pkt-current' : ''}">${s.time}</div>
      <div class="pkt-track"><div class="pkt-fill ${isLast ? 'pkt-fill-current' : ''}" style="width:${pct}%"></div></div>
      <div class="pkt-val ${isLast ? 'pkt-current' : ''}">${s.total.toLocaleString('tr-TR')} ${deltaTxt}${editBtn}</div>
    </div>${editRow}`;
  }).join('');
  return `<div class="pkt-section">
    <div class="pkt-head">
      <div class="pkt-title">${ICON_BOX} ${t('paket_flow')}</div>
      <div class="pkt-last">${lastTotal.toLocaleString('tr-TR')}<span class="pkt-last-unit">${t('paket_last')}</span></div>
    </div>
    ${rows}
  </div>`;
}

export function renderStatusHTML(s) {
  return `<div class="charge-status-box">
    <div class="charge-status-title">${ICON_BOX} ${t('cur_status')}</div>
    <div class="charge-status-row"><span>${t('cs_existing')}</span><b>${s.existingPalet}</b></div>
    <div class="charge-status-row"><span>${t('cs_simulated')}</span><b>${s.simPalet}</b></div>
    <div class="charge-status-row"><span>${t('cs_arrived')}</span><b class="cs-val-arrived">+${s.arrivedPalet} ${t('palet_lbl')} <span class="cs-val-sub">(${s.arrivedPkg} ${t('paket_lbl')})</span></b></div>
    <div class="charge-status-row"><span>${t('cs_remaining')}</span><b class="cs-val-remaining">+${s.remainingPalet} ${t('palet_lbl')} <span class="cs-val-sub">(${s.remainingPkg} ${t('paket_lbl')})</span></b></div>
    <div class="charge-status-divider"></div>
    <div class="charge-status-row charge-status-total"><span>${t('cs_final')}</span><b>${s.finalPalet} ${t('palet_lbl')}</b></div>
  </div>`;
}

export function buildForecastHistoryHTML(rec, cpt) {
  const snaps = rec.snapshots;
  if (snaps.length < 2) return `<div style="font-size:11px;color:var(--muted);padding:8px;background:var(--surface3);border-radius:6px;border:1px solid var(--border)">${t('min_2_data')}</div>`;
  const rows = [];
  for (let i = 1; i < snaps.length; i++) {
    const fc = calcForecastAtIndex(rec, cpt, i);
    if (!fc) continue;
    const prevFc = i >= 2 ? calcForecastAtIndex(rec, cpt, i - 1) : null;
    let trend = '';
    if (prevFc) {
      const diff = fc.extraPkg - prevFc.extraPkg;
      if (diff > 5) trend = '<span class="fhist-trend-up">↑</span>';
      else if (diff < -5) trend = '<span class="fhist-trend-down">↓</span>';
      else trend = '<span class="fhist-trend-flat">→</span>';
    }
    rows.push(`<div class="charge-fhist-row">
      <span class="charge-fhist-time">${snaps[i].time}</span>
      <span class="charge-fhist-range">${snaps[0].time}→${snaps[i].time}</span>
      <span class="charge-fhist-rate">${fc.ratePerMin}/dk</span>
      <span class="charge-fhist-extra">+${fc.extraPkg} pkt / <b>+${fc.extraPalet} plt</b> ${trend}</span>
    </div>`);
  }
  return `<div class="charge-fhist-list">${rows.join('')}</div>`;
}

export function renderForecastHTML(f, cpt) {
  return `<div class="charge-forecast">
    <div class="charge-forecast-title">
      ${ICON_STATUS}
      ${t('instant_forecast')}
    </div>
    <div class="charge-kpi-row">
      <div class="charge-kpi"><div class="charge-kpi-label">${t('remain_time')}</div><div class="charge-kpi-val">${f.remainMin}<span style="font-size:10px;color:var(--muted)">dk</span></div></div>
      <div class="charge-kpi"><div class="charge-kpi-label">${t('rate_label')}</div><div class="charge-kpi-val">${f.ratePerMin}<span style="font-size:10px;color:var(--muted)">/dk</span></div></div>
      <div class="charge-kpi"><div class="charge-kpi-label">${t('avg_label')}</div><div class="charge-kpi-val">${f.avgPkgPerPalet}<span style="font-size:10px;color:var(--muted)">${t('pkg_per_palet_short')}</span></div></div>
    </div>
  </div>`;
}

// ─── Şarj operasyonları ──────────────────────────────────────────
export async function startCharge(deliveryId) {
  const cpt = deliveryStore.deliveries.find(c => c.id === deliveryId); if (!cpt) return;
  const endTime = document.getElementById('cend-' + deliveryId)?.value || '13:30';
  const totalRaw = parseInt(document.getElementById('ctotal-' + deliveryId)?.value);
  const ppp = cpt.avgPkgPerPalet || Math.round(cpt.totalPkg / Math.max(1, cpt.palets)) || 150;
  if (isNaN(totalRaw) || totalRaw < 0) { await alertDialog(t('valid_total_required')); return; }
  const now = new Date();
  const timeStr = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');
  const rec = {
    id: uid(), deliveryId, deliveryName: cpt.name, chargeEndTime: endTime, avgPkgPerPalet: ppp, active: true,
    startedAt: nowStr(), startedAtMs: Date.now(),
    snapshots: [{ time: timeStr, tsMs: Date.now(), total: totalRaw, shipped: 0, avgAtTime: ppp }],
    calibrations: [{
      time: timeStr, tsMs: Date.now(), avgPkgPerPalet: ppp, source: 'sim',
      pkgCount: cpt.totalPkg || 0, paletCount: cpt.palets || 0, existingPalet: cpt.existingPalet || 0
    }]
  };
  await saveCharge(rec);
  startChargeAlertTimer();
  if (typeof window.__renderDeliveries === 'function') window.__renderDeliveries();
  setTimeout(() => drawChargeChart(rec, cpt), 50);
}

export async function stopCharge(chargeId) {
  const rec = chargeStore.chargeCache.find(c => c.id === chargeId); if (!rec) return;
  rec.active = false;
  rec.stoppedAt = nowStr();
  rec.stoppedAtMs = Date.now();
  await saveCharge(rec);
  await saveChargeToHistory(rec);
  if (typeof window.__renderDeliveries === 'function') window.__renderDeliveries();
  try { if (typeof window.__renderHistory === 'function') window.__renderHistory(); } catch {}
}

export function downloadChargeCSV(histId) {
  const h = historyStore.histCache.find(x => x.id === histId);
  if (!h) return;
  const isEN = uiStore.currentLang === 'en';
  const headers = isEN
    ? ['#', 'Time', 'Total Pkg', 'Sent', 'Delta vs prev', 'Cumulative Rate (/min)']
    : ['#', 'Saat', 'Total Paket', 'Gönderilen', 'Önceki ile Fark', 'Kümülatif Hız (/dk)'];
  const rows = [headers.join(';')];
  const snaps = h.snapshots || [];
  const firstTotal = snaps[0]?.total || 0;
  const firstMs = snaps[0]?.tsMs || 0;
  snaps.forEach((s, i) => {
    const diff = i > 0 ? (s.total - snaps[i - 1].total) : '';
    let rate = '';
    if (i > 0 && firstMs) {
      const dt = (s.tsMs - firstMs) / 60000;
      let totalShipped = 0;
      for (let j = 1; j <= i; j++) totalShipped += (snaps[j].shipped || 0);
      const inc = (s.total - firstTotal) + totalShipped;
      rate = dt > 0 ? (Math.round((inc / dt) * 10) / 10) : 0;
    }
    rows.push([i + 1, s.time || '', s.total || 0, s.shipped || 0, diff, rate].join(';'));
  });
  rows.push('');
  rows.push((isEN ? 'Delivery' : 'Teslimat') + ';' + (h.deliveryName || ''));
  rows.push((isEN ? 'Start' : 'Başlangıç') + ';' + (h.startedAt || ''));
  rows.push((isEN ? 'End' : 'Bitiş') + ';' + (h.stoppedAt || ''));
  rows.push((isEN ? 'Charge end time' : 'Şarj bitiş saati') + ';' + (h.chargeEndTime || ''));
  rows.push((isEN ? 'Avg pkg/pallet' : 'Ort. paket/palet') + ';' + (h.avgPkgPerPalet || ''));
  const totalSent = snaps.reduce((a, s) => a + (s.shipped || 0), 0);
  rows.push((isEN ? 'Total sent' : 'Toplam gönderilen') + ';' + totalSent);
  const calibs = h.calibrations || [];
  if (calibs.length) {
    rows.push('');
    rows.push(isEN ? 'CALIBRATION HISTORY' : 'KALİBRASYON GEÇMİŞİ');
    const cHdr = isEN
      ? ['#', 'Time', 'Avg (pkg/plt)', 'Source', 'Pkg Count', 'Palet Count']
      : ['#', 'Saat', 'Ortalama (pkt/plt)', 'Kaynak', 'Paket Sayısı', 'Palet Sayısı'];
    rows.push(cHdr.join(';'));
    calibs.forEach((c, i) => {
      const src = c.source === 'sim' ? (isEN ? 'simulation' : 'simülasyon') : (isEN ? 'recalibrated' : 'kalibrasyon');
      rows.push([i + 1, c.time || '', c.avgPkgPerPalet || 0, src, c.pkgCount || 0, c.paletCount || 0].join(';'));
    });
  }
  const csv = '﻿' + rows.join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const safeName = (h.deliveryName || 'sarj').replace(/[^a-zA-Z0-9_-]/g, '_');
  a.download = `sarj_${safeName}_${(h.startedAt || '').split(' ')[0] || 'kayit'}.csv`.replace(/\./g, '-');
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function toggleChargePanel(deliveryId) {
  const panel = document.getElementById('charge-panel-' + deliveryId);
  if (!panel) return;
  const isOpen = panel.style.display !== 'none';
  document.querySelectorAll('[id^="charge-panel-"]').forEach(p => { p.style.display = 'none'; });
  if (!isOpen) {
    panel.style.display = 'block';
    const rec = chargeStore.chargeCache.find(c => c.deliveryId === deliveryId && c.active);
    const cpt = deliveryStore.deliveries.find(c => c.id === deliveryId);
    if (rec && cpt) setTimeout(() => drawChargeChart(rec, cpt), 50);
  }
}

export async function addChargeSnapshot(chargeId, total, shipped) {
  const rec = chargeStore.chargeCache.find(c => c.id === chargeId); if (!rec) return;
  const now = new Date();
  const timeStr = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');
  const curAvg = rec.avgPkgPerPalet || 150;
  rec.snapshots.push({ time: timeStr, tsMs: Date.now(), total: parseInt(total) || 0, shipped: parseInt(shipped) || 0, avgAtTime: curAvg });
  await saveCharge(rec);
  if (typeof window.__renderDeliveries === 'function') window.__renderDeliveries();
  renderModalChargeSection(rec.deliveryId);
}

export async function recalibrateAvg(chargeId) {
  const rec = chargeStore.chargeCache.find(c => c.id === chargeId); if (!rec) return;
  const pkgEl = document.getElementById('recalibPkg-' + chargeId);
  const paletEl = document.getElementById('recalibPalet-' + chargeId);
  if (!pkgEl || !paletEl) return;
  const pkgRaw = (pkgEl.value || '').trim();
  const paletCountUser = parseInt(paletEl.value);
  if (!pkgRaw) { await alertDialog(t('recalib_no_pkg')); return; }
  if (isNaN(paletCountUser) || paletCountUser <= 0) { await alertDialog(t('recalib_no_palet')); return; }
  const packages = pkgRaw.split('\n').map(s => s.trim()).filter(Boolean);
  if (!packages.length) { await alertDialog(t('recalib_no_pkg')); return; }
  const simResult = simulatePacking(packages);
  if (!simResult || simResult.paletCount === 0) { await alertDialog(t('recalib_failed')); return; }
  const newAvg = simResult.avgPkgPerPalet;
  if (newAvg <= 0) { await alertDialog(t('recalib_failed')); return; }
  const realPkgCount = simResult.totalPkg;
  const realPaletCount = paletCountUser;
  rec.avgPkgPerPalet = newAvg;
  const now = new Date();
  const timeStr = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');
  if (!rec.calibrations) rec.calibrations = [];
  rec.calibrations.push({
    time: timeStr, tsMs: Date.now(),
    avgPkgPerPalet: newAvg,
    source: 'recalib',
    pkgCount: realPkgCount, paletCount: realPaletCount,
    simPaletCount: simResult.paletCount,
    oversized: simResult.oversized, unknown: simResult.unknown
  });
  await saveCharge(rec);
  if (typeof window.__renderDeliveries === 'function') window.__renderDeliveries();
  renderModalChargeSection(rec.deliveryId);
  const panel = document.getElementById('charge-panel-' + rec.deliveryId);
  if (panel) panel.style.display = 'block';
  const cpt = deliveryStore.deliveries.find(c => c.id === rec.deliveryId);
  if (cpt) setTimeout(() => drawChargeChart(rec, cpt), 50);
}

// ─── Bitiş saati düzenleme (yalnız aktif şarj) ───────────────────
export function startEditEndTime(chargeId) {
  const disp = document.getElementById('cetDisp-' + chargeId);
  const input = document.getElementById('cetInput-' + chargeId);
  if (!disp || !input) return;
  disp.style.display = 'none';
  input.style.display = 'inline-block';
  input.focus();
}

export function cancelEndTimeEdit(chargeId) {
  const disp = document.getElementById('cetDisp-' + chargeId);
  const input = document.getElementById('cetInput-' + chargeId);
  if (!disp || !input) return;
  const rec = chargeStore.chargeCache.find(c => c.id === chargeId);
  if (rec) input.value = rec.chargeEndTime;
  input.style.display = 'none';
  disp.style.display = '';
}

export async function saveChargeEndTime(chargeId) {
  const rec = chargeStore.chargeCache.find(c => c.id === chargeId); if (!rec) return;
  const input = document.getElementById('cetInput-' + chargeId);
  if (!input) return;
  const val = (input.value || '').trim();
  if (!val) { cancelEndTimeEdit(chargeId); return; }
  if (!/^\d{2}:\d{2}$/.test(val)) { await alertDialog(t('invalid_time')); return; }
  if (val === rec.chargeEndTime) { cancelEndTimeEdit(chargeId); return; }
  rec.chargeEndTime = val;
  await saveCharge(rec);
  if (typeof window.__renderDeliveries === 'function') window.__renderDeliveries();
  const panel = document.getElementById('charge-panel-' + rec.deliveryId);
  if (panel) panel.style.display = 'block';
  const cpt = deliveryStore.deliveries.find(c => c.id === rec.deliveryId);
  if (cpt) setTimeout(() => drawChargeChart(rec, cpt), 50);
  renderModalChargeSection(rec.deliveryId);
}

// ─── Snapshot (total/gönderilen) düzenleme (yalnız aktif şarj) ────
export function startEditSnapshot(chargeId, idx) {
  const row = document.getElementById('pktRow-' + chargeId + '-' + idx);
  const edit = document.getElementById('pktEdit-' + chargeId + '-' + idx);
  if (!row || !edit) return;
  row.style.display = 'none';
  edit.style.display = 'grid';
  const ti = document.getElementById('pktEditTotal-' + chargeId + '-' + idx);
  if (ti) { ti.focus(); ti.select(); }
}

export function cancelEditSnapshot(chargeId, idx) {
  const row = document.getElementById('pktRow-' + chargeId + '-' + idx);
  const edit = document.getElementById('pktEdit-' + chargeId + '-' + idx);
  if (!row || !edit) return;
  edit.style.display = 'none';
  row.style.display = '';
}

export async function saveEditSnapshot(chargeId, idx) {
  const rec = chargeStore.chargeCache.find(c => c.id === chargeId); if (!rec) return;
  if (!rec.snapshots || !rec.snapshots[idx]) return;
  const ti = document.getElementById('pktEditTotal-' + chargeId + '-' + idx);
  const si = document.getElementById('pktEditShipped-' + chargeId + '-' + idx);
  const total = parseInt(ti?.value);
  if (isNaN(total) || total < 0) { await alertDialog(t('valid_total_required')); return; }
  let shipped = parseInt(si?.value);
  if (isNaN(shipped) || shipped < 0) shipped = 0;
  rec.snapshots[idx].total = total;
  rec.snapshots[idx].shipped = shipped;
  await saveCharge(rec);
  if (typeof window.__renderDeliveries === 'function') window.__renderDeliveries();
  const panel = document.getElementById('charge-panel-' + rec.deliveryId);
  if (panel) panel.style.display = 'block';
  const cpt = deliveryStore.deliveries.find(c => c.id === rec.deliveryId);
  if (cpt) setTimeout(() => drawChargeChart(rec, cpt), 50);
  renderModalChargeSection(rec.deliveryId);
}

export function toggleRecalibForm(chargeId) {
  const f = document.getElementById('recalibForm-' + chargeId);
  if (!f) return;
  f.style.display = f.style.display === 'none' ? 'block' : 'none';
}

export async function manualAddSnapshot(chargeId) {
  const totalEl = document.getElementById('mtotal-' + chargeId);
  const shippedEl = document.getElementById('mshipped-' + chargeId);
  const total = parseInt(totalEl?.value);
  const shipped = parseInt(shippedEl?.value) || 0;
  if (isNaN(total) || total < 0) { await alertDialog(t('valid_total_required')); return; }
  await addChargeSnapshot(chargeId, total, shipped);
  const rec = chargeStore.chargeCache.find(c => c.id === chargeId);
  if (rec) {
    const panel = document.getElementById('charge-panel-' + rec.deliveryId);
    if (panel) panel.style.display = 'block';
    const cpt = deliveryStore.deliveries.find(c => c.id === rec.deliveryId);
    if (cpt) setTimeout(() => drawChargeChart(rec, cpt), 50);
  }
}

// ─── Chart.js ────────────────────────────────────────────────────
const _chartInstances = {};

// Tüm aktif Chart.js instance'larını yıkar — modal kapanışında çağrılır,
// detached canvas üzerinde tutulan grafik objelerinin bellek sızdırmasını önler.
export function destroyChargeCharts() {
  for (const id of Object.keys(_chartInstances)) {
    try { _chartInstances[id].destroy(); } catch {}
    delete _chartInstances[id];
  }
}

export function drawChargeChart(rec, cpt, canvasId) {
  const baseId = canvasId || ('chargeChart-' + rec.id);
  const paletId = baseId + '-palet';
  const paketId = baseId + '-paket';
  const paletCanvas = document.getElementById(paletId);
  if (!paletCanvas) return;

  [paletId, paketId].forEach(id => {
    if (_chartInstances[id]) { _chartInstances[id].destroy(); delete _chartInstances[id]; }
  });

  const snaps = rec.snapshots;
  const labels = snaps.map(s => s.time);
  const paletData = snaps.map((s, i) => {
    if (i === 0) return (cpt.existingPalet || 0) + (cpt.palets || 0);
    const fc = calcForecastAtIndex(rec, cpt, i);
    const arrived = calcShippedSoFar({ ...rec, snapshots: snaps.slice(0, i + 1), avgPkgPerPalet: rec.avgPkgPerPalet });
    return (cpt.existingPalet || 0) + (cpt.palets || 0) + arrived.palet + (fc ? fc.extraPalet : 0);
  });

  // body üzerindeki theme-dark sınıfı tema durumunu belirler
  const dark = document.body.classList.contains('theme-dark');
  const gridColor = dark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.12)';
  const textColor = dark ? '#9ca3af' : '#6b7280';
  const paletColor = dark ? '#3b82f6' : '#4a90d9';
  const paletFillTop = dark ? 'rgba(59,130,246,0.35)' : 'rgba(74,144,217,0.22)';
  const paletFillBottom = dark ? 'rgba(59,130,246,0)' : 'rgba(74,144,217,0)';

  const ctxPalet = paletCanvas.getContext && paletCanvas.getContext('2d');
  let paletBg = paletFillTop;
  if (ctxPalet && ctxPalet.createLinearGradient) {
    const gradient = ctxPalet.createLinearGradient(0, 0, 0, paletCanvas.height || 140);
    gradient.addColorStop(0, paletFillTop);
    gradient.addColorStop(1, paletFillBottom);
    paletBg = gradient;
  }

  _chartInstances[paletId] = new Chart(paletCanvas, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Tahmini palet',
        data: paletData,
        borderColor: paletColor,
        backgroundColor: paletBg,
        fill: true,
        tension: 0.35,
        pointRadius: paletData.map((_, i) => i === paletData.length - 1 ? 5 : 3),
        pointBackgroundColor: paletData.map((_, i) => i === paletData.length - 1 ? (dark ? '#dbeafe' : '#fff') : paletColor),
        pointBorderColor: paletColor,
        pointBorderWidth: paletData.map((_, i) => i === paletData.length - 1 ? 2 : 0),
        borderWidth: 2.5
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      layout: { padding: { top: 18, right: 10, left: 4, bottom: 4 } },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: dark ? '#1f2937' : '#fff',
          titleColor: dark ? '#fff' : '#000',
          bodyColor: dark ? '#d1d5db' : '#374151',
          borderColor: gridColor, borderWidth: 1,
          callbacks: { label: ctx => 'Tahmin: ' + ctx.parsed.y + ' palet' }
        }
      },
      scales: {
        x: { ticks: { color: textColor, font: { size: 9, family: 'SF Mono, Menlo, monospace' } }, grid: { color: gridColor } },
        y: { ticks: { color: textColor, font: { size: 9, family: 'SF Mono, Menlo, monospace' } }, grid: { color: gridColor }, beginAtZero: false }
      },
      animation: {
        duration: 900,
        easing: 'easeOutCubic',
        onComplete: function () {
          const chart = this;
          const ctx = chart.ctx;
          ctx.font = '700 10px -apple-system, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'bottom';
          const lastIdx = chart.data.datasets[0].data.length - 1;
          chart.data.datasets[0].data.forEach((val, i) => {
            const meta = chart.getDatasetMeta(0);
            const pt = meta.data[i];
            if (!pt) return;
            ctx.fillStyle = (i === lastIdx) ? (dark ? '#dbeafe' : '#0c447c') : (dark ? '#9ca3af' : '#5f5e5a');
            ctx.font = (i === lastIdx) ? '700 11px -apple-system, sans-serif' : '600 10px -apple-system, sans-serif';
            ctx.fillText(val, pt.x, pt.y - 9);
          });
        }
      }
    }
  });
}

// ─── Alarm sistemi ───────────────────────────────────────────────
export function startChargeAlertTimer() {
  if (chargeStore.chargeAlertTimer) return;
  chargeStore.chargeAlertTimer = setInterval(checkChargeAlerts, 60 * 1000);
}

function stopChargeAlertTimerIfNoActive() {
  const hasActive = chargeStore.chargeCache.some(c => c.active);
  if (!hasActive && chargeStore.chargeAlertTimer) {
    clearInterval(chargeStore.chargeAlertTimer);
    chargeStore.chargeAlertTimer = null;
  }
}

export function checkChargeAlerts() {
  const today = new Date();
  const todayKey = today.getFullYear() + '-' + today.getMonth() + '-' + today.getDate();
  const activeCharges = chargeStore.chargeCache.filter(c => {
    if (!c.active) return false;
    const startMs = c.startedAtMs || c.snapshots?.[0]?.tsMs || 0;
    if (startMs) {
      const startDate = new Date(startMs);
      const startKey = startDate.getFullYear() + '-' + startDate.getMonth() + '-' + startDate.getDate();
      if (startKey !== todayKey) return false;
    }
    const [eh, em] = c.chargeEndTime.split(':').map(Number);
    const baseDate = startMs ? new Date(startMs) : today;
    const endMs = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate(), eh, em, 0).getTime();
    if (Date.now() >= endMs) return false;
    return true;
  });
  if (!activeCharges.length) { stopChargeAlertTimerIfNoActive(); return; }

  const dueCharges = activeCharges.filter(c => {
    const lastSnap = c.snapshots[c.snapshots.length - 1];
    if (!lastSnap) return true;
    const elapsed = (Date.now() - lastSnap.tsMs) / 60000;
    return elapsed >= 29;
  });
  if (dueCharges.length) showChargeAlert(dueCharges);
}

function showChargeAlert(charges) {
  const overlay = document.getElementById('chargeAlertOverlay');
  const itemsEl = document.getElementById('chargeAlertItems');
  const now = new Date();
  const timeStr = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');
  document.getElementById('chargeAlertSub').textContent = `Saat ${timeStr} — Lütfen güncel total paket sayısını girin`;

  itemsEl.innerHTML = charges.map(c => `
    <div class="charge-alert-item">
      <div class="charge-alert-item-name">${safe(c.deliveryName)}</div>
      <div class="charge-alert-item-time">Şarj bitiş: ${safe(c.chargeEndTime)} · Son güncelleme: ${safe(c.snapshots[c.snapshots.length - 1]?.time || '—')}</div>
      <div class="charge-alert-fields">
        <div class="charge-alert-field">
          <div class="charge-alert-field-label">Total Paket</div>
          <input class="charge-alert-inp" type="number" min="0" id="alert-total-${safe(c.id)}" placeholder="Örn: 1400"/>
        </div>
        <div class="charge-alert-field">
          <div class="charge-alert-field-label">Gönderilen (isteğe bağlı)</div>
          <input class="charge-alert-inp" type="number" min="0" id="alert-shipped-${safe(c.id)}" placeholder="0"/>
        </div>
        <button class="charge-alert-item-save" onclick="window.__saveAlertSnapshot('${safe(c.id)}')">Kaydet</button>
      </div>
    </div>`).join('');

  overlay.classList.add('open');
  playChimeSound();
}

export async function saveAlertSnapshot(chargeId) {
  const totalEl = document.getElementById('alert-total-' + chargeId);
  const shippedEl = document.getElementById('alert-shipped-' + chargeId);
  const total = parseInt(totalEl?.value);
  if (isNaN(total) || total < 0) { totalEl.style.borderColor = 'rgba(248,113,113,.5)'; return; }
  const shipped = parseInt(shippedEl?.value) || 0;
  await addChargeSnapshot(chargeId, total, shipped);
  const item = totalEl.closest('.charge-alert-item');
  if (item) { item.style.opacity = '.4'; item.style.pointerEvents = 'none'; }
  const remaining = document.querySelectorAll('.charge-alert-inp:not([disabled])');
  if (!remaining.length) dismissChargeAlert();
}

export function dismissChargeAlert() {
  document.getElementById('chargeAlertOverlay').classList.remove('open');
}

function playChimeSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const notes = [523.25, 659.25, 783.99];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.type = 'sine'; osc.frequency.value = freq;
      const tt = ctx.currentTime + i * 0.18;
      gain.gain.setValueAtTime(0, tt);
      gain.gain.linearRampToValueAtTime(0.15, tt + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.001, tt + 0.7);
      osc.start(tt); osc.stop(tt + 0.75);
    });
  } catch {}
}

// ─── Modal şarj bölümü ───────────────────────────────────────────
export function renderModalChargeSection(deliveryId, deliveryObj) {
  const sec = document.getElementById('modalChargeSection');
  if (!sec) return;
  // Aktif şarjı id VEYA isim(+gün) ile bul (Geçmiş'ten açınca TES id'si eşleşmez).
  const chargeRec = findActiveChargeForDelivery(deliveryId, deliveryObj);
  if (!chargeRec) { renderModalPastCharge(deliveryId, sec, deliveryObj); return; }
  // cpt: önce şarjın kendi teslimat kaydı, sonra geçilen id, sonra modal objesi.
  const cpt = deliveryStore.deliveries.find(c => c.id === chargeRec.deliveryId)
    || deliveryStore.deliveries.find(c => c.id === deliveryId)
    || deliveryObj
    || { id: deliveryId, name: chargeRec.deliveryName, palets: 0, existingPalet: 0, totalPkg: 0, avgPkgPerPalet: chargeRec.avgPkgPerPalet };
  const status = calcCurrentStatus(chargeRec, cpt);
  const forecast = calcForecast(chargeRec, cpt);
  const historyHTML = buildForecastHistoryHTML(chargeRec, cpt);
  const chartId = 'modalChargeChart-' + chargeRec.id;
  sec.style.display = 'block';
  sec.innerHTML = `<div class="charge-panel" style="margin-top:0">
    <div class="charge-panel-title" style="display:flex;justify-content:space-between;align-items:center">
      <span>${ICON_BOLT} ${t('charge_active')} — ${buildChargeEndTimeHTML(chargeRec)}</span>
      <button class="btn-charge-stop" onclick="window.__stopCharge('${chargeRec.id}');window.__closeModalDirect()">${t('stop_btn')}</button>
    </div>

    ${renderStatusHTML(status)}

    ${forecast ? renderForecastHTML(forecast, cpt) : '<div style="font-size:11px;color:var(--muted);margin:10px 0">' + t('min_2_data') + '</div>'}

    <div class="ed-chart-header">
      <div>
        <div class="ed-chart-title">${ICON_TREND} ${t('trend_analysis')}</div>
        <div class="ed-chart-sub">${chargeRec.snapshots.length} ${t('trend_sub')}</div>
      </div>
      ${buildEditorialHeadRight(chargeRec, cpt)}
    </div>
    <div class="charge-chart-wrap-palet-lg"><canvas id="${chartId}-palet"></canvas></div>
    ${buildKpiStrip(chargeRec, cpt)}
    ${buildPaketGaugeHTML(chargeRec, true)}

    <div class="ed-section-title">${ICON_LIST} ${t('forecast_hist')}</div>
    ${historyHTML}

    ${buildCalibrationSectionHTML(chargeRec)}

    <div class="ed-section-title">${ICON_EDIT} ${t('new_data_entry')}</div>
    <div class="charge-manual-form">
      <div class="charge-row">
        <span class="charge-label">${t('data_total')}</span>
        <input class="charge-input" type="number" min="0" id="mtotal-${chargeRec.id}" placeholder=""/>
      </div>
      <div class="charge-row">
        <span class="charge-label">${t('data_sent')}</span>
        <input class="charge-input" type="number" min="0" id="mshipped-${chargeRec.id}" placeholder="0" value="0"/>
      </div>
      <button class="btn-charge-snapshot" onclick="window.__manualAddSnapshot('${chargeRec.id}')">+ ${t('data_add_btn')}</button>
    </div>
  </div>`;
  setTimeout(() => drawChargeChart(chargeRec, cpt, chartId), 50);
}

// Aktif şarj yoksa: bu teslimata ait tamamlanmış (arşiv) şarj kaydının
// geçmiş verisini salt-okunur grafik olarak modalda göster.
// NOT: Geçmiş (TES) kaydı ile teslimat kaydı farklı uid() alır (sim.js); bu yüzden
// id eşleşmesi güvenilir değildir. Asıl bağ teslimat ADIdır (+ aynı gün).
function renderModalPastCharge(deliveryId, sec, deliveryObj) {
  const h = findArchivedChargeForDelivery(deliveryId, deliveryObj);
  if (!h) { sec.style.display = 'none'; return; }
  const recLike = {
    id: h.chargeId || h.id, deliveryId: h.deliveryId, deliveryName: h.deliveryName,
    snapshots: h.snapshots, calibrations: h.calibrations || [],
    avgPkgPerPalet: h.avgPkgPerPalet, chargeEndTime: h.chargeEndTime,
    startedAt: h.startedAt, startedAtMs: h._ts
  };
  const cpt = deliveryStore.deliveries.find(c => c.id === deliveryId)
    || deliveryObj
    || historyStore.histCache.find(x => x.id === deliveryId && x._type !== 'charge_archive' && x._type !== 'grup_archive')
    || { id: deliveryId, name: h.deliveryName, palets: 0, existingPalet: 0, totalPkg: 0, avgPkgPerPalet: h.avgPkgPerPalet };
  const chartId = 'modalPastChargeChart-' + h.id;
  sec.style.display = 'block';
  sec.innerHTML = `<div class="charge-panel" style="margin-top:0">
    <div class="charge-panel-title" style="display:flex;justify-content:space-between;align-items:center;gap:8px">
      <span>${ICON_BOLT} ${t('past_charge_data')} — ${t('charge_end_at')}: ${safe(h.chargeEndTime || '—')}</span>
      <button type="button" class="btn-download-csv" onclick="window.__openChargeArchiveFromDelivery('${safe(h.id)}')">${ICON_LIST} ${t('charge_history')}</button>
    </div>
    ${renderStatusHTML(calcArchivedFinalStatus(recLike, cpt))}
    <div class="charge-chart-wrap-palet-lg"><canvas id="${chartId}-palet"></canvas></div>
    ${buildKpiStrip(recLike, cpt)}
    ${buildPaketGaugeHTML(recLike)}
    <div class="ed-section-title">${ICON_LIST} ${t('forecast_hist')}</div>
    ${buildForecastHistoryHTML(recLike, cpt)}
    ${buildCalibrationHistoryReadOnlyHTML(recLike)}
  </div>`;
  setTimeout(() => drawChargeChart(recLike, cpt, chartId), 50);
}
