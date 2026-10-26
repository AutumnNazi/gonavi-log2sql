package internal

import (
	"encoding/json"
	"os"
	"testing"
)

// 跑 testdata/cases.json 共享向量：与 ui/engine.test.mjs 使用同一份数据，
// 双端任何一方行为变化都会在这里或 Node 测试中暴露。
type vectorCase struct {
	Name     string `json:"name"`
	Dialect  string `json:"dialect"`
	Input    string `json:"input"`
	Expected struct {
		Statements []struct {
			SQL              string  `json:"sql"`
			ParamCount       int     `json:"paramCount"`
			PlaceholderCount int     `json:"placeholderCount"`
			Mapper           string  `json:"mapper"`
			Time             *string `json:"time"`
			TraceID          string  `json:"traceId"`
			Total            *int    `json:"total"`
			WarningCount     *int    `json:"warningCount"`
		} `json:"statements"`
		WarningCount *int `json:"warningCount"`
	} `json:"expected"`
}

func loadVectors(t *testing.T) []vectorCase {
	t.Helper()
	data, err := os.ReadFile("../testdata/cases.json")
	if err != nil {
		t.Fatalf("读取共享向量失败: %v", err)
	}
	var file struct {
		Cases []vectorCase `json:"cases"`
	}
	if err := json.Unmarshal(data, &file); err != nil {
		t.Fatalf("解析共享向量失败: %v", err)
	}
	if len(file.Cases) == 0 {
		t.Fatal("共享向量为空")
	}
	return file.Cases
}

func TestConvertVectors(t *testing.T) {
	for _, tc := range loadVectors(t) {
		t.Run(tc.Name, func(t *testing.T) {
			dialect, err := ParseDialect(tc.Dialect)
			if err != nil {
				t.Fatalf("向量方言非法: %v", err)
			}
			got := ConvertDialect(tc.Input, dialect)
			if len(got.Statements) != len(tc.Expected.Statements) {
				t.Fatalf("语句数不符：期望 %d 条，实际 %d 条（结果 %+v）", len(tc.Expected.Statements), len(got.Statements), got)
			}
			for i, exp := range tc.Expected.Statements {
				act := got.Statements[i]
				if act.SQL != exp.SQL {
					t.Errorf("sql 不符：\n期望: %q\n实际: %q", exp.SQL, act.SQL)
				}
				if act.ParamCount != exp.ParamCount {
					t.Errorf("paramCount 不符：期望 %d，实际 %d", exp.ParamCount, act.ParamCount)
				}
				if act.PlaceholderCount != exp.PlaceholderCount {
					t.Errorf("placeholderCount 不符：期望 %d，实际 %d", exp.PlaceholderCount, act.PlaceholderCount)
				}
				if exp.Mapper != "" && act.Mapper != exp.Mapper {
					t.Errorf("mapper 不符：期望 %q，实际 %q", exp.Mapper, act.Mapper)
				}
				if exp.Time != nil && act.Time != *exp.Time {
					t.Errorf("time 不符：期望 %q，实际 %q", *exp.Time, act.Time)
				}
				if exp.TraceID != "" && act.TraceID != exp.TraceID {
					t.Errorf("traceId 不符：期望 %q，实际 %q", exp.TraceID, act.TraceID)
				}
				if exp.Total != nil && act.Total != *exp.Total {
					t.Errorf("total 不符：期望 %d，实际 %d", *exp.Total, act.Total)
				}
				if exp.WarningCount != nil && len(act.Warnings) != *exp.WarningCount {
					t.Errorf("语句 warnings 数不符：期望 %d，实际 %d（%v）", *exp.WarningCount, len(act.Warnings), act.Warnings)
				}
			}
			if tc.Expected.WarningCount != nil && len(got.Warnings) != *tc.Expected.WarningCount {
				t.Errorf("整体 warnings 数不符：期望 %d，实际 %d（%v）", *tc.Expected.WarningCount, len(got.Warnings), got.Warnings)
			}
		})
	}
}
