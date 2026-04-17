"use client";

import type { CategoryOption } from "@/lib/types";

type Props = {
  location: string;
  category: string;
  categories: CategoryOption[];
  loading: boolean;
  onLocationChange: (value: string) => void;
  onCategoryChange: (value: string) => void;
  onSubmit: () => void;
};

export function SearchForm(props: Readonly<Props>) {
  const handleSubmit = (event: { preventDefault: () => void }) => {
    event.preventDefault();
    props.onSubmit();
  };

  return (
    <form className="card" onSubmit={handleSubmit} style={{ display: "grid", gap: 14 }}>
      <h2 style={{ margin: 0 }}>Buscar contatos comerciais</h2>
      <label className="field">
        <span className="field-label">Localizacao (bairro, cidade, estado)</span>
        <input
          value={props.location}
          onChange={(e) => props.onLocationChange(e.target.value)}
          placeholder="Ex: Savassi, Belo Horizonte - MG"
          className="field-input"
          required
        />
      </label>

      <label className="field">
        <span className="field-label">Categoria</span>
        <select
          value={props.category}
          onChange={(e) => props.onCategoryChange(e.target.value)}
          className="field-input"
        >
          {props.categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.label}
            </option>
          ))}
        </select>
      </label>

      <button
        type="submit"
        disabled={props.loading}
        className="btn-primary"
      >
        {props.loading ? "Buscando..." : "Buscar empresas"}
      </button>
    </form>
  );
}
