# Deploy Vercel + Neon

Este projeto usa Next.js, Prisma e PostgreSQL no Neon.

## 1. Criar banco Neon

1. Acesse `https://neon.com`.
2. Crie uma conta gratuita.
3. Crie um projeto, por exemplo `app-escala-md`.
4. Copie a connection string do banco com SSL.
5. Use o formato:

```env
DATABASE_URL="postgresql://USER:PASSWORD@HOST.neon.tech/DBNAME?sslmode=require"
```

## 2. Configurar ambiente local com Neon

No arquivo `.env`, substitua `DATABASE_URL` pela URL do Neon.

Depois rode:

```powershell
npm run db:setup
```

Esse comando cria as tabelas no Neon e cria os dados estruturais iniciais, incluindo o gerente Ferreira.

## 3. Criar projeto na Vercel

1. Acesse `https://vercel.com`.
2. Importe o repositório do projeto.
3. Configure as variáveis de ambiente:

```env
DATABASE_URL="postgresql://USER:PASSWORD@HOST.neon.tech/DBNAME?sslmode=require"
AUTH_SECRET="gere-um-segredo-forte"
MANAGER_EMAIL="email-do-ferreira"
MANAGER_INITIAL_PASSWORD="1234"
NEXT_PUBLIC_APP_URL="https://seu-projeto.vercel.app"
LLM_PROVIDER="gemini"
GEMINI_BASE_URL="https://generativelanguage.googleapis.com/v1beta"
GEMINI_API_KEY="sua-chave-gemini"
GEMINI_MODEL="gemini-3.5-flash"
```

4. Deploy command: use o padrao da Vercel, `npm run build`.
5. Depois do primeiro deploy, rode `npm run db:setup` localmente apontando para o mesmo `DATABASE_URL` da Vercel, se ainda nao tiver criado as tabelas.

## Observacoes

- O banco SQLite local antigo nao e mais usado no deploy.
- O arquivo `prisma/dev.db` pode ficar como backup local antigo, mas nao participa da producao.
- Em producao, mantenha o plano Neon ativo e use sempre a URL com `sslmode=require`.
