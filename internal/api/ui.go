package api

import (
	"embed"
	"io/fs"
	"net/http"
	"strings"
)

//go:embed ui/*
var uiFiles embed.FS

func registerUIRoutes(mux *http.ServeMux) {
	sub, err := fs.Sub(uiFiles, "ui")
	if err != nil {
		return
	}

	fileServer := http.FileServer(http.FS(sub))

	// Serve the React SPA: static assets are served directly,
	// all other routes fall back to index.html for client-side routing.
	mux.HandleFunc("GET /", func(w http.ResponseWriter, r *http.Request) {
		path := strings.TrimPrefix(r.URL.Path, "/")
		if path == "" {
			http.ServeFileFS(w, r, sub, "index.html")
			return
		}
		// Try serving as a static file first
		if f, err := sub.Open(path); err == nil {
			f.Close()
			fileServer.ServeHTTP(w, r)
			return
		}
		// Fall back to index.html for SPA routes
		http.ServeFileFS(w, r, sub, "index.html")
	})
}
