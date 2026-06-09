// ops_sim — Author: Levent Görgü (github.com/Levent-Gr) — (c) 2026
export function setTheme(th) {
  document.body.className = document.body.className.replace(/theme-\w+/g, '').trim();
  if (th === 'dark') document.body.classList.add('theme-dark');
  localStorage.setItem('ops_theme', th);
  renderThemeBtns();
}

export function renderThemeBtns() {
  const cur = localStorage.getItem('ops_theme') || 'light';
  document.querySelectorAll('.theme-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.theme === cur)
  );
}

export function applyStoredTheme() {
  const th = localStorage.getItem('ops_theme') || 'light';
  if (th === 'dark') document.body.classList.add('theme-dark');
}
