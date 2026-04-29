// Wire format for the JSON files the pytest plugin writes (`results.json`)
// and the user commits as a baseline (`baseline.json`). Same shape, different
// roles. Keep this in sync with `evalcheck/snapshot.py` on the plugin side —
// the schema_version field is what lets us evolve them independently later.

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
