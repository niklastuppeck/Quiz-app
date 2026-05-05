(function () {
  var KEY = 'cookie_consent';
  var stored = localStorage.getItem(KEY);

  function loadAdsense() {
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-8976838883771898';
    s.crossOrigin = 'anonymous';
    document.head.appendChild(s);
  }

  if (stored === 'accepted') { loadAdsense(); return; }
  if (stored === 'declined') { return; }

  var style = document.createElement('style');
  style.textContent = [
    '#consent-banner{position:fixed;bottom:0;left:0;right:0;background:#1e293b;border-top:1px solid #334155;',
    'padding:16px 20px;z-index:10000;display:flex;flex-direction:column;gap:12px;',
    'box-shadow:0 -4px 24px rgba(0,0,0,.5);}',
    '#consent-banner p{margin:0;font-size:13px;color:#94a3b8;line-height:1.55;}',
    '#consent-banner a{color:#6366f1;}',
    '#consent-banner .cb-row{display:flex;gap:10px;}',
    '#consent-accept{background:#6366f1;color:#fff;border:none;border-radius:8px;',
    'padding:10px 20px;font-size:14px;font-weight:600;cursor:pointer;flex:1;}',
    '#consent-decline{background:transparent;color:#64748b;border:1px solid #334155;',
    'border-radius:8px;padding:10px 20px;font-size:14px;cursor:pointer;flex:1;}'
  ].join('');
  document.head.appendChild(style);

  function showBanner() {
    var banner = document.createElement('div');
    banner.id = 'consent-banner';
    banner.innerHTML =
      '<p>Wir und unsere Partner (Google AdSense) nutzen Cookies für personalisierte Werbung. ' +
      'Mehr dazu in unserer <a href="/datenschutz.html">Datenschutzerklärung</a>.</p>' +
      '<div class="cb-row">' +
      '<button id="consent-accept">Akzeptieren</button>' +
      '<button id="consent-decline">Ablehnen</button>' +
      '</div>';
    document.body.appendChild(banner);

    banner.querySelector('#consent-accept').addEventListener('click', function () {
      localStorage.setItem(KEY, 'accepted');
      banner.remove();
      loadAdsense();
    });
    banner.querySelector('#consent-decline').addEventListener('click', function () {
      localStorage.setItem(KEY, 'declined');
      banner.remove();
    });
  }

  if (document.body) { showBanner(); }
  else { document.addEventListener('DOMContentLoaded', showBanner); }
})();
