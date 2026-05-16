# Structural Master

Arabic/RTL structural engineering design app (React + Vite). Covers full workflow: modelling → analysis → beam/column/slab design → foundation design → export.

## Run & Operate

```bash
pnpm install                                       # install all deps
pnpm --filter @workspace/structural-app run dev    # web app (port from $PORT)
pnpm --filter @workspace/structural-app run typecheck  # TS check (4 pre-existing errors from third-party types are OK)
```

## Stack

- **Monorepo**: pnpm workspaces
- **Web app**: React 18 + Vite + Tailwind CSS v3 + shadcn/ui
- **Language**: Arabic RTL throughout
- **No backend** — pure frontend structural calculations
- **Mobile**: Expo Router (`artifacts/structural-mobile`) — separate artifact

## Where things live

```
artifacts/structural-app/src/
  pages/
    Index.tsx               — Main 4000+ line app shell; all tabs live here
    indexReducer.ts         — Centralized state + undo stack
  lib/
    structuralEngine.ts     — All structural calculation types & core functions
    foundationDesign.ts     — NEW: WSM/ASD foundation design engine (UBC 1997)
    analysisController.ts   — Engine selection (stiffness matrix vs simplified)
  components/
    ETABSAnalysisImport.tsx — ENHANCED: parses Beams + Columns + Reactions from xlsx
    FoundationDesignPanel.tsx — NEW: Foundation design UI (WSM, UBC 1997)
    ExportPanel.tsx         — Multi-floor export (PDF/DXF/HTML sheets)
  export/ drawings/ rebar/  — PDF generation, DXF export, BBS, construction sheets
```

## Architecture decisions

- All analysis runs client-side (no backend). ETABS xlsx parsed via `xlsx` library.
- Design tab has two sub-tabs: "تصميم الجسور والأعمدة" and "تصميم الأساسات (WSM)".
- Foundation design uses Working Stress Method (ASD) per UBC 1997 / ACI 318 Appendix A — **not** ultimate strength (USD). Iterates footing thickness to satisfy shear.
- ETABS import now parses three sheet types in one file: Element Forces-Beams, Element Forces-Columns, Support Reactions.
- Foundation plan exported as self-contained HTML (SVG plan + summary table) for printing/PDF.
- **Column orientation angle (`orientAngle`)**: `Column` interface now has `orientAngle?: number` (degrees CCW from Global X). 0°=b along X/h along Y (default). 3D engine passes `localYOverride=[cos α, sin α, 0]` to the solver. 2D moment-distribution path uses Mohr's circle: `I_x = Ip1·cos²α + Ip2·sin²α`, `I_y = Ip1·sin²α + Ip2·cos²α`. Persisted in `colOverrides`. Validation test: `runOrientationValidationTest()` in `solver3D.ts`.

## Product

- Multi-story 3D structural modelling with slab/beam/column layout
- Analysis: simplified stiffness matrix, solver engines with load combos
- Design: ACI 318 beam flexure + shear, Bresler biaxial column, slab punching shear
- **NEW** As (mm²) table showing required reinforcement area at beam ends and midspan
- **NEW** Foundation design: isolated spread footings WSM/ASD (UBC 1997) — iterates for size and thickness, checks bearing, wide-beam shear, punching shear
- **NEW** Foundation plan drawing export (HTML/SVG with reinforcement table)
- **NEW** ETABS import: column forces and base reactions alongside beam results
- Export: PDF construction sheets, DXF, BBS, Arabic title block

## Gotchas

- `Index.tsx` is 4100+ lines — edits must be surgical
- Three.js and react-resizable-panels TypeScript errors are pre-existing (from third-party types) — safe to ignore
- ETABS xlsx sheets must be named to contain "beam"/"column"/"reaction" (case-insensitive) for the parser to detect them
- Foundation design assumes square footings; DL/LL split from app analysis is approximate (60/40)
