import { t } from "../lib/i18n";

export type LicenseStatus =
  "trial" | "provisional" | "readyToUpdate" | "licensed";

/** Commercial / cohort variant of a product grant. */
export type LicenseSku = "standard" | "founder";

export interface LicenseCosmetic {
  fontId: string;
  colorHex: string;
  cardholderName: string;
}

export type LicenseDemoted = "grace" | "refunded";

export interface LicenseSnapshot {
  status: LicenseStatus;
  installed: boolean;
  productKey: string | null;
  sku: LicenseSku | null;
  originalPurchaseId: string | null;
  channel: string | null;
  issuedAt: string | null;
  expiresAt: string | null;
  cosmetic: LicenseCosmetic | null;
  /** Catalog code (`license.installed.*`) when the card is invalid. */
  error: string | null;
  /** Set when registration was removed and the user was returned to trial. */
  demoted: LicenseDemoted | null;
}

export function defaultLicenseSnapshot(): LicenseSnapshot {
  return {
    status: "trial",
    installed: false,
    productKey: null,
    sku: null,
    originalPurchaseId: null,
    channel: null,
    issuedAt: null,
    expiresAt: null,
    cosmetic: null,
    error: null,
    demoted: null,
  };
}

export function licenseStatusLabel(status: LicenseStatus): string | null {
  switch (status) {
    case "provisional":
    case "readyToUpdate":
      return t("common:spiralCard.status.provisional");
    default:
      return null;
  }
}
