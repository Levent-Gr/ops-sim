import { describe, it, expect } from 'vitest';
import {
  configStore, deliveryStore, grupStore,
  chargeStore, historyStore, uiStore
} from '../src/state.js';

// Seviye 2 tam göç sonrası: artık tek "state" god object yok; barrel (state.js)
// alan-bazlı store'ları re-export ediyor. Bu test, her store'un ayrı bir nesne
// olduğunu ve beklenen alanları taşıdığını doğrular (yanlış birleştirmeyi yakalar).
describe('alan-bazlı store\'lar (barrel re-export)', () => {
  it('tüm store\'lar tanımlı ve ayrı nesneler', () => {
    const stores = [configStore, deliveryStore, grupStore, chargeStore, historyStore, uiStore];
    stores.forEach(s => expect(typeof s).toBe('object'));
    expect(new Set(stores).size).toBe(stores.length); // hiçbiri aynı referans değil
  });

  it('her store kendi alanlarını barındırır', () => {
    expect(configStore).toHaveProperty('DIMS');
    expect(configStore).toHaveProperty('PALET_VOL');
    expect(deliveryStore).toHaveProperty('deliveries');
    expect(deliveryStore).toHaveProperty('deliveryFolders');
    expect(grupStore).toHaveProperty('grups');
    expect(chargeStore).toHaveProperty('chargeCache');
    expect(historyStore).toHaveProperty('histCache');
    expect(uiStore).toHaveProperty('currentLang');
  });

  it('store mutasyonu bağımsız ve kalıcı', () => {
    deliveryStore.deliveries = [{ id: 'x' }];
    expect(deliveryStore.deliveries).toHaveLength(1);
    expect(grupStore.grups).toHaveLength(0); // diğer store etkilenmez
    deliveryStore.deliveries = []; // temizle
  });
});
