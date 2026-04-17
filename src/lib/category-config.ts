import type { CategoryConfigResponse, CategoryOption } from "@/lib/types";
import { readState, writeState } from "@/lib/storage";

const defaultCategoryCatalog: Array<{ id: string; label: string }> = [
  { id: "academia", label: "Academia" },
  { id: "padaria", label: "Padaria" },
  { id: "lanchonete", label: "Lanchonete" },
  { id: "restaurante", label: "Restaurante" },
  { id: "mercado", label: "Mercado" },
  { id: "farmacia", label: "Farmacia" },
  { id: "salão de beleza", label: "Salao de beleza" },
  { id: "bar", label: "Bar" },
  { id: "pizzaria", label: "Pizzaria" },
  { id: "hotel", label: "Hotel" },
  { id: "pousada", label: "Pousada" },
  { id: "oficina mecânica", label: "Oficina mecanica" },
  { id: "autopeças", label: "Autopecas" },
  { id: "clínica odontológica", label: "Clinica odontologica" },
  { id: "clínica médica", label: "Clinica medica" },
  { id: "laboratório", label: "Laboratorio" },
  { id: "pet shop", label: "Pet shop" },
  { id: "veterinário", label: "Veterinario" },
  { id: "loja de roupas", label: "Loja de roupas" },
  { id: "loja de móveis", label: "Loja de moveis" },
  { id: "papelaria", label: "Papelaria" },
  { id: "livraria", label: "Livraria" },
  { id: "eletrônicos", label: "Eletronicos" },
  { id: "escola", label: "Escola" },
  { id: "creche", label: "Creche" },
  { id: "curso de idiomas", label: "Curso de idiomas" },
  { id: "material de construção", label: "Material de construcao" },
];

let categoryConfigState: CategoryConfigResponse = {
  categories: defaultCategoryCatalog.map((category) => ({
    ...category,
    enabled: true,
  })),
  updatedAt: new Date().toISOString(),
};
let categoryConfigLoaded = false;

function normalized(value: string): string {
  return value.trim().toLowerCase();
}

async function ensureCategoryConfigLoaded(): Promise<void> {
  if (categoryConfigLoaded) return;
  const persisted = await readState<CategoryOption[]>("settings", "categories");
  if (persisted?.value?.length) {
    const byId = new Map(persisted.value.map((item) => [normalized(item.id), item]));
    categoryConfigState = {
      categories: defaultCategoryCatalog.map((base) => {
        const override = byId.get(normalized(base.id));
        return {
          id: base.id,
          label: base.label,
          enabled: override ? Boolean(override.enabled) : true,
        };
      }),
      updatedAt: persisted.updatedAt,
    };
  }
  categoryConfigLoaded = true;
}

export async function getCategoryConfig(): Promise<CategoryConfigResponse> {
  await ensureCategoryConfigLoaded();
  return {
    categories: categoryConfigState.categories.map((category) => ({ ...category })),
    updatedAt: categoryConfigState.updatedAt,
  };
}

export async function updateCategoryConfig(input: CategoryOption[]): Promise<CategoryConfigResponse> {
  await ensureCategoryConfigLoaded();
  const byId = new Map(input.map((item) => [normalized(item.id), item]));
  const categories = defaultCategoryCatalog.map((base) => {
    const override = byId.get(normalized(base.id));
    return {
      id: base.id,
      label: base.label,
      enabled: override ? Boolean(override.enabled) : true,
    };
  });
  if (!categories.some((category) => category.enabled)) {
    throw new Error("Selecione ao menos uma categoria habilitada.");
  }
  categoryConfigState = {
    categories,
    updatedAt: await writeState("settings", "categories", categories),
  };
  return getCategoryConfig();
}

export async function getEnabledCategoryIds(): Promise<string[]> {
  await ensureCategoryConfigLoaded();
  return categoryConfigState.categories
    .filter((category) => category.enabled)
    .map((category) => normalized(category.id));
}

