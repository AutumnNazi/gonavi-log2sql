package internal

import (
	"regexp"
	"strings"
)

// 数字类型渲染为裸值（不加引号）；java.lang./java.math. 前缀取短名后判断。
var numericTypes = map[string]bool{
	"Long": true, "Integer": true, "Short": true, "Byte": true,
	"Double": true, "Float": true, "BigDecimal": true, "BigInteger": true, "Number": true,
}

// 裸段（无类型标注）里数字形态的值按裸值渲染，兼容手工粘贴丢失类型标注的情况
var bareNumberPattern = regexp.MustCompile(`^-?\d+(?:\.\d+)?$`)

// RenderValue 把单个参数渲染为 SQL 字面量：
// 空参数输出 NULL；数字/布尔输出裸值；其余（字符串、日期时间、未知类型）
// 输出单引号字符串并按 SQL 惯例把内部单引号双写转义。
// mysql 方言下反斜杠是 MySQL 字符串转义符：必须把 \ 双写，否则参数值末尾的
// 反斜杠会转义闭合引号、改变 SQL 结构（generic/标准 SQL 里反斜杠是普通字符）。
func RenderValue(p Param, dialect Dialect) string {
	if p.Null {
		return "NULL"
	}
	if p.Type != "" {
		short := shortTypeName(p.Type)
		switch {
		case short == "Boolean":
			return p.Value
		case numericTypes[short]:
			return p.Value
		}
		return "'" + escapeSQLString(p.Value, dialect) + "'"
	}
	// 裸段：按内容猜形态，宁可少猜也不把数字变成字符串
	if bareNumberPattern.MatchString(p.Value) || p.Value == "true" || p.Value == "false" {
		return p.Value
	}
	return "'" + escapeSQLString(p.Value, dialect) + "'"
}

// shortTypeName 取全类名的最后一段：java.lang.Long -> Long
func shortTypeName(full string) string {
	if idx := strings.LastIndexByte(full, '.'); idx >= 0 {
		return full[idx+1:]
	}
	return full
}

// escapeSQLString：单引号双写（MySQL/PostgreSQL/Oracle 通用）；
// mysql 方言先把反斜杠双写，避免 \' 逃逸闭合引号或 \t 之类的转义改写值。
func escapeSQLString(v string, dialect Dialect) string {
	if dialect == DialectMySQL {
		v = strings.ReplaceAll(v, "\\", "\\\\")
	}
	return strings.ReplaceAll(v, "'", "''")
}
