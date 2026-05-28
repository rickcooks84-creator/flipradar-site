import Link from "next/link";

const BORDER  = "#27272a";
const MUTED   = "#71717a";
const SURFACE = "#18181b";
const GREEN   = "#86efac";
const BLUE    = "#60a5fa";
const PURPLE  = "#c084fc";

const FEATURES = [
  { icon: "🔗", title: "Paste any store URL", body: "Works on Shopify, clearance pages, brand sites — paste the link and FlipRadar does the rest." },
  { icon: "📦", title: "Every product & variant", body: "Scrapes all products including flavor and size variants so you never miss a profitable SKU." },
  { icon: "📊", title: "Live eBay sold comps", body: "Checks eBay completed listings in real time. Median price, sold count, and velocity per product." },
  { icon: "🎯", title: "1–100 buy score", body: "Each product gets a score based on ROI and sell-through volume. S = buy now. F = skip." },
  { icon: "💰", title: "Live profit calculator", body: "Enter your cost and watch profit and ROI update instantly across every row." },
  { icon: "⚡", title: "Fast, private, offline", body: "Desktop app. No data leaves your machine. No subscriptions beyond the one-time license." },
];

const STEPS = [
  { n: "1", title: "Paste a store URL", body: "Any clearance page, brand site, or Shopify collection. Hit Scan." },
  { n: "2", title: "FlipRadar scrapes every product", body: "Finds names, prices, images, and variants automatically." },
  { n: "3", title: "eBay comps load in the background", body: "Real browser session checks eBay sold listings for each product." },
  { n: "4", title: "Read your scores and buy", body: "Sort by score, filter by sold volume, enter your cost, and buy the winners." },
];

const FAQ = [
  { q: "What sites does it work on?", a: "Any Shopify store and most other retail or brand sites. Shopify stores give the best results — FlipRadar pulls every product and variant with pricing." },
  { q: "How does the eBay data work?", a: "FlipRadar opens a real browser session in the background and checks eBay's completed listings for each product — the same data you'd see manually, automated." },
  { q: "Does it work on Mac?", a: "Currently Windows only. Mac support is on the roadmap." },
  { q: "How many products can it scan?", a: "No hard limit. Tested up to 500+ products in a single scan." },
  { q: "Is the license key per machine?", a: "Yes — your key binds to one machine to prevent sharing. Contact support if you need to transfer it." },
  { q: "What's included in the license?", a: "Lifetime access to the current version plus all future updates. One-time purchase, no monthly fee." },
];

export default function Home() {
  return (
    <div style={{ minHeight: "100vh" }}>

      {/* Nav */}
      <nav style={{ borderBottom: `1px solid ${BORDER}`, padding: "0 32px", height: "56px", display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, background: "#09090bdd", backdropFilter: "blur(12px)", zIndex: 50 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <div style={{ width: "30px", height: "30px", borderRadius: "7px", background: "linear-gradient(135deg, #0064D2, #7c3aed)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "15px" }}>📡</div>
          <span style={{ fontWeight: 800, fontSize: "15px", letterSpacing: "-0.03em" }}>FlipRadar</span>
        </div>
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <a href="#faq" style={{ fontSize: "13px", color: MUTED, padding: "6px 12px" }}>FAQ</a>
          <Link href="/activate" style={{ fontSize: "13px", fontWeight: 600, padding: "8px 18px", background: "#0064D2", borderRadius: "7px", color: "#fff" }}>
            Get Started →
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <section style={{ maxWidth: "780px", margin: "0 auto", padding: "96px 32px 80px", textAlign: "center" }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: "8px", padding: "5px 14px", background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: "999px", fontSize: "12px", color: MUTED, marginBottom: "32px", letterSpacing: "0.04em" }}>
          <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: GREEN, display: "inline-block" }} />
          WINDOWS DESKTOP APP
        </div>
        <h1 style={{ fontSize: "clamp(40px, 6vw, 68px)", fontWeight: 900, letterSpacing: "-0.04em", lineHeight: 1.05, marginBottom: "24px" }}>
          Find flips.<br />
          <span style={{ background: "linear-gradient(90deg, #60a5fa, #c084fc)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>Score them instantly.</span>
        </h1>
        <p style={{ fontSize: "18px", color: MUTED, lineHeight: 1.7, maxWidth: "520px", margin: "0 auto 40px" }}>
          Paste any store URL. FlipRadar scrapes every product, pulls eBay sold comps, and scores each one 1–100 so you know exactly what to buy.
        </p>
        <div style={{ display: "flex", gap: "12px", justifyContent: "center", flexWrap: "wrap" }}>
          <Link href="/activate" style={{ padding: "14px 32px", background: "#0064D2", color: "#fff", borderRadius: "9px", fontWeight: 700, fontSize: "15px" }}>
            Buy Now →
          </Link>
          <a href="#features" style={{ padding: "14px 28px", background: SURFACE, color: "#fafafa", border: `1px solid ${BORDER}`, borderRadius: "9px", fontWeight: 600, fontSize: "15px" }}>
            See how it works
          </a>
        </div>
      </section>

      {/* Stats */}
      <section style={{ maxWidth: "900px", margin: "0 auto 96px", padding: "0 32px" }}>
        <div style={{ background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: "16px", padding: "40px", display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "32px", textAlign: "center" }}>
          {[
            { value: "500+", label: "Products per scan", color: BLUE },
            { value: "1–100", label: "Buy score per product", color: GREEN },
            { value: "Free", label: "eBay data, no API key", color: PURPLE },
          ].map(s => (
            <div key={s.label}>
              <div style={{ fontSize: "36px", fontWeight: 900, color: s.color, letterSpacing: "-0.04em", marginBottom: "6px" }}>{s.value}</div>
              <div style={{ fontSize: "13px", color: MUTED }}>{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section id="features" style={{ maxWidth: "900px", margin: "0 auto 96px", padding: "0 32px" }}>
        <h2 style={{ fontSize: "32px", fontWeight: 800, letterSpacing: "-0.03em", marginBottom: "8px", textAlign: "center" }}>Everything you need to buy smart</h2>
        <p style={{ color: MUTED, textAlign: "center", marginBottom: "48px", fontSize: "15px" }}>From URL to scored product list in minutes.</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "16px" }}>
          {FEATURES.map(f => (
            <div key={f.title} style={{ background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: "12px", padding: "24px" }}>
              <div style={{ fontSize: "28px", marginBottom: "12px" }}>{f.icon}</div>
              <div style={{ fontWeight: 700, fontSize: "15px", marginBottom: "8px" }}>{f.title}</div>
              <div style={{ fontSize: "13px", color: MUTED, lineHeight: 1.6 }}>{f.body}</div>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section style={{ maxWidth: "620px", margin: "0 auto 96px", padding: "0 32px" }}>
        <h2 style={{ fontSize: "32px", fontWeight: 800, letterSpacing: "-0.03em", marginBottom: "48px", textAlign: "center" }}>How it works</h2>
        <div style={{ display: "flex", flexDirection: "column" }}>
          {STEPS.map((step, i) => (
            <div key={step.n} style={{ display: "flex", gap: "20px", paddingBottom: i < STEPS.length - 1 ? "32px" : "0" }}>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0 }}>
                <div style={{ width: "36px", height: "36px", borderRadius: "50%", background: "linear-gradient(135deg, #0064D2, #7c3aed)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: "14px" }}>{step.n}</div>
                {i < STEPS.length - 1 && <div style={{ width: "1px", flex: 1, background: BORDER, marginTop: "8px" }} />}
              </div>
              <div style={{ paddingTop: "6px" }}>
                <div style={{ fontWeight: 700, fontSize: "15px", marginBottom: "6px" }}>{step.title}</div>
                <div style={{ fontSize: "13px", color: MUTED, lineHeight: 1.6 }}>{step.body}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Pricing */}
      <section style={{ maxWidth: "480px", margin: "0 auto 96px", padding: "0 32px", textAlign: "center" }}>
        <h2 style={{ fontSize: "32px", fontWeight: 800, letterSpacing: "-0.03em", marginBottom: "8px" }}>Simple pricing</h2>
        <p style={{ color: MUTED, marginBottom: "40px", fontSize: "15px" }}>One-time purchase. No subscriptions.</p>
        <div style={{ background: SURFACE, border: `1px solid #0064D2`, borderRadius: "16px", padding: "40px" }}>
          <div style={{ fontSize: "14px", color: MUTED, marginBottom: "8px", textTransform: "uppercase", letterSpacing: "0.08em" }}>Lifetime License</div>
          <div style={{ fontSize: "52px", fontWeight: 900, letterSpacing: "-0.04em", marginBottom: "4px" }}>$XX</div>
          <div style={{ color: MUTED, fontSize: "13px", marginBottom: "32px" }}>one-time · no monthly fee</div>
          <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginBottom: "32px", textAlign: "left" }}>
            {["Unlimited scans", "eBay sold comps on every product", "1–100 buy score + profit calculator", "Sort & filter by sold volume, ROI, profit", "All future updates included", "Windows desktop app"].map(f => (
              <div key={f} style={{ display: "flex", gap: "10px", alignItems: "center", fontSize: "14px" }}>
                <span style={{ color: GREEN, fontWeight: 700 }}>✓</span> {f}
              </div>
            ))}
          </div>
          <Link href="/activate" style={{ display: "block", padding: "14px", background: "#0064D2", color: "#fff", borderRadius: "9px", fontWeight: 700, fontSize: "15px", textAlign: "center" }}>
            Buy on Whop →
          </Link>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" style={{ maxWidth: "680px", margin: "0 auto 96px", padding: "0 32px" }}>
        <h2 style={{ fontSize: "32px", fontWeight: 800, letterSpacing: "-0.03em", marginBottom: "48px", textAlign: "center" }}>Frequently asked questions</h2>
        {FAQ.map((item, i) => (
          <div key={item.q} style={{ borderTop: `1px solid ${BORDER}`, padding: "24px 0", ...(i === FAQ.length - 1 ? { borderBottom: `1px solid ${BORDER}` } : {}) }}>
            <div style={{ fontWeight: 600, fontSize: "15px", marginBottom: "10px" }}>{item.q}</div>
            <div style={{ fontSize: "14px", color: MUTED, lineHeight: 1.7 }}>{item.a}</div>
          </div>
        ))}
      </section>

      {/* Bottom CTA */}
      <section style={{ maxWidth: "680px", margin: "0 auto 96px", padding: "0 32px", textAlign: "center" }}>
        <div style={{ background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: "16px", padding: "56px 40px" }}>
          <div style={{ fontSize: "40px", marginBottom: "16px" }}>📡</div>
          <h2 style={{ fontSize: "28px", fontWeight: 800, letterSpacing: "-0.03em", marginBottom: "12px" }}>Ready to flip smarter?</h2>
          <p style={{ color: MUTED, marginBottom: "32px", fontSize: "15px" }}>Join resellers already using FlipRadar to find profitable inventory faster.</p>
          <Link href="/activate" style={{ display: "inline-block", padding: "14px 36px", background: "#0064D2", color: "#fff", borderRadius: "9px", fontWeight: 700, fontSize: "15px" }}>
            Get FlipRadar →
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer style={{ borderTop: `1px solid ${BORDER}`, padding: "24px 32px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ fontSize: "16px" }}>📡</span>
          <span style={{ fontWeight: 700, fontSize: "13px" }}>FlipRadar</span>
        </div>
        <div style={{ fontSize: "12px", color: MUTED }}>© {new Date().getFullYear()} FlipRadar. All rights reserved.</div>
        <Link href="/activate" style={{ fontSize: "13px", color: MUTED }}>Activate license →</Link>
      </footer>

    </div>
  );
}
