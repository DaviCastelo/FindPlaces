import { discoverWebsiteByBusiness, scrapeContactFromWebsite } from "@/lib/scraper";
import { deriveWhatsappFromPhone, normalizeBrazilPhone } from "@/lib/contacts";
import type { ContactSource } from "@/lib/types";
import { loadJob, saveJob, type PersistedJob } from "@/lib/storage";

export type EnrichmentPayload = {
  leadId: string;
  name: string;
  address: string;
  website?: string;
  timeoutMs: number;
};

type EnrichmentResult = {
  phone?: string;
  phoneSource?: ContactSource;
  whatsapp?: string;
  whatsappSource?: ContactSource;
  email?: string;
  website?: string;
};

const jobs = new Map<string, PersistedJob>();
const queue: string[] = [];
let workerRunning = false;

async function runWorker(): Promise<void> {
  if (workerRunning) return;
  workerRunning = true;
  try {
    while (queue.length) {
      const jobId = queue.shift();
      if (!jobId) continue;
      const current = jobs.get(jobId) ?? (await loadJob(jobId));
      if (!current || current.status === "completed" || current.status === "failed") continue;
      const payload = current.payload as EnrichmentPayload;
      const started = new Date().toISOString();
      const processing: PersistedJob = {
        ...current,
        status: "processing",
        attempts: current.attempts + 1,
        startedAt: started,
        updatedAt: started,
      };
      jobs.set(jobId, processing);
      await saveJob(processing);

      try {
        const result = await processPayload(payload);
        const finishedAt = new Date().toISOString();
        const completed: PersistedJob = {
          ...processing,
          status: "completed",
          result,
          finishedAt,
          updatedAt: finishedAt,
        };
        jobs.set(jobId, completed);
        await saveJob(completed);
      } catch (error) {
        const finishedAt = new Date().toISOString();
        const failed: PersistedJob = {
          ...processing,
          status: "failed",
          error: error instanceof Error ? error.message : "Falha desconhecida no enriquecimento",
          finishedAt,
          updatedAt: finishedAt,
        };
        jobs.set(jobId, failed);
        await saveJob(failed);
      }
    }
  } finally {
    workerRunning = false;
  }
}

async function processPayload(payload: EnrichmentPayload): Promise<EnrichmentResult> {
  const timeout = Math.max(800, payload.timeoutMs);
  const website = payload.website?.trim() || (await discoverWebsiteByBusiness(payload.name, payload.address, timeout));
  if (!website) {
    return {};
  }
  const scraped = await scrapeContactFromWebsite(website, timeout);
  const phone = normalizeBrazilPhone(scraped.phone);
  const whatsapp = scraped.whatsapp ?? deriveWhatsappFromPhone(phone);
  return {
    phone,
    phoneSource: scraped.phoneSource,
    whatsapp,
    whatsappSource: scraped.whatsappSource ?? (whatsapp ? "derived_from_phone" : undefined),
    email: scraped.email,
    website,
  };
}

export async function enqueueEnrichment(payload: EnrichmentPayload): Promise<{ jobId: string }> {
  const jobId = globalThis.crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const job: PersistedJob = {
    id: jobId,
    status: "queued",
    payload,
    attempts: 0,
    createdAt,
    updatedAt: createdAt,
  };
  jobs.set(jobId, job);
  queue.push(jobId);
  await saveJob(job);
  runWorker().catch(() => {});
  return { jobId };
}

export async function getEnrichmentJob(jobId: string): Promise<PersistedJob | undefined> {
  return jobs.get(jobId) ?? (await loadJob(jobId));
}

