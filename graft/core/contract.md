# core/contract.ts

- ValidationError · class · L2-L4 — class ValidationError extends Error
- CommitSnapshot · interface · L7-L10 — interface CommitSnapshot
- RunSnapshot · interface · L13-L17 — interface RunSnapshot
- Snapshot · type · L19-L19 — type Snapshot = CommitSnapshot | RunSnapshot;
- MetricKey · type · L21-L21 — type MetricKey = 'commit' | 'run';
- Metric · interface · L23-L29 — interface Metric<S extends Snapshot>
- TableRows · interface · L32-L36 — interface TableRows
- ShieldsEndpoint · interface · L39-L45 — interface ShieldsEndpoint
- Store · interface · L47-L52 — interface Store<S extends Snapshot>
- InputSpec · interface · L54-L58 — interface InputSpec
- CollectContext · interface · L60-L66 — interface CollectContext
- Collector · interface · L68-L73 — interface Collector<S extends Snapshot>
- WorkerEntry · interface · L76-L79 — interface WorkerEntry
- CollectorEntry · interface · L82-L85 — interface CollectorEntry
