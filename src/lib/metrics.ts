import { appendMetricEvent, listMetricEvents } from "@/lib/storage";

type LeadQualityMetric = {
  category: string;
  hasPhone: boolean;
  hasWhatsapp: boolean;
  responseStatus: "ok" | "zero_results" | "error";
};

export async function trackLeadQualityMetric(metric: LeadQualityMetric): Promise<void> {
  await appendMetricEvent("lead_quality", metric.category, metric);
}

export async function getLeadQualitySummary(): Promise<{
  total: number;
  phoneRate: number;
  whatsappRate: number;
  byCategory: Array<{ category: string; total: number; phoneRate: number; whatsappRate: number; responseOkRate: number }>;
}> {
  const events = await listMetricEvents(5000);
  const leadEvents = events
    .filter((event) => event.eventName === "lead_quality")
    .map((event) => event.payload as LeadQualityMetric);

  if (!leadEvents.length) {
    return { total: 0, phoneRate: 0, whatsappRate: 0, byCategory: [] };
  }

  const total = leadEvents.length;
  const phoneHits = leadEvents.filter((item) => item.hasPhone).length;
  const whatsappHits = leadEvents.filter((item) => item.hasWhatsapp).length;

  const categoryMap = new Map<string, LeadQualityMetric[]>();
  for (const event of leadEvents) {
    const list = categoryMap.get(event.category) ?? [];
    list.push(event);
    categoryMap.set(event.category, list);
  }

  const byCategory = Array.from(categoryMap.entries()).map(([category, items]) => {
    const categoryTotal = items.length;
    const categoryPhone = items.filter((item) => item.hasPhone).length;
    const categoryWhatsapp = items.filter((item) => item.hasWhatsapp).length;
    const categoryOk = items.filter((item) => item.responseStatus === "ok").length;
    return {
      category,
      total: categoryTotal,
      phoneRate: Number((categoryPhone / categoryTotal).toFixed(4)),
      whatsappRate: Number((categoryWhatsapp / categoryTotal).toFixed(4)),
      responseOkRate: Number((categoryOk / categoryTotal).toFixed(4)),
    };
  });

  const sortedByCategory = byCategory.toSorted((a, b) => b.total - a.total);

  return {
    total,
    phoneRate: Number((phoneHits / total).toFixed(4)),
    whatsappRate: Number((whatsappHits / total).toFixed(4)),
    byCategory: sortedByCategory,
  };
}

