export const FONT_PRESETS = [
  { group: 'serif', id: 'iowan', label: 'iowan old style', stack: '"Iowan Old Style", "Palatino Linotype", Georgia, serif' },
  { group: 'serif', id: 'charter', label: 'charter', stack: 'Charter, "Bitstream Charter", Georgia, serif' },
  { group: 'serif', id: 'baskerville', label: 'baskerville', stack: 'Baskerville, "Baskerville Old Face", Georgia, serif' },
  { group: 'serif', id: 'palatino', label: 'palatino', stack: 'Palatino, "Palatino Linotype", Georgia, serif' },
  { group: 'serif', id: 'georgia', label: 'georgia', stack: 'Georgia, "Times New Roman", serif' },
  { group: 'serif', id: 'times', label: 'times', stack: '"Times New Roman", Times, serif' },
  { group: 'serif', id: 'bookman', label: 'bookman', stack: '"Bookman Old Style", Bookman, Georgia, serif' },
  { group: 'serif', id: 'cochin', label: 'cochin', stack: 'Cochin, Georgia, serif' },
  { group: 'serif', id: 'didot', label: 'didot', stack: 'Didot, "Bodoni 72", Georgia, serif' },
  { group: 'serif', id: 'hoefler', label: 'hoefler text', stack: '"Hoefler Text", Georgia, serif' },
  { group: 'serif', id: 'system-serif', label: 'system serif', stack: 'ui-serif, Georgia, serif' },
  { group: 'sans', id: 'avenir', label: 'avenir next', stack: '"Avenir Next", Avenir, system-ui, sans-serif' },
  { group: 'sans', id: 'helvetica', label: 'helvetica neue', stack: '"Helvetica Neue", Helvetica, Arial, sans-serif' },
  { group: 'sans', id: 'optima', label: 'optima', stack: 'Optima, Candara, system-ui, sans-serif' },
  { group: 'sans', id: 'futura', label: 'futura', stack: 'Futura, "Century Gothic", system-ui, sans-serif' },
  { group: 'sans', id: 'gill-sans', label: 'gill sans', stack: '"Gill Sans", "Gill Sans MT", system-ui, sans-serif' },
  { group: 'sans', id: 'verdana', label: 'verdana', stack: 'Verdana, Geneva, sans-serif' },
  { group: 'sans', id: 'trebuchet', label: 'trebuchet', stack: '"Trebuchet MS", system-ui, sans-serif' },
  { group: 'sans', id: 'system-sans', label: 'system sans', stack: 'system-ui, -apple-system, "Segoe UI", sans-serif' },
  { group: 'mono', id: 'menlo', label: 'menlo', stack: 'Menlo, Monaco, Consolas, monospace' },
  { group: 'mono', id: 'courier', label: 'courier', stack: '"Courier New", Courier, monospace' },
  { group: 'mono', id: 'system-mono', label: 'system mono', stack: 'ui-monospace, "SFMono-Regular", Menlo, monospace' },
];

export const WIDTH_STOPS = [544, 640, 736, 832, 928];
export const MARGIN_STOPS = [24, 36, 48, 64, 80];
export const MOBILE_MARGIN_STOPS = [16, 20, 24, 28, 32];
export const PADDING_STOPS = [16, 24, 32, 48, 64];

export const DEFAULT_PREFERENCES = Object.freeze({
  theme: 'dark',
  fontFamily: 'iowan',
  fontSize: 18,
  lineHeight: 1.6,
  pageWidth: 736,
  margins: 48,
  padding: 48,
});

const byId = new Map(FONT_PRESETS.map((preset) => [preset.id, preset]));

function finite(value, fallback) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function closest(stops, value) {
  return stops.reduce((best, item) => (
    Math.abs(item - value) < Math.abs(best - value) ? item : best
  ), stops[0]);
}

export function normalizePreferences(value = {}) {
  const theme = value.theme === 'light' ? 'light' : 'dark';
  const fontFamily = byId.has(value.fontFamily) ? value.fontFamily : DEFAULT_PREFERENCES.fontFamily;
  return {
    theme,
    fontFamily,
    fontSize: Math.round(clamp(finite(value.fontSize, DEFAULT_PREFERENCES.fontSize), 12, 40)),
    lineHeight: Math.round(clamp(finite(value.lineHeight, DEFAULT_PREFERENCES.lineHeight), 1.2, 2.4) * 100) / 100,
    pageWidth: closest(WIDTH_STOPS, finite(value.pageWidth, DEFAULT_PREFERENCES.pageWidth)),
    margins: closest(MARGIN_STOPS, finite(value.margins, DEFAULT_PREFERENCES.margins)),
    padding: closest(PADDING_STOPS, finite(value.padding, DEFAULT_PREFERENCES.padding)),
  };
}

export function fontPreset(id) {
  return byId.get(id) || byId.get(DEFAULT_PREFERENCES.fontFamily);
}

export function stopIndex(stops, value) {
  return stops.indexOf(closest(stops, value));
}

export function responsiveMargin(preferences, viewportWidth = window.innerWidth) {
  const index = stopIndex(MARGIN_STOPS, preferences.margins);
  return viewportWidth <= 760 ? MOBILE_MARGIN_STOPS[index] : MARGIN_STOPS[index];
}

export function buildReaderTheme(preferences, viewportWidth = window.innerWidth) {
  const normalized = normalizePreferences(preferences);
  const dark = normalized.theme === 'dark';
  const background = dark ? '#0a0a0a' : '#f3f1ea';
  const text = dark ? '#f1eee5' : '#171717';
  const link = dark ? '#dedbd2' : '#62625e';
  const highlight = dark ? 'rgba(222, 219, 210, 0.22)' : 'rgba(133, 132, 126, 0.18)';
  const margin = responsiveMargin(normalized, viewportWidth);
  const width = Math.max(320, normalized.pageWidth - margin * 2);

  return {
    html: {
      background,
      color: text,
      '-webkit-user-select': 'text',
      'user-select': 'text',
    },
    body: {
      'box-sizing': 'border-box',
      width: `calc(100% - ${margin * 2}px)`,
      'max-width': `${width}px`,
      margin: '0 auto',
      padding: `${normalized.padding}px`,
      background,
      color: text,
      'font-family': fontPreset(normalized.fontFamily).stack,
      'font-size': `${normalized.fontSize}px`,
      'line-height': String(normalized.lineHeight),
      '-webkit-user-select': 'text',
      'user-select': 'text',
      '-webkit-touch-callout': 'default',
    },
    p: {
      'font-size': '1em',
      'line-height': String(normalized.lineHeight),
    },
    h1: {
      color: text,
      'font-weight': '400',
      'letter-spacing': '-0.035em',
    },
    a: {
      color: link,
      'text-decoration-color': link,
      'text-underline-offset': '4px',
    },
    '::selection': {
      background: highlight,
      color: text,
    },
  };
}

export function shellTheme(preferences) {
  return normalizePreferences(preferences).theme;
}
