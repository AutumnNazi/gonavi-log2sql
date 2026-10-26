package internal

import (
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
	// 写入后读回
	want := Settings{Language: "en-US", Theme: "dark", Dialect: "mysql"}
	if err := SaveSettings(dir, want); err != nil {
		t.Fatalf("保存失败: %v", err)
	}
	got, err = LoadSettings(dir)
	if err != nil {
		t.Fatalf("回读失败: %v", err)
	}
	if got != want {
		t.Fatalf("回读不符：期望 %+v，实际 %+v", want, got)
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
	want := Settings{Language: "en-US", Theme: "dark", Dialect: "mysql"}
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
