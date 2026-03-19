export type Client = {
  id: string;
  name: string;
  segment: string;
  status: "ativo" | "negociação" | "pausado";
  owner: string;
  monitorings: number;
  openDemands: number;
  nextFollowUp: string;
  lastActivity: string;
  tags: string[];
};

export type CollisionFinding = {
  id: string;
  client: string;
  monitoredAsset: string;
  document: string;
  owner: string;
  score: number;
  risk: "baixo" | "moderado" | "alto" | "critico";
  type: "reivindicação" | "título" | "conceitual";
  date: string;
  assignee: string;
  status: "novo" | "triagem" | "em análise" | "confirmado" | "descartado";
};

export type ProcessEvent = {
  id: string;
  client: string;
  process: string;
  title: string;
  owner: string;
  eventType: "exigência" | "anuidade" | "petição" | "despacho";
  code: string;
  dueDate: string;
  daysLeft: number;
  urgency: "crítico" | "alto" | "moderado" | "controlado";
  assignee: string;
  status: "novo" | "em andamento" | "resolvido";
};

export type Demand = {
  id: string;
  title: string;
  origin: "manual" | "colidência" | "processo" | "pesquisa" | "mercado";
  client: string;
  owner: string;
  status: "nova" | "triagem" | "em execução" | "aguardando cliente" | "concluída" | "arquivada";
  priority: "alta" | "média" | "baixa";
  dueDate: string;
};

export type AlertEvent = {
  id: string;
  type: string;
  priority: "crítica" | "alta" | "média" | "baixa";
  client: string;
  source: string;
  status: "não lido" | "atribuído" | "resolvido";
  owner: string;
  date: string;
  title: string;
};

export type Worker = {
  name: string;
  queue: string;
  online: boolean;
  pending: number;
  failures: number;
  lastRun: string;
  avgSeconds: number;
};

export const kpiDashboard = {
  activeClients: 46,
  activeResearches: 18,
  monitoredPatents: 1274,
  pendingCollisions: 32,
  criticalRequirements: 7,
  activeMarketMonitoring: 24,
};

export const clients: Client[] = [
  {
    id: "cl-01",
    name: "BioSyn Energia",
    segment: "Energia",
    status: "ativo",
    owner: "Camila Neves",
    monitorings: 12,
    openDemands: 5,
    nextFollowUp: "2026-03-22",
    lastActivity: "2026-03-18",
    tags: ["estratégico", "alto ticket"],
  },
  {
    id: "cl-02",
    name: "Orion Medical Devices",
    segment: "Saúde",
    status: "ativo",
    owner: "Bruno Pereira",
    monitorings: 9,
    openDemands: 3,
    nextFollowUp: "2026-03-25",
    lastActivity: "2026-03-17",
    tags: ["internacional"],
  },
  {
    id: "cl-03",
    name: "Vectra AgroTech",
    segment: "Agro",
    status: "negociação",
    owner: "Amanda Luz",
    monitorings: 3,
    openDemands: 1,
    nextFollowUp: "2026-03-21",
    lastActivity: "2026-03-13",
    tags: ["expansão"],
  },
  {
    id: "cl-04",
    name: "Nexa Química",
    segment: "Químico",
    status: "ativo",
    owner: "Bruno Pereira",
    monitorings: 11,
    openDemands: 7,
    nextFollowUp: "2026-03-20",
    lastActivity: "2026-03-19",
    tags: ["risco elevado"],
  },
];

export const collisions: CollisionFinding[] = [
  {
    id: "co-01",
    client: "BioSyn Energia",
    monitoredAsset: "BR102021018764-3",
    document: "WO2026022445A1",
    owner: "Helix Storage Inc.",
    score: 92,
    risk: "critico",
    type: "reivindicação",
    date: "2026-03-18",
    assignee: "Júlia Costa",
    status: "novo",
  },
  {
    id: "co-02",
    client: "Orion Medical Devices",
    monitoredAsset: "PI1100234-7",
    document: "US20260118890A1",
    owner: "NanoPulse Lab",
    score: 84,
    risk: "alto",
    type: "conceitual",
    date: "2026-03-17",
    assignee: "Felipe Moraes",
    status: "em análise",
  },
  {
    id: "co-03",
    client: "Nexa Química",
    monitoredAsset: "BR112020031100-0",
    document: "EP4528811A1",
    owner: "Solvatech GmbH",
    score: 73,
    risk: "moderado",
    type: "título",
    date: "2026-03-16",
    assignee: "Júlia Costa",
    status: "triagem",
  },
];

export const processEvents: ProcessEvent[] = [
  {
    id: "pe-01",
    client: "Nexa Química",
    process: "BR102020014552-2",
    title: "Catalisador híbrido para polímeros",
    owner: "Nexa Química",
    eventType: "exigência",
    code: "6.1",
    dueDate: "2026-03-24",
    daysLeft: 5,
    urgency: "crítico",
    assignee: "Rafaela Santos",
    status: "novo",
  },
  {
    id: "pe-02",
    client: "BioSyn Energia",
    process: "PI0901230-8",
    title: "Sistema modular de baterias",
    owner: "BioSyn Energia",
    eventType: "anuidade",
    code: "ANU-14",
    dueDate: "2026-04-02",
    daysLeft: 14,
    urgency: "alto",
    assignee: "Davi Reis",
    status: "em andamento",
  },
  {
    id: "pe-03",
    client: "Orion Medical Devices",
    process: "BR112019008901-0",
    title: "Cateter inteligente de diagnóstico",
    owner: "Orion Medical Devices",
    eventType: "despacho",
    code: "3.2",
    dueDate: "2026-03-30",
    daysLeft: 11,
    urgency: "moderado",
    assignee: "Fernanda Azevedo",
    status: "novo",
  },
];

export const marketSignals = [
  { month: "Out", deposits: 44, ai: 18, biotech: 11, materials: 15 },
  { month: "Nov", deposits: 53, ai: 24, biotech: 13, materials: 16 },
  { month: "Dez", deposits: 61, ai: 28, biotech: 14, materials: 19 },
  { month: "Jan", deposits: 58, ai: 29, biotech: 12, materials: 17 },
  { month: "Fev", deposits: 67, ai: 33, biotech: 16, materials: 18 },
  { month: "Mar", deposits: 74, ai: 36, biotech: 20, materials: 18 },
];

export const demands: Demand[] = [
  {
    id: "dm-01",
    title: "Parecer de risco colisão WO2026022445A1",
    origin: "colidência",
    client: "BioSyn Energia",
    owner: "Júlia Costa",
    status: "triagem",
    priority: "alta",
    dueDate: "2026-03-21",
  },
  {
    id: "dm-02",
    title: "Resposta exigência BR102020014552-2",
    origin: "processo",
    client: "Nexa Química",
    owner: "Rafaela Santos",
    status: "em execução",
    priority: "alta",
    dueDate: "2026-03-24",
  },
  {
    id: "dm-03",
    title: "Monitoramento titulares de baterias sólidas",
    origin: "mercado",
    client: "BioSyn Energia",
    owner: "Davi Reis",
    status: "nova",
    priority: "média",
    dueDate: "2026-03-29",
  },
  {
    id: "dm-04",
    title: "Análise de novidade para cateter inteligente",
    origin: "pesquisa",
    client: "Orion Medical Devices",
    owner: "Felipe Moraes",
    status: "aguardando cliente",
    priority: "média",
    dueDate: "2026-03-27",
  },
];

export const patents = [
  {
    id: "pt-01",
    publication: "BR102020014552A2",
    title: "Catalisador híbrido para polímeros de alto desempenho",
    holder: "Nexa Química",
    ipc: "C08K 5/00",
    source: "INPI",
    pub: 8,
    pet: 3,
    anu: 1,
    status: "ativo",
    lastScrape: "2026-03-18 22:10",
  },
  {
    id: "pt-02",
    publication: "WO2026022445A1",
    title: "Solid-state battery thermal regulation architecture",
    holder: "Helix Storage Inc.",
    ipc: "H01M 10/052",
    source: "WIPO",
    pub: 4,
    pet: 0,
    anu: 0,
    status: "monitorado",
    lastScrape: "2026-03-19 02:42",
  },
  {
    id: "pt-03",
    publication: "US20260118890A1",
    title: "Closed loop sensing catheter and telemetry protocol",
    holder: "NanoPulse Lab",
    ipc: "A61B 5/00",
    source: "USPTO",
    pub: 2,
    pet: 1,
    anu: 0,
    status: "ativo",
    lastScrape: "2026-03-18 19:03",
  },
];

export const alerts: AlertEvent[] = [
  {
    id: "al-01",
    type: "colidência",
    priority: "crítica",
    client: "BioSyn Energia",
    source: "Collision Engine",
    status: "não lido",
    owner: "Júlia Costa",
    date: "2026-03-19 09:12",
    title: "Score 92 detectado para WO2026022445A1",
  },
  {
    id: "al-02",
    type: "processo",
    priority: "alta",
    client: "Nexa Química",
    source: "RPI #2819",
    status: "atribuído",
    owner: "Rafaela Santos",
    date: "2026-03-19 08:30",
    title: "Exigência com prazo de 5 dias",
  },
  {
    id: "al-03",
    type: "mercado",
    priority: "média",
    client: "Orion Medical Devices",
    source: "Market Monitor",
    status: "resolvido",
    owner: "Felipe Moraes",
    date: "2026-03-18 17:55",
    title: "Titular emergente em classe A61B",
  },
];

export const workers: Worker[] = [
  { name: "RPI Sync Worker", queue: "rpi", online: true, pending: 91, failures: 2, lastRun: "2026-03-19 09:10", avgSeconds: 37 },
  { name: "Docs Fetch Worker", queue: "docs", online: true, pending: 46, failures: 4, lastRun: "2026-03-19 09:11", avgSeconds: 51 },
  { name: "OPS Enrichment Worker", queue: "ops", online: true, pending: 30, failures: 1, lastRun: "2026-03-19 09:08", avgSeconds: 43 },
  { name: "INPI Bibliographic Worker", queue: "inpi", online: true, pending: 28, failures: 5, lastRun: "2026-03-19 09:09", avgSeconds: 62 },
  { name: "BigQuery Index Worker", queue: "bigquery", online: true, pending: 14, failures: 0, lastRun: "2026-03-19 09:07", avgSeconds: 29 },
];

export const rpiHistory = [
  { edition: 2819, date: "2026-03-19", imported: 932, failed: 7, duration: "28m", status: "concluído" },
  { edition: 2818, date: "2026-03-12", imported: 908, failed: 11, duration: "31m", status: "concluído" },
  { edition: 2817, date: "2026-03-05", imported: 875, failed: 16, duration: "33m", status: "concluído" },
  { edition: 2816, date: "2026-02-26", imported: 941, failed: 8, duration: "29m", status: "concluído" },
];
