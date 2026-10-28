package internal

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"testing"
)

func TestSettingsRoundTrip(t *testing.T) {
	dir := t.TempDir()
	// 文件不存在：默认值
	got, err := LoadSettings(dir)
	if err != nil {
		t.Fatalf("默认读取失败: %v", err)
	}
	if got != DefaultSettings() {
		t.Fatalf("期望默认设置，实际 %+v", got)
	}
	// 旧手选值仍可传入，但保存与回读必须固定跟随宿主。
	want := Settings{Language: "auto", Theme: "auto", Dialect: "mysql"}
	if err := SaveSettings(dir, Settings{Language: "en-US", Theme: "dark", Dialect: "mysql"}); err != nil {
		t.Fatalf("保存失败: %v", err)
	}
	data, err := os.ReadFile(filepath.Join(dir, "settings.json"))
	if err != nil {
		t.Fatal(err)
	}
	var saved Settings
	if err := json.Unmarshal(data, &saved); err != nil {
		t.Fatal(err)
	}
	if saved != want {
		t.Fatalf("保存的旧界面偏好未忽略：期望 %+v，实际 %+v", want, saved)
	}
	got, err = LoadSettings(dir)
	if err != nil {
		t.Fatalf("回读失败: %v", err)
	}
	if got != want {
		t.Fatalf("回读不符：期望 %+v，实际 %+v", want, got)
	}
}

func TestSettingsLegacyPreferencesIgnoredOnLoad(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "settings.json")
	legacy := []byte(`{"language":"en-US","theme":"dark","dialect":"mysql"}`)
	if err := os.WriteFile(path, legacy, 0o600); err != nil {
		t.Fatal(err)
	}
	got, err := LoadSettings(dir)
	if err != nil {
		t.Fatal(err)
	}
	want := Settings{Language: "auto", Theme: "auto", Dialect: "mysql"}
	if got != want {
		t.Fatalf("legacy UI preferences must be ignored: got %+v, want %+v", got, want)
	}
	after, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(after) != string(legacy) {
		t.Fatalf("load must not rewrite legacy settings: %s", after)
	}
}

func TestSettingsNormalize(t *testing.T) {
	// 非法枚举写入后应被归一到默认值
	dir := t.TempDir()
	if err := SaveSettings(dir, Settings{Language: "xx-YY", Theme: "purple", Dialect: "oracle"}); err != nil {
		t.Fatalf("保存失败: %v", err)
	}
	got, err := LoadSettings(dir)
	if err != nil {
		t.Fatalf("回读失败: %v", err)
	}
	if got != DefaultSettings() {
		t.Fatalf("非法值未归一：%+v", got)
	}
}

func TestSettingsCorruptedFile(t *testing.T) {
	// 损坏的 JSON 按默认值处理，不阻断使用
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "settings.json"), []byte("{not json"), 0o600); err != nil {
		t.Fatal(err)
	}
	got, err := LoadSettings(dir)
	if err != nil {
		t.Fatalf("损坏文件不应返回错误: %v", err)
	}
	if got != DefaultSettings() {
		t.Fatalf("损坏文件应回退默认值：%+v", got)
	}
}

func TestSettingsConcurrentSaves(t *testing.T) {
	// 并发保存不能互相踩踏：全部成功，最终文件是某次完整写入
	dir := t.TempDir()
	const writers = 32
	var wg sync.WaitGroup
	errs := make(chan error, writers)
	for i := 0; i < writers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			errs <- SaveSettings(dir, Settings{Language: "en-US", Theme: "dark", Dialect: "mysql"})
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatalf("并发保存失败: %v", err)
		}
	}
	got, err := LoadSettings(dir)
	if err != nil {
		t.Fatalf("回读失败: %v", err)
	}
	// 并发请求同样归一旧手选偏好，完整写入与临时文件断言保留。
	want := Settings{Language: "auto", Theme: "auto", Dialect: "mysql"}
	if got != want {
		t.Fatalf("并发写入后内容不完整：%+v", got)
	}
	// 临时文件必须清理干净
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range entries {
		if entry.Name() != "settings.json" {
			t.Fatalf("残留临时文件: %s", entry.Name())
		}
	}
}
