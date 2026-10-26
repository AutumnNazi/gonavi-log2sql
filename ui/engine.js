// log2sql 前端转换引擎：与 Go 端 internal/ 包逐层同构，跑同一份
// testdata/cases.json 向量（ui/engine.test.mjs），双端行为由 CI 保证一致。
// 本文件同时被两种环境消费：Node 测试走 ESM export；面板构建脚本剥掉
// 末尾的 __EXPORT_LINE__ 行并挂到 window.log2sql。

// ——— 日志切分 ———

const logPrefixPattern = /^\s*\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}|^\s*(?:\[[^\]]+\]\s*)*(?:DEBUG|INFO|TRACE|WARN|ERROR)\b|^\s*(?:[A-Za-z_$][\w$]*\.)+[A-Za-z_$][\w$]*\s+-\s+/;

// messageKind 返回该行的 MyBatis 消息类型与标记起点，是切分与续行判定的唯一依据。
// 消息边界规则：只认真实日志前缀后**第一个**箭头（==> / <==）的正文，或行首（手工粘贴
// 的纯 Preparing/Parameters 行）。由此参数值里出现的 "==> Preparing:" 属于正文
// 内部、不会被再次切分；"<==      Row:" 等结果消息不匹配三种标记，返回空 kind。
function messageKind(line) {
  // 行首纯行优先：SQL 正文里的箭头字面量（如 '==>'）不应干扰标记定位
  const leading = line.replace(/^[ \t]+/, '');
  const leadIdx = line.length - leading.length;
  if (leading.startsWith('Preparing:')) return { kind: 'preparing', idx: leadIdx };
  if (leading.startsWith('Parameters:')) return { kind: 'parameters', idx: leadIdx };
  if (leading.startsWith('Total:')) return { kind: 'total', idx: leadIdx };
  // 完整日志行：只认第一个箭头（==> / <==）之后的正文
  const arrowOut = line.indexOf('==>');
  const arrowIn = line.indexOf('<==');
  let arrow = -1;
  if (arrowOut >= 0 && (arrowIn < 0 || arrowOut < arrowIn)) arrow = arrowOut;
  else if (arrowIn >= 0) arrow = arrowIn;
  if (arrow < 0 || (line.slice(0, arrow).trim() !== '' && !logPrefixPattern.test(line.slice(0, arrow)))) {
    return { kind: '', idx: -1 };
  }
  const bodyStart = arrow + 3;
  const body = line.slice(bodyStart);
  const trimmed = body.replace(/^[ \t]+/, '');
  const idx = bodyStart + (body.length - trimmed.length);
  if (trimmed.startsWith('Preparing:')) return { kind: 'preparing', idx };
  if (trimmed.startsWith('Parameters:')) return { kind: 'parameters', idx };
  if (trimmed.startsWith('Total:')) return { kind: 'total', idx };
  return { kind: '', idx: -1 };
}

// extractThread 从标记之前的日志前缀提取线程标识：取最后一个非噪声方括号段
//（噪声 = 时间戳、级别/源码行号标记、IP）。手工纯行返回空串。
function extractThread(prefix) {
  const matches = [...prefix.matchAll(/\[([^\[\]]+)\]/g)];
  for (let i = matches.length - 1; i >= 0; i--) {
    const candidate = matches[i][1].trim();
    if (candidate === '') continue;
    if (/^\d{4}-\d{2}-\d{2}/.test(candidate)) continue;
    if (/^(debug|info|trace|warn|error)\b/i.test(candidate)) continue;
    if (/^\d+\.\d+\.\d+\.\d+$/.test(candidate)) continue;
    return candidate;
  }
  return '';
}

// extractMapper 从日志行提取 logger/mapper 名：级别词之后、消息标记之前的最后一个干净 token。
// 用于把 Total / Parameters 关联到同 mapper 的语句（嵌套查询）以及展示。
function extractMapper(line) {
  const loc = /\b(DEBUG|INFO|TRACE|WARN|ERROR)\b/.exec(line);
  if (!loc) return '';
  let tail = line.slice(loc.index + loc[0].length);
  for (const cut of ['==>', '<==', 'Preparing:', 'Parameters:', 'Total:']) {
    const i = tail.indexOf(cut);
    if (i >= 0) tail = tail.slice(0, i);
  }
  const tokens = tail.trim().split(/\s+/).filter(Boolean);
  while (tokens.length > 0) {
    const last = tokens[tokens.length - 1];
    if (last === '==>' || last === '==' || (last.split('-').filter(Boolean).length === 0 && last.length > 0)) {
      tokens.pop();
      continue;
    }
    break;
  }
  if (tokens.length === 0) return '';
  const candidate = tokens[tokens.length - 1];
  if (!candidate || /[\s()[\]{}=,]/.test(candidate)) return '';
  return candidate;
}

// splitLog 把多行粘贴文本切成语句序列。消息行按 messageKind 分类：
//   - Preparing 行开新语句并记录线程标识；
//   - Parameters 行优先配对同线程、同 mapper 未取参数的语句（嵌套查询），
//     其次按线程配对，无线程时归属最后一条；同一条语句出现第二个 Parameters 时
//     保留第一条并告警；
//   - Total 行关联同线程、同 mapper 未取 Total 的语句，其次按线程，无线程才退回当前
//     语句；已收到 Total 的语句不再覆盖；
//   - 未收齐的 Parameters 采集无前缀续行；收齐或明确日志边界后不再追加；
//   - Preparing 之后、Parameters 之前的无前缀行作为 SQL 续行（保留缩进）。
function splitLog(input, dialect = 'generic') {
  // 行首时间戳（锚定行首，防止把 SQL 里的日期字面量误当日志时间）
  const timePattern = /^\s*(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?)/;
  // 独立时间戳行：不属于多行 SQL / 参数值续行，而是其他日志输出
  const timestampLinePattern = /^\s*\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}/;
  const tracePattern = /trace[_-]?id\s*[:=]\s*([0-9A-Za-z_-]+)/i;
  const totalPattern = /Total:\s*(\d+)/;

  const statements = [];
  const threadIndex = new Map(); // 线程标识 -> 语句下标
  let current = null;

  function newStatement(thread) {
    statements.push({
      sql: '', params: '', mapper: '', time: '', traceId: '', thread: thread || '',
      total: -1, hasTotal: false, gotParams: false, paramsClosed: false, warnings: [],
    });
    current = statements[statements.length - 1];
    return current;
  }

  function extractMeta(line) {
    if (!current) return;
    if (!current.time) {
      const m = line.match(timePattern);
      if (m) current.time = m[1];
    }
    if (!current.traceId) {
      const m = line.match(tracePattern);
      if (m) current.traceId = m[1];
    }
    if (!current.mapper) current.mapper = extractMapper(line);
  }

  function closeParameters(statement) {
    if (!statement || !statement.gotParams || statement.paramsClosed) return;
    statement.paramsClosed = true;
    if (statement.params.trim() !== '' && !hasCompleteParameters(statement, dialect)) {
      statement.warnings.push('参数块在日志边界前未完整，参数类型或数量可能缺失，请核对');
    }
  }

  for (const rawLine of input.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    const msg = messageKind(line);
    if (msg.kind === 'preparing' || msg.kind === 'parameters') closeParameters(current);
    if (msg.kind === 'preparing') {
      const thread = extractThread(line.slice(0, msg.idx));
      newStatement(thread);
      current.sql = line.slice(msg.idx + 'Preparing:'.length).trim();
      if (thread !== '') threadIndex.set(thread, statements.length - 1);
      extractMeta(line);
    } else if (msg.kind === 'parameters') {
      const thread = extractThread(line.slice(0, msg.idx));
      const mapper = extractMapper(line);
      // 去掉标记后的一个分隔空白，保留首参数的前导空白（属于值本身）
      const rest = trimSeparatorSpace(line.slice(msg.idx + 'Parameters:'.length));
      // 归属顺序：同 mapper 最近未取参数的语句（同线程的嵌套查询），其次同线程，
      // 最后无线程时归属当前语句
      let target = -1;
      if (mapper !== '') {
        for (let i = statements.length - 1; i >= 0; i--) {
          if (statements[i].mapper === mapper && statements[i].thread === thread && !statements[i].gotParams) { target = i; break; }
        }
      }
      if (target < 0 && thread !== '' && threadIndex.has(thread)) target = threadIndex.get(thread);
      if (target < 0 && thread === '' && current) target = statements.length - 1;
      if (target < 0) {
        // 找不到对应线程的 Preparing：单独成条并标记，绝不静默丢弃
        newStatement(thread);
        current.warnings.push('未找到对应线程的 Preparing 行，无法还原 SQL');
        target = statements.length - 1;
      }
      current = statements[target];
      if (current.gotParams) {
        current.warnings.push('同一条语句收到多条 Parameters 行，保留第一条');
      } else {
        current.params = rest;
        current.gotParams = true;
      }
      extractMeta(line);
    } else if (msg.kind === 'total') {
      const m = line.match(totalPattern);
      if (!m) continue;
      // 归属顺序：同 mapper 最近未取 Total 的语句（嵌套查询各自的行数），其次同线程，
      // 最后无线程时退回当前语句；已有 Total 的不覆盖。
      let target = null;
      const mapper = extractMapper(line);
      const thread = extractThread(line.slice(0, msg.idx));
      if (mapper !== '') {
        for (let i = statements.length - 1; i >= 0; i--) {
          if (statements[i].mapper === mapper && statements[i].thread === thread && !statements[i].hasTotal) { target = statements[i]; break; }
        }
      }
      if (!target && thread !== '' && threadIndex.has(thread)) {
        const candidate = statements[threadIndex.get(thread)];
        if (!candidate.hasTotal) target = candidate;
      }
      if (!target && thread === '' && current && !current.hasTotal) target = current;
      if (target) {
        target.total = parseInt(m[1], 10);
        target.hasTotal = true;
        closeParameters(target);
      }
    } else if (current) {
      const isLogLine = timestampLinePattern.test(line) || line.includes('==>') || line.includes('<==');
      if (!current.gotParams) {
        // SQL 续行：保留原始缩进；时间戳开头或箭头消息行属于其他日志输出
        if (line.trim() !== '' && !isLogLine) {
          current.sql += '\n' + line;
          extractMeta(line);
        }
      } else if (!current.paramsClosed && !hasCompleteParameters(current, dialect)) {
        if (isParameterContinuation(line)) {
          current.params += '\n' + line;
        } else {
          closeParameters(current);
        }
      }
    }
  }
  return statements;
}

function hasCompleteParameters(statement, dialect) {
  const placeholders = countPlaceholders(statement.sql, dialect);
  const params = coalesceParams(parseParameters(statement.params), placeholders);
  return params.length >= placeholders && params.every(p => p.type !== '' || p.isNull);
}

// isParameterContinuation 判断 Parameters 之后的普通行是否属于参数值续行。
// 判定只看日志前缀：带完整时间戳/logger、行首消息箭头、或行首是 Row:/Columns:
// 结果标记的行属于其他日志输出；其余行——包括空行和正文里含 " - " 的行——都
// 拼回参数，不按正文内容丢行。
function isParameterContinuation(line) {
  if (messageKind(line).kind !== '') return false;
  if (/^\s*(?:==>|<==)/.test(line)) return false;
  if (logPrefixPattern.test(line)) return false;
  const trimmed = line.trim();
  return !(trimmed.startsWith('Row:') || trimmed.startsWith('Columns:'));
}

// ——— 参数解析 ———

// 从右往左锚定 "值(类型)"：参数右端必然是 "(类型)"，左边界是最近的
// 「逗号+空白」分隔符——MyBatis 分隔逗号后固定跟一个空格，值内逗号后紧跟值字符。
// 分隔符自身那个空白会去掉并记入 sep，值内其余空白原样保留；尾部可以跟若干裸 null 段。
function parseParameters(s) {
  // 只去掉行尾空白与换行（参数块尾部的空行属于日志排版噪声），保留首参数前导空白
  s = s.replace(/[ \t\r\n]+$/, '');
  if (s.trim() === '') return [];
  const reversed = [];

  for (let end = s.length; end > 0;) {
    if (s[end - 1] !== ')') {
      // 剩余段以裸参数结尾（可能连续多个 null）：按「逗号+空格」切出最右裸段
      const c = lastSeparator(s.slice(0, end));
      if (c >= 0) {
        const p = bareParam(trimSeparatorSpace(s.slice(c + 1, end)), separatorAt(s, c));
        if (p) reversed.push(p);
        end = c;
        continue;
      }
      const p = bareParam(s.slice(0, end).trim(), '');
      if (p) reversed.push(p);
      break;
    }
    const seg = s.slice(0, end); // 不变量：seg 以 ')' 结尾
    const l = seg.slice(0, -1).lastIndexOf('(');
    if (l < 0 || !isTypeName(seg.slice(l + 1, seg.length - 1))) {
      // 右端 ')' 属于值：整段按裸段兜底
      const p = bareParam(seg.trim(), '');
      if (p) reversed.push(p);
      break;
    }
    const c = lastSeparator(seg.slice(0, l));
    // 保真：值尾空白属于值本身，不做 trim；只去掉分隔符携带的一个空白
    const value = c >= 0 ? trimSeparatorSpace(seg.slice(c + 1, l)) : seg.slice(0, l);
    reversed.push(typedParam(value, seg.slice(l + 1, seg.length - 1), c >= 0 ? separatorAt(seg, c) : ''));
    if (c < 0) break;
    end = c;
  }
  return reversed.reverse();
}

// 从右往左找第一个「后跟空白的逗号」；值内逗号后紧跟值字符（a,b,c），
// 分隔逗号后固定是空格（a, b），以此区分。
function lastSeparator(v) {
  for (let i = v.length - 1; i >= 0; i--) {
    if (v[i] === ',' && i + 1 < v.length && (v[i + 1] === ' ' || v[i + 1] === '\t')) {
      return i;
    }
  }
  return -1;
}

// 去掉分隔符自身携带的一个空白字符（MyBatis 用 ", " 连接），其余空白属于值内容
function trimSeparatorSpace(v) {
  return v.startsWith(' ') || v.startsWith('\t') ? v.slice(1) : v;
}

// 裸段：精确的 "null" 视为空参数，空串丢弃，其余保留原值
function bareParam(v, sep) {
  if (v === '') return null;
  if (v === 'null') return { value: '', type: '', isNull: true, sep: sep || '' };
  return { value: v, type: '', isNull: false, sep: sep || '' };
}

// 保留显式类型与值："null(String)" 是字面字符串，不能当 SQL NULL
function typedParam(value, type, sep) {
  return { value, type, isNull: false, sep: sep || '' };
}

// 返回逗号位置处的原始分隔符原文（逗号 + 一个空白字符），合并时按原文还原
function separatorAt(s, c) {
  return c < 0 || c + 1 >= s.length ? '' : s.slice(c, c + 2);
}

// Java 类型名仅含字母数字、下划线、点与 $
function isTypeName(s) {
  if (s === '') return false;
  return /^[A-Za-z0-9_.$]+$/.test(s);
}

// ——— 类型化渲染 ———

const numericTypes = new Set([
  'Long', 'Integer', 'Short', 'Byte', 'Double', 'Float', 'BigDecimal', 'BigInteger', 'Number',
]);

// 空参数输出 NULL；数字/布尔裸值；其余输出单引号字符串并双写转义内部单引号。
// mysql 方言下反斜杠是 MySQL 字符串转义符，必须双写，否则参数值末尾的反斜杠
// 会转义闭合引号、改变 SQL 结构；generic/标准 SQL 里反斜杠是普通字符。
function renderValue(p, dialect) {
  if (p.isNull) return 'NULL';
  if (p.type !== '') {
    const short = shortTypeName(p.type);
    if (short === 'Boolean') return p.value;
    if (numericTypes.has(short)) return p.value;
    return "'" + escapeSQLString(p.value, dialect) + "'";
  }
  // 裸段：按内容猜形态，宁可少猜也不把数字变成字符串
  if (/^-?\d+(?:\.\d+)?$/.test(p.value) || p.value === 'true' || p.value === 'false') {
    return p.value;
  }
  return "'" + escapeSQLString(p.value, dialect) + "'";
}

function escapeSQLString(v, dialect) {
  if (dialect === 'mysql') v = v.replace(/\\/g, '\\\\');
  return v.replace(/'/g, "''");
}

function shortTypeName(full) {
  const idx = full.lastIndexOf('.');
  return idx >= 0 ? full.slice(idx + 1) : full;
}

// ——— 占位符回填 ———

// 字符串字面量、双引号/反引号标识符与注释里的 ? 不接收参数。
// generic 只认 SQL 标准的 '' 双写转义；mysql 额外把反斜杠当转义符（\' 不闭串）。
function fillSQL(sql, params, dialect) {
  params = coalesceParams(params, countPlaceholders(sql, dialect));
  const NORMAL = 0, STR = 1, DQUOTE = 2, BACKTICK = 3, LINE = 4, BLOCK = 5;
  let state = NORMAL;
  let out = '';
  let placeholders = 0;
  let used = 0;

  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    switch (state) {
      case NORMAL:
        if (c === "'") { state = STR; out += c; }
        else if (c === '"') { state = DQUOTE; out += c; }
        else if (c === '`') { state = BACKTICK; out += c; }
        else if (c === '-' && sql[i + 1] === '-') { state = LINE; out += '--'; i++; }
        else if (c === '/' && sql[i + 1] === '*') { state = BLOCK; out += '/*'; i++; }
        else if (c === '?') {
          placeholders++;
          if (used < params.length) { out += renderValue(params[used], dialect); used++; }
          else out += c;
        }
        else out += c;
        break;
      case STR:
        // mysql：反斜杠转义下一个字符（含 '），两个一起消费保持在字符串态
        if (dialect === 'mysql' && c === '\\' && i + 1 < sql.length) {
          out += c + sql[i + 1];
          i++;
          continue;
        }
        // '' 是 SQL 标准的内部单引号转义：两个一起消费，保持在字符串态
        if (c === "'" && sql[i + 1] === "'") { out += "''"; i++; continue; }
        out += c;
        if (c === "'") state = NORMAL;
        break;
      case DQUOTE:
        out += c;
        if (c === '"') state = NORMAL;
        break;
      case BACKTICK:
        out += c;
        if (c === '`') state = NORMAL;
        break;
      case LINE:
        out += c;
        if (c === '\n') state = NORMAL;
        break;
      case BLOCK:
        out += c;
        if (c === '*' && sql[i + 1] === '/') { out += '/'; i++; state = NORMAL; }
        break;
    }
  }

  const warnings = [];
  if (used < params.length) {
    warnings.push(`参数 ${params.length} 个多于占位符 ${placeholders} 个，多余参数已丢弃`);
  } else if (placeholders > params.length) {
    warnings.push(`占位符 ${placeholders} 个多于参数 ${params.length} 个，未回填的 ? 已保留`);
  }
  return { sql: out, warnings, placeholders };
}

// 预扫描占位符数，与 fillSQL 主扫描同规则（字面量/标识符/注释内的 ? 不计）
function countPlaceholders(sql, dialect) {
  let count = 0;
  let state = 0; // 0 normal, 1 string, 2 dquote, 3 backtick, 4 line, 5 block
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    switch (state) {
      case 0:
        if (c === "'") state = 1;
        else if (c === '"') state = 2;
        else if (c === '`') state = 3;
        else if (c === '-' && sql[i + 1] === '-') { state = 4; i++; }
        else if (c === '/' && sql[i + 1] === '*') { state = 5; i++; }
        else if (c === '?') count++;
        break;
      case 1:
        if (dialect === 'mysql' && c === '\\' && i + 1 < sql.length) { i++; continue; }
        if (c === "'" && sql[i + 1] === "'") { i++; continue; }
        if (c === "'") state = 0;
        break;
      case 2: if (c === '"') state = 0; break;
      case 3: if (c === '`') state = 0; break;
      case 4: if (c === '\n') state = 0; break;
      case 5: if (c === '*' && sql[i + 1] === '/') { i++; state = 0; } break;
    }
  }
  return count;
}

// 修复「参数多于占位符」中可自动恢复的一类：值内含「逗号+空格」被解析
// 误切成裸文本段（MyBatis 正常参数都带类型标注，null 也不会走到这里）。
// 从左到右把裸文本段与其右邻合并，直到数量等于占位符数；带类型段与
// null 段不参与——真实的参数错位保持原样，由告警提示人工核对。
function coalesceParams(params, placeholders) {
  params = params.slice();
  while (params.length > placeholders) {
    let merged = false;
    for (let i = 0; i + 1 < params.length; i++) {
      if (params[i].type === '' && !params[i].isNull && !params[i + 1].isNull) {
        // 按右段记录的原始分隔符还原（可能是 ",\t"），不把 tab 换成空格
        const sep = params[i + 1].sep || ', ';
        params.splice(i, 2, {
          value: params[i].value + sep + params[i + 1].value,
          type: params[i + 1].type,
          isNull: false,
          sep: params[i].sep || '',
        });
        merged = true;
        break;
      }
    }
    if (!merged) break;
  }
  return params;
}

// ——— 编排 ———

// 字段名与后端 convert 命令的 JSON 输出保持同一契约（见 testdata/cases.json）。
// dialect 缺省 generic；mysql 时字符串字面量额外支持反斜杠转义。
function convert(log, dialect) {
  const d = parseDialect(dialect);
  const result = { statements: [], warnings: [] };
  for (const st of splitLog(log, d)) {
    let params = parseParameters(st.params);
    let sql = '';
    // 切分阶段的告警（重复 Parameters 行、找不到线程配对等）先进结果
    let warnings = (st.warnings || []).slice();
    let placeholders = 0;
    if (st.sql === '') {
      // 孤儿 Parameters：线程配对失败时 splitter 已给出精确文案，不重复添加
      if (warnings.length === 0) warnings = ['缺少 Preparing 行，无法还原 SQL'];
    } else {
      // 合并要在统计 paramCount 之前做，报告的是实际参与回填的参数数
      params = coalesceParams(params, countPlaceholders(st.sql, d));
      const filled = fillSQL(st.sql, params, d);
      sql = filled.sql;
      warnings = warnings.concat(filled.warnings);
      placeholders = filled.placeholders;
    }
    result.statements.push({
      sql,
      mapper: st.mapper || undefined,
      time: st.time || undefined,
      traceId: st.traceId || undefined,
      total: st.hasTotal ? st.total : -1,
      paramCount: params.length,
      placeholderCount: placeholders,
      warnings: warnings.length > 0 ? warnings : undefined,
    });
  }
  if (result.statements.length === 0) {
    result.warnings = ['未识别到 MyBatis Preparing/Parameters 日志'];
  } else {
    delete result.warnings;
  }
  return result;
}

// 方言入参归一：空串/undefined 按 generic；未知值抛错与后端语义一致
function parseDialect(s) {
  if (s === undefined || s === '' || s === 'generic') return 'generic';
  if (s === 'mysql') return 'mysql';
  throw new Error('unsupported dialect: ' + s);
}

const engine = { splitLog, parseParameters, renderValue, fillSQL, countPlaceholders, coalesceParams, parseDialect, convert };
// __EXPORT_LINE__
export { engine as default };
