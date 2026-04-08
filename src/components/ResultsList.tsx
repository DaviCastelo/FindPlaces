"use client";

import type { BusinessResult } from "@/lib/types";

type Props = {
  items: BusinessResult[];
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
  onEnrich: (item: BusinessResult) => void;
};

export function ResultsList({ items, loading, loadingMore, hasMore, onLoadMore, onEnrich }: Readonly<Props>) {
  if (loading) return <p>Carregando resultados...</p>;
  if (!items.length) return <p>Nenhuma empresa encontrada ainda.</p>;

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {items.map((item) => (
        <article key={item.placeId} className="card">
          <h3 style={{ marginTop: 0 }}>{item.name}</h3>
          <p>
            <strong>Endereco:</strong> {item.address}
          </p>
          <p>
            <strong>Telefone:</strong> {item.phone ?? "Nao informado"}
          </p>
          <p>
            <strong>WhatsApp:</strong>{" "}
            {item.whatsapp ? (
              <a href={item.whatsapp} target="_blank" rel="noreferrer">
                Abrir conversa
              </a>
            ) : (
              "Nao informado"
            )}
          </p>
          <p>
            <strong>E-mail:</strong> {item.email ?? "Nao informado"}
          </p>
          <p>
            <strong>Website:</strong>{" "}
            {item.website ? (
              <a href={item.website} target="_blank" rel="noreferrer">
                {item.website}
              </a>
            ) : (
              "Nao informado"
            )}
          </p>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {item.mapsUrl ? (
              <a href={item.mapsUrl} target="_blank" rel="noreferrer">
                Ver no Google Maps
              </a>
            ) : null}
            {item.website ? (
              <button
                type="button"
                onClick={() => onEnrich(item)}
                style={{ border: "1px solid #ccc", padding: "6px 10px", borderRadius: 8, cursor: "pointer" }}
              >
                Tentar encontrar e-mail/telefone no site
              </button>
            ) : null}
          </div>
        </article>
      ))}

      {hasMore ? (
        <button
          type="button"
          onClick={onLoadMore}
          disabled={loadingMore}
          style={{ padding: "10px 14px", borderRadius: 8, border: "1px solid #ccc", cursor: "pointer", background: "#fff" }}
        >
          {loadingMore ? "Carregando..." : "Carregar +50"}
        </button>
      ) : null}
    </div>
  );
}
