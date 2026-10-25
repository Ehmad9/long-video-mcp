# Contributing

Contributions are welcome!

1. Fork the repository, then create a branch for your change.
2. Run `npm install`, `npm run build` and `npm test` and make sure they pass.
3. Open a Pull Request describing **what** changed and **why**.
4. The maintainer reviews every Pull Request before merging.

## Why every PR is reviewed by hand

This server runs on users' own computers and can read and write files there.
Merging code without review would let anyone ship harmful code to every user,
so no change is merged automatically.

## Guidelines

- Keep changes small and focused.
- Do not add new dependencies without explaining why.
- Never use `console.log` in the server (it breaks the stdio channel); use `console.error`.
- Never commit API keys or secrets.
