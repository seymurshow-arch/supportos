# Google Report Export setup

SupportOS can export the selected weekly period into a dedicated Google Spreadsheet.

## One-time setup

1. Upload/open the approved report template in Google Sheets (or use a blank spreadsheet).
2. Share the spreadsheet with the existing service account from `GOOGLE_SHEETS_CLIENT_EMAIL`.
3. Give that service account **Editor** access (Viewer is not enough for report export).
4. Copy the spreadsheet ID from its URL and add it to `.env.local` and Vercel:

```env
GOOGLE_REPORT_SPREADSHEET_ID=YOUR_SPREADSHEET_ID
```

The existing `GOOGLE_SHEETS_CLIENT_EMAIL` and `GOOGLE_SHEETS_PRIVATE_KEY` are reused.

## Export behavior

- Export is weekly only.
- Month is determined by the **end date** of the selected week.
- Missing project sheets are created automatically.
- Missing month sections are created automatically.
- Re-exporting the same week replaces that week instead of duplicating it.
- Tags are created dynamically only for tags present in that week.
- Tags are sorted by `Total` descending.
- Top 10 tags are highlighted.
- `Total Chat Time = Total Chats × Avg Chat Duration`.
- `ALL Brands` aggregates all project tabs using the legacy logic:
  - Total Chats = sum of project chats.
  - Total Chat Time = sum of project total chat time.
  - Avg Chat Duration = total chat time / total chats.
  - CSAT = average of project CSAT values with activity.
  - Tags = same tags summed across projects, then sorted and Top 10 highlighted.
- When a new month starts, the previous month's detail rows are grouped so they can be collapsed/expanded in Google Sheets.
