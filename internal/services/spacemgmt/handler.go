// Copyright (c) 2025-2026, s0up and the autobrr contributors.
// SPDX-License-Identifier: GPL-2.0-or-later

package spacemgmt

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/rs/zerolog/log"
)

// Handler serves /api/space/*.
type Handler struct {
	service *Service
}

// NewHandler returns the HTTP handler for the service.
func NewHandler(service *Service) *Handler {
	return &Handler{service: service}
}

// Routes registers the routes under the /space mount.
func (h *Handler) Routes(r chi.Router) {
	r.Get("/overview", h.overview)
	r.Get("/tree", h.tree)
	r.Post("/delete", h.delete)
}

type errorResponse struct {
	Error string `json:"error"`
}

func (h *Handler) overview(w http.ResponseWriter, r *http.Request) {
	overview, err := h.service.Overview(r.Context())
	if err != nil {
		respondBuildError(w, r, err)
		return
	}
	respond(w, http.StatusOK, overview)
}

func (h *Handler) tree(w http.ResponseWriter, r *http.Request) {
	refresh := false
	if v := r.URL.Query().Get("refresh"); v != "" {
		parsed, err := strconv.ParseBool(v)
		if err != nil {
			respond(w, http.StatusBadRequest, errorResponse{Error: "refresh must be a boolean"})
			return
		}
		refresh = parsed
	}
	tree, err := h.service.Tree(r.Context(), refresh)
	if err != nil {
		respondBuildError(w, r, err)
		return
	}
	respond(w, http.StatusOK, tree)
}

func (h *Handler) delete(w http.ResponseWriter, r *http.Request) {
	var req DeleteRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respond(w, http.StatusBadRequest, errorResponse{Error: "invalid request body"})
		return
	}
	resp, err := h.service.Delete(r.Context(), req)
	if errors.Is(err, ErrUnknownNode) {
		respond(w, http.StatusBadRequest, errorResponse{Error: err.Error()})
		return
	}
	if err != nil {
		respondBuildError(w, r, err)
		return
	}
	respond(w, http.StatusOK, resp)
}

func respondBuildError(w http.ResponseWriter, r *http.Request, err error) {
	if r.Context().Err() != nil {
		return
	}
	log.Error().Err(err).Msg("space management request failed")
	respond(w, http.StatusBadGateway, errorResponse{Error: err.Error()})
}

func respond(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(body); err != nil {
		log.Debug().Err(err).Msg("space management: encode response")
	}
}
