import { createContext, useContext } from "react";

export interface SkinCanvasStageSize {
  width: number;
  height: number;
}

export interface SkinCanvasStageContextValue {
  stageSize: SkinCanvasStageSize;
}

const defaultValue: SkinCanvasStageContextValue = {
  stageSize: { width: 0, height: 0 },
};

export const SkinCanvasStageContext =
  createContext<SkinCanvasStageContextValue>(defaultValue);

export function useSkinCanvasStage(): SkinCanvasStageContextValue {
  return useContext(SkinCanvasStageContext);
}
