import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const panelSource = readFileSync(new URL('./panel.html', import.meta.url), 'utf8');
const appSource = readFileSync(new URL('./app.js', import.meta.url), 'utf8');
const engineSource = readFileSync(new URL('./engine.js', import.meta.url), 'utf8')
  .replace(/export \{ engine as default \};/, '') + '\nwindow.log2sql = engine;';
const tick = async () => { await new Promise(resolve => setImmediate(resolve)); };
const json = value => JSON.parse(JSON.stringify(value));
const defaults = { language: 'auto', theme: 'auto', dialect: 'generic' };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

// A small CSSStyleDeclaration substitute: invalid colors leave the previous value intact.
class StyleDeclaration {
  constructor() { this.properties = new Map(); this.parsedColor = ''; }
  setProperty(name, value) { this.properties.set(name, String(value)); }
  getPropertyValue(name) { return this.properties.get(name) || ''; }
  removeProperty(name) { const old = this.getPropertyValue(name); this.properties.delete(name); return old; }
  set color(value) {
    if (value === '') this.parsedColor = '';
    else if (/^#[0-9a-f]{3}(?:[0-9a-f]{1}|[0-9a-f]{3}|[0-9a-f]{5})?$/i.test(value) ||
      ['rgb(226, 240, 255)', 'rgba(15, 23, 42, 0.12)', 'rgba(15, 23, 42, 0.6)', 'hsl(210, 100%, 94%)',
        'color(display-p3 0.8 0.9 1 / 0.5)', 'oklch(90% 0.04 240)'].includes(value)) this.parsedColor = value;
  }
  get color() { return this.parsedColor; }
  set fontFamily(value) {
    if (value === '') this.parsedFontFamily = '';
    else if (['"Segoe UI", sans-serif', '"JetBrains Mono", monospace', 'Arial, sans-serif', 'Consolas, monospace', 'Varela Round, sans-serif'].includes(value)) this.parsedFontFamily = value;
  }
  get fontFamily() { return this.parsedFontFamily || ''; }
}

class Element {
  constructor(tag = 'div') {
    this.tagName = tag; this.children = []; this.dataset = {}; this.style = new StyleDeclaration();
    this.attributes = {}; this.listeners = new Map(); this.value = ''; this.checked = false; this.scrollHeight = 40;
  }
  set textContent(value) { this.text = value; this.children = []; }
  get textContent() { return (this.text || '') + this.children.map(child => child.textContent).join(''); }
  get options() { return this.children; }
  appendChild(child) { this.children.push(child); return child; }
  removeChild(child) { this.children.splice(this.children.indexOf(child), 1); }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }
  dispatchEvent(event) { for (const listener of this.listeners.get(event.type) || []) listener(event); }
  querySelector(selector) {
    if (selector.startsWith('.')) {
      for (const child of this.children) {
        if ((child.className || '').split(' ').includes(selector.slice(1))) return child;
        const found = child.querySelector(selector); if (found) return found;
      }
      return null;
    }
    const value = selector.match(/value="([^"]+)"/)?.[1];
    return this.children.find(child => child.tagName === 'option' && child.value === value) || null;
  }
}

function ui({ page, native, prefs, languages = ['en-US'], dark = false } = {}) {
  const ids = new Map([...panelSource.matchAll(/<([a-z][a-z0-9]*)\b[^>]*\bid="([^"]+)"/g)]
    .map(([, tag, id]) => [id, new Element(tag)]));
  ids.get('mysql-escape-label').parentElement = new Element('label');
  const document = { documentElement: new Element('html'), body: new Element('body'),
    getElementById: id => ids.get(id), createElement: tag => new Element(tag) };
  const window = new Element('window');
  const media = new Element('media'); media.matches = dark;
  Object.assign(window, { gonavi: page, gonaviPlugin: native, gonaviHostPrefs: prefs, matchMedia: () => media });
  const timers = new Map(); let timerId = 0, now = 0;
  const context = vm.createContext({ window, document, navigator: { languages }, console,
    setTimeout: (fn, delay) => { timers.set(++timerId, { fn, delay, dueAt: now + delay }); return timerId; },
    clearTimeout: id => timers.delete(id) });
  vm.runInContext(engineSource, context, { filename: 'engine.js' });
  vm.runInContext(appSource, context, { filename: 'app.js' });
  return { window, document, media, timers, el: id => ids.get(id),
    toggle(checked) { const el = ids.get('mysql-escape'); el.checked = checked; el.dispatchEvent({ type: 'change' }); },
    input(value) { const el = ids.get('log-input'); el.value = value; el.dispatchEvent({ type: 'input' }); },
    runTimers(delay) { for (const [id, timer] of [...timers]) if (timer.delay === delay) { timers.delete(id); timer.fn(); } },
    advanceTime(ms) {
      const end = now + ms;
      for (;;) {
        const next = [...timers].filter(([, timer]) => timer.dueAt <= end).sort((a, b) => a[1].dueAt - b[1].dueAt)[0];
        if (!next) break;
        now = next[1].dueAt; timers.delete(next[0]); next[1].fn();
      }
      now = end;
    } };
}

test('toolbar exposes only a labeled native MySQL escape checkbox, off by default', () => {
  assert.doesNotMatch(panelSource, /<(?:select|[^>]+id="(?:lang-select|theme-group|dialect-select)")/, 'manual language, theme and dialect controls must be removed');
  const checkbox = panelSource.match(/<input\b[^>]*id="mysql-escape"[^>]*>/)?.[0];
  assert.ok(checkbox, 'MySQL escape checkbox must exist');
  assert.match(checkbox, /type="checkbox"/);
  assert.doesNotMatch(checkbox, /\bchecked\b/);
  assert.match(panelSource, /<label\b[^>]*for="mysql-escape"/);
  const app = ui();
  assert.equal(app.el('mysql-escape').checked, false);
});

test('MySQL checkbox off on off changes backslash fill and saves compatible settings', async () => {
  const calls = [];
  const app = ui({ page: { call(_method, args) {
    calls.push({ method: _method, args: json(args) });
    return Promise.resolve(args.command === 'getSettings' ? defaults : { saved: true });
  } } });
  await tick();
  app.input(String.raw`Preparing: SELECT ?
Parameters: C:\temp(String)`); app.runTimers(200);
  assert.equal(app.el('results').children[0].querySelector('.sql').textContent, String.raw`SELECT 'C:\temp'`);
  app.toggle(true); await tick();
  assert.equal(app.el('results').children[0].querySelector('.sql').textContent, String.raw`SELECT 'C:\\temp'`);
  assert.deepEqual(calls[1], { method: 'plugin.invoke', args: { command: 'saveSettings', arguments: { ...defaults, dialect: 'mysql' } } });
  app.toggle(false); await tick();
  assert.equal(app.el('results').children[0].querySelector('.sql').textContent, String.raw`SELECT 'C:\temp'`);
  assert.deepEqual(calls[2], { method: 'plugin.invoke', args: { command: 'saveSettings', arguments: defaults } });
  assert.equal(calls.length, 3);
});

test('all six host locales provide checkbox copy and keep SQL and dates unchanged', async () => {
  for (const [locale, label] of [
    ['zh-CN', 'MySQL 反斜杠转义'], ['zh-TW', 'MySQL 反斜線轉義'],
    ['en-US', 'MySQL backslash escaping'], ['ja-JP', 'MySQL バックスラッシュのエスケープ'],
    ['de-DE', 'MySQL-Backslash-Escaping'], ['ru-RU', 'Экранирование обратной косой черты MySQL']
  ]) {
    const app = ui({ prefs: { locale, theme: 'dark' } });
    assert.equal(app.document.documentElement.lang, locale);
    assert.equal(app.el('mysql-escape-label').textContent, label);
    assert.ok(app.el('mysql-escape-label').parentElement.title.includes('SQL'));
    app.input('Preparing: SELECT ?\nParameters: 2026-08-07(Date)'); app.runTimers(200);
    assert.equal(app.el('results').children[0].querySelector('.sql').textContent, "SELECT '2026-08-07'");
  }
});

test('page reads settings before changes and saves through the declared plugin.invoke arguments', async () => {
  const calls = [];
  const app = ui({ page: { call(method, args) {
    calls.push({ method, args: json(args) });
    return Promise.resolve(args.command === 'getSettings' ? defaults : { saved: true });
  } } });
  await tick();
  assert.deepEqual(calls, [{ method: 'plugin.invoke', args: { command: 'getSettings', arguments: {} } }]);
  app.toggle(true);
  await tick();
  assert.deepEqual(calls[1], { method: 'plugin.invoke', args: { command: 'saveSettings', arguments: { ...defaults, dialect: 'mysql' } } });
  assert.equal(app.el('stats').textContent, 'Waiting for log input');
});


test('legacy settings cannot override initial or live host language and theme', async () => {
  const read = deferred(); const calls = [];
  const app = ui({ page: { call(_method, args) { calls.push(args.command); return read.promise; } },
    prefs: { locale: 'ja-JP', theme: 'dark' } });
  assert.equal(app.document.documentElement.lang, 'ja-JP');
  assert.equal(app.document.documentElement.dataset.theme, 'dark');
  app.window.gonaviHostPrefs = { locale: 'de-DE', theme: 'light' };
  app.window.dispatchEvent({ type: 'gonavi:host-preferences' });
  read.resolve({ language: 'ru-RU', theme: 'dark', dialect: 'mysql' });
  await tick();
  assert.equal(app.document.documentElement.lang, 'de-DE', 'legacy language must not override the host');
  assert.equal(app.document.documentElement.dataset.theme, 'light', 'legacy theme must not override the host');
  assert.equal(app.el('mysql-escape').checked, true, 'saved mysql must turn the checkbox on');
  assert.deepEqual(calls, ['getSettings'], 'host preference events must not persist settings');
});

test('host preferences update live without writes or losing log input and result nodes', async () => {
  const calls = [];
  const app = ui({ page: { call: (_method, args) => { calls.push(args.command); return Promise.resolve(defaults); } }, prefs: { locale: 'ja-JP', theme: 'dark' } });
  await tick();
  assert.equal(app.document.documentElement.lang, 'ja-JP');
  assert.equal(app.document.documentElement.dataset.theme, 'dark');
  app.input('Preparing: SELECT ?\nParameters: 7(Integer)');
  app.runTimers(200);
  const result = app.el('results').children[0];
  assert.match(result.textContent, /SELECT 7/);
  app.window.gonaviHostPrefs = { locale: 'de-DE', theme: 'light' };
  app.window.dispatchEvent({ type: 'gonavi:host-preferences' });
  assert.equal(app.document.documentElement.dataset.theme, 'light');
  assert.equal(app.document.documentElement.lang, 'de-DE');
  assert.equal(app.el('log-input').value, 'Preparing: SELECT ?\nParameters: 7(Integer)');
  assert.equal(app.el('results').children[0], result);
  app.window.gonaviHostPrefs = { locale: 'en-US', theme: 'light' };
  app.window.dispatchEvent({ type: 'gonavi:host-preferences' });
  assert.equal(app.document.documentElement.lang, 'en-US');
  assert.equal(app.document.documentElement.dataset.theme, 'light');
  await tick();
  assert.deepEqual(calls, ['getSettings']);
});



test('page sources contain no raw NUL or disallowed control bytes', () => {
  for (const [name, source] of [['app.js', appSource], ['panel.html', panelSource], ['engine.js', engineSource]]) {
    assert.doesNotMatch(source, /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/, name + ' must embed without raw control characters');
  }
});

test('host palette colors override fallback variables on the first page render', () => {
  const palette = { bg: '#e2f0ff', panel: '#edf6ff', input: 'rgb(226, 240, 255)', code: '#d9ebff',
    text: '#102030', muted: '#567', border: 'rgba(15, 23, 42, 0.12)', border1: '#789a',
    accent: '#2478b8', accentSoft: 'hsl(210, 100%, 94%)', ok: '#246', warn: '#953',
    warnBg: 'color(display-p3 0.8 0.9 1 / 0.5)', chip: 'oklch(90% 0.04 240)', hover: '#aabbccdd' };
  const app = ui({ prefs: { locale: 'zh-CN', theme: 'light', palette } });
  const keys = { bg: '--bg', panel: '--panel', input: '--input', code: '--code', text: '--text',
    muted: '--muted', border: '--border', border1: '--border-1', accent: '--accent',
    accentSoft: '--accent-soft', ok: '--ok', warn: '--warn', warnBg: '--warn-bg', chip: '--chip', hover: '--hover' };
  for (const [key, variable] of Object.entries(keys)) {
    assert.equal(app.document.documentElement.style.getPropertyValue(variable), palette[key], key + ' must follow host palette on initial render');
  }
  assert.equal(app.document.documentElement.dataset.theme, 'light');
  assert.equal(app.el('mysql-escape').checked, false);
});

test('live palettes update within light mode, switch dark and clear missing overrides without changing UI state', async () => {
  const calls = [];
  const app = ui({ page: { call(_method, args) { calls.push(args.command); return Promise.resolve(args.command === 'getSettings' ? defaults : { saved: true }); } },
    prefs: { locale: 'en-US', theme: 'light', palette: { bg: '#e2f0ff', panel: '#edf6ff' } } });
  await tick(); app.toggle(true); await tick();
  app.input(String.raw`Preparing: SELECT ?
Parameters: C:\temp(String)`); app.runTimers(200);
  const input = app.el('log-input'), results = app.el('results'), card = results.children[0];
  const sql = card.querySelector('.sql'), checkbox = app.el('mysql-escape');
  const savedCalls = [...calls], children = [...results.children], value = input.value, sqlValue = sql.textContent;
  input.selectionStart = 4; input.selectionEnd = 18; input.scrollTop = 41; results.scrollTop = 87;
  const root = app.document.documentElement;
  root.style.setProperty('--unrelated', '#fed');
  for (const prefs of [
    { locale: 'en-US', theme: 'light', palette: { bg: '#cce4ff' } },
    { locale: 'en-US', theme: 'dark', palette: { bg: '#123456', panel: '#234567' } },
    { locale: 'en-US', theme: 'light' }
  ]) {
    app.window.gonaviHostPrefs = prefs;
    app.window.dispatchEvent({ type: 'gonavi:host-preferences' });
    assert.equal(root.dataset.theme, prefs.theme);
    assert.equal(root.style.getPropertyValue('--bg'), prefs.palette?.bg || '');
    assert.equal(root.style.getPropertyValue('--panel'), prefs.palette?.panel || '', 'missing keys must release earlier overrides');
    assert.equal(root.style.getPropertyValue('--unrelated'), '#fed');
    assert.equal(app.el('log-input'), input); assert.equal(app.el('mysql-escape'), checkbox);
    assert.deepEqual(results.children, children); assert.equal(card.querySelector('.sql'), sql);
    assert.equal(input.value, value); assert.equal(sql.textContent, sqlValue); assert.equal(checkbox.checked, true);
    assert.equal(input.selectionStart, 4); assert.equal(input.selectionEnd, 18);
    assert.equal(input.scrollTop, 41); assert.equal(results.scrollTop, 87);
  }
  await tick(); assert.deepEqual(calls, savedCalls, 'host palette events must not save settings');
});

test('unsafe, unparsed, unknown and inherited palette values never enter CSS and release stale overrides', () => {
  const app = ui({ prefs: { locale: 'en-US', theme: 'light', palette: { bg: '#e2f0ff', panel: '#edf6ff' } } });
  const style = app.document.documentElement.style;
  for (const value of [null, 123, {}, [], '', '#12', 'rgb(nope)', 'rgba(15, 23, 42, bogus)',
    'color(not-a-space 1 1 1)', 'color(display-p3 nope)', 'red', 'transparent', 'currentColor', 'inherit',
    'var(--host)', 'env(background)', 'url(https://example.invalid/x)', 'expression(alert(1))',
    '#fff; background: url(x)', '<style>body{color:red}</style>', 'rgb(0, 0, 0)/*x*/',
    String.raw`#\66ff`, 'rgb(0, 0, 0)\n', 'rgb(0, 0, 0)' + String.fromCharCode(0),
    'rgb(0, 0, 0)' + String.fromCharCode(31), '#fff' + ' '.repeat(129)]) {
    app.window.gonaviHostPrefs = { locale: 'en-US', theme: 'light', palette: { bg: value, panel: '#abc',
      '--bg': '#000', background: 'url(https://example.invalid/x)', __proto__: { input: '#fff' } } };
    app.window.dispatchEvent({ type: 'gonavi:host-preferences' });
    assert.equal(style.getPropertyValue('--bg'), '', 'must clear unsafe color ' + String(value));
    assert.equal(style.getPropertyValue('--panel'), '#abc');
    assert.equal(style.getPropertyValue('--input'), '', 'inherited keys must be ignored');
    assert.deepEqual([...style.properties.keys()], ['--panel'], 'only fixed own palette keys may be assigned');
  }
  for (const palette of [undefined, null, [], 'not a palette', 42, {}, { bg: '#12' }]) {
    app.window.gonaviHostPrefs = { locale: 'en-US', theme: 'dark', palette };
    app.window.dispatchEvent({ type: 'gonavi:host-preferences' });
    assert.equal(style.properties.size, 0, 'invalid or missing palette must release every override');
    assert.equal(app.document.documentElement.dataset.theme, 'dark');
  }
});

test('palette-only updates preserve empty results and pending error feedback without rebuilding DOM', async () => {
  const app = ui({ page: { call: () => Promise.reject(new Error('denied')) },
    prefs: { locale: 'en-US', theme: 'light' } });
  await tick();
  const warning = app.el('results').children[0];
  const message = app.el('stats').textContent;
  app.window.gonaviHostPrefs = { locale: 'en-US', theme: 'light', palette: { bg: '#e2f0ff' } };
  app.window.dispatchEvent({ type: 'gonavi:host-preferences' });
  assert.equal(app.el('results').children[0], warning, 'theme-only changes must preserve empty result nodes');
  assert.equal(app.el('stats').textContent, message, 'theme-only changes must not discard pending error feedback');
});

test('host appearance applies initial and live fonts, sizes and radius then releases missing fields', () => {
  const appearance = { fontFamily: '"Segoe UI", sans-serif', monoFontFamily: '"JetBrains Mono", monospace',
    fontSize: 18, monoFontSize: 16, radius: 12 };
  const app = ui({ prefs: { locale: 'en-US', theme: 'light', appearance } });
  const style = app.document.documentElement.style;
  const variables = { fontFamily: '--host-font-family', monoFontFamily: '--host-mono-font-family',
    fontSize: '--host-font-size', monoFontSize: '--host-mono-font-size', radius: '--host-radius' };
  function assertAppearance(value) {
    for (const [key, variable] of Object.entries(variables)) {
      assert.equal(style.getPropertyValue(variable), value[key] === undefined ? '' : String(value[key]) + (typeof value[key] === 'number' ? 'px' : ''), key + ' must follow host appearance');
    }
  }
  assertAppearance(appearance);
  const live = { fontFamily: 'Varela Round, sans-serif', monoFontFamily: 'Consolas, monospace', fontSize: 20, monoFontSize: 14, radius: 0 };
  app.window.gonaviHostPrefs = { locale: 'en-US', theme: 'light', appearance: live };
  app.window.dispatchEvent({ type: 'gonavi:host-preferences' }); assertAppearance(live);
  app.window.gonaviHostPrefs = { locale: 'en-US', theme: 'dark', appearance: { fontSize: 12 } };
  app.window.dispatchEvent({ type: 'gonavi:host-preferences' }); assertAppearance({ fontSize: 12 });
  app.window.gonaviHostPrefs = { locale: 'en-US', theme: 'light' };
  app.window.dispatchEvent({ type: 'gonavi:host-preferences' }); assertAppearance({});
});

test('surface opacity only affects fallback colors and background tint never fades text', () => {
  const app = ui({ prefs: { locale: 'en-US', theme: 'light', appearance: { opacity: 0.6 } } });
  const root = app.document.documentElement, style = root.style;
  assert.equal(style.getPropertyValue('--host-surface-opacity'), '0.6', 'initial fallback opacity must be applied');
  assert.match(style.getPropertyValue('--host-panel-surface'), /color-mix.*--host-surface-opacity/, 'missing palette panels need surface-only opacity');
  app.window.gonaviHostPrefs = { locale: 'en-US', theme: 'dark', palette: { panel: 'rgba(15, 23, 42, 0.6)', input: '#ffffff' }, appearance: { opacity: 0.6 } };
  app.window.dispatchEvent({ type: 'gonavi:host-preferences' });
  assert.equal(style.getPropertyValue('--host-panel-surface'), '', 'computed palette alpha must not be multiplied by window opacity');
  assert.equal(style.getPropertyValue('--host-input-surface'), '', 'opaque custom palette must stay opaque');
  assert.equal(style.getPropertyValue('--panel'), 'rgba(15, 23, 42, 0.6)');
  app.window.gonaviHostPrefs = { locale: 'en-US', theme: 'light', appearance: { opacity: 0.6, background: { enabled: true, tint: 0.8 } } };
  app.window.dispatchEvent({ type: 'gonavi:host-preferences' });
  assert.equal(root.dataset.hostBackground, 'true', 'background must expose the already painted host workspace');
  assert.equal(style.getPropertyValue('--host-background-tint'), '0.8');
  assert.match(style.getPropertyValue('--host-panel-surface'), /--host-background-tint/);
  assert.doesNotMatch(style.getPropertyValue('--host-panel-surface'), /--host-surface-opacity/, 'background tint must not multiply global opacity twice');
  assert.equal(app.document.body.style.opacity, undefined); assert.equal(root.style.opacity, undefined);
  app.window.gonaviHostPrefs = { locale: 'en-US', theme: 'dark' };
  app.window.dispatchEvent({ type: 'gonavi:host-preferences' });
  for (const variable of ['--host-surface-opacity', '--host-background-tint', '--host-bg-surface', '--host-panel-surface', '--host-input-surface', '--host-code-surface']) assert.equal(style.getPropertyValue(variable), '');
  assert.equal(root.dataset.hostBackground, undefined);
});

test('invalid appearance releases owned overrides and cannot inject CSS resources or inherited keys', () => {
  const valid = { fontFamily: 'Arial, sans-serif', monoFontFamily: 'Consolas, monospace', fontSize: 18, monoFontSize: 14, radius: 12, opacity: 0.6, background: { enabled: true, tint: 0.8 } };
  const app = ui({ prefs: { locale: 'en-US', theme: 'light', appearance: valid } });
  const style = app.document.documentElement.style;
  const variables = { fontFamily: '--host-font-family', monoFontFamily: '--host-mono-font-family', fontSize: '--host-font-size', monoFontSize: '--host-mono-font-size', radius: '--host-radius', opacity: '--host-surface-opacity' };
  const invalidFonts = ['', 'Arial; color:red', '@font-face', 'url(https://example.invalid/font)', 'var(--font)', 'env(font)', 'expression(x)', '<style>x</style>', 'Arial' + String.fromCharCode(0), String.raw`Ar\ial`, 'x'.repeat(513), 'inherit', 'Arial,, sans-serif'];
  for (const [key, variable] of Object.entries(variables)) {
    const invalid = key.includes('Family') ? invalidFonts : [NaN, Infinity, -Infinity, null, '12', {}, key === 'opacity' ? 0.09 : -1, key === 'radius' ? 33 : key === 'opacity' ? 1.01 : 49];
    for (const value of invalid) {
      app.window.gonaviHostPrefs = { locale: 'en-US', theme: 'light', appearance: { ...valid, [key]: value } };
      app.window.dispatchEvent({ type: 'gonavi:host-preferences' });
      assert.equal(style.getPropertyValue(variable), '', key + ' must reject ' + String(value));
    }
  }
  for (const background of [{ enabled: 'true', tint: 0.8 }, { enabled: true, tint: Infinity }, { enabled: true, tint: 0.69 }, { enabled: true, tint: 0.96 }, []]) {
    app.window.gonaviHostPrefs = { locale: 'en-US', theme: 'light', appearance: { background } };
    app.window.dispatchEvent({ type: 'gonavi:host-preferences' });
    assert.equal(style.getPropertyValue('--host-background-tint'), '');
    assert.equal(app.document.documentElement.dataset.hostBackground, background.enabled === true ? 'true' : undefined);
  }
  for (const appearance of [undefined, null, [], 'bad', 0, Object.create(valid)]) {
    app.window.gonaviHostPrefs = { locale: 'en-US', theme: 'light', appearance };
    app.window.dispatchEvent({ type: 'gonavi:host-preferences' });
    assert.equal(style.properties.size, 0, 'invalid, missing or inherited appearance must not leave overrides');
    assert.equal(app.document.documentElement.dataset.hostBackground, undefined);
  }
});

test('live appearance and background switches preserve rendered SQL, selection, scroll, checkbox and errors without writes', async () => {
  const calls = [];
  const app = ui({ page: { call(_method, args) { calls.push(args.command); return args.command === 'getSettings' ? Promise.resolve(defaults) : Promise.reject(new Error('denied')); } }, prefs: { locale: 'en-US', theme: 'light' } });
  await tick(); app.toggle(true); await tick();
  app.input(String.raw`Preparing: SELECT ?
Parameters: C:\temp(String)`); app.runTimers(200);
  app.toggle(false); await tick();
  const input = app.el('log-input'), results = app.el('results'), card = results.children[0], sql = card.querySelector('.sql'), checkbox = app.el('mysql-escape');
  const callsBefore = [...calls], value = input.value, sqlValue = sql.textContent, error = app.el('stats').textContent;
  input.selectionStart = 1; input.selectionEnd = 20; input.scrollTop = 30; results.scrollTop = 80;
  for (const [theme, appearance] of [['light', { fontFamily: 'Arial, sans-serif', monoFontSize: 16, radius: 10, opacity: 0.6, background: { enabled: true, tint: 0.7 } }], ['dark', { background: { enabled: true, tint: 0.95 } }], ['light', { background: { enabled: false } }], ['dark', undefined]]) {
    app.window.gonaviHostPrefs = { locale: 'en-US', theme, appearance };
    app.window.dispatchEvent({ type: 'gonavi:host-preferences' });
    assert.equal(results.children[0], card); assert.equal(card.querySelector('.sql'), sql); assert.equal(app.el('log-input'), input); assert.equal(app.el('mysql-escape'), checkbox);
    assert.equal(input.value, value); assert.equal(sql.textContent, sqlValue); assert.equal(checkbox.checked, false);
    assert.equal(input.selectionStart, 1); assert.equal(input.selectionEnd, 20); assert.equal(input.scrollTop, 30); assert.equal(results.scrollTop, 80);
    assert.equal(app.el('stats').textContent, error);
  }
  await tick(); assert.deepEqual(calls, callsBefore, 'appearance and background must not write settings');
});

test('page refuses an unconfirmed settings save instead of showing normal status', async () => {
  for (const response of [{ saved: false }, { saved: 'true' }, { saved: 1 }, {}, null]) {
    const app = ui({ page: { call: (_method, args) => Promise.resolve(args.command === 'getSettings' ? defaults : response) } });
    await tick(); app.toggle(true); await tick();
    assert.equal(app.el('stats').textContent, 'Failed to save settings');
    assert.equal(app.el('mysql-escape').checked, true, 'save failure must not reset the user toggle');
  }
});

test('save failure stays visible in the new host locale until its original deadline', async () => {
  const calls = [];
  const app = ui({ page: { call(_method, args) {
    calls.push(args.command);
    return args.command === 'getSettings' ? Promise.resolve(defaults) : Promise.reject(new Error('synthetic save failure'));
  } }, prefs: { locale: 'en-US', theme: 'light' } });
  await tick(); app.toggle(true); await tick();
  assert.equal(app.el('stats').textContent, 'Failed to save settings');
  app.advanceTime(1000);
  const timers = [...app.timers];
  assert.equal(timers.length, 1);
  assert.equal(timers[0][1].delay, 2500);
  app.window.gonaviHostPrefs = { locale: 'de-DE', theme: 'light' };
  app.window.dispatchEvent({ type: 'gonavi:host-preferences' });
  assert.equal(app.el('stats').textContent, 'Einstellungen konnten nicht gespeichert werden');
  assert.deepEqual([...app.timers], timers, 'locale changes must not restart the error deadline');
  assert.equal(app.el('mysql-escape').checked, true);
  await tick(); assert.deepEqual(calls, ['getSettings', 'saveSettings'], 'locale changes must not retry the write');
  app.advanceTime(1499);
  assert.equal(app.el('stats').textContent, 'Einstellungen konnten nicht gespeichert werden');
  app.advanceTime(1);
  assert.equal(app.el('stats').textContent, 'Warte auf Log-Eingabe');
  assert.equal(app.timers.size, 0);
});

test('load failure survives conversion and locale changes then restores latest stats without replacing nodes', async () => {
  const calls = [];
  const app = ui({ page: { call(_method, args) {
    calls.push(args.command); return Promise.reject(new Error('synthetic read failure'));
  } }, prefs: { locale: 'en-US', theme: 'light' } });
  await tick();
  assert.equal(app.el('stats').textContent, 'Failed to load settings');
  const errorTimer = [...app.timers][0];
  app.input('Preparing: SELECT ?\nParameters: 7(Integer)'); app.advanceTime(200);
  assert.match(app.el('results').textContent, /SELECT 7/);
  assert.equal(app.el('stats').textContent, 'Failed to load settings', 'conversion render must retain the active failure');
  const input = app.el('log-input'), results = app.el('results'), card = results.children[0];
  const sql = card.querySelector('.sql'), checkbox = app.el('mysql-escape');
  const inputValue = input.value, sqlValue = sql.textContent;
  input.selectionStart = 4; input.selectionEnd = 18; input.scrollTop = 41; results.scrollTop = 87;
  for (const prefs of [{ locale: 'de-DE', theme: 'light' }, { locale: 'de-DE', theme: 'dark', palette: { bg: '#123456' } }]) {
    app.window.gonaviHostPrefs = prefs;
    app.window.dispatchEvent({ type: 'gonavi:host-preferences' });
    assert.equal(app.el('stats').textContent, 'Einstellungen konnten nicht geladen werden');
    assert.deepEqual([...app.timers], [errorTimer], 'host preferences must preserve the original error deadline');
    assert.equal(results.children[0], card); assert.equal(card.querySelector('.sql'), sql);
  }
  app.advanceTime(2299);
  assert.equal(app.el('stats').textContent, 'Einstellungen konnten nicht geladen werden');
  app.advanceTime(1);
  assert.equal(app.el('stats').textContent, '1 Anweisung(en)', 'expiration must restore latest stats in the latest locale');
  assert.equal(app.el('log-input'), input); assert.equal(app.el('results'), results); assert.equal(app.el('mysql-escape'), checkbox);
  assert.equal(results.children[0], card); assert.equal(card.querySelector('.sql'), sql);
  assert.equal(input.value, inputValue); assert.equal(sql.textContent, sqlValue); assert.equal(checkbox.checked, false);
  assert.equal(input.selectionStart, 4); assert.equal(input.selectionEnd, 18);
  assert.equal(input.scrollTop, 41); assert.equal(results.scrollTop, 87);
  assert.equal(app.timers.size, 0);
  await tick(); assert.deepEqual(calls, ['getSettings']);
});

test('a later settings failure gets a fresh deadline without an earlier timer clearing it', async () => {
  for (const readFails of [true, false]) {
    const calls = [];
    const app = ui({ page: { call(_method, args) {
      calls.push(args.command);
      return args.command === 'getSettings' && !readFails ? Promise.resolve(defaults) : Promise.reject(new Error('synthetic settings failure'));
    } }, prefs: { locale: 'en-US', theme: 'light' } });
    await tick();
    if (!readFails) { app.toggle(true); await tick(); }
    const firstMessage = readFails ? 'Failed to load settings' : 'Failed to save settings';
    assert.equal(app.el('stats').textContent, firstMessage);
    app.advanceTime(1000); app.toggle(!readFails ? false : true);
    assert.equal(app.el('stats').textContent, firstMessage, 'toggle render must retain the active failure');
    await tick();
    assert.equal(app.el('stats').textContent, 'Failed to save settings');
    app.advanceTime(1500);
    assert.equal(app.el('stats').textContent, 'Failed to save settings', 'the earlier failure deadline must not clear the later write failure');
    assert.equal(app.timers.size, 1, 'only the current error deadline may remain');
    app.advanceTime(999);
    assert.equal(app.el('stats').textContent, 'Failed to save settings');
    app.advanceTime(1);
    assert.equal(app.el('stats').textContent, 'Waiting for log input');
    assert.equal(app.timers.size, 0, 'error completion must leave no pending timers');
    await tick(); assert.deepEqual(calls, readFails ? ['getSettings', 'saveSettings'] : ['getSettings', 'saveSettings', 'saveSettings']);
  }
});

test('unknown or denied page capability reports localized read and write failures', async () => {
  for (const failure of [() => Promise.reject(new Error('unknown capability')), () => { throw new Error('denied'); }]) {
    const app = ui({ page: { call: failure }, prefs: { locale: 'zh-CN', theme: 'light' } });
    await tick();
    assert.equal(app.el('stats').textContent, '设置读取失败');
    app.toggle(true);
    await tick();
    assert.equal(app.el('stats').textContent, '设置保存失败');
  }
});


test('stalled page calls time out, release initialization and never retry a write', async () => {
  const read = deferred(); const write = deferred(); const calls = [];
  const app = ui({ page: { call(_method, args) { calls.push(args.command); return args.command === 'getSettings' ? read.promise : write.promise; } } });
  await tick();
  const timeout = [...app.timers.values()].find(timer => timer.delay >= 5000 && timer.delay <= 30000);
  assert.ok(timeout, 'settings calls must have a bounded timeout');
  assert.equal(timeout.delay, 10000, 'page calls must use the 10s deadline');
  app.runTimers(timeout.delay);
  await tick();
  assert.equal(app.el('stats').textContent, 'Failed to load settings');
  app.toggle(true);
  await tick();
  app.runTimers(timeout.delay);
  await tick();
  assert.equal(app.el('stats').textContent, 'Failed to save settings');
  assert.deepEqual(calls, ['getSettings', 'saveSettings']);
  read.resolve({ language: 'ru-RU', theme: 'dark', dialect: 'generic' }); write.resolve({ saved: true });
  await tick();
  assert.equal(app.el('mysql-escape').checked, true);
  assert.equal(app.document.documentElement.lang, 'en-US');
  assert.equal(app.document.documentElement.dataset.theme, 'light');
  assert.deepEqual(calls, ['getSettings', 'saveSettings']);
});


test('page keeps the last toggle through delayed settings and saves once', async () => {
  const read = deferred(); const calls = [];
  const app = ui({ page: { call(_method, args) {
    calls.push({ command: args.command, args: json(args.arguments) });
    return args.command === 'getSettings' ? read.promise : Promise.resolve({ saved: true });
  } }, prefs: { locale: 'en-US', theme: 'light' } });
  await tick();
  app.input('Preparing: SELECT ?\nParameters: 7(Integer)'); app.runTimers(200);
  app.toggle(true); app.toggle(false);
  app.window.gonaviHostPrefs = { locale: 'de-DE', theme: 'dark' };
  app.window.dispatchEvent({ type: 'gonavi:host-preferences' });
  await tick();
  assert.equal(calls.length, 1, 'write must wait for getSettings');
  read.resolve({ language: 'ru-RU', theme: 'light', dialect: 'mysql' });
  await tick();
  assert.equal(app.el('mysql-escape').checked, false, 'late read must not overwrite the last user toggle');
  assert.equal(app.document.documentElement.lang, 'de-DE');
  assert.equal(app.document.documentElement.dataset.theme, 'dark');
  assert.equal(app.el('log-input').value, 'Preparing: SELECT ?\nParameters: 7(Integer)');
  assert.match(app.el('results').textContent, /SELECT 7/);
  assert.deepEqual(calls[1], { command: 'saveSettings', args: defaults });
  assert.equal(calls.length, 2);
});

test('page uses declared plugin.invoke even if a retired native bridge is present', async () => {
  const calls = [];
  const app = ui({ native: { invoke() { assert.fail('retired native bridge must not be called'); } },
    page: { call(method, args) { calls.push({ method, args: json(args) }); return Promise.resolve(args.command === 'getSettings' ? defaults : { saved: true }); } },
    prefs: { locale: 'ru-RU', theme: 'dark' } });
  await tick();
  app.toggle(true); await tick();
  assert.deepEqual(calls, [
    { method: 'plugin.invoke', args: { command: 'getSettings', arguments: {} } },
    { method: 'plugin.invoke', args: { command: 'saveSettings', arguments: { ...defaults, dialect: 'mysql' } } }
  ]);
  assert.equal(app.document.documentElement.lang, 'ru-RU');
  assert.equal(app.document.documentElement.dataset.theme, 'dark');
});

test('retired native bridge alone is an unbridged system-following preview', async () => {
  let nativeCalls = 0;
  const app = ui({ native: { invoke() { nativeCalls++; return Promise.resolve(defaults); } }, languages: ['ja'], dark: true });
  await tick(); app.toggle(true); await tick();
  assert.equal(nativeCalls, 0, 'native window capability must not be retained');
  assert.equal(app.document.documentElement.lang, 'ja-JP');
  assert.equal(app.document.documentElement.dataset.theme, 'dark');
});

test('unbridged preview converts locally and follows the system without persistent calls', () => {
  const app = ui({ languages: ['de-AT'], dark: false });
  assert.equal(app.document.documentElement.lang, 'de-DE');
  app.media.matches = true; app.media.dispatchEvent({ type: 'change' });
  assert.equal(app.document.documentElement.dataset.theme, 'dark');
  app.toggle(true);
  app.input('Preparing: SELECT ?\nParameters: preview(String)'); app.runTimers(200);
  assert.match(app.el('results').textContent, /SELECT 'preview'/);
  assert.equal(app.el('stats').textContent, '1 Anweisung(en)');
  assert.equal(app.timers.size, 0);
});


test('invalid settings response reports failure and cannot leave changes pending', async () => {
  for (const settings of [null, {}, { language: 'invalid', theme: 'auto', dialect: 'generic' },
    { ...defaults, theme: 'invalid' }, { ...defaults, dialect: 'oracle' }]) {
    const read = deferred(); const writes = [];
    const app = ui({ page: { call: (_method, args) => {
      if (args.command === 'getSettings') return read.promise;
      writes.push(json(args.arguments)); return Promise.resolve({ saved: true });
    } } });
    await tick(); app.toggle(true); read.resolve(settings); await tick();
    assert.equal(app.el('stats').textContent, 'Failed to load settings');
    assert.deepEqual(writes, [{ ...defaults, dialect: 'mysql' }]);
  }
});




