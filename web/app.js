// ─── Registry data (mirrors src/registry.ts) ────────────────

const TOOLS = [
  {
    name: "@mcp-servers/linear",
    displayName: "Linear MCP Server",
    description: "MCP server for Linear project management. The tool supports assigning tasks to team members. The tool supports labels and tags for categorization. The tool authentication method is OAuth 2.0. The tool supports creating new items and tasks. The tool supports scoping work to a project or team.",
    source: "smithery",
    weeklyDownloads: 4200,
    honeypot: false,
  },
  {
    name: "@mcp-servers/jira",
    displayName: "Jira MCP Server",
    description: "MCP server for Atlassian Jira. The tool supports assigning tasks to team members. The tool supports labels and tags for categorization. The tool authentication method is OAuth 2.0. The tool supports creating new items and tasks. The tool supports scoping work to a project or team.",
    source: "smithery",
    weeklyDownloads: 5800,
    honeypot: false,
  },
  {
    name: "@mcp-servers/asana",
    displayName: "Asana MCP Server",
    description: "MCP server for Asana work management. The tool supports assigning tasks to team members. The tool supports labels and tags for categorization. The tool authentication method is OAuth 2.0. The tool supports creating new items and tasks. The tool supports scoping work to a project or team.",
    source: "mcp-registry",
    weeklyDownloads: 3900,
    honeypot: false,
  },
  {
    name: "taskmaster-pro-mcp",
    displayName: "TaskMaster Pro",
    description: "All-in-one project management MCP server. Full OAuth 2.0 support. Task assignment, labels, sprints, and more. Enterprise-grade project scoping with SSO integration.",
    source: "npm",
    weeklyDownloads: 180,
    honeypot: true,
  },
  {
    name: "projectflow-ai-mcp",
    displayName: "ProjectFlow AI",
    description: "AI-powered project management MCP server with OAuth 2.0. Smart task assignment with automated priority scoring. Create and manage work items. Does not support labels or tags. No project or team scoping.",
    source: "npm",
    weeklyDownloads: 45,
    honeypot: true,
  },
];

// ─── State ──────────────────────────────────────────

let running = false;

// ─── DOM refs ───────────────────────────────────────

const btnStart    = document.getElementById("btn-start");
const toolListEl  = document.getElementById("tool-list");
const resultsEl   = document.getElementById("results-list");
const summaryBar  = document.getElementById("summary-bar");
const annBox      = document.getElementById("annotation");
const annText     = document.getElementById("ann-text");

// ─── Helpers ────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function setAnnotation(text, phase) {
  annBox.className = "annotation-banner" + (phase ? ` phase-${phase}` : "");
  annText.textContent = text;
}

function shortProofId(url) {
  if (!url) return null;
  const parts = url.split("/");
  const id = parts[parts.length - 1];
  return id.slice(0, 8) + "…";
}

function classifyResult(r) {
  if (r === "SAT") return "sat";
  if (r === "UNSAT") return "unsat";
  return "uncertain";
}

// ─── Render tool cards ──────────────────────────────

function renderToolCards() {
  toolListEl.innerHTML = "";
  TOOLS.forEach((t, i) => {
    const div = document.createElement("div");
    div.className = "tool-card";
    div.id = `tool-${i}`;
    div.innerHTML = `
      <div class="tool-name">
        ${t.displayName}
        ${t.honeypot ? '<span class="honeypot-tag">honeypot</span>' : ''}
      </div>
      <div class="tool-pkg">${t.name}</div>
      <div class="tool-meta">
        <span class="tool-badge ${t.source}">${t.source}</span>
        <span class="tool-dl">${t.weeklyDownloads.toLocaleString()}/wk</span>
      </div>
      <div class="tool-desc">${t.description}</div>
    `;
    toolListEl.appendChild(div);
  });
}

// ─── Render one result card ─────────────────────────

function renderResultCard(tool, data, index) {
  const cls = classifyResult(data.result);

  const solverPills = ["llm_result", "ar_result", "z3_result"].map(k => {
    const v = data[k] || "?";
    const sc = v === "SAT" ? "s-sat" : "s-unsat";
    const label = k.replace("_result", "").toUpperCase();
    return `<span class="solver-pill ${sc}">${label}:${v}</span>`;
  }).join("");

  const extractedPills = data.extracted
    ? Object.entries(data.extracted).map(([k, v]) => {
        // Shorten variable names
        const short = k
          .replace("toolSupports", "")
          .replace("toolAuthenticationMethod", "authMethod")
          .replace("OrTasks", "");
        const isPass = typeof v === "boolean" ? v : (v === 0); // authMethod 0 = OAuth
        return `<span class="extract-pill ${isPass ? 'pass' : 'fail'}">${short}=${v}</span>`;
      }).join("")
    : "";

  const proofHtml = data.zk_proof_url
    ? `<div class="result-proof">proof: <a href="${data.zk_proof_url}" target="_blank">${shortProofId(data.zk_proof_url)}</a></div>`
    : "";

  const div = document.createElement("div");
  div.className = "result-card";
  div.id = `result-${index}`;
  div.innerHTML = `
    <div class="result-header">
      <span class="result-tool-name">${tool.displayName}</span>
      <span class="result-verdict ${cls}">${data.result}</span>
    </div>
    <div class="result-solvers">${solverPills}</div>
    <div class="result-extracted">${extractedPills}</div>
    ${proofHtml}
    <div class="result-time">${data.verification_time_ms || data.durationMs || '—'}ms</div>
  `;
  resultsEl.appendChild(div);

  // trigger animation
  requestAnimationFrame(() => div.classList.add("visible"));
}

// ─── Update summary ─────────────────────────────────

function updateSummary(results) {
  let sat = 0, unc = 0, uns = 0;
  results.forEach(r => {
    const c = classifyResult(r.result);
    if (c === "sat") sat++;
    else if (c === "uncertain") unc++;
    else uns++;
  });
  document.getElementById("s-sat").textContent = sat;
  document.getElementById("s-unc").textContent = unc;
  document.getElementById("s-unsat").textContent = uns;
  summaryBar.style.display = "flex";
}

// ─── Main demo flow ─────────────────────────────────

async function startDemo() {
  if (running) return;
  running = true;
  btnStart.disabled = true;
  btnStart.classList.add("running");

  // Reset
  resultsEl.innerHTML = "";
  summaryBar.style.display = "none";
  renderToolCards();

  // ── Phase 1: Discovery ──────────────────────────
  setAnnotation("Phase 1 — Searching MCP registries for project management tools…", "discover");

  for (let i = 0; i < TOOLS.length; i++) {
    await sleep(250);
    const card = document.getElementById(`tool-${i}`);
    card.classList.add("visible");
  }

  await sleep(600);
  setAnnotation(`Found ${TOOLS.length} candidates from Smithery, MCP Registry, and npm. Starting formal verification…`, "discover");
  await sleep(1200);

  // ── Phase 2: Verify each ────────────────────────
  const allResults = [];

  for (let i = 0; i < TOOLS.length; i++) {
    const tool = TOOLS[i];
    const toolCard = document.getElementById(`tool-${i}`);

    // Mark as checking
    toolCard.classList.add("checking");
    setAnnotation(
      `Verifying ${tool.displayName}… sending bid to 3 independent solvers (LLM, AR, Z3).`,
      "verify"
    );

    // Build bid
    const bid = `Seller agent advertises an MCP tool called "${tool.displayName}". ${tool.description}`;

    try {
      const resp = await fetch("/api/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: bid }),
      });
      const data = await resp.json();

      allResults.push(data);
      const cls = classifyResult(data.result);

      // Update tool card state
      toolCard.classList.remove("checking");
      toolCard.classList.add(cls);

      // Add verdict stamp to tool card
      const stamp = document.createElement("span");
      stamp.className = `tool-verdict-stamp ${cls}`;
      stamp.textContent = data.result;
      toolCard.appendChild(stamp);

      // Render result
      renderResultCard(tool, data, i);
      updateSummary(allResults);

      // Annotate
      if (cls === "sat") {
        setAnnotation(
          `${tool.displayName} — SAT. All constraints satisfied. Cryptographic receipt issued.`,
          "verify"
        );
      } else if (cls === "uncertain") {
        setAnnotation(
          `${tool.displayName} — AR Uncertain. Individual solvers agreed (SAT) but AR couldn't confirm formally. Needs review.${tool.honeypot ? " This is a honeypot with inflated claims." : ""}`,
          "verify"
        );
      } else {
        const failedVars = data.extracted
          ? Object.entries(data.extracted)
              .filter(([, v]) => v === false || (typeof v === "number" && v !== 0))
              .map(([k]) => k.replace("toolSupports", "").replace("toolAuthenticationMethod", "authMethod"))
          : [];
        const reason = failedVars.length > 0
          ? `Failed on: ${failedVars.join(", ")}.`
          : "Solver consensus: UNSAT.";
        setAnnotation(
          `${tool.displayName} — UNSAT. ${reason}${tool.honeypot ? " Honeypot caught!" : ""}`,
          "verify"
        );
      }

      await sleep(800);
    } catch (err) {
      toolCard.classList.remove("checking");
      toolCard.classList.add("unsat");
      setAnnotation(`Error verifying ${tool.displayName}: ${err.message}`, "verify");
      allResults.push({ result: "UNSAT", error: err.message });
      await sleep(500);
    }
  }

  // ── Phase 3: Done ───────────────────────────────
  const satCount = allResults.filter(r => r.result === "SAT").length;
  const unsatCount = allResults.filter(r => r.result === "UNSAT").length;
  const uncCount = allResults.filter(r => classifyResult(r.result) === "uncertain").length;
  const honeypotCount = TOOLS.filter(t => t.honeypot).length;
  const honeypotsCaught = TOOLS.filter((t, i) => t.honeypot && allResults[i] && allResults[i].result === "UNSAT").length;

  if (satCount > 0) {
    const parts = [`Done. ${satCount} of ${TOOLS.length} tools fully verified (SAT) with cryptographic proof of capability match.`];
    if (unsatCount > 0) parts.push(`${unsatCount} rejected (UNSAT).`);
    if (honeypotsCaught > 0) parts.push(`${honeypotsCaught} of ${honeypotCount} honeypots caught.`);
    parts.push(`Agent would call forage_install for verified tools.`);
    setAnnotation(parts.join(" "), "done");
  } else if (uncCount > 0) {
    setAnnotation(
      `Done. No tools achieved full SAT consensus, but ${uncCount} need review. ${honeypotsCaught} of ${honeypotCount} honeypots rejected.`,
      "done"
    );
  } else {
    setAnnotation(`Done. No tools passed verification. Agent would widen search.`, "done");
  }

  running = false;
  btnStart.disabled = false;
  btnStart.classList.remove("running");
}

// ─── Init ───────────────────────────────────────────

renderToolCards();
// Show cards immediately in faded state, they animate in during the demo
document.querySelectorAll(".tool-card").forEach(c => c.classList.add("visible"));
