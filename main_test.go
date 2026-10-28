package main

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"

	plugin "github.com/Syngnat/GoNavi/sdk/go"
)

func TestGetSettingsReadFailure(t *testing.T) {
	root := t.TempDir()
	t.Setenv(pluginDataEnv, root)
	if err := os.Mkdir(filepath.Join(root, "settings.json"), 0o700); err != nil {
		t.Fatal(err)
	}

	result, err := getSettings(context.Background(), json.RawMessage(`{}`))
	if result != nil {
		t.Fatalf("getSettings returned normal settings for directory I/O failure: %#v", result)
	}
	var rpcErr *plugin.Error
	if !errors.As(err, &rpcErr) {
		t.Fatalf("error type = %T, want *plugin.Error", err)
	}
	if rpcErr.Code != -32603 || rpcErr.Message != "failed to read settings" {
		t.Fatalf("RPC error = %#v, want fixed -32603 read failure", rpcErr)
	}
	data, err := json.Marshal(rpcErr)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != `{"code":-32603,"message":"failed to read settings"}` {
		t.Fatalf("error JSON = %s, want bounded code and message without data", data)
	}
}
func TestGetSettingsFallbacks(t *testing.T) {
	for _, tc := range []struct {
		name    string
		content string
		dialect string
	}{
		{name: "missing", dialect: "generic"},
		{name: "corrupt", content: `{"dialect":`, dialect: "generic"},
		{name: "invalid enums", content: `{"language":"invalid","theme":"invalid","dialect":"invalid"}`, dialect: "generic"},
		{name: "invalid schema", content: `{"dialect":42}`, dialect: "generic"},
		{name: "legacy mysql", content: `{"language":"zh-CN","theme":"dark","dialect":"mysql"}`, dialect: "mysql"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			root := t.TempDir()
			t.Setenv(pluginDataEnv, root)
			if tc.content != "" {
				if err := os.WriteFile(filepath.Join(root, "settings.json"), []byte(tc.content), 0o600); err != nil {
					t.Fatal(err)
				}
			}
			result, err := getSettings(context.Background(), json.RawMessage(`{}`))
			if err != nil {
				t.Fatalf("getSettings failed: %T", err)
			}
			data, err := json.Marshal(result)
			if err != nil {
				t.Fatal(err)
			}
			want := `{"language":"auto","theme":"auto","dialect":"` + tc.dialect + `"}`
			if string(data) != want {
				t.Fatalf("settings JSON = %s, want %s", data, want)
			}
		})
	}
}

func TestSettingsHandlersRejectUnavailableRoot(t *testing.T) {
	for _, handler := range []plugin.Handler{getSettings, saveSettings} {
		for _, root := range []string{"", " \t\r\n "} {
			t.Setenv(pluginDataEnv, root)
			result, err := handler(context.Background(), json.RawMessage(`{}`))
			var rpcErr *plugin.Error
			if result != nil || !errors.As(err, &rpcErr) {
				t.Fatalf("result = %#v, error type = %T, want nil and *plugin.Error", result, err)
			}
			if rpcErr.Code != -32603 || rpcErr.Message != "plugin data directory is unavailable" {
				t.Fatalf("RPC error = %#v, want unavailable data directory", rpcErr)
			}
		}
	}
}

func TestSettingsHandlersCanceled(t *testing.T) {
	t.Setenv(pluginDataEnv, "")
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	for _, handler := range []plugin.Handler{getSettings, saveSettings} {
		result, err := handler(ctx, json.RawMessage(`not JSON`))
		if result != nil || !errors.Is(err, context.Canceled) {
			t.Fatalf("result = %#v, error type = %T, want nil and context.Canceled", result, err)
		}
	}
}

func TestSaveSettingsInvalidArguments(t *testing.T) {
	t.Setenv(pluginDataEnv, t.TempDir())
	for _, raw := range []string{`not JSON`, `[]`, `{"dialect":42}`} {
		result, err := saveSettings(context.Background(), json.RawMessage(raw))
		var rpcErr *plugin.Error
		if result != nil || !errors.As(err, &rpcErr) || rpcErr.Code != -32602 {
			t.Fatalf("result = %#v, error type = %T, want nil and -32602", result, err)
		}
	}
}
