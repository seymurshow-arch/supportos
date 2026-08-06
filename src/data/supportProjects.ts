export const SUPPORT_PROJECTS = [
  "LunuBet",
  "Roostino",
  "WonderLuck",
  "FanoBet",
  "Tip-top",
  "50 Crowns",
  "Haha Spin",
  "Galleon",
] as const;

export type SupportProjectName = (typeof SUPPORT_PROJECTS)[number];

export const PROJECT_STORAGE_KEY = "supportos-command-projects-v1";
