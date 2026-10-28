package internal

import (
	"encoding/json"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"sync"
)

// Settings 持久化在宿主注入的插件数据目录（GONAVI_PLUGIN_DATA）下。
// 标签页通过 getSettings/saveSettings 命令读写；语言与主题保留兼容字段，始终跟随宿主。
type Settings struct {
	Language string `json:"language"` // 固定 auto，忽略旧手选值
	Theme    string `json:"theme"`    // 固定 auto，忽略旧手选值
	Dialect  string `json:"dialect"`  // generic/mysql
}

const settingsFileName = "settings.json"

var validDialects = map[string]bool{"generic": true, "mysql": true}

// DefaultSettings：语言与主题跟随宿主，默认关闭 MySQL 反斜杠转义
func DefaultSettings() Settings {
	return Settings{Language: "auto", Theme: "auto", Dialect: "generic"}
}

// NormalizeSettings 忽略旧手选语言与主题，只保留合法的 generic/mysql 转义规则。
func NormalizeSettings(s Settings) Settings {
	out := DefaultSettings()
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

// settingsWriteMu 串行化落盘：getSettings/saveSettings 可能被标签页、Agent
// 工具与 CLI 并发调用，固定临时文件会在并发写时互相覆盖或让 rename 失败。
var settingsWriteMu sync.Mutex

// SaveSettings 原子写入设置：唯一临时文件 + fsync + 改名，写入过程串行化，
// 避免并发 save 互相踩踏；失败时清理临时文件。
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
	settingsWriteMu.Lock()
	defer settingsWriteMu.Unlock()
	tmp, err := os.CreateTemp(dataRoot, settingsFileName+".*.tmp")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		os.Remove(tmpName)
		return err
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		os.Remove(tmpName)
		return err
	}
	if err := tmp.Close(); err != nil {
		os.Remove(tmpName)
		return err
	}
	if err := os.Rename(tmpName, filepath.Join(dataRoot, settingsFileName)); err != nil {
		os.Remove(tmpName)
		return err
	}
	return nil
}
