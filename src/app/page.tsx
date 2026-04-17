"use client";

import { useEffect, useMemo, useState } from "react";
import { Sidebar } from "@/components/layout/Sidebar";
import { ResultsList } from "@/components/ResultsList";
import { SearchForm } from "@/components/SearchForm";
import { CategoriesSettings } from "@/components/settings/CategoriesSettings";
import type { BusinessResult, CategoryConfigResponse, CategoryOption, SearchResponse } from "@/lib/types";

function isValidBusiness(item: BusinessResult | null | undefined): item is BusinessResult {
  return Boolean(item && typeof item.placeId === "string" && item.placeId.trim());
}

function mergeUniqueBusinesses(existing: BusinessResult[], incoming: BusinessResult[]): BusinessResult[] {
  const byPlaceId = new Map<string, BusinessResult>();
  for (const item of existing) {
    if (!isValidBusiness(item)) continue;
    byPlaceId.set(item.placeId, item);
  }
  for (const item of incoming) {
    if (!isValidBusiness(item)) continue;
    const current = byPlaceId.get(item.placeId);
    byPlaceId.set(item.placeId, current ? { ...current, ...item } : item);
  }
  return Array.from(byPlaceId.values());
}

export default function HomePage() {
  const [location, setLocation] = useState("");
  const [category, setCategory] = useState("");
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [activeView, setActiveView] = useState<"search" | "settings">("search");
  const [items, setItems] = useState<BusinessResult[]>([]);
  const [nextPageToken, setNextPageToken] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingCategories, setLoadingCategories] = useState(true);

  const hasMore = useMemo(() => Boolean(nextPageToken), [nextPageToken]);
  const enabledCategories = useMemo(() => categories.filter((item) => item.enabled), [categories]);

  useEffect(() => {
    const fetchCategories = async () => {
      setLoadingCategories(true);
      try {
        const response = await fetch("/api/settings/categories");
        const data = (await response.json()) as CategoryConfigResponse & { error?: string };
        if (!response.ok) throw new Error(data.error ?? "Falha ao carregar categorias.");
        setCategories(data.categories);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Falha ao carregar categorias.");
      } finally {
        setLoadingCategories(false);
      }
    };
    fetchCategories();
  }, []);

  useEffect(() => {
    if (!enabledCategories.length) return;
    const categoryStillEnabled = enabledCategories.some((item) => item.id === category);
    if (!categoryStillEnabled) {
      setCategory(enabledCategories[0].id);
      setItems([]);
      setNextPageToken(undefined);
    }
  }, [enabledCategories, category]);

  const search = async (pageToken?: string) => {
    if (!category) return;
    const isPaginating = Boolean(pageToken);
    if (isPaginating) {
      setLoadingMore(true);
    } else {
      setLoading(true);
    }
    setError(null);

    try {
      const response = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ location, category, pageToken }),
      });

      const data = (await response.json()) as SearchResponse & { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Erro ao buscar empresas.");
      const safeResults = (data.results ?? []).filter(isValidBusiness);

      setItems((prev) => (isPaginating ? mergeUniqueBusinesses(prev, safeResults) : safeResults));
      setNextPageToken(data.nextPageToken);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha inesperada.");
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  const enrich = async (item: BusinessResult) => {
    if (!item.website) return;
    try {
      const response = await fetch("/api/scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ website: item.website }),
      });
      const data = (await response.json()) as {
        email?: string;
        phone?: string;
        whatsapp?: string;
        error?: string;
      };
      if (!response.ok) throw new Error(data.error ?? "Nao foi possivel extrair contatos.");

      setItems((prev) =>
        prev.map((current) =>
          current.placeId === item.placeId
            ? {
                ...current,
                email: current.email ?? data.email,
                phone: current.phone ?? data.phone,
                whatsapp: current.whatsapp ?? data.whatsapp,
              }
            : current,
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao enriquecer contato.");
    }
  };

  return (
    <div className="app-shell">
      <div className="dashboard-layout">
        <Sidebar
          isCollapsed={isCollapsed}
          activeView={activeView}
          onSelectView={setActiveView}
          onToggleCollapse={() => setIsCollapsed((prev) => !prev)}
        />

        <main className="main-content">
          <header className="topbar">
            <div className="topbar-content">
              <div className="brand">
                <img src="/logo.png" alt="FindPlaces" className="brand-logo" />
              </div>
              <span style={{ color: "var(--text-soft)", fontSize: 13 }}>Encontre dados. Descubra lugares.</span>
            </div>
          </header>

          <section className="container" style={{ display: "grid", gap: 16 }}>
            {activeView === "search" ? (
              <>
                <div>
                  <h1 className="page-title">Filtro de empresas locais (Brasil)</h1>
                  <p className="page-subtitle">
                    Pesquise por bairro/cidade/estado para encontrar contatos de empresas e facilitar sua prospeccao comercial.
                  </p>
                </div>

                <section className="stats-grid">
                  <article className="stat-card">
                    <span>Resultados</span>
                    <strong>{items.length}</strong>
                  </article>
                  <article className="stat-card">
                    <span>Categoria</span>
                    <strong style={{ textTransform: "capitalize" }}>{category || "-"}</strong>
                  </article>
                  <article className="stat-card">
                    <span>Status</span>
                    <strong>{loading || loadingMore ? "Buscando..." : "Pronto"}</strong>
                  </article>
                  <article className="stat-card">
                    <span>Pagina</span>
                    <strong>{hasMore ? "Com mais resultados" : "Final"}</strong>
                  </article>
                </section>

                {loadingCategories ? (
                  <div className="card">Carregando categorias...</div>
                ) : (
                  <SearchForm
                    location={location}
                    category={category}
                    categories={enabledCategories}
                    loading={loading}
                    onLocationChange={setLocation}
                    onCategoryChange={setCategory}
                    onSubmit={() => search()}
                  />
                )}

                {error ? (
                  <div className="card error-card">
                    <strong>Erro:</strong> {error}
                  </div>
                ) : null}
                <ResultsList
                  items={items}
                  loading={loading}
                  loadingMore={loadingMore}
                  hasMore={hasMore}
                  onLoadMore={() => search(nextPageToken)}
                  onEnrich={enrich}
                />
                <p style={{ fontSize: 13, color: "#555" }}>
                  Use os dados com responsabilidade e em conformidade com a LGPD e regras de contato comercial.
                </p>
              </>
            ) : (
              <>
                <div>
                  <h1 className="page-title">Configuracoes</h1>
                  <p className="page-subtitle">Controle quais categorias ficam disponiveis para busca no app.</p>
                </div>
                {loadingCategories ? (
                  <div className="card">Carregando configuracoes...</div>
                ) : (
                  <CategoriesSettings
                    categories={categories}
                    onSaved={(data) => {
                      setCategories(data.categories);
                      setActiveView("search");
                    }}
                  />
                )}
              </>
            )}
          </section>
        </main>
      </div>
    </div>
  );
}
