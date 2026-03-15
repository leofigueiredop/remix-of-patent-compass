const axios = require("axios");
const path = require("path");
const dotenv = require("dotenv");
const { PrismaClient } = require("@prisma/client");

dotenv.config({ path: path.resolve(process.cwd(), "../.env") });
dotenv.config();

const prisma = new PrismaClient();
const RPI_BASE_URL = "https://revistas.inpi.gov.br/txt";
const LOOKBACK_ISSUES = Math.max(260, parseInt(process.env.RPI_LOOKBACK_ISSUES || "260", 10));
const FORCE_LATEST = parseInt(process.env.RPI_FORCE_LATEST || "0", 10);
const RPI_SCAN_MAX = Math.max(2000, parseInt(process.env.RPI_SCAN_MAX || "4000", 10));
const RPI_SCAN_MIN = Math.max(1, parseInt(process.env.RPI_SCAN_MIN || "2000", 10));

function normalizeDispatchCode(value) {
  return (value || "").replace(",", ".").replace(/\s+/g, "").replace(/[^\d.]/g, "");
}

async function rpiZipExists(rpiNumber) {
  const url = `${RPI_BASE_URL}/P${rpiNumber}.zip`;
  const hasZipSignature = (buffer) => {
    if (!buffer || buffer.length < 4) return false;
    const signature = Buffer.from(buffer).subarray(0, 4).toString("hex");
    return signature === "504b0304" || signature === "504b0506" || signature === "504b0708";
  };

  let headStatus;
  try {
    const response = await axios.head(url, { timeout: 10000, validateStatus: () => true });
    headStatus = response.status;
  } catch {
    headStatus = undefined;
  }

  if (headStatus === 200) {
    try {
      const probe = await axios.get(url, {
        timeout: 15000,
        responseType: "arraybuffer",
        headers: { Range: "bytes=0-3", "Cache-Control": "no-cache" },
        validateStatus: () => true
      });
      return hasZipSignature(probe.data);
    } catch {
      return false;
    }
  }
  if (typeof headStatus === "number" && ![403, 405].includes(headStatus)) {
    return false;
  }

  try {
    const probe = await axios.get(url, {
      timeout: 15000,
      responseType: "arraybuffer",
      headers: { Range: "bytes=0-3", "Cache-Control": "no-cache" },
      validateStatus: () => true
    });
    return (probe.status === 200 || probe.status === 206) && hasZipSignature(probe.data);
  } catch {
    return false;
  }
}

async function detectLatestRpi() {
  if (Number.isFinite(FORCE_LATEST) && FORCE_LATEST > 0) return FORCE_LATEST;

  let foundBlockTop = null;
  for (let probe = RPI_SCAN_MAX; probe >= RPI_SCAN_MIN; probe -= 10) {
    if (await rpiZipExists(probe)) {
      foundBlockTop = probe;
      break;
    }
  }
  if (!foundBlockTop) throw new Error("Não foi possível detectar RPI mais recente");
  const refineStart = Math.min(RPI_SCAN_MAX, foundBlockTop + 9);
  for (let probe = refineStart; probe >= foundBlockTop - 10 && probe >= RPI_SCAN_MIN; probe--) {
    if (await rpiZipExists(probe)) return probe;
  }
  return foundBlockTop;
}

async function main() {
  const latest = await detectLatestRpi();
  const from = Math.max(1, latest - LOOKBACK_ISSUES + 1);

  const deletedDocs = await prisma.documentDownloadJob.deleteMany({});
  const deletedOps = await prisma.opsBibliographicJob.deleteMany({});
  const deletedRpi = await prisma.rpiImportJob.deleteMany({});

  const deletedPatentsWithoutTitle = await prisma.inpiPatent.deleteMany({
    where: {
      OR: [{ title: null }, { title: "" }]
    }
  });

  const refRows = await prisma.inpiPublication.findMany({
    where: { eligible_for_doc_download: false },
    select: { id: true, despacho_code: true }
  });

  const toTrue = refRows
    .filter((row) => {
      const code = normalizeDispatchCode(row.despacho_code);
      return code === "3.1" || code === "16.1";
    })
    .map((row) => row.id);

  if (toTrue.length > 0) {
    await prisma.inpiPublication.updateMany({
      where: { id: { in: toTrue } },
      data: { eligible_for_doc_download: true }
    });
  }

  const rows = [];
  for (let rpi = from; rpi <= latest; rpi++) {
    rows.push({
      rpi_number: rpi,
      status: "pending",
      source_url: `${RPI_BASE_URL}/P${rpi}.zip`
    });
  }
  const enqueued = await prisma.rpiImportJob.createMany({ data: rows, skipDuplicates: true });

  console.log(JSON.stringify({
    deleted_document_jobs: deletedDocs.count,
    deleted_ops_jobs: deletedOps.count,
    deleted_rpi_jobs: deletedRpi.count,
    deleted_patents_without_title: deletedPatentsWithoutTitle.count,
    backfilled_eligible_publications: toTrue.length,
    enqueued_rpi_jobs: enqueued.count,
    range: [from, latest]
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
