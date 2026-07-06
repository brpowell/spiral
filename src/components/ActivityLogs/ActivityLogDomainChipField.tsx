import { useMemo } from "react";
import { ChipInput } from "../common/ChipInput/ChipInput";
import {
  ACTIVITY_LOG_DOMAIN_OPTIONS,
  type ActivityLogDomain,
} from "../../types/activityLog";
import "./ActivityLogDomainChipField.css";

type ActivityLogDomainChipFieldProps = {
  value: ActivityLogDomain[];
  onChange: (value: ActivityLogDomain[]) => void;
};

function domainToLabel(domain: ActivityLogDomain): string {
  return (
    ACTIVITY_LOG_DOMAIN_OPTIONS.find((option) => option.value === domain)
      ?.label ?? domain
  );
}

function labelToDomain(label: string): ActivityLogDomain | undefined {
  return ACTIVITY_LOG_DOMAIN_OPTIONS.find((option) => option.label === label)
    ?.value;
}

export function ActivityLogDomainChipField({
  value,
  onChange,
}: ActivityLogDomainChipFieldProps) {
  const labels = useMemo(() => value.map(domainToLabel), [value]);
  const suggestions = useMemo(
    () =>
      ACTIVITY_LOG_DOMAIN_OPTIONS.map((option) => option.label).filter(
        (label) => !labels.includes(label),
      ),
    [labels],
  );

  const handleChange = (nextLabels: string[]) => {
    const domains = nextLabels
      .map(labelToDomain)
      .filter((domain): domain is ActivityLogDomain => domain != null);
    onChange(domains);
  };

  return (
    <div className="activity-log-domain-chip-field">
      <ChipInput
        values={labels}
        onChange={handleChange}
        placeholder="All domains"
        suggestions={suggestions}
        isDuplicate={(label, values) => values.includes(label)}
        inputAriaLabel="Filter by domain"
      />
    </div>
  );
}
