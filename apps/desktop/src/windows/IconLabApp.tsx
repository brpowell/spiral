import { CustomWindowFrame } from "@/components/WindowChrome/CustomWindowFrame";
import { IconLabShell } from "@/components/IconLab/IconLabShell";
import "./IconLabApp.css";

export function IconLabApp() {
  return (
    <CustomWindowFrame title="Icon Lab" className="icon-lab-app">
      <IconLabShell />
    </CustomWindowFrame>
  );
}
