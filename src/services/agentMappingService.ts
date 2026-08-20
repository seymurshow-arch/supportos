export type AgentScheduleMapping = {
  schedule_name: string;
  email: string;
  created_at?: string;
  updated_at?: string;
};

type ApiError = {
  message: string;
};

type ServiceResult<T = unknown> = {
  data: T | null;
  error: ApiError | null;
};

async function parseResponse<T>(response: Response): Promise<ServiceResult<T>> {
  let body: any = null;

  try {
    body = await response.json();
  } catch {
    // Keep a useful fallback error below when the response is not JSON.
  }

  if (!response.ok) {
    return {
      data: null,
      error: {
        message:
          body?.error ||
          body?.message ||
          `Agent Mapping API returned ${response.status} ${response.statusText}`,
      },
    };
  }

  return {
    data: (body?.data ?? body ?? null) as T,
    error: null,
  };
}

export async function getAgentMappings(): Promise<ServiceResult<AgentScheduleMapping[]>> {
  try {
    const response = await fetch("/api/agent-mappings", {
      method: "GET",
      cache: "no-store",
      headers: {
        Accept: "application/json",
      },
    });

    return await parseResponse<AgentScheduleMapping[]>(response);
  } catch (error) {
    return {
      data: null,
      error: {
        message: error instanceof Error ? error.message : "Failed to load agent mappings",
      },
    };
  }
}

export async function upsertAgentMapping(
  scheduleName: string,
  email: string
): Promise<ServiceResult<AgentScheduleMapping>> {
  try {
    const response = await fetch("/api/agent-mappings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        schedule_name: scheduleName.trim(),
        email: email.trim().toLowerCase(),
      }),
    });

    return await parseResponse<AgentScheduleMapping>(response);
  } catch (error) {
    return {
      data: null,
      error: {
        message: error instanceof Error ? error.message : "Failed to save agent mapping",
      },
    };
  }
}

export async function deleteAgentMapping(
  scheduleName: string
): Promise<ServiceResult<null>> {
  try {
    const response = await fetch("/api/agent-mappings", {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        schedule_name: scheduleName.trim(),
      }),
    });

    return await parseResponse<null>(response);
  } catch (error) {
    return {
      data: null,
      error: {
        message: error instanceof Error ? error.message : "Failed to delete agent mapping",
      },
    };
  }
}
