// Listens to the operator's microphone (opt-in, click-to-start only --
// never auto-starts) during a live service and watches the transcript
// for a spoken Bible reference ("John chapter 3 verse 16", "Jean 3
// 16") in English or French, surfacing it as a one-tap SUGGESTION --
// this module never broadcasts anything itself. A misheard word
// during a sermon must never silently change what the congregation
// sees; the operator always taps to actually show it (see
// projectionControl.js's call site).
//
// Chromium-only (window.SpeechRecognition/webkitSpeechRecognition) --
// isSupported() lets the call site hide the feature entirely rather
// than show a broken button, same pattern as localMediaStore.js.
//
// Numbers: Chrome's recognizer renders spoken numbers as EITHER
// digits ("sixteen" -> "16") OR words, inconsistently -- in practice
// small numbers (which dominate real chapter/verse references) come
// back as words at least as often as digits. The original version
// here only matched digits, which is the confirmed, reported cause of
// "sometimes works, sometimes doesn't": it depended entirely on
// whichever form Chrome happened to pick for that specific number.
// findReferenceInText() below now resolves EITHER form via
// EN_NUMBER_WORDS/FR_NUMBER_WORDS (covering every value 0-199, enough
// for every real chapter (max 150, Psalms) and verse (max 176, Psalm
// 119) in the Bible), tagged with the language the matched book alias
// itself came from (aliasesForName() now carries a `lang`).

export function isSupported() {
  return 'SpeechRecognition' in window || 'webkitSpeechRecognition' in window;
}

function stripAccents(str) {
  return str.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// ASR commonly renders a numeric book prefix as an ordinal WORD
// ("First Corinthians") rather than the literal digit ("1
// Corinthians") that `bible_books.name_en`/`name_fr` actually store --
// same idea in French ("Premiere"/"Deuxieme" for "1 Jean"/"2 Jean",
// accents already stripped by the time this runs). Generating both
// forms as aliases means either spoken style gets matched.
const ORDINAL_PREFIXES = {
  1: ['1', '1er', '1re', '1st', 'first', 'premier', 'premiere'],
  2: ['2', '2e', '2eme', '2nd', 'second', 'seconde', 'deuxieme'],
  3: ['3', '3e', '3eme', '3rd', 'third', 'troisieme'],
};

function aliasesForName(name, lang) {
  const norm = stripAccents(name).toLowerCase().replace(/[-']/g, ' ').replace(/\s+/g, ' ').trim();
  const prefixMatch = norm.match(/^([123])\s+(.+)$/);
  if (!prefixMatch) return [{ alias: norm, lang }];
  const [, digit, rest] = prefixMatch;
  return ORDINAL_PREFIXES[Number(digit)].map((p) => ({ alias: `${p} ${rest}`, lang }));
}

// How people actually say some books, besides the name stored in
// bible_books (singular/plural, the other common French spelling,
// longer or shorter forms). Keyed by book number.
const EXTRA_ALIASES = {
  19: { fr: ['psaume', 'ps'], en: ['psalm'] },
  21: { fr: ['qohelet', 'ecclesiastes'], en: [] },
  22: { fr: ['cantique', 'cantiques'], en: ['song of songs', 'songs'] },
  23: { fr: ['isaie', 'esaie'], en: [] },
  26: { fr: ['ezekiel'], en: [] },
  40: { fr: ['matthieu', 'mathieu'], en: ['matthew'] },
  44: { fr: ['actes des apotres', 'acte des apotres', 'acte'], en: ['acts of the apostles'] },
  58: { fr: ['hebreu'], en: [] },
  59: { fr: ['jacque'], en: [] },
  66: { fr: ['revelation', 'apocalypses'], en: ['revelations'] },
};

// [{ alias, bookNumber, lang }], longest alias first so e.g. "1
// corinthians" is tried before a bare "corinthians" substring match
// could grab it out of context -- sourced from the SAME `bible_books`
// rows the Bible tab's own book picker already loads, one list, two
// UIs. `lang` ('en'/'fr') records which name field the alias came
// from, so findReferenceInText() knows which number-word vocabulary
// to use for whatever follows it.
export function buildBookAliases(books) {
  const aliases = [];
  const seen = new Set();
  const add = (alias, bookNumber, lang) => {
    const key = `${alias}|${bookNumber}`;
    if (!alias || seen.has(key)) return;
    seen.add(key);
    aliases.push({ alias, words: alias.split(' '), bookNumber, lang });
  };
  (books || []).forEach((b) => {
    aliasesForName(b.name_en || '', 'en').forEach(({ alias, lang }) => add(alias, b.number, lang));
    aliasesForName(b.name_fr || '', 'fr').forEach(({ alias, lang }) => add(alias, b.number, lang));
    const extra = EXTRA_ALIASES[b.number];
    if (extra) {
      extra.fr.forEach((x) => aliasesForName(x, 'fr').forEach(({ alias, lang }) => add(alias, b.number, lang)));
      extra.en.forEach((x) => aliasesForName(x, 'en').forEach(({ alias, lang }) => add(alias, b.number, lang)));
    }
  });
  // Longest first: "1 jean" must win over "jean" at the same place.
  aliases.sort((a, b) => b.words.length - a.words.length || b.alias.length - a.alias.length);
  return aliases;
}

// ---- Spoken number words -> integer, English and French ----
// Built programmatically rather than hand-listed -- especially French,
// where 70-99 are irregular compounds ("soixante-dix" = 60+10,
// "quatre-vingt-dix-neuf" = 4*20+10+9) that are far easier to get
// right by generating every combination than by transcribing each one
// by hand. Keys are space-joined, already-normalized (accent-stripped,
// lowercase, hyphens treated as spaces) word sequences.

function buildEnglishNumberWords() {
  const ones = { 0: 'zero', 1: 'one', 2: 'two', 3: 'three', 4: 'four', 5: 'five', 6: 'six', 7: 'seven', 8: 'eight', 9: 'nine' };
  const teens = { 10: 'ten', 11: 'eleven', 12: 'twelve', 13: 'thirteen', 14: 'fourteen', 15: 'fifteen', 16: 'sixteen', 17: 'seventeen', 18: 'eighteen', 19: 'nineteen' };
  const tens = { 20: 'twenty', 30: 'thirty', 40: 'forty', 50: 'fifty', 60: 'sixty', 70: 'seventy', 80: 'eighty', 90: 'ninety' };
  const map = {};
  const set = (words, value) => { map[words.join(' ')] = value; };
  for (let n = 0; n <= 9; n += 1) set([ones[n]], n);
  for (let n = 10; n <= 19; n += 1) set([teens[n]], n);
  Object.entries(tens).forEach(([base, word]) => {
    const b = Number(base);
    set([word], b);
    for (let n = 1; n <= 9; n += 1) set([word, ones[n]], b + n);
  });
  return map;
}

function buildFrenchNumberWords() {
  const ones = { 0: 'zero', 1: 'un', 2: 'deux', 3: 'trois', 4: 'quatre', 5: 'cinq', 6: 'six', 7: 'sept', 8: 'huit', 9: 'neuf' };
  const teensIrregular = { 10: 'dix', 11: 'onze', 12: 'douze', 13: 'treize', 14: 'quatorze', 15: 'quinze', 16: 'seize' };
  const map = {};
  const set = (words, value) => { map[words.join(' ')] = value; };

  for (let n = 0; n <= 9; n += 1) set([ones[n]], n);
  for (let n = 10; n <= 16; n += 1) set([teensIrregular[n]], n);
  for (let n = 17; n <= 19; n += 1) set([teensIrregular[10], ones[n - 10]], n); // dix sept/huit/neuf

  ['vingt', 'trente', 'quarante', 'cinquante'].forEach((word, idx) => {
    const b = (idx + 2) * 10; // vingt=20, trente=30, quarante=40, cinquante=50
    set([word], b);
    set([word, ones[1]], b + 1);
    set([word, 'et', ones[1]], b + 1);
    for (let n = 2; n <= 9; n += 1) set([word, ones[n]], b + n);
  });

  // 60-69
  set(['soixante'], 60);
  set(['soixante', ones[1]], 61);
  set(['soixante', 'et', ones[1]], 61);
  for (let n = 2; n <= 9; n += 1) set(['soixante', ones[n]], 60 + n);

  // 70-79: soixante + (10-19 word)
  set(['soixante', teensIrregular[10]], 70);
  set(['soixante', 'onze'], 71);
  set(['soixante', 'et', 'onze'], 71);
  for (let n = 12; n <= 16; n += 1) set(['soixante', teensIrregular[n]], 60 + n);
  for (let n = 17; n <= 19; n += 1) set(['soixante', teensIrregular[10], ones[n - 10]], 60 + n);

  // 80-99: quatre vingt(s) + ones, then + (10-19 word)
  [['quatre', 'vingt'], ['quatre', 'vingts']].forEach((prefix) => {
    set(prefix, 80);
    for (let n = 1; n <= 9; n += 1) set([...prefix, ones[n]], 80 + n);
    set([...prefix, teensIrregular[10]], 90);
    for (let n = 11; n <= 16; n += 1) set([...prefix, teensIrregular[n]], 80 + n);
    for (let n = 17; n <= 19; n += 1) set([...prefix, teensIrregular[10], ones[n - 10]], 80 + n);
  });

  return map;
}

const NUMBER_WORDS = { en: buildEnglishNumberWords(), fr: buildFrenchNumberWords() };
const HUNDRED_WORD = { en: 'hundred', fr: 'cent' };
const MAX_WORDS_PER_NUMBER = 4; // e.g. French "quatre vingt dix neuf" (99) is 4 words

// Tries to consume a number starting at words[i]. Returns
// { value, consumed } or null. Checked longest-phrase-first so e.g.
// "one hundred seventy six" resolves as a single 176, not a lone 1.
function consumeNumberAt(words, i, lang) {
  if (/^\d+$/.test(words[i])) return { value: Number(words[i]), consumed: 1 };
  // "1er", "2e", "3eme", "21st"…
  const ord = /^(\d+)(er|re|e|eme|nd|st|rd|th)$/.exec(words[i] || '');
  if (ord) return { value: Number(ord[1]), consumed: 1 };
  if (words[i] === 'premier' || words[i] === 'premiere' || words[i] === 'first') return { value: 1, consumed: 1 };

  const hundredWord = HUNDRED_WORD[lang];
  const hasLeadingOne = lang === 'en' && words[i] === 'one' && words[i + 1] === hundredWord;
  const isBareHundred = words[i] === hundredWord;
  if (hasLeadingOne || isBareHundred) {
    const afterHundredIdx = i + (hasLeadingOne ? 2 : 1);
    for (let len = MAX_WORDS_PER_NUMBER; len >= 0; len -= 1) {
      if (len === 0) return { value: 100, consumed: afterHundredIdx - i };
      const phrase = words.slice(afterHundredIdx, afterHundredIdx + len).join(' ');
      if (phrase in NUMBER_WORDS[lang]) {
        return { value: 100 + NUMBER_WORDS[lang][phrase], consumed: (afterHundredIdx - i) + len };
      }
    }
  }

  const map = NUMBER_WORDS[lang];
  for (let len = MAX_WORDS_PER_NUMBER; len >= 1; len -= 1) {
    const phrase = words.slice(i, i + len).join(' ');
    if (phrase in map) return { value: map[phrase], consumed: len };
  }
  return null;
}

// Scans a word-tokenized window for the first two resolved numbers
// (digit or word form), skipping any filler words ("chapter",
// "verset", etc.) in between -- same tolerant-of-phrasing approach the
// previous digit-only version already took, just number-word-aware.
function findTwoNumbers(words, lang) {
  const found = [];
  let i = 0;
  while (i < words.length && found.length < 2) {
    const match = consumeNumberAt(words, i, lang);
    if (match) {
      found.push(match.value);
      i += match.consumed;
    } else {
      i += 1;
    }
  }
  return found.length === 2 ? found : null;
}

// Turns a transcript into plain words: lower case, no accents, and
// "3:16", "3.16", "3-16", "3,16" split into separate numbers.
// "première épître de Jean", "évangile selon Jean", "first epistle of
// John" are reduced to "premiere jean", "jean", "first john".
const DROP = new Set(['epitre', 'epitres', 'lettre', 'evangile', 'gospel', 'epistle', 'letter']);
const DROP_AFTER = new Set(['de', 'du', 'des', 'aux', 'a', 'selon', 'of', 'to', 'the', 'according']);
function tokenize(text) {
  const raw = stripAccents(String(text || '')).toLowerCase()
    .replace(/(\d)[:.,](\d)/g, '$1 $2')
    .replace(/[-'’]/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/).filter(Boolean);
  const out = [];
  for (let i = 0; i < raw.length; i += 1) {
    if (DROP.has(raw[i])) {
      while (DROP_AFTER.has(raw[i + 1])) i += 1;
      continue;
    }
    out.push(raw[i]);
  }
  return out;
}

// Words that may sit between the book name and the numbers.
const FILLER = new Set(['chapitre', 'chapitres', 'chap', 'chapter', 'chapters', 'chapt', 'verset', 'versets', 'vers', 'verse', 'verses', 'v', 'au', 'a', 'et', 'and', 'to', 'du', 'de', 'des', 'le', 'la', 'les', 'l', 'd', 'in', 'of', 'the', 'number', 'numero', 'en', 'dans', 'livre', 'book']);
const MAX_GAP_WORDS = 4; // non-number, non-filler words allowed before giving up

function numbersAfter(words, start, lang) {
  const found = [];
  let i = start;
  let gap = 0;
  while (i < words.length && found.length < 2) {
    const m = consumeNumberAt(words, i, lang) || consumeNumberAt(words, i, lang === 'fr' ? 'en' : 'fr');
    if (m) { found.push(m.value); i += m.consumed; gap = 0; continue; }
    if (!FILLER.has(words[i])) { gap += 1; if (gap > MAX_GAP_WORDS) break; }
    i += 1;
  }
  return found.length === 2 ? { numbers: found, end: i } : null;
}

// Finds the LAST "<book> … <chapter> … <verse>" in the text (the most
// recent thing said), matching book names as whole words only. Returns
// { bookNumber, chapter, verse, end } (end = word index after the
// verse) or null. Needs both numbers: "Romains 8" alone is more often
// sermon talk than a citation.
export function findReferenceInText(text, aliases) {
  const words = Array.isArray(text) ? text : tokenize(text);
  let best = null;
  for (let i = 0; i < words.length; i += 1) {
    for (const a of aliases) {
      const w = a.words || a.alias.split(' ');
      let ok = true;
      for (let k = 0; k < w.length; k += 1) { if (words[i + k] !== w[k]) { ok = false; break; } }
      if (!ok) continue;
      const nums = numbersAfter(words, i + w.length, a.lang || 'en');
      if (nums) {
        const [chapter, verse] = nums.numbers;
        if (chapter >= 1 && chapter <= 150 && verse >= 1 && verse <= 176) {
          best = { bookNumber: a.bookNumber, chapter, verse, end: nums.end };
        }
      }
      i += w.length - 1; // "1 jean": don't also read the "jean" inside it
      break; // longest alias at this position wins
    }
  }
  return best;
}

const REPEAT_WINDOW_MS = 60000; // the same reference twice within a minute is one citation
const BUFFER_WORDS = 40; // recent speech kept across Chrome's sentence breaks

// `lang`: 'fr-CA', 'fr-FR' or 'en-US'. `getAliases()`: current
// buildBookAliases() output (a function, so books that finish loading
// after listening started are still used). Callbacks:
//   onDetect({ bookNumber, chapter, verse }) -- a reference was heard
//   onHeard(text) -- what was just heard (for the on-screen caption)
//   onStatus('listening' | 'reconnecting' | 'stopped')
//   onError(code) -- listening stopped for good: 'not-allowed' (mic
//     refused), 'audio-capture' (no microphone), 'network', 'restart-failed'
export function createVoiceVerseDetector({ lang, aliases, getAliases, onDetect, onHeard, onStatus, onError }) {
  const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
  const aliasList = () => (getAliases ? getAliases() : aliases) || [];
  let recognition = null;
  let listening = false;
  let stoppedByCaller = false;
  let finalWords = [];
  const fired = new Map(); // key -> time
  let restartTimer = null;
  let failures = 0;

  function check(words, isFinal) {
    const match = findReferenceInText(words, aliasList());
    if (!match) return;
    const key = `${match.bookNumber}:${match.chapter}:${match.verse}`;
    const now = Date.now();
    for (const [k, at] of fired) if (now - at > REPEAT_WINDOW_MS) fired.delete(k);
    if (isFinal) finalWords = finalWords.slice(Math.min(finalWords.length, match.end)); // don't scan it again
    if (fired.has(key)) return;
    fired.set(key, now);
    onDetect?.({ bookNumber: match.bookNumber, chapter: match.chapter, verse: match.verse });
  }

  function build() {
    const r = new Ctor();
    r.continuous = true;
    r.interimResults = true; // react while the pastor is still talking
    r.maxAlternatives = 1;
    r.lang = lang;

    r.onresult = (event) => {
      failures = 0;
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const res = event.results[i];
        const text = res[0]?.transcript || '';
        if (res.isFinal) {
          finalWords = [...finalWords, ...tokenize(text)].slice(-BUFFER_WORDS);
          check(finalWords, true);
        } else {
          interim += ` ${text}`;
        }
      }
      const live = [...finalWords, ...tokenize(interim)].slice(-BUFFER_WORDS);
      if (interim.trim()) check(live, false);
      onHeard?.(`${(event.results[event.results.length - 1]?.[0]?.transcript || '').trim()}`);
    };

    r.onerror = (event) => {
      const e = event.error;
      if (e === 'not-allowed' || e === 'service-not-allowed' || e === 'audio-capture') {
        stoppedByCaller = true;
        listening = false;
        onStatus?.('stopped');
        onError?.(e === 'audio-capture' ? 'audio-capture' : 'not-allowed');
      }
      // 'no-speech', 'aborted', 'network': onend below restarts.
      if (e === 'network') failures += 1;
    };

    r.onend = () => {
      if (stoppedByCaller) { listening = false; onStatus?.('stopped'); return; }
      scheduleRestart();
    };
    return r;
  }

  // Chrome ends a "continuous" session by itself every minute or so,
  // and after silence or a network blip. Start a fresh one shortly
  // after, backing off if it keeps failing.
  function scheduleRestart() {
    clearTimeout(restartTimer);
    onStatus?.('reconnecting');
    const wait = Math.min(5000, 250 * (2 ** Math.min(failures, 4)));
    restartTimer = setTimeout(() => {
      if (stoppedByCaller) return;
      try {
        recognition = build();
        recognition.start();
        onStatus?.('listening');
      } catch {
        failures += 1;
        if (failures > 8) {
          listening = false;
          onStatus?.('stopped');
          onError?.(navigator.onLine === false ? 'network' : 'restart-failed');
          return;
        }
        scheduleRestart();
      }
    }, wait);
  }

  return {
    start() {
      stoppedByCaller = false;
      failures = 0;
      finalWords = [];
      try {
        recognition = build();
        recognition.start();
        listening = true;
        onStatus?.('listening');
      } catch { listening = true; scheduleRestart(); }
    },
    stop() {
      stoppedByCaller = true;
      listening = false;
      clearTimeout(restartTimer);
      try { recognition?.abort(); } catch { /* already stopped */ }
      onStatus?.('stopped');
    },
    isListening() { return listening; },
  };
}
