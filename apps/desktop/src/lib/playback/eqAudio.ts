/**
 * 10-band graphic EQ using serial peaking biquads with a parallel dry/wet bypass.
 *
 * When disabled, audio routes through bypassGain (unity) while wetGain is muted,
 * preserving stored band gains without re-applying on re-enable.
 *
 *   input ─┬─► preampGain ─► [filter₁…filter₁₀] ─► wetGain ─┬─► output
 *          └─► bypassGain ───────────────────────────────────┘
 */
import {
  clampBandGain,
  EQ_BAND_COUNT,
  EQ_BAND_FREQUENCIES_HZ,
  gainDbToLinear,
  type EqualizerState,
} from "../equalizer/types";

const FILTER_Q = 1.4;

interface EqualizerChain {
  input: AudioNode;
  output: AudioNode;
  setBandGain(index: number, gainDb: number): void;
  setPreampGain(gainDb: number): void;
  setEnabled(enabled: boolean): void;
  applyState(state: Pick<EqualizerState, "enabled" | "bands" | "preampGain">): void;
  dispose(): void;
}

function createEqualizerChain(ctx: BaseAudioContext): EqualizerChain {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const bypassGain = ctx.createGain();
  const preampGain = ctx.createGain();
  const wetGain = ctx.createGain();

  const filters: BiquadFilterNode[] = [];
  for (let i = 0; i < EQ_BAND_COUNT; i++) {
    const filter = ctx.createBiquadFilter();
    filter.type = "peaking";
    filter.frequency.value = EQ_BAND_FREQUENCIES_HZ[i]!;
    filter.Q.value = FILTER_Q;
    filter.gain.value = 0;
    filters.push(filter);
  }

  input.connect(bypassGain);
  bypassGain.connect(output);

  input.connect(preampGain);
  let previous: AudioNode = preampGain;
  for (const filter of filters) {
    previous.connect(filter);
    previous = filter;
  }
  previous.connect(wetGain);
  wetGain.connect(output);

  const setEnabled = (nextEnabled: boolean) => {
    wetGain.gain.value = nextEnabled ? 1 : 0;
    bypassGain.gain.value = nextEnabled ? 0 : 1;
  };

  const setBandGain = (index: number, gainDb: number) => {
    if (index < 0 || index >= EQ_BAND_COUNT) return;
    filters[index]!.gain.value = clampBandGain(gainDb);
  };

  const setPreampGain = (gainDb: number) => {
    preampGain.gain.value = gainDbToLinear(gainDb);
  };

  const applyState = (
    state: Pick<EqualizerState, "enabled" | "bands" | "preampGain">,
  ) => {
    for (let i = 0; i < EQ_BAND_COUNT; i++) {
      setBandGain(i, state.bands[i] ?? 0);
    }
    setPreampGain(state.preampGain);
    setEnabled(state.enabled);
  };

  const dispose = () => {
    input.disconnect();
    output.disconnect();
    bypassGain.disconnect();
    preampGain.disconnect();
    wetGain.disconnect();
    for (const filter of filters) {
      filter.disconnect();
    }
  };

  setEnabled(true);
  setPreampGain(0);

  return {
    input,
    output,
    setBandGain,
    setPreampGain,
    setEnabled,
    applyState,
    dispose,
  };
}

let activeChain: EqualizerChain | null = null;
let activeContext: BaseAudioContext | null = null;
let lastAppliedState: Pick<EqualizerState, "enabled" | "bands" | "preampGain"> = {
  enabled: true,
  bands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  preampGain: 0,
};

export function ensureEqualizerChain(ctx: BaseAudioContext): EqualizerChain {
  if (activeChain && activeContext === ctx) {
    return activeChain;
  }

  disposeEqualizerChain();
  activeContext = ctx;
  activeChain = createEqualizerChain(ctx);
  activeChain.applyState(lastAppliedState);
  return activeChain;
}

export function disposeEqualizerChain(): void {
  if (activeChain) {
    activeChain.dispose();
    activeChain = null;
  }
  activeContext = null;
}

export function applyEqualizerState(
  state: Pick<EqualizerState, "enabled" | "bands" | "preampGain">,
): void {
  lastAppliedState = {
    enabled: state.enabled,
    bands: [...state.bands] as EqualizerState["bands"],
    preampGain: state.preampGain,
  };
  activeChain?.applyState(lastAppliedState);
}
