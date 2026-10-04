interface ProgressIndicatorProps {
  currentStep: number;
  onStepClick?: (step: number) => void;
}

const steps = [
  { number: 1, label: 'API Key' },
  { number: 2, label: 'Players' },
  { number: 3, label: 'Settings' },
  { number: 4, label: 'Start' },
];

export function ProgressIndicator({ currentStep, onStepClick }: ProgressIndicatorProps) {
  return (
    <div className="flex justify-center items-center gap-3 mb-10">
      {steps.map((step, index) => {
        const isCompleted = step.number < currentStep;
        const isCurrent = step.number === currentStep;
        const isClickable = onStepClick && step.number < currentStep;

        return (
          <div key={step.number} className="flex items-center gap-3">
            {/* Step indicator */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => isClickable && onStepClick(step.number)}
                disabled={!isClickable}
                className={`
                  w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium
                  transition-colors duration-200
                  ${isCompleted
                    ? 'bg-green-500 text-white cursor-pointer hover:bg-green-600'
                    : isCurrent
                      ? 'bg-neutral-900 text-white'
                      : 'bg-neutral-200 text-neutral-400'
                  }
                  ${isClickable ? 'cursor-pointer' : 'cursor-default'}
                `}
              >
                {isCompleted ? (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  step.number
                )}
              </button>
              <span
                className={`
                  text-sm
                  ${isCompleted
                    ? 'text-green-500'
                    : isCurrent
                      ? 'font-medium text-neutral-900'
                      : 'text-neutral-400'
                  }
                `}
              >
                {step.label}
              </span>
            </div>

            {/* Connector line */}
            {index < steps.length - 1 && (
              <div
                className={`
                  w-12 h-0.5
                  ${step.number < currentStep ? 'bg-green-500' : 'bg-neutral-200'}
                `}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
