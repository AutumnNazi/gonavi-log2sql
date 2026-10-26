package internal

import (
	"regexp"
	"strconv"
	"strings"
)

// Statement 是从日志里切出的一条待还原语句：SQL 为 Preparing: 后的原文
// （可含换行续行），Params 为 Parameters: 后的原始参数文本，其余为尽力提取的元信息。
type Statement struct {
	SQL          string
	Params       string
	Mapper       string
	Time         string
	TraceID      string
	Thread       string // 日志前缀里的线程标识，用于跨线程配对 Parameters
	Total        int
	HasTotal     bool
	Warnings     []string // 切分阶段的告警（重复参数行等），由 Convert 合并输出
	gotParams    bool     // 已读到 Parameters 行，包括空参数块
	paramsClosed bool     // 明确日志边界后不再采集参数续行
}

var (
	// 行首时间戳（锚定行首，防止把 SQL 里的日期字面量误当日志时间）：
	// 2024-01-15 10:30:45.123 / 2024-01-15T10:30:45,123
	timePattern = regexp.MustCompile(`^\s*(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?)`)
	// 独立时间戳行：不属于多行 SQL / 参数值续行，而是其他日志输出
	timestampLinePattern = regexp.MustCompile(`^\s*\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}`)
	// 显式 trace 标识：TRACEID: xxx / trace_id=xxx / Trace-Id: xxx
	tracePattern = regexp.MustCompile(`(?i)trace[_-]?id\s*[:=]\s*([0-9A-Za-z_-]+)`)
	// 日志级别词：mapper 取级别词之后、消息标记之前的 token
	levelPattern      = regexp.MustCompile(`\b(DEBUG|INFO|TRACE|WARN|ERROR)\b`)
	loggerLinePattern = regexp.MustCompile(`^\s*(?:\[[^\]]+\]\s*)*(?:DEBUG|INFO|TRACE|WARN|ERROR)\b|^\s*(?:[A-Za-z_$][\w$]*\.)+[A-Za-z_$][\w$]*\s+-\s+`)
	totalPattern      = regexp.MustCompile(`Total:\s*(\d+)`)
	arrowLinePattern  = regexp.MustCompile(`^\s*(?:==>|<==)`)
	// 日志前缀中的方括号段（线程、级别、时间戳、IP 等都可能是方括号）
	bracketPattern = regexp.MustCompile(`\[([^\[\]]+)\]`)
	// 方括号里属于噪声的段：时间戳、级别词或源码行号标记、纯 IP
	bracketNoisePatterns = []*regexp.Regexp{
		regexp.MustCompile(`^\d{4}-\d{2}-\d{2}`),
		regexp.MustCompile(`(?i)^(debug|info|trace|warn|error)\b`),
		regexp.MustCompile(`^\d+\.\d+\.\d+\.\d+$`),
	}
)

// messageKind 返回该行的 MyBatis 消息类型与标记起点，是切分与续行判定的唯一依据。
//
// 消息边界规则：只认行首或日志前缀后第一个箭头（==> / <==）的正文，或行首（手工粘贴
// 的纯 Preparing/Parameters 行）。由此：
//   - 参数值里出现的 "==> Preparing:" 属于正文内部，不会被再次切分；
//   - "<==      Row:" / "<==    Columns:" 等结果消息不匹配三种标记，返回空 kind；
//   - 完整日志行 "... - ==>  Preparing: ..." 的正文以 Preparing: 开头。
func messageKind(line string) (kind string, contentIdx int) {
	// 行首纯行优先：SQL 正文里的箭头字面量（如 '==>'）不应干扰标记定位
	leading := strings.TrimLeft(line, " \t")
	leadIdx := len(line) - len(leading)
	switch {
	case strings.HasPrefix(leading, "Preparing:"):
		return "preparing", leadIdx
	case strings.HasPrefix(leading, "Parameters:"):
		return "parameters", leadIdx
	case strings.HasPrefix(leading, "Total:"):
		return "total", leadIdx
	}
	// 完整日志行：只认第一个箭头（==> / <==）之后的正文
	bodyStart := 0
	arrow := -1
	if i := strings.Index(line, "==>"); i >= 0 {
		arrow = i
	}
	if i := strings.Index(line, "<=="); i >= 0 && (arrow < 0 || i < arrow) {
		arrow = i
	}
	if arrow >= 0 {
		prefix := line[:arrow]
		if strings.TrimSpace(prefix) != "" && !timestampLinePattern.MatchString(prefix) && !loggerLinePattern.MatchString(prefix) {
			return "", -1
		}
		bodyStart = arrow + 3
	}
	body := line[bodyStart:]
	trimmed := strings.TrimLeft(body, " \t")
	idx := bodyStart + (len(body) - len(trimmed))
	switch {
	case strings.HasPrefix(trimmed, "Preparing:"):
		return "preparing", idx
	case strings.HasPrefix(trimmed, "Parameters:"):
		return "parameters", idx
	case strings.HasPrefix(trimmed, "Total:"):
		return "total", idx
	}
	return "", -1
}

// extractThread 从标记之前的日志前缀提取线程标识：取最后一个非噪声方括号段。
// 典型前缀 "[DEBUG] [192.168.2.176] [2026-10-26 …] [http-nio-8180-exec-9] logger - "
// 提取 http-nio-8180-exec-9；手工纯行（无前缀）返回空串，调用方退回顺序归属。
func extractThread(prefix string) string {
	matches := bracketPattern.FindAllStringSubmatch(prefix, -1)
	for i := len(matches) - 1; i >= 0; i-- {
		candidate := strings.TrimSpace(matches[i][1])
		if candidate == "" {
			continue
		}
		noise := false
		for _, pattern := range bracketNoisePatterns {
			if pattern.MatchString(candidate) {
				noise = true
				break
			}
		}
		if !noise {
			return candidate
		}
	}
	return ""
}

// extractMapper 从日志行提取 logger/mapper 名：级别词之后、消息标记之前的最后一个干净 token。
// 用于把 Total 行关联到同 mapper 的语句（嵌套查询）以及展示。
func extractMapper(line string) string {
	loc := levelPattern.FindStringIndex(line)
	if loc == nil {
		return ""
	}
	tail := line[loc[1]:]
	for _, cut := range []string{"==>", "<==", "Preparing:", "Parameters:", "Total:"} {
		if i := strings.Index(tail, cut); i >= 0 {
			tail = tail[:i]
		}
	}
	tokens := strings.Fields(tail)
	for len(tokens) > 0 {
		last := tokens[len(tokens)-1]
		if last == "==>" || last == "==" || (last != "" && strings.Trim(last, "-") == "") {
			tokens = tokens[:len(tokens)-1]
			continue
		}
		break
	}
	if len(tokens) == 0 {
		return ""
	}
	candidate := tokens[len(tokens)-1]
	if candidate == "" || strings.ContainsAny(candidate, " \t()[]{}=,") {
		return ""
	}
	return candidate
}

// parametersComplete 以参数类型锚点和实际占位符数判断参数块是否收齐。
func parametersComplete(st *Statement, dialect Dialect) bool {
	placeholders := countPlaceholders(st.SQL, dialect)
	params := coalesceParams(ParseParameters(st.Params), placeholders)
	if len(params) < placeholders {
		return false
	}
	for _, p := range params {
		if p.Type == "" && !p.Null {
			return false
		}
	}
	return true
}

// isParameterContinuation 判断 Parameters 之后的普通行是否属于参数值续行。
// 判定只看日志前缀：带完整时间戳、logger、行首消息箭头或 Row:/Columns:
// 结果标记的行属于其他日志输出；其余行——包括空行和正文里含 " - " 的行——都
// 拼回参数，不按正文内容丢行。
func isParameterContinuation(line string) bool {
	if kind, _ := messageKind(line); kind != "" {
		return false
	}
	if arrowLinePattern.MatchString(line) {
		return false
	}
	if timestampLinePattern.MatchString(line) || loggerLinePattern.MatchString(line) {
		return false
	}
	trimmed := strings.TrimSpace(line)
	if strings.HasPrefix(trimmed, "Row:") || strings.HasPrefix(trimmed, "Columns:") {
		return false
	}
	return true
}

// SplitLog 把多行粘贴文本切成语句序列。消息行按 messageKind 分类：
//   - Preparing 行开新语句并记录线程标识；
//   - Parameters 行优先按线程标识配对到同线程最近未取参数的语句，无线程时归属
//     最后一条语句；同一条语句出现第二个 Parameters 时保留第一条并告警；
//   - Total 行按 mapper 关联同 mapper 未取 Total 的语句，其次按线程，最后退回
//     当前语句；已收到 Total 的语句不再覆盖；
//   - Parameters 之后的无前缀行作为参数续行拼回（多行字符串值）；
//   - Preparing 之后、Parameters 之前的无前缀行作为 SQL 续行。
func SplitLog(input string) []Statement {
	return splitLog(input, DialectGeneric)
}

func closeParameters(st *Statement, dialect Dialect) {
	if st == nil || !st.gotParams || st.paramsClosed {
		return
	}
	st.paramsClosed = true
	if strings.TrimSpace(st.Params) != "" && !parametersComplete(st, dialect) {
		st.Warnings = append(st.Warnings, "参数块在日志边界前未完整，参数类型或数量可能缺失，请核对")
	}
}

func splitLog(input string, dialect Dialect) []Statement {
	var statements []Statement
	var current *Statement
	threadIndex := make(map[string]int) // 线程标识 -> 语句下标
	for _, rawLine := range strings.Split(input, "\n") {
		line := strings.TrimRight(rawLine, "\r")
		kind, idx := messageKind(line)
		if kind == "preparing" || kind == "parameters" {
			closeParameters(current, dialect)
		}
		switch kind {
		case "preparing":
			// 新语句开始；即使旧语句缺 Parameters 也照常收尾，由回填阶段给出告警
			statements = append(statements, Statement{})
			current = &statements[len(statements)-1]
			current.SQL = strings.TrimSpace(line[idx+len("Preparing:"):])
			current.Thread = extractThread(line[:idx])
			if current.Thread != "" {
				threadIndex[current.Thread] = len(statements) - 1
			}
			extractMeta(current, line)
		case "parameters":
			thread := extractThread(line[:idx])
			mapper := extractMapper(line)
			// 去掉标记后的一个分隔空白，保留首参数的前导空白（属于值本身）
			rest := trimSeparatorSpace(line[idx+len("Parameters:"):])
			// 归属顺序：同 mapper 最近未取参数的语句（同线程的嵌套查询），其次同线程，
			// 最后无线程时归属当前语句
			target := -1
			if mapper != "" {
				for i := len(statements) - 1; i >= 0; i-- {
					if statements[i].Mapper == mapper && statements[i].Thread == thread && !statements[i].gotParams {
						target = i
						break
					}
				}
			}
			if target < 0 && thread != "" {
				if i, ok := threadIndex[thread]; ok {
					target = i
				}
			}
			if target < 0 && thread == "" && current != nil {
				target = len(statements) - 1
			}
			if target < 0 {
				// 找不到对应线程的 Preparing：单独成条并标记，绝不静默丢弃
				statements = append(statements, Statement{Thread: thread, Warnings: []string{"未找到对应线程的 Preparing 行，无法还原 SQL"}})
				target = len(statements) - 1
			}
			current = &statements[target]
			if current.gotParams {
				current.Warnings = append(current.Warnings, "同一条语句收到多条 Parameters 行，保留第一条")
			} else {
				current.Params = rest
				current.gotParams = true
			}
			extractMeta(current, line)
		case "total":
			m := totalPattern.FindStringSubmatch(line)
			if m == nil {
				continue
			}
			n, err := strconv.Atoi(m[1])
			if err != nil {
				continue
			}
			// 归属顺序：同 mapper 最近未取 Total 的语句（嵌套查询各自的行数），
			// 其次同线程，最后无线程时退回当前语句；已有 Total 的不覆盖。
			var target *Statement
			mapper := extractMapper(line)
			thread := extractThread(line[:idx])
			if mapper != "" {
				for i := len(statements) - 1; i >= 0; i-- {
					if statements[i].Mapper == mapper && statements[i].Thread == thread && !statements[i].HasTotal {
						target = &statements[i]
						break
					}
				}
			}
			if target == nil && thread != "" {
				if i, ok := threadIndex[thread]; ok && !statements[i].HasTotal {
					target = &statements[i]
				}
			}
			if target == nil && thread == "" && current != nil && !current.HasTotal {
				target = current
			}
			if target != nil {
				closeParameters(target, dialect)
				target.Total = n
				target.HasTotal = true
			}
		default:
			if current == nil {
				continue
			}
			isLogLine := timestampLinePattern.MatchString(line) || loggerLinePattern.MatchString(line) || arrowLinePattern.MatchString(line)
			if !current.gotParams {
				// SQL 续行：保留原始缩进；时间戳开头或箭头消息行属于其他日志输出
				if strings.TrimSpace(line) != "" && !isLogLine {
					current.SQL += "\n" + line
					extractMeta(current, line)
				}
			} else if !current.HasTotal && !current.paramsClosed && !parametersComplete(current, dialect) {
				if isParameterContinuation(line) {
					current.Params += "\n" + line
				} else {
					closeParameters(current, dialect)
				}
			}
		}
	}
	return statements
}

// extractMeta 从消息行提取时间戳、traceId 与 mapper 方法名；
// 提取不到就保持原值，不影响 SQL 还原。
func extractMeta(st *Statement, line string) {
	if st.Time == "" {
		if m := timePattern.FindStringSubmatch(line); m != nil {
			st.Time = m[1]
		}
	}
	if st.TraceID == "" {
		if m := tracePattern.FindStringSubmatch(line); m != nil {
			st.TraceID = m[1]
		}
	}
	if st.Mapper == "" {
		st.Mapper = extractMapper(line)
	}
}
