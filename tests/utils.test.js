import { describe, it, expect } from 'vitest';
import { safe, uid, isToday, todayDateStr } from '../src/utils.js';

describe('safe() — HTML-escape', () => {
  it('boş/null girdilerde boş string döner', () => {
    expect(safe(null)).toBe('');
    expect(safe(undefined)).toBe('');
    expect(safe('')).toBe('');
  });

  it('tehlikeli HTML karakterlerini kaçırır (XSS koruması)', () => {
    expect(safe('<script>alert(1)</script>'))
      .toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(safe(`a & b "c" 'd'`))
      .toBe('a &amp; b &quot;c&quot; &#39;d&#39;');
  });

  it('sayısal değerleri string olarak güvenle döndürür', () => {
    expect(safe(42)).toBe('42');
    expect(safe(0)).toBe('0');
  });

  it('idempotenttir denecek kadar tutarlı — zararsız metni değiştirmez', () => {
    expect(safe('Teslimat 12')).toBe('Teslimat 12');
  });
});

describe('uid()', () => {
  it('9 karakterlik string üretir', () => {
    expect(uid()).toHaveLength(9);
  });

  it('makul olasılıkla benzersizdir (1000 üretimde çakışma yok)', () => {
    const set = new Set();
    for (let i = 0; i < 1000; i++) set.add(uid());
    expect(set.size).toBe(1000);
  });
});

describe('todayDateStr()', () => {
  it('gg.aa.yyyy formatında, sıfır dolgulu üretir', () => {
    expect(todayDateStr()).toMatch(/^\d{2}\.\d{2}\.\d{4}$/);
  });
});

describe('isToday()', () => {
  it('boş/null için false döner', () => {
    expect(isToday('')).toBe(false);
    expect(isToday(null)).toBe(false);
    expect(isToday(undefined)).toBe(false);
  });

  it('bugünün tarihini içeren string için true döner', () => {
    const today = todayDateStr();
    expect(isToday(today + ' 14:30')).toBe(true);
    expect(isToday(today)).toBe(true);
  });

  it('farklı bir gün için false döner', () => {
    expect(isToday('01.01.2000 09:00')).toBe(false);
  });

  // REGRESYON KORUMASI — rapor 4.1 locale kırılganlığı DÜZELTİLDİ:
  // toLocaleString bazı ortamlarda "gg.aa.yyyy, ss:dd" (virgüllü) üretir.
  // isToday artık boşluk VEYA virgülle bölüyor; bugünkü kayıtlar her iki
  // formatta da doğru tanınmalı. Bu test düzeltmenin gerilemesini engeller.
  it('virgüllü locale çıktısında da bugünü TANIR (4.1 düzeltildi)', () => {
    const today = todayDateStr();
    expect(isToday(today + ', 14:30')).toBe(true);
    expect(isToday(today + ' 14:30')).toBe(true);
  });
});
