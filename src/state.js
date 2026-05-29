// ─── Barrel: alan-bazlı store'lar + global sabitler ─────────────
// Seviye 2 tam göç tamamlandı: tek "god object" (state) kaldırıldı.
// Veri artık domain'e göre ayrı store modüllerinde yaşıyor. Bu dosya yalnızca
// store'ları ve değişmez sabitleri tek noktadan re-export eden bir barrel'dır.
// Kullanım: `import { deliveryStore, uiStore } from './state.js';`
export { configStore } from './stores/configStore.js';
export { deliveryStore } from './stores/deliveryStore.js';
export { grupStore } from './stores/grupStore.js';
export { chargeStore } from './stores/chargeStore.js';
export { historyStore } from './stores/historyStore.js';
export { uiStore } from './stores/uiStore.js';

// ─── Sabitler (store'a ait olmayan, değişmez değerler) ──────────
export const CAT_COLORS = {
  'Küçük': '#38bdf8', 'Orta': '#34d399', 'Büyük': '#fbbf24', 'Diğer': '#6b7280',
  'Small': '#38bdf8', 'Medium': '#34d399', 'Large': '#fbbf24', 'Other': '#6b7280'
};

export const CHARGE_INTERVAL_MS = 30 * 60 * 1000;
