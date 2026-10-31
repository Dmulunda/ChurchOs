// Entry point for privacy.html — the public privacy policy page,
// anonymous visitors only (no auth gate), same pattern as welcomePage.js.
// The policy text itself is static bilingual HTML embedded in the page
// (two blocks, [data-lang-block="en"|"fr"]) rather than i18n.js keys --
// it's one-off legal prose, not reusable app UI strings.
import { getLang, setLang, onLangChange, applyStaticTranslations } from './i18n.js';

document.querySelector('[data-el="year"]').textContent = new Date().getFullYear();
document.documentElement.lang = getLang();

const langSelect = document.querySelector('#privacy-lang-select');
langSelect.value = getLang();
langSelect.addEventListener('change', () => setLang(langSelect.value));
onLangChange(() => {
  langSelect.value = getLang();
  applyStaticTranslations();
  showActiveLang();
});

applyStaticTranslations();
showActiveLang();

function showActiveLang() {
  const lang = getLang();
  document.documentElement.lang = lang;
  document.querySelectorAll('[data-lang-block]').forEach((el) => {
    el.classList.toggle('active', el.getAttribute('data-lang-block') === lang);
  });
}
