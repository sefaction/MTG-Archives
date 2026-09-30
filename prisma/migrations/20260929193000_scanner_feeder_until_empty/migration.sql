-- New scanner runs may finish when the feeder is exhausted without an
-- operator-entered loaded-card count. Existing counted runs retain their value.
ALTER TABLE "ScannerRun" ALTER COLUMN "loadedCount" DROP NOT NULL;
