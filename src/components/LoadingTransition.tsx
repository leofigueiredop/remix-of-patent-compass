import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Progress } from "@/components/ui/progress";

interface LoadingTransitionProps {
  message: string;
  subMessage?: string;
  duration?: number;
  onComplete: () => void;
}

const processingSteps = [
  "Inicializando processamento...",
  "Analisando dados...",
  "Aplicando modelo de linguagem...",
  "Finalizando...",
];

export default function LoadingTransition({
  message,
  subMessage,
  duration = 2500,
  onComplete,
}: LoadingTransitionProps) {
  const [progress, setProgress] = useState(0);
  const [stepIndex, setStepIndex] = useState(0);

  useEffect(() => {
    const stepInterval = duration / processingSteps.length;
    const progressInterval = duration / 50;

    const progressTimer = setInterval(() => {
      setProgress((prev) => {
        const next = prev + 2;
        return next > 100 ? 100 : next;
      });
    }, progressInterval);

    const stepTimer = setInterval(() => {
      setStepIndex((prev) =>
        prev < processingSteps.length - 1 ? prev + 1 : prev
      );
    }, stepInterval);

    const completeTimer = setTimeout(onComplete, duration);

    return () => {
      clearInterval(progressTimer);
      clearInterval(stepTimer);
      clearTimeout(completeTimer);
    };
  }, [duration, onComplete]);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-background/80 backdrop-blur-sm animate-fade-in">
      <div className="bg-card border rounded-xl shadow-xl p-8 w-full max-w-md text-center animate-scale-in">
        <div className="w-14 h-14 rounded-full bg-accent/10 flex items-center justify-center mx-auto mb-5">
          <Loader2 className="w-7 h-7 text-accent animate-spin" />
        </div>
        <h2 className="text-lg font-semibold mb-1">{message}</h2>
        {subMessage && (
          <p className="text-sm text-muted-foreground mb-5">{subMessage}</p>
        )}
        <Progress value={progress} className="h-2 mb-3" />
        <p className="text-xs text-muted-foreground transition-all duration-300">
          {processingSteps[stepIndex]}
        </p>
      </div>
    </div>
  );
}
