// 面板交互逻辑：语言/主题设置 → 粘贴 → 防抖转换 → 渲染结果卡片 → 复制。
// 语言集合与默认值对齐 GoNavi 宿主（shared/i18n/locales.ts：六语言，默认 zh-CN）；
// 主题三态（跟随系统/浅/深）的色值在 panel.html 中静态对齐 GoNavi v2 主题。
// 宿主没有给 html-panel 留任何桥接通道，语言初始值按系统语言归一探测。
// 构建脚本把本文件与 engine.js 一起内联进最终面板（见 ui/build-embed.mjs）。
(function () {
  'use strict';

  var LANGS = ['zh-CN', 'zh-TW', 'en-US', 'ja-JP', 'de-DE', 'ru-RU'];
  var DEFAULT_LANG = 'zh-CN'; // GoNavi shared/i18n/locales.ts DEFAULT_LANGUAGE

  var I18N = {
    'zh-CN': {
      title: 'MyBatis 日志转 SQL', statsWaiting: '等待粘贴日志', statsNoLog: '未识别到有效日志',
      statsCount: '共 {n} 条语句', copy: '复制 SQL', copied: '已复制 ✓',
      copyFailed: '复制失败，请手动选择', noRestore: '（无法还原：缺少 Preparing 行）',
      noLog: '未识别到 MyBatis 日志', paramChip: '参数 {p} / 占位符 {q}',
      langAuto: '自动', themeAuto: '跟随系统', themeLight: '浅色', themeDark: '深色',
      dialectGeneric: '通用', dialectMysql: 'MySQL',
      saveSettingsFailed: '设置保存失败',
      placeholder: '粘贴 MyBatis / MyBatis-Plus 的 DEBUG 日志\n支持整行日志或仅 Preparing: / Parameters: 部分，可一次粘贴多条语句\n\n例如：\n==>  Preparing: SELECT * FROM users WHERE id = ?\n==> Parameters: 1(Long)',
      hint: '识别到 Preparing: / Parameters: 即自动转换；输出中的参数已回填，可直接复制执行。'
    },
    'zh-TW': {
      title: 'MyBatis 日誌轉 SQL', statsWaiting: '等待貼上日誌', statsNoLog: '未識別到有效日誌',
      statsCount: '共 {n} 條語句', copy: '複製 SQL', copied: '已複製 ✓',
      copyFailed: '複製失敗，請手動選擇', noRestore: '（無法還原：缺少 Preparing 行）',
      noLog: '未識別到 MyBatis 日誌', paramChip: '參數 {p} / 佔位符 {q}',
      langAuto: '自動', themeAuto: '跟隨系統', themeLight: '淺色', themeDark: '深色',
      dialectGeneric: '通用', dialectMysql: 'MySQL',
      saveSettingsFailed: '設定儲存失敗',
      placeholder: '貼上 MyBatis / MyBatis-Plus 的 DEBUG 日誌\n支援整行日誌或僅 Preparing: / Parameters: 部分，可一次貼上多條語句\n\n例如：\n==>  Preparing: SELECT * FROM users WHERE id = ?\n==> Parameters: 1(Long)',
      hint: '識別到 Preparing: / Parameters: 即自動轉換；輸出中的參數已回填，可直接複製執行。'
    },
    'en-US': {
      title: 'MyBatis Log to SQL', statsWaiting: 'Waiting for log input', statsNoLog: 'No matching log lines',
      statsCount: '{n} statement(s)', copy: 'Copy SQL', copied: 'Copied ✓',
      copyFailed: 'Copy failed — select manually', noRestore: '(cannot restore: Preparing line missing)',
      noLog: 'No MyBatis log recognized', paramChip: 'params {p} / placeholders {q}',
      langAuto: 'Auto', themeAuto: 'System', themeLight: 'Light', themeDark: 'Dark',
      dialectGeneric: 'Generic', dialectMysql: 'MySQL',
      saveSettingsFailed: 'Failed to save settings',
      placeholder: 'Paste MyBatis / MyBatis-Plus DEBUG logs\nWhole lines or just the Preparing: / Parameters: parts; multiple statements are fine\n\nExample:\n==>  Preparing: SELECT * FROM users WHERE id = ?\n==> Parameters: 1(Long)',
      hint: 'Conversion runs automatically; parameters are filled in so the SQL is ready to execute.'
    },
    'ja-JP': {
      title: 'MyBatis ログを SQL へ変換', statsWaiting: 'ログの貼り付けを待っています', statsNoLog: '有効なログが見つかりません',
      statsCount: '{n} 件のステートメント', copy: 'SQL をコピー', copied: 'コピー済み ✓',
      copyFailed: 'コピー失敗。手動で選択してください', noRestore: '（復元不可: Preparing 行がありません）',
      noLog: 'MyBatis ログを認識できません', paramChip: 'パラメータ {p} / プレースホルダ {q}',
      langAuto: '自動', themeAuto: 'システムに従う', themeLight: 'ライト', themeDark: 'ダーク',
      dialectGeneric: '汎用', dialectMysql: 'MySQL',
      saveSettingsFailed: '設定の保存に失敗しました',
      placeholder: 'MyBatis / MyBatis-Plus の DEBUG ログを貼り付け\n行全体でも Preparing: / Parameters: 部分のみでも、複数文にも対応\n\n例:\n==>  Preparing: SELECT * FROM users WHERE id = ?\n==> Parameters: 1(Long)',
      hint: 'Preparing: / Parameters: を認識すると自動変換します。パラメータは埋め戻済みで、そのまま実行できます。'
    },
    'de-DE': {
      title: 'MyBatis-Log zu SQL', statsWaiting: 'Warte auf Log-Eingabe', statsNoLog: 'Keine passenden Logzeilen',
      statsCount: '{n} Anweisung(en)', copy: 'SQL kopieren', copied: 'Kopiert ✓',
      copyFailed: 'Kopieren fehlgeschlagen — bitte manuell auswählen', noRestore: '(nicht wiederherstellbar: Preparing-Zeile fehlt)',
      noLog: 'Kein MyBatis-Log erkannt', paramChip: 'Parameter {p} / Platzhalter {q}',
      langAuto: 'Automatisch', themeAuto: 'System', themeLight: 'Hell', themeDark: 'Dunkel',
      dialectGeneric: 'Generisch', dialectMysql: 'MySQL',
      saveSettingsFailed: 'Einstellungen konnten nicht gespeichert werden',
      placeholder: 'MyBatis-/MyBatis-Plus-DEBUG-Log einfügen\nGanze Zeilen oder nur die Teile nach Preparing: / Parameters:; mehrere Anweisungen sind möglich\n\nBeispiel:\n==>  Preparing: SELECT * FROM users WHERE id = ?\n==> Parameters: 1(Long)',
      hint: 'Die Konvertierung erfolgt automatisch; Parameter sind eingesetzt, das SQL ist direkt ausführbar.'
    },
    'ru-RU': {
      title: 'MyBatis: лог → SQL', statsWaiting: 'Ожидание вставки лога', statsNoLog: 'Подходящие строки лога не найдены',
      statsCount: 'Операторов: {n}', copy: 'Копировать SQL', copied: 'Скопировано ✓',
      copyFailed: 'Не удалось скопировать — выделите вручную', noRestore: '(восстановить нельзя: нет строки Preparing)',
      noLog: 'Лог MyBatis не распознан', paramChip: 'параметры {p} / плейсхолдеры {q}',
      langAuto: 'Авто', themeAuto: 'Как в системе', themeLight: 'Светлая', themeDark: 'Тёмная',
      dialectGeneric: 'Универсальный', dialectMysql: 'MySQL',
      saveSettingsFailed: 'Не удалось сохранить настройки',
      placeholder: 'Вставьте DEBUG-лог MyBatis / MyBatis-Plus\nЦелые строки или только части Preparing: / Parameters:; можно несколько операторов\n\nПример:\n==>  Preparing: SELECT * FROM users WHERE id = ?\n==> Parameters: 1(Long)',
      hint: 'Преобразование выполняется автоматически; параметры подставлены, SQL готов к выполнению.'
    }
  };

  // 语言名按各自语言的原生写法显示（通用惯例），仅「自动」跟随当前语言
  var NATIVE_NAMES = {
    'zh-CN': '简体中文', 'zh-TW': '繁體中文', 'en-US': 'English',
    'ja-JP': '日本語', 'de-DE': 'Deutsch', 'ru-RU': 'Русский'
  };

  var engine = window.log2sql;
  // 独立插件窗口由宿主注入 window.gonaviPlugin 桥接，可经 getSettings/saveSettings
  // 把偏好存进插件数据目录；嵌入式 html 面板没有桥接，只能使用默认值。
  var bridge = window.gonaviPlugin || null;
  // 独立窗口里宿主还会注入 window.gonaviHostPrefs = {locale, theme}，
  // 「自动」语言/主题据此跟随 GoNavi 主程序；面板场景没有它，回退系统语言与 prefers-color-scheme。
  var hostPrefs = window.gonaviHostPrefs || null;
  // 工作台标签页（插件页面）里宿主注入 window.gonavi 页面桥，app.info 提供宿主 locale，
  // 让「自动」语言在页面场景同样跟随 GoNavi。优先级：窗口 hostPrefs > 页面桥 > 系统语言。
  var pageBridge = window.gonavi && typeof window.gonavi.call === 'function' ? window.gonavi : null;
  var langPref = 'auto';
  var themePref = 'auto';
  var lang = resolveLanguagePref();
  var dialect = 'generic';
  // 初始化读取期间用户改过哪些字段：迟到的持久化值按字段合并，不覆盖用户的选择，
  // 也不能把尚未读回的其他字段用默认值一起写掉
  var settingsLoaded = false;
  var pendingSave = false;
  var dirty = { language: false, theme: false, dialect: false };
  var mediaDark = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  var els = {
    title: document.getElementById('panel-title'),
    stats: document.getElementById('stats'),
    input: document.getElementById('log-input'),
    hint: document.getElementById('hint'),
    results: document.getElementById('results'),
    langSelect: document.getElementById('lang-select'),
    dialectSelect: document.getElementById('dialect-select'),
    themeGroup: document.getElementById('theme-group')
  };
  var timer = null;

  function t(key, params) {
    var s = (I18N[lang] && I18N[lang][key]) || I18N[DEFAULT_LANG][key] || key;
    if (params) {
      Object.keys(params).forEach(function (k) {
        s = s.split('{' + k + '}').join(String(params[k]));
      });
    }
    return s;
  }

  // 语言候选归一到 GoNavi 支持的六语言（与宿主 resolveLanguage 同样遍历
  // 系统候选列表），全部未命中才回退宿主默认 zh-CN
  function resolveLanguage(candidates) {
    var list = candidates && candidates.length ? candidates : [''];
    for (var i = 0; i < list.length; i++) {
      var tag = String(list[i] || '').toLowerCase();
      if (tag.indexOf('zh') === 0) {
        return /tw|hk|mo|hant/.test(tag) ? 'zh-TW' : 'zh-CN';
      }
      if (tag.indexOf('en') === 0) return 'en-US';
      if (tag.indexOf('ja') === 0) return 'ja-JP';
      if (tag.indexOf('de') === 0) return 'de-DE';
      if (tag.indexOf('ru') === 0) return 'ru-RU';
    }
    return DEFAULT_LANG;
  }

  // 宿主下发的 locale 若在六语言内则采用，否则回退系统探测
  function hostLocale() {
    if (!hostPrefs || typeof hostPrefs.locale !== 'string') return null;
    return LANGS.indexOf(hostPrefs.locale) >= 0 ? hostPrefs.locale : null;
  }

  function resolveLanguagePref() {
    if (langPref !== 'auto') return langPref;
    var hosted = hostLocale();
    return hosted || resolveLanguage(navigator.languages || [navigator.language]);
  }

  // 「自动」主题：优先跟随 GoNavi 下发的主题，其次系统 prefers-color-scheme
  function actualTheme() {
    if (themePref !== 'auto') return themePref;
    if (hostPrefs && (hostPrefs.theme === 'light' || hostPrefs.theme === 'dark')) {
      return hostPrefs.theme;
    }
    return mediaDark && mediaDark.matches ? 'dark' : 'light';
  }

  function applyTheme() {
    document.documentElement.dataset.theme = actualTheme();
  }

  if (mediaDark && mediaDark.addEventListener) {
    mediaDark.addEventListener('change', function () {
      if (themePref === 'auto' && !(hostPrefs && hostPrefs.theme)) applyTheme();
    });
  }

  // ——— 语言与主题工具栏 ———

  function buildLangSelect() {
    els.langSelect.textContent = '';
    var auto = document.createElement('option');
    auto.value = 'auto';
    auto.textContent = t('langAuto');
    els.langSelect.appendChild(auto);
    LANGS.forEach(function (code) {
      var opt = document.createElement('option');
      opt.value = code;
      opt.textContent = NATIVE_NAMES[code];
      els.langSelect.appendChild(opt);
    });
    els.langSelect.value = langPref;
    els.langSelect.addEventListener('change', function () {
      langPref = els.langSelect.value;
      dirty.language = true;
      lang = resolveLanguagePref();
      applyStaticText();
      render();
      persistSettings();
    });
  }

  function buildDialectSelect() {
    [['generic', 'dialectGeneric'], ['mysql', 'dialectMysql']].forEach(function (pair) {
      var opt = document.createElement('option');
      opt.value = pair[0];
      opt.textContent = t(pair[1]);
      els.dialectSelect.appendChild(opt);
    });
    els.dialectSelect.value = dialect;
    els.dialectSelect.addEventListener('change', function () {
      dialect = els.dialectSelect.value;
      dirty.dialect = true;
      render();
      persistSettings();
    });
  }

  function buildThemeGroup() {
    [['auto', 'themeAuto'], ['light', 'themeLight'], ['dark', 'themeDark']].forEach(function (pair) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.theme = pair[0];
      btn.title = t(pair[1]);
      btn.addEventListener('click', function () {
        themePref = pair[0];
        dirty.theme = true;
        applyTheme();
        syncThemeButtons();
        persistSettings();
      });
      els.themeGroup.appendChild(btn);
    });
    syncThemeButtons();
  }

  function syncThemeButtons() {
    Array.prototype.forEach.call(els.themeGroup.children, function (btn) {
      var key = btn.dataset.theme === 'auto' ? 'themeAuto' : btn.dataset.theme === 'light' ? 'themeLight' : 'themeDark';
      btn.textContent = t(key);
      btn.title = t(key); // 语言切换后悬停提示也要跟着换
      btn.setAttribute('aria-pressed', btn.dataset.theme === themePref ? 'true' : 'false');
    });
  }

  function applyStaticText() {
    document.documentElement.lang = lang;
    els.title.textContent = t('title');
    els.input.placeholder = t('placeholder');
    els.hint.textContent = t('hint');
    var auto = els.langSelect.querySelector('option[value="auto"]');
    if (auto) auto.textContent = t('langAuto');
    Array.prototype.forEach.call(els.dialectSelect.options, function (opt, i) {
      opt.textContent = t(i === 0 ? 'dialectGeneric' : 'dialectMysql');
    });
    syncThemeButtons();
  }

  // ——— 转换与渲染 ———

  els.input.addEventListener('input', function () {
    clearTimeout(timer);
    timer = setTimeout(render, 200);
    autoGrow();
  });

  // 输入框跟随内容长高，上限与面板 CSS 的 max-height 一致（160px）；
  // 超出后自身滚动，把竖向空间留给结果区
  function autoGrow() {
    els.input.style.height = 'auto';
    els.input.style.height = Math.min(els.input.scrollHeight, 160) + 'px';
  }

  function render() {
    var text = els.input.value;
    var result = text.trim() ? engine.convert(text, dialect) : { statements: [], warnings: [] };
    els.results.textContent = '';

    if (result.statements.length === 0) {
      var p = document.createElement('p');
      p.className = 'global-warn';
      p.textContent = (result.warnings && result.warnings[0]) || t('noLog');
      els.results.appendChild(p);
      els.stats.textContent = text.trim() ? t('statsNoLog') : t('statsWaiting');
      return;
    }

    els.stats.textContent = t('statsCount', { n: result.statements.length });
    result.statements.forEach(function (st, i) {
      els.results.appendChild(buildCard(st, i));
    });
  }

  function buildCard(st, index) {
    var card = document.createElement('div');
    card.className = 'card';

    var head = document.createElement('div');
    head.className = 'card-head';

    var no = document.createElement('span');
    no.className = 'chip';
    no.textContent = '#' + (index + 1);
    head.appendChild(no);

    if (st.mapper) {
      var m = document.createElement('code');
      m.className = 'mapper';
      m.textContent = st.mapper;
      head.appendChild(m);
    }
    if (st.time) appendChip(head, st.time);
    if (st.traceId) appendChip(head, 'trace ' + st.traceId);
    if (st.total >= 0) appendChip(head, 'Total: ' + st.total);
    var match = document.createElement('span');
    match.className = 'chip' + (st.paramCount === st.placeholderCount ? ' ok' : '');
    match.textContent = t('paramChip', { p: st.paramCount, q: st.placeholderCount });
    head.appendChild(match);

    var grow = document.createElement('span');
    grow.className = 'grow';
    head.appendChild(grow);

    var btn = document.createElement('button');
    btn.className = 'copy-btn';
    btn.type = 'button';
    btn.textContent = t('copy');
    btn.addEventListener('click', function () { copyText(st.sql, btn); });
    head.appendChild(btn);

    card.appendChild(head);

    var pre = document.createElement('pre');
    pre.className = 'sql';
    pre.textContent = st.sql || t('noRestore');
    card.appendChild(pre);

    if (st.warnings && st.warnings.length > 0) {
      var ul = document.createElement('ul');
      ul.className = 'warnings';
      st.warnings.forEach(function (w) {
        var li = document.createElement('li');
        li.textContent = w;
        ul.appendChild(li);
      });
      card.appendChild(ul);
    }
    return card;
  }

  function appendChip(parent, text) {
    var c = document.createElement('span');
    c.className = 'chip';
    c.textContent = text;
    parent.appendChild(c);
  }

  // 沙箱 iframe（opaque origin）里 navigator.clipboard 多半被拒，
  // 降级到用户手势内的 execCommand；两级都失败则提示手动复制。
  function copyText(text, btn) {
    var done = function (ok) {
      btn.textContent = ok ? t('copied') : t('copyFailed');
      btn.disabled = true;
      setTimeout(function () { btn.textContent = t('copy'); btn.disabled = false; }, 1500);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { done(true); }, function () {
        done(legacyCopy(text));
      });
      return;
    }
    done(legacyCopy(text));
  }

  function legacyCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    return ok;
  }

  // ——— 设置持久化（仅独立窗口有桥接） ———

  // 保存当前偏好到插件数据目录（GONAVI_PLUGIN_DATA/settings.json）
  function persistSettings() {
    if (!bridge) return; // 嵌入式沙箱面板无桥接，设置不跨会话保留
    if (!settingsLoaded) {
      // 读取尚未返回：现在保存会把未加载的字段用默认值写掉，等 applySettings 后合并保存
      pendingSave = true;
      return;
    }
    bridge.invoke('saveSettings', {
      language: langPref,
      theme: themePref,
      dialect: dialect,
    }).catch(function () {
      flashStatus(t('saveSettingsFailed'));
    });
  }

  // 把读回的设置应用到当前 UI；非法字段保持现有默认
  function applySettings(settings) {
    if (!settings || typeof settings !== 'object') return;
    settingsLoaded = true;
    // 只回填用户没动过的字段；用户改过的字段以当前选择为准
    if (!dirty.language && typeof settings.language === 'string') {
      langPref = settings.language;
      lang = resolveLanguagePref();
      els.langSelect.value = langPref;
    }
    if (!dirty.theme && (settings.theme === 'light' || settings.theme === 'dark' || settings.theme === 'auto')) {
      themePref = settings.theme;
      applyTheme();
    }
    if (!dirty.dialect && (settings.dialect === 'mysql' || settings.dialect === 'generic')) {
      dialect = settings.dialect;
      els.dialectSelect.value = dialect;
    }
    applyStaticText();
    render();
    // 初始化期间用户改过东西：等读取完成后再合并保存，避免用默认值覆盖磁盘设置
    if (pendingSave) {
      pendingSave = false;
      persistSettings();
    }
  }

  // 状态栏短暂提示（保存失败等），2.5 秒后恢复为统计信息
  function flashStatus(text) {
    els.stats.textContent = text;
    setTimeout(function () { render(); }, 2500);
  }

  buildLangSelect();
  buildDialectSelect();
  buildThemeGroup();
  applyTheme();
  applyStaticText();
  autoGrow();
  render();
  // 独立窗口：异步读取持久化设置后再覆盖一次；面板版没有桥接，跳过
  if (bridge) {
    bridge.invoke('getSettings', {}).then(function (settings) {
      applySettings(settings);
    }, function () {
      // 读取失败：解除待保存状态（读取不可用，保存多半也会失败，但不应永久挂起）
      settingsLoaded = true;
      if (pendingSave) {
        pendingSave = false;
        persistSettings();
      }
    });
  }
  // 页面场景：工作台标签页没有窗口桥接，改用页面桥的 app.info 获取宿主语言
  if (!hostPrefs && pageBridge) {
    pageBridge.call('app.info', {}).then(function (info) {
      if (info && typeof info.locale === 'string' && LANGS.indexOf(info.locale) >= 0) {
        hostPrefs = { locale: info.locale };
        lang = resolveLanguagePref();
        applyStaticText();
        render();
      }
    }, function () {
      // 页面桥不可用时保持系统语言探测结果
    });
  }
})();
