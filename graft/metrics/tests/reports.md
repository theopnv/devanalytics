# metrics/tests/reports.ts

- NamedPath · interface · L6-L9 — interface NamedPath
- LoadedReports · interface · L11-L14 — interface LoadedReports
- parseNamedPaths · function · L20-L36 — function parseNamedPaths(value: string | undefined): NamedPath[]
- readReport · function · L38-L52 — async function readReport(file: string): Promise<string | null>
- loadReports · function · L59-L78 — async function loadReports(root: string, entries: readonly NamedPath[], warn: (message: string) => void, workspace?: string): Promise<LoadedReports>
