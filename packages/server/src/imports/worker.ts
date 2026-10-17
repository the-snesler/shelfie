import type { ImportService } from "./service.js";

/** Single-process worker, matching Shelfie's deployment model. */
export async function startImportWorker(service: ImportService): Promise<() => Promise<void>> {
  await service.resetInterrupted();
  const timer = setInterval(() => { void service.tick().catch(error => console.error("Scheduled import check failed", error instanceof Error ? error.name : "unknown error")); }, 30_000);
  timer.unref();
  void service.tick().catch(() => {});
  return () => { clearInterval(timer); return service.stop(); };
}
