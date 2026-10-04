// Type surface of the per-locale UI-message translation contract for the TS
// side (the G21.25 generator and tests import the shapes; the implementation
// and its rules live in translations.mjs — this file declares, it does not
// restate). The record fields are the issue #558 criterion 1 list: message
// value/forms, the reviewed source fingerprint, the review outcome.
import type { UiMessagesSource, UiMessageDiagnostic } from './ui-messages.d.mts';

export interface UiMessageTranslationRecord {
  id: string;
  value: string;
  forms?: Record<string, string>;
  reviewedSourceHash: string;
  review: {
    outcome: 'approved' | 'unreviewed';
    note?: string;
  };
}

export interface UiMessageTranslationSet {
  translation_schema_version: 1;
  locale: string;
  provenance: {
    kind: string;
    reviewer: string;
    evidence: string;
  };
  records: UiMessageTranslationRecord[];
}

export function checkUiMessageTranslations(
  doc: unknown,
  sourceDoc: UiMessagesSource,
  allowedLocales: readonly string[],
): { ok: boolean; errors: UiMessageDiagnostic[] };

export function loadUiMessageTranslations(
  path: string,
  sourceDoc: UiMessagesSource,
  allowedLocales: readonly string[],
): UiMessageTranslationSet;

export class TranslationsContractError extends Error {}
