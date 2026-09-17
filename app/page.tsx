import Chat from "@/app/components/Chat";
import DocumentPanel from "@/app/components/DocumentPanel";

function backendHost() {
  const base = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
  try {
    return new URL(base).host;
  } catch {
    return base;
  }
}

export default function Home() {
  const backend = backendHost();

  return (
    <div className="app-shell">
      <header className="masthead">
        <div className="wordmark">
          <span>ANBABI</span>
        </div>
        <div className="system-status">
          <span className="status-dot" aria-hidden="true" />
          <span>Retrieval-augmented chat</span>
        </div>
      </header>

      <section className="hero">
        <p className="eyebrow">Retrieval interface / chat</p>
        <h1 className="hero-title">Ask your documents anything.</h1>
      </section>

      <section className="workspace" aria-label="Chat and document register">
        <section className="workspace-column" aria-labelledby="chat-heading">
          <div className="sheet-heading">
            <span className="sheet-index" id="chat-heading">
              RETRIEVAL DESK / 01
            </span>
            <span className="sheet-rule" aria-hidden="true" />
          </div>
          <Chat />
        </section>

        <section className="workspace-column" aria-labelledby="documents-heading">
          <div className="sheet-heading">
            <span className="sheet-index" id="documents-heading">
              SOURCE REGISTER / 02
            </span>
            <span className="sheet-rule" aria-hidden="true" />
          </div>
          <DocumentPanel />
        </section>
      </section>

      <footer className="site-footer">
        <div className="footer-lines">
          <span>Anbabi — retrieval chat</span>
          <span className="footer-meta">
            <span>Backend / {backend}</span>
            <span>Interface / chat · v1</span>
          </span>
        </div>
      </footer>
    </div>
  );
}
