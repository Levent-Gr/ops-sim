import { describe, it, expect } from 'vitest';
import { _validateConfig } from '../src/io.js';

// GÜVENLİK REGRESYONU: import edilen paket kodları (dims/cats/limits anahtarları)
// renderPkgCfgList içinde onclick="...('${kod}')" gibi JS-string bağlamına yazılır.
// safe() HTML-escape yapsa da tarayıcı attribute'taki &#39;'ı JS çalışmadan çözer;
// bu yüzden tek tırnak/özel karakter içeren bir kod stored-XSS oluşturabilirdi.
// _validateConfig artık PKG_CODE_RE ile anahtarları reddediyor. Bu testler düzeltmenin
// gerilemesini engeller.
describe('_validateConfig() — import güvenlik doğrulaması', () => {
  it('geçerli config kabul edilir', () => {
    expect(() => _validateConfig({
      dims: { LM1: [10, 10, 10], 'EUP-2': [20, 20, 20], U_10: [5, 5, 5] },
      cats: { small: ['LM1'], mid: ['EUP-2'], big: [] },
      limits: { LM1: 5 },
      palet: { l: 100, w: 100, h: 100 }
    })).not.toThrow();
  });

  it('boş / kısmi config kabul edilir', () => {
    expect(() => _validateConfig({})).not.toThrow();
    expect(() => _validateConfig({ dims: { A: [1, 1, 1] } })).not.toThrow();
  });

  it('tek tırnaklı (XSS) dims anahtarını reddeder', () => {
    expect(() => _validateConfig({ dims: { "LM1'); alert(1);('": [1, 1, 1] } }))
      .toThrow(/invalid package code/);
  });

  it('XSS payload içeren cats kodunu reddeder', () => {
    expect(() => _validateConfig({ cats: { small: ["LM1'-X"] } }))
      .toThrow(/invalid package code/);
  });

  it('XSS payload içeren limits anahtarını reddeder', () => {
    expect(() => _validateConfig({ limits: { '<img src=x onerror=alert(1)>': 3 } }))
      .toThrow(/invalid package code/);
  });

  it('cats kodu string değilse reddeder', () => {
    expect(() => _validateConfig({ cats: { mid: [{}] } }))
      .toThrow(/invalid package code/);
  });

  it('geçersiz dims boyutunu hâlâ reddeder (mevcut davranış korunur)', () => {
    expect(() => _validateConfig({ dims: { LM1: [10, 10] } })).toThrow(/invalid dims/);
    expect(() => _validateConfig({ dims: { LM1: [0, 10, 10] } })).toThrow(/invalid dims/);
    expect(() => _validateConfig({ dims: 'x' })).toThrow(/invalid dims/);
  });

  it('geçersiz cats/limits/palet tipini reddeder', () => {
    expect(() => _validateConfig({ cats: { small: 'x' } })).toThrow(/invalid cats/);
    expect(() => _validateConfig({ limits: [] })).toThrow(/invalid limits/);
    expect(() => _validateConfig({ palet: 'x' })).toThrow(/invalid palet/);
  });
});
