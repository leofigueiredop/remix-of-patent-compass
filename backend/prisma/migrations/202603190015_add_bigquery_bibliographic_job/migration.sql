CREATE TABLE IF NOT EXISTS "BigQueryBibliographicJob" (
    "id" TEXT NOT NULL,
    "patent_number" TEXT NOT NULL,
    "rpi_number" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "docdb_id" TEXT,
    "source_job_type" TEXT,
    "source_job_id" TEXT,
    "error" TEXT,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BigQueryBibliographicJob_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "BigQueryBibliographicJob_patent_number_key" ON "BigQueryBibliographicJob"("patent_number");
CREATE INDEX IF NOT EXISTS "BigQueryBibliographicJob_status_created_at_idx" ON "BigQueryBibliographicJob"("status", "created_at");
