import { NextRequest, NextResponse } from "next/server";
import type { CategoryOption } from "@/lib/types";
import { getCategoryConfig, updateCategoryConfig } from "@/lib/category-config";

export async function GET() {
  return NextResponse.json(await getCategoryConfig());
}

export async function PUT(req: NextRequest) {
  try {
    const body = (await req.json()) as { categories?: CategoryOption[] };
    if (!Array.isArray(body.categories)) {
      return NextResponse.json({ error: "Payload invalido: categories deve ser uma lista." }, { status: 400 });
    }
    const saved = await updateCategoryConfig(body.categories);
    return NextResponse.json(saved);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao salvar configuracoes.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

