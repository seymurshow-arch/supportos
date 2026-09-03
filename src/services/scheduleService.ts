export type Schedule = {
  id: string;
  month_key: string;
  title: string;
  raw_text: string | null;
  parsed_data: any;
  stats: any;
};

const STORAGE_KEY = "sbsupport_schedules";

function readSchedules(): Schedule[] {
  if (typeof window === "undefined") return [];

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];

    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeSchedules(schedules: Schedule[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(schedules));
}

export async function getSchedules() {
  try {
    const data = readSchedules().sort((a, b) =>
      b.month_key.localeCompare(a.month_key)
    );

    return {
      data,
      error: null,
    };
  } catch (error) {
    return {
      data: [],
      error:
        error instanceof Error
          ? error
          : new Error("Failed to load schedules"),
    };
  }
}

export async function getSchedule(monthKey: string) {
  try {
    const data =
      readSchedules().find((item) => item.month_key === monthKey) ?? null;

    return {
      data,
      error: null,
    };
  } catch (error) {
    return {
      data: null,
      error:
        error instanceof Error
          ? error
          : new Error("Failed to load schedule"),
    };
  }
}

export async function saveSchedule(data: Omit<Schedule, "id">) {
  try {
    const schedules = readSchedules();

    const index = schedules.findIndex(
      (item) => item.month_key === data.month_key
    );

    const schedule: Schedule = {
      ...data,
      id:
        index >= 0
          ? schedules[index].id
          : `${data.month_key}-${Date.now()}`,
    };

    if (index >= 0) {
      schedules[index] = schedule;
    } else {
      schedules.push(schedule);
    }

    writeSchedules(schedules);

    return {
      data: schedule,
      error: null,
    };
  } catch (error) {
    return {
      data: null,
      error:
        error instanceof Error
          ? error
          : new Error("Failed to save schedule"),
    };
  }
}

export async function deleteSchedule(monthKey: string) {
  try {
    const schedules = readSchedules().filter(
      (item) => item.month_key !== monthKey
    );

    writeSchedules(schedules);

    return {
      data: null,
      error: null,
    };
  } catch (error) {
    return {
      data: null,
      error:
        error instanceof Error
          ? error
          : new Error("Failed to delete schedule"),
    };
  }
}