import { livechatPost } from "@/livechat";
import { SPORTBET_PROJECT } from "@/data/supportProjects";

export type LiveChatProject = {
  name: string;
  groupIds: number[];
  groupNames?: string[];
};

export type LiveChatGroup = {
  id: number;
  name: string;
};

const DEFAULT_PROJECT_NAMES = [SPORTBET_PROJECT];

function normalize(value: string) {
  return value.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

function shouldIgnoreGroup(groupName: string) {
  const value = normalize(groupName);
  return ["test", "internal", "sandbox", "demo"].some((word) =>
    value.includes(word),
  );
}

export async function listLiveChatGroups(): Promise<LiveChatGroup[]> {
  const groups = await livechatPost<LiveChatGroup[]>(
    "/v3.5/configuration/action/list_groups",
    {},
  );

  return (Array.isArray(groups) ? groups : [])
    .filter((group) => group?.id && group?.name && !shouldIgnoreGroup(group.name))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function resolveConfiguredLiveChatProjects(
  projectNames: string[] = DEFAULT_PROJECT_NAMES,
): Promise<LiveChatProject[]> {
  const groups = await listLiveChatGroups();
  const uniqueNames = [...new Set(projectNames.map((name) => name.trim()).filter(Boolean))];

  return uniqueNames
    .map((name) => {
      const needle = normalize(name);
      const matched = groups.filter((group) => normalize(group.name).includes(needle));

      return {
        name,
        groupIds: [...new Set(matched.map((group) => group.id))].sort((a, b) => a - b),
        groupNames: matched.map((group) => group.name),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function resolveLiveChatProjects(
  projectNames: string[] = DEFAULT_PROJECT_NAMES,
): Promise<LiveChatProject[]> {
  const projects = await resolveConfiguredLiveChatProjects(projectNames);
  return projects.filter((project) => project.groupIds.length > 0);
}

export async function getLiveChatProjects(): Promise<LiveChatProject[]> {
  return resolveLiveChatProjects();
}
