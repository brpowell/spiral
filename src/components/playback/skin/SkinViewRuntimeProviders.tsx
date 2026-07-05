import { useMemo, type ReactNode } from "react";
import type { SkinView } from "../../../types/skin";
import { collectSlideshowNodes } from "../../../lib/skinSlideshow";
import { collectScrollStripNodes } from "../../../lib/skinScrollStrip";
import { SkinSlideshowStateProvider } from "../../../lib/skinSlideshowContext";
import { SkinScrollStripStateProvider } from "../../../lib/skinScrollStripContext";
import { useViewActivateEffects } from "../../../hooks/useViewActivateEffects";
import {
  initViewStateDefaults,
  SkinViewStateProvider,
} from "../../../lib/skinViewStateContext";

function SkinViewActivateEffectsRunner({ view }: { view: SkinView }) {
  useViewActivateEffects(view);
  return null;
}

export function SkinViewRuntimeProviders({
  view,
  registerGlobalApi = false,
  children,
}: {
  view: SkinView;
  registerGlobalApi?: boolean;
  children: ReactNode;
}) {
  const viewDefaults = useMemo(
    () => initViewStateDefaults(view.state),
    [view.state],
  );
  const slideshowDefinitions = useMemo(
    () => collectSlideshowNodes(view.layout),
    [view.layout],
  );
  const scrollStripDefinitions = useMemo(
    () => collectScrollStripNodes(view.layout),
    [view.layout],
  );

  return (
    <SkinViewStateProvider
      defaults={viewDefaults}
      registerGlobalApi={registerGlobalApi}
    >
      <SkinSlideshowStateProvider definitions={slideshowDefinitions}>
        <SkinScrollStripStateProvider definitions={scrollStripDefinitions}>
          <SkinViewActivateEffectsRunner view={view} />
          {children}
        </SkinScrollStripStateProvider>
      </SkinSlideshowStateProvider>
    </SkinViewStateProvider>
  );
}
