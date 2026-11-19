// Which church a public page is for (ChurchOnPoint hosts many churches).
// Public links carry ?church=<slug>; the slug is remembered for this tab
// so the church's other public pages (live, prayer, give, ...) stay on
// the same church, and links between those pages keep the parameter.
const KEY = 'cop-public-church';
const PUBLIC_PAGE = /^(welcome|live|prayer|register|give|event|booking|guest-checkin)\.html(?:[?#]|$)/;

export function churchSlug() {
  const fromUrl = new URLSearchParams(location.search).get('church');
  if (fromUrl) {
    try { sessionStorage.setItem(KEY, fromUrl); } catch { /* storage blocked */ }
    return fromUrl;
  }
  try { return sessionStorage.getItem(KEY) || null; } catch { return null; }
}

export function withChurch(href) {
  const slug = churchSlug();
  if (!slug || !PUBLIC_PAGE.test(href) || /[?&]church=/.test(href)) return href;
  const [path, hash = ''] = href.split('#');
  return `${path}${path.includes('?') ? '&' : '?'}church=${encodeURIComponent(slug)}${hash ? `#${hash}` : ''}`;
}

// Adds ?church= to links to the other public pages at click time, so
// pages rendered by any script keep the church without each link being
// built by hand.
let installed = false;
export function installChurchLinks() {
  if (installed) return;
  installed = true;
  document.addEventListener('click', (e) => {
    const a = e.target.closest?.('a[href]');
    if (!a) return;
    const href = a.getAttribute('href');
    const next = withChurch(href);
    if (next !== href) a.setAttribute('href', next);
  }, true);
}

// Body for the public-portal / live-status functions: the slug when the
// page has one; a signed-in member without one gets their own church.
export function churchBody() {
  const slug = churchSlug();
  return slug ? { church: slug } : {};
}
