import { MemberCard } from "@spiral/ui";
import { openUrl } from "@tauri-apps/plugin-opener";
import { motion } from "framer-motion";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { TFunction } from "i18next";
import { Trans, useTranslation } from "react-i18next";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { usePointerTiltArt } from "../../hooks/usePointerTiltArt";
import { formatDateAdded } from "../../lib/format";
import { isNetworkLikelyAvailable } from "../../lib/network";
import {
  spiralCardUpdatedPayload,
  spiralCardUpdateFailedPayload,
  spiralCardUpdateNetworkErrorPayload,
  spiralCardUpdateRateLimitedPayload,
  spiralCardInstallErrorPayload,
} from "../../lib/toastPayloads";
import {
  getRegistrationSpcardPath,
  revealPathInFileManager,
} from "../../lib/tauri";
import { showSpcardInstallSuccessToast } from "../../lib/spcardInstall";
import {
  parseUserErrorCode,
  isSpiralCardIntegrityError,
  translateUserError,
} from "../../lib/userError";
import {
  TRIAL_LIBRARY_TRACK_CAP,
  TRIAL_MEMBER_URL,
  TRIAL_PURCHASE_URL,
} from "../../lib/trialGate";
import { useBackgroundTasksStore } from "../../store/useBackgroundTasksStore";
import { useLicenseStore } from "../../store/useLicenseStore";
import {
  licenseStatusLabel,
  type LicenseCosmetic,
  type LicenseDemoted,
  type LicenseStatus,
} from "../../types/license";
import { Button } from "../common/Button/Button";
import {
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalFooter,
  ModalHeader,
  ModalHeaderMain,
  ModalTitle,
} from "../common/Modal/Modal";
import { IconExternalLink } from "../icons";
import { SpiralCardActions } from "./SpiralCardActions";
import "@spiral/ui/styles.css";
import "./SpiralCardModal.css";

const DEFAULT_COLOR = "#2b2b2b";

function isGrantPullRateLimited(raw: string): boolean {
  return raw.includes("rate_limited");
}

function isGrantPullNetworkFailure(raw: string): boolean {
  return (
    raw.includes("network_error") ||
    raw.includes("could not reach") ||
    !isNetworkLikelyAvailable()
  );
}

/** Short status copy shown under the card for provisional / ready-to-update. */
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
    case "readyToUpdate":
      return t("spiralCard.readyCopy");
    default:
      return null;
  }
}

function modalTitleFor(
  status: LicenseStatus,
  demoted: LicenseDemoted | null,
  t: TFunction<"common">,
): string {
  if (status === "trial" && demoted === "refunded") {
    return t("spiralCard.titleRefunded");
  }
  if (status === "trial" && demoted === "grace") {
    return t("spiralCard.titleGrace");
  }
  switch (status) {
    case "trial":
      return t("spiralCard.titleTrial");
    case "readyToUpdate":
      return t("spiralCard.titleReady");
    default:
      return t("spiralCard.title");
  }
}

function TrialOutcomeBody({ demoted }: { demoted: LicenseDemoted | null }) {
  const { t } = useTranslation("common");
  if (demoted === "refunded") {
    return t("spiralCard.refundedBody");
  }
  if (demoted === "grace") {
    return t("spiralCard.graceBody");
  }
  return t("spiralCard.trialBody", { count: TRIAL_LIBRARY_TRACK_CAP });
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
  const pullCurrentGrant = useLicenseStore((s) => s.pullCurrentGrant);

  const [installingCard, setInstallingCard] = useState(false);
  const [confirmingUpdate, setConfirmingUpdate] = useState(false);
  const [revealingCard, setRevealingCard] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stampingCard, setStampingCard] = useState(false);
  const {
    className: tiltClassName,
    style: tiltStyle,
    ...cardTilt
  } = usePointerTiltArt();

  const hasCard =
    snapshot.status === "provisional" ||
    snapshot.status === "readyToUpdate" ||
    snapshot.status === "licensed";
  const demoted = snapshot.demoted;
  const cosmetic: LicenseCosmetic = snapshot.cosmetic ?? {
    fontId: "mono-01",
    colorHex: DEFAULT_COLOR,
    cardholderName: "",
  };

  useFocusTrap(panelRef, open);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setStampingCard(false);
    // Keep demoted outcomes from a just-completed grant pull / restore open —
    // a fresh load would clear them (demoted is not persisted on disk).
    if (demoted !== "refunded" && demoted !== "grace") {
      void loadLicense().catch((err: unknown) => {
        console.error("Failed to load license state:", err);
      });
    }
    return () => {
      if (stampTimeoutRef.current != null) {
        window.clearTimeout(stampTimeoutRef.current);
        stampTimeoutRef.current = null;
      }
    };
  }, [open, loadLicense, demoted]);

  // Installed card failed verification — toast recovery CTA instead of inline raw copy.
  useEffect(() => {
    if (!open || !snapshot.error) return;
    if (!isSpiralCardIntegrityError(snapshot.error)) return;
    useBackgroundTasksStore
      .getState()
      .showErrorToast(spiralCardInstallErrorPayload(snapshot.error));
  }, [open, snapshot.error]);

  const close = () => setSpiralCardOpen(false);

  const installCard = async () => {
    if (installingCard) return;
    const wasInstalled = snapshot.installed;
    setInstallingCard(true);
    setError(null);
    try {
      const result = await installFromPicker();
      if (result) {
        showSpcardInstallSuccessToast(wasInstalled);
      }
    } catch (err) {
      if (
        parseUserErrorCode(err) === "license.installing.expired" ||
        isSpiralCardIntegrityError(err)
      ) {
        useBackgroundTasksStore
          .getState()
          .showErrorToast(spiralCardInstallErrorPayload(err));
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    } finally {
      setInstallingCard(false);
    }
  };

  const confirmUpdate = async () => {
    if (confirmingUpdate) return;
    setConfirmingUpdate(true);
    setError(null);
    try {
      const result = await pullCurrentGrant();
      if (result.demoted === "refunded") {
        // Modal stays open on the warm refunded trial layout — no error toast.
        return;
      }
      useBackgroundTasksStore.getState().showToast(spiralCardUpdatedPayload());
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
      if (isGrantPullRateLimited(message)) {
        useBackgroundTasksStore
          .getState()
          .showErrorToast(spiralCardUpdateRateLimitedPayload());
      } else if (isGrantPullNetworkFailure(message)) {
        useBackgroundTasksStore
          .getState()
          .showErrorToast(
            spiralCardUpdateNetworkErrorPayload(!isNetworkLikelyAvailable()),
          );
      } else {
        // Raw hub codes stay in the activity log; toast is recovery-focused.
        console.error("Spiral Card update failed:", message);
        useBackgroundTasksStore
          .getState()
          .showErrorToast(spiralCardUpdateFailedPayload());
      }
    } finally {
      setConfirmingUpdate(false);
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

  const primaryTrialCta =
    demoted === "grace"
      ? {
          label: t("spiralCard.openMemberPortal"),
          url: TRIAL_MEMBER_URL,
        }
      : {
          label: t("spiralCard.purchase"),
          url: TRIAL_PURCHASE_URL,
        };

  return (
    <Modal
      open={open}
      onClose={close}
      size="md"
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
            {modalTitleFor(snapshot.status, demoted, t)}
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
              <TrialOutcomeBody demoted={demoted} />
            </p>
            {snapshot.error && !isSpiralCardIntegrityError(snapshot.error) && (
              <p className="spiral-card-modal__error" role="alert">
                {translateUserError(snapshot.error) ??
                  t("errors:license.generic")}
              </p>
            )}
            {error && (
              <p className="spiral-card-modal__error" role="alert">
                {translateUserError(error) ?? t("errors:license.generic")}
              </p>
            )}
          </div>
        ) : (
          <div className="spiral-card-modal__layout">
            <div
              className={
                stampingCard
                  ? "spiral-card-modal__preview-stamp spiral-card-modal__preview-stamp--active"
                  : "spiral-card-modal__preview-stamp"
              }
            >
              <motion.div
                className={`spiral-card-modal__preview-tilt ${tiltClassName}`}
                style={tiltStyle}
                {...cardTilt}
              >
                <MemberCard
                  card={{
                    cosmetic,
                    sku: snapshot.sku,
                  }}
                  statusLabel={
                    loaded
                      ? (licenseStatusLabel(snapshot.status) ?? undefined)
                      : undefined
                  }
                  founderLabel={t("spiralCard.founder")}
                />
              </motion.div>
            </div>

            <div className="spiral-card-modal__controls">
              <SpiralCardActions
                revealing={revealingCard}
                replacing={installingCard}
                disabled={confirmingUpdate}
                onReveal={() => void revealCard()}
                onReplace={() => void installCard()}
              />

              {error && (
                <p className="spiral-card-modal__error" role="alert">
                  {translateUserError(error) ?? t("errors:license.generic")}
                </p>
              )}

              {(snapshot.status === "provisional" ||
                snapshot.status === "readyToUpdate") && (
                <p className="spiral-card-modal__registration-copy">
                  <RegistrationStatusCopy
                    status={snapshot.status}
                    expiresAt={snapshot.expiresAt}
                  />
                </p>
              )}
            </div>
          </div>
        )}
      </ModalBody>

      <ModalFooter>
        {!hasCard ? (
          <>
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
              onClick={() => void openUrl(primaryTrialCta.url)}
            >
              {primaryTrialCta.label}
            </Button>
          </>
        ) : (
          <>
            <Button
              variant="ghost"
              onClick={() => void openUrl(TRIAL_MEMBER_URL)}
            >
              <IconExternalLink />
              {t("spiralCard.openMemberPortal")}
            </Button>
            {snapshot.status === "readyToUpdate" ? (
              <Button
                variant="primary"
                isLoading={confirmingUpdate}
                onClick={() => void confirmUpdate()}
              >
                {confirmingUpdate
                  ? t("spiralCard.confirming")
                  : t("spiralCard.submit")}
              </Button>
            ) : null}
          </>
        )}
      </ModalFooter>
    </Modal>
  );
}
