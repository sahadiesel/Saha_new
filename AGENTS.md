# Sahadiesel Service Center System

Full-stack Thai automotive service management system (ERP/PWA) built with Next.js 15 + Firebase.

## Cursor Cloud specific instructions

### Node.js Version

This project requires **Node.js 20**. Use `nvm use 20` before running any commands.

### Key Commands

| Action | Command |
|--------|---------|
| Dev server | `npm run dev` (port 3000) or `npm run dev:local` (port 9002) |
| Lint | `npm run lint` |
| Type check | `npm run typecheck` |
| Build | `npm run build` |
| Build Cloud Functions | `cd functions && npm run build` |

### Architecture Notes

- **Frontend**: Next.js 15 (App Router) at root `/workspace`
- **Backend**: Firebase Cloud Functions at `/workspace/functions/` (separate `package.json`)
- **Database**: Firebase Firestore (cloud) — no local emulator configured
- **Auth**: Firebase Auth (email/password)
- **Storage**: Firebase Storage (images)
- **AI**: Genkit/Gemini integration exists but is disabled in production

### Gotchas

- `next.config.ts` has `typescript: { ignoreBuildErrors: true }` and `eslint: { ignoreDuringBuilds: true }`. The codebase has known TS errors that are intentionally ignored during build.
- `npm run typecheck` will show TypeScript errors — this is expected and does not block the build.
- `npm run lint` requires `eslint` and `eslint-config-next` (added as devDependencies) plus `eslint.config.mjs` at root.
- The app connects to a **production Firebase project** (`studio-5187516946-67996`). There are no local emulators configured.
- Firebase credentials are configured via environment variables in `.env` (the `GEMINI_API_KEY`). The Firebase client config is embedded in source code.
- The UI is entirely in **Thai language**.
- The `functions/` directory has its own `package.json` and `tsconfig.json` — always run `npm install` there separately.
