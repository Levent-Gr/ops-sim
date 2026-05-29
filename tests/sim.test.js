import { describe, it, expect, beforeEach } from 'vitest';
import { simulatePacking, seeded, shuffle } from '../src/sim.js';
import { configStore } from '../src/state.js';

// Testler için sade bir paket konfigürasyonu kur.
// vol(p) = DIMS[p][0]*[1]*[2]; PALET_VOL = bir paletin hacmi.
function setupConfig() {
  configStore.DIMS = {
    A: [10, 10, 10],   // vol 1000
    B: [20, 10, 10],   // vol 2000
    HUGE: [100, 100, 100] // vol 1.000.000 — palete sığmaz
  };
  configStore.SMALL = ['A'];
  configStore.MID = ['B'];
  configStore.BIG = [];
  configStore.LIMITS = {};
  configStore.PALET_VOL = 10000; // 10 adet A, ya da 5 adet B sığar
}

describe('seeded() / shuffle() — belirlenimci RNG', () => {
  it('aynı tohum aynı diziyi üretir', () => {
    const r1 = seeded(1234), r2 = seeded(1234);
    const a = [r1(), r1(), r1()];
    const b = [r2(), r2(), r2()];
    expect(a).toEqual(b);
  });

  it('shuffle aynı tohumla aynı sırayı verir', () => {
    const arr1 = [1, 2, 3, 4, 5];
    const arr2 = [1, 2, 3, 4, 5];
    shuffle(arr1, seeded(99));
    shuffle(arr2, seeded(99));
    expect(arr1).toEqual(arr2);
  });
});

describe('simulatePacking()', () => {
  beforeEach(setupConfig);

  it('boş/geçersiz girdi için null döner', () => {
    expect(simulatePacking([])).toBeNull();
    expect(simulatePacking(null)).toBeNull();
  });

  it('PALET_VOL 0 ise null döner', () => {
    configStore.PALET_VOL = 0;
    expect(simulatePacking(['A', 'A'])).toBeNull();
  });

  it('bilinmeyen paket kodunu unknown listesine alır', () => {
    const r = simulatePacking(['A', 'BILINMEYEN']);
    expect(r.unknown).toContain('BILINMEYEN');
  });

  it('palete sığmayan paketi oversized listesine alır', () => {
    const r = simulatePacking(['A', 'HUGE']);
    expect(r.oversized).toContain('HUGE');
  });

  it('yalnızca geçersiz paketler varsa 0 palet döner', () => {
    const r = simulatePacking(['HUGE', 'BILINMEYEN']);
    expect(r.paletCount).toBe(0);
    expect(r.totalPkg).toBe(2); // totalPkg ham girdi uzunluğudur
  });

  it('hacme göre makul palet sayısı hesaplar', () => {
    // 20 adet A = 20*1000 = 20000 hacim; PALET_VOL 10000 → en az 2 palet
    const r = simulatePacking(Array(20).fill('A'));
    expect(r.paletCount).toBeGreaterThanOrEqual(2);
    expect(r.totalPkg).toBe(20);
    expect(r.avgPkgPerPalet).toBeGreaterThan(0);
  });

  it('belirlenimcidir — aynı girdi aynı sonucu verir', () => {
    const input = ['A', 'A', 'B', 'A', 'B', 'A', 'B', 'A'];
    const r1 = simulatePacking([...input]);
    const r2 = simulatePacking([...input]);
    expect(r1.paletCount).toBe(r2.paletCount);
    expect(r1.sPkg).toEqual(r2.sPkg);
  });

  it('LIMITS bir kodun palet başına adedini sınırlar', () => {
    configStore.LIMITS = { A: 2 }; // palet başına en fazla 2 adet A
    const r = simulatePacking(Array(6).fill('A'));
    // 6 adet A, palet başına 2 ile → en az 3 palet
    expect(r.paletCount).toBeGreaterThanOrEqual(3);
  });
});
