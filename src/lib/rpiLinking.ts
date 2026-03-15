export type RpiHistoryRecord = {
  patentNumberRaw?: string | null;
  dispatchCode?: string | null;
};

export function normalizePatentNumberKey(value?: string | null): string {
  return (value || "").replace(/\s+/g, "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

export function normalizeDispatchCode(value?: string | null): string {
  return (value || "").replace(",", ".").replace(/\s+/g, "").replace(/[^\d.]/g, "");
}

export function isDocumentEligibleDispatchCode(value?: string | null): boolean {
  const code = normalizeDispatchCode(value);
  return code === "3.1" || code === "16.1";
}

export function shouldCreatePatentFromHistory(record: RpiHistoryRecord): boolean {
  return normalizePatentNumberKey(record.patentNumberRaw).length > 0
    && isDocumentEligibleDispatchCode(record.dispatchCode);
}
