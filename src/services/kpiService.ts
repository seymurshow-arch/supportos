export type AgentKPI = {
  name: string;
  email: string;

  dayHours: number;
  nightHours: number;
  workedDays: number;

  chats: number;
  csat: string;
  frtChats: number;
  frtEmails: number;
  art: number;
  trustpilot: number;
};

export async function loadAgentKPI(
  from: string,
  to: string,
  agents: { name: string; email: string }[]
): Promise<AgentKPI[]> {
  if (!agents.length) return [];

  const response = await fetch(
    `/api/livechat/agent-kpi?from=${from}&to=${to}&agents=${agents
      .map((a) => a.email)
      .join(",")}`
  );

  if (!response.ok) {
    throw new Error("Failed to load KPI");
  }

  const json = await response.json();

  return agents.map((agent) => {
    const api = json.agents?.[agent.email.toLowerCase()] ?? {};

    return {
      name: agent.name,
      email: agent.email,

      dayHours: 0,
      nightHours: 0,
      workedDays: 0,

      chats: api.chats ?? 0,
      csat: api.csat ?? "0%",
      frtChats: api.frtChats ?? 0,
      frtEmails: api.frtEmails ?? 0,
      art: api.art ?? 0,
      trustpilot: api.trustpilot ?? 0,
    };
  });
}