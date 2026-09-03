export type SavedReport = {
  id?: string;
  report_key: string;
  title: string;
  report_type: "weekly" | "monthly";
  project: string;
  period: Record<string, unknown>;
  summary: Record<string, unknown>;
  projects: unknown[];
  tags: unknown[];
  agents: unknown[];
  notes?: string;
  ai_summary?: string;
  created_at?: string;
  updated_at?: string;
};

const STORAGE_KEY = "sbsupport_saved_reports";

function readReports(): SavedReport[] {
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

function writeReports(reports: SavedReport[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(reports));
}

export async function getSavedReports() {
  try {
    const data = readReports().sort((a, b) =>
      String(b.updated_at || "").localeCompare(String(a.updated_at || ""))
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
          : new Error("Failed to load saved reports"),
    };
  }
}

export async function saveReport(report: SavedReport) {
  try {
    const reports = readReports();
    const now = new Date().toISOString();

    const index = reports.findIndex(
      (item) => item.report_key === report.report_key
    );

    const nextReport: SavedReport = {
      ...report,
      created_at:
        index >= 0
          ? reports[index].created_at ?? now
          : report.created_at ?? now,
      updated_at: now,
    };

    if (index >= 0) {
      reports[index] = nextReport;
    } else {
      reports.push(nextReport);
    }

    writeReports(reports);

    return {
      data: nextReport,
      error: null,
    };
  } catch (error) {
    return {
      data: null,
      error:
        error instanceof Error
          ? error
          : new Error("Failed to save report"),
    };
  }
}

export async function deleteSavedReport(reportKey: string) {
  try {
    const reports = readReports().filter(
      (item) => item.report_key !== reportKey
    );

    writeReports(reports);

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
          : new Error("Failed to delete report"),
    };
  }
}