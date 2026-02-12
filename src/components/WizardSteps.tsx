import { Check } from "lucide-react";

interface WizardStepsProps {
  currentStep: number;
  steps: string[];
}

export default function WizardSteps({ currentStep, steps }: WizardStepsProps) {
  return (
    <div className="flex items-center gap-1 mb-8">
      {steps.map((step, index) => {
        const isCompleted = index < currentStep;
        const isActive = index === currentStep;
        return (
          <div key={step} className="flex items-center gap-1">
            <div className="flex items-center gap-2">
              <div
                className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold transition-colors ${
                  isCompleted
                    ? "bg-accent text-accent-foreground"
                    : isActive
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {isCompleted ? <Check className="w-3.5 h-3.5" /> : index + 1}
              </div>
              <span
                className={`text-xs whitespace-nowrap ${
                  isActive
                    ? "font-semibold text-foreground"
                    : isCompleted
                    ? "text-foreground"
                    : "text-muted-foreground"
                }`}
              >
                {step}
              </span>
            </div>
            {index < steps.length - 1 && (
              <div
                className={`w-8 h-px mx-1 ${
                  isCompleted ? "bg-accent" : "bg-border"
                }`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
