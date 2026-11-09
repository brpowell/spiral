import { useEffect, useMemo, type ReactNode } from "react";
import type { SkinView } from "@/types/skin";
import { collectSlideshowNodes } from "@/lib/skin/skinSlideshow";
import { collectScrollStripNodes } from "@/lib/skin/skinScrollStrip";
import { SkinSlideshowStateProvider } from "@/lib/skin/skinSlideshowContext";
import { SkinScrollStripStateProvider } from "@/lib/skin/skinScrollStripContext";
import { SkinHoverProvider } from "@/lib/skin/skinHoverContext";
import { useViewActivateEffects } from "@/hooks/useViewActivateEffects";
import { setSkinClickThroughIgnore } from "@/lib/skin/skinClickThrough";
import { isViewStateMotionActive } from "@/lib/skin/skinViewStateEvents";
import {
  initViewStateDefaults,
  SkinViewStateProvider,
  useSkinViewState,
} from "@/lib/skin/skinViewStateContext";

function SkinViewActivateEffectsRunner({ view }: { view: SkinView }) {
  useViewActivateEffects(view);
  return null;
}

function SkinViewMotionClickThrough({ enabled }: { enabled: boolean }) {
  const { values } = useSkinViewState();
  useEffect(() => {
    if (!enabled) return;
    if (isViewStateMotionActive(values)) {
      void setSkinClickThroughIgnore(false);
    }
  }, [enabled, values]);
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
      <SkinHoverProvider>
        <SkinSlideshowStateProvider definitions={slideshowDefinitions}>
          <SkinScrollStripStateProvider definitions={scrollStripDefinitions}>
            <SkinViewActivateEffectsRunner view={view} />
            <SkinViewMotionClickThrough enabled={registerGlobalApi} />
            {children}
          </SkinScrollStripStateProvider>
        </SkinSlideshowStateProvider>
      </SkinHoverProvider>
    </SkinViewStateProvider>
  );
}
