import { openUrl } from "@tauri-apps/plugin-opener";
import { motion } from "framer-motion";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { TFunction } from "i18next";
import { Trans, useTranslation } from "react-i18next";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { usePointerTiltArt } from "../../hooks/usePointerTiltArt";
import { copyTextToClipboard } from "../../lib/clipboard";
import { formatDateAdded } from "../../lib/format";
import { isNetworkLikelyAvailable } from "../../lib/network";
import {
  classifySpiralCardWrapError,
  spiralCardFinalizedPayload,
  spiralCardFinalizeNetworkErrorPayload,
  spiralCardWrapErrorPayload,
} from "../../lib/toastPayloads";
import {
  exportRegistrationCard,
  getRegistrationSpcardPath,
  revealPathInFileManager,
} from "../../lib/tauri";
import { showSpcardInstallSuccessToast } from "../../lib/spcardInstall";
import {
  SUPPORT_EMAIL,
  TRIAL_LIBRARY_TRACK_CAP,
  TRIAL_PURCHASE_URL,
} from "../../lib/trialGate";
import { useBackgroundTasksStore } from "../../store/useBackgroundTasksStore";
import { useLicenseStore } from "../../store/useLicenseStore";
import {
  licenseStatusLabel,
  type LicenseCosmetic,
  type LicenseStatus,
} from "../../types/license";
import { Button } from "../common/Button/Button";
import { ColorField } from "../common/ColorField/ColorField";
import { FormField } from "../common/Field/Field";
import {
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalFooter,
  ModalHeader,
  ModalHeaderMain,
  ModalTitle,
} from "../common/Modal/Modal";
import { TextInput } from "../common/TextInput/TextInput";
import { TextLink } from "../common/TextLink/TextLink";
// Placeholder app mark — swap when real Spiral icons replace src-tauri/icons/.
import spiralMarkUrl from "../../../src-tauri/icons/128x128.png";
import { SpiralCardActionsMenu } from "./SpiralCardActionsMenu";
import "./SpiralCardModal.css";

const DEFAULT_COLOR = "#2b2b2b";
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const CARDHOLDER_NAME_MAX = 40;
const COPY_FEEDBACK_MS = 2000;

function PurchaseIdRow({ purchaseId }: { purchaseId: string }) {
  const { t } = useTranslation("common");
  const [copied, setCopied] = useState(false);
  const resetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setCopied(false);
    if (resetTimeoutRef.current) {
      clearTimeout(resetTimeoutRef.current);
      resetTimeoutRef.current = null;
    }
  }, [purchaseId]);

  useEffect(() => {
    return () => {
      if (resetTimeoutRef.current) {
        clearTimeout(resetTimeoutRef.current);
      }
    };
  }, []);

  const copyPurchaseId = async () => {
    const didCopy = await copyTextToClipboard(purchaseId);
    if (!didCopy) return;
    setCopied(true);
    if (resetTimeoutRef.current) {
      clearTimeout(resetTimeoutRef.current);
    }
    resetTimeoutRef.current = setTimeout(() => {
      setCopied(false);
      resetTimeoutRef.current = null;
    }, COPY_FEEDBACK_MS);
  };

  return (
    <div className="spiral-card-modal__purchase">
      <span className="spiral-card-modal__purchase-label">
        {t("spiralCard.purchaseId")}
      </span>
      <Button
        variant="ghost"
        size="sm"
        className="spiral-card-modal__purchase-id"
        onClick={() => void copyPurchaseId()}
        title={copied ? t("spiralCard.copied") : t("spiralCard.copyPurchaseId")}
        aria-label={
          copied
            ? t("spiralCard.copiedAria")
            : t("spiralCard.copyPurchaseIdAria", { id: purchaseId })
        }
      >
        {copied ? t("spiralCard.copied") : purchaseId}
      </Button>
    </div>
  );
}

function isFinalizeNetworkFailure(raw: string): boolean {
  return (
    raw.includes("network_error") ||
    raw.includes("could not reach") ||
    !isNetworkLikelyAvailable()
  );
}

function SupportEmailLink({ children }: { children?: ReactNode }) {
  const href = `mailto:${SUPPORT_EMAIL}`;
  return (
    <TextLink
      href={href}
      className="spiral-card-modal__support-email"
      onClick={(e) => {
        e.preventDefault();
        void openUrl(href);
      }}
    >
      {children ?? SUPPORT_EMAIL}
    </TextLink>
  );
}

/** Sticky inline copy for non-network finalize failures (near Submit & finalize). */
function FinalizeBusinessError({ raw }: { raw: string }) {
  const { t } = useTranslation("common");
  const support = (
    <Trans
      i18nKey="spiralCard.errorSupport"
      t={t}
      values={{ email: SUPPORT_EMAIL }}
      components={{ email: <SupportEmailLink /> }}
    />
  );
  if (raw.includes("unknown_purchase")) {
    return (
      <>
        {t("spiralCard.errorUnknownPurchase")}
        {support}
      </>
    );
  }
  if (raw.includes("refunded")) {
    return (
      <>
        {t("spiralCard.errorRefunded")}
        {support}
      </>
    );
  }
  return (
    <>
      {raw}
      {support}
    </>
  );
}

/** Short status copy shown under the card preview. */
function RegistrationStatusCopy({
  status,
  expiresAt,
}: {
  status: LicenseStatus;
  expiresAt: string | null;
}): ReactNode {
  const { t } = useTranslation("common");
  switch (status) {
    case "provisional": {
      const date = expiresAt ? formatDateAdded(expiresAt) : null;
      return date ? (
        <Trans
          i18nKey="spiralCard.provisionalCopyDated"
          t={t}
          values={{ date }}
          components={{
            date: <strong className="spiral-card-modal__registration-date" />,
          }}
        />
      ) : (
        t("spiralCard.provisionalCopy")
      );
    }
    case "readyToFinalize":
      return t("spiralCard.readyCopy");
    default:
      return null;
  }
}

function modalTitleFor(status: LicenseStatus, t: TFunction<"common">): string {
  switch (status) {
    case "trial":
      return t("spiralCard.titleTrial");
    case "readyToFinalize":
      return t("spiralCard.titleReady");
    default:
      return t("spiralCard.title");
  }
}

function wrapDataUrl(cosmetic: LicenseCosmetic): string | null {
  if (cosmetic.wrapRef !== "custom" || !cosmetic.wrapData) return null;
  // Opaque wraps → JPEG (`/9j/…`); alpha wraps → PNG (`iVBOR…`).
  const mime = cosmetic.wrapData.startsWith("iVBORw0KGgo")
    ? "image/png"
    : "image/jpeg";
  return `data:${mime};base64,${cosmetic.wrapData}`;
}

export function SpiralCardModal() {
  const { t } = useTranslation("common");
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const stampTimeoutRef = useRef<number | null>(null);

  const open = useLicenseStore((s) => s.spiralCardOpen);
  const setSpiralCardOpen = useLicenseStore((s) => s.setSpiralCardOpen);
  const snapshot = useLicenseStore((s) => s.snapshot);
  const loaded = useLicenseStore((s) => s.loaded);
  const loadLicense = useLicenseStore((s) => s.loadLicense);
  const installFromPicker = useLicenseStore((s) => s.installFromPicker);
  const finalizeRegistration = useLicenseStore((s) => s.finalizeRegistration);
  const updateCosmetic = useLicenseStore((s) => s.updateCosmetic);
  const setWrapFromPicker = useLicenseStore((s) => s.setWrapFromPicker);
  const clearWrap = useLicenseStore((s) => s.clearWrap);

  const [installingCard, setInstallingCard] = useState(false);
  const [confirmingFinalize, setConfirmingFinalize] = useState(false);
  const [savingCosmetic, setSavingCosmetic] = useState(false);
  const [revealingCard, setRevealingCard] = useState(false);
  const [exportingCard, setExportingCard] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [finalizeError, setFinalizeError] = useState<string | null>(null);
  const [stampingCard, setStampingCard] = useState(false);
  const [draftColor, setDraftColor] = useState(DEFAULT_COLOR);
  const [draftCardholderName, setDraftCardholderName] = useState("");
  const {
    className: tiltClassName,
    style: tiltStyle,
    ...cardTilt
  } = usePointerTiltArt();

  const hasCard =
    snapshot.status === "provisional" ||
    snapshot.status === "readyToFinalize" ||
    snapshot.status === "licensed";
  const cosmetic: LicenseCosmetic = snapshot.cosmetic ?? {
    fontId: "mono-01",
    colorHex: DEFAULT_COLOR,
    cardholderName: "",
    wrapRef: "default",
    wrapData: null,
  };
  const wrapUrl = wrapDataUrl(cosmetic);

  useFocusTrap(panelRef, open);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setFinalizeError(null);
    setStampingCard(false);
    void loadLicense().catch((err: unknown) => {
      console.error("Failed to load license state:", err);
    });
    return () => {
      if (stampTimeoutRef.current != null) {
        window.clearTimeout(stampTimeoutRef.current);
        stampTimeoutRef.current = null;
      }
    };
  }, [open, loadLicense]);

  useEffect(() => {
    if (!open || !snapshot.cosmetic) return;
    setDraftColor(snapshot.cosmetic.colorHex);
    setDraftCardholderName(snapshot.cosmetic.cardholderName);
  }, [open, snapshot.cosmetic]);

  const close = () => setSpiralCardOpen(false);

  const installCard = async () => {
    if (installingCard) return;
    const wasInstalled = snapshot.installed;
    setInstallingCard(true);
    setError(null);
    setFinalizeError(null);
    try {
      const result = await installFromPicker();
      if (result) {
        showSpcardInstallSuccessToast(wasInstalled);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    } finally {
      setInstallingCard(false);
    }
  };

  const confirmFinalize = async () => {
    if (confirmingFinalize) return;
    setConfirmingFinalize(true);
    setFinalizeError(null);
    setError(null);
    try {
      await finalizeRegistration();
      useBackgroundTasksStore
        .getState()
        .showToast(spiralCardFinalizedPayload());
      setStampingCard(true);
      if (stampTimeoutRef.current != null) {
        window.clearTimeout(stampTimeoutRef.current);
      }
      stampTimeoutRef.current = window.setTimeout(() => {
        setStampingCard(false);
        stampTimeoutRef.current = null;
      }, 900);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (isFinalizeNetworkFailure(message)) {
        useBackgroundTasksStore
          .getState()
          .showErrorToast(
            spiralCardFinalizeNetworkErrorPayload(!isNetworkLikelyAvailable()),
          );
      } else {
        setFinalizeError(message);
      }
    } finally {
      setConfirmingFinalize(false);
    }
  };

  const persistCosmetic = async (next: LicenseCosmetic) => {
    if (savingCosmetic || !hasCard) return;
    setSavingCosmetic(true);
    setError(null);
    try {
      await updateCosmetic(next);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      if (snapshot.cosmetic) {
        setDraftColor(snapshot.cosmetic.colorHex);
        setDraftCardholderName(snapshot.cosmetic.cardholderName);
      }
    } finally {
      setSavingCosmetic(false);
    }
  };

  const commitColor = (value: string) => {
    setDraftColor(value);
    if (!HEX_COLOR_RE.test(value)) return;
    const normalized = `#${value.slice(1).toLowerCase()}`;
    if (normalized === cosmetic.colorHex) return;
    void persistCosmetic({ ...cosmetic, colorHex: normalized });
  };

  const commitCardholderName = (raw: string) => {
    const next = raw.trim().slice(0, CARDHOLDER_NAME_MAX);
    setDraftCardholderName(next);
    if (next === cosmetic.cardholderName) return;
    void persistCosmetic({ ...cosmetic, cardholderName: next });
  };

  const chooseWrap = async () => {
    if (savingCosmetic || !hasCard) return;
    setSavingCosmetic(true);
    setError(null);
    try {
      await setWrapFromPicker();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      useBackgroundTasksStore
        .getState()
        .showErrorToast(
          spiralCardWrapErrorPayload(classifySpiralCardWrapError(message)),
        );
    } finally {
      setSavingCosmetic(false);
    }
  };

  const resetWrap = async () => {
    if (savingCosmetic || !hasCard || cosmetic.wrapRef === "default") return;
    setSavingCosmetic(true);
    setError(null);
    try {
      await clearWrap();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      useBackgroundTasksStore
        .getState()
        .showErrorToast(
          spiralCardWrapErrorPayload(classifySpiralCardWrapError(message)),
        );
    } finally {
      setSavingCosmetic(false);
    }
  };

  const revealCard = async () => {
    if (revealingCard || !hasCard) return;
    setRevealingCard(true);
    setError(null);
    try {
      const path = await getRegistrationSpcardPath();
      await revealPathInFileManager(path);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(
        message === "no_registration_card"
          ? t("spiralCard.missingFile")
          : message,
      );
    } finally {
      setRevealingCard(false);
    }
  };

  const exportCard = async () => {
    if (exportingCard || !hasCard) return;
    setExportingCard(true);
    setError(null);
    try {
      await exportRegistrationCard();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(
        message === "no_registration_card"
          ? t("spiralCard.missingFile")
          : message,
      );
    } finally {
      setExportingCard(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={close}
      size={hasCard ? "editor" : "md"}
      panelRef={panelRef}
      labelledBy={titleId}
      panelClassName={
        hasCard
          ? "spiral-card-modal spiral-card-modal--with-card"
          : "spiral-card-modal"
      }
    >
      <ModalHeader>
        <ModalHeaderMain>
          <ModalTitle id={titleId}>
            {modalTitleFor(snapshot.status, t)}
          </ModalTitle>
        </ModalHeaderMain>
        <ModalCloseButton onClick={close} />
      </ModalHeader>

      <ModalBody
        className={
          hasCard
            ? "spiral-card-modal__body spiral-card-modal__body--with-card"
            : "spiral-card-modal__body"
        }
      >
        {!hasCard ? (
          <div className="spiral-card-modal__trial">
            <p className="spiral-card-modal__copy">
              {t("spiralCard.trialBody", { count: TRIAL_LIBRARY_TRACK_CAP })}
            </p>
            {snapshot.error && (
              <p className="spiral-card-modal__error" role="alert">
                {snapshot.error}
              </p>
            )}
            {error && (
              <p className="spiral-card-modal__error" role="alert">
                {error}
              </p>
            )}
          </div>
        ) : (
          <div className="spiral-card-modal__layout">
            <div className="spiral-card-modal__card-column">
              <div
                className={
                  stampingCard
                    ? "spiral-card-modal__preview-stamp spiral-card-modal__preview-stamp--active"
                    : "spiral-card-modal__preview-stamp"
                }
              >
                <motion.div
                  className={`spiral-card-modal__preview ${tiltClassName}`}
                  style={{
                    ...tiltStyle,
                    ["--spiral-card-color" as string]: cosmetic.colorHex,
                    ...(wrapUrl
                      ? {
                          ["--spiral-card-wrap" as string]: `url(${wrapUrl})`,
                        }
                      : {}),
                  }}
                  {...cardTilt}
                >
                  {wrapUrl && (
                    <div
                      className="spiral-card-modal__preview-wrap"
                      aria-hidden
                    />
                  )}
                  <div className="spiral-card-modal__preview-inner">
                    <div className="spiral-card-modal__preview-meta">
                      <div className="spiral-card-modal__brand-row">
                        <img
                          className="spiral-card-modal__brand-mark"
                          src={spiralMarkUrl}
                          alt=""
                          aria-hidden
                          draggable={false}
                        />
                        <span className="spiral-card-modal__brand">Spiral</span>
                      </div>
                      <span className="spiral-card-modal__status-pill">
                        {loaded
                          ? licenseStatusLabel(snapshot.status)
                          : t("loading")}
                      </span>
                    </div>
                    <div className="spiral-card-modal__preview-footer">
                      {(draftCardholderName || cosmetic.cardholderName) && (
                        <span className="spiral-card-modal__cardholder">
                          {draftCardholderName || cosmetic.cardholderName}
                        </span>
                      )}
                      {snapshot.sku === "founder" && (
                        <span className="spiral-card-modal__founder">
                          {t("spiralCard.founder")}
                        </span>
                      )}
                    </div>
                  </div>
                </motion.div>
              </div>

              {snapshot.originalPurchaseId && (
                <PurchaseIdRow purchaseId={snapshot.originalPurchaseId} />
              )}

              {(snapshot.status === "provisional" ||
                snapshot.status === "readyToFinalize") && (
                <div className="spiral-card-modal__registration">
                  <p className="spiral-card-modal__registration-copy">
                    <RegistrationStatusCopy
                      status={snapshot.status}
                      expiresAt={snapshot.expiresAt}
                    />
                  </p>
                  {snapshot.status === "readyToFinalize" && (
                    <>
                      <Button
                        variant="primary"
                        className="spiral-card-modal__confirm"
                        disabled={confirmingFinalize}
                        onClick={() => void confirmFinalize()}
                      >
                        {confirmingFinalize
                          ? t("spiralCard.confirming")
                          : t("spiralCard.submit")}
                      </Button>
                      {finalizeError && (
                        <p
                          className="spiral-card-modal__error spiral-card-modal__finalize-error"
                          role="alert"
                        >
                          <FinalizeBusinessError raw={finalizeError} />
                        </p>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>

            <div className="spiral-card-modal__controls">
              {error && (
                <p className="spiral-card-modal__error" role="alert">
                  {error}
                </p>
              )}

              <div className="spiral-card-modal__controls-header">
                <h3 className="spiral-card-modal__controls-title">
                  {t("spiralCard.personalize")}
                </h3>
                <SpiralCardActionsMenu
                  className="spiral-card-modal__actions"
                  revealing={revealingCard}
                  exporting={exportingCard}
                  replacing={installingCard}
                  disabled={confirmingFinalize}
                  onReveal={() => void revealCard()}
                  onExport={() => void exportCard()}
                  onReplace={() => void installCard()}
                />
              </div>

              <div className="spiral-card-modal__studio">
                <FormField label={t("name")}>
                  <TextInput
                    value={draftCardholderName}
                    maxLength={CARDHOLDER_NAME_MAX}
                    placeholder={t("spiralCard.namePlaceholder")}
                    disabled={savingCosmetic || confirmingFinalize}
                    onChange={(e) => setDraftCardholderName(e.target.value)}
                    onBlur={(e) => commitCardholderName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.currentTarget.blur();
                      }
                    }}
                  />
                </FormField>
                <FormField label={t("spiralCard.color")}>
                  <ColorField
                    value={draftColor}
                    onChange={commitColor}
                    disabled={savingCosmetic || confirmingFinalize}
                    onReset={
                      draftColor.toLowerCase() !== DEFAULT_COLOR
                        ? () => commitColor(DEFAULT_COLOR)
                        : undefined
                    }
                    resetLabel={t("spiralCard.resetColor")}
                  />
                </FormField>
                <FormField
                  label={t("spiralCard.wrap")}
                  description={t("spiralCard.wrapDescription")}
                >
                  <div className="spiral-card-modal__wrap-actions">
                    <Button
                      variant="secondary"
                      disabled={savingCosmetic || confirmingFinalize}
                      onClick={() => void chooseWrap()}
                      size="sm"
                    >
                      {savingCosmetic
                        ? t("saving")
                        : t("spiralCard.chooseImage")}
                    </Button>
                    {cosmetic.wrapRef === "custom" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={savingCosmetic || confirmingFinalize}
                        onClick={() => void resetWrap()}
                      >
                        {t("spiralCard.useDefault")}
                      </Button>
                    )}
                  </div>
                </FormField>
              </div>
            </div>
          </div>
        )}
      </ModalBody>

      {!hasCard && (
        <ModalFooter>
          <Button
            variant="secondary"
            disabled={installingCard}
            onClick={() => void installCard()}
          >
            {installingCard
              ? t("spiralCard.adding")
              : t("spiralCard.addExisting")}
          </Button>
          <Button
            variant="primary"
            onClick={() => void openUrl(TRIAL_PURCHASE_URL)}
          >
            {t("spiralCard.purchase")}
          </Button>
        </ModalFooter>
      )}
    </Modal>
  );
}
