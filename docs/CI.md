# Uafhængig CI

`.github/workflows/ci.yml` kører projektets fulde `npm run verify` på pushes, pull requests mod `main` og manuelle runs. Workflowet er uafhængigt af Netlify: det bygger og validerer, men publicerer eller deployer aldrig.

## Kontrakt

- Node er låst i `.nvmrc`; GitHub Actions bruger den præcise version.
- `npm ci` installerer udelukkende `package-lock.json`. npm-cachen indeholder downloadede pakker, ikke `node_modules`, og kan derfor ikke erstatte eller skjule en fejlet installation.
- Workflowet bruger kun `contents: read`, ingen secrets og ingen private redaktionelle filer. `editorial-private/` skal være fraværende i checkoutet, og alle redaktionelle tests skal bruge syntetiske fixtures.
- `npm run verify` skal afslutte med exit code 0. Enhver fejlet deltest gør jobbet rødt; der bruges ikke `continue-on-error`.
- Efter build kræver `git diff --exit-code`, at ingen trackede filer er ændret. Trykpressens genererede output er derfor konsekvent ignorerede buildartefakter.
- Actions er pinnet til fulde commit-SHA'er. Samtidige push-/PR-runs for samme branch deler concurrency-gruppe, så kun det nyeste fortsætter.

## Merge-gate

Aktivér branch protection/ruleset for `main` i GitHub og kræv statuschecket **`CI / npm run verify`** før merge. Kræv også, at branchen er opdateret med `main`. Den repository-indstilling er manuel og indgår ikke i workflowfilen.

Netlify-preview eller production deploy er en separat publiceringskontrol. Grøn CI betyder, at repoets validering er bestået; den betyder ikke, at Netlify har deployet. Brug `[skip netlify]` på rene dokumentationscommits, når de ikke ændrer det publicerede site.

Lokalt bruges samme kontrakt:

```bash
npm ci
npm run verify
git diff --exit-code
```
