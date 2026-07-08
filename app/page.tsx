import Link from "next/link";

const BG      = "#07111a";
const SURFACE = "#0d1e2b";
const BORDER  = "#1a3a2e";
const MUTED   = "#5a8a78";
const GREEN   = "#00ff88";
const GREEN2  = "#00cc6a";
const DIM     = "#1a4a38";

// ── PASTE YOUR YOUTUBE VIDEO IDs HERE ──────────────────────────────
// Replace "YOUR_VIDEO_ID" with the ID from your YouTube URL
// e.g. https://www.youtube.com/watch?v=dQw4w9WgXcQ → "dQw4w9WgXcQ"
const DEMO_VIDEOS = [
  { id: "YOUR_VIDEO_ID_1", title: "Full Walkthrough — Scan a Store in 60 Seconds" },
  { id: "YOUR_VIDEO_ID_2", title: "Finding S-Grade Flips on a Clearance Page" },
  { id: "YOUR_VIDEO_ID_3", title: "Live eBay Comps & Profit Calculator Demo" },
];
// ───────────────────────────────────────────────────────────────────

const FEATURES = [
  { icon: "🔗", title: "Paste any store URL", body: "Works on Shopify, clearance pages, brand sites — paste the link and FlipSonar does the rest." },
  { icon: "📦", title: "Every product & variant", body: "Scrapes all products including flavor and size variants so you never miss a profitable SKU." },
  { icon: "📊", title: "Live eBay sold comps", body: "Checks eBay completed listings in real time. Median price, sold count, and velocity per product." },
  { icon: "🎯", title: "1–100 buy score", body: "Each product gets a score based on ROI and sell-through volume. S = buy now. F = skip." },
  { icon: "💰", title: "Live profit calculator", body: "Enter your cost and watch profit and ROI update instantly across every row." },
  { icon: "⚡", title: "Fast, private, offline", body: "Desktop app. No data leaves your machine. Cancel your subscription anytime." },
];

const STEPS = [
  { n: "1", title: "Paste a store URL", body: "Any clearance page, brand site, or Shopify collection. Hit Scan." },
  { n: "2", title: "FlipSonar scrapes every product", body: "Finds names, prices, images, and variants automatically." },
  { n: "3", title: "eBay comps load in the background", body: "Real browser session checks eBay sold listings for each product." },
  { n: "4", title: "Read your scores and buy", body: "Sort by score, filter by sold volume, enter your cost, and buy the winners." },
];

const FAQ = [
  { q: "What sites does it work on?", a: "Any Shopify store and most other retail or brand sites. Shopify stores give the best results — FlipSonar pulls every product and variant with pricing." },
  { q: "How does the eBay data work?", a: "FlipSonar opens a real browser session in the background and checks eBay's completed listings for each product — the same data you'd see manually, automated." },
  { q: "Does it work on Mac?", a: "Currently Windows only. Mac support is on the roadmap." },
  { q: "How many products can it scan?", a: "No hard limit. Tested up to 500+ products in a single scan." },
  { q: "Is the license key per machine?", a: "Yes — your key binds to one machine to prevent sharing. Contact support if you need to transfer it." },
  { q: "What's included in the license?", a: "Lifetime access to the current version plus all future updates. One-time purchase, no monthly fee." },
];

function RadarIcon() {
  return (
    <svg width="120" height="120" viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ filter: "drop-shadow(0 0 16px #00ff8860)" }}>
      {/* Rings */}
      <circle cx="60" cy="60" r="55" stroke="#00ff8820" strokeWidth="1" />
      <circle cx="60" cy="60" r="40" stroke="#00ff8830" strokeWidth="1" />
      <circle cx="60" cy="60" r="25" stroke="#00ff8840" strokeWidth="1" />
      <circle cx="60" cy="60" r="10" stroke="#00ff8860" strokeWidth="1" />
      {/* Crosshairs */}
      <line x1="60" y1="5" x2="60" y2="115" stroke="#00ff8818" strokeWidth="1" />
      <line x1="5" y1="60" x2="115" y2="60" stroke="#00ff8818" strokeWidth="1" />
      {/* Sweep */}
      <g style={{ transformOrigin: "60px 60px", animation: "radarSweep 3s linear infinite" }}>
        <path d="M60 60 L60 5 A55 55 0 0 1 104 82 Z" fill="url(#sweep)" opacity="0.6" />
      </g>
      {/* Blips */}
      <circle cx="80" cy="38" r="3" fill={GREEN} opacity="0.9" />
      <circle cx="42" cy="72" r="2.5" fill={GREEN} opacity="0.7" />
      <circle cx="75" cy="75" r="2" fill={GREEN} opacity="0.5" />
      <defs>
        <radialGradient id="sweep" cx="0%" cy="100%" r="100%">
          <stop offset="0%" stopColor={GREEN} stopOpacity="0" />
          <stop offset="100%" stopColor={GREEN} stopOpacity="0.4" />
        </radialGradient>
      </defs>
    </svg>
  );
}

export default function Home() {
  return (
    <div style={{ minHeight: "100vh", background: BG }}>

      {/* Atmospheric background */}
      <div style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0, background: "radial-gradient(ellipse at 20% 50%, #0a2a1a18 0%, transparent 60%), radial-gradient(ellipse at 80% 20%, #0a1a2a18 0%, transparent 60%)" }} />

      {/* Nav */}
      <nav style={{ borderBottom: `1px solid ${BORDER}`, padding: "0 32px", height: "56px", display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, background: "#07111add", backdropFilter: "blur(12px)", zIndex: 50 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <div style={{ width: "30px", height: "30px", borderRadius: "7px", background: "linear-gradient(135deg, #003a20, #006640)", border: `1px solid ${GREEN}40`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "15px", boxShadow: `0 0 12px ${GREEN}30` }}>📡</div>
          <span style={{ fontWeight: 800, fontSize: "15px", letterSpacing: "-0.03em", color: GREEN }}>FlipSonar</span>
        </div>
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <a href="#faq" style={{ fontSize: "13px", color: MUTED, padding: "6px 12px" }}>FAQ</a>
          <Link href="/login" style={{ fontSize: "13px", fontWeight: 600, color: GREEN, padding: "6px 12px" }}>Log In</Link>
          <Link href="/activate" style={{ fontSize: "13px", fontWeight: 600, padding: "8px 18px", background: DIM, border: `1px solid ${GREEN}50`, borderRadius: "7px", color: GREEN, boxShadow: `0 0 12px ${GREEN}20` }}>
            Get Started →
          </Link>
        </div>
      </nav>

      <div style={{ position: "relative", zIndex: 1 }}>

      {/* Hero */}
      <section style={{ maxWidth: "780px", margin: "0 auto", padding: "96px 32px 80px", textAlign: "center" }}>
        {/* Radar animation */}
        <div style={{ display: "flex", justifyContent: "center", marginBottom: "40px" }}>
          <RadarIcon />
        </div>

        <div style={{ display: "inline-flex", alignItems: "center", gap: "8px", padding: "5px 14px", background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: "999px", fontSize: "12px", color: MUTED, marginBottom: "28px", letterSpacing: "0.04em" }}>
          <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: GREEN, display: "inline-block", boxShadow: `0 0 6px ${GREEN}` }} />
          WINDOWS DESKTOP APP
        </div>

        <h1 style={{ fontSize: "clamp(40px, 6vw, 68px)", fontWeight: 900, letterSpacing: "-0.04em", lineHeight: 1.05, marginBottom: "24px" }}>
          Find flips.<br />
          <span style={{ color: GREEN, animation: "glow 3s ease-in-out infinite" }}>Score them instantly.</span>
        </h1>
        <p style={{ fontSize: "18px", color: MUTED, lineHeight: 1.7, maxWidth: "520px", margin: "0 auto 40px" }}>
          Paste any store URL. FlipSonar scrapes every product, pulls eBay sold comps, and scores each one 1–100 so you know exactly what to buy.
        </p>
        <div style={{ display: "flex", gap: "12px", justifyContent: "center", flexWrap: "wrap" }}>
          <Link href="/activate" style={{ padding: "14px 32px", background: DIM, color: GREEN, border: `1px solid ${GREEN}50`, borderRadius: "9px", fontWeight: 700, fontSize: "15px", boxShadow: `0 0 20px ${GREEN}20` }}>
            Buy Now →
          </Link>
          <a href="#demo" style={{ padding: "14px 28px", background: SURFACE, color: "#e8f4f0", border: `1px solid ${BORDER}`, borderRadius: "9px", fontWeight: 600, fontSize: "15px" }}>
            Watch Demo
          </a>
        </div>
      </section>

      {/* Stats */}
      <section style={{ maxWidth: "900px", margin: "0 auto 96px", padding: "0 32px" }}>
        <div style={{ background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: "16px", padding: "40px", display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "32px", textAlign: "center" }}>
          {[
            { value: "500+", label: "Products per scan" },
            { value: "1–100", label: "Buy score per product" },
            { value: "Free", label: "eBay data, no API key" },
          ].map(s => (
            <div key={s.label}>
              <div style={{ fontSize: "36px", fontWeight: 900, color: GREEN, letterSpacing: "-0.04em", marginBottom: "6px", textShadow: `0 0 20px ${GREEN}60` }}>{s.value}</div>
              <div style={{ fontSize: "13px", color: MUTED }}>{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Demo Videos */}
      <section id="demo" style={{ maxWidth: "900px", margin: "0 auto 96px", padding: "0 32px" }}>
        <h2 style={{ fontSize: "32px", fontWeight: 800, letterSpacing: "-0.03em", marginBottom: "8px", textAlign: "center", color: GREEN }}>See it in action</h2>
        <p style={{ color: MUTED, textAlign: "center", marginBottom: "48px", fontSize: "15px" }}>Watch FlipSonar find profitable inventory in real time.</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "20px" }}>
          {DEMO_VIDEOS.map((v, i) => (
            <div key={i} style={{ background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: "12px", overflow: "hidden" }}>
              {v.id === `YOUR_VIDEO_ID_${i + 1}` ? (
                <div style={{ width: "100%", aspectRatio: "16/9", background: "#0a1a14", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "8px" }}>
                  <div style={{ fontSize: "32px", opacity: 0.3 }}>▶</div>
                  <div style={{ fontSize: "12px", color: MUTED }}>Demo coming soon</div>
                </div>
              ) : (
                <iframe
                  width="100%"
                  style={{ aspectRatio: "16/9", display: "block", border: "none" }}
                  src={`https://www.youtube.com/embed/${v.id}`}
                  title={v.title}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              )}
              <div style={{ padding: "14px 16px" }}>
                <div style={{ fontSize: "13px", fontWeight: 600, color: "#e8f4f0", lineHeight: 1.4 }}>{v.title}</div>
              </div>
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
            <div key={f.title} style={{ background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: "12px", padding: "24px", transition: "border-color 0.2s" }}>
              <div style={{ fontSize: "28px", marginBottom: "12px" }}>{f.icon}</div>
              <div style={{ fontWeight: 700, fontSize: "15px", marginBottom: "8px", color: "#e8f4f0" }}>{f.title}</div>
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
                <div style={{ width: "36px", height: "36px", borderRadius: "50%", background: DIM, border: `1px solid ${GREEN}50`, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: "14px", color: GREEN, boxShadow: `0 0 12px ${GREEN}20` }}>{step.n}</div>
                {i < STEPS.length - 1 && <div style={{ width: "1px", flex: 1, background: BORDER, marginTop: "8px" }} />}
              </div>
              <div style={{ paddingTop: "6px" }}>
                <div style={{ fontWeight: 700, fontSize: "15px", marginBottom: "6px", color: "#e8f4f0" }}>{step.title}</div>
                <div style={{ fontSize: "13px", color: MUTED, lineHeight: 1.6 }}>{step.body}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Pricing */}
      <section style={{ maxWidth: "860px", margin: "0 auto 96px", padding: "0 32px", textAlign: "center" }}>
        <h2 style={{ fontSize: "32px", fontWeight: 800, letterSpacing: "-0.03em", marginBottom: "8px" }}>Simple pricing</h2>
        <p style={{ color: MUTED, marginBottom: "40px", fontSize: "15px" }}>Simple monthly pricing. Cancel anytime.</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "20px" }}>

          {/* Monthly */}
          <div style={{ background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: "16px", padding: "36px", textAlign: "center" }}>
            <div style={{ fontSize: "14px", color: MUTED, marginBottom: "8px", textTransform: "uppercase", letterSpacing: "0.08em" }}>Monthly</div>
            <div style={{ fontSize: "48px", fontWeight: 900, letterSpacing: "-0.04em", marginBottom: "4px", color: GREEN }}><span style={{ fontSize: "24px" }}>$</span>9.99</div>
            <div style={{ color: MUTED, fontSize: "13px", marginBottom: "28px" }}>per month · cancel anytime</div>
            <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "28px", textAlign: "left" }}>
              {["Unlimited scans", "eBay sold comps on every product", "1–100 buy score + profit calculator", "All future updates included", "Windows desktop app"].map(f => (
                <div key={f} style={{ display: "flex", gap: "10px", alignItems: "center", fontSize: "13px" }}>
                  <span style={{ color: GREEN, fontWeight: 700 }}>✓</span> {f}
                </div>
              ))}
            </div>
            <Link href="/activate" style={{ display: "block", padding: "12px", background: "transparent", color: GREEN, border: `1px solid ${GREEN}40`, borderRadius: "9px", fontWeight: 700, fontSize: "14px", textAlign: "center" }}>
              Get Started →
            </Link>
          </div>

          {/* Yearly */}
          <div style={{ background: SURFACE, border: `1px solid ${GREEN}50`, borderRadius: "16px", padding: "36px", textAlign: "center", boxShadow: `0 0 40px ${GREEN}10`, position: "relative" }}>
            <div style={{ position: "absolute", top: "-12px", left: "50%", transform: "translateX(-50%)", background: DIM, border: `1px solid ${GREEN}60`, borderRadius: "999px", padding: "3px 14px", fontSize: "11px", fontWeight: 700, color: GREEN, letterSpacing: "0.06em", whiteSpace: "nowrap" }}>BEST VALUE — SAVE 58%</div>
            <div style={{ fontSize: "14px", color: MUTED, marginBottom: "8px", textTransform: "uppercase", letterSpacing: "0.08em" }}>Yearly</div>
            <div style={{ fontSize: "48px", fontWeight: 900, letterSpacing: "-0.04em", marginBottom: "4px", color: GREEN, textShadow: `0 0 30px ${GREEN}50` }}><span style={{ fontSize: "24px" }}>$</span>49.99</div>
            <div style={{ color: MUTED, fontSize: "13px", marginBottom: "28px" }}>per year · ~$4.17/mo · cancel anytime</div>
            <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "28px", textAlign: "left" }}>
              {["Unlimited scans", "eBay sold comps on every product", "1–100 buy score + profit calculator", "All future updates included", "Windows desktop app", "Priority support"].map(f => (
                <div key={f} style={{ display: "flex", gap: "10px", alignItems: "center", fontSize: "13px" }}>
                  <span style={{ color: GREEN, fontWeight: 700 }}>✓</span> {f}
                </div>
              ))}
            </div>
            <Link href="/activate" style={{ display: "block", padding: "12px", background: DIM, color: GREEN, border: `1px solid ${GREEN}50`, borderRadius: "9px", fontWeight: 700, fontSize: "14px", textAlign: "center", boxShadow: `0 0 20px ${GREEN}20` }}>
              Buy on Whop →
            </Link>
          </div>

        </div>
      </section>

      {/* FAQ */}
      <section id="faq" style={{ maxWidth: "680px", margin: "0 auto 96px", padding: "0 32px" }}>
        <h2 style={{ fontSize: "32px", fontWeight: 800, letterSpacing: "-0.03em", marginBottom: "48px", textAlign: "center" }}>Frequently asked questions</h2>
        {FAQ.map((item, i) => (
          <div key={item.q} style={{ borderTop: `1px solid ${BORDER}`, padding: "24px 0", ...(i === FAQ.length - 1 ? { borderBottom: `1px solid ${BORDER}` } : {}) }}>
            <div style={{ fontWeight: 600, fontSize: "15px", marginBottom: "10px", color: "#e8f4f0" }}>{item.q}</div>
            <div style={{ fontSize: "14px", color: MUTED, lineHeight: 1.7 }}>{item.a}</div>
          </div>
        ))}
      </section>

      {/* Bottom CTA */}
      <section style={{ maxWidth: "680px", margin: "0 auto 96px", padding: "0 32px", textAlign: "center" }}>
        <div style={{ background: SURFACE, border: `1px solid ${GREEN}30`, borderRadius: "16px", padding: "56px 40px", boxShadow: `0 0 60px ${GREEN}08` }}>
          <div style={{ display: "flex", justifyContent: "center", marginBottom: "20px" }}>
            <RadarIcon />
          </div>
          <h2 style={{ fontSize: "28px", fontWeight: 800, letterSpacing: "-0.03em", marginBottom: "12px" }}>Ready to flip smarter?</h2>
          <p style={{ color: MUTED, marginBottom: "32px", fontSize: "15px" }}>Join resellers already using FlipSonar to find profitable inventory faster.</p>
          <Link href="/activate" style={{ display: "inline-block", padding: "14px 36px", background: DIM, color: GREEN, border: `1px solid ${GREEN}50`, borderRadius: "9px", fontWeight: 700, fontSize: "15px", boxShadow: `0 0 20px ${GREEN}20` }}>
            Get FlipSonar →
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer style={{ borderTop: `1px solid ${BORDER}`, padding: "24px 32px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ fontSize: "16px" }}>📡</span>
          <span style={{ fontWeight: 700, fontSize: "13px", color: GREEN }}>FlipSonar</span>
        </div>
        <div style={{ fontSize: "12px", color: MUTED }}>© {new Date().getFullYear()} FlipSonar. All rights reserved.</div>
        <Link href="/activate" style={{ fontSize: "13px", color: MUTED }}>Activate license →</Link>
      </footer>

      </div>
    </div>
  );
}
