package internal

import (
	"encoding/json"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
)

// Settings 是面板/窗口的界面偏好，持久化在宿主注入的插件数据目录
// （GONAVI_PLUGIN_DATA）下的 settings.json。独立插件窗口通过
// getSettings/saveSettings 命令读写；嵌入式 html 面板没有宿主桥接，
// 读不到这里，只能使用内置默认值。
type Settings struct {
	Language string `json:"language"` // auto 或六语言之一
	Theme    string `json:"theme"`    // auto/light/dark
	Dialect  string `json:"dialect"`  // generic/mysql
}

const settingsFileName = "settings.json"

// 合法取值与前端词典保持一致
var (
	validLanguages = map[string]bool{
		"auto": true, "zh-CN": true, "zh-TW": true,
		"en-US": true, "ja-JP": true, "de-DE": true, "ru-RU": true,
	}
	validThemes   = map[string]bool{"auto": true, "light": true, "dark": true}
	validDialects = map[string]bool{"generic": true, "mysql": true}
)

// DefaultSettings：语言跟随系统、主题跟随系统、通用方言
func DefaultSettings() Settings {
	return Settings{Language: "auto", Theme: "auto", Dialect: "generic"}
}

// NormalizeSettings 把缺失或非法的取值归一到默认值，保证写盘内容可控
func NormalizeSettings(s Settings) Settings {
	out := DefaultSettings()
	if validLanguages[s.Language] {
		out.Language = s.Language
	}
	if validThemes[s.Theme] {
		out.Theme = s.Theme
	}
	if validDialects[s.Dialect] {
		out.Dialect = s.Dialect
	}
	return out
}

// LoadSettings 读取设置；文件不存在按默认值，内容损坏（JSON 解析失败或
// 非法枚举）同样回退默认值——界面偏好损坏不应阻断插件使用。
func LoadSettings(dataRoot string) (Settings, error) {
	data, err := os.ReadFile(filepath.Join(dataRoot, settingsFileName))
	if errors.Is(err, fs.ErrNotExist) {
		return DefaultSettings(), nil
	}
	if err != nil {
		return DefaultSettings(), err
	}
	var s Settings
	if err := json.Unmarshal(data, &s); err != nil {
		return DefaultSettings(), nil
	}
	return NormalizeSettings(s), nil
}

// SaveSettings 原子写入设置：先写同目录临时文件再改名，避免半截文件。
func SaveSettings(dataRoot string, s Settings) error {
	s = NormalizeSettings(s)
	data, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return err
	}
	data = append(data, '\n')
	if err := os.MkdirAll(dataRoot, 0o700); err != nil {
		return err
	}
	tmp := filepath.Join(dataRoot, settingsFileName+".tmp")
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, filepath.Join(dataRoot, settingsFileName))
}
