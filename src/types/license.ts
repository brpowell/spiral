export type LicenseStatus =
  | "trial"
  | "provisional"
  | "readyToFinalize"
  | "licensed";

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
      return "Trial";
    case "provisional":
      return "Provisional";
    case "readyToFinalize":
      return "Ready to finalize";
    case "licensed":
      return "Permanent";
  }
}
