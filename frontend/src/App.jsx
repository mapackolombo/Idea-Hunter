import { useState, useRef, useEffect } from "react";

// In produzione: sostituisci con il tuo URL Railway, es. https://idea-hunter.up.railway.app/api/hunt
const ANTHROPIC_API = "https://api.anthropic.com/v1/messages";
const USE_PROXY = true; //v2
const PROXY_URL = "https://idea-hunter.onrender.com/api/hunt";

const MARKETS = [
  "Italia", "Francia", "Germania", "Spagna", "Portogallo",
  "Polonia", "Romania", "Grecia", "Brasile", "Messico",
  "Argentina", "India", "Indonesia", "Nigeria", "Sudafrica"
];
const TARGETS = [
  "Consumer (B2C)", "PMI / Artigiani", "Professionisti", "Anziani / Over 60",
  "Gen Z / Studenti", "Genitori / Famiglie", "Freelance", "Ristoratori / HoReCa",
  "Agricoltori / Rurale", "Donne imprenditrici", "Immigrati / Expat", "Healthcare"
];
const SOURCE_COUNTRIES = [
  "USA", "UK", "Paesi Nordici", "Giappone", "Australia",
  "Corea del Sud", "Canada", "Israele", "Singapore", "Olanda",
  "Nuova Zelanda", "Estonia", "Cina", "Brasile", "India"
];

const SECTORS = [
  "Qualsiasi", "Fintech / Pagamenti", "Salute / Benessere", "Educazione",
  "Food / Agricoltura", "Mobilità / Trasporti", "Immobiliare",
  "Legal / Burocrazia", "HR / Lavoro", "E-commerce / Retail",
  "Sostenibilità", "Intrattenimento", "Turismo", "B2B SaaS"
];

const SYSTEM_PROMPT = `Sei un agente specializzato nella ricerca di opportunità di business digitali non ancora sfruttate.

Il tuo processo è RIGIDAMENTE questo:

**FASE 1 — SCOPERTA PAIN POINT**
Cerca su web pain point reali e discussioni in forum, Reddit, community del mercato target. Identifica problemi concreti non risolti. Cita fonti reali.

**FASE 2 — IDEA DA ALTRO PAESE**
Cerca prodotti/servizi digitali di successo nel paese sorgente che NON esistono ancora nel mercato target. Verifica che abbiano trazione reale (utenti, revenue, recensioni). Cita i prodotti trovati con nomi reali.

**FASE 3 — VERIFICA GAP**
Fai ricerche esplicite per verificare che l'idea NON esista già nel mercato target. Cerca competitor diretti. Se esiste già → ricomincia da capo con un'altra idea.

**FASE 4 — BRIEF FINALE**
Solo se il gap è confermato, produci un brief strutturato con:
- Nome dell'idea
- Il prodotto ispirazione (paese + nome + link se disponibile)  
- Il problema che risolve
- Perché funzionerebbe nel mercato target
- Come implementarla tecnicamente (stack, complessità, tempo stimato)
- Modello di monetizzazione
- Rischi principali
- Stima realistica di potenziale (utenti, revenue)

Sii onesto e critico. Non inventare dati. Se non trovi gap reali dillo chiaramente.
Scrivi in italiano. Usa emoji sparingly per strutturare la risposta. Formatta con markdown.`;

function TypingDots() {
  return (
    <span className="typing-dots">
      <span>.</span><span>.</span><span>.</span>
    </span>
  );
}

function PhaseIndicator({ phase }) {
  const phases = [
    { id: 1, label: "Pain point", icon: "🔍" },
    { id: 2, label: "Idea estera", icon: "🌍" },
    { id: 3, label: "Verifica gap", icon: "✓" },
    { id: 4, label: "Brief", icon: "📋" },
  ];
  return (
    <div className="phase-track">
      {phases.map((p) => (
        <div key={p.id} className={`phase-step ${phase >= p.id ? "active" : ""} ${phase === p.id ? "current" : ""}`}>
          <span className="phase-icon">{p.icon}</span>
          <span className="phase-label">{p.label}</span>
        </div>
      ))}
    </div>
  );
}

function ResultCard({ result }) {
  const lines = result.split("\n");
  return (
    <div className="result-card">
      {lines.map((line, i) => {
        if (line.startsWith("# ")) return <h1 key={i}>{line.slice(2)}</h1>;
        if (line.startsWith("## ")) return <h2 key={i}>{line.slice(3)}</h2>;
        if (line.startsWith("### ")) return <h3 key={i}>{line.slice(4)}</h3>;
        if (line.startsWith("- ")) return <li key={i}>{line.slice(2)}</li>;
        if (line.startsWith("**") && line.endsWith("**")) return <strong key={i}>{line.slice(2, -2)}</strong>;
        if (line === "") return <br key={i} />;
        // inline bold
        const parts = line.split(/\*\*(.*?)\*\*/g);
        if (parts.length > 1) {
          return (
            <p key={i}>
              {parts.map((part, j) =>
                j % 2 === 1 ? <strong key={j}>{part}</strong> : part
              )}
            </p>
          );
        }
        return <p key={i}>{line}</p>;
      })}
    </div>
  );
}

export default function IdeaHunter() {
  const [market, setMarket] = useState("Italia");
  const [target, setTarget] = useState("Consumer (B2C)");
  const [source, setSource] = useState("USA");
  const [sector, setSector] = useState("Qualsiasi");
  const [loading, setLoading] = useState(false);
  const [phase, setPhase] = useState(0);
  const [streamText, setStreamText] = useState("");
  const [finalResult, setFinalResult] = useState("");
  const [error, setError] = useState("");
  const [history, setHistory] = useState([]);
  const streamRef = useRef("");
  const abortRef = useRef(null);

  const detectPhase = (text) => {
    if (text.includes("FASE 4") || text.includes("Brief finale") || text.includes("brief finale")) return 4;
    if (text.includes("FASE 3") || text.includes("Verifica") || text.includes("verifica")) return 3;
    if (text.includes("FASE 2") || text.includes("paese sorgente") || text.includes("Idea da")) return 2;
    if (text.includes("FASE 1") || text.includes("Pain point") || text.includes("pain point")) return 1;
    return phase;
  };

  const hunt = async () => {
    if (loading) return;
    setLoading(true);
    setPhase(1);
    setStreamText("");
    setFinalResult("");
    setError("");
    streamRef.current = "";

    const userPrompt = `Trova un'idea di business digitale vincente per questo contesto:

- **Mercato target**: ${market}
- **Target utente**: ${target}
- **Settore**: ${sector}
- **Paese sorgente (dove l'idea ha già successo)**: ${source}
${sector !== "Qualsiasi" ? `\nConcentrati sul settore ${sector}.` : ""}

Segui rigorosamente il processo in 4 fasi. Usa il web search per ogni fase. Non inventare nulla.`;

    try {
      const endpoint = USE_PROXY ? PROXY_URL : ANTHROPIC_API;
      const headers = USE_PROXY
        ? { "Content-Type": "application/json" }
        : {
            "Content-Type": "application/json",
            "anthropic-version": "2023-06-01",
            "anthropic-dangerous-direct-browser-access": "true",
          };

      const response = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 4000,
          system: SYSTEM_PROMPT,
          tools: [{ type: "web_search_20250305", name: "web_search" }],
          messages: [{ role: "user", content: userPrompt }],
          stream: false,
        }),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error?.message || "Errore API");
      }

      const data = await response.json();

      // Extract text from content blocks
      let fullText = "";
      const content = data?.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === "text") {
            fullText += block.text;
          }
        }
      } else {
        fullText = JSON.stringify(data);
      }
      if (!fullText) throw new Error("Risposta vuota dal server");

      // Animate text display
      setPhase(1);
      let i = 0;
      const words = fullText.split(" ");
      const interval = setInterval(() => {
        if (i < words.length) {
          const chunk = words.slice(0, i + 1).join(" ");
          setStreamText(chunk);
          setPhase(detectPhase(chunk));
          i += 3;
        } else {
          clearInterval(interval);
          setFinalResult(fullText);
          setStreamText("");
          setPhase(5);
          setHistory(prev => [{
            market, target, source, sector,
            result: fullText,
            timestamp: new Date().toLocaleTimeString("it-IT")
          }, ...prev.slice(0, 4)]);
          setLoading(false);
        }
      }, 30);

    } catch (e) {
      setError(e.message);
      setLoading(false);
      setPhase(0);
    }
  };

  const reset = () => {
    setFinalResult("");
    setStreamText("");
    setPhase(0);
    setError("");
  };

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=DM+Mono:wght@300;400;500&display=swap');

        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        body {
          background: #0a0a0f;
          color: #e8e4dc;
          font-family: 'DM Mono', monospace;
          min-height: 100vh;
        }

        .app {
          min-height: 100vh;
          display: flex;
          flex-direction: column;
          background: #0a0a0f;
          background-image: 
            radial-gradient(ellipse at 20% 20%, rgba(255,180,0,0.04) 0%, transparent 50%),
            radial-gradient(ellipse at 80% 80%, rgba(255,80,50,0.04) 0%, transparent 50%);
        }

        header {
          padding: 2rem 2.5rem 1rem;
          border-bottom: 1px solid rgba(255,255,255,0.06);
          display: flex;
          align-items: center;
          gap: 1rem;
        }

        .logo-mark {
          width: 36px; height: 36px;
          background: linear-gradient(135deg, #ffb400, #ff5032);
          border-radius: 8px;
          display: flex; align-items: center; justify-content: center;
          font-size: 18px;
        }

        .app-title {
          font-family: 'Syne', sans-serif;
          font-size: 1.1rem;
          font-weight: 700;
          letter-spacing: 0.05em;
          text-transform: uppercase;
          color: #e8e4dc;
        }

        .app-subtitle {
          font-size: 0.65rem;
          color: rgba(255,255,255,0.3);
          letter-spacing: 0.1em;
          text-transform: uppercase;
          margin-top: 1px;
        }

        .main {
          flex: 1;
          display: grid;
          grid-template-columns: 320px 1fr;
          gap: 0;
          max-width: 1200px;
          margin: 0 auto;
          width: 100%;
          padding: 2rem;
          gap: 2rem;
        }

        /* SIDEBAR */
        .sidebar {
          display: flex;
          flex-direction: column;
          gap: 1.5rem;
        }

        .control-group {
          background: rgba(255,255,255,0.03);
          border: 1px solid rgba(255,255,255,0.07);
          border-radius: 12px;
          padding: 1.25rem;
        }

        .control-label {
          font-size: 0.6rem;
          text-transform: uppercase;
          letter-spacing: 0.15em;
          color: rgba(255,255,255,0.35);
          margin-bottom: 0.75rem;
          display: block;
        }

        .chip-group {
          display: flex;
          flex-wrap: wrap;
          gap: 0.4rem;
          max-height: 100px;
          overflow-y: auto;
          padding-right: 2px;
        }

        .chip-group.scrollable {
          max-height: 80px;
        }

        .chip-group::-webkit-scrollbar { width: 3px; }
        .chip-group::-webkit-scrollbar-track { background: transparent; }
        .chip-group::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 2px; }

        .chip {
          padding: 0.35rem 0.75rem;
          border-radius: 6px;
          border: 1px solid rgba(255,255,255,0.1);
          background: transparent;
          color: rgba(255,255,255,0.5);
          font-family: 'DM Mono', monospace;
          font-size: 0.7rem;
          cursor: pointer;
          transition: all 0.15s;
        }

        .chip:hover { border-color: rgba(255,255,255,0.25); color: rgba(255,255,255,0.8); }

        .chip.selected {
          border-color: #ffb400;
          color: #ffb400;
          background: rgba(255,180,0,0.08);
        }

        .hunt-btn {
          width: 100%;
          padding: 1rem;
          background: linear-gradient(135deg, #ffb400, #ff5032);
          border: none;
          border-radius: 10px;
          color: #0a0a0f;
          font-family: 'Syne', sans-serif;
          font-size: 0.85rem;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          cursor: pointer;
          transition: all 0.2s;
          position: relative;
          overflow: hidden;
        }

        .hunt-btn:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 8px 24px rgba(255,180,0,0.25); }
        .hunt-btn:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }

        .history-section { margin-top: 0.5rem; }

        .history-title {
          font-size: 0.6rem;
          text-transform: uppercase;
          letter-spacing: 0.15em;
          color: rgba(255,255,255,0.25);
          margin-bottom: 0.75rem;
        }

        .history-item {
          padding: 0.65rem 0.75rem;
          border: 1px solid rgba(255,255,255,0.06);
          border-radius: 8px;
          margin-bottom: 0.4rem;
          cursor: pointer;
          transition: all 0.15s;
          background: rgba(255,255,255,0.02);
        }

        .history-item:hover { border-color: rgba(255,255,255,0.15); background: rgba(255,255,255,0.04); }

        .history-meta {
          font-size: 0.6rem;
          color: rgba(255,255,255,0.3);
          margin-bottom: 0.2rem;
        }

        .history-preview {
          font-size: 0.68rem;
          color: rgba(255,255,255,0.55);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        /* CONTENT */
        .content {
          display: flex;
          flex-direction: column;
          gap: 1.5rem;
          min-height: 500px;
        }

        .phase-track {
          display: flex;
          gap: 0;
          background: rgba(255,255,255,0.03);
          border: 1px solid rgba(255,255,255,0.07);
          border-radius: 10px;
          padding: 1rem 1.25rem;
          align-items: center;
          justify-content: space-between;
          position: relative;
        }

        .phase-step {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.3rem;
          opacity: 0.25;
          transition: all 0.3s;
          flex: 1;
          position: relative;
        }

        .phase-step.active { opacity: 0.6; }
        .phase-step.current { opacity: 1; }

        .phase-icon { font-size: 1.1rem; }

        .phase-label {
          font-size: 0.58rem;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          color: rgba(255,255,255,0.7);
          text-align: center;
        }

        .phase-step.current .phase-label { color: #ffb400; }

        .phase-step:not(:last-child)::after {
          content: '';
          position: absolute;
          right: -50%;
          top: 30%;
          width: 100%;
          height: 1px;
          background: rgba(255,255,255,0.1);
          z-index: 0;
        }

        .output-area {
          flex: 1;
          background: rgba(255,255,255,0.02);
          border: 1px solid rgba(255,255,255,0.07);
          border-radius: 12px;
          padding: 1.75rem;
          min-height: 400px;
          position: relative;
          overflow-y: auto;
        }

        .empty-state {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          height: 100%;
          min-height: 350px;
          gap: 1rem;
          opacity: 0.3;
        }

        .empty-icon { font-size: 3rem; }

        .empty-text {
          font-size: 0.75rem;
          text-transform: uppercase;
          letter-spacing: 0.15em;
          color: rgba(255,255,255,0.5);
          text-align: center;
        }

        .stream-text {
          font-family: 'DM Mono', monospace;
          font-size: 0.78rem;
          line-height: 1.8;
          color: rgba(255,255,255,0.75);
          white-space: pre-wrap;
        }

        .result-card { font-size: 0.8rem; line-height: 1.8; }
        .result-card h1 { font-family: 'Syne', sans-serif; font-size: 1.3rem; font-weight: 800; color: #ffb400; margin: 1.5rem 0 0.75rem; }
        .result-card h2 { font-family: 'Syne', sans-serif; font-size: 1rem; font-weight: 700; color: rgba(255,255,255,0.9); margin: 1.25rem 0 0.5rem; border-left: 3px solid #ff5032; padding-left: 0.75rem; }
        .result-card h3 { font-size: 0.85rem; font-weight: 600; color: rgba(255,255,255,0.7); margin: 1rem 0 0.3rem; }
        .result-card p { color: rgba(255,255,255,0.65); margin-bottom: 0.5rem; }
        .result-card li { color: rgba(255,255,255,0.65); margin-left: 1.25rem; margin-bottom: 0.25rem; list-style: disc; }
        .result-card strong { color: rgba(255,255,255,0.9); }
        .result-card br { display: block; margin: 0.25rem 0; content: ''; }

        .error-box {
          background: rgba(255,80,50,0.08);
          border: 1px solid rgba(255,80,50,0.25);
          border-radius: 8px;
          padding: 1rem;
          font-size: 0.75rem;
          color: #ff5032;
        }

        .reset-btn {
          position: absolute;
          top: 1rem; right: 1rem;
          padding: 0.4rem 0.75rem;
          background: rgba(255,255,255,0.05);
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 6px;
          color: rgba(255,255,255,0.4);
          font-family: 'DM Mono', monospace;
          font-size: 0.65rem;
          cursor: pointer;
          transition: all 0.15s;
          text-transform: uppercase;
          letter-spacing: 0.1em;
        }

        .reset-btn:hover { color: rgba(255,255,255,0.8); border-color: rgba(255,255,255,0.25); }

        .typing-dots span {
          animation: blink 1.2s infinite;
          font-size: 1.2em;
          color: #ffb400;
        }
        .typing-dots span:nth-child(2) { animation-delay: 0.2s; }
        .typing-dots span:nth-child(3) { animation-delay: 0.4s; }

        @keyframes blink {
          0%, 80%, 100% { opacity: 0; }
          40% { opacity: 1; }
        }

        .status-bar {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          font-size: 0.65rem;
          color: rgba(255,255,255,0.3);
          text-transform: uppercase;
          letter-spacing: 0.1em;
        }

        .status-dot {
          width: 6px; height: 6px;
          border-radius: 50%;
          background: #22c55e;
          animation: pulse 1.5s infinite;
        }

        .status-dot.idle { background: rgba(255,255,255,0.2); animation: none; }

        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(0.8); }
        }

        @media (max-width: 768px) {
          .main { grid-template-columns: 1fr; padding: 1rem; }
        }

        .ad-slot {
          background: rgba(255,255,255,0.02);
          border: 1px dashed rgba(255,255,255,0.08);
          border-radius: 10px;
          padding: 0.75rem 1rem;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 1rem;
        }

        .ad-label {
          font-size: 0.55rem;
          text-transform: uppercase;
          letter-spacing: 0.12em;
          color: rgba(255,255,255,0.2);
          white-space: nowrap;
        }

        .ad-placeholder {
          flex: 1;
          height: 60px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 0.65rem;
          color: rgba(255,255,255,0.15);
          border: 1px dashed rgba(255,255,255,0.06);
          border-radius: 6px;
        }

        footer {
          padding: 1rem 2.5rem;
          border-top: 1px solid rgba(255,255,255,0.05);
          display: flex;
          align-items: center;
          justify-content: space-between;
          font-size: 0.62rem;
          color: rgba(255,255,255,0.2);
        }

        footer a { color: rgba(255,180,0,0.5); text-decoration: none; }
        footer a:hover { color: #ffb400; }
      `}</style>

      <div className="app">
        <header>
          <div className="logo-mark">💡</div>
          <div>
            <div className="app-title">Idea Hunter</div>
            <div className="app-subtitle">Gap finder · Digital business intelligence</div>
          </div>
          <div style={{ marginLeft: "auto" }} className="status-bar">
            <div className={`status-dot ${loading ? "" : "idle"}`} />
            {loading ? "Ricerca in corso" : "Pronto"}
          </div>
        </header>

        <div className="main">
          <aside className="sidebar">
            <div className="control-group">
              <span className="control-label">Settore</span>
              <div className="chip-group scrollable">
                {SECTORS.map(s => (
                  <button key={s} className={`chip ${sector === s ? "selected" : ""}`} onClick={() => setSector(s)}>{s}</button>
                ))}
              </div>
            </div>

            <div className="control-group">
              <span className="control-label">Mercato target</span>
              <div className="chip-group">
                {MARKETS.map(m => (
                  <button key={m} className={`chip ${market === m ? "selected" : ""}`} onClick={() => setMarket(m)}>{m}</button>
                ))}
              </div>
            </div>

            <div className="control-group">
              <span className="control-label">Target utente</span>
              <div className="chip-group">
                {TARGETS.map(t => (
                  <button key={t} className={`chip ${target === t ? "selected" : ""}`} onClick={() => setTarget(t)}>{t}</button>
                ))}
              </div>
            </div>

            <div className="control-group">
              <span className="control-label">Paese sorgente</span>
              <div className="chip-group">
                {SOURCE_COUNTRIES.map(s => (
                  <button key={s} className={`chip ${source === s ? "selected" : ""}`} onClick={() => setSource(s)}>{s}</button>
                ))}
              </div>
            </div>

            <button className="hunt-btn" onClick={hunt} disabled={loading}>
              {loading ? "Analisi in corso..." : "🔍 Trova idea vincente"}
            </button>

            {history.length > 0 && (
              <div className="history-section">
                <div className="history-title">Ricerche precedenti</div>
                {history.map((h, i) => (
                  <div key={i} className="history-item" onClick={() => { setFinalResult(h.result); setPhase(5); }}>
                    <div className="history-meta">{h.source} → {h.market} · {h.sector !== "Qualsiasi" ? h.sector + " · " : ""}{h.timestamp}</div>
                    <div className="history-preview">{h.result.slice(0, 80)}...</div>
                  </div>
                ))}
              </div>
            )}
          </aside>

          <main className="content">
            {(loading || phase > 0) && <PhaseIndicator phase={phase} />}

            <div className="output-area">
              {finalResult && (
                <button className="reset-btn" onClick={reset}>↩ Nuova ricerca</button>
              )}

              {!loading && !finalResult && !error && (
                <div className="empty-state">
                  <div className="empty-icon">🌍</div>
                  <div className="empty-text">
                    Seleziona mercato, target e paese sorgente<br />
                    poi avvia la ricerca
                  </div>
                </div>
              )}

              {error && (
                <div className="error-box">
                  ⚠️ Errore: {error}
                </div>
              )}

              {loading && streamText && (
                <div className="stream-text">
                  {streamText} <TypingDots />
                </div>
              )}

              {loading && !streamText && (
                <div className="empty-state">
                  <div className="empty-icon">🔍</div>
                  <div className="empty-text">
                    Ricerca in corso<br />
                    <TypingDots />
                  </div>
                </div>
              )}

              {finalResult && !loading && (
                <ResultCard result={finalResult} />
              )}
            </div>

            {/* Slot pubblicitario — sostituire con codice EthicalAds */}
            <div className="ad-slot">
              <span className="ad-label">Sponsorizzato</span>
              <div className="ad-placeholder" id="ethical-ad-slot">
                {/* Incolla qui il codice EthicalAds dopo l'approvazione */}
                Spazio pubblicitario
              </div>
            </div>
          </main>
        </div>

        <footer>
          <span>Idea Hunter · Trova gap di mercato reali</span>
          <span>
            Powered by <a href="https://anthropic.com" target="_blank">Claude AI</a>
            {" · "}
            <a href="mailto:tua@email.com">Contatti</a>
          </span>
        </footer>
      </div>
    </>
  );
}
