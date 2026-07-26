# SupportOS Master Spec

## Project Goal
SupportOS is an internal support command platform for casino/support operations. It replaces the old LiveChat analytics project with a cleaner architecture.

Core principle:
- No `masterData` as business-data source.
- No `localStorage` for business data.
- Supabase stores saved/manual/persistent data.
- LiveChat API is the source of truth for analytics.
- Modules must be independent and read data directly from their source.

---

## Current Stack
- Next.js App Router
- TypeScript
- Tailwind-style UI
- Supabase
- LiveChat API
- HelpDesk API for email KPI where needed

Important auth/env files:
- `.env.local`
- `src/livechat.ts`
- `src/lib/supabase.ts`

LiveChat auth uses:
- `LIVECHAT_ACCOUNT_ID`
- `LIVECHAT_PAT`
- Basic Auth with `Account ID : PAT`

---

## Completed Modules

### 1. Schedule — DONE
Path:
- `src/app/schedule/page.tsx`
- `src/lib/schedule/parseSchedule.ts`
- `src/services/scheduleService.ts`

Source of truth:
- Supabase table `schedules`

Features:
- Paste schedule from Google Sheets.
- Editable schedule grid.
- Save schedule to Supabase.
- Load schedule from Supabase.
- Delete schedule.
- Shared between browsers/users.
- Editable Grid is the main source of truth after import.
- Paste text can include emails after slash, e.g. `Volodymyr Z / vz.sup@50-partners.com`.
- System reads emails but does not need to display them in schedule grid.

Schedule logic:
- `D` = day shift.
- `E` = evening/day shift.
- `N` = night shift.
- `Day SM`, `Training`, `Sick leave`, custom time ranges are supported.
- Night shift rule: if `N` is written under day X, actual work is next calendar day 00:00–08:00.

---

### 2. Agent Breaks — MOSTLY DONE
Path:
- `src/app/agent-breaks/page.tsx`
- `src/app/api/livechat/breaks/route.ts`

Source of truth:
- Schedule from Supabase.
- LiveChat status/break data from LiveChat API.

Logic:
- Breaks are counted only inside scheduled working hours.
- If agent is away outside scheduled shift, it must not count.
- Night shift must be calculated for next calendar day 00:00–08:00.
- Grid should look like schedule by days.
- Green: ≤30 min.
- Red: >30 min.

Known status:
- Main logic is working.
- UI can be polished later.

---

### 3. KPI & Salary — DONE
Path:
- `src/app/kpi-salary/page.tsx`
- `src/app/api/livechat/agent-kpi/route.ts`
- `src/services/kpiService.ts`
- `src/services/salaryService.ts`

Source of truth:
- Schedule from Supabase.
- KPI from LiveChat API.
- Saved salary snapshots from Supabase table `salary_snapshots`.

Rules:
- Agent list comes from saved Schedule.
- Agent matching is by email.
- Chats include all chats.
- FRT chats include all chats.
- ART includes all chats.
- Trustpilot counts chats tagged `Trustpilot review`.
- CSAT is the only metric where tag `spam` is excluded.
- Salary: `Base Salary = Day Hours × Day Rate + Night Hours × Night Rate`.
- Final salary = Base Salary + KPI Bonus.

Completed:
- KPI loads correctly.
- CSAT spam rule works.
- Salary calculation works.
- Save Month works.
- Saved Salary Snapshots work.
- Delete Snapshot works.
- Data syncs between browsers via Supabase.

---

### 4. Reports — IN PROGRESS
Paths:
- `src/app/reports/page.tsx`
- `src/app/api/livechat/reports/route.ts`
- `src/app/api/livechat/tag-report/route.ts`
- `src/services/reportService.ts`
- `src/services/livechatProjectsService.ts`

Source of truth:
- LiveChat API for live data.
- Supabase table `saved_reports` for saved report snapshots.

Current design:
- Weekly / Monthly selector.
- From / To dates for weekly.
- Month selector for monthly.
- Project selector.
- Refresh LiveChat.
- Save Report.
- Saved Reports.
- Project Summary.
- Top Tags.
- Notes.

Reports API:
- `/api/livechat/reports` returns summary and project split.
- Projects are auto-detected from LiveChat groups using `livechatProjectsService`.
- It must group language/country groups into main brands:
  - LunuBet
  - Roostino
  - WonderLuck
  - FanoBet
  - Tip-top
  - 50 Crowns
  - Haha Spin

Important Reports rules:
- FRT must be removed from Reports UI for now.
- Reports should show: Total Chats, Missed, CSAT, Avg Duration, Total Chat Time if needed.
- CSAT excludes only `spam`.
- Top Tags should exclude service/system tags.
- Saved Reports should store full snapshot, not recalculate old reports.

Tag Report API:
- `/api/livechat/tag-report`
- Uses LiveChat tags report + archives for VIP/Regular split.
- Correct VIP/Regular logic:
  - Total = all chats with this tag from LiveChat reports API.
  - VIP = chats with this tag AND `VIP player` tag.
  - Regular = Total - VIP.
- Do not count VIP/Regular by counting VIP tag totals only.
- Service tags to exclude from Top Tags:
  - `chatbot`
  - `chatbot-transfer`
  - `vip player`
  - `trustpilot review`
  - `vip transfer`
  - `test-chat`
  - `empty chat`
  - `just talk`
  - `spam`
  - `system`
  - `bot`
  - `chat-summary`
  - `sentiment-positive`
  - `sentiment-neutral`
  - `sentiment-negative`

Current Reports issues to remember:
- Need proper custom dark calendar, not plain browser date picker.
- Current date field had text input and calendar did not open.
- Reports page must not show old data while new data is loading.
- On filter change, clear old live data and show loading/empty state until fresh report loads.
- Project list should load automatically on page open, not only after Refresh.
- Project selector should always include all projects after first load.

---

## Supabase Tables

### schedules
Used by Schedule, Agent Breaks, KPI & Salary.

### salary_snapshots
Used by KPI & Salary.

### saved_reports
Used by Reports.

Expected saved_reports fields:
- `report_key`
- `title`
- `report_type`
- `project`
- `period`
- `summary`
- `projects`
- `tags`
- `agents`
- `notes`
- `ai_summary`

---

## UI Rules
- Keep SupportOS dark style.
- Use cards, cyan/emerald accents, rounded panels.
- Avoid default ugly browser controls when possible.
- Use full replacement files when changes are large.
- User prefers downloadable ready files for large `page.tsx` files.
- Do not give partial snippets for big files unless explicitly asked.

---

## Next Module: Command Center
Command Center should be the main landing page / executive overview.

Goal:
- Show high-level status of SupportOS modules.
- Pull useful latest snapshots from Supabase and LiveChat.
- It should not duplicate full Reports/KPI logic.
- It should summarize and link to modules.

Suggested blocks:
1. Header: SupportOS Command Center.
2. Today / selected period overview.
3. LiveChat Summary cards:
   - Total chats
   - Missed chats
   - CSAT
   - Avg duration
4. KPI & Salary latest saved snapshot:
   - Latest month
   - Agents count
   - Payroll total
5. Schedule status:
   - Latest saved schedule
   - Agents count
   - Days count
6. Reports status:
   - Latest saved report
   - Top 3 tags
   - CSAT
7. Agent Breaks alert preview:
   - agents over 30 min breaks, if available
8. Quick actions:
   - Open Reports
   - Open KPI & Salary
   - Open Schedule
   - Open Agent Breaks
9. System status:
   - LiveChat ready
   - Supabase ready
   - Last saved report

Command Center should be clean, not too overloaded.

---

## Important User Preferences
- User wants direct action, not long explanations.
- If user says `давай`, continue to next implementation step.
- If user says `давай далі`, assume previous step is done.
- For big files, provide full ready file or downloadable file.
- Do not ask unnecessary confirmations.
- Use Ukrainian/Russian mixed style if user writes that way.
