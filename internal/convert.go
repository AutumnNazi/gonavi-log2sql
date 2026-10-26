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
	for _, st := range splitLog(log, dialect) {
		params := ParseParameters(st.Params)
		var sql string
		// 切分阶段的告警（重复 Parameters 行、找不到线程配对等）先进结果
		warnings := append([]string{}, st.Warnings...)
		placeholders := 0
		if st.SQL == "" {
			// 孤儿 Parameters：占位符不存在，参数匹配告警没有意义；
			// 线程配对失败时 splitter 已给出更精确的文案，不重复添加
			if len(st.Warnings) == 0 {
				warnings = append(warnings, "缺少 Preparing 行，无法还原 SQL")
			}
		} else {
			// 合并要在统计 paramCount 之前做，报告的是实际参与回填的参数数
			params = coalesceParams(params, countPlaceholders(st.SQL, dialect))
			var fillWarnings []string
			sql, fillWarnings, placeholders = FillSQL(st.SQL, params, dialect)
			warnings = append(warnings, fillWarnings...)
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
