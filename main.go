// log2sql：GoNavi 插件，把 MyBatis 的 Preparing/Parameters DEBUG 日志
// 还原成可直接执行的 SQL。convert 命令是纯函数，无副作用，供 Agent 工具
// 与 CLI 调用；主窗口里的 HTML 面板自带同一套引擎的前端实现。
package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/signal"
	"strings"

	plugin "github.com/Syngnat/GoNavi/sdk/go"

	"github.com/AutumnNazi/gonavi-log2sql/internal"
)

// 输入日志上限：与清单 inputSchema 的 maxLength=65536 同为字符数语义；
// 恶意超大输入仍由协议帧默认 1 MiB 上限兜底。
const maxLogChars = 65536

// 宿主为插件子进程注入的可变数据目录（remove --purge 才会删除）
const pluginDataEnv = "GONAVI_PLUGIN_DATA"

func main() {
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt)
	defer cancel()
	server := plugin.NewServer(plugin.Options{
		Handlers: map[string]plugin.Handler{
			"convert":      convert,
			"getSettings":  getSettings,
			"saveSettings": saveSettings,
		},
		OnLifecycle: onRunning,
	})
	if err := server.ServeStdio(ctx); err != nil && !errors.Is(err, context.Canceled) {
		if _, writeErr := fmt.Fprintln(os.Stderr, "log2sql plugin stopped:", err); writeErr != nil {
			os.Exit(2)
		}
		os.Exit(1)
	}
}

// onRunning 在宿主确认 running 事件后写一条有界诊断日志，
// 便于在宿主日志里确认插件确实启动过。
func onRunning(ctx context.Context, event string, generation uint64) {
	if event != "running" || generation == 0 {
		return
	}
	if host, ok := plugin.HostFromContext(ctx); ok {
		_ = host.Log(ctx, "info", "gh-autumnnazi.log2sql running")
	}
}

func convert(ctx context.Context, raw json.RawMessage) (any, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	var args struct {
		Log     string `json:"log"`
		Dialect string `json:"dialect"`
	}
	if err := json.Unmarshal(raw, &args); err != nil {
		return nil, &plugin.Error{Code: -32602, Message: "arguments must be an object with a log string"}
	}
	if args.Log == "" {
		return nil, &plugin.Error{Code: -32602, Message: "log must not be empty"}
	}
	// 按 Unicode 码点计数，与 inputSchema 的 maxLength 字符语义一致
	if len([]rune(args.Log)) > maxLogChars {
		return nil, &plugin.Error{Code: -32602, Message: "log exceeds the 65536-character limit"}
	}
	// generic 为通用回填；mysql 额外支持字符串字面量的反斜杠转义
	dialect, err := internal.ParseDialect(args.Dialect)
	if err != nil {
		return nil, &plugin.Error{Code: -32602, Message: err.Error()}
	}
	return internal.ConvertDialect(args.Log, dialect), nil
}

// getSettings 读取面板/窗口偏好；文件缺失或损坏时返回默认值，不阻断使用。
func getSettings(ctx context.Context, raw json.RawMessage) (any, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	root, err := pluginDataRoot()
	if err != nil {
		return nil, err
	}
	settings, _ := internal.LoadSettings(root)
	return settings, nil
}

// saveSettings 原子写入偏好；非法取值由引擎归一为默认值后落盘。
func saveSettings(ctx context.Context, raw json.RawMessage) (any, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	var settings internal.Settings
	if err := json.Unmarshal(raw, &settings); err != nil {
		return nil, &plugin.Error{Code: -32602, Message: "arguments must be an object with language, theme and dialect"}
	}
	root, err := pluginDataRoot()
	if err != nil {
		return nil, err
	}
	if err := internal.SaveSettings(root, settings); err != nil {
		return nil, &plugin.Error{Code: -32603, Message: "failed to persist settings"}
	}
	return map[string]bool{"saved": true}, nil
}

// pluginDataRoot：宿主注入的插件数据目录；缺失时拒绝读写而不是悄悄写错位置
func pluginDataRoot() (string, error) {
	root := strings.TrimSpace(os.Getenv(pluginDataEnv))
	if root == "" {
		return "", &plugin.Error{Code: -32603, Message: "plugin data directory is unavailable"}
	}
	return root, nil
}
