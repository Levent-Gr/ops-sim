// Gruplar. Sahibi: grup.js.
// gDragSrc: grup sürükle-bırak sırasında aktif kaynak öğe (geçici UI durumu).
/**
 * @typedef {Object} GrupStore
 * @property {Array<{id:string,name:string,ids:string[],open:boolean,note:string,createdAt:string}>} grups
 * @property {*} gDragSrc
 */
/** @type {GrupStore} */
export const grupStore = {
  grups: [],
  gDragSrc: null,
};
