import { Suspense } from "react";
import { LoginForm } from "@/components/login-form";

export const metadata = { title: "Sign in" };

// Kept on the original burgundy/near-black look (pre-2026-09 retheme) by
// request — every other page follows the new teal/sage theme, this one
// deliberately doesn't, so colors here are hardcoded rather than themed.
export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#191715] px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-2">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#8a1a28] font-black text-white">
            M
          </span>
          <span className="text-xl font-bold text-white">Maxey Construction</span>
        </div>
        <Suspense>
          <LoginForm />
        </Suspense>
      </div>
    </main>
  );
}
