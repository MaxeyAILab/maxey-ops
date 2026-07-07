import { Suspense } from "react";
import { LoginForm } from "@/components/login-form";

export const metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-ink-950 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-2">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-500 font-black text-white">
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
