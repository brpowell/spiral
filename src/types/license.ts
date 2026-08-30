import { t } from "../lib/i18n";

export type LicenseStatus =
  "trial" | "provisional" | "readyToFinalize" | "licensed";

/** Commercial / cohort variant of a product grant. */
export type LicenseSku = "standard" | "founder";

export interface LicenseCosmetic {
  fontId: string;
  colorHex: string;
  cardholderName: string;
  wrapRef: string;
  wrapData: string | null;
}

export interface LicenseSnapshot {
  status: LicenseStatus;
  installed: boolean;
  productId: string | null;
  sku: LicenseSku | null;
  originalPurchaseId: string | null;
  channel: string | null;
  issuedAt: string | null;
  expiresAt: string | null;
  cosmetic: LicenseCosmetic | null;
  /** Catalog code (`license.installed.*`) when the card is invalid. */
  error: string | null;
}

export function defaultLicenseSnapshot(): LicenseSnapshot {
  return {
    status: "trial",
    installed: false,
    productId: null,
    sku: null,
    originalPurchaseId: null,
    channel: null,
    issuedAt: null,
    expiresAt: null,
    cosmetic: null,
    error: null,
  };
}

export function licenseStatusLabel(status: LicenseStatus): string {
  switch (status) {
    case "trial":
      return t("common:spiralCard.status.trial");
    case "provisional":
      return t("common:spiralCard.status.provisional");
    case "readyToFinalize":
      return t("common:spiralCard.status.readyToFinalize");
    case "licensed":
      return t("common:spiralCard.status.licensed");
  }
}
