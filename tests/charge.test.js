import { describe, it, expect } from 'vitest';
import { calcShippedSoFar, calcAvgRateFromStart } from '../src/charge.js';

// Yardımcı: zaman damgalı snapshot üret (tsMs dakikalardan)
function snap(min, total, shipped = 0, avgAtTime) {
  return { tsMs: min * 60000, total, shipped, avgAtTime };
}

describe('calcShippedSoFar()', () => {
  it('snapshot yoksa sıfır döner', () => {
    expect(calcShippedSoFar({ snapshots: [] })).toEqual({ pkg: 0, palet: 0 });
    expect(calcShippedSoFar({})).toEqual({ pkg: 0, palet: 0 });
  });

  it('gelen paket = (son - ilk toplam) + sevk edilenler', () => {
    const rec = {
      avgPkgPerPalet: 100,
      snapshots: [snap(0, 1000), snap(30, 1200, 50), snap(60, 1500, 50)]
    };
    // arrived = (1500 - 1000) + (0+50+50) = 600
    const r = calcShippedSoFar(rec);
    expect(r.pkg).toBe(600);
    expect(r.palet).toBe(6); // floor(600/100)
  });

  it('avgPkgPerPalet verilmezse 150 varsayılır', () => {
    const rec = { snapshots: [snap(0, 0), snap(10, 300)] };
    const r = calcShippedSoFar(rec);
    expect(r.pkg).toBe(300);
    expect(r.palet).toBe(2); // floor(300/150)
  });

  it('negatif sonuç sıfıra kelepçelenir', () => {
    const rec = { avgPkgPerPalet: 100, snapshots: [snap(0, 1000), snap(10, 500)] };
    expect(calcShippedSoFar(rec).pkg).toBe(0);
  });
});

describe('calcAvgRateFromStart()', () => {
  const rec = {
    snapshots: [snap(0, 1000), snap(30, 1600, 0), snap(60, 2200, 0)]
  };

  it('geçersiz indeks için 0 döner', () => {
    expect(calcAvgRateFromStart(rec, 0)).toBe(0);
    expect(calcAvgRateFromStart(rec, 99)).toBe(0);
  });

  it('dakika başına gelen paket oranını hesaplar', () => {
    // idx=2: dt=60dk, incoming=(2200-1000)+0=1200 → 1200/60 = 20/dk
    expect(calcAvgRateFromStart(rec, 2)).toBeCloseTo(20, 5);
  });

  it('aynı anda alınan iki snapshot (dt=0) için 0 döner', () => {
    const r = { snapshots: [snap(0, 1000), snap(0, 1500)] };
    expect(calcAvgRateFromStart(r, 1)).toBe(0);
  });
});
