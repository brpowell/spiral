export interface ThemeTokens {
  "color-bg": string;
  "color-surface": string;
  "color-surface-raised"?: string;
  "color-text-primary": string;
  "color-text-secondary": string;
  "color-accent": string;
  "color-accent-muted": string;
  "color-border": string;
  "color-danger": string;
  "color-danger-bg"?: string;
  "radius-card": string;
  "radius-button": string;
  "font-ui": string;
  [key: string]: string | undefined;
}

export interface Theme {
  name: string;
  author: string;
  description: string;
  tokens: ThemeTokens;
}
