import type { SkinViewStateSpec, SkinViewStateTransition } from "../types/skin";
import type { SkinViewStateApi } from "./skinViewStateContext";

const VIEW_MOTION_VALUES = new Set(["opening", "closing"]);

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

/** True while a view-state variable is in a slide/intro transient. */
export function isViewStateMotionActive(
  values: Record<string, string | number | boolean> | undefined,
): boolean {
  if (!values) return false;
  return Object.values(values).some(
    (value) => typeof value === "string" && VIEW_MOTION_VALUES.has(value),
  );
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

  api.setVariable(variable, branch.set);
  return true;
}
