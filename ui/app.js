// 标签页交互：跟随宿主语言/主题 → 粘贴 → 防抖转换 → 渲染结果卡片 → 复制。
// 语言集合与默认值对齐 GoNavi 宿主（shared/i18n/locales.ts：六语言，默认 zh-CN）；
// 宿主 palette 覆盖固定颜色变量，panel.html 的浅/深色值保留为缺失颜色的回退。
// 优先宿主非敏感偏好，预览回退系统语言与主题。
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
      mysqlEscape: 'MySQL 反斜杠转义',
      mysqlEscapeHint: '默认使用标准 SQL 转义；开启后按 MySQL 规则转义反斜杠。',
      saveSettingsFailed: '设置保存失败',
      loadSettingsFailed: '设置读取失败',
      placeholder: '粘贴 MyBatis / MyBatis-Plus 的 DEBUG 日志\n支持整行日志或仅 Preparing: / Parameters: 部分，可一次粘贴多条语句\n\n例如：\n==>  Preparing: SELECT * FROM users WHERE id = ?\n==> Parameters: 1(Long)',
      hint: '识别到 Preparing: / Parameters: 即自动转换；输出中的参数已回填，可直接复制执行。'
    },
    'zh-TW': {
      title: 'MyBatis 日誌轉 SQL', statsWaiting: '等待貼上日誌', statsNoLog: '未識別到有效日誌',
      statsCount: '共 {n} 條語句', copy: '複製 SQL', copied: '已複製 ✓',
      copyFailed: '複製失敗，請手動選擇', noRestore: '（無法還原：缺少 Preparing 行）',
      noLog: '未識別到 MyBatis 日誌', paramChip: '參數 {p} / 佔位符 {q}',
      mysqlEscape: 'MySQL 反斜線轉義',
      mysqlEscapeHint: '預設使用標準 SQL 轉義；開啟後依 MySQL 規則轉義反斜線。',
      saveSettingsFailed: '設定儲存失敗',
      loadSettingsFailed: '設定讀取失敗',
      placeholder: '貼上 MyBatis / MyBatis-Plus 的 DEBUG 日誌\n支援整行日誌或僅 Preparing: / Parameters: 部分，可一次貼上多條語句\n\n例如：\n==>  Preparing: SELECT * FROM users WHERE id = ?\n==> Parameters: 1(Long)',
      hint: '識別到 Preparing: / Parameters: 即自動轉換；輸出中的參數已回填，可直接複製執行。'
    },
    'en-US': {
      title: 'MyBatis Log to SQL', statsWaiting: 'Waiting for log input', statsNoLog: 'No matching log lines',
      statsCount: '{n} statement(s)', copy: 'Copy SQL', copied: 'Copied ✓',
      copyFailed: 'Copy failed — select manually', noRestore: '(cannot restore: Preparing line missing)',
      noLog: 'No MyBatis log recognized', paramChip: 'params {p} / placeholders {q}',
      mysqlEscape: 'MySQL backslash escaping',
      mysqlEscapeHint: 'Standard SQL escaping by default; enable MySQL backslash escaping.',
      saveSettingsFailed: 'Failed to save settings',
      loadSettingsFailed: 'Failed to load settings',
      placeholder: 'Paste MyBatis / MyBatis-Plus DEBUG logs\nWhole lines or just the Preparing: / Parameters: parts; multiple statements are fine\n\nExample:\n==>  Preparing: SELECT * FROM users WHERE id = ?\n==> Parameters: 1(Long)',
      hint: 'Conversion runs automatically; parameters are filled in so the SQL is ready to execute.'
    },
    'ja-JP': {
      title: 'MyBatis ログを SQL へ変換', statsWaiting: 'ログの貼り付けを待っています', statsNoLog: '有効なログが見つかりません',
      statsCount: '{n} 件のステートメント', copy: 'SQL をコピー', copied: 'コピー済み ✓',
      copyFailed: 'コピー失敗。手動で選択してください', noRestore: '（復元不可: Preparing 行がありません）',
      noLog: 'MyBatis ログを認識できません', paramChip: 'パラメータ {p} / プレースホルダ {q}',
      mysqlEscape: 'MySQL バックスラッシュのエスケープ',
      mysqlEscapeHint: '標準 SQL のエスケープが既定です。有効にすると MySQL の規則でバックスラッシュをエスケープします。',
      saveSettingsFailed: '設定の保存に失敗しました',
      loadSettingsFailed: '設定の読み込みに失敗しました',
      placeholder: 'MyBatis / MyBatis-Plus の DEBUG ログを貼り付け\n行全体でも Preparing: / Parameters: 部分のみでも、複数文にも対応\n\n例:\n==>  Preparing: SELECT * FROM users WHERE id = ?\n==> Parameters: 1(Long)',
      hint: 'Preparing: / Parameters: を認識すると自動変換します。パラメータは埋め戻済みで、そのまま実行できます。'
    },
    'de-DE': {
      title: 'MyBatis-Log zu SQL', statsWaiting: 'Warte auf Log-Eingabe', statsNoLog: 'Keine passenden Logzeilen',
      statsCount: '{n} Anweisung(en)', copy: 'SQL kopieren', copied: 'Kopiert ✓',
      copyFailed: 'Kopieren fehlgeschlagen — bitte manuell auswählen', noRestore: '(nicht wiederherstellbar: Preparing-Zeile fehlt)',
      noLog: 'Kein MyBatis-Log erkannt', paramChip: 'Parameter {p} / Platzhalter {q}',
      mysqlEscape: 'MySQL-Backslash-Escaping',
      mysqlEscapeHint: 'Standardmäßig SQL-Escaping; aktivieren für MySQL-Backslash-Escaping.',
      saveSettingsFailed: 'Einstellungen konnten nicht gespeichert werden',
      loadSettingsFailed: 'Einstellungen konnten nicht geladen werden',
      placeholder: 'MyBatis-/MyBatis-Plus-DEBUG-Log einfügen\nGanze Zeilen oder nur die Teile nach Preparing: / Parameters:; mehrere Anweisungen sind möglich\n\nBeispiel:\n==>  Preparing: SELECT * FROM users WHERE id = ?\n==> Parameters: 1(Long)',
      hint: 'Die Konvertierung erfolgt automatisch; Parameter sind eingesetzt, das SQL ist direkt ausführbar.'
    },
    'ru-RU': {
      title: 'MyBatis: лог → SQL', statsWaiting: 'Ожидание вставки лога', statsNoLog: 'Подходящие строки лога не найдены',
      statsCount: 'Операторов: {n}', copy: 'Копировать SQL', copied: 'Скопировано ✓',
      copyFailed: 'Не удалось скопировать — выделите вручную', noRestore: '(восстановить нельзя: нет строки Preparing)',
      noLog: 'Лог MyBatis не распознан', paramChip: 'параметры {p} / плейсхолдеры {q}',
      mysqlEscape: 'Экранирование обратной косой черты MySQL',
      mysqlEscapeHint: 'По умолчанию используется стандартное SQL-экранирование; включите экранирование обратной косой черты MySQL.',
      saveSettingsFailed: 'Не удалось сохранить настройки',
      loadSettingsFailed: 'Не удалось загрузить настройки',
      placeholder: 'Вставьте DEBUG-лог MyBatis / MyBatis-Plus\nЦелые строки или только части Preparing: / Parameters:; можно несколько операторов\n\nПример:\n==>  Preparing: SELECT * FROM users WHERE id = ?\n==> Parameters: 1(Long)',
      hint: 'Преобразование выполняется автоматически; параметры подставлены, SQL готов к выполнению.'
    }
  };

  var engine = window.log2sql;
  // 页面只调用宿主绑定到本插件声明命令的安全能力。
  var pageBridge = window.gonavi && typeof window.gonavi.call === 'function' ? window.gonavi : null;
  var bridge = pageBridge ? { invoke: function (command, args) {
      return pageBridge.call('plugin.invoke', { command: command, arguments: args });
    } } : null;
  var hostPrefs = window.gonaviHostPrefs || null;
  var lang = resolveUILanguage();
  var dialect = 'generic';
  // 初始化期间先保留用户的开关变化，等读取完成后再保存。
  var settingsLoaded = false;
  var pendingSave = false;
  var dialectChanged = false;
  var mediaDark = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  var els = {
    title: document.getElementById('panel-title'),
    stats: document.getElementById('stats'),
    input: document.getElementById('log-input'),
    hint: document.getElementById('hint'),
    results: document.getElementById('results'),
    mysqlEscape: document.getElementById('mysql-escape'),
    mysqlEscapeLabel: document.getElementById('mysql-escape-label')
  };
  var timer = null;
  var statusKey = null;
  var statusTimer = null;

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

  function resolveUILanguage() {
    var hosted = hostLocale();
    return hosted || resolveLanguage(navigator.languages || [navigator.language]);
  }

  // 优先跟随 GoNavi 下发的主题，其次系统 prefers-color-scheme
  function actualTheme() {
    if (hostPrefs && (hostPrefs.theme === 'light' || hostPrefs.theme === 'dark')) {
      return hostPrefs.theme;
    }
    return mediaDark && mediaDark.matches ? 'dark' : 'light';
  }

  var paletteVariables = {
    bg: '--bg', panel: '--panel', input: '--input', code: '--code', text: '--text',
    muted: '--muted', border: '--border', border1: '--border-1', accent: '--accent',
    accentSoft: '--accent-soft', ok: '--ok', warn: '--warn', warnBg: '--warn-bg',
    chip: '--chip', hover: '--hover'
  };
  var colorProbe = document.createElement('span').style;

  function applyAppearance(root) {
    var appearance = hostPrefs && hostPrefs.appearance;
    if (!appearance || typeof appearance !== 'object' || Array.isArray(appearance)) appearance = {};
    var fields = {
      fontFamily: ['--host-font-family'], monoFontFamily: ['--host-mono-font-family'],
      fontSize: ['--host-font-size', 8, 48], monoFontSize: ['--host-mono-font-size', 8, 48],
      radius: ['--host-radius', 0, 32]
    };
    Object.keys(fields).forEach(function (key) {
      var spec = fields[key];
      var value = Object.prototype.hasOwnProperty.call(appearance, key) ? appearance[key] : null;
      if (spec.length === 1 && typeof value === 'string' && value.length <= 512 &&
          !/[\\;<>()@\u0000-\u001f\u007f]/.test(value) &&
          !/^(?:inherit|initial|unset|revert|revert-layer)$/i.test(value.trim()) &&
          /^\s*(?:"[^"\\]+"|'[^'\\]+'|[-\w\u0080-\uffff]+(?:\s+[-\w\u0080-\uffff]+)*)(?:\s*,\s*(?:"[^"\\]+"|'[^'\\]+'|[-\w\u0080-\uffff]+(?:\s+[-\w\u0080-\uffff]+)*))*\s*$/.test(value)) {
        colorProbe.fontFamily = '';
        colorProbe.fontFamily = value.trim();
        if (colorProbe.fontFamily) {
          root.style.setProperty(spec[0], value.trim());
          return;
        }
      } else if (spec.length > 1 && typeof value === 'number' && Number.isFinite(value) && value >= spec[1] && value <= spec[2]) {
        root.style.setProperty(spec[0], value + 'px');
        return;
      }
      root.style.removeProperty(spec[0]);
    });
  }

  function applyTheme() {
    var root = document.documentElement;
    root.dataset.theme = actualTheme();
    applyAppearance(root);
    var appliedPalette = {};
    var palette = hostPrefs && hostPrefs.palette;
    Object.keys(paletteVariables).forEach(function (key) {
      var value = palette && typeof palette === 'object' && !Array.isArray(palette) &&
        Object.prototype.hasOwnProperty.call(palette, key) ? palette[key] : null;
      if (typeof value === 'string' && value.length <= 128 &&
          !/[\\;<>\u0000-\u001f\u007f]|(?:url|var|env|expression)\s*\(/i.test(value)) {
        value = value.trim();
        // Only resolved color literals cross this boundary; never CSS declarations or references.
        if (/^(?:#[0-9a-f]{3,8}|(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\([^()]*\)|color\((?:srgb|srgb-linear|display-p3|a98-rgb|prophoto-rgb|rec2020|xyz|xyz-d50|xyz-d65)\s+[^()]*\))$/i.test(value)) {
          colorProbe.color = '';
          colorProbe.color = value;
          if (colorProbe.color) {
            root.style.setProperty(paletteVariables[key], value);
            appliedPalette[key] = true;
            return;
          }
        }
      }
      root.style.removeProperty(paletteVariables[key]);
    });
    var appearance = hostPrefs && hostPrefs.appearance;
    if (!appearance || typeof appearance !== 'object' || Array.isArray(appearance)) appearance = {};
    var opacity = Object.prototype.hasOwnProperty.call(appearance, 'opacity') ? appearance.opacity : null;
    var validOpacity = typeof opacity === 'number' && Number.isFinite(opacity) && opacity >= 0.1 && opacity <= 1;
    if (validOpacity) root.style.setProperty('--host-surface-opacity', String(opacity));
    else root.style.removeProperty('--host-surface-opacity');
    var background = Object.prototype.hasOwnProperty.call(appearance, 'background') ? appearance.background : null;
    var enabled = background && typeof background === 'object' && !Array.isArray(background) &&
      Object.prototype.hasOwnProperty.call(background, 'enabled') && background.enabled === true;
    var tint = enabled && Object.prototype.hasOwnProperty.call(background, 'tint') ? background.tint : null;
    if (enabled) root.dataset.hostBackground = 'true';
    else delete root.dataset.hostBackground;
    if (typeof tint === 'number' && Number.isFinite(tint) && tint >= 0.7 && tint <= 0.95) root.style.setProperty('--host-background-tint', String(tint));
    else root.style.removeProperty('--host-background-tint');
    ['bg', 'panel', 'input', 'code'].forEach(function (key) {
      var variable = '--host-' + key + '-surface';
      // Host palette colors already include window alpha; tint is a separate backdrop readability mask.
      var factor = enabled && key !== 'bg' ? 'var(--host-background-tint, 0.85)' :
        validOpacity && !appliedPalette[key] ? 'var(--host-surface-opacity)' : null;
      if (factor) root.style.setProperty(variable, 'color-mix(in srgb, var(' + paletteVariables[key] + ') calc(' + factor + ' * 100%), transparent)');
      else root.style.removeProperty(variable);
    });
  }

  if (mediaDark && mediaDark.addEventListener) {
    mediaDark.addEventListener('change', function () {
      applyTheme();
    });
  }

  window.addEventListener('gonavi:host-preferences', function () {
    hostPrefs = window.gonaviHostPrefs || null;
    applyTheme();
    var nextLang = resolveUILanguage();
    if (nextLang !== lang) {
      lang = nextLang;
      applyStaticText();
      render(true);
    }
  });

  function applyStaticText() {
    document.documentElement.lang = lang;
    els.title.textContent = t('title');
    els.input.placeholder = t('placeholder');
    els.hint.textContent = t('hint');
    els.mysqlEscapeLabel.textContent = t('mysqlEscape');
    els.mysqlEscapeLabel.parentElement.title = t('mysqlEscapeHint');
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

  function render(keepNodes) {
    var text = els.input.value;
    var result = text.trim() ? engine.convert(text, dialect) : { statements: [], warnings: [] };
    // 宿主偏好事件只更新文案，保留已生成的结果节点与输入/选区。
    if (!keepNodes || els.results.children.length !== result.statements.length) keepNodes = false;
    if (!keepNodes) els.results.textContent = '';

    if (result.statements.length === 0) {
      var p = document.createElement('p');
      p.className = 'global-warn';
      p.textContent = (result.warnings && result.warnings[0]) || t('noLog');
      els.results.appendChild(p);
      els.stats.textContent = statusKey ? t(statusKey) : (text.trim() ? t('statsNoLog') : t('statsWaiting'));
      return;
    }

    els.stats.textContent = statusKey ? t(statusKey) : t('statsCount', { n: result.statements.length });
    result.statements.forEach(function (st, i) {
      if (!keepNodes) {
        els.results.appendChild(buildCard(st, i));
      } else {
        var card = els.results.children[i];
        card.querySelector('.copy-btn').textContent = t('copy');
        card.querySelector('.param-chip').textContent = t('paramChip', { p: st.paramCount, q: st.placeholderCount });
        if (!st.sql) card.querySelector('.sql').textContent = t('noRestore');
      }
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
    match.className = 'chip param-chip' + (st.paramCount === st.placeholderCount ? ' ok' : '');
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

  // ——— 标签页设置持久化 ———

  function invoke(command, args) {
    var timeout;
    var call = Promise.resolve().then(function () { return bridge.invoke(command, args); });
    var deadline = new Promise(function (_, reject) {
      timeout = setTimeout(function () { reject(new Error('plugin command timed out')); }, 10000);
    });
    // 超时只报告失败，不重试可能已落盘的写请求。
    return Promise.race([call, deadline]).finally(function () { clearTimeout(timeout); });
  }

  // 保存当前偏好到插件数据目录（GONAVI_PLUGIN_DATA/settings.json）
  function persistSettings() {
    if (!bridge) return; // 无宿主桥的本机预览只在当前页面保留设置
    if (!settingsLoaded) {
      // 等首读完成后保存，避免迟到的旧设置覆盖用户刚切换的开关。
      pendingSave = true;
      return;
    }
    invoke('saveSettings', {
      language: 'auto',
      theme: 'auto',
      dialect: dialect,
    }).then(function (result) {
      if (!result || result.saved !== true) throw new Error('settings save not confirmed');
    }).catch(function () {
      flashStatus('saveSettingsFailed');
    });
  }

  // 读取必须返回完整合法偏好，缺失或非法值不能视为初始化成功。
  function applySettings(settings) {
    if (!settings || (settings.language !== 'auto' && LANGS.indexOf(settings.language) < 0) ||
        ['auto', 'light', 'dark'].indexOf(settings.theme) < 0 ||
        ['generic', 'mysql'].indexOf(settings.dialect) < 0) throw new Error('invalid settings response');
    settingsLoaded = true;
    // 旧界面偏好只用于响应兼容，不覆盖宿主语言与主题。
    if (!dialectChanged) {
      dialect = settings.dialect;
      els.mysqlEscape.checked = dialect === 'mysql';
    }
    render();
    // 初始化期间用户切换过开关：读取完成后保存最后的选择。
    if (pendingSave) {
      pendingSave = false;
      persistSettings();
    }
  }

  // 状态栏短暂提示（保存失败等），2.5 秒后恢复为统计信息
  function flashStatus(key) {
    clearTimeout(statusTimer);
    statusKey = key;
    els.stats.textContent = t(statusKey);
    statusTimer = setTimeout(function () {
      statusKey = null;
      statusTimer = null;
      render(true);
    }, 2500);
  }

  els.mysqlEscape.checked = false;
  els.mysqlEscape.addEventListener('change', function () {
    dialect = els.mysqlEscape.checked ? 'mysql' : 'generic';
    dialectChanged = true;
    render();
    persistSettings();
  });
  applyTheme();
  applyStaticText();
  autoGrow();
  render();
  // 适配已在首个读取之前就绪；无桥预览不发出宿主调用。
  if (bridge) {
    invoke('getSettings', {}).then(function (settings) {
      applySettings(settings);
    }).catch(function () {
      // 读取失败：解除待保存状态（读取不可用，保存多半也会失败，但不应永久挂起）
      settingsLoaded = true;
      flashStatus('loadSettingsFailed');
      if (pendingSave) {
        pendingSave = false;
        persistSettings();
      }
    });
  }
})();
