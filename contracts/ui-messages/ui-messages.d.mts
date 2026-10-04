// Type surface of the canonical UI-message source contract for the TS side (the
// G21.25 generator and tests import the shapes; the implementation and its rules
// live in ui-messages.mjs — this file declares, it does not restate). The record
// fields are the issue #557 criterion 2 list verbatim; the fingerprint inputs are
// criterion 3.
export interface UiMessageDiagnostic {
  rule: string;
  path: string;
}

export interface UiMessageParameter {
  name: string;
  type: 'string' | 'number' | 'list';
  join?: string;
  fallback?: string;
}

export interface UiMessageSourceRecord {
  id: string;
  source: string;
  context: string;
  format: 'plain' | 'template';
  composed?: boolean;
  parameters: UiMessageParameter[];
  constraints?: {
    maxLength?: number;
    accessibility?: 'label' | 'hint';
  };
  discreteForms?: Record<string, string>;
  migratedFrom: string[];
  sourceHash: string;
}

export interface UiMessagesSource {
  source_schema_version: 1;
  source_locale: 'be';
  records: UiMessageSourceRecord[];
}

export function checkUiMessages(doc: unknown): { ok: boolean; errors: UiMessageDiagnostic[] };

export function loadUiMessagesSource(path?: string): UiMessagesSource;

export function sourceHash(record: UiMessageSourceRecord): string;
