// Genel UI / oturum durumu — herhangi bir veri alanına ait olmayan geçici state.
// simRunning: simülasyon kilidi ; openIdx: açık son-hesap kartı ; currentLang: aktif dil.
/**
 * @typedef {Object} UiStore
 * @property {boolean} simRunning
 * @property {number} openIdx
 * @property {string} currentLang
 */
/** @type {UiStore} */
export const uiStore = {
  simRunning: false,
  openIdx: -1,
  currentLang: localStorage.getItem('ops_lang') || 'tr',
};
