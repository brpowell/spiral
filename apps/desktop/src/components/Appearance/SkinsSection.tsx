import { useTranslation } from "react-i18next";
import { BrowseGridBody } from "../BrowseView/BrowseGridBody";
import { BrowseView } from "../BrowseView/BrowseView";
import { BrowseViewHeader } from "../BrowseView/BrowseViewHeader";
import { useSkinStore } from "../../store/useSkinStore";
import { HiddenItems } from "./HiddenItems";
import { ItemsAddMenu } from "./ItemsAddMenu";
import { SkinsGrid } from "./SkinsGrid";
import "./AppearanceSection.css";

export function SkinsSection({
  onOpenItem,
}: {
  onOpenItem: (effectiveId: string) => void;
}) {
  const { t } = useTranslation(["studio", "library"]);
  const skins = useSkinStore((s) => s.skins);
  const skinsLoaded = useSkinStore((s) => s.skinsLoaded);

  return (
    <BrowseView>
      <BrowseViewHeader
        className="browse-view__header--single-row"
        title={t("skins.title")}
        actions={<ItemsAddMenu />}
        count={
          skinsLoaded
            ? t("library:views.headerCount", { count: skins.length })
            : undefined
        }
      />

      <BrowseGridBody>
        <SkinsGrid onOpenItem={onOpenItem} />
        <HiddenItems type="skin" />
      </BrowseGridBody>
    </BrowseView>
  );
}
