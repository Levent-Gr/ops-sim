// Paket & palet konfigürasyonu. Sahibi: config.js (loadConfig/saveConfig).
// DIMS: { kod: [l, w, h] } ; SMALL/MID/BIG: kategori listeleri ;
// LIMITS: { kod: maxAdet } ; PALET_VOL: mm³ cinsinden palet hacmi.
/**
 * @typedef {Object} ConfigStore
 * @property {Record<string, [number,number,number]>} DIMS
 * @property {string[]} SMALL
 * @property {string[]} MID
 * @property {string[]} BIG
 * @property {string[]} ALL_ORDER
 * @property {Record<string, number>} LIMITS
 * @property {Record<string, string>} CAT_CLASS
 * @property {number} PALET_VOL
 */
/** @type {ConfigStore} */
export const configStore = {
  DIMS: {},
  SMALL: [],
  MID: [],
  BIG: [],
  ALL_ORDER: [],
  LIMITS: {},
  CAT_CLASS: {},
  PALET_VOL: 0,
};
