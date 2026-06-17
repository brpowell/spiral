import { SkinsGrid } from "./SkinsGrid";
import { Button } from "../common/Button/Button";
import { useSkinStore } from "../../store/useSkinStore";
import "./AppearanceSection.css";

export function SkinsSection() {
  const openSkinsFolder = useSkinStore((s) => s.openSkinsFolder);

  return (
    <div className="appearance-section">
      <div className="appearance-section__body">
        <SkinsGrid />
      </div>

      <footer className="appearance-section__footer">
        <Button variant="secondary" size="sm" onClick={() => void openSkinsFolder()}>
          Open skins folder
        </Button>
      </footer>
    </div>
  );
}
