export type SalarySnapshot = {
  id?: string;
  month_key: string;
  title: string;
  rows: unknown[];
  totals: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
};

const STORAGE_KEY = "sbsupport_salary_snapshots";

function readSnapshots(): SalarySnapshot[] {
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

function writeSnapshots(items: SalarySnapshot[]) {
  if (typeof window === "undefined") return;

  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

export async function getSalarySnapshots() {
  try {
    const data = readSnapshots().sort((a, b) =>
      b.month_key.localeCompare(a.month_key)
    );

    return {
      data,
      error: null,
    };
  } catch (error) {
    return {
      data: [],
      error: error instanceof Error ? error : new Error("Failed to load snapshots"),
    };
  }
}

export async function saveSalarySnapshot(snapshot: SalarySnapshot) {
  try {
    const existing = readSnapshots();

    const now = new Date().toISOString();

    const index = existing.findIndex(
      (item) => item.month_key === snapshot.month_key
    );

    const nextSnapshot: SalarySnapshot = {
      ...snapshot,
      created_at:
        index >= 0 ? existing[index].created_at ?? now : snapshot.created_at ?? now,
      updated_at: now,
    };

    if (index >= 0) {
      existing[index] = nextSnapshot;
    } else {
      existing.push(nextSnapshot);
    }

    writeSnapshots(existing);

    return {
      data: nextSnapshot,
      error: null,
    };
  } catch (error) {
    return {
      data: null,
      error: error instanceof Error ? error : new Error("Failed to save snapshot"),
    };
  }
}

export async function deleteSalarySnapshot(monthKey: string) {
  try {
    const existing = readSnapshots();

    const updated = existing.filter(
      (item) => item.month_key !== monthKey
    );

    writeSnapshots(updated);

    return {
      data: null,
      error: null,
    };
  } catch (error) {
    return {
      data: null,
      error: error instanceof Error ? error : new Error("Failed to delete snapshot"),
    };
  }
}