package internal

import (
	"reflect"
	"testing"
)

// 参数解析：从右往左锚定 "值(类型)"，值内的逗号与括号不干扰切分。
func TestParseParameters(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want []Param
	}{
		{"空串", "", nil},
		{"单参数", "1(Long)", []Param{{Value: "1", Type: "Long"}}},
		{"多参数", "1(Long), Alice(String), true(Boolean)", []Param{
			{Value: "1", Type: "Long"},
			{Value: "Alice", Type: "String", sep: ", "},
			{Value: "true", Type: "Boolean", sep: ", "},
		}},
		{"全类名", "x(java.lang.String)", []Param{{Value: "x", Type: "java.lang.String"}}},
		{"值含逗号", "a,b,c(String)", []Param{{Value: "a,b,c", Type: "String"}}},
		{"值含括号", "foo(bar(String)", []Param{{Value: "foo(bar", Type: "String"}}},
		{"空字符串值", "(String)", []Param{{Value: "", Type: "String"}}},
		{"尾部裸 null", "1(Long), null", []Param{{Value: "1", Type: "Long"}, {Null: true, sep: ", "}}},
		{"仅裸 null", "null", []Param{{Null: true}}},
		{"裸段无类型", "42", []Param{{Value: "42"}}},
		{"尾部裸段带空格", "1(Long),  extra", []Param{{Value: "1", Type: "Long"}, {Value: " extra", sep: ", "}}},
		{"首参数前导空格保留", " padded(String)", []Param{{Value: " padded", Type: "String"}}},
		{"tab 分隔符原文记录", "1(Long),\t2(Long)", []Param{
			{Value: "1", Type: "Long"},
			{Value: "2", Type: "Long", sep: ",\t"},
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := ParseParameters(tc.in)
			if !reflect.DeepEqual(got, tc.want) {
				t.Fatalf("期望 %+v，实际 %+v", tc.want, got)
			}
		})
	}
}

// 类型化渲染：数字/布尔裸值、字符串加引号转义、null 输出 NULL。
func TestRenderValue(t *testing.T) {
	cases := []struct {
		name    string
		in      Param
		dialect Dialect
		want    string
	}{
		{"整数", Param{Value: "7", Type: "Long"}, DialectGeneric, "7"},
		{"全类名整数", Param{Value: "7", Type: "java.lang.Long"}, DialectGeneric, "7"},
		{"小数", Param{Value: "99.99", Type: "BigDecimal"}, DialectGeneric, "99.99"},
		{"布尔", Param{Value: "false", Type: "Boolean"}, DialectGeneric, "false"},
		{"字符串", Param{Value: "Alice", Type: "String"}, DialectGeneric, "'Alice'"},
		{"字符串转义", Param{Value: "O'Brien", Type: "String"}, DialectGeneric, "'O''Brien'"},
		{"时间戳", Param{Value: "2024-01-15 10:30:45.0", Type: "Timestamp"}, DialectGeneric, "'2024-01-15 10:30:45.0'"},
		{"LocalDateTime", Param{Value: "2024-01-15T10:30:45", Type: "java.time.LocalDateTime"}, DialectGeneric, "'2024-01-15T10:30:45'"},
		{"null", Param{Null: true}, DialectGeneric, "NULL"},
		{"裸段数字", Param{Value: "42"}, DialectGeneric, "42"},
		{"裸段负数", Param{Value: "-3.5"}, DialectGeneric, "-3.5"},
		{"裸段布尔", Param{Value: "true"}, DialectGeneric, "true"},
		{"裸段文本", Param{Value: "hello"}, DialectGeneric, "'hello'"},
		{"空字符串值", Param{Value: "", Type: "String"}, DialectGeneric, "''"},
		// mysql：反斜杠必须双写，否则 \' 逃逸闭合引号、\t 之类的转义改写值
		{"mysql 反斜杠双写", Param{Value: `a\`, Type: "String"}, DialectMySQL, `'a\\'`},
		{"mysql 路径反斜杠", Param{Value: `C:\temp`, Type: "String"}, DialectMySQL, `'C:\\temp'`},
		{"generic 反斜杠保持原样", Param{Value: `C:\temp`, Type: "String"}, DialectGeneric, `'C:\temp'`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := RenderValue(tc.in, tc.dialect); got != tc.want {
				t.Fatalf("期望 %q，实际 %q", tc.want, got)
			}
		})
	}
}

// 占位符回填：字符串字面量、标识符引用与注释中的 ? 不参与替换。
func TestFillSQL(t *testing.T) {
	cases := []struct {
		name         string
		sql          string
		params       []Param
		wantSQL      string
		wantWarnings int
		wantPlace    int
	}{
		{
			name: "字面量中的问号保留", sql: "note = 'a?b' AND code = ?",
			params:  []Param{{Value: "X", Type: "String"}},
			wantSQL: "note = 'a?b' AND code = 'X'", wantPlace: 1,
		},
		{
			name: "双引号转义不提前出字符串", sql: "a = 'x''y?' AND b = ?",
			params:  []Param{{Value: "1", Type: "Long"}},
			wantSQL: "a = 'x''y?' AND b = 1", wantPlace: 1,
		},
		{
			name: "块注释中的问号保留", sql: "SELECT 1 /* ? */ WHERE id = ?",
			params:  []Param{{Value: "1", Type: "Long"}},
			wantSQL: "SELECT 1 /* ? */ WHERE id = 1", wantPlace: 1,
		},
		{
			name: "行注释终止于换行", sql: "SELECT 1 -- ?\n, id FROM t WHERE id = ?",
			params:  []Param{{Value: "1", Type: "Long"}},
			wantSQL: "SELECT 1 -- ?\n, id FROM t WHERE id = 1", wantPlace: 1,
		},
		{
			name: "反引号中的问号保留", sql: "SELECT `a?b` FROM t WHERE id = ?",
			params:  []Param{{Value: "1", Type: "Long"}},
			wantSQL: "SELECT `a?b` FROM t WHERE id = 1", wantPlace: 1,
		},
		{
			name: "双引号标识符中的问号保留", sql: "SELECT \"a?b\" FROM t WHERE id = ?",
			params:  []Param{{Value: "1", Type: "Long"}},
			wantSQL: "SELECT \"a?b\" FROM t WHERE id = 1", wantPlace: 1,
		},
		{
			name: "参数多余", sql: "a = ?",
			params:  []Param{{Value: "1", Type: "Long"}, {Value: "2", Type: "Long"}},
			wantSQL: "a = 1", wantWarnings: 1, wantPlace: 1,
		},
		{
			name: "参数不足", sql: "a = ? AND b = ?",
			params:  []Param{{Value: "1", Type: "Long"}},
			wantSQL: "a = 1 AND b = ?", wantWarnings: 1, wantPlace: 2,
		},
		{
			name: "无占位符无参数", sql: "SELECT 1",
			wantSQL: "SELECT 1",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			gotSQL, gotWarnings, gotPlace := FillSQL(tc.sql, tc.params, DialectGeneric)
			if gotSQL != tc.wantSQL {
				t.Fatalf("sql 不符：\n期望: %q\n实际: %q", tc.wantSQL, gotSQL)
			}
			if len(gotWarnings) != tc.wantWarnings {
				t.Fatalf("warnings 期望 %d 条，实际 %d 条（%v）", tc.wantWarnings, len(gotWarnings), gotWarnings)
			}
			if gotPlace != tc.wantPlace {
				t.Fatalf("占位符数期望 %d，实际 %d", tc.wantPlace, gotPlace)
			}
		})
	}
}

// 切分：Preparing 开新语句，Parameters/Total 归属当前语句，前缀提取元信息。
func TestSplitLogMeta(t *testing.T) {
	sts := SplitLog("2024-01-15 10:30:45.123 [exec-1] DEBUG c.x.m.U.selectById - ==>  Preparing: SELECT 1\n[exec-1] DEBUG c.x.m.U.selectById - <== Total: 3")
	if len(sts) != 1 {
		t.Fatalf("期望 1 条语句，实际 %d 条", len(sts))
	}
	st := sts[0]
	if st.Mapper != "c.x.m.U.selectById" {
		t.Errorf("mapper 提取失败：%q", st.Mapper)
	}
	if st.Time != "2024-01-15 10:30:45.123" {
		t.Errorf("time 提取失败：%q", st.Time)
	}
	if st.Total != 3 || !st.HasTotal {
		t.Errorf("total 提取失败：%d（HasTotal=%v）", st.Total, st.HasTotal)
	}
}

func TestConvertDuplicateParametersCloseIncompleteContinuation(t *testing.T) {
	got := Convert("Preparing: SELECT ?\nParameters: line1\nParameters: 2(Integer)\nleaked(String)")
	if len(got.Statements) != 1 || got.Statements[0].SQL != "SELECT 'line1'" || len(got.Statements[0].Warnings) != 2 {
		t.Fatalf("重复 Parameters 必须关闭旧参数续行并保留首条，实际 %+v", got)
	}
}

func TestConvertUnthreadedMapperDoesNotBorrowThreadedStatement(t *testing.T) {
	got := Convert("[A] DEBUG m.User.find - ==> Preparing: SELECT ? AS a\nPreparing: SELECT ? AS manual\nDEBUG m.User.find - ==> Parameters: 2(Integer)\nDEBUG m.User.find - <== Total: 2\n[A] DEBUG m.User.find - ==> Parameters: 1(Integer)\n[A] DEBUG m.User.find - <== Total: 1")
	if len(got.Statements) != 2 || got.Statements[0].SQL != "SELECT 1 AS a" || got.Statements[0].Total != 1 || got.Statements[1].SQL != "SELECT 2 AS manual" || got.Statements[1].Total != 2 {
		t.Fatalf("无 thread 的 mapper 不能跨 thread 借语句，实际 %+v", got)
	}
}

func TestConvertEmptyParametersDoNotAddTypeWarning(t *testing.T) {
	for _, suffix := range []string{"\nINFO cache refreshed", "\n<== Total: 1", "\nPreparing: SELECT 2"} {
		t.Run(suffix, func(t *testing.T) {
			got := Convert("Preparing: SELECT ?\nParameters:" + suffix)
			if got.Statements[0].SQL != "SELECT ?" || len(got.Statements[0].Warnings) != 1 {
				t.Fatalf("空参数只保留既有缺参告警，不误报类型缺失，实际 %+v", got)
			}
		})
	}
}

func TestConvertPairingAndContinuationRegression(t *testing.T) {
	cases := []struct {
		name         string
		log          string
		wantSQL      []string
		wantTotal    []int
		wantWarnings []int
	}{
		{"unknown thread", "[A] DEBUG m.User.find - ==> Preparing: SELECT ?\n[X] DEBUG m.User.find - <== Total: 9\n[X] DEBUG m.User.find - ==> Parameters: 22(Integer)\n[A] DEBUG m.User.find - ==> Parameters: 11(Integer)\n[A] DEBUG m.User.find - <== Total: 1", []string{"SELECT 11", ""}, []int{1, -1}, []int{0, 1}},
		{"same thread parent child", "[A] DEBUG m.Parent.find - ==> Preparing: SELECT ? AS parent\n[A] DEBUG m.Parent.find - ==> Parameters: 1(Integer)\n[A] DEBUG m.Child.find - ==> Preparing: SELECT ? AS child\n[A] DEBUG m.Child.find - ==> Parameters: 2(Integer)\n[A] DEBUG m.Child.find - <== Total: 2\n[A] DEBUG m.Parent.find - <== Total: 5", []string{"SELECT 1 AS parent", "SELECT 2 AS child"}, []int{5, 2}, []int{0, 0}},
		{"multiline blanks and hyphen", "Preparing: SELECT ?\nParameters: line1\n\n  \nfoo - bar\nlast(String)\nINFO cache refreshed", []string{"SELECT 'line1\n\n  \nfoo - bar\nlast'"}, []int{-1}, []int{0}},
		{"columns and row boundary", "Preparing: SELECT ?\nParameters: line1\n<== Columns: id\n<== Row: 2\nleaked(String)", []string{"SELECT 'line1'"}, []int{-1}, []int{1}},
		{"single line value and SQL arrows", "Preparing: SELECT '==>', '<==', ?\nParameters: foo ==> Preparing: value <== Total: 3(String)", []string{"SELECT '==>', '<==', 'foo ==> Preparing: value <== Total: 3'"}, []int{-1}, []int{0}},
		{"bare null compatibility", "Preparing: SELECT ?, ?\nParameters: null, null\nINFO cache refreshed", []string{"SELECT NULL, NULL"}, []int{-1}, []int{0}},
		{"manual bare compatibility", "Preparing: SELECT ?\nParameters: 42", []string{"SELECT 42"}, []int{-1}, []int{0}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := Convert(tc.log)
			if len(got.Statements) != len(tc.wantSQL) {
				t.Fatalf("语句数期望 %d，实际 %+v", len(tc.wantSQL), got)
			}
			for i, st := range got.Statements {
				if st.SQL != tc.wantSQL[i] || st.Total != tc.wantTotal[i] || len(st.Warnings) != tc.wantWarnings[i] {
					t.Errorf("语句%d期望 sql=%q total=%d warnings=%d，实际 %+v", i, tc.wantSQL[i], tc.wantTotal[i], tc.wantWarnings[i], st)
				}
			}
		})
	}
}

func TestConvertIncompleteParametersCloseAtPreparing(t *testing.T) {
	got := Convert("Preparing: SELECT ?\nParameters: line1\nPreparing: SELECT 2")
	if len(got.Statements) != 2 || got.Statements[0].SQL != "SELECT 'line1'" || len(got.Statements[0].Warnings) != 1 || got.Statements[1].SQL != "SELECT 2" {
		t.Fatalf("新 Preparing 必须结束未完参数并告警，实际 %+v", got)
	}
}

func TestConvertMultilineMarkerLookingArrowBody(t *testing.T) {
	for _, body := range []string{"foo ==> Preparing: bar", "foo <== Total: 3", "foo ==> Parameters: bar"} {
		t.Run(body, func(t *testing.T) {
			got := Convert("Preparing: SELECT ?\nParameters: line1\n" + body + "(String)")
			want := "SELECT 'line1\n" + body + "'"
			if len(got.Statements) != 1 || got.Statements[0].SQL != want || len(got.Statements[0].Warnings) != 0 {
				t.Fatalf("值内貌似 MyBatis 消息的箭头必须保真，期望 %q，实际 %+v", want, got)
			}
		})
	}
}

func TestConvertMySQLIncompleteCountAtLogBoundary(t *testing.T) {
	log := "Preparing: SELECT 'a\\'b ?', ?, ?\nParameters: 1(Integer)\nINFO cache refreshed"
	got := ConvertDialect(log, DialectMySQL)
	if len(got.Statements) != 1 || len(got.Statements[0].Warnings) != 2 || got.Statements[0].PlaceholderCount != 2 {
		t.Fatalf("MySQL 字面量须按真实方言判断参数未收齐，实际 %+v", got)
	}
}

func TestConvertIncompleteParametersCloseAtTotal(t *testing.T) {
	got := Convert("Preparing: SELECT ?\nParameters: line1\n<== Total: 1\nINFO cache refreshed")
	if len(got.Statements) != 1 || got.Statements[0].SQL != "SELECT 'line1'" || got.Statements[0].Total != 1 || len(got.Statements[0].Warnings) != 1 {
		t.Fatalf("Total 必须结束未完成参数并告警，实际 %+v", got)
	}
}

func TestConvertMultilineParameterArrowBody(t *testing.T) {
	for _, arrow := range []string{"==>", "<=="} {
		t.Run(arrow, func(t *testing.T) {
			got := Convert("Preparing: SELECT ?\nParameters: line1\nfoo " + arrow + " bar(String)")
			want := "SELECT 'line1\nfoo " + arrow + " bar'"
			if len(got.Statements) != 1 || got.Statements[0].SQL != want || len(got.Statements[0].Warnings) != 0 {
				t.Fatalf("普通箭头正文必须保真，期望 %q，实际 %+v", want, got)
			}
		})
	}
}

func TestConvertIncompleteParametersStopAtLoggerBoundary(t *testing.T) {
	got := Convert("Preparing: SELECT ?\nParameters: line1\n[A] INFO m.Cache - cache refreshed\nleaked")
	if len(got.Statements) != 1 {
		t.Fatalf("期望一条语句，实际 %+v", got)
	}
	st := got.Statements[0]
	if st.SQL != "SELECT 'line1'" || len(st.Warnings) != 1 {
		t.Fatalf("未收齐参数遇明确日志边界必须停止并告警，实际 %+v", st)
	}
}

func TestConvertCompleteParametersIgnoreApplicationLogs(t *testing.T) {
	for _, suffix := range []string{"\nINFO cache refreshed", "\n<== Total: 1\nINFO cache refreshed"} {
		t.Run(suffix, func(t *testing.T) {
			got := Convert("Preparing: SELECT ?\nParameters: 1(Integer)" + suffix)
			if len(got.Statements) != 1 || got.Statements[0].SQL != "SELECT 1" || len(got.Statements[0].Warnings) != 0 {
				t.Fatalf("完整 Integer 参数不能被日志改写，实际 %+v", got)
			}
		})
	}
}

func TestConvertDuplicateEmptyParametersKeepsFirst(t *testing.T) {
	got := Convert("[A] DEBUG m.User.find - ==> Preparing: SELECT ?\n[A] DEBUG m.User.find - ==> Parameters:\n[A] DEBUG m.User.find - ==> Parameters: 2(Integer)")
	if len(got.Statements) != 1 {
		t.Fatalf("期望一条语句，实际 %+v", got)
	}
	st := got.Statements[0]
	if st.SQL != "SELECT ?" || st.ParamCount != 0 || len(st.Warnings) != 2 {
		t.Fatalf("空 Parameters 必须保留并提示重复与缺参，实际 %+v", st)
	}
}

func TestConvertSameMapperAcrossThreads(t *testing.T) {
	log := "[A] DEBUG m.User.find - ==> Preparing: SELECT ? AS a\n" +
		"[B] DEBUG m.User.find - ==> Preparing: SELECT ? AS b\n" +
		"[A] DEBUG m.User.find - ==> Parameters: 11(Integer)\n" +
		"[B] DEBUG m.User.find - ==> Parameters: 22(Integer)\n" +
		"[A] DEBUG m.User.find - <== Total: 1\n" +
		"[B] DEBUG m.User.find - <== Total: 2"
	got := Convert(log)
	if len(got.Statements) != 2 {
		t.Fatalf("语句数期望 2，实际 %+v", got)
	}
	for i, want := range []struct {
		sql   string
		total int
	}{{"SELECT 11 AS a", 1}, {"SELECT 22 AS b", 2}} {
		st := got.Statements[i]
		if st.SQL != want.sql || st.Total != want.total || len(st.Warnings) != 0 {
			t.Errorf("语句 %d 期望 sql=%q total=%d 无告警，实际 %+v", i, want.sql, want.total, st)
		}
	}
}
