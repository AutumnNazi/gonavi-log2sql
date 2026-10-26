package internal

import "strings"

// Param 是 Parameters: 行里解析出的单个参数。Type 为短类名或全类名；
// 裸段（无类型标注）Type 为空。Null 表示渲染为 NULL 的空参数。
// sep 是该参数前的原始分隔符（如 ", " 或 ",\t"），合并误切参数时按原文还原；
// 首个参数为空串。
type Param struct {
	Value string
	Type  string
	Null  bool
	sep   string
}

// ParseParameters 解析 MyBatis 输出的参数列表。
//
// 格式为逗号分隔的 "值(类型)" 序列，但值本身可能含逗号、括号与引号，
// 从左往右按逗号切分必然切错，所以采用从右往左锚定：每个参数的右端必然是
// "(类型)"（类型名只含字母数字._$），参数的左边界是它左边最近的
// 「逗号+空白」分隔符——MyBatis 的分隔逗号后固定跟一个空格，而值内逗号后
// 紧跟值字符，借此区分。分隔符自身的那个空白会去掉并记入 sep，值内其余
// 空白（含首个参数的前导空格、逗号后跟的制表符）原样保留；尾部可以跟若干
// 不带类型的裸段（MyBatis 对 null 就输出裸 null）。
func ParseParameters(s string) []Param {
	// 只去掉行尾空白与换行（参数块尾部的空行属于日志排版噪声），保留首参数前导空白
	s = strings.TrimRight(s, " \t\r\n")
	if strings.TrimSpace(s) == "" {
		return nil
	}
	var reversed []Param // 从右往左收集，最后反转

	for end := len(s); end > 0; {
		if s[end-1] != ')' {
			// 剩余段以裸参数结尾（可能连续多个 null）：按「逗号+空格」切出最右裸段
			c := lastSeparator(s[:end])
			if c >= 0 {
				if p, ok := bareParam(trimSeparatorSpace(s[c+1:end]), separatorAt(s, c)); ok {
					reversed = append(reversed, p)
				}
				end = c
				continue
			}
			if p, ok := bareParam(strings.TrimSpace(s[:end]), ""); ok {
				reversed = append(reversed, p)
			}
			break
		}
		seg := s[:end] // 不变量：seg 以 ')' 结尾
		l := strings.LastIndexByte(seg[:len(seg)-1], '(')
		if l < 0 || !isTypeName(seg[l+1:len(seg)-1]) {
			// 右端 ')' 属于值的一部分，找不到类型锚点：整段按裸段兜底
			if p, ok := bareParam(strings.TrimSpace(seg), ""); ok {
				reversed = append(reversed, p)
			}
			break
		}
		c := lastSeparator(seg[:l])
		value := seg[:l] // 保真：值尾空白属于值本身，不做 Trim
		sep := ""
		if c >= 0 {
			value = trimSeparatorSpace(seg[c+1 : l])
			sep = separatorAt(seg, c)
		}
		reversed = append(reversed, typedParam(value, seg[l+1:len(seg)-1], sep))
		if c < 0 {
			break
		}
		end = c
	}

	for i, j := 0, len(reversed)-1; i < j; i, j = i+1, j-1 {
		reversed[i], reversed[j] = reversed[j], reversed[i]
	}
	return reversed
}

// lastSeparator 从右往左找第一个「后跟空白的逗号」作为参数左边界。
// 值内逗号后紧跟值字符（a,b,c），分隔逗号后固定是空格（a, b），以此区分；
// 找不到返回 -1，表示当前值一直延伸到段首。
func lastSeparator(v string) int {
	for i := len(v) - 1; i >= 0; i-- {
		if v[i] == ',' && i+1 < len(v) && (v[i+1] == ' ' || v[i+1] == '\t') {
			return i
		}
	}
	return -1
}

// separatorAt 返回逗号位置 c 处的原始分隔符原文（逗号 + 一个空白字符），
// 合并误切参数时按原文还原，不把 tab 之类的空白换成空格。
func separatorAt(s string, c int) string {
	if c < 0 || c+1 >= len(s) {
		return ""
	}
	return s[c : c+2]
}

// trimSeparatorSpace 去掉分隔符自身携带的一个空白字符（MyBatis 用 ", " 连接），
// 其余空白属于值内容，保持原样。
func trimSeparatorSpace(v string) string {
	if strings.HasPrefix(v, " ") || strings.HasPrefix(v, "\t") {
		return v[1:]
	}
	return v
}

// bareParam 解析无类型标注的裸段：精确的 "null" 视为空参数，空串视为
// 多余分隔符直接丢弃，其余按原值保留（渲染时再按内容猜字面量形态）。
func bareParam(v, sep string) (Param, bool) {
	if v == "" {
		return Param{}, false
	}
	if v == "null" {
		return Param{Null: true, sep: sep}, true
	}
	return Param{Value: v, sep: sep}, true
}

// typedParam 保留显式类型与值：MyBatis 对 null 参数输出裸 null（不带类型），
// 带类型的 "null(String)" 是字面字符串，不能当 SQL NULL。
func typedParam(value, typ, sep string) Param {
	return Param{Value: value, Type: typ, sep: sep}
}

// isTypeName：Java 类型名仅含字母数字、下划线、点与 $，且非空
func isTypeName(s string) bool {
	if s == "" {
		return false
	}
	for _, r := range s {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9':
		case r == '_' || r == '.' || r == '$':
		default:
			return false
		}
	}
	return true
}
