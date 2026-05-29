// Şarj (charge) takibi. Sahibi: charge.js.
// chargeCache: aktif/geçmiş şarj kayıtları ; chargeAlertTimer: setInterval handle'ı.
/**
 * @typedef {Object} ChargeStore
 * @property {Array<Object>} chargeCache
 * @property {ReturnType<typeof setInterval>|null} chargeAlertTimer
 */
/** @type {ChargeStore} */
export const chargeStore = {
  chargeCache: [],
  chargeAlertTimer: null,
};
