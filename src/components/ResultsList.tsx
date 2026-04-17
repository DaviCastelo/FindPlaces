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
  const safeItems = items.filter((item): item is BusinessResult => Boolean(item?.placeId));
  if (loading) return <p>Carregando resultados...</p>;
  if (!safeItems.length) return <p>Nenhuma empresa encontrada ainda.</p>;

  return (
    <div className="result-grid">
      {safeItems.map((item) => (
        <article key={item.placeId} className="card">
          <h3 className="result-title">{item.name}</h3>
          <p className="result-line">
            <strong>Endereco:</strong> {item.address}
          </p>
          <p className="result-line">
            <strong>Telefone:</strong> {item.phone ?? "Nao informado"}
          </p>
          <p className="result-line">
            <strong>WhatsApp:</strong>{" "}
            {item.whatsapp ? (
              <a href={item.whatsapp} target="_blank" rel="noreferrer">
                Abrir conversa
              </a>
            ) : (
              "Nao informado"
            )}
          </p>
          <p className="result-line">
            <strong>E-mail:</strong> {item.email ?? "Nao informado"}
          </p>
          <p className="result-line">
            <strong>Website:</strong>{" "}
            {item.website ? (
              <a href={item.website} target="_blank" rel="noreferrer">
                {item.website}
              </a>
            ) : (
              "Nao informado"
            )}
          </p>
          <p className="result-meta">
            Confianca do contato: <strong>{item.contactConfidence ?? "nao informado"}</strong>
          </p>
          <div className="result-actions">
            {item.mapsUrl ? (
              <a href={item.mapsUrl} target="_blank" rel="noreferrer">
                Ver no Google Maps
              </a>
            ) : null}
            {item.website ? (
              <button
                type="button"
                onClick={() => onEnrich(item)}
                className="btn-secondary"
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
          className="btn-secondary"
        >
          {loadingMore ? "Carregando..." : "Carregar mais resultados"}
        </button>
      ) : null}
    </div>
  );
}
