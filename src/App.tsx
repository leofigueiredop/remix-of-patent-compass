import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
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
import ResearchHistory from "./pages/ResearchHistory";
import GenericSettings from "./pages/GenericSettings";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Login />} />
          <Route path="/dashboard" element={<Navigate to="/research/dashboard" />} />
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
          <Route path="/research/settings" element={<GenericSettings title="Configurações de Pesquisa" />} />
          <Route path="/monitoring/dashboard" element={<MonitoringDashboard />} />
          <Route path="/monitoring/patents" element={<MonitoringPatents />} />
          <Route path="/monitoring/settings" element={<GenericSettings title="Configurações de Monitoramento" />} />
          <Route path="/proposta" element={<Proposal />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
