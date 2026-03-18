ALTER TABLE "inpi_patents"
ADD COLUMN IF NOT EXISTS "resumo_detalhado" TEXT,
ADD COLUMN IF NOT EXISTS "procurador" TEXT;
