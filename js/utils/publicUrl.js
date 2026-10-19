// Builds a URL to one of this app's own public, unauthenticated pages
// (event.html, booking.html, guest-checkin.html) or static assets
// (img/...), resolved relative to the CURRENT page's own full URL --
// not window.location.origin alone, which is wrong on a GitHub Pages
// PROJECT site (e.g. dmulunda.github.io/ChurchOs/app.html isn't
// served from the domain root, so origin + "/event.html" resolves to
// dmulunda.github.io/event.html -- a 404). Resolving against
// window.location.href instead picks up that subpath automatically,
// and is a no-op difference on a site that IS served from the root
// (Main's own custom domain) -- same correct URL either way.
export function publicPageUrl(relativePath, params = {}) {
  const url = new URL(relativePath, window.location.href);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== null && value !== undefined && value !== '') url.searchParams.set(key, value);
  });
  return url.toString();
}
