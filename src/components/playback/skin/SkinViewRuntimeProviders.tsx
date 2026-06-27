import { useMemo, type ReactNode } from "react";
import type { SkinView } from "../../../types/skin";
import { collectSlideshowNodes } from "../../../lib/skinSlideshow";
import { SkinSlideshowStateProvider } from "../../../lib/skinSlideshowContext";
import { useViewRuntimeEffects } from "../../../hooks/useViewRuntimeEffects";
import {
  initViewStateDefaults,
  SkinViewStateProvider,
} from "../../../lib/skinViewStateContext";

function SkinViewRuntimeEffects({ view }: { view: SkinView }) {
  useViewRuntimeEffects(view);
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

  return (
    <SkinViewStateProvider
      defaults={viewDefaults}
      registerGlobalApi={registerGlobalApi}
    >
      <SkinSlideshowStateProvider definitions={slideshowDefinitions}>
        <SkinViewRuntimeEffects view={view} />
        {children}
      </SkinSlideshowStateProvider>
    </SkinViewStateProvider>
  );
}
