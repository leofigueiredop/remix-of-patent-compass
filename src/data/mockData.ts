export interface Research {
  id: string;
  title: string;
  date: string;
  status: "editing" | "analyzed" | "finalized";
  briefing?: string;
}

export interface Patent {
  id: string;
  number: string;
  title: string;
  score: number;
  source: "INPI" | "Espacenet";
  abstract: string;
  applicant: string;
  date: string;
  classification: string;
  riskLevel: "high" | "medium" | "low";
  justification: string;
  imageUrl?: string;
  url?: string;
}

export const mockResearches: Research[] = [
  {
    id: "1",
    title: "Sistema de monitoramento de temperatura em transformadores de potência",
    date: "2025-02-08",
    status: "finalized",
  },
  {
    id: "2",
    title: "Dispositivo portátil para análise de qualidade do solo",
    date: "2025-02-05",
    status: "analyzed",
  },
  {
    id: "3",
    title: "Método de compressão de dados para redes IoT de baixa potência",
    date: "2025-01-28",
    status: "editing",
  },
  {
    id: "4",
    title: "Algoritmo de detecção de anomalias em linhas de produção",
    date: "2025-01-15",
    status: "finalized",
  },
];

export const mockTranscription = `O inventor descreve um sistema embarcado para monitoramento contínuo de temperatura em transformadores de potência, utilizando sensores de fibra óptica distribuídos ao longo do enrolamento do transformador. O sistema coleta dados em tempo real e aplica algoritmos de machine learning para prever falhas térmicas antes que ocorram. A principal inovação está no uso de uma rede neural recorrente treinada especificamente para padrões térmicos de transformadores, permitindo antecipação de falhas com até 72 horas de antecedência. O sistema se diferencia das soluções existentes por não depender de sensores de contato direto, evitando interferências eletromagnéticas, e por utilizar um protocolo de comunicação proprietário de baixa latência para transmissão dos dados ao centro de controle.`;

export const mockStructuredBriefing = {
  problemaTecnico:
    "Transformadores de potência sofrem falhas térmicas que causam interrupções não programadas e danos significativos ao equipamento. Os métodos atuais de monitoramento utilizam sensores de contato direto que são suscetíveis a interferências eletromagnéticas e não conseguem prever falhas com antecedência suficiente para ações preventivas.",
  solucaoProposta:
    "Sistema embarcado de monitoramento contínuo utilizando sensores de fibra óptica distribuídos ao longo do enrolamento do transformador, combinado com algoritmos de machine learning (rede neural recorrente) para predição de falhas térmicas com até 72 horas de antecedência.",
  diferenciais:
    "1. Sensores de fibra óptica sem contato direto, imunes a interferência eletromagnética\n2. Rede neural recorrente treinada especificamente para padrões térmicos de transformadores\n3. Predição antecipada de até 72 horas\n4. Protocolo de comunicação proprietário de baixa latência",
  aplicacoes:
    "Subestações de energia elétrica, usinas de geração, indústrias de alta tensão, concessionárias de energia, manutenção preditiva de equipamentos de potência.",
};

export const mockKeywords = [
  { id: "1", term: "monitoramento térmico", selected: true },
  { id: "2", term: "transformador de potência", selected: true },
  { id: "3", term: "fibra óptica", selected: true },
  { id: "4", term: "rede neural recorrente", selected: true },
  { id: "5", term: "predição de falhas", selected: true },
  { id: "6", term: "sensores distribuídos", selected: true },
  { id: "7", term: "manutenção preditiva", selected: false },
  { id: "8", term: "machine learning", selected: false },
  { id: "9", term: "interferência eletromagnética", selected: false },
];

export const mockClassifications = [
  { id: "1", code: "H01F 27/08", description: "Transformadores de refrigeração", selected: true },
  { id: "2", code: "G01K 11/32", description: "Medição de temperatura usando fibras ópticas", selected: true },
  { id: "3", code: "G06N 3/08", description: "Redes neurais - aprendizado", selected: true },
  { id: "4", code: "H02H 7/04", description: "Proteção de transformadores", selected: false },
  { id: "5", code: "G01R 31/00", description: "Ensaio de equipamentos elétricos", selected: false },
];

export const mockPatents: Patent[] = [
  {
    id: "1",
    number: "BR 10 2019 015432-7",
    title: "Sistema de monitoramento de temperatura em transformadores utilizando sensores de fibra óptica",
    score: 87,
    source: "INPI",
    abstract: "Refere-se a um sistema de monitoramento de temperatura para transformadores de potência que emprega sensores de fibra óptica para medição distribuída. O sistema inclui uma unidade de processamento central que coleta dados dos sensores e aplica algoritmos para detecção de anomalias térmicas.",
    applicant: "Universidade Federal de Itajubá",
    date: "2019-08-15",
    classification: "H01F 27/08",
    riskLevel: "high",
    justification: "Alta sobreposição técnica: ambos utilizam sensores de fibra óptica para monitoramento térmico em transformadores. O pedido BR diferencia-se por não incluir predição por rede neural, mas cobre o método de sensoriamento distribuído que é elemento central da invenção.",
    imageUrl: "/patents/BR1020190154327.png",
    url: "https://busca.inpi.gov.br/pePI/servlet/PatenteServletController"
  },
  {
    id: "2",
    number: "EP 3 285 042 A1",
    title: "Thermal monitoring system for power transformers with predictive analytics",
    score: 79,
    source: "Espacenet",
    abstract: "A monitoring system for power transformers comprising distributed temperature sensors, a data acquisition unit, and a predictive analytics module using machine learning algorithms to forecast thermal failures. The system provides real-time alerts and maintenance recommendations.",
    applicant: "Siemens Energy AG",
    date: "2021-03-22",
    classification: "G01K 11/32",
    riskLevel: "high",
    justification: "Sobreposição significativa na combinação de sensoriamento distribuído com predição por machine learning. Embora utilize sensores convencionais (não fibra óptica), o conceito de predição de falhas térmicas por ML é essencialmente o mesmo.",
    imageUrl: "/patents/EP3285042A1.png",
    url: "https://worldwide.espacenet.com/patent/search?q=pn%3DEP3285042A1"
  },
  {
    id: "3",
    number: "BR 10 2020 023891-0",
    title: "Método e dispositivo para diagnóstico de transformadores baseado em redes neurais",
    score: 64,
    source: "INPI",
    abstract: "Descreve método para diagnóstico de condição de transformadores utilizando redes neurais artificiais treinadas com dados de análise de gases dissolvidos em óleo isolante. O sistema processa dados de cromatografia gasosa para predição de falhas.",
    applicant: "CPFL Energia S.A.",
    date: "2020-11-30",
    classification: "G06N 3/08",
    riskLevel: "medium",
    justification: "Compartilha o uso de redes neurais para predição de falhas em transformadores, porém com abordagem técnica distinta (análise de gases vs. monitoramento térmico). Risco moderado de objeção por sobreposição conceitual.",
    imageUrl: "/patents/BR1020200238910.png",
    url: "https://busca.inpi.gov.br/pePI/servlet/PatenteServletController"
  },
  {
    id: "4",
    number: "US 2022/0128425 A1",
    title: "Fiber optic temperature sensing system for electrical equipment",
    score: 58,
    source: "Espacenet",
    abstract: "An apparatus for temperature measurement in electrical equipment using fiber Bragg grating sensors. The system includes a signal processing unit for real-time temperature mapping and threshold-based alarm generation.",
    applicant: "General Electric Company",
    date: "2022-04-28",
    classification: "G01K 11/32",
    riskLevel: "medium",
    justification: "Utiliza fibra óptica (Bragg grating) para monitoramento térmico em equipamentos elétricos, mas sem componente de predição por IA. Sobreposição parcial no sensoriamento, diferencia-se na análise.",
    imageUrl: "/patents/US2022128425A1.png",
    url: "https://worldwide.espacenet.com/patent/search?q=pn%3DUS2022128425A1"
  },
  {
    id: "5",
    number: "BR 10 2018 008765-1",
    title: "Protocolo de comunicação de baixa latência para redes de sensores industriais",
    score: 35,
    source: "INPI",
    abstract: "Protocolo de comunicação otimizado para redes de sensores em ambientes industriais com alta interferência eletromagnética. O protocolo utiliza técnicas de multiplexação temporal e codificação robusta para garantir transmissão confiável de dados.",
    applicant: "Instituto de Pesquisas Tecnológicas",
    date: "2018-05-10",
    classification: "H04L 12/40",
    riskLevel: "low",
    justification: "Relaciona-se apenas ao componente de comunicação do sistema. Embora haja sobreposição no conceito de protocolo de baixa latência para ambientes industriais, é um aspecto secundário da invenção.",
    imageUrl: "/patents/BR1020180087651.png",
    url: "https://busca.inpi.gov.br/pePI/servlet/PatenteServletController"
  },
  {
    id: "6",
    number: "CN 112345678 A",
    title: "Power transformer health monitoring method based on deep learning",
    score: 42,
    source: "Espacenet",
    abstract: "A health monitoring method for power transformers based on deep learning model that processes vibration and electrical signals for fault diagnosis. The model uses convolutional neural networks for pattern recognition.",
    applicant: "State Grid Corporation of China",
    date: "2021-09-14",
    classification: "G06N 3/08",
    riskLevel: "low",
    justification: "Utiliza deep learning para monitoramento de transformadores, porém baseado em sinais de vibração e elétricos, não em temperatura. Abordagem técnica fundamentalmente distinta.",
    imageUrl: "/patents/CN112345678A.png",
    url: "https://worldwide.espacenet.com/patent/search?q=pn%3DCN112345678A"
  }
];
