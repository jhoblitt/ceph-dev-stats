package rollup

import (
	"bytes"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
)

var (
	// ownName matches the names Build gives its files.
	ownName = regexp.MustCompile(`^(?:meta|(?:prs|events|table)-\d+)\.json$`)
	// ownTemp matches the temporary files writeIfChanged creates, which a
	// run that died can leave behind.
	ownTemp = regexp.MustCompile(`^\.(?:meta|(?:prs|events|table)-\d+)\.json\.\d+\.tmp$`)
)

// Result names the files Write wrote and removed.
type Result struct {
	// Written is in the order the files were given.
	Written []string
	// Removed is in name order.
	Removed []string
}

// Write writes files into dir, creating it, and rewrites only the files
// whose bytes change. It removes every file in dir named as the rollup
// names its files that files does not hold, such as a year that no longer
// has records, and leaves every other file alone.
func Write(dir string, files []File) (Result, error) {
	var res Result
	keep := map[string]bool{}
	for _, f := range files {
		if !ownName.MatchString(f.Name) {
			return res, fmt.Errorf("%q is not the name of a site data file", f.Name)
		}
		keep[f.Name] = true
	}
	if err := os.MkdirAll(dir, 0o750); err != nil {
		return res, fmt.Errorf("creating %s: %w", dir, err)
	}
	for _, f := range files {
		changed, err := writeIfChanged(filepath.Join(dir, f.Name), f.Data)
		if err != nil {
			return res, err
		}
		if changed {
			res.Written = append(res.Written, f.Name)
		}
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return res, fmt.Errorf("listing %s: %w", dir, err)
	}
	for _, e := range entries {
		name := e.Name()
		if keep[name] || !e.Type().IsRegular() || !ownName.MatchString(name) && !ownTemp.MatchString(name) {
			continue
		}
		if err := os.Remove(filepath.Join(dir, name)); err != nil {
			return res, fmt.Errorf("removing %s: %w", filepath.Join(dir, name), err)
		}
		res.Removed = append(res.Removed, name)
	}
	return res, nil
}

// writeIfChanged replaces path with b through a temporary file and a
// rename, so a reader never sees a partial file, unless path already holds
// b.
func writeIfChanged(path string, b []byte) (bool, error) {
	old, err := os.ReadFile(path) //nolint:gosec // the output directory is the operator's to name
	switch {
	case err == nil && bytes.Equal(old, b):
		return false, nil
	case err != nil && !errors.Is(err, fs.ErrNotExist):
		return false, fmt.Errorf("reading %s: %w", path, err)
	}
	tmp, err := os.CreateTemp(filepath.Dir(path), "."+filepath.Base(path)+".*.tmp")
	if err != nil {
		return false, fmt.Errorf("writing %s: %w", path, err)
	}
	if err = replace(tmp, b, path); err != nil {
		return false, fmt.Errorf("writing %s: %w", path, errors.Join(err, os.Remove(tmp.Name())))
	}
	return true, nil
}

func replace(tmp *os.File, b []byte, path string) error {
	if _, err := tmp.Write(b); err != nil {
		return errors.Join(err, tmp.Close())
	}
	if err := tmp.Sync(); err != nil {
		return errors.Join(err, tmp.Close())
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), path)
}
