(function() {
  var s = document.createElement('script');
  s.src = 'https://cdn.jsdelivr.net/npm/twemoji@14/dist/twemoji.min.js';
  s.onload = function() {
    twemoji.parse(document.body, { folder: 'svg', ext: '.svg' });
    var timer;
    var observer = new MutationObserver(function() {
      clearTimeout(timer);
      timer = setTimeout(function() {
        twemoji.parse(document.body, { folder: 'svg', ext: '.svg' });
      }, 150);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  };
  document.head.appendChild(s);
})();
