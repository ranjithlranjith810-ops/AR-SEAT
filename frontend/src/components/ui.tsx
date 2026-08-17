import type { ReactNode } from "react";
import type { DocumentParseStatus } from "../lib/types";

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <span className="spinner" role="status" aria-label={label}>
      <span className="spinner__dot" aria-hidden="true" />
    </span>
  );
}

export function PageLoader({ label }: { label: string }) {
  return (
    <div className="page-loader" role="status" aria-live="polite">
      <Spinner label={label} />
      <p>{label}</p>
    </div>
  );
}

type AlertVariant = "info" | "warning" | "danger" | "success";

const ALERT_LABELS: Record<AlertVariant, string> = {
  info: "Information",
  warning: "Attention",
  danger: "Error",
  success: "Success",
};

export function Alert({
  variant,
  children,
  title,
}: {
  variant: AlertVariant;
  children: ReactNode;
  title?: string;
}) {
  return (
    <div className={`alert alert--${variant}`} role={variant === "danger" ? "alert" : "status"}>
      <div className="alert__title">{title ?? ALERT_LABELS[variant]}</div>
      <div className="alert__body">{children}</div>
    </div>
  );
}

export const STATUS_LABELS: Record<DocumentParseStatus, string> = {
  UPLOADED: "Uploaded",
  PROCESSING: "Processing student records",
  PARSED: "Processing complete",
  NEEDS_REVIEW: "Partially processed — review needed",
  REJECTED: "Rejected",
  FAILED: "Failed",
};

export function StatusBadge({ status }: { status: DocumentParseStatus }) {
  return (
    <span className={`status-badge status-badge--${status.toLowerCase()}`}>
      <span className="status-badge__dot" aria-hidden="true" />
      <span>{STATUS_LABELS[status]}</span>
    </span>
  );
}

export function AccessDenied() {
  return (
    <div className="panel">
      <h2>Access denied</h2>
      <p>
        You do not have permission to access this page. Uploading documents is an
        administrator-only capability.
      </p>
    </div>
  );
}