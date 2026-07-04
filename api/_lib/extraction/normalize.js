// Map validated AI output → fields consumed by advance_document_processing.

export function toAdvancePayload(extraction) {
  const {
    title,
    document_type,
    authority_name,
    reference_number,
    certificate_number,
    issue_date,
    expiry_date,
    renewal_period_days,
    language,
    summary,
    extracted_text,
    confidence,
    extraction_confidence,
    tags,
    important_notes,
    missing_fields,
    warnings,
    organization,
    device_name,
    amount,
    inspector,
    auditor,
    issuer,
    products,
    supplier,
    machine,
    employee,
  } = extraction

  const extractedMetadata = {
    title,
    authority_name,
    document_type,
    certificate_number,
    reference_number,
    issue_date,
    expiry_date,
    renewal_period_days,
    organization,
    device_name,
    amount,
    inspector,
    auditor,
    issuer,
    tags,
    important_notes,
    missing_fields,
    warnings,
    extraction_confidence,
    products,
    supplier,
    machine,
    employee,
  }

  // Drop null/empty so review UI stays clean.
  for (const key of Object.keys(extractedMetadata)) {
    const v = extractedMetadata[key]
    if (v == null) delete extractedMetadata[key]
    else if (Array.isArray(v) && v.length === 0) delete extractedMetadata[key]
  }

  const text = extracted_text || summary || ''

  return {
    nextStatus: 'waiting_for_review',
    extractedText: text || null,
    extractedMetadata,
    aiSummary: summary || null,
    documentType: document_type || null,
    language: language || null,
    confidenceScore: confidence ?? extraction_confidence ?? null,
  }
}
