import { create } from "zustand";

interface WhatsNewState {
  open: boolean;
  /** When set, the modal selects this version (toast → pending update). */
  focusVersion: string | null;
  openWhatsNew: (focusVersion?: string) => void;
  closeWhatsNew: () => void;
}

export const useWhatsNewStore = create<WhatsNewState>((set) => ({
  open: false,
  focusVersion: null,
  openWhatsNew: (focusVersion) => {
    const trimmed = focusVersion?.trim();
    set({
      open: true,
      focusVersion: trimmed ? trimmed : null,
    });
  },
  closeWhatsNew: () => set({ open: false, focusVersion: null }),
}));
