import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { ResearchProvider } from "@/contexts/ResearchContext";

const Login = lazy(() => import("./pages/Login"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const NewResearch = lazy(() => import("./pages/NewResearch"));
const Transcription = lazy(() => import("./pages/Transcription"));
const StructuredBriefing = lazy(() => import("./pages/StructuredBriefing"));
const Keywords = lazy(() => import("./pages/Keywords"));
const SearchResults = lazy(() => import("./pages/SearchResults"));
const Analysis = lazy(() => import("./pages/Analysis"));
const Report = lazy(() => import("./pages/Report"));
const Proposal = lazy(() => import("./pages/Proposal"));
const MonitoringCenter = lazy(() => import("./pages/MonitoringCenter"));
const MonitoringPatents = lazy(() => import("./pages/MonitoringPatents"));
const ResearchHistory = lazy(() => import("./pages/ResearchHistory"));
const ResearchSettings = lazy(() => import("./pages/ResearchSettings"));
const KnowledgeBase = lazy(() => import("./pages/KnowledgeBase"));
const MonitoringSettings = lazy(() => import("./pages/MonitoringSettings"));
const Clients = lazy(() => import("./pages/Clients"));
const ProcessMonitoring = lazy(() => import("./pages/ProcessMonitoring"));
const Demands = lazy(() => import("./pages/Demands"));
const Alerts = lazy(() => import("./pages/Alerts"));
const MarketMonitoring = lazy(() => import("./pages/MarketMonitoring"));
const MyAssets = lazy(() => import("./pages/MyAssets"));
const QuickSearch = lazy(() => import("./pages/QuickSearch"));
const PatentBase = lazy(() => import("./pages/PatentBase"));
const BackgroundWorkers = lazy(() => import("./pages/BackgroundWorkers"));
const SystemHealth = lazy(() => import("./pages/SystemHealth"));
const Settings = lazy(() => import("./pages/Settings"));
const NotFound = lazy(() => import("./pages/NotFound"));

const queryClient = new QueryClient();

const RouteLoader = () => (
  <div className="min-h-screen flex items-center justify-center px-6">
    <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white/90 p-6 shadow-sm">
      <div className="h-2 w-24 rounded-full bg-emerald-100 mb-4" />
      <div className="h-4 w-56 rounded bg-slate-200 mb-3 animate-pulse" />
      <div className="h-3 w-full rounded bg-slate-100 mb-2 animate-pulse" />
      <div className="h-3 w-4/5 rounded bg-slate-100 animate-pulse" />
    </div>
  </div>
);

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <ResearchProvider>
          <Suspense fallback={<RouteLoader />}>
          <Routes>
            <Route path="/" element={<Login />} />
            
            {/* Dashboard */}
            <Route path="/dashboard" element={<Dashboard />} />
            
            {/* Pesquisas */}
            <Route path="/research/new" element={<NewResearch />} />
            <Route path="/research/briefing" element={<NewResearch />} />
            <Route path="/research/transcription" element={<Transcription />} />
            <Route path="/research/structured" element={<StructuredBriefing />} />
            <Route path="/research/keywords" element={<Keywords />} />
            <Route path="/research/results" element={<SearchResults />} />
            <Route path="/research/analysis" element={<Analysis />} />
            <Route path="/research/report" element={<Report />} />
            <Route path="/research/history" element={<ResearchHistory />} />
            <Route path="/research/settings" element={<ResearchSettings />} />
            
            {/* Monitoramentos */}
            <Route path="/monitoring" element={<MonitoringCenter />} />
            <Route path="/monitoring/dashboard" element={<MonitoringCenter />} />
            <Route path="/monitoring/collision" element={<MonitoringPatents />} />
            <Route path="/monitoring/process" element={<ProcessMonitoring />} />
            <Route path="/monitoring/market" element={<MarketMonitoring />} />
            <Route path="/monitoring/assets" element={<MyAssets />} />
            
            {/* Base */}
            <Route path="/base/patents" element={<PatentBase />} />
            <Route path="/search" element={<QuickSearch />} />
            <Route path="/knowledge-base" element={<KnowledgeBase />} />
            
            {/* CRM */}
            <Route path="/clients" element={<Clients />} />
            <Route path="/demands" element={<Demands />} />
            
            {/* Operações */}
            <Route path="/alerts" element={<Alerts />} />
            <Route path="/operations/workers" element={<BackgroundWorkers />} />
            <Route path="/operations/system-health" element={<SystemHealth />} />
            
            {/* Configurações */}
            <Route path="/settings" element={<Settings />} />
            
            {/* Legado / Redirecionamentos para manter compatibilidade */}
            <Route path="/research/dashboard" element={<Navigate to="/dashboard" />} />
            <Route path="/monitoring/patents" element={<Navigate to="/monitoring/collision" />} />
            <Route path="/monitoring/base" element={<Navigate to="/base/patents" />} />
            <Route path="/monitoring/background-workers" element={<Navigate to="/operations/workers" />} />
            <Route path="/monitoring/settings" element={<MonitoringSettings />} />
            
            <Route path="/proposta" element={<Proposal />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
          </Suspense>
        </ResearchProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
