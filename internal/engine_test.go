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
			{Value: "1", Type: "Long"}, {Value: "Alice", Type: "String"}, {Value: "true", Type: "Boolean"},
		}},
		{"全类名", "x(java.lang.String)", []Param{{Value: "x", Type: "java.lang.String"}}},
		{"值含逗号", "a,b,c(String)", []Param{{Value: "a,b,c", Type: "String"}}},
		{"值含括号", "foo(bar(String)", []Param{{Value: "foo(bar", Type: "String"}}},
		{"空字符串值", "(String)", []Param{{Value: "", Type: "String"}}},
		{"尾部裸 null", "1(Long), null", []Param{{Value: "1", Type: "Long"}, {Null: true}}},
		{"仅裸 null", "null", []Param{{Null: true}}},
		{"裸段无类型", "42", []Param{{Value: "42"}}},
		{"尾部裸段带空格", "1(Long),  extra", []Param{{Value: "1", Type: "Long"}, {Value: "extra"}}},
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
		name string
		in   Param
		want string
	}{
		{"整数", Param{Value: "7", Type: "Long"}, "7"},
		{"全类名整数", Param{Value: "7", Type: "java.lang.Long"}, "7"},
		{"小数", Param{Value: "99.99", Type: "BigDecimal"}, "99.99"},
		{"布尔", Param{Value: "false", Type: "Boolean"}, "false"},
		{"字符串", Param{Value: "Alice", Type: "String"}, "'Alice'"},
		{"字符串转义", Param{Value: "O'Brien", Type: "String"}, "'O''Brien'"},
		{"时间戳", Param{Value: "2024-01-15 10:30:45.0", Type: "Timestamp"}, "'2024-01-15 10:30:45.0'"},
		{"LocalDateTime", Param{Value: "2024-01-15T10:30:45", Type: "java.time.LocalDateTime"}, "'2024-01-15T10:30:45'"},
		{"null", Param{Null: true}, "NULL"},
		{"裸段数字", Param{Value: "42"}, "42"},
		{"裸段负数", Param{Value: "-3.5"}, "-3.5"},
		{"裸段布尔", Param{Value: "true"}, "true"},
		{"裸段文本", Param{Value: "hello"}, "'hello'"},
		{"空字符串值", Param{Value: "", Type: "String"}, "''"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := RenderValue(tc.in); got != tc.want {
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
			params: []Param{{Value: "X", Type: "String"}},
			wantSQL: "note = 'a?b' AND code = 'X'", wantPlace: 1,
		},
		{
			name: "双引号转义不提前出字符串", sql: "a = 'x''y?' AND b = ?",
			params: []Param{{Value: "1", Type: "Long"}},
			wantSQL: "a = 'x''y?' AND b = 1", wantPlace: 1,
		},
		{
			name: "块注释中的问号保留", sql: "SELECT 1 /* ? */ WHERE id = ?",
			params: []Param{{Value: "1", Type: "Long"}},
			wantSQL: "SELECT 1 /* ? */ WHERE id = 1", wantPlace: 1,
		},
		{
			name: "行注释终止于换行", sql: "SELECT 1 -- ?\n, id FROM t WHERE id = ?",
			params: []Param{{Value: "1", Type: "Long"}},
			wantSQL: "SELECT 1 -- ?\n, id FROM t WHERE id = 1", wantPlace: 1,
		},
		{
			name: "反引号中的问号保留", sql: "SELECT `a?b` FROM t WHERE id = ?",
			params: []Param{{Value: "1", Type: "Long"}},
			wantSQL: "SELECT `a?b` FROM t WHERE id = 1", wantPlace: 1,
		},
		{
			name: "双引号标识符中的问号保留", sql: "SELECT \"a?b\" FROM t WHERE id = ?",
			params: []Param{{Value: "1", Type: "Long"}},
			wantSQL: "SELECT \"a?b\" FROM t WHERE id = 1", wantPlace: 1,
		},
		{
			name: "参数多余", sql: "a = ?",
			params: []Param{{Value: "1", Type: "Long"}, {Value: "2", Type: "Long"}},
			wantSQL: "a = 1", wantWarnings: 1, wantPlace: 1,
		},
		{
			name: "参数不足", sql: "a = ? AND b = ?",
			params: []Param{{Value: "1", Type: "Long"}},
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
