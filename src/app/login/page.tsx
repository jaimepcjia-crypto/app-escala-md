"use client";

import { useEffect, useState } from "react";
import { LogIn } from "lucide-react";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  // URL de acesso pessoal (.../login?email=...) pré-preenche o e-mail; a senha é digitada.
  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("email");
    if (fromUrl) setEmail(fromUrl);
  }, []);

  async function login() {
    setError("");
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    });
    const data = await response.json();
    if (!response.ok) {
      setError(data.error ?? "Falha no login.");
      return;
    }
    window.location.href = data.user.role === "MANAGER" ? "/admin" : "/escala";
  }

  return (
    <main className="grid min-h-screen place-items-center px-4 py-8 text-ink">
      <section className="hero-panel grid w-full max-w-4xl overflow-hidden rounded-[30px] md:grid-cols-[1.05fr_0.95fr]">
        <div className="bg-ink p-7 text-paper sm:p-10">
          <p className="eyebrow !text-sand">Escala MD</p>
          <h1 className="mt-5 text-4xl font-semibold leading-tight sm:text-5xl">Decisões semanais com clareza e equilíbrio.</h1>
          <p className="ui-font mt-5 max-w-sm text-sm leading-relaxed text-paper/65">Gestão de plantões, indisponibilidades e meritocracia em um único fluxo operacional.</p>
        </div>
        <div className="p-6 sm:p-9">
        <p className="eyebrow">Acesso seguro</p>
        <h2 className="mt-2 text-3xl font-semibold">Entrar</h2>
        <div className="mt-5 grid gap-3">
          <label className="ui-font text-sm font-bold">
            Email
            <input
              className="control mt-1 w-full rounded-md px-3 py-2"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              data-help="Informe o email cadastrado para acessar o app."
            />
          </label>
          <label className="ui-font text-sm font-bold">
            Senha
            <input
              className="control mt-1 w-full rounded-md px-3 py-2"
              type="password"
              inputMode="numeric"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              data-help="Informe sua senha numerica."
            />
          </label>
          <button className="action-primary py-3" onClick={login} data-help="Entra no app com este email e senha.">
            <LogIn size={18} />
            Acessar
          </button>
          {error ? <p className="ui-font rounded-md border border-signal/20 bg-signal/10 p-2 text-sm text-signal">{error}</p> : null}
          <p className="ui-font text-xs text-graphite">O gerente cria os logins dos corretores e pode redefinir senhas quando necessario.</p>
        </div>
        </div>
      </section>
    </main>
  );
}
