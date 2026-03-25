package api

import (
	"embed"
	"io/fs"
	"net/http"
)

//go:embed ui/*
var uiFiles embed.FS

func registerUIRoutes(mux *http.ServeMux) {
	sub, err := fs.Sub(uiFiles, "ui")
	if err != nil {
		return
	}

	fileServer := http.FileServer(http.FS(sub))
	mux.Handle("GET /ui.js", fileServer)
	mux.HandleFunc("GET /", func(w http.ResponseWriter, r *http.Request) {
		http.ServeFileFS(w, r, sub, "launch.html")
	})
	mux.HandleFunc("GET /launch", func(w http.ResponseWriter, r *http.Request) {
		http.ServeFileFS(w, r, sub, "launch.html")
	})
	mux.HandleFunc("GET /planner", func(w http.ResponseWriter, r *http.Request) {
		http.ServeFileFS(w, r, sub, "index.html")
	})
}
