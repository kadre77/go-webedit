// Package web embeds the built Solid app (web/dist) into the Go binary.
// Run `pnpm build` in web/ before `go build`; an empty dist only holds a
// placeholder, so the binary then serves no app.
package web

import (
	"embed"
	"io/fs"
)

//go:embed all:dist
var dist embed.FS

// Dist returns the built app with index.html at its root.
func Dist() fs.FS {
	sub, err := fs.Sub(dist, "dist")
	if err != nil {
		panic(err)
	}
	return sub
}
