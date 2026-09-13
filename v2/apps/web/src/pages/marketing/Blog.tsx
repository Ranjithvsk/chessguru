// Blog — /blog (index, ChessPlay's "Journal") and /blog/:slug (article).
import { Link, Navigate, useParams } from "react-router-dom";
import MarketingShell, { Accent, Card, Eyebrow, PrimaryCTA, Section, useMarketingTitle, M } from "./MarketingShell";
import { POSTS } from "./content";

const fmt = (d: string) => new Date(d + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

export function BlogIndexPage() {
  useMarketingTitle("The ChessGuru Journal — playbooks for chess academies");
  const [featured, ...rest] = POSTS;
  return (
    <MarketingShell>
      <section className="max-w-6xl mx-auto px-6 pt-14 pb-10 md:pt-20 text-center">
        <Eyebrow>The ChessGuru Journal</Eyebrow>
        <h1 className="font-black tracking-tight leading-[1.02] mt-5" style={{ fontSize: "clamp(38px, 5.8vw, 68px)" }}>Playbooks & ideas for <Accent>modern chess coaches</Accent></h1>
        <p className="mt-6 text-lg leading-relaxed max-w-2xl mx-auto" style={{ color: M.ink2 }}>Running an academy, collecting fees, keeping parents close, and getting the most out of ChessGuru. New posts most weeks.</p>
      </section>
      <Section>
        {featured && (
          <Link to={`/blog/${featured.slug}`} className="block rounded-[28px] border overflow-hidden hover:-translate-y-0.5 transition grid md:grid-cols-2" style={{ borderColor: M.line, background: M.card }}>
            <div className="aspect-[4/3] md:aspect-auto md:min-h-[320px]" style={{ background: `url(/marketing/hero.webp) center/cover` }} />
            <div className="p-8 md:p-10 flex flex-col justify-center">
              <div className="flex items-center gap-2 text-xs font-bold"><span className="rounded-full px-2.5 py-1" style={{ background: M.orangeSoft, color: M.orange2 }}>Featured</span><span style={{ color: M.ink3 }}>{featured.tag} · {featured.minutes} min</span></div>
              <h2 className="mt-3 text-2xl md:text-3xl font-black tracking-tight leading-tight">{featured.title}</h2>
              <p className="mt-3 text-[15px] leading-relaxed" style={{ color: M.ink2 }}>{featured.excerpt}</p>
              <div className="mt-4 text-sm font-bold" style={{ color: M.orange2 }}>{fmt(featured.date)} · Read article →</div>
            </div>
          </Link>
        )}
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5 mt-6">
          {rest.map((p, i) => (
            <Link key={p.slug} to={`/blog/${p.slug}`} className="block hover:-translate-y-0.5 transition">
              <Card className="h-full">
                <div className="aspect-[16/9] rounded-2xl mb-4" style={{ background: `url(/marketing/${["cat-academy", "cat-play", "cat-live", "cat-analytics", "cat-study", "cat-puzzles"][i % 6]}.webp) center/cover` }} />
                <div className="text-xs font-bold" style={{ color: M.ink3 }}>{p.tag} · {p.minutes} min · {fmt(p.date)}</div>
                <h3 className="mt-2 text-lg font-black leading-tight">{p.title}</h3>
                <p className="mt-2 text-sm leading-relaxed" style={{ color: M.ink2 }}>{p.excerpt}</p>
                <div className="mt-3 text-sm font-bold" style={{ color: M.orange2 }}>Read →</div>
              </Card>
            </Link>
          ))}
        </div>
      </Section>
    </MarketingShell>
  );
}

export function BlogPostPage() {
  const { slug } = useParams<{ slug: string }>();
  const post = POSTS.find((p) => p.slug === slug);
  useMarketingTitle(post ? `${post.title} — ChessGuru Journal` : "ChessGuru Journal");
  if (!post) return <Navigate to="/blog" replace />;
  const more = POSTS.filter((p) => p.slug !== post.slug).slice(0, 3);
  return (
    <MarketingShell>
      <article className="max-w-3xl mx-auto px-6 pt-14 pb-16 md:pt-20">
        <Link to="/blog" className="text-sm font-bold" style={{ color: M.orange2 }}>← The Journal</Link>
        <div className="mt-5 flex items-center gap-2 text-xs font-bold"><span className="rounded-full px-2.5 py-1" style={{ background: M.orangeSoft, color: M.orange2 }}>{post.tag}</span><span style={{ color: M.ink3 }}>{fmt(post.date)} · {post.minutes} min read</span></div>
        <h1 className="font-black tracking-tight leading-[1.05] mt-4" style={{ fontSize: "clamp(32px, 4.8vw, 54px)" }}>{post.title}</h1>
        <p className="mt-5 text-lg leading-relaxed" style={{ color: M.ink2 }}>{post.excerpt}</p>
        <div className="mt-8 space-y-5 text-[17px] leading-[1.75]">
          {post.body.map((p, i) => <p key={i}>{p}</p>)}
        </div>
        <div className="mt-10 rounded-3xl p-7 text-center" style={{ background: M.bg2 }}>
          <div className="text-xl font-black">Try it on your own academy</div>
          <p className="mt-1 text-sm" style={{ color: M.ink2 }}>30 days free, no card, unlimited students. ₹1,000/month after.</p>
          <PrimaryCTA className="mt-4" />
        </div>
      </article>
      <Section tone="white">
        <div className="text-center text-[11px] font-bold tracking-widest uppercase mb-5" style={{ color: M.ink3 }}>More from the Journal</div>
        <div className="grid md:grid-cols-3 gap-5">
          {more.map((p) => (
            <Link key={p.slug} to={`/blog/${p.slug}`} className="block hover:-translate-y-0.5 transition"><Card className="h-full"><div className="text-xs font-bold" style={{ color: M.ink3 }}>{p.tag} · {p.minutes} min</div><div className="mt-2 font-black leading-tight">{p.title}</div></Card></Link>
          ))}
        </div>
      </Section>
    </MarketingShell>
  );
}
