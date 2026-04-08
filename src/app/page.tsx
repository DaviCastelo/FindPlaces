"use client";

import { useMemo, useState } from "react";
import { ResultsList } from "@/components/ResultsList";
import { SearchForm } from "@/components/SearchForm";
import type { BusinessResult, SearchResponse } from "@/lib/types";

function mergeUniqueBusinesses(existing: BusinessResult[], incoming: BusinessResult[]): BusinessResult[] {
  const byPlaceId = new Map<string, BusinessResult>();
  for (const item of existing) byPlaceId.set(item.placeId, item);
  for (const item of incoming) {
    const current = byPlaceId.get(item.placeId);
    byPlaceId.set(item.placeId, current ? { ...current, ...item } : item);
  }
  return Array.from(byPlaceId.values());
}

export default function HomePage() {
  const [location, setLocation] = useState("");
  const [category, setCategory] = useState("academia");
  const [items, setItems] = useState<BusinessResult[]>([]);
  const [nextPageToken, setNextPageToken] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasMore = useMemo(() => Boolean(nextPageToken), [nextPageToken]);

  const search = async (pageToken?: string) => {
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

      setItems((prev) => (isPaginating ? mergeUniqueBusinesses(prev, data.results) : data.results));
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
    <main className="container" style={{ display: "grid", gap: 16 }}>
      <h1 style={{ marginBottom: 0 }}>Filtro de empresas locais (Brasil)</h1>
      <p style={{ marginTop: 0 }}>
        Pesquise por bairro/cidade/estado para encontrar contatos de empresas e facilitar sua prospeccao comercial.
      </p>
      <SearchForm
        location={location}
        category={category}
        loading={loading}
        onLocationChange={setLocation}
        onCategoryChange={setCategory}
        onSubmit={() => search()}
      />
      {error ? (
        <div className="card" style={{ borderColor: "#f1a9a9", background: "#fff5f5" }}>
          <strong>Erro:</strong> {error}
        </div>
      ) : null}
      <ResultsList items={items} loading={loading} loadingMore={loadingMore} hasMore={hasMore} onLoadMore={() => search(nextPageToken)} onEnrich={enrich} />
      <p style={{ fontSize: 13, color: "#555" }}>
        Use os dados com responsabilidade e em conformidade com a LGPD e regras de contato comercial.
      </p>
    </main>
  );
}
