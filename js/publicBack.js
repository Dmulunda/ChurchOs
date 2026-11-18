// "← Back" link at the top of the public pages reached from the guest
// welcome page (prayer, meet a pastor, give, I'm new, become a member,
// event registration). Goes back to the page the person came from in
// this app (welcome page or member app); when the page was opened
// directly (QR code, shared link) it goes to the welcome page.
const lang = (() => {
  try { const v = localStorage.getItem('choir-hub-lang'); if (v === 'en' || v === 'fr') return v; } catch { /* storage blocked */ }
  return (navigator.language || '').toLowerCase().startsWith('en') ? 'en' : 'fr';
})();

function cameFromThisSite() {
  try { return !!document.referrer && new URL(document.referrer).origin === location.origin && history.length > 1; } catch { return false; }
}

function addBackLink() {
  const container = document.body.querySelector(':scope > div') || document.body;
  const link = document.createElement('a');
  link.href = 'welcome.html';
  link.className = 'inline-flex items-center gap-1 mb-4 px-3 py-1.5 rounded-full bg-white border border-slate-200 text-sm font-medium text-slate-700 shadow-sm hover:border-amber-400';
  link.textContent = lang === 'fr' ? '← Retour' : '← Back';
  link.addEventListener('click', (e) => {
    if (cameFromThisSite()) { e.preventDefault(); history.back(); }
  });
  container.prepend(link);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', addBackLink);
else addBackLink();
