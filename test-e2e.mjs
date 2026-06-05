// Ende-til-ende-test: spawner serveren og kaller alle fire verktøy via stdio JSON-RPC med EKTE UDIR-kall
import { spawn } from "node:child_process";

const proc = spawn("node", ["dist/index.js"], { cwd: import.meta.dirname, stdio: ["pipe", "pipe", "inherit"] });
let buf = "";
const pending = new Map();
proc.stdout.on("data", (d) => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    const msg = JSON.parse(line);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  }
});

let nextId = 1;
function rpc(method, params) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, resolve);
    proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error(`timeout: ${method}`)); } }, 45000);
  });
}

function callTool(name, args) {
  return rpc("tools/call", { name, arguments: args });
}

let failures = 0;
function check(label, cond, extra = "") {
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${extra ? " — " + extra : ""}`);
  if (!cond) failures++;
}

try {
  await rpc("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "e2e", version: "0" },
  });
  proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");

  const tools = await rpc("tools/list", {});
  const names = (tools.result?.tools || []).map((t) => t.name).sort();
  check("tools/list = 4 verktøy", JSON.stringify(names) === JSON.stringify(["hent_barnehage", "hent_skole", "sok_barnehage", "sok_skole"]), names.join(","));

  // 1. sok_skole: grunnskoler i Oslo med 'oppsal' i navnet
  const s1 = await callTool("sok_skole", { kommunenummer: "0301", navn: "oppsal", type: "grunnskole" });
  const d1 = JSON.parse(s1.result.content[0].text);
  check("sok_skole Oslo/oppsal/grunnskole > 0 treff", d1.antall > 0, `antall=${d1.antall}`);
  const oppsal = d1.skoler.find((s) => /oppsal skole/i.test(s.navn || ""));
  check("sok_skole finner Oppsal skole m/orgnr", !!oppsal?.orgnr, oppsal?.orgnr);

  // 2. hent_skole: detalj med koordinater og elevtall
  const s2 = await callTool("hent_skole", { orgnr: oppsal.orgnr });
  const d2 = JSON.parse(s2.result.content[0].text);
  check("hent_skole har koordinat", typeof d2.koordinat?.lat === "number" && typeof d2.koordinat?.lon === "number", JSON.stringify(d2.koordinat));
  check("hent_skole har elevtall", typeof d2.elevtall === "number" && d2.elevtall > 0, `elevtall=${d2.elevtall}`);
  check("hent_skole grunnskole-flagg", d2.grunnskole === true);

  // 3. sok_barnehage: normalisering av kommunenr uten ledende null + eierform
  const s3 = await callTool("sok_barnehage", { kommunenummer: "301", eierform: "privat", navn: "espira" });
  const d3 = JSON.parse(s3.result.content[0].text);
  check("sok_barnehage normaliserer '301'->'0301'", d3.kommunenummer === "0301");
  check("sok_barnehage espira/privat i Oslo > 0 treff", d3.antall > 0, `antall=${d3.antall}`);

  // 4. hent_barnehage: detalj
  const bhg = d3.barnehager[0];
  const s4 = await callTool("hent_barnehage", { orgnr: bhg.orgnr });
  const d4 = JSON.parse(s4.result.content[0].text);
  check("hent_barnehage har navn + adresse", !!d4.navn && !!d4.adresse, `${d4.navn} | ${d4.adresse}`);
  check("hent_barnehage koordinat er gyldig eller utelatt (aldri 0,0)", d4.koordinat === undefined || (typeof d4.koordinat.lat === "number" && d4.koordinat.lat !== 0), JSON.stringify(d4.koordinat));

  // 5. feilhåndtering: ugyldig orgnr gir ryddig feil, ikke crash
  const s5 = await callTool("hent_skole", { orgnr: "000000000" });
  check("hent_skole ugyldig orgnr -> isError", s5.result?.isError === true || /UDIR 4|UDIR 5/.test(s5.result?.content?.[0]?.text || ""), (s5.result?.content?.[0]?.text || "").slice(0, 60));
} catch (e) {
  console.error("E2E-FEIL:", e.message);
  failures++;
} finally {
  proc.kill();
}
console.log(failures === 0 ? "\nALLE E2E-TESTER PASSERTE" : `\n${failures} FEIL`);
process.exit(failures === 0 ? 0 : 1);
