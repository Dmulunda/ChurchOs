// Starter flyer templates + canvas size presets. Templates are plain
// descriptors, not raw Fabric.js JSON -- js/components/flyerEditor.js's
// applyTemplate() turns these into real Fabric objects. Position/size/
// font-size are all FRACTIONS of the canvas (0-1), scaled to whichever
// actual size (Instagram square/story, Letter/A4 poster) is picked, so
// one template definition works at any size rather than needing one
// per size.
export const FLYER_SIZES = {
  instagram_square: { labelKey: 'flyers.size.instagramSquare', width: 1080, height: 1080 },
  instagram_story: { labelKey: 'flyers.size.instagramStory', width: 1080, height: 1920 },
  poster_letter: { labelKey: 'flyers.size.posterLetter', width: 850, height: 1100 },
  poster_a4: { labelKey: 'flyers.size.posterA4', width: 827, height: 1169 },
  instagram_portrait: { labelKey: 'flyers.size.instagramPortrait', width: 1080, height: 1350 },
  facebook_post: { labelKey: 'flyers.size.facebookPost', width: 1200, height: 630 },
  facebook_cover: { labelKey: 'flyers.size.facebookCover', width: 1640, height: 624 },
  screen_16_9: { labelKey: 'flyers.size.screen', width: 1920, height: 1080 },
  half_letter: { labelKey: 'flyers.size.halfLetter', width: 550, height: 850 },
};

export const FLYER_CATEGORIES = [
  { key: 'concert', labelKey: 'flyers.category.concert' },
  { key: 'retreat', labelKey: 'flyers.category.retreat' },
  { key: 'sunday_service', labelKey: 'flyers.category.sundayService' },
  { key: 'prayer_night', labelKey: 'flyers.category.prayerNight' },
  { key: 'youth', labelKey: 'flyers.category.youth' },
  { key: 'conference', labelKey: 'flyers.category.conference' },
  { key: 'announcement', labelKey: 'flyers.category.announcement' },
];

export const FLYER_TEMPLATES = [
  {
    key: 'bold-announcement',
    category: 'announcement',
    labelKey: 'flyers.template.boldAnnouncement',
    background: '#1e293b',
    elements: [
      { type: 'rect', left: 0, top: 0, width: 1, height: 0.1, fill: '#4f46e5' },
      { type: 'text', left: 0.08, top: 0.28, width: 0.84, text: 'EVENT TITLE', role: 'title', fontSize: 0.09, fontFamily: 'Georgia, serif', fill: '#ffffff', fontWeight: 'bold', textAlign: 'center' },
      { type: 'text', left: 0.08, top: 0.44, width: 0.84, text: 'Subtitle or tagline', fontSize: 0.04, fontFamily: 'Arial, sans-serif', fill: '#cbd5e1', textAlign: 'center' },
      { type: 'rect', left: 0.1, top: 0.56, width: 0.8, height: 0.26, fill: '#334155' },
      { type: 'text', left: 0.08, top: 0.88, width: 0.84, text: 'Date · Time · Location', role: 'info', fontSize: 0.035, fontFamily: 'Arial, sans-serif', fill: '#ffffff', textAlign: 'center' },
    ],
  },
  {
    key: 'concert-night',
    category: 'concert',
    labelKey: 'flyers.template.concertNight',
    background: '#2e1065',
    elements: [
      { type: 'rect', left: 0.06, top: 0.06, width: 0.22, height: 0.06, fill: '#ec4899' },
      { type: 'text', left: 0.06, top: 0.065, width: 0.22, text: 'LIVE', fontSize: 0.03, fontFamily: 'Arial, sans-serif', fill: '#ffffff', fontWeight: 'bold', textAlign: 'center' },
      { type: 'text', left: 0.08, top: 0.35, width: 0.84, text: 'Concert Title', role: 'title', fontSize: 0.1, fontFamily: 'Georgia, serif', fill: '#ffffff', fontWeight: 'bold', textAlign: 'center' },
      { type: 'text', left: 0.08, top: 0.52, width: 0.84, text: 'Featuring the Choir & Worship Team', fontSize: 0.035, fontFamily: 'Arial, sans-serif', fill: '#e9d5ff', textAlign: 'center' },
      { type: 'text', left: 0.08, top: 0.85, width: 0.84, text: 'Saturday · 7:00 PM · Main Sanctuary', role: 'info', fontSize: 0.035, fontFamily: 'Arial, sans-serif', fill: '#ffffff', textAlign: 'center' },
    ],
  },
  {
    key: 'retreat-getaway',
    category: 'retreat',
    labelKey: 'flyers.template.retreatGetaway',
    background: '#f8fafc',
    elements: [
      { type: 'rect', left: 0.1, top: 0.08, width: 0.8, height: 0.42, fill: '#cbd5e1' },
      { type: 'text', left: 0.1, top: 0.26, width: 0.8, text: 'Add your photo', fontSize: 0.03, fontFamily: 'Arial, sans-serif', fill: '#64748b', textAlign: 'center' },
      { type: 'text', left: 0.08, top: 0.56, width: 0.84, text: 'Church Retreat', role: 'title', fontSize: 0.08, fontFamily: 'Georgia, serif', fill: '#1e293b', fontWeight: 'bold', textAlign: 'center' },
      { type: 'text', left: 0.08, top: 0.7, width: 0.84, text: 'A weekend to rest, connect and grow', fontSize: 0.035, fontFamily: 'Arial, sans-serif', fill: '#475569', textAlign: 'center' },
      { type: 'rect', left: 0, top: 0.88, width: 1, height: 0.12, fill: '#0f766e' },
      { type: 'text', left: 0.08, top: 0.915, width: 0.84, text: 'Register by Friday', role: 'info', fontSize: 0.032, fontFamily: 'Arial, sans-serif', fill: '#ffffff', textAlign: 'center' },
    ],
  },
  {
    key: 'sunday-service',
    category: 'sunday_service',
    labelKey: 'flyers.template.sundayService',
    background: '#fffbeb',
    elements: [
      { type: 'rect', left: 0, top: 0, width: 1, height: 0.07, fill: '#b45309' },
      { type: 'text', left: 0.08, top: 0.38, width: 0.84, text: 'Sunday Service', role: 'title', fontSize: 0.09, fontFamily: 'Georgia, serif', fill: '#78350f', fontWeight: 'bold', textAlign: 'center' },
      { type: 'text', left: 0.08, top: 0.54, width: 0.84, text: '"Come as you are"', fontSize: 0.04, fontFamily: 'Georgia, serif', fill: '#92400e', textAlign: 'center' },
      { type: 'text', left: 0.08, top: 0.86, width: 0.84, text: 'Every Sunday · 10:00 AM', role: 'info', fontSize: 0.035, fontFamily: 'Arial, sans-serif', fill: '#78350f', textAlign: 'center' },
    ],
  },
  {
    key: 'prayer-night',
    category: 'prayer_night',
    labelKey: 'flyers.template.prayerNight',
    background: '#0c0a1f',
    elements: [
      { type: 'rect', left: 0.42, top: 0.18, width: 0.16, height: 0.16, fill: '#facc15' },
      { type: 'text', left: 0.08, top: 0.42, width: 0.84, text: 'Night of Prayer', role: 'title', fontSize: 0.085, fontFamily: 'Georgia, serif', fill: '#ffffff', fontWeight: 'bold', textAlign: 'center' },
      { type: 'text', left: 0.08, top: 0.58, width: 0.84, text: 'Seeking God together', fontSize: 0.035, fontFamily: 'Arial, sans-serif', fill: '#c4b5fd', textAlign: 'center' },
      { type: 'text', left: 0.08, top: 0.87, width: 0.84, text: 'Friday · 8:00 PM', role: 'info', fontSize: 0.035, fontFamily: 'Arial, sans-serif', fill: '#ffffff', textAlign: 'center' },
    ],
  },
  {
    key: 'youth-night',
    category: 'youth',
    labelKey: 'flyers.template.youthNight',
    background: '#ea580c',
    elements: [
      { type: 'rect', left: 0.65, top: 0.05, width: 0.3, height: 0.3, fill: '#fbbf24' },
      { type: 'rect', left: 0.05, top: 0.65, width: 0.25, height: 0.25, fill: '#fde047' },
      { type: 'text', left: 0.08, top: 0.35, width: 0.84, text: 'YOUTH NIGHT', role: 'title', fontSize: 0.1, fontFamily: 'Arial, sans-serif', fill: '#ffffff', fontWeight: 'bold', textAlign: 'center' },
      { type: 'text', left: 0.08, top: 0.52, width: 0.84, text: 'Games · Worship · Hangout', fontSize: 0.04, fontFamily: 'Arial, sans-serif', fill: '#fff7ed', textAlign: 'center' },
      { type: 'text', left: 0.08, top: 0.88, width: 0.84, text: 'Friday · 6:30 PM · Youth Room', role: 'info', fontSize: 0.035, fontFamily: 'Arial, sans-serif', fill: '#ffffff', textAlign: 'center' },
    ],
  },
];
