"use client";

type Props = {
  location: string;
  category: string;
  loading: boolean;
  onLocationChange: (value: string) => void;
  onCategoryChange: (value: string) => void;
  onSubmit: () => void;
};

const categories = ["academia", "padaria", "lanchonete", "restaurante", "mercado", "farmacia", "salão de beleza"];

export function SearchForm(props: Readonly<Props>) {
  const handleSubmit = (event: { preventDefault: () => void }) => {
    event.preventDefault();
    props.onSubmit();
  };

  return (
    <form className="card" onSubmit={handleSubmit} style={{ display: "grid", gap: 12 }}>
      <h2 style={{ margin: 0 }}>Buscar contatos comerciais</h2>
      <label style={{ display: "grid", gap: 6 }}>
        <span>Localizacao (bairro, cidade, estado)</span>
        <input
          value={props.location}
          onChange={(e) => props.onLocationChange(e.target.value)}
          placeholder="Ex: Savassi, Belo Horizonte - MG"
          style={{ padding: 10, borderRadius: 8, border: "1px solid #ccc" }}
          required
        />
      </label>

      <label style={{ display: "grid", gap: 6 }}>
        <span>Categoria</span>
        <select
          value={props.category}
          onChange={(e) => props.onCategoryChange(e.target.value)}
          style={{ padding: 10, borderRadius: 8, border: "1px solid #ccc" }}
        >
          {categories.map((category) => (
            <option key={category} value={category}>
              {category}
            </option>
          ))}
        </select>
      </label>

      <button
        type="submit"
        disabled={props.loading}
        style={{ padding: "10px 14px", borderRadius: 8, border: "none", background: "#111827", color: "#fff", cursor: "pointer" }}
      >
        {props.loading ? "Buscando..." : "Buscar empresas"}
      </button>
    </form>
  );
}
