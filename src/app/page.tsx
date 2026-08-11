import Link from "next/link";
import { Bebas_Neue, Work_Sans } from "next/font/google";
import { ContactForm } from "@/components/contact-form";

/**
 * Public site — institutional/corporate format modeled on how established
 * PH contractors (e.g. DMCI) structure a homepage: plain-link nav, full-bleed
 * dark hero with a ghost-outline CTA, a Mission/Vision block, swipeable
 * horizontal card rows instead of static grids, a credentials band, and a
 * capability strip. Adapted with only real Maxey content — no fabricated
 * careers/press/supplier sections, since those pages don't exist yet.
 * Scoped to this page only via CSS custom properties + next/font — the
 * authenticated app keeps its existing burgundy/cement-grey brand tokens.
 */

const display = Bebas_Neue({ subsets: ["latin"], weight: "400", variable: "--font-display" });
const body = Work_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-body",
});

const palette = {
  "--paper": "#f4f5f7",
  "--card": "#ffffff",
  "--ink": "#14181f",
  "--ink-2": "#40454f",
  "--ink-3": "#6b7280",
  "--line": "#dde1e7",
  "--line-dark": "#2a2f3a",
  "--navy": "#8a1a28",
  "--navy-bright": "#b23d49",
} as React.CSSProperties;

function IconHouse({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" className={className} aria-hidden>
      <path
        d="M5 15 16 6l11 9M8 13v13h16V13M13.5 26v-8h5v8"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
function IconBuilding({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" className={className} aria-hidden>
      <rect x="8" y="5" width="16" height="21" rx="0.5" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M12 10h2M18 10h2M12 14.5h2M18 14.5h2M12 19h2M18 19h2M13 26v-4h6v4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
function IconFactory({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" className={className} aria-hidden>
      <path
        d="M6 26V16l6 4v-4l6 4v-4l6 4v6H6Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M23 15V9M23 9l3-3M6 26h20" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
function IconRoad({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" className={className} aria-hidden>
      <path d="M12 6 6 26M20 6l6 20" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M16 9v2M16 14.5v2M16 20v2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
function IconCheck({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" className={className} aria-hidden>
      <circle cx="16" cy="16" r="11" stroke="currentColor" strokeWidth="1.5" />
      <path d="M11 16.5l3.5 3.5L21 12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function IconCalendar({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" className={className} aria-hidden>
      <rect x="6" y="8" width="20" height="17" rx="0.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M6 13h20M11 5v6M21 5v6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
function IconDoc({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" className={className} aria-hidden>
      <path d="M10 5h9l5 5v17H10V5Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M19 5v5h5M13 17h8M13 21h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
function IconFlag({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" className={className} aria-hidden>
      <path d="M9 4v24" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M9 6h14l-3.5 5L23 16H9" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

const sectors = [
  {
    n: "01",
    title: "Residential",
    desc: "Custom homes and renovations, designed around how families live.",
    Icon: IconHouse,
  },
  {
    n: "02",
    title: "Commercial",
    desc: "Offices and mixed-use developments, delivered on schedule and on budget.",
    Icon: IconBuilding,
  },
  {
    n: "03",
    title: "Industrial",
    desc: "Warehouses and plants engineered for heavy daily use.",
    Icon: IconFactory,
  },
  {
    n: "04",
    title: "Infrastructure",
    desc: "Roads, drainage, and public works — private and PCAB-registered government projects.",
    Icon: IconRoad,
  },
];

const capabilities = [
  {
    title: "Documented Approvals",
    desc: "Every change order and payment runs through a logged approval — nothing verbal, nothing lost.",
    Icon: IconCheck,
  },
  {
    title: "Weekly Progress Reports",
    desc: "Photo-backed site updates on a fixed schedule, not just when you happen to call.",
    Icon: IconCalendar,
  },
  {
    title: "A Paper Trail You Can Trust",
    desc: "Quotations, contracts, and permits tracked in one system — ready if you need to review them.",
    Icon: IconDoc,
  },
  {
    title: "Private & Government Ready",
    desc: "PCAB-registered and structured to take on public-works bids, not just private builds.",
    Icon: IconFlag,
  },
];

export default function HomePage() {
  return (
    <main
      style={palette}
      className={`${display.variable} ${body.variable} min-h-screen bg-[var(--paper)] font-[family-name:var(--font-body)] text-[var(--ink)]`}
    >
      {/* Navigation — plain text links, no button in the bar itself */}
      <header className="sticky top-0 z-30 border-b border-[var(--line)] bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-8">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center bg-[var(--navy)] font-[family-name:var(--font-display)] text-lg text-white">
              M
            </span>
            <div className="leading-tight">
              <div className="font-[family-name:var(--font-display)] text-lg tracking-wide">
                Maxey Construction
              </div>
              <div className="text-[9.5px] uppercase tracking-[0.18em] text-[var(--ink-3)]">
                Nueva Ecija · PCAB Registered
              </div>
            </div>
          </div>
          <nav className="hidden items-center gap-8 text-[12px] font-medium uppercase tracking-[0.1em] sm:flex">
            <a href="#work" className="text-[var(--ink-2)] transition-colors hover:text-[var(--navy)]">
              Work
            </a>
            <a href="#about" className="text-[var(--ink-2)] transition-colors hover:text-[var(--navy)]">
              About
            </a>
            <a href="#contact" className="text-[var(--ink-2)] transition-colors hover:text-[var(--navy)]">
              Contact
            </a>
            <Link
              href="/login"
              className="normal-case tracking-normal text-[var(--ink-3)] transition-colors hover:text-[var(--ink)]"
            >
              Sign in
            </Link>
          </nav>
          <Link
            href="/login"
            className="border border-[var(--line)] px-3 py-1.5 text-xs font-medium text-[var(--ink-2)] sm:hidden"
          >
            Sign in
          </Link>
        </div>
      </header>

      {/* Hero — full-bleed dark section, textured in place of live jobsite
          footage (no real video asset exists yet), oversized condensed
          headline, ghost-outline CTA, scroll cue. */}
      <section className="relative overflow-hidden bg-[var(--ink)]">
        {/* Base wash — ~40% burgundy / 60% black, diagonal so the text-heavy
            top-left corner sits on the darkest stop for contrast. */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "linear-gradient(133deg, #430c15 0%, #7a1523 11%, #8a1a28 23%, #6e1420 34%, #3d0a12 40%, #1c0407 56%, #100304 72%, #0a0605 100%)",
          }}
        />
        {/* Metallic/platinum sheen — two soft diagonal highlight streaks plus
            a fine brushed-metal hairline texture, blended over the wash. */}
        <div
          className="pointer-events-none absolute inset-0 mix-blend-overlay"
          style={{
            background: [
              "linear-gradient(118deg, transparent 8%, rgba(237,231,222,0.22) 19%, transparent 32%, transparent 58%, rgba(237,231,222,0.14) 70%, transparent 82%)",
              "repeating-linear-gradient(118deg, rgba(255,255,255,0.05) 0px, rgba(255,255,255,0.05) 1px, transparent 1px, transparent 4px)",
            ].join(", "),
          }}
        />
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.25] mix-blend-overlay"
          style={{
            backgroundImage:
              "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.5'/%3E%3C/svg%3E\")",
            backgroundSize: "180px 180px",
          }}
        />
        <div className="relative mx-auto max-w-6xl px-4 py-24 sm:px-8 sm:py-32">
          <p className="mb-5 text-[12px] font-semibold uppercase tracking-[0.22em] text-[#dad7d3]">
            PCAB-Registered · Nueva Ecija, Philippines
          </p>
          <h1 className="max-w-3xl font-[family-name:var(--font-display)] text-[16vw] leading-[0.92] text-white sm:text-7xl lg:text-8xl">
            Passion to build.
            <br />
            <span className="text-[#dad7d3]">Commitment to deliver.</span>
          </h1>
          <p className="mt-8 max-w-lg text-[15px] leading-relaxed text-[#bdb8b2]">
            A PCAB-registered contractor serving Central Luzon — residential to
            infrastructure, private and government projects, run on a documented,
            on-schedule process from groundbreak to turnover.
          </p>
          <div className="mt-10 flex flex-wrap items-center gap-6">
            <a
              href="#contact"
              className="inline-flex min-h-[52px] items-center border border-white/70 px-9 text-[12px] font-semibold uppercase tracking-[0.14em] text-white transition-colors hover:bg-white hover:text-[var(--ink)]"
            >
              Know More
            </a>
            <a
              href="#work"
              className="text-[12px] font-semibold uppercase tracking-[0.14em] text-[#bdb8b2] transition-colors hover:text-white"
            >
              Scroll Down ↓
            </a>
          </div>
        </div>
      </section>

      {/* Trusted to deliver — Mission / Vision, DMCI-style tabbed section
          rendered as a static two-column block for robustness. */}
      <section id="about" className="border-b border-[var(--line)] bg-white">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-8">
          <h2 className="font-[family-name:var(--font-display)] text-4xl text-[var(--navy)] sm:text-5xl">
            Trusted to Deliver
          </h2>
          <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-[var(--ink-2)]">
            Led by a civil engineer with fourteen years in the field, we work
            hand-in-hand with owners, architects, and designers across Central
            Luzon — private and government projects alike.
          </p>
          <div className="mt-12 grid gap-px overflow-hidden border border-[var(--line)] bg-[var(--line)] sm:grid-cols-2">
            <div className="bg-white p-8">
              <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--navy)]">
                Our Mission
              </span>
              <p className="mt-3 text-[15px] leading-relaxed text-[var(--ink-2)]">
                Build structures of technical integrity that serve our clients and
                communities well, while running the business on documented,
                professional standards from day one.
              </p>
            </div>
            <div className="bg-white p-8">
              <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--navy)]">
                Our Vision
              </span>
              <p className="mt-3 text-[15px] leading-relaxed text-[var(--ink-2)]">
                To be a trusted, PCAB-grade contractor of choice across Central
                Luzon — for homeowners, businesses, and government alike.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Scope of Work — horizontal swipeable row instead of a static grid */}
      <section id="work" className="bg-[var(--paper)] py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-8">
          <div className="mb-8 flex items-end justify-between">
            <h2 className="font-[family-name:var(--font-display)] text-4xl text-[var(--navy)] sm:text-5xl">
              Scope of Work
            </h2>
            <span className="hidden text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--ink-3)] sm:block">
              Swipe to explore →
            </span>
          </div>
        </div>
        <div className="scrollbar-hide flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-4 sm:px-8 [&::-webkit-scrollbar]:hidden">
          {sectors.map((s) => (
            <div
              key={s.title}
              className="w-[78%] flex-shrink-0 snap-start bg-white p-7 shadow-sm sm:w-[42%] lg:w-[23%]"
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--ink-3)]">
                  {s.n}
                </span>
                <s.Icon className="h-7 w-7 text-[var(--navy)]" />
              </div>
              <h3 className="mt-7 font-[family-name:var(--font-display)] text-2xl">{s.title}</h3>
              <p className="mt-2 text-[13.5px] leading-relaxed text-[var(--ink-3)]">{s.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Credentials band — ISO-certification-style trust strip */}
      <section className="bg-[var(--navy)]">
        <div className="mx-auto grid max-w-6xl divide-y divide-white/15 px-4 sm:grid-cols-4 sm:divide-x sm:divide-y-0 sm:px-8">
          <div className="px-1 py-8 sm:px-8">
            <b className="block text-[15px] font-semibold text-white">PCAB Registered</b>
            <span className="text-[11px] uppercase tracking-[0.14em] text-[#bdb8b2]">Active status</span>
          </div>
          <div className="px-1 py-8 sm:px-8">
            <b className="block text-[15px] font-semibold text-white">14 Years</b>
            <span className="text-[11px] uppercase tracking-[0.14em] text-[#bdb8b2]">
              Principal experience
            </span>
          </div>
          <div className="px-1 py-8 sm:px-8">
            <b className="block text-[15px] font-semibold text-white">Private &amp; Government</b>
            <span className="text-[11px] uppercase tracking-[0.14em] text-[#bdb8b2]">Client classes</span>
          </div>
          <div className="px-1 py-8 sm:px-8">
            <b className="block text-[15px] font-semibold text-white">San Isidro</b>
            <span className="text-[11px] uppercase tracking-[0.14em] text-[#bdb8b2]">
              Nueva Ecija · Central Luzon
            </span>
          </div>
        </div>
      </section>

      {/* How We Work — capability strip, same swipeable-row format */}
      <section className="bg-white py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-8">
          <h2 className="font-[family-name:var(--font-display)] text-4xl text-[var(--navy)] sm:text-5xl">
            How We Work
          </h2>
        </div>
        <div className="scrollbar-hide mt-8 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-4 sm:px-8 [&::-webkit-scrollbar]:hidden">
          {capabilities.map((c) => (
            <div
              key={c.title}
              className="w-[78%] flex-shrink-0 snap-start border border-[var(--line)] p-7 sm:w-[42%] lg:w-[23%]"
            >
              <c.Icon className="h-7 w-7 text-[var(--navy)]" />
              <h3 className="mt-6 text-[15px] font-semibold">{c.title}</h3>
              <p className="mt-2 text-[13.5px] leading-relaxed text-[var(--ink-3)]">{c.desc}</p>
              <a
                href="#contact"
                className="mt-4 inline-block text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--navy)] hover:underline"
              >
                Find out more
              </a>
            </div>
          ))}
        </div>
      </section>

      {/* Testimonial */}
      <section className="bg-[var(--paper)] px-4 py-24 text-center sm:px-8">
        <div className="mx-auto max-w-2xl">
          <span className="font-[family-name:var(--font-display)] text-6xl text-[var(--navy)]" aria-hidden>
            &ldquo;
          </span>
          <blockquote className="mt-2 text-2xl leading-snug text-[var(--ink)] sm:text-3xl">
            Clear updates every week, honest costing, and the house was turned
            over right on schedule. I would not think twice about building with
            Maxey again.
          </blockquote>
          <p className="mt-6 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--ink-3)]">
            A. Dela Cruz — Cabanatuan City
          </p>
        </div>
      </section>

      {/* Contact — feeds the CRM automatically */}
      <section id="contact" className="bg-white py-24">
        <div className="mx-auto max-w-2xl px-4 sm:px-8">
          <h2 className="text-center font-[family-name:var(--font-display)] text-4xl text-[var(--navy)] sm:text-5xl">
            Don&apos;t Hesitate to Contact Us
          </h2>
          <p className="mt-3 text-center text-[14px] text-[var(--ink-3)]">
            Tell us about your project. We acknowledge every inquiry immediately and
            respond with an estimate within 3–5 business days.
          </p>
          <div className="mt-10">
            <ContactForm />
          </div>
          <p className="mt-8 text-center text-[13px] text-[var(--ink-3)]">
            374 Malapit, San Isidro, Nueva Ecija, Philippines
          </p>
        </div>
      </section>

      {/* Footer — pure burgundy fade, no black */}
      <footer
        className="pb-8 pt-8 text-[#e8cdd1]"
        style={{
          background: "linear-gradient(133deg, #8a1a28 0%, #6e1420 55%, #3d0a12 100%)",
        }}
      >
        <div className="mx-auto max-w-6xl px-4 sm:px-8">
          <div className="flex flex-wrap items-center justify-between gap-4 text-[11px] uppercase tracking-[0.1em]">
            <span>© {new Date().getFullYear()} Maxey Construction</span>
            <span>PCAB-Registered · Residential · Commercial · Industrial · Infrastructure</span>
            <Link href="/login" className="text-[#bdb8b2] transition-colors hover:text-white">
              Client Portal / Staff Sign in
            </Link>
          </div>
        </div>
      </footer>
    </main>
  );
}
