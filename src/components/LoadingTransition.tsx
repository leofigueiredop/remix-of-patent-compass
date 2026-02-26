import { useState, useEffect } from "react";
import { Check, Loader2, Sparkles, BrainCircuit, Search, FileText } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";

interface LoadingTransitionProps {
  message?: string;
  subMessage?: string;
  duration?: number;
  onComplete?: () => void;
  mode?: "simple" | "detailed"; // "detailed" shows the AI Consciousness Timeline
}

const steps = [
  { id: 1, label: "Whisper", desc: "Decompondo fonemas e analisando estrutura...", icon: FileText, color: "text-blue-500" },
  { id: 2, label: "DeepSeek-R1", desc: "Identificando nexo técnico e diferenciais...", icon: BrainCircuit, color: "text-purple-500" },
  { id: 3, label: "Phi-3.5", desc: "Consultando taxonomias IPC globais...", icon: Search, color: "text-amber-500" },
  { id: 4, label: "Patent Engine", desc: "Gerando estratégia de busca booleana...", icon: Sparkles, color: "text-green-500" },
];

export default function LoadingTransition({
  message = "Processando...",
  subMessage = "Aguarde enquanto analisamos os dados",
  duration = 3000,
  onComplete,
  mode = "simple",
}: LoadingTransitionProps) {
  const [progress, setProgress] = useState(0);
  const [currentStep, setCurrentStep] = useState(0);

  useEffect(() => {
    // Progress Bar Animation
    const startTime = Date.now();
    const interval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const newProgress = Math.min((elapsed / duration) * 100, 100);
      setProgress(newProgress);

      // Step Logic
      if (mode === "detailed") {
        const stepDuration = duration / steps.length;
        const stepIndex = Math.floor(elapsed / stepDuration);
        if (stepIndex < steps.length) setCurrentStep(stepIndex);
      }

      if (elapsed >= duration) {
        clearInterval(interval);
        setTimeout(() => {
          onComplete?.();
        }, 500);
      }
    }, 50);

    return () => clearInterval(interval);
  }, [duration, onComplete, mode]);

  if (mode === "detailed") {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm animate-in fade-in duration-300">
        <div className="bg-slate-950 text-white rounded-xl shadow-2xl border border-slate-800 w-full max-w-md p-6 relative overflow-hidden">
          {/* Background Glow */}
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-1 bg-gradient-to-r from-transparent via-blue-500 to-transparent opacity-50"></div>

          <div className="text-center mb-6">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-slate-900 border border-slate-800 mb-3 animate-pulse">
              <BrainCircuit className="w-6 h-6 text-indigo-400" />
            </div>
            <h3 className="text-lg font-bold">Processamento Cognitivo</h3>
            <p className="text-xs text-slate-400">Ambiente Seguro (Local VPS)</p>
          </div>

          <div className="space-y-4 relative z-10">
            {steps.map((step, idx) => {
              const isActive = idx === currentStep;
              const isCompleted = idx < currentStep;

              return (
                <div key={step.id} className={`flex items-start gap-3 transition-opacity duration-500 ${idx > currentStep ? "opacity-30 blur-[1px]" : "opacity-100"}`}>
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center border text-[10px] shrink-0 mt-0.5
                                    ${isCompleted ? "bg-green-500/20 border-green-500 text-green-500"
                      : isActive ? "bg-blue-500/20 border-blue-500 text-blue-500 animate-pulse"
                        : "bg-slate-800 border-slate-700 text-slate-500"}`}>
                    {isCompleted ? <Check className="w-3 h-3" /> : (isActive ? <Loader2 className="w-3 h-3 animate-spin" /> : idx + 1)}
                  </div>
                  <div>
                    <div className={`text-sm font-medium ${isActive ? "text-white" : "text-slate-400"}`}>{step.label}</div>
                    <div className="text-xs text-slate-500 leading-tight">{step.desc}</div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-8 pt-4 border-t border-slate-800">
            <div className="flex justify-between text-[10px] text-slate-400 mb-2 uppercase tracking-wider">
              <span>Progresso Total</span>
              <span>{Math.round(progress)}%</span>
            </div>
            <div className="h-1.5 w-full bg-slate-900 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-blue-600 via-purple-600 to-indigo-600 transition-all duration-100 ease-linear"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <Dialog open={true}>
      <DialogContent className="sm:max-w-md flex flex-col items-center justify-center p-10 gap-6 [&>button]:hidden">
        <div className="relative">
          <div className="w-16 h-16 rounded-full border-4 border-muted flex items-center justify-center">
            <Loader2 className="w-8 h-8 text-primary animate-spin" />
          </div>
          <div className="absolute inset-0 rounded-full border-4 border-primary border-t-transparent animate-spin duration-1000" />
        </div>

        <div className="text-center space-y-2">
          <h3 className="text-lg font-semibold">{message}</h3>
          <p className="text-sm text-muted-foreground">{subMessage}</p>
        </div>

        <div className="w-full max-w-[200px] h-1.5 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-primary transition-all duration-300 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
