import { configStore, uiStore } from './state.js';
import { STORES, idbGet, idbPut, idbDelete } from './db.js';
import { t } from './i18n.js';
import { safe } from './utils.js';
import { confirmDialog } from './dialog.js';

export function rebuildDerived() {
  configStore.ALL_ORDER = [
    ...configStore.SMALL,
    ...configStore.MID,
    ...configStore.BIG,
    ...Object.keys(configStore.DIMS).filter(p =>
      !configStore.SMALL.includes(p) && !configStore.MID.includes(p) && !configStore.BIG.includes(p)
    )
  ];
  configStore.CAT_CLASS = {};
  configStore.SMALL.forEach(p => configStore.CAT_CLASS[p] = 'sm');
  configStore.MID.forEach(p => configStore.CAT_CLASS[p] = 'md');
  configStore.BIG.forEach(p => configStore.CAT_CLASS[p] = 'lg');
}

export async function loadConfig() {
  try { const d = await idbGet(STORES.config, 'dims'); configStore.DIMS = d || {}; } catch { configStore.DIMS = {}; }
  try {
    const c = await idbGet(STORES.config, 'cats');
    if (c) { configStore.SMALL = c.small || []; configStore.MID = c.mid || []; configStore.BIG = c.big || []; }
    else { configStore.SMALL = []; configStore.MID = []; configStore.BIG = []; }
  } catch { configStore.SMALL = []; configStore.MID = []; configStore.BIG = []; }
  try {
    const sv = await idbGet(STORES.config, 'palet');
    configStore.PALET_VOL = sv && sv.l ? sv.l * sv.w * sv.h : 0;
  } catch { configStore.PALET_VOL = 0; }
  try { const lm = await idbGet(STORES.config, 'limits'); configStore.LIMITS = lm || {}; } catch { configStore.LIMITS = {}; }
  rebuildDerived();
}

export function saveConfig() {
  idbPut(STORES.config, configStore.DIMS, 'dims');
  idbPut(STORES.config, { small: configStore.SMALL, mid: configStore.MID, big: configStore.BIG }, 'cats');
  idbPut(STORES.config, configStore.LIMITS, 'limits');
  rebuildDerived();
}

// Category helpers
export function cat(p) {
  if (configStore.SMALL.includes(p)) return uiStore.currentLang === 'en' ? 'Small' : 'Küçük';
  if (configStore.MID.includes(p)) return uiStore.currentLang === 'en' ? 'Medium' : 'Orta';
  if (configStore.BIG.includes(p)) return uiStore.currentLang === 'en' ? 'Large' : 'Büyük';
  return uiStore.currentLang === 'en' ? 'Other' : 'Diğer';
}

export function vol(p) {
  const d = configStore.DIMS[p];
  return d ? d[0] * d[1] * d[2] : 0;
}

export function getCatOfPkg(code) {
  if (configStore.SMALL.includes(code)) return 'small';
  if (configStore.MID.includes(code)) return 'mid';
  if (configStore.BIG.includes(code)) return 'big';
  return 'small';
}
export function getCatLabel(c) {
  return c === 'small' ? t('cat_small') : c === 'mid' ? t('cat_mid') : t('cat_big');
}
export function getCatDotColor(c) {
  return c === 'small' ? '#38bdf8' : c === 'mid' ? '#34d399' : '#fbbf24';
}

// ─── Palet hacmi UI ───────────────────────────────────────────────
export async function renderPaletVolUI() {
  let saved = { l: '', w: '', h: '' };
  try { const s = await idbGet(STORES.config, 'palet'); if (s && s.l) saved = s; } catch {}
  document.getElementById('svLen').value = saved.l || '';
  document.getElementById('svWid').value = saved.w || '';
  document.getElementById('svHgt').value = saved.h || '';
  updateSvResult();
}

export function updateSvResult() {
  const l = parseInt(document.getElementById('svLen').value) || 0;
  const w = parseInt(document.getElementById('svWid').value) || 0;
  const h = parseInt(document.getElementById('svHgt').value) || 0;
  const v = l * w * h;
  document.getElementById('svResult').textContent = v > 0
    ? (v / 1e9).toFixed(4) + ' m³ (' + l + '×' + w + '×' + h + ' mm)'
    : '—';
}

export async function savePaletVol() {
  const l = parseInt(document.getElementById('svLen').value) || 0;
  const w = parseInt(document.getElementById('svWid').value) || 0;
  const h = parseInt(document.getElementById('svHgt').value) || 0;
  const toast = document.getElementById('svToast');
  if (l <= 0 || w <= 0 || h <= 0) {
    toast.textContent = '⚠ ' + t('palet_vol_desc');
    toast.className = 'cfg-toast error-toast show';
    setTimeout(() => toast.classList.remove('show'), 2500);
    return;
  }
  await idbPut(STORES.config, { l, w, h }, 'palet');
  configStore.PALET_VOL = l * w * h;
  toast.textContent = '✓ ' + (configStore.PALET_VOL / 1e9).toFixed(4) + ' m³';
  toast.className = 'cfg-toast show';
  setTimeout(() => toast.classList.remove('show'), 2500);
}

export async function resetPaletVol() {
  if (!(await confirmDialog(t('reset_empty') + '?'))) return;
  await idbDelete(STORES.config, 'palet');
  configStore.PALET_VOL = 0;
  ['svLen', 'svWid', 'svHgt'].forEach(id => document.getElementById(id).value = '');
  updateSvResult();
  const toast = document.getElementById('svToast');
  toast.textContent = '✓ Reset.';
  toast.className = 'cfg-toast show';
  setTimeout(() => toast.classList.remove('show'), 2000);
}

// ─── Paket konfigürasyonu UI ──────────────────────────────────────
export function renderPkgCfgList() {
  const el = document.getElementById('pkgCfgList');
  el.innerHTML = '';
  if (!configStore.ALL_ORDER.length) {
    el.innerHTML = `<div style="text-align:center;padding:20px;color:var(--muted);font-size:12px;font-style:italic">${t('no_deliveries')}</div>`;
    return;
  }
  const order = [
    ...configStore.SMALL, ...configStore.MID, ...configStore.BIG,
    ...Object.keys(configStore.DIMS).filter(p => !configStore.SMALL.includes(p) && !configStore.MID.includes(p) && !configStore.BIG.includes(p))
  ];
  order.forEach(code => {
    const d = configStore.DIMS[code] || [0, 0, 0];
    const catKey = getCatOfPkg(code);
    const lim = configStore.LIMITS[code] !== undefined ? configStore.LIMITS[code] : '';
    const row = document.createElement('div');
    row.className = 'pkg-cfg-row';
    row.id = 'pkgrow-' + code;
    const sc = safe(code);
    row.innerHTML = `
      <div class="pkg-code">${sc}</div>
      <div class="pkg-cat-dot" style="background:${getCatDotColor(catKey)}"></div>
      <input class="pkg-dim-inp" id="pe-l-${sc}" type="number" min="1" value="${d[0]}" oninput="window.__markPkgChanged('${sc}')"/>
      <input class="pkg-dim-inp" id="pe-w-${sc}" type="number" min="1" value="${d[1]}" oninput="window.__markPkgChanged('${sc}')"/>
      <input class="pkg-dim-inp" id="pe-h-${sc}" type="number" min="1" value="${d[2]}" oninput="window.__markPkgChanged('${sc}')"/>
      <input class="pkg-lim-inp" id="pe-lim-${sc}" type="number" min="0" value="${lim}" oninput="window.__markPkgChanged('${sc}')"/>
      <select class="pkg-cat-sel" id="pe-cat-${sc}" onchange="window.__markPkgChanged('${sc}')">
        <option value="small" ${catKey === 'small' ? 'selected' : ''}>${t('cat_small')}</option>
        <option value="mid"   ${catKey === 'mid' ? 'selected' : ''}>${t('cat_mid')}</option>
        <option value="big"   ${catKey === 'big' ? 'selected' : ''}>${t('cat_big')}</option>
      </select>
      <div class="pkg-cfg-actions">
        <button class="btn-pkg-save" id="pksave-${sc}" onclick="window.__savePkgEdit('${sc}')">${t('save')}</button>
        <button class="btn-pkg-del" aria-label="${t('delete_grup')}" title="${t('delete_grup')}" onclick="window.__deletePkg('${sc}')">✕</button>
      </div>`;
    el.appendChild(row);
  });
}

export function markPkgChanged(code) {
  const btn = document.getElementById('pksave-' + code);
  if (btn) btn.classList.add('changed');
}

export function savePkgEdit(code) {
  const l = parseInt(document.getElementById('pe-l-' + code).value) || 0;
  const w = parseInt(document.getElementById('pe-w-' + code).value) || 0;
  const h = parseInt(document.getElementById('pe-h-' + code).value) || 0;
  const limRaw = document.getElementById('pe-lim-' + code).value;
  const limVal = limRaw === '' ? undefined : parseInt(limRaw);
  const catKey = document.getElementById('pe-cat-' + code).value;
  const toast = document.getElementById('pkgEditToast');
  if (l <= 0 || w <= 0 || h <= 0) {
    toast.textContent = '⚠ ' + code + ': ' + t('err_invalid_dim');
    toast.className = 'cfg-toast error-toast show';
    setTimeout(() => toast.classList.remove('show'), 2500);
    return;
  }
  configStore.DIMS[code] = [l, w, h];
  if (limVal === undefined || limVal <= 0) delete configStore.LIMITS[code];
  else configStore.LIMITS[code] = limVal;
  configStore.SMALL = configStore.SMALL.filter(p => p !== code);
  configStore.MID = configStore.MID.filter(p => p !== code);
  configStore.BIG = configStore.BIG.filter(p => p !== code);
  if (catKey === 'small') configStore.SMALL.push(code);
  else if (catKey === 'mid') configStore.MID.push(code);
  else configStore.BIG.push(code);
  saveConfig();
  toast.textContent = `✓ ${code}: ${l}×${w}×${h} mm`;
  toast.className = 'cfg-toast show';
  setTimeout(() => toast.classList.remove('show'), 2500);
  renderPkgCfgList();
}

export async function deletePkg(code) {
  if (!(await confirmDialog(`"${code}" ?`))) return;
  delete configStore.DIMS[code];
  delete configStore.LIMITS[code];
  configStore.SMALL = configStore.SMALL.filter(p => p !== code);
  configStore.MID = configStore.MID.filter(p => p !== code);
  configStore.BIG = configStore.BIG.filter(p => p !== code);
  saveConfig();
  renderPkgCfgList();
}

export function addNewPackage() {
  const codeRaw = document.getElementById('newPkgCode').value.trim().toUpperCase();
  const l = parseInt(document.getElementById('newPkgL').value) || 0;
  const w = parseInt(document.getElementById('newPkgW').value) || 0;
  const h = parseInt(document.getElementById('newPkgH').value) || 0;
  const limRaw = document.getElementById('newPkgLim').value;
  const limVal = limRaw === '' ? undefined : parseInt(limRaw);
  const catKey = document.getElementById('newPkgCat').value;
  const toast = document.getElementById('addPkgToast');
  let err = '';
  if (!codeRaw) err = '⚠ ' + t('err_code_required');
  // Sadece A-Z, 0-9, _ ve - karakterlerine izin ver — XSS payload'larını ve
  // bozuk DOM ID'lerini kaynak noktasında engelle (defense in depth).
  else if (!/^[A-Z0-9_-]+$/.test(codeRaw)) err = `⚠ "${safe(codeRaw)}" — geçersiz karakter`;
  else if (configStore.DIMS[codeRaw]) err = `⚠ "${safe(codeRaw)}" ` + t('err_code_exists');
  else if (l <= 0 || w <= 0 || h <= 0) err = '⚠ ' + t('err_invalid_dim');
  if (err) {
    toast.textContent = err;
    toast.className = 'cfg-toast error-toast show';
    setTimeout(() => toast.classList.remove('show'), 3000);
    return;
  }
  configStore.DIMS[codeRaw] = [l, w, h];
  if (limVal && limVal > 0) configStore.LIMITS[codeRaw] = limVal;
  if (catKey === 'small') configStore.SMALL.push(codeRaw);
  else if (catKey === 'mid') configStore.MID.push(codeRaw);
  else configStore.BIG.push(codeRaw);
  saveConfig();
  ['newPkgCode', 'newPkgL', 'newPkgW', 'newPkgH', 'newPkgLim'].forEach(id => document.getElementById(id).value = '');
  toast.textContent = `✓ "${codeRaw}" added`; // textContent → otomatik escape
  toast.className = 'cfg-toast show';
  setTimeout(() => toast.classList.remove('show'), 2500);
  renderPkgCfgList();
}
