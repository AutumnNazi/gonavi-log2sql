package internal

import (
	"strconv"
	"strings"
)

// 词法状态：字符串字面量、双引号/反引号标识符与注释里的 ? 不接收参数，
// 只有 normal 态的 ? 是占位符。行注释终止于换行（多行 SQL 的续行恢复解析）。
const (
	stateNormal = iota
	stateString
	stateDoubleQuote
	stateBacktick
	stateLineComment
	stateBlockComment
)

// Dialect 决定字符串字面量的转义规则：generic 只认 SQL 标准的 ” 双写，
// mysql 额外把反斜杠当转义符（\' 不闭串）。
type Dialect int

const (
	DialectGeneric Dialect = iota
	DialectMySQL
)

// ParseDialect 把命令入参映射为方言；空串按 generic 处理
func ParseDialect(s string) (Dialect, error) {
	switch s {
	case "", "generic":
		return DialectGeneric, nil
	case "mysql":
		return DialectMySQL, nil
	default:
		return DialectGeneric, &DialectError{Input: s}
	}
}

// DialectError 区分"未知方言"与合法值，便于命令层返回精确错误
type DialectError struct{ Input string }

func (e *DialectError) Error() string { return "unsupported dialect: " + e.Input }

// FillSQL 把参数按出现顺序回填到 SQL 的 ? 占位符。
// 参数多于占位符时先尝试把裸文本段与右邻合并（见 coalesceParams）修复
// 值内「逗号+空格」的误切；仍不匹配则丢弃多余参数或保留未回填 ? 并告警——
// 两种情况都给出可读结果，不中断转换。
func FillSQL(sql string, params []Param, dialect Dialect) (string, []string, int) {
	params = coalesceParams(params, countPlaceholders(sql, dialect))
	var b strings.Builder
	var warnings []string
	state := stateNormal
	placeholders := 0
	used := 0

	for i := 0; i < len(sql); i++ {
		c := sql[i]
		switch state {
		case stateNormal:
			switch {
			case c == '\'':
				state = stateString
				b.WriteByte(c)
			case c == '"':
				state = stateDoubleQuote
				b.WriteByte(c)
			case c == '`':
				state = stateBacktick
				b.WriteByte(c)
			case c == '-' && i+1 < len(sql) && sql[i+1] == '-':
				state = stateLineComment
				b.WriteString("--")
				i++
			case c == '/' && i+1 < len(sql) && sql[i+1] == '*':
				state = stateBlockComment
				b.WriteString("/*")
				i++
			case c == '?':
				placeholders++
				if used < len(params) {
					b.WriteString(RenderValue(params[used], dialect))
					used++
				} else {
					b.WriteByte(c)
				}
			default:
				b.WriteByte(c)
			}
		case stateString:
			// mysql：反斜杠转义下一个字符（含 '），两个一起消费保持在字符串态
			if dialect == DialectMySQL && c == '\\' && i+1 < len(sql) {
				b.WriteByte(c)
				b.WriteByte(sql[i+1])
				i++
				continue
			}
			// '' 是 SQL 标准的内部单引号转义：两个一起消费，保持在字符串态
			if c == '\'' && i+1 < len(sql) && sql[i+1] == '\'' {
				b.WriteString("''")
				i++
				continue
			}
			b.WriteByte(c)
			if c == '\'' {
				state = stateNormal
			}
		case stateDoubleQuote:
			b.WriteByte(c)
			if c == '"' {
				state = stateNormal
			}
		case stateBacktick:
			b.WriteByte(c)
			if c == '`' {
				state = stateNormal
			}
		case stateLineComment:
			b.WriteByte(c)
			if c == '\n' {
				state = stateNormal
			}
		case stateBlockComment:
			b.WriteByte(c)
			if c == '*' && i+1 < len(sql) && sql[i+1] == '/' {
				b.WriteByte('/')
				i++
				state = stateNormal
			}
		}
	}

	switch {
	case used < len(params):
		warnings = append(warnings, "参数 "+strconv.Itoa(len(params))+" 个多于占位符 "+strconv.Itoa(placeholders)+" 个，多余参数已丢弃")
	case placeholders > len(params):
		warnings = append(warnings, "占位符 "+strconv.Itoa(placeholders)+" 个多于参数 "+strconv.Itoa(len(params))+" 个，未回填的 ? 已保留")
	}
	return b.String(), warnings, placeholders
}

// countPlaceholders 预扫描占位符数，与 FillSQL 主扫描同规则
// （字面量/标识符/注释内的 ? 不计）。
func countPlaceholders(sql string, dialect Dialect) int {
	count := 0
	state := stateNormal
	for i := 0; i < len(sql); i++ {
		c := sql[i]
		switch state {
		case stateNormal:
			switch {
			case c == '\'':
				state = stateString
			case c == '"':
				state = stateDoubleQuote
			case c == '`':
				state = stateBacktick
			case c == '-' && i+1 < len(sql) && sql[i+1] == '-':
				state = stateLineComment
				i++
			case c == '/' && i+1 < len(sql) && sql[i+1] == '*':
				state = stateBlockComment
				i++
			case c == '?':
				count++
			}
		case stateString:
			if dialect == DialectMySQL && c == '\\' && i+1 < len(sql) {
				i++
				continue
			}
			if c == '\'' && i+1 < len(sql) && sql[i+1] == '\'' {
				i++
				continue
			}
			if c == '\'' {
				state = stateNormal
			}
		case stateDoubleQuote:
			if c == '"' {
				state = stateNormal
			}
		case stateBacktick:
			if c == '`' {
				state = stateNormal
			}
		case stateLineComment:
			if c == '\n' {
				state = stateNormal
			}
		case stateBlockComment:
			if c == '*' && i+1 < len(sql) && sql[i+1] == '/' {
				i++
				state = stateNormal
			}
		}
	}
	return count
}

// coalesceParams 修复「参数多于占位符」中可自动恢复的一类：值内含
// 「逗号+空白」被解析误切成裸文本段（MyBatis 正常参数都带类型标注，
// null 也不会走到这里）。从左到右把裸文本段与其右邻合并（值 = 左 + 原始分隔符 + 右，
// 类型取右邻），直到数量等于占位符数；带类型段与 null 段不参与合并——
// 真实的参数错位保持原样，由告警提示人工核对。
func coalesceParams(params []Param, placeholders int) []Param {
	for len(params) > placeholders {
		merged := false
		for i := 0; i+1 < len(params); i++ {
			if params[i].Type == "" && !params[i].Null && !params[i+1].Null {
				// 按右段记录的原始分隔符还原（可能是 ",\t"），不把 tab 换成空格
				sep := params[i+1].sep
				if sep == "" {
					sep = ", "
				}
				joined := make([]Param, 0, len(params)-1)
				joined = append(joined, params[:i]...)
				joined = append(joined, Param{
					Value: params[i].Value + sep + params[i+1].Value,
					Type:  params[i+1].Type,
					sep:   params[i].sep,
				})
				joined = append(joined, params[i+2:]...)
				params = joined
				merged = true
				break
			}
		}
		if !merged {
			break
		}
	}
	return params
}
