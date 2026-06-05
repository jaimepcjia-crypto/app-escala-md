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
      <section className="panel w-full max-w-md rounded-lg p-5">
        <p className="ui-font text-xs font-bold uppercase tracking-[0.16em] text-signal">Escala MD</p>
        <h1 className="mt-1 text-3xl font-bold">Entrar</h1>
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
          <button className="ui-font inline-flex items-center justify-center gap-2 rounded-md bg-ink px-4 py-3 font-bold text-paper" onClick={login} data-help="Entra no app com este email e senha.">
            <LogIn size={18} />
            Acessar
          </button>
          {error ? <p className="ui-font rounded-md border border-signal/20 bg-signal/10 p-2 text-sm text-signal">{error}</p> : null}
          <p className="ui-font text-xs text-graphite">O gerente cria os logins dos corretores e pode redefinir senhas quando necessario.</p>
        </div>
      </section>
    </main>
  );
}
