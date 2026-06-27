/** Per-skin user preferences persisted in `{app_data}/skin-preferences.json`. */

export interface SkinBuiltinPreferences {
  soundEffectsEnabled?: boolean;
}

export interface SkinUserPreferences {
  builtin: SkinBuiltinPreferences;
  /** Reserved for future author-defined settings from manifest `settings`. */
  custom?: Record<string, unknown>;
}

export function defaultSkinUserPreferences(): SkinUserPreferences {
  return { builtin: {} };
}

/** Default `true` when absent (matches WMP T3 `soundFX` default). */
export function soundEffectsEnabledFromPreferences(
  preferences: SkinUserPreferences,
): boolean {
  return preferences.builtin.soundEffectsEnabled ?? true;
}
