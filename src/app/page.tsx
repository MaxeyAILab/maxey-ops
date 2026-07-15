import Link from "next/link";
import { ContactForm } from "@/components/contact-form";

/**
 * Public site — outline follows integralbuilders.co.uk (nav / hero with
 * centered headline + CTA / about / services grid / testimonial / footer),
 * restyled with Maxey Construction's existing brand palette.
 */

const services = [
  {
    title: "Residential",
    desc: "Custom homes, renovations, and subdivision builds — designed around how your family lives.",
    icon: "🏠",
  },
  {
    title: "Commercial",
    desc: "Offices, retail, and mixed-use developments delivered on schedule and on budget.",
    icon: "🏢",
  },
  {
    title: "Industrial",
    desc: "Warehouses, plants, and facilities engineered for heavy daily use.",
    icon: "🏭",
  },
  {
    title: "Infrastructure",
    desc: "Roads, drainage, and public works — private and government projects, PCAB-registered.",
    icon: "🛣️",
  },
];

export default function HomePage() {
  return (
    <main className="min-h-screen bg-white">
      {/* Navigation — logo left, menu right */}
      <header className="sticky top-0 z-30 border-b border-ink-100 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3.5">
          <div className="flex items-center gap-2.5">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-500 text-lg font-black text-white">
              M
            </span>
            <div>
              <div className="text-lg font-bold leading-tight text-ink-900">
                Maxey Construction
              </div>
              <div className="text-[10px] uppercase tracking-widest text-ink-400">
                Nueva Ecija · PCAB Registered
              </div>
            </div>
          </div>
          <nav className="hidden items-center gap-6 text-sm font-medium sm:flex">
            <a href="#about" className="text-ink-600 hover:text-brand-600">
              About
            </a>
            <a href="#services" className="text-ink-600 hover:text-brand-600">
              Services
            </a>
            <a href="#testimonials" className="text-ink-600 hover:text-brand-600">
              Testimonials
            </a>
            <a href="#contact" className="text-ink-600 hover:text-brand-600">
              Contact
            </a>
            <a
              href="#contact"
              className="rounded-lg bg-brand-500 px-4 py-2 font-semibold text-white hover:bg-brand-600"
            >
              GET A QUOTE
            </a>
            <Link
              href="/login"
              className="rounded-lg border border-ink-200 px-3.5 py-2 text-ink-700 hover:bg-ink-50"
            >
              Sign in
            </Link>
          </nav>
          <Link
            href="/login"
            className="rounded-lg border border-ink-200 px-3 py-1.5 text-sm font-medium text-ink-700 hover:bg-ink-50 sm:hidden"
          >
            Sign in
          </Link>
        </div>
      </header>

      {/* Hero — full-width banner, centered headline + subheading + CTA */}
      <section className="relative overflow-hidden bg-ink-950">
        <div
          className="absolute inset-0 opacity-30"
          style={{
            backgroundImage:
              "linear-gradient(135deg, #6e142022 25%, transparent 25%), linear-gradient(225deg, #6e142022 25%, transparent 25%), linear-gradient(45deg, #6e142011 25%, transparent 25%), linear-gradient(315deg, #6e142011 25%, transparent 25%)",
            backgroundSize: "120px 120px",
          }}
        />
        <div className="relative mx-auto max-w-4xl px-4 py-28 text-center sm:py-36">
          <h1 className="text-4xl font-black leading-tight text-white sm:text-6xl">
            Put Your Project in Our Hands
          </h1>
          <p className="mt-4 text-lg font-medium tracking-wide text-brand-300 sm:text-xl">
            Development and Construction Specialists
          </p>
          <a
            href="#contact"
            className="mt-10 inline-flex min-h-[52px] items-center rounded-lg bg-brand-500 px-10 text-base font-bold uppercase tracking-wide text-white hover:bg-brand-600"
          >
            Get a Quote
          </a>
        </div>
      </section>

      {/* About */}
      <section id="about" className="mx-auto max-w-4xl px-4 py-20 text-center">
        <h2 className="text-2xl font-bold leading-snug text-ink-900 sm:text-3xl">
          Maxey Construction is a PCAB-registered contractor specialising in Residential,
          Commercial, Industrial and Infrastructure projects
        </h2>
        <p className="mx-auto mt-5 max-w-2xl text-ink-500">
          Led by a civil engineer with 14 years of industry experience, we work hand-in-hand
          with owners, architects, and designers across Central Luzon — private and government
          projects alike. Every project runs on our digital operations platform: transparent
          progress reports, documented approvals, and a paper trail you can trust.
        </p>
        <div className="mt-6 flex items-center justify-center gap-4 text-sm">
          <a href="#contact" className="font-semibold text-brand-600 hover:underline">
            More About Us →
          </a>
          <span className="text-ink-300">|</span>
          <a
            href="https://www.facebook.com"
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-ink-500 hover:text-brand-600"
          >
            Facebook
          </a>
        </div>
      </section>

      {/* Services — four-column grid with image-style cards */}
      <section id="services" className="bg-ink-50 py-20">
        <div className="mx-auto max-w-6xl px-4">
          <h2 className="text-center text-2xl font-bold text-ink-900 sm:text-3xl">
            What We Build
          </h2>
          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {services.map((s) => (
              <div
                key={s.title}
                className="overflow-hidden rounded-xl border border-ink-100 bg-white shadow-sm transition-shadow hover:shadow-md"
              >
                <div className="flex h-36 items-center justify-center bg-gradient-to-br from-ink-900 to-ink-700 text-5xl">
                  <span aria-hidden>{s.icon}</span>
                </div>
                <div className="p-5">
                  <h3 className="font-bold text-ink-900">{s.title}</h3>
                  <p className="mt-1.5 text-sm text-ink-500">{s.desc}</p>
                  <a
                    href="#contact"
                    className="mt-3 inline-block text-sm font-semibold text-brand-600 hover:underline"
                  >
                    Read More →
                  </a>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Testimonial */}
      <section id="testimonials" className="mx-auto max-w-3xl px-4 py-20 text-center">
        <div className="text-5xl text-brand-400" aria-hidden>
          “
        </div>
        <blockquote className="text-xl font-medium leading-relaxed text-ink-800">
          From start to finish they were excellent — clear updates every week, honest costing,
          and the house was turned over right on schedule. I would not think twice about
          building with Maxey again.
        </blockquote>
        <p className="mt-4 text-sm font-semibold uppercase tracking-wide text-ink-400">
          — A. Dela Cruz, Cabanatuan City
        </p>
      </section>

      {/* Contact / quote — feeds the CRM automatically */}
      <section id="contact" className="bg-ink-950 py-20">
        <div className="mx-auto max-w-2xl px-4">
          <h2 className="text-center text-2xl font-bold text-white sm:text-3xl">
            Request an Estimate
          </h2>
          <p className="mt-2 text-center text-sm text-ink-300">
            Tell us about your project. We acknowledge every inquiry immediately and respond
            with an estimate within 3–5 business days.
          </p>
          <div className="mt-8">
            <ContactForm />
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-ink-950 pb-10 text-ink-400">
        <div className="mx-auto max-w-6xl border-t border-ink-800 px-4 pt-10">
          <div className="grid gap-8 sm:grid-cols-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-500 text-sm font-black text-white">
                  M
                </span>
                <span className="font-bold text-white">Maxey Construction</span>
              </div>
              <p className="mt-3 text-sm">
                374 Malapit, San Isidro,
                <br />
                Nueva Ecija, Philippines
              </p>
            </div>
            <div>
              <h4 className="text-xs font-bold uppercase tracking-widest text-ink-300">
                Credentials
              </h4>
              <p className="mt-3 text-sm">
                PCAB-Registered Contractor
                <br />
                Private &amp; Government Projects
                <br />
                Residential · Commercial · Industrial · Infrastructure
              </p>
            </div>
            <div>
              <h4 className="text-xs font-bold uppercase tracking-widest text-ink-300">
                Links
              </h4>
              <ul className="mt-3 space-y-1.5 text-sm">
                <li>
                  <a href="#about" className="hover:text-white">
                    About
                  </a>
                </li>
                <li>
                  <a href="#services" className="hover:text-white">
                    Services
                  </a>
                </li>
                <li>
                  <a href="#contact" className="hover:text-white">
                    Contact
                  </a>
                </li>
                <li>
                  <Link href="/login" className="hover:text-white">
                    Client Portal / Staff Sign in
                  </Link>
                </li>
              </ul>
            </div>
          </div>
          <div className="mt-10 border-t border-ink-800 pt-5 text-center text-xs">
            © {new Date().getFullYear()} Maxey Construction. All rights reserved.
          </div>
        </div>
      </footer>
    </main>
  );
}
