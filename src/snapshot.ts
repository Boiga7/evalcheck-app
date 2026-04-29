export type Snapshot = {
  test_id: string;
  metric: string;
  score: number;
  threshold: number | null;
  timestamp: string;
};

export type SnapshotFile = {
  schema_version: 1;
  runs: Snapshot[];
};
