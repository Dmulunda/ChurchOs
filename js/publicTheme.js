// Shared look for the public guest pages (prayer, meet a pastor, give,
// I'm new, become a member, event registration), matching welcome.html:
// cream background, navy header with the logo and a Back button, navy
// buttons, gold focus ring, Fraunces headings. Pure presentation: each
// page's own script still renders its content; this only restyles it.
//
// Back goes to the page the person came from on this site (welcome page
// or member app); when the page was opened directly (QR code, shared
// link) it goes to the welcome page.
const NAVY = '#0B1F3A';
const lang = (() => {
  try { const v = localStorage.getItem('choir-hub-lang'); if (v === 'en' || v === 'fr') return v; } catch { /* storage blocked */ }
  return (navigator.language || '').toLowerCase().startsWith('en') ? 'en' : 'fr';
})();

const CSS = `
body{background:#F6F4EF!important;font-family:Inter,system-ui,-apple-system,'Segoe UI',sans-serif;color:#1B2433}
.vpd-top{background:${NAVY};position:sticky;top:0;z-index:30}
.vpd-top-inner{max-width:42rem;margin:0 auto;padding:12px 16px;display:flex;align-items:center;justify-content:space-between;gap:12px}
.vpd-back{height:44px;padding:0 14px;border-radius:22px;background:rgba(255,255,255,.12);color:#fff!important;font:600 14px Inter,sans-serif;display:inline-flex;align-items:center;gap:6px;text-decoration:none}
.vpd-back:hover{background:rgba(255,255,255,.2)}
.vpd-logo{background:#fff;border-radius:12px;padding:5px 9px;display:flex;align-items:center}
.vpd-logo img{height:30px;display:block}
.vpd-page-head img.h-20{display:none!important}
.vpd-page-head h1{font-family:Fraunces,Georgia,serif!important;font-weight:700!important;font-size:26px!important;line-height:1.15!important;color:${NAVY}!important}
.vpd-page-head h2{color:#8A6418!important;letter-spacing:1.2px}
.vpd-page-head p{color:#5B6475!important;font-size:15px!important}
.bg-white.rounded-xl,.bg-white.rounded-lg.shadow,.bg-white.rounded-2xl{border:1px solid #E6E1D6;border-radius:16px!important;box-shadow:none!important}
.bg-indigo-600,.bg-indigo-700,.bg-blue-600{background-color:${NAVY}!important}
.hover\\:bg-indigo-700:hover,.hover\\:bg-indigo-800:hover,.hover\\:bg-blue-700:hover{background-color:#1d3461!important}
.text-indigo-600,.text-indigo-700,.text-indigo-800{color:${NAVY}!important}
.bg-indigo-50,.bg-indigo-100{background-color:#EEF2F8!important}
.border-indigo-200,.border-indigo-300,.border-indigo-500,.border-indigo-600{border-color:${NAVY}!important}
.ring-indigo-500,.ring-indigo-300,.ring-indigo-200{--tw-ring-color:#E0B654!important}
button.bg-indigo-600,button.bg-indigo-700,a.bg-indigo-600,button[type=submit]{border-radius:14px!important;min-height:48px;font-weight:700}
input:not([type=checkbox]):not([type=radio]),select,textarea{border-color:#D9D3C6!important;border-radius:12px!important}
input:not([type=checkbox]):not([type=radio]),select{min-height:44px}
input:focus,select:focus,textarea:focus,button:focus-visible,a:focus-visible{outline:3px solid #E0B654!important;outline-offset:1px;box-shadow:none!important}
input[type=checkbox],input[type=radio]{accent-color:${NAVY}}
`;

function cameFromThisSite() {
  try { return !!document.referrer && new URL(document.referrer).origin === location.origin && history.length > 1; } catch { return false; }
}

function apply() {
  if (!document.querySelector('link[data-vpd-fonts]')) {
    const fonts = document.createElement('link');
    fonts.rel = 'stylesheet';
    fonts.dataset.vpdFonts = '1';
    fonts.href = 'https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600;9..144,700&family=Inter:wght@400;500;600;700&display=swap';
    document.head.appendChild(fonts);
  }
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  // The page's own heading block (logo + title) gets the new type; its
  // big logo is hidden because the navy bar now carries the logo.
  const container = document.body.querySelector(':scope > div');
  const head = container?.firstElementChild;
  if (head && !head.id?.endsWith('-content')) head.classList.add('vpd-page-head');

  const bar = document.createElement('header');
  bar.className = 'vpd-top';
  bar.innerHTML = `<div class="vpd-top-inner">
      <a href="welcome.html" class="vpd-back" data-vpd-back>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"></path></svg>
        <span></span>
      </a>
      <a href="welcome.html" class="vpd-logo"><img src="img/vpd-logo.png" alt="La Voix de la Puissance Divine"></a>
    </div>`;
  bar.querySelector('[data-vpd-back] span').textContent = lang === 'fr' ? 'Retour' : 'Back';
  bar.querySelector('[data-vpd-back]').addEventListener('click', (e) => {
    if (cameFromThisSite()) { e.preventDefault(); history.back(); }
  });
  document.body.prepend(bar);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply);
else apply();
