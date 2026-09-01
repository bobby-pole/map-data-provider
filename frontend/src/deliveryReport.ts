export const DEFAULT_DELIVERY_AOI_ID = "rybnik_35km";

export function isRuntimeAcquisitionReport(aoiId: string | null | undefined): boolean {
  return Boolean(aoiId && aoiId !== DEFAULT_DELIVERY_AOI_ID);
}
