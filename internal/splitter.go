package internal

import (
	"regexp"
	"strconv"
	"strings"
)

// Statement 是从日志里切出的一条待还原语句：SQL 为 Preparing: 后的原文
//（可含换行续行），Params 为 Parameters: 后的原始参数文本，其余为尽力提取的元信息。
type Statement struct {
	SQL       string
	Params    string
	Mapper    string
	Time      string
	TraceID   string
	Total     int
	HasTotal  bool
	gotParams bool // 已读到 Parameters 行：之后出现的普通行按噪声丢弃，不再续接 SQL
}

var (
	// 行首时间戳（锚定行首，防止把 SQL 里的日期字面量误当日志时间）：
	// 2024-01-15 10:30:45.123 / 2024-01-15T10:30:45,123
	timePattern = regexp.MustCompile(`^\s*(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?)`)
	// 独立时间戳行：Preparing 与 Parameters 之间出现的这种行是其他 logger 的
	// 输出而非 SQL 续行，不得拼进 SQL
	timestampLinePattern = regexp.MustCompile(`^\s*\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}`)
	// 显式 trace 标识：TRACEID: xxx / trace_id=xxx / Trace-Id: xxx
	tracePattern = regexp.MustCompile(`(?i)trace[_-]?id\s*[:=]\s*([0-9A-Za-z_-]+)`)
	// 日志级别词：mapper 取级别词之后、` - ` 分隔之前的 token
	levelPattern = regexp.MustCompile(`\b(DEBUG|INFO|TRACE|WARN|ERROR)\b`)
	totalPattern = regexp.MustCompile(`Total:\s*(\d+)`)
)

// SplitLog 把多行粘贴文本切成语句序列。Preparing: 行开新语句，Parameters: 行
// 归属当前语句，Total: 行更新当前语句行数；Preparing 之后、Parameters 之前的
// 普通行视为 SQL 续行（日志排版换行），其余普通行按噪声忽略。
func SplitLog(input string) []Statement {
	var statements []Statement
	var current *Statement
	for _, rawLine := range strings.Split(input, "\n") {
		line := strings.TrimRight(rawLine, "\r")
		switch {
		case strings.Contains(line, "Preparing:"):
			// 新语句开始；即使旧语句缺 Parameters 也照常收尾，由回填阶段给出告警
			statements = append(statements, Statement{})
			current = &statements[len(statements)-1]
			rest := line[strings.Index(line, "Preparing:")+len("Preparing:"):]
			current.SQL = strings.TrimSpace(rest)
			extractMeta(current, line)
		case strings.Contains(line, "Parameters:"):
			if current == nil {
				// 孤儿 Parameters：没有 Preparing 就无法还原 SQL，单独成条并告警
				statements = append(statements, Statement{})
				current = &statements[len(statements)-1]
			}
			rest := line[strings.Index(line, "Parameters:")+len("Parameters:"):]
			current.Params = strings.TrimSpace(rest)
			current.gotParams = true
			extractMeta(current, line)
		case strings.Contains(line, "Total:"):
			// Total 行归属当前语句；无当前语句时按噪声忽略
			if m := totalPattern.FindStringSubmatch(line); m != nil && current != nil {
				if n, err := strconv.Atoi(m[1]); err == nil {
					current.Total = n
					current.HasTotal = true
				}
			}
		case current != nil && !current.gotParams && strings.TrimSpace(line) != "" && !timestampLinePattern.MatchString(line):
			// SQL 续行：保留原始缩进；时间戳开头的行属于其他日志输出，跳过
			current.SQL += "\n" + line
			extractMeta(current, line)
		}
	}
	return statements
}

// extractMeta 从 Preparing/Parameters 行的前缀与整行里提取时间戳、traceId 与
// mapper 方法名；提取不到就保持原值，不影响 SQL 还原。
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
	if st.Mapper != "" {
		return
	}
	loc := levelPattern.FindStringIndex(line)
	if loc == nil {
		return
	}
	// 级别词之后、Preparing:/Parameters: 之前的片段，剥掉尾部箭头与 "-" 分隔残迹
	tail := line[loc[1]:]
	if idx := strings.Index(tail, "Preparing:"); idx >= 0 {
		tail = tail[:idx]
	}
	if idx := strings.Index(tail, "Parameters:"); idx >= 0 {
		tail = tail[:idx]
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
	// mapper 应当是单个干净 token，防止把线程名等误当方法名
	if len(tokens) > 0 {
		candidate := tokens[len(tokens)-1]
		if candidate != "" && !strings.ContainsAny(candidate, " \t()[]{}=,") {
			st.Mapper = candidate
		}
	}
}
