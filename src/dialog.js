// Uygulama-içi onay/uyarı modalı — native confirm()/alert() yerine.
// Tema uyumlu, Promise tabanlı; mesaj textContent ile basılır (XSS güvenli).
import { t } from './i18n.js';

function buildOverlay(message) {
  const overlay = document.createElement('div');
  overlay.className = 'app-dialog-overlay';
  const box = document.createElement('div');
  box.className = 'app-dialog';
  const msg = document.createElement('div');
  msg.className = 'app-dialog-msg';
  msg.textContent = message;
  const actions = document.createElement('div');
  actions.className = 'app-dialog-actions';
  box.appendChild(msg);
  box.appendChild(actions);
  overlay.appendChild(box);
  return { overlay, actions };
}

function mkBtn(label, variant) {
  const b = document.createElement('button');
  b.className = 'app-dialog-btn' + (variant ? ' app-dialog-' + variant : '');
  b.textContent = label;
  return b;
}

// Onay modalı → Promise<boolean>
export function confirmDialog(message) {
  return new Promise(resolve => {
    const { overlay, actions } = buildOverlay(message);
    const cancel = mkBtn(t('dlg_cancel'), 'cancel');
    const ok = mkBtn(t('dlg_ok'), 'ok');
    actions.appendChild(cancel);
    actions.appendChild(ok);
    document.body.appendChild(overlay);

    const done = val => {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
      resolve(val);
    };
    const onKey = e => {
      if (e.key === 'Escape') done(false);
      else if (e.key === 'Enter') done(true);
    };
    cancel.addEventListener('click', () => done(false));
    ok.addEventListener('click', () => done(true));
    overlay.addEventListener('click', e => { if (e.target === overlay) done(false); });
    document.addEventListener('keydown', onKey);
    ok.focus();
  });
}

// Bilgi/uyarı modalı → Promise<void>
export function alertDialog(message) {
  return new Promise(resolve => {
    const { overlay, actions } = buildOverlay(message);
    const ok = mkBtn(t('dlg_ok'), 'ok');
    actions.appendChild(ok);
    document.body.appendChild(overlay);

    const done = () => {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
      resolve();
    };
    const onKey = e => { if (e.key === 'Escape' || e.key === 'Enter') done(); };
    ok.addEventListener('click', done);
    overlay.addEventListener('click', e => { if (e.target === overlay) done(); });
    document.addEventListener('keydown', onKey);
    ok.focus();
  });
}
