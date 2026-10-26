// log2sql 前端转换引擎：与 Go 端 internal/ 包逐层同构，跑同一份
// testdata/cases.json 向量（ui/engine.test.mjs），双端行为由 CI 保证一致。
// 本文件同时被两种环境消费：Node 测试走 ESM export；面板构建脚本剥掉
// 末尾的 __EXPORT_LINE__ 行并挂到 window.log2sql。

// ——— 日志切分 ———

// Preparing: 行开新语句，Parameters: 行归属当前语句，Total: 行更新行数；
// Preparing 之后、Parameters 之前的普通行视为 SQL 续行（保留缩进）。
function splitLog(input) {
  // 行首时间戳（锚定行首，防止把 SQL 里的日期字面量误当日志时间）
  const timePattern = /^\s*(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?)/;
  // 独立时间戳行：Preparing 与 Parameters 之间出现的这种行是其他 logger 的输出
  const timestampLinePattern = /^\s*\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}/;
  const tracePattern = /trace[_-]?id\s*[:=]\s*([0-9A-Za-z_-]+)/i;
  const levelPattern = /\b(DEBUG|INFO|TRACE|WARN|ERROR)\b/;
  const totalPattern = /Total:\s*(\d+)/;

  const statements = [];
  let current = null;

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
    if (current.mapper) return;
    const loc = levelPattern.exec(line);
    if (!loc) return;
    let tail = line.slice(loc.index + loc[0].length);
    const pIdx = tail.indexOf('Preparing:');
    if (pIdx >= 0) tail = tail.slice(0, pIdx);
    const paIdx = tail.indexOf('Parameters:');
    if (paIdx >= 0) tail = tail.slice(0, paIdx);
    const tokens = tail.trim().split(/\s+/).filter(Boolean);
    while (tokens.length > 0) {
      const last = tokens[tokens.length - 1];
      if (last === '==>' || last === '==' || (last.split('-').filter(Boolean).length === 0 && last.length > 0)) {
        tokens.pop();
        continue;
      }
      break;
    }
    if (tokens.length > 0) {
      const candidate = tokens[tokens.length - 1];
      if (candidate && !/[\s()[\]{}=,]/.test(candidate)) {
        current.mapper = candidate;
      }
    }
  }

  for (const rawLine of input.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (line.includes('Preparing:')) {
      statements.push({ sql: '', params: '', mapper: '', time: '', traceId: '', total: -1, hasTotal: false, gotParams: false });
      current = statements[statements.length - 1];
      current.sql = line.slice(line.indexOf('Preparing:') + 'Preparing:'.length).trim();
      extractMeta(line);
    } else if (line.includes('Parameters:')) {
      if (!current) {
        // 孤儿 Parameters：没有 Preparing 就无法还原 SQL，单独成条并告警
        statements.push({ sql: '', params: '', mapper: '', time: '', traceId: '', total: -1, hasTotal: false, gotParams: false });
        current = statements[statements.length - 1];
      }
      current.params = line.slice(line.indexOf('Parameters:') + 'Parameters:'.length).trim();
      current.gotParams = true;
      extractMeta(line);
    } else if (line.includes('Total:')) {
      const m = line.match(totalPattern);
      if (m && current) {
        current.total = parseInt(m[1], 10);
        current.hasTotal = true;
      }
    } else if (current && !current.gotParams && line.trim() !== '' && !timestampLinePattern.test(line)) {
      current.sql += '\n' + line; // 续行保留原始缩进；时间戳开头的行属于其他日志输出
      extractMeta(line);
    }
  }
  return statements;
}

// ——— 参数解析 ———

// 从右往左锚定 "值(类型)"：参数右端必然是 "(类型)"，左边界是最近的
// 「逗号+空白」分隔符——MyBatis 分隔逗号后固定跟空格，值内逗号后紧跟值字符。
function parseParameters(s) {
  s = s.trim();
  if (s === '') return [];
  const reversed = [];
  let end = s.length;

  // 尾部裸段：末字符不是 ')' 时，最后一个 ')' 之后（或整个串）按裸段处理
  if (s[end - 1] !== ')') {
    const r = s.lastIndexOf(')');
    if (r < 0) {
      const p = bareParam(s);
      if (p) reversed.push(p);
      end = 0;
    } else {
      const tail = s.slice(r + 1).trim().replace(/^,/, '').trim();
      const p = bareParam(tail);
      if (p) reversed.push(p);
      end = r + 1;
    }
  }

  while (end > 0) {
    if (s[end - 1] !== ')') {
      // 剩余段以裸参数结尾：先按「逗号+空格」切出最右裸段，左边可能还有参数
      const c = lastSeparator(s.slice(0, end));
      if (c >= 0) {
        const p = bareParam(s.slice(c + 1, end));
        if (p) reversed.push(p);
        end = c;
        continue;
      }
      const p = bareParam(s.slice(0, end).trim());
      if (p) reversed.push(p);
      break;
    }
    const seg = s.slice(0, end); // 不变量：seg 以 ')' 结尾
    const l = seg.slice(0, -1).lastIndexOf('(');
    if (l < 0 || !isTypeName(seg.slice(l + 1, seg.length - 1))) {
      // 右端 ')' 属于值：整段按裸段兜底
      const p = bareParam(seg.trim());
      if (p) reversed.push(p);
      break;
    }
    const c = lastSeparator(seg.slice(0, l));
    const value = (c >= 0 ? seg.slice(c + 1, l) : seg.slice(0, l)).trim();
    reversed.push(typedParam(value, seg.slice(l + 1, seg.length - 1)));
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

// 裸段：精确的 "null" 视为空参数，空串丢弃，其余保留原值
function bareParam(v) {
  v = v.trim();
  if (v === '') return null;
  if (v === 'null') return { value: '', type: '', isNull: true };
  return { value: v, type: '', isNull: false };
}

// "值(类型)"：容忍手工整理后的 "null(类型)" 写法
function typedParam(value, type) {
  if (value === 'null') return { value: '', type: '', isNull: true };
  return { value, type, isNull: false };
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

// 空参数输出 NULL；数字/布尔裸值；其余输出单引号字符串并双写转义内部单引号
function renderValue(p) {
  if (p.isNull) return 'NULL';
  if (p.type !== '') {
    const short = shortTypeName(p.type);
    if (short === 'Boolean') return p.value;
    if (numericTypes.has(short)) return p.value;
    return "'" + p.value.replace(/'/g, "''") + "'";
  }
  // 裸段：按内容猜形态，宁可少猜也不把数字变成字符串
  if (/^-?\d+(?:\.\d+)?$/.test(p.value) || p.value === 'true' || p.value === 'false') {
    return p.value;
  }
  return "'" + p.value.replace(/'/g, "''") + "'";
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
          if (used < params.length) { out += renderValue(params[used]); used++; }
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
        params.splice(i, 2, {
          value: params[i].value + ', ' + params[i + 1].value,
          type: params[i + 1].type,
          isNull: false,
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
  for (const st of splitLog(log)) {
    let params = parseParameters(st.params);
    let sql = '';
    let warnings = [];
    let placeholders = 0;
    if (st.sql === '') {
      // 孤儿 Parameters：占位符不存在，参数匹配告警没有意义
      warnings = ['缺少 Preparing 行，无法还原 SQL'];
    } else {
      // 合并要在统计 paramCount 之前做，报告的是实际参与回填的参数数
      params = coalesceParams(params, countPlaceholders(st.sql, d));
      const filled = fillSQL(st.sql, params, d);
      sql = filled.sql;
      warnings = filled.warnings;
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
