package main

import (
	"archive/zip"
	"bytes"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

const maxArchiveBytes = 64 * 1024 * 1024

type archiveBuffer struct{ bytes.Buffer }

func (b *archiveBuffer) Write(p []byte) (int, error) {
	if len(p) > maxArchiveBytes-b.Len() {
		return 0, fmt.Errorf("archive exceeds 64 MiB compressed limit")
	}
	return b.Buffer.Write(p)
}

func createArchive(root, output string, names []string) error {
	var buffer archiveBuffer
	writer := zip.NewWriter(&buffer)
	sort.Strings(names)
	for i, name := range names {
		if name == "." || path.Clean(name) != name || strings.ContainsAny(name, "\\:") || strings.HasPrefix(name, "/") || strings.HasPrefix(name, "../") || (i > 0 && names[i-1] == name) {
			return fmt.Errorf("invalid archive entry: %s", name)
		}
		source := filepath.Join(root, filepath.FromSlash(name))
		stat, err := os.Lstat(source)
		if err != nil {
			return err
		}
		if !stat.Mode().IsRegular() {
			return fmt.Errorf("archive entry must be a regular file: %s", name)
		}
		header := &zip.FileHeader{Name: name, Method: zip.Deflate}
		header.SetModTime(time.Date(1980, 1, 1, 0, 0, 0, 0, time.UTC))
		header.SetMode(0644)
		if strings.HasPrefix(name, "bin/") {
			header.SetMode(0755)
		}
		entry, err := writer.CreateHeader(header)
		if err != nil {
			return err
		}
		file, err := os.Open(source)
		if err != nil {
			return err
		}
		_, copyErr := io.Copy(entry, file)
		closeErr := file.Close()
		if copyErr != nil {
			return copyErr
		}
		if closeErr != nil {
			return closeErr
		}
	}
	if err := writer.Close(); err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(output), 0755); err != nil {
		return err
	}
	file, err := os.OpenFile(output, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0644)
	if err != nil {
		return err
	}
	_, writeErr := file.Write(buffer.Bytes())
	closeErr := file.Close()
	if writeErr != nil {
		return writeErr
	}
	if closeErr != nil {
		return closeErr
	}
	fmt.Printf("archive written: %s (%d bytes)\n", output, buffer.Len())
	return nil
}

func main() {
	if len(os.Args) < 4 {
		fmt.Fprintln(os.Stderr, "usage: archive <package-root> <fresh.zip> <relative-entry>...")
		os.Exit(1)
	}
	if err := createArchive(os.Args[1], os.Args[2], os.Args[3:]); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
