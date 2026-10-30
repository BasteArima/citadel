// Package web holds the frontend: the course engine, styles and pages.
// Everything here is embedded into the server binary.
package web

import "embed"

// FS is the frontend file tree.
//
//go:embed course.html login.html catalog.html profile.html review.html admin.html static
var FS embed.FS
