// Entry point for welcome.html: the public front door for guests and
// visitors (no account needed). Everything shown comes from the
// public-portal edge function, which returns only public fields (church
// contact, program, public events, sermons). No member information is
// ever read here. Each button links to an existing public page.
import { supabase } from './supabaseClient.js';

const LANG_KEY = 'choir-hub-lang';
const TEXT = {
  en: {
    welcome: 'Welcome!',
    intro: "We're glad you're here. Find out what's happening, ask for prayer, meet a pastor or give, with no account needed.",
    prayer: 'Request prayer', prayerSub: 'Our intercession team will pray for you',
    pastor: 'Meet a pastor', pastorSub: 'Book a time to talk',
    give: 'Give', giveSub: 'Tithes and offerings by card or Interac',
    newHere: "I'm new here", newHereSub: 'Let us know you visited today',
    member: 'Become a member', memberSub: 'Fill in the membership form',
    signIn: 'Member sign-in', signInSub: 'Already have an account?',
    program: 'Church program', noProgram: 'The program will be posted soon.', special: 'Special', flyer: 'Flyer',
    events: 'Upcoming events', noEvents: 'No public events right now.', register: 'Register', free: 'Free',
    sermons: 'Recent sermons', noSermons: 'Sermons will appear here soon.', watch: 'Watch', listen: 'Listen', notes: 'Notes', more: 'Show more',
    contact: 'Find us', account: 'Want your own account? You can create one from the sign-in page; a pastor or admin then welcomes you into the church and your departments.',
    privacy: 'This page never shows information about our members.',
    error: 'Could not load the latest information. Please try again later.',
    langSwitch: 'Français',
  },
  fr: {
    welcome: 'Bienvenue !',
    intro: "Nous sommes heureux de vous accueillir. Découvrez ce qui se passe, demandez la prière, rencontrez un pasteur ou faites un don, sans créer de compte.",
    prayer: 'Demander la prière', prayerSub: "L'équipe d'intercession priera pour vous",
    pastor: 'Rencontrer un pasteur', pastorSub: 'Prenez rendez-vous',
    give: 'Faire un don', giveSub: 'Dîmes et offrandes par carte ou Interac',
    newHere: 'Je suis nouveau', newHereSub: "Signalez votre visite d'aujourd'hui",
    member: 'Devenir membre', memberSub: "Remplissez le formulaire d'adhésion",
    signIn: 'Connexion membres', signInSub: 'Vous avez déjà un compte ?',
    program: "Programme de l'église", noProgram: 'Le programme sera bientôt publié.', special: 'Spécial', flyer: 'Affiche',
    events: 'Événements à venir', noEvents: "Aucun événement public pour l'instant.", register: "S'inscrire", free: 'Gratuit',
    sermons: 'Prédications récentes', noSermons: 'Les prédications apparaîtront ici bientôt.', watch: 'Regarder', listen: 'Écouter', notes: 'Notes', more: 'Voir plus',
    contact: 'Nous trouver', account: "Vous voulez votre propre compte ? Créez-le depuis la page de connexion ; un pasteur ou un administrateur vous accueille ensuite dans l'église et vos départements.",
    privacy: "Cette page n'affiche jamais d'information sur nos membres.",
    error: "Impossible de charger les dernières informations. Réessayez plus tard.",
    langSwitch: 'English',
  },
};

let lang = (() => {
  try { const v = localStorage.getItem(LANG_KEY); if (v === 'en' || v === 'fr') return v; } catch { /* storage blocked */ }
  return (navigator.language || '').toLowerCase().startsWith('en') ? 'en' : 'fr';
})();
const tx = (k) => TEXT[lang][k] ?? TEXT.en[k] ?? k;
const locale = () => (lang === 'fr' ? 'fr-CA' : 'en-CA');

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s == null ? '' : String(s);
  return d.innerHTML;
}
function attr(s) { return esc(s).replace(/"/g, '&quot;'); }
function todayLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const fmtDay = (ymd) => new Date(`${ymd}T12:00:00`).toLocaleDateString(locale(), { weekday: 'long', day: 'numeric', month: 'long' });
const fmtDateTime = (iso) => new Date(iso).toLocaleString(locale(), { weekday: 'short', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
const fmtDate = (ymd) => new Date(`${ymd}T12:00:00`).toLocaleDateString(locale(), { day: 'numeric', month: 'long', year: 'numeric' });
const fmtPrice = (c) => (c ? new Intl.NumberFormat(locale(), { style: 'currency', currency: 'CAD' }).format(c / 100) : tx('free'));

let data = null;
let loading = true;
let showAllSermons = false;

function tile(href, icon, title, sub, accent) {
  return `<a href="${attr(href)}" class="flex items-start gap-3 rounded-2xl p-4 shadow-sm border ${accent ? 'bg-[#0B1F3A] text-white border-[#0B1F3A]' : 'bg-white border-slate-200 hover:border-amber-400'}">
    <span class="text-2xl leading-none mt-0.5">${icon}</span>
    <span><span class="block font-semibold">${esc(title)}</span><span class="block text-xs ${accent ? 'text-slate-300' : 'text-slate-500'} mt-0.5">${esc(sub)}</span></span>
  </a>`;
}

function section(title, inner) {
  return `<section class="mt-8"><h2 class="text-lg font-bold text-[#0B1F3A] mb-3">${esc(title)}</h2>${inner}</section>`;
}

function render() {
  const root = document.getElementById('welcome-root');
  document.documentElement.lang = lang;
  const church = data?.church || { name: 'La Voix de la Puissance Divine' };
  const logo = church.logo_url || 'img/vpd-logo.png';

  const header = `
    <header class="flex items-center justify-between gap-3 py-4">
      <img src="${attr(logo)}" alt="${attr(church.name)}" class="h-14 max-w-[60%] object-contain" onerror="this.src='img/vpd-logo.png'" />
      <button type="button" data-action="lang" class="text-sm px-3 py-1.5 rounded-full border border-slate-300 bg-white">${esc(tx('langSwitch'))}</button>
    </header>
    <div class="rounded-3xl bg-gradient-to-br from-[#0B1F3A] to-[#1d3461] text-white p-6">
      <p class="text-sm uppercase tracking-widest text-amber-300 font-semibold">${esc(church.name)}</p>
      <h1 class="text-3xl font-bold mt-1">${esc(tx('welcome'))}</h1>
      <p class="text-slate-200 mt-2 text-sm leading-relaxed">${esc(tx('intro'))}</p>
    </div>`;

  const tiles = `<div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-5">
    ${tile('prayer.html', '🙏', tx('prayer'), tx('prayerSub'))}
    ${tile('booking.html', '🤝', tx('pastor'), tx('pastorSub'))}
    ${tile('give.html', '💝', tx('give'), tx('giveSub'))}
    ${tile(`guest-checkin.html?d=${todayLocal()}`, '👋', tx('newHere'), tx('newHereSub'))}
    ${tile('register.html', '✍️', tx('member'), tx('memberSub'))}
    ${tile('index.html', '🔑', tx('signIn'), tx('signInSub'), true)}
  </div>`;

  if (!data) {
    root.innerHTML = header + tiles + `<p class="mt-8 text-sm text-slate-500">${loading ? '…' : esc(tx('error'))}</p>`;
    bind();
    return;
  }

  // Program grouped by day.
  const byDay = new Map();
  (data.program || []).forEach((p) => { if (!byDay.has(p.date)) byDay.set(p.date, []); byDay.get(p.date).push(p); });
  const program = byDay.size ? `<div class="space-y-2">${[...byDay.entries()].map(([day, list]) => `
    <div class="bg-white rounded-2xl border border-slate-200 p-4 ${day === todayLocal() ? 'ring-2 ring-amber-300' : ''}">
      <p class="text-sm font-semibold text-slate-600 first-letter:uppercase">${esc(fmtDay(day))}</p>
      ${list.map((p) => `<div class="mt-2">
        <p class="font-semibold">${esc(p.title)} ${p.is_special ? `<span class="ml-1 align-middle text-[11px] rounded-full bg-amber-100 text-amber-800 px-2 py-0.5">${esc(tx('special'))}</span>` : ''}</p>
        ${p.description ? `<p class="text-sm text-slate-600 whitespace-pre-line mt-0.5">${esc(p.description)}</p>` : ''}
        ${p.flyer_url ? `<a href="${attr(p.flyer_url)}" target="_blank" rel="noopener" class="inline-block mt-1 text-sm text-indigo-700 underline">${esc(tx('flyer'))}</a>` : ''}
      </div>`).join('')}
    </div>`).join('')}</div>` : `<p class="text-sm text-slate-500">${esc(tx('noProgram'))}</p>`;

  const events = (data.events || []).length ? `<div class="space-y-2">${data.events.map((e) => `
    <div class="bg-white rounded-2xl border border-slate-200 p-4 flex items-start justify-between gap-3">
      <div class="min-w-0">
        <p class="font-semibold">${esc(e.title)}</p>
        <p class="text-sm text-slate-600 first-letter:uppercase">${esc(fmtDateTime(e.start_at))}${e.location ? ` · ${esc(e.location)}` : ''}</p>
        <p class="text-xs text-slate-500 mt-0.5">${esc(fmtPrice(e.price_cents))}</p>
      </div>
      <a href="event.html?event=${encodeURIComponent(e.id)}" class="shrink-0 px-3 py-2 rounded-xl bg-indigo-600 text-white text-sm font-medium">${esc(tx('register'))}</a>
    </div>`).join('')}</div>` : `<p class="text-sm text-slate-500">${esc(tx('noEvents'))}</p>`;

  const allSermons = data.sermons || [];
  const shown = showAllSermons ? allSermons : allSermons.slice(0, 4);
  const sermons = allSermons.length ? `<div class="space-y-2">${shown.map((s) => `
    <div class="bg-white rounded-2xl border border-slate-200 p-4">
      <p class="font-semibold">${esc(s.title)}</p>
      <p class="text-sm text-slate-600">${esc([s.preacher, s.preached_on && fmtDate(s.preached_on), s.scripture].filter(Boolean).join(' · '))}</p>
      ${s.summary ? `<p class="text-sm text-slate-600 mt-1">${esc(s.summary)}</p>` : ''}
      <div class="flex flex-wrap gap-2 mt-2">
        ${s.video_url ? `<a href="${attr(s.video_url)}" target="_blank" rel="noopener" class="px-3 py-1.5 rounded-lg bg-rose-50 text-rose-700 text-sm font-medium">▶ ${esc(tx('watch'))}</a>` : ''}
        ${s.audio_url ? `<a href="${attr(s.audio_url)}" target="_blank" rel="noopener" class="px-3 py-1.5 rounded-lg bg-indigo-50 text-indigo-700 text-sm font-medium">🎧 ${esc(tx('listen'))}</a>` : ''}
        ${s.notes_url ? `<a href="${attr(s.notes_url)}" target="_blank" rel="noopener" class="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 text-sm font-medium">📄 ${esc(tx('notes'))}</a>` : ''}
      </div>
    </div>`).join('')}
    ${!showAllSermons && allSermons.length > 4 ? `<button type="button" data-action="more" class="w-full py-2 text-sm text-indigo-700">${esc(tx('more'))}</button>` : ''}
  </div>` : `<p class="text-sm text-slate-500">${esc(tx('noSermons'))}</p>`;

  const c = data.church || {};
  const contactBits = [
    c.address && `<p>📍 <a class="underline" target="_blank" rel="noopener" href="https://maps.google.com/?q=${encodeURIComponent(c.address)}">${esc(c.address)}</a></p>`,
    c.phone && `<p>📞 <a class="underline" href="tel:${attr(c.phone.replace(/[^\d+]/g, ''))}">${esc(c.phone)}</a></p>`,
    c.email && `<p>✉️ <a class="underline" href="mailto:${attr(c.email)}">${esc(c.email)}</a></p>`,
  ].filter(Boolean).join('');
  const contact = contactBits ? section(tx('contact'), `<div class="bg-white rounded-2xl border border-slate-200 p-4 space-y-1 text-sm">${contactBits}</div>`) : '';

  root.innerHTML = header + tiles
    + section(tx('program'), program)
    + section(tx('events'), events)
    + section(tx('sermons'), sermons)
    + contact
    + `<div class="mt-8 rounded-2xl bg-amber-50 border border-amber-200 p-4 text-sm text-amber-900">${esc(tx('account'))}</div>`
    + `<p class="mt-4 text-xs text-slate-400 text-center">🔒 ${esc(tx('privacy'))}</p>`;
  bind();
}

function bind() {
  document.querySelector('[data-action="lang"]')?.addEventListener('click', () => {
    lang = lang === 'fr' ? 'en' : 'fr';
    try { localStorage.setItem(LANG_KEY, lang); } catch { /* storage blocked */ }
    render();
  });
  document.querySelector('[data-action="more"]')?.addEventListener('click', () => { showAllSermons = true; render(); });
}

async function main() {
  render();
  const { data: result, error } = await supabase.functions.invoke('public-portal', { body: {} });
  if (!error && result) data = result;
  loading = false;
  render();
}

main();
