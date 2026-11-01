# Setup: everything you need to configure

## Now (to deploy the game)

### 1. Cloudflare API token
1. Cloudflare dashboard → your profile icon (top right) → **My Profile** → **API Tokens**.
2. **Create Token** → template **Edit Cloudflare Workers** → **Use template**.
3. **Account Resources**: Include → your account.
   **Zone Resources**: Include → All zones (or just your domain, once you have one).
4. **Continue to summary** → **Create Token** → copy it (shown once).

### 2. Cloudflare Account ID
Dashboard → **Workers & Pages**. The Account ID is in the right-hand sidebar.

### 3. Put both into GitHub
GitHub → `activityroster-jpg/dublin-transit` → **Settings** → **Secrets and variables** →
**Actions** → **New repository secret**:

| Name | Value |
|---|---|
| `CLOUDFLARE_API_TOKEN` | the token from step 1 |
| `CLOUDFLARE_ACCOUNT_ID` | the ID from step 2 |

That's all. Every push to `main` then builds and deploys automatically. Other branches get a
preview version.

## Later (only when we get there)

| When | What | Where |
|---|---|---|
| You want a proper web address | Add the domain (e.g. `dublintransit.ie`) to Cloudflare. I'll wire the route | Cloudflare → **Add a domain** |
| 3D art outgrows the site (files > 25 MB) | R2 bucket `dublin-transit-assets`, location **EU** | Cloudflare → **R2** → **Create bucket**. The token above already covers R2 |
| Leaderboards or cloud saves | D1 database `dublin-transit` (EU) | Cloudflare → **Storage & Databases** → **D1** |

## No keys needed for

- OpenStreetMap (track, buildings, signals)
- National Transport Authority GTFS timetable
- Irish Rail realtime API (not used yet)
- AWS Terrain Tiles (elevation)
