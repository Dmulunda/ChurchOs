// Storage keys can't contain spaces, accents or curly quotes ("LA CHAIR
// CONTRE L’ESPRIT.PNG" -> "Invalid key"). Turns any file name into a
// safe one, keeping the extension; the original name is still shown to
// people from its own column where a feature keeps one.
export function safeFileName(name, fallback = 'file') {
  const raw = String(name || fallback);
  const dot = raw.lastIndexOf('.');
  const base = dot > 0 ? raw.slice(0, dot) : raw;
  const ext = dot > 0 ? raw.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '') : '';
  const clean = base.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9_-]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '').slice(0, 60) || fallback;
  return ext ? `${clean}.${ext}` : clean;
}
