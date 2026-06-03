# OPS · SIM

Paket/palet simülasyon ve teslimat takip aracı. Saha çalışanları için tasarlanmış, tamamen tarayıcıda çalışan bir uygulamadır. Veriler IndexedDB'de yerel olarak saklanır; backend, kullanıcı hesabı veya harici servis yoktur.

## Özellikler

- **Simülasyon:** Paket kodlarından otomatik palet hesabı, kategori dağılımı, donut/bar grafikleri
- **Teslimat:** Teslimat kayıtları, hatlar, sürükle-bırak ile organizasyon
- **Sevkiyatlar:** Teslimatları sevkiyatlara ayırma, not ekleme, arşivleme
- **Analiz:** Tahmin vs gerçekleşen palet doğruluk analizi (teslimat grubu bazlı)
- **Şarj sistemi:** Anlık paket sayımı, forecast, kalibrasyon, CSV dışa aktarma
- **Geçmiş:** Tüm hesaplama geçmişi, detay görüntüleme
- **Ayarlar:** Paket boyutları/limitleri, palet boyutu, dark/light tema, TR/EN dil desteği
- **Backup:** JSON ile tam yedekleme ve geri yükleme

## Kurulum

```bash
npm install
npm run dev
```

Tarayıcıda http://localhost:5173 açılır.

## Production Build

```bash
npm run build
npm run preview
```

Build çıktısı `dist/` klasöründe olur ve herhangi bir statik hosting'e (GitHub Pages, Netlify, vb.) yüklenebilir.

## Mimari

Modüller `src/` kökünde düz `.js` dosyaları olarak yaşar (alt klasör hiyerarşisi yoktur).
Durum (state), alana göre ayrılmış store'larda tutulur; `state.js` bunları tek noktadan
re-export eden bir barrel'dır.

```
src/
├── main.js              # Giriş noktası, event listener kurulumu, init
├── state.js             # Barrel: store'ları + sabitleri re-export eder
├── stores/              # Alan-bazlı durum nesneleri
│   ├── configStore.js   #   paket boyutları/limitleri, palet hacmi
│   ├── deliveryStore.js #   teslimatlar, klasörler
│   ├── grupStore.js     #   gruplar
│   ├── chargeStore.js   #   şarj önbelleği, alarm timer'ı
│   ├── historyStore.js  #   geçmiş önbelleği
│   └── uiStore.js       #   geçici UI durumu, dil seçimi
├── config.js            # Paket tanımları, palet boyutu, ayarlar
├── sim.js               # Simülasyon motoru + çizim yardımcıları (donut/bars)
├── charge.js            # Şarj/forecast sistemi + Chart.js
├── delivery.js          # Teslimat sekmesi
├── grup.js              # Gruplar sekmesi
├── history.js           # Geçmiş sekmesi + detay modal
├── io.js                # Backup/restore/temizleme (JSON)
├── db.js                # IndexedDB sarmalayıcısı
├── i18n.js              # Çoklu dil desteği (TR/EN)
├── theme.js             # Dark/light tema
├── dialog.js            # Uygulama içi onay/uyarı modalları
├── icons.js             # SVG ikon sabitleri
├── utils.js             # Yardımcı fonksiyonlar (tarih, XSS-safe, vb.)
└── styles/              # CSS — base, layout, components/
```

## Lisans

MIT
