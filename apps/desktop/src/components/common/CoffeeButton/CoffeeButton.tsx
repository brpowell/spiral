import { openUrl } from "@tauri-apps/plugin-opener";
import { useTranslation } from "react-i18next";
import { BUY_ME_A_COFFEE_URL } from "../../About/aboutContent";
import { Button, type ButtonProps } from "../Button/Button";
import "./CoffeeButton.css";

type CoffeeButtonProps = Omit<ButtonProps, "variant" | "children" | "onClick">;

/**
 * The standard primary button in Buy Me a Coffee yellow, which opens
 * Bryan's page in the system browser.
 */
export function CoffeeButton({ className, ...props }: CoffeeButtonProps) {
  const { t } = useTranslation("common");
  return (
    <Button
      {...props}
      variant="primary"
      className={["coffee-button", className].filter(Boolean).join(" ")}
      onClick={() => void openUrl(BUY_ME_A_COFFEE_URL)}
    >
      <img src="/bmc/bmc-logo.svg" alt="" draggable={false} />
      {t("buyMeACoffee")}
    </Button>
  );
}
