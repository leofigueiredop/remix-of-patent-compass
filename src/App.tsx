import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { ResearchProvider } from "@/contexts/ResearchContext";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Searches from "./pages/Searches";
import NewSearchWorkspace from "./pages/NewSearchWorkspace";
import NewResearch from "./pages/NewResearch";
import Transcription from "./pages/Transcription";
import StructuredBriefing from "./pages/StructuredBriefing";
import Keywords from "./pages/Keywords";
import SearchResults from "./pages/SearchResults";
import Analysis from "./pages/Analysis";
import Report from "./pages/Report";
import Proposal from "./pages/Proposal";
import MonitoringDashboard from "./pages/MonitoringDashboard";
import MonitoringPatents from "./pages/MonitoringPatents";
import MonitoringProcess from "./pages/MonitoringProcess";
import MonitoringMarket from "./pages/MonitoringMarket";
import ResearchHistory from "./pages/ResearchHistory";
import ResearchSettings from "./pages/ResearchSettings";
import KnowledgeBase from "./pages/KnowledgeBase";
import MonitoringSettings from "./pages/MonitoringSettings";
import QuickSearch from "./pages/QuickSearch";
import PatentBase from "./pages/PatentBase";
import BackgroundWorkers from "./pages/BackgroundWorkers";
import Clients from "./pages/Clients";
import ClientProfile from "./pages/ClientProfile";
import Demands from "./pages/Demands";
import AlertsCenter from "./pages/AlertsCenter";
import OperationsWorkers from "./pages/OperationsWorkers";
import SystemHealth from "./pages/SystemHealth";
import RpiHistory from "./pages/RpiHistory";
import SourcesIntegrations from "./pages/SourcesIntegrations";
import GenericSettings from "./pages/GenericSettings";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <ResearchProvider>
          <Routes>
            <Route path="/" element={<Login />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/searches" element={<Searches />} />
            <Route path="/searches/new" element={<NewSearchWorkspace />} />
            <Route path="/searches/:id" element={<NewSearchWorkspace />} />
            <Route path="/monitoring/collision" element={<MonitoringPatents />} />
            <Route path="/monitoring/process" element={<MonitoringProcess />} />
            <Route path="/monitoring/market" element={<MonitoringMarket />} />
            <Route path="/base/patents" element={<PatentBase />} />
            <Route path="/base/rpi-history" element={<RpiHistory />} />
            <Route path="/base/sources" element={<SourcesIntegrations />} />
            <Route path="/clients" element={<Clients />} />
            <Route path="/clients/:id" element={<ClientProfile />} />
            <Route path="/demands" element={<Demands />} />
            <Route path="/alerts" element={<AlertsCenter />} />
            <Route path="/operations/workers" element={<OperationsWorkers />} />
            <Route path="/operations/system-health" element={<SystemHealth />} />
            <Route path="/settings" element={<GenericSettings />} />

            <Route path="/research/dashboard" element={<Dashboard />} />
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
            <Route path="/search" element={<QuickSearch />} />
            <Route path="/knowledge-base" element={<KnowledgeBase />} />
            <Route path="/monitoring/dashboard" element={<MonitoringDashboard />} />
            <Route path="/monitoring/patents" element={<MonitoringPatents />} />
            <Route path="/monitoring/process-legacy" element={<MonitoringDashboard />} />
            <Route path="/monitoring/market-legacy" element={<MonitoringDashboard />} />
            <Route path="/monitoring/base" element={<PatentBase />} />
            <Route path="/monitoring/background-workers" element={<BackgroundWorkers />} />
            <Route path="/monitoring/settings" element={<MonitoringSettings />} />
            <Route path="/proposta" element={<Proposal />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </ResearchProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
