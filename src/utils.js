// ops_sim — Author: Levent Görgü (github.com/Levent-Gr) — (c) 2026
export function uid() {
  // padEnd: Math.random() çok küçük değer dönerse boş/kısa string üretmesini engeller
  return Math.random().toString(36).slice(2).padEnd(9, '0').slice(0, 9);
}

// HTML-escape helper — innerHTML'e giden tüm kullanıcı girdisi bundan geçmeli.
// XSS koruması; sayısal/güvenilir değerlerde de zararsız (idempotent).
export function safe(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function nowStr() {
  return new Date().toLocaleString('tr-TR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

export function todayDateStr() {
  const n = new Date();
  return [
    String(n.getDate()).padStart(2, '0'),
    String(n.getMonth() + 1).padStart(2, '0'),
    n.getFullYear()
  ].join('.');
}

export function isToday(dateStr) {
  if (!dateStr) return false;
  // Tarih kısmını ayır. toLocaleString bazı tarayıcı/V8 sürümlerinde tarih ile
  // saat arasına virgül koyar ("29.05.2026, 14:30"); boşluk VEYA virgülle bölerek
  // bu locale kırılganlığını kapatıyoruz (aksi halde bugünkü kayıtlar gizlenirdi).
  const day = String(dateStr).split(/[\s,]+/)[0];
  return day === todayDateStr();
}

export function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// DOM sayısal input yardımcısı — HTMLInputElement (veya null/undefined) alır, değeri
// önce kırpar (trim) sonra parseInt ile döndürür.
// Sorun: type="number" inputlara boşluklu değer girildiğinde bazı tarayıcılar "" döndürür
// (parseInt("") = NaN), bazıları " 5 " döndürür. "limRaw === ''" gibi string karşılaştırmaları
// da " " boşluğunu yanlış geçirir. Tek kaynak fix — tüm sayısal input okumaları buradan geçmeli.
export function numVal(el) {
  return parseInt((el?.value ?? '').trim());
}

export function downloadJSON(obj, filename) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
