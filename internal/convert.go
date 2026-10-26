package internal

// StatementResult 是一条语句的转换结果，字段名即 convert 命令的 JSON 输出，
// 与前端 ui/engine.js 的输出保持同一契约（见 testdata/cases.json）。
type StatementResult struct {
	SQL              string   `json:"sql"`
	Mapper           string   `json:"mapper,omitempty"`
	Time             string   `json:"time,omitempty"`
	TraceID          string   `json:"traceId,omitempty"`
	Total            int      `json:"total"` // -1 表示日志里没有 <== Total 行
	ParamCount       int      `json:"paramCount"`
	PlaceholderCount int      `json:"placeholderCount"`
	Warnings         []string `json:"warnings,omitempty"`
}

// Result 是整段粘贴文本的转换结果。
type Result struct {
	Statements []StatementResult `json:"statements"`
	Warnings   []string          `json:"warnings,omitempty"`
}

const totalUnknown = -1

// Convert 按 generic 方言转换日志（等价于 ConvertDialect(log, DialectGeneric)）。
func Convert(log string) Result {
	return ConvertDialect(log, DialectGeneric)
}

// ConvertDialect 编排完整转换：切分日志 → 解析参数 → 按方言回填占位符。
// 局部失败（缺 Preparing、参数与占位符不匹配）降级为告警，不中断整体转换。
func ConvertDialect(log string, dialect Dialect) Result {
	var result Result
	for _, st := range SplitLog(log) {
		params := ParseParameters(st.Params)
		var sql string
		var warnings []string
		placeholders := 0
		if st.SQL == "" {
			// 孤儿 Parameters：占位符不存在，参数匹配告警没有意义
			warnings = append(warnings, "缺少 Preparing 行，无法还原 SQL")
		} else {
			// 合并要在统计 paramCount 之前做，报告的是实际参与回填的参数数
			params = coalesceParams(params, countPlaceholders(st.SQL, dialect))
			sql, warnings, placeholders = FillSQL(st.SQL, params, dialect)
		}
		total := totalUnknown
		if st.HasTotal {
			total = st.Total
		}
		result.Statements = append(result.Statements, StatementResult{
			SQL:              sql,
			Mapper:           st.Mapper,
			Time:             st.Time,
			TraceID:          st.TraceID,
			Total:            total,
			ParamCount:       len(params),
			PlaceholderCount: placeholders,
			Warnings:         warnings,
		})
	}
	if len(result.Statements) == 0 {
		result.Warnings = append(result.Warnings, "未识别到 MyBatis Preparing/Parameters 日志")
	}
	return result
}
