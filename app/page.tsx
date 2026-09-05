import { apiEndpoints } from "@/lib/api-endpoints";

const methodColors: Record<string, string> = {
  GET: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  POST: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  DELETE: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
};

export default function Home() {
  return (
    <div className="min-h-screen bg-zinc-50 font-sans dark:bg-black">
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-10 px-6 py-16 sm:px-10">
        <header className="flex flex-col gap-3">
          <h1 className="text-3xl font-semibold tracking-tight text-black dark:text-zinc-50">
            RAG Frontend
          </h1>
          <p className="text-lg leading-7 text-zinc-600 dark:text-zinc-400">
            A client for the RAG backend service. It lets users upload
            documents, ask questions answered from that document content via
            retrieval-augmented generation, and manage the document library —
            wrapping the FastAPI backend below in a browser UI.
          </p>
        </header>

        <section className="flex flex-col gap-4">
          <h2 className="text-xl font-semibold text-black dark:text-zinc-50">
            Backend API
          </h2>
          <ul className="flex flex-col gap-3">
            {apiEndpoints.map((endpoint) => (
              <li
                key={`${endpoint.method}-${endpoint.path}`}
                className="rounded-lg border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-zinc-950"
              >
                <div className="flex items-center gap-3">
                  <span
                    className={`rounded px-2 py-0.5 font-mono text-xs font-semibold ${methodColors[endpoint.method]}`}
                  >
                    {endpoint.method}
                  </span>
                  <code className="font-mono text-sm text-black dark:text-zinc-50">
                    {endpoint.path}
                  </code>
                </div>
                <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
                  {endpoint.summary}
                </p>
                {(endpoint.request || endpoint.response) && (
                  <dl className="mt-2 grid gap-1 text-xs text-zinc-500 dark:text-zinc-500">
                    {endpoint.request && (
                      <div className="flex gap-2">
                        <dt className="font-medium">Request:</dt>
                        <dd className="font-mono">{endpoint.request}</dd>
                      </div>
                    )}
                    {endpoint.response && (
                      <div className="flex gap-2">
                        <dt className="font-medium">Response:</dt>
                        <dd className="font-mono">{endpoint.response}</dd>
                      </div>
                    )}
                  </dl>
                )}
              </li>
            ))}
          </ul>
        </section>
      </main>
    </div>
  );
}
