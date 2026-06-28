import { headers } from "next/headers";
import { ArrowRight, KeyRound, Bot } from "lucide-react";
import { buildAgentCard } from "@/lib/agent-card";

export const metadata = {
  title: "PIO — Agent Discovery",
  description: "How an agent discovers PIO's buyer API and buys parametric coverage."
};

/**
 * Human-readable companion to the machine Agent Card. Rendered from the same
 * {@link buildAgentCard} source so the skills and auth shown here can never drift
 * from `/.well-known/agent-card.json`. This is the conventional place for the
 * human page; `/.well-known/` stays a machine-only namespace.
 */
export default async function AgentsPage() {
  const h = await headers();
  const host = h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? `${proto}://${host}`;
  const card = buildAgentCard(baseUrl);
  const scheme = card.securitySchemes.agentKey;

  return (
    <main className="px-4 py-10 text-ink sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-5xl flex-col gap-10">
        <header className="animate-rise">
          <div className="mb-5 inline-flex items-center gap-2 border border-rain bg-rain/10 px-3 py-1 font-mono text-[0.68rem] uppercase tracking-kicker text-rain">
            <Bot size={13} />
            Agent-native · A2A v{card.protocolVersion}
          </div>
          <h1 className="max-w-3xl text-balance font-display text-4xl font-semibold leading-[1.02] tracking-tight sm:text-5xl">
            Buy parametric coverage <span className="italic text-rain">programmatically.</span>
          </h1>
          <p className="mt-5 max-w-2xl text-pretty text-lg leading-8 text-ink-soft">{card.description}</p>
          <div className="mt-7 flex flex-wrap gap-3">
            <a className="btn shadow-riso" href="/.well-known/agent-card.json">
              Agent Card (JSON)
              <ArrowRight size={16} />
            </a>
            <a className="btn-ghost" href="/buy">
              Human checkout
            </a>
          </div>
        </header>

        {/* Buyer skills */}
        <section>
          <div className="mb-4 flex items-end justify-between border-b border-ink pb-2">
            <h2 className="font-display text-2xl font-semibold">Buyer skills</h2>
            <span className="kicker">{card.skills.length} capabilities</span>
          </div>
          <div className="grid gap-px border border-line bg-line sm:grid-cols-2">
            {card.skills.map((skill) => (
              <article key={skill.id} className="bg-card p-6">
                <h3 className="font-display text-xl font-semibold">{skill.name}</h3>
                <p className="mt-1 font-mono text-[0.7rem] uppercase tracking-wider text-rain">{skill.id}</p>
                <p className="mt-3 text-pretty leading-7 text-ink-soft">{skill.description}</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {skill.tags.map((tag) => (
                    <span key={tag} className="tag text-ink-soft">
                      {tag}
                    </span>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </section>

        {/* Authentication */}
        <section className="reg border border-ink bg-card p-6 sm:p-8">
          <div className="flex items-start gap-4">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center border border-amber bg-amber/10 text-amber">
              <KeyRound size={22} />
            </span>
            <div>
              <p className="kicker text-amber">Authentication</p>
              <h2 className="mt-1 max-w-3xl font-display text-2xl font-semibold leading-tight">
                Present your buyer key on every purchase &amp; policy-read call
              </h2>
              <p className="mt-3 max-w-2xl leading-7 text-ink-soft">
                Send the key in the{" "}
                <code className="border border-line bg-paper/60 px-1.5 py-0.5 font-mono text-sm">{scheme.name}</code>{" "}
                header, or as{" "}
                <code className="border border-line bg-paper/60 px-1.5 py-0.5 font-mono text-sm">
                  Authorization: Bearer &lt;key&gt;
                </code>
                . The API base is{" "}
                <code className="border border-line bg-paper/60 px-1.5 py-0.5 font-mono text-sm">{card.url}</code>.
              </p>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
