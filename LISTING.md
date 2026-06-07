# UDIR Schools & Kindergartens MCP

**Give your AI agent live access to every Norwegian school and kindergarten — searchable by municipality, with coordinates, pupil counts and ownership.**

This is a stdio Model Context Protocol (MCP) server that wraps UDIR's two open national registries:

- **NSR** — Nasjonalt skoleregister (national school registry)
- **NBR** — Nasjonalt barnehageregister (national kindergarten registry)

Both are public, auth-free REST APIs. No API key, no account.

## Why this server

- **Family-relocation assistants** — given a target municipality, an agent can list every school and kindergarten, pull addresses and coordinates, and rank them by distance to a prospective home.
- **School-comparison tools** — fetch pupil counts, staff bands, language form (målform) and school type (primary / upper-secondary / private / public / special) to compare schools side by side.
- **Childcare-availability research** — enumerate public vs. private kindergartens in an area, with categories and contact info, to map local capacity.
- **Real-estate & neighbourhood analytics** — combine with a geocoder to compute "schools/kindergartens near this point" and enrich property listings with verified education data straight from the source registry.

## Tools

| Tool | What it returns |
|---|---|
| `sok_skole` | Compact list of schools in a municipality (NSR). Filter by name substring and type (grunnskole / videregaaende / privat / offentlig / spesialskole); option to include inactive units. |
| `hent_skole` | Full detail for one school by org number: address, coordinates (lat/lon), pupil count, staff band, language form, school type and contact info. |
| `sok_barnehage` | Compact list of kindergartens in a municipality (NBR). Filter by name substring and ownership (privat / offentlig); option to include inactive units. |
| `hent_barnehage` | Full detail for one kindergarten by org number: address, coordinates (lat/lon), ownership, categories and contact info. |

Municipality numbers are the 4-digit Norwegian `kommunenummer` (e.g. `0301` for Oslo); a leading zero is added automatically if you pass `301`.

## Install

Run directly with `npx` (no global install needed):

```bash
npx @nor-data/udir-mcp
```

### Claude Desktop / Claude Code

Add to your MCP config (`claude_desktop_config.json`, or via `claude mcp add`):

```json
{
  "mcpServers": {
    "udir": {
      "command": "npx",
      "args": ["-y", "@nor-data/udir-mcp"]
    }
  }
}
```

### Cursor

Add to `~/.cursor/mcp.json` (or the project `.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "udir": {
      "command": "npx",
      "args": ["-y", "@nor-data/udir-mcp"]
    }
  }
}
```

## Data source & attribution

Data comes directly, in real time, from UDIR (Utdanningsdirektoratet — the Norwegian Directorate for Education and Training):

- NSR: `https://data-nsr.udir.no/v3`
- NBR: `https://data-nbr.udir.no/v3`

These are UDIR's open, publicly accessible registry APIs. This server is an independent, unofficial wrapper and is not affiliated with or endorsed by UDIR. The server code is licensed MIT; the underlying registry data is owned and published by UDIR — attribute UDIR (NSR/NBR) as the data source in any product that surfaces it.

## Known limitations

These reflect how the upstream UDIR API behaves and how this server handles it:

- **Missing coordinates appear as 0,0.** UDIR returns `{Lengdegrad: 0, Breddegrad: 0, GeoKilde: "Undefined"}` for units that have not been geocoded. The server treats this as a missing coordinate and omits the `koordinat` field rather than returning a false 0,0 location.
- **Server-side name search is not supported upstream.** The `Navn` query parameter on UDIR's `/v3/enheter` endpoint is ignored by the API, so name filtering is performed client-side after fetching a municipality's units. As a result, the `navn` filter only narrows results within a single municipality — you must always supply a `kommunenummer`.
- **Test units are filtered out.** The registries contain test entries (org numbers under `U999…`, municipality `2599`); these are implicitly excluded from municipality searches.
- **Inactive units are hidden by default.** Closed/decommissioned schools and kindergartens are excluded unless you pass `inkluder_inaktive: true`.

## Pricing (Apify)

When listed as an Apify Actor, this server runs in MCP Standby mode and is monetized pay-per-event:

- **Actor start** — $0.001 flat per run start.
- **Tool call** — $0.002 per completed MCP tool call.

_Pricing is indicative and will be finalized on the Apify Store listing._
