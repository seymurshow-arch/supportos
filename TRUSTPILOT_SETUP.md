# Trustpilot setup

The Trustpilot dashboard uses a server-side API key and an explicit Business Unit ID for each project. It does not use `/business-units/find` or `/business-units/search`.

Add these variables to `.env.local` and to Vercel Environment Variables:

```env
TRUSTPILOT_API_KEY=YOUR_TPK_API_KEY

TRUSTPILOT_LUNUBET_BUSINESS_UNIT_ID=65bbc7aabf9360966287f4b5
TRUSTPILOT_ROOSTINO_BUSINESS_UNIT_ID=69eb5d8904cc708333b071d6
TRUSTPILOT_WONDERLUCK_BUSINESS_UNIT_ID=68da5ffc6b90a6eb23a110d2
TRUSTPILOT_FANOBET_BUSINESS_UNIT_ID=68c2a920c613bae9ab6777e6
TRUSTPILOT_TIP_TOP_BUSINESS_UNIT_ID=673b79a4bfd7b10d2664b42e
TRUSTPILOT_50_CROWNS_BUSINESS_UNIT_ID=
TRUSTPILOT_HAHA_SPIN_BUSINESS_UNIT_ID=
TRUSTPILOT_GALLEON_BUSINESS_UNIT_ID=
```

After changing environment variables, restart the local server or redeploy on Vercel.

Projects without a configured Business Unit ID remain visible in the Trustpilot tabs and show a configuration message instead of making a failing API request.

## Period comparison and Generated Link share

The dashboard now classifies Trustpilot review sources as follows:

- `InvitationLinkApi` → Generated Link
- `BasicLink` → Basic Link
- `Organic` → Organic

Generated Link share is calculated as:

`InvitationLinkApi reviews / all reviews created in the selected period * 100`

To store historical TrustScore values, run `TRUSTPILOT_SNAPSHOTS.sql` once in Supabase SQL Editor. SupportOS saves one snapshot per project per day whenever the Trustpilot dashboard is loaded. Historical TrustScore values therefore become available from the first saved snapshot onward; review counts by source are calculated directly from Trustpilot API data.
