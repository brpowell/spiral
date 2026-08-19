import { useTranslation } from "react-i18next";
import { BrowseGridBody } from "../BrowseView/BrowseGridBody";
import { BrowseView } from "../BrowseView/BrowseView";
import { BrowseViewHeader } from "../BrowseView/BrowseViewHeader";
import { useSkinStore } from "../../store/useSkinStore";
import { SkinsGrid } from "./SkinsGrid";
import "./AppearanceSection.css";

export function SkinsSection({
  onOpenPack,
}: {
  onOpenPack: (packId: string) => void;
}) {
  const { t } = useTranslation(["studio", "library"]);
  const skins = useSkinStore((s) => s.skins);
  const skinsLoaded = useSkinStore((s) => s.skinsLoaded);

  return (
    <BrowseView>
      <BrowseViewHeader
        title={t("skins.title")}
        count={
          skinsLoaded
            ? t("library:views.headerCount", { count: skins.length })
            : undefined
        }
      />

      <BrowseGridBody>
        <SkinsGrid onOpenPack={onOpenPack} />
      </BrowseGridBody>
    </BrowseView>
  );
}
