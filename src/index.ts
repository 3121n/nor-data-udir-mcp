#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const NSR_BASE = "https://data-nsr.udir.no/v3";
const NBR_BASE = "https://data-nbr.udir.no/v3";

async function udirGet<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    throw new Error(`UDIR ${res.status} ${res.statusText} for ${url}`);
  }
  return (await res.json()) as T;
}

// Listeobjekt fra /enheter/kommune/{nr} (begge registre, NSR har skole-flagg, NBR barnehage-flagg)
type ListeEnhet = {
  Orgnr?: string;
  Navn?: string;
  Karakteristikk?: string | null;
  Fylkesnr?: string;
  Kommunenr?: string;
  ErAktiv?: boolean;
  ErSkole?: boolean;
  ErGrunnskole?: boolean;
  ErVideregaaendeSkole?: boolean;
  ErPrivatskole?: boolean;
  ErOffentligSkole?: boolean;
  ErSpesialskole?: boolean;
  ErBarnehage?: boolean;
  ErOffentligBarnehage?: boolean;
  ErPrivatBarnehage?: boolean;
  ErInaktivIBasil?: boolean;
};

type DetaljEnhet = {
  Orgnr?: string;
  Navn?: string;
  Kommune?: { Kommunenr?: string; Navn?: string };
  Fylke?: { Fylkesnr?: string; Navn?: string };
  Beliggenhetsadresse?: { Adresse?: string; Postnr?: string; Poststed?: string };
  Koordinat?: { Lengdegrad?: number; Breddegrad?: number; GeoKilde?: string };
  Url?: string | null;
  Epost?: string | null;
  Telefon?: string | null;
  Maalform?: { Navn?: string };
  ErAktiv?: boolean;
  ErGrunnskole?: boolean;
  ErVideregaaendeSkole?: boolean;
  ErPrivatskole?: boolean;
  ErOffentligSkole?: boolean;
  ErSpesialskole?: boolean;
  Elevtall?: number | null;
  AnsatteFra?: number | null;
  AnsatteTil?: number | null;
  ErBarnehage?: boolean;
  ErOffentligBarnehage?: boolean;
  ErPrivatBarnehage?: boolean;
  Barnehagekategorier?: Array<{ Navn?: string }>;
  AntallBarn?: number | null;
  [k: string]: unknown;
};

function normKommunenr(nr: string): string {
  // UDIR bruker 4-sifret kommunenr med ledende null (Oslo = "0301")
  return nr.padStart(4, "0");
}

function skoleSammendrag(e: ListeEnhet) {
  return {
    orgnr: e.Orgnr,
    navn: e.Navn,
    kommunenr: e.Kommunenr,
    aktiv: e.ErAktiv === true,
    grunnskole: e.ErGrunnskole === true,
    videregaaende: e.ErVideregaaendeSkole === true,
    privat: e.ErPrivatskole === true,
    offentlig: e.ErOffentligSkole === true,
    spesialskole: e.ErSpesialskole === true,
  };
}

function barnehageSammendrag(e: ListeEnhet) {
  return {
    orgnr: e.Orgnr,
    navn: e.Navn,
    kommunenr: e.Kommunenr,
    aktiv: e.ErAktiv === true,
    privat: e.ErPrivatBarnehage === true,
    offentlig: e.ErOffentligBarnehage === true,
  };
}

function detalj(e: DetaljEnhet, register: "nsr" | "nbr") {
  const base = {
    orgnr: e.Orgnr,
    navn: e.Navn,
    kommune: e.Kommune ? { nr: e.Kommune.Kommunenr, navn: e.Kommune.Navn } : undefined,
    fylke: e.Fylke ? { nr: e.Fylke.Fylkesnr, navn: e.Fylke.Navn } : undefined,
    adresse: e.Beliggenhetsadresse
      ? [e.Beliggenhetsadresse.Adresse, e.Beliggenhetsadresse.Postnr, e.Beliggenhetsadresse.Poststed].filter(Boolean).join(", ")
      : undefined,
    koordinat:
      e.Koordinat && typeof e.Koordinat.Breddegrad === "number" && e.Koordinat.Breddegrad !== 0
        ? { lat: e.Koordinat.Breddegrad, lon: e.Koordinat.Lengdegrad, kilde: e.Koordinat.GeoKilde }
        : undefined, // UDIR leverer {0,0,"Undefined"} for enheter uten geokoding — behandles som manglende
    url: e.Url || undefined,
    epost: e.Epost || undefined,
    telefon: e.Telefon || undefined,
    aktiv: e.ErAktiv === true,
  };
  if (register === "nsr") {
    return {
      ...base,
      grunnskole: e.ErGrunnskole === true,
      videregaaende: e.ErVideregaaendeSkole === true,
      privat: e.ErPrivatskole === true,
      offentlig: e.ErOffentligSkole === true,
      spesialskole: e.ErSpesialskole === true,
      maalform: e.Maalform?.Navn,
      elevtall: e.Elevtall ?? undefined,
      ansatte: e.AnsatteFra != null ? { fra: e.AnsatteFra, til: e.AnsatteTil } : undefined,
    };
  }
  return {
    ...base,
    privat: e.ErPrivatBarnehage === true,
    offentlig: e.ErOffentligBarnehage === true,
    kategorier: (e.Barnehagekategorier || []).map((k) => k.Navn).filter(Boolean),
    antallBarn: e.AntallBarn ?? undefined,
  };
}

const server = new McpServer({ name: "drist-udir-mcp", version: "0.1.0" });

server.tool(
  "sok_skole",
  "Søk etter skoler i en kommune via Nasjonalt skoleregister (NSR/UDIR). Filtrer på navn og skoletype. Returnerer kompakt liste; bruk hent_skole for detaljer med koordinater og elevtall.",
  {
    kommunenummer: z.string().describe("4-sifret kommunenummer, f.eks. '0301' for Oslo (ledende null påkrevd, '301' normaliseres)"),
    navn: z.string().optional().describe("Delstreng-filter på skolenavn (ikke case-sensitivt)"),
    type: z.enum(["grunnskole", "videregaaende", "privat", "offentlig", "spesialskole", "alle"]).optional()
      .describe("Skoletype-filter (default: alle aktive skoler)"),
    inkluder_inaktive: z.boolean().optional().describe("Ta med nedlagte/inaktive enheter (default false)"),
  },
  async ({ kommunenummer, navn, type, inkluder_inaktive }) => {
    const knr = normKommunenr(kommunenummer);
    const alle = await udirGet<ListeEnhet[]>(`${NSR_BASE}/enheter/kommune/${knr}`);
    let skoler = alle.filter((e) => e.ErSkole === true);
    if (!inkluder_inaktive) skoler = skoler.filter((e) => e.ErAktiv === true);
    if (navn) {
      const q = navn.toLowerCase();
      skoler = skoler.filter((e) => (e.Navn || "").toLowerCase().includes(q));
    }
    if (type && type !== "alle") {
      const flagg: Record<string, keyof ListeEnhet> = {
        grunnskole: "ErGrunnskole",
        videregaaende: "ErVideregaaendeSkole",
        privat: "ErPrivatskole",
        offentlig: "ErOffentligSkole",
        spesialskole: "ErSpesialskole",
      };
      skoler = skoler.filter((e) => e[flagg[type]] === true);
    }
    const ut = skoler.map(skoleSammendrag);
    return {
      content: [{ type: "text" as const, text: JSON.stringify({ kommunenummer: knr, antall: ut.length, skoler: ut }, null, 2) }],
    };
  },
);

server.tool(
  "hent_skole",
  "Hent full detalj om én skole fra NSR (UDIR): adresse, koordinater (lat/lon), elevtall, ansatte, målform, skoletype, kontaktinfo.",
  {
    orgnr: z.string().describe("Organisasjonsnummer (9 siffer) for skolen, fra sok_skole"),
  },
  async ({ orgnr }) => {
    const e = await udirGet<DetaljEnhet>(`${NSR_BASE}/enhet/${orgnr.trim()}`);
    return {
      content: [{ type: "text" as const, text: JSON.stringify(detalj(e, "nsr"), null, 2) }],
    };
  },
);

server.tool(
  "sok_barnehage",
  "Søk etter barnehager i en kommune via Nasjonalt barnehageregister (NBR/UDIR). Filtrer på navn og eierform. Returnerer kompakt liste; bruk hent_barnehage for detaljer med koordinater.",
  {
    kommunenummer: z.string().describe("4-sifret kommunenummer, f.eks. '0301' for Oslo (ledende null påkrevd, '301' normaliseres)"),
    navn: z.string().optional().describe("Delstreng-filter på barnehagenavn (ikke case-sensitivt)"),
    eierform: z.enum(["privat", "offentlig", "alle"]).optional().describe("Eierform-filter (default: alle aktive)"),
    inkluder_inaktive: z.boolean().optional().describe("Ta med nedlagte/inaktive enheter (default false)"),
  },
  async ({ kommunenummer, navn, eierform, inkluder_inaktive }) => {
    const knr = normKommunenr(kommunenummer);
    const alle = await udirGet<ListeEnhet[]>(`${NBR_BASE}/enheter/kommune/${knr}`);
    let bhg = alle.filter((e) => e.ErBarnehage === true);
    if (!inkluder_inaktive) bhg = bhg.filter((e) => e.ErAktiv === true);
    if (navn) {
      const q = navn.toLowerCase();
      bhg = bhg.filter((e) => (e.Navn || "").toLowerCase().includes(q));
    }
    if (eierform === "privat") bhg = bhg.filter((e) => e.ErPrivatBarnehage === true);
    if (eierform === "offentlig") bhg = bhg.filter((e) => e.ErOffentligBarnehage === true);
    const ut = bhg.map(barnehageSammendrag);
    return {
      content: [{ type: "text" as const, text: JSON.stringify({ kommunenummer: knr, antall: ut.length, barnehager: ut }, null, 2) }],
    };
  },
);

server.tool(
  "hent_barnehage",
  "Hent full detalj om én barnehage fra NBR (UDIR): adresse, koordinater (lat/lon), eierform, kategorier, kontaktinfo.",
  {
    orgnr: z.string().describe("Organisasjonsnummer (9 siffer) for barnehagen, fra sok_barnehage"),
  },
  async ({ orgnr }) => {
    const e = await udirGet<DetaljEnhet>(`${NBR_BASE}/enhet/${orgnr.trim()}`);
    return {
      content: [{ type: "text" as const, text: JSON.stringify(detalj(e, "nbr"), null, 2) }],
    };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
