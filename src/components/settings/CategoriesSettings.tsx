"use client";

import { useEffect, useMemo, useState } from "react";
import type { CategoryOption, CategoryConfigResponse } from "@/lib/types";

type Props = {
  categories: CategoryOption[];
  onSaved: (data: CategoryConfigResponse) => void;
};

export function CategoriesSettings(props: Readonly<Props>) {
  const [draft, setDraft] = useState<CategoryOption[]>(props.categories);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const enabledCount = useMemo(() => draft.filter((item) => item.enabled).length, [draft]);

  useEffect(() => {
    setDraft(props.categories);
  }, [props.categories]);

  const toggleCategory = (id: string) => {
    setSuccess(null);
    setDraft((prev) =>
      prev.map((item) =>
        item.id === id
          ? {
              ...item,
              enabled: !item.enabled,
            }
          : item,
      ),
    );
  };

  const save = async () => {
    setError(null);
    setSuccess(null);
    setSaving(true);
    try {
      const response = await fetch("/api/settings/categories", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categories: draft }),
      });
      const data = (await response.json()) as CategoryConfigResponse & { error?: string };
      if (!response.ok) {
        throw new Error(data.error ?? "Falha ao salvar configuracoes.");
      }
      setDraft(data.categories);
      props.onSaved(data);
      setSuccess("Configuracoes salvas com sucesso.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha inesperada.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="card settings-card">
      <h2 style={{ marginTop: 0 }}>Configuracoes de categorias</h2>
      <p className="settings-subtitle">
        Escolha quais categorias aparecem no filtro de busca. Habilitadas: <strong>{enabledCount}</strong>
      </p>

      <div className="settings-grid">
        {draft.map((category) => (
          <label key={category.id} className={`settings-toggle ${category.enabled ? "enabled" : ""}`}>
            <span>{category.label}</span>
            <input
              type="checkbox"
              checked={category.enabled}
              onChange={() => toggleCategory(category.id)}
            />
          </label>
        ))}
      </div>

      {error ? <p className="settings-error">{error}</p> : null}
      {success ? <p className="settings-success">{success}</p> : null}

      <div className="settings-actions">
        <button type="button" className="btn-primary" onClick={save} disabled={saving}>
          {saving ? "Salvando..." : "Salvar configuracoes"}
        </button>
      </div>
    </section>
  );
}

