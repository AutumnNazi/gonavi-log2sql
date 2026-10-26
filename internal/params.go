package internal

import "strings"

// Param 是 Parameters: 行里解析出的单个参数。Type 为短类名或全类名；
// 裸段（无类型标注）Type 为空。Null 表示渲染为 NULL 的空参数。
type Param struct {
	Value string
	Type  string
	Null  bool
}

// ParseParameters 解析 MyBatis 输出的参数列表。
//
// 格式为逗号分隔的 "值(类型)" 序列，但值本身可能含逗号、括号与引号，
// 从左往右按逗号切分必然切错，所以采用从右往左锚定：每个参数的右端必然是
// "(类型)"（类型名只含字母数字._$），参数的左边界是它左边最近的
// 「逗号+空白」分隔符——MyBatis 的分隔逗号后固定跟空格，而值内逗号后紧跟
// 值字符，借此区分。尾部可能跟一个不带类型的裸段（MyBatis 对 null 就输出
// 裸 null）。
func ParseParameters(s string) []Param {
	s = strings.TrimSpace(s)
	if s == "" {
		return nil
	}
	var reversed []Param // 从右往左收集，最后反转

	// 尾部裸段：末字符不是 ')' 时，最后一个 ')' 之后（或整个串）按裸段处理
	end := len(s)
	if s[end-1] != ')' {
		r := strings.LastIndexByte(s, ')')
		if r < 0 {
			if p, ok := bareParam(s); ok {
				reversed = append(reversed, p)
			}
			end = 0
		} else {
			tail := strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(s[r+1:]), ","))
			if p, ok := bareParam(tail); ok {
				reversed = append(reversed, p)
			}
			end = r + 1
		}
	}

	for end > 0 {
		if s[end-1] != ')' {
			// 剩余段以裸参数结尾（如 "1(Long), 2(Long), null"）：先按
			// 「逗号+空格」切出最右的裸段，左边可能还有更多参数
			c := lastSeparator(s[:end])
			var segment string
			if c >= 0 {
				segment = s[c+1 : end]
				if p, ok := bareParam(segment); ok {
					reversed = append(reversed, p)
				}
				end = c
				continue
			}
			if p, ok := bareParam(strings.TrimSpace(s[:end])); ok {
				reversed = append(reversed, p)
			}
			break
		}
		seg := s[:end] // 不变量：seg 以 ')' 结尾
		l := strings.LastIndexByte(seg[:len(seg)-1], '(')
		if l < 0 || !isTypeName(seg[l+1 : len(seg)-1]) {
			// 右端 ')' 属于值的一部分，找不到类型锚点：整段按裸段兜底
			if p, ok := bareParam(strings.TrimSpace(seg)); ok {
				reversed = append(reversed, p)
			}
			break
		}
		c := lastSeparator(seg[:l])
		var value string
		if c >= 0 {
			value = strings.TrimSpace(seg[c+1 : l])
		} else if l > 0 {
			value = strings.TrimSpace(seg[:l])
		}
		reversed = append(reversed, typedParam(value, seg[l+1:len(seg)-1]))
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

// bareParam 解析无类型标注的裸段：精确的 "null" 视为空参数，空串视为
// 多余分隔符直接丢弃，其余按原值保留（渲染时再按内容猜字面量形态）。
func bareParam(v string) (Param, bool) {
	v = strings.TrimSpace(v)
	if v == "" {
		return Param{}, false
	}
	if v == "null" {
		return Param{Null: true}, true
	}
	return Param{Value: v}, true
}

// typedParam 解析 "值(类型)"：MyBatis 对 null 参数输出裸 null，
// 但容忍手工整理后的 "null(类型)" 写法，同样按空参数处理。
func typedParam(value, typ string) Param {
	if value == "null" {
		return Param{Null: true}
	}
	return Param{Value: value, Type: typ}
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
