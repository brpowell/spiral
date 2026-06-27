import type {
  SkinViewStateSpec,
  SkinViewStateTransition,
} from "../types/skin";
import { playActiveSkinSound } from "./skinSoundEffects";
import type { SkinViewStateApi } from "./skinViewStateContext";

function matchStateTransitionBranch(
  branches: SkinViewStateTransition[],
  currentValue: string | number | boolean,
): SkinViewStateTransition | undefined {
  const current = String(currentValue);

  for (const branch of branches) {
    if (branch.from === undefined) return branch;
    if (branch.from.some((value) => String(value) === current)) return branch;
  }

  return undefined;
}

export function applyViewStateEvent(
  variable: string,
  event: string,
  stateSpec: Record<string, SkinViewStateSpec> | undefined,
  api: SkinViewStateApi,
): boolean {
  const branches = stateSpec?.[variable]?.on?.[event];
  if (!branches?.length) return false;

  const current = api.values[variable];
  if (current === undefined) return false;

  const branch = matchStateTransitionBranch(branches, current);
  if (!branch) return false;

  if (branch.sound) playActiveSkinSound(branch.sound);
  api.setVariable(variable, branch.set);
  return true;
}
