// Teslimat kayıtları ve klasörleri. Sahibi: delivery.js.
// deliveryDragSrc: sürükle-bırak sırasında aktif kaynak öğe (geçici UI durumu).
/**
 * @typedef {Object} DeliveryStore
 * @property {Array<Object>} deliveries
 * @property {Array<{id:string,name:string,ids:string[]}>} deliveryFolders
 * @property {*} deliveryDragSrc
 */
/** @type {DeliveryStore} */
export const deliveryStore = {
  deliveries: [],
  deliveryFolders: [],
  deliveryDragSrc: null,
};
