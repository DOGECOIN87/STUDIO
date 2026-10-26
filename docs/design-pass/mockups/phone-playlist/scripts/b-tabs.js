// Preview only: PAT|SONG joins the tool row; the window strip becomes a bottom tab bar.
(() => {
  const toolbar = document.querySelector('.toolbar');
  toolbar.prepend(document.querySelector('.pat-song-stack'));
  document.getElementById('app-shell').appendChild(document.getElementById('window-strip'));
})();
