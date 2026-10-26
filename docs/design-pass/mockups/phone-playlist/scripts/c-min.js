// Preview only: window strip becomes a bottom tab bar; the settings button shows a menu icon.
(() => {
  document.getElementById('app-shell').appendChild(document.getElementById('window-strip'));
  const sprite = document.querySelector('.icon-sprite');
  const sym = document.createElementNS('http://www.w3.org/2000/svg', 'symbol');
  sym.id = 'i-menu'; sym.setAttribute('viewBox', '0 0 24 24');
  sym.innerHTML = '<path d="M4 5h16"/><path d="M4 12h16"/><path d="M4 19h16"/>';
  sprite.appendChild(sym);
  document.querySelector('.topbar-options-trigger use').setAttribute('href', '#i-menu');
})();
