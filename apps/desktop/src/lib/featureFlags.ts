/**
 * The pack registry still catalogs v1 pack bundles while local installs are individual
 * items. Keep the catalog UI and background update checks off until the registry
 * publishes items. Flip to `true` only after the registry migration lands.
 */
export const REGISTRY_ENABLED = false;
