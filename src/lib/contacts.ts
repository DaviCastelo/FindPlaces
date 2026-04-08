const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[A-Za-z]{2,}/g;

export function normalizeBrazilPhone(raw?: string): string | undefined {
  if (!raw) return undefined;
  const digits = raw.replace(/\D/g, "");
  if (!digits) return undefined;

  if (digits.startsWith("55") && digits.length >= 12) return digits;
  if (digits.length >= 10 && digits.length <= 11) return `55${digits}`;

  return digits.length >= 10 ? digits : undefined;
}

export function phoneToWhatsappLink(raw?: string): string | undefined {
  const normalized = normalizeBrazilPhone(raw);
  if (!normalized) return undefined;
  return `https://wa.me/${normalized}`;
}

export function extractFirstEmail(text?: string): string | undefined {
  if (!text) return undefined;
  const matches = text.match(emailRegex);
  if (!matches?.length) return undefined;
  return matches[0].toLowerCase();
}
