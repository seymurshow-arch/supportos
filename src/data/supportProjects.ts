export const SPORTBET_PROJECT = "SportBet" as const;

export const SUPPORT_PROJECTS = [SPORTBET_PROJECT] as const;

export type SupportProjectName = (typeof SUPPORT_PROJECTS)[number];
