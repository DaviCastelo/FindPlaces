import { NextResponse } from "next/server";
import { bumpCacheVersion } from "@/lib/query-cache";

export async function POST() {
  const version = await bumpCacheVersion();
  return NextResponse.json({
    message: "Cache de consulta invalidado com sucesso.",
    version,
  });
}

