// Public API route'ları için segment/doğrulama yardımcıları
// (eski lib/sms.ts API'sini korur; içeriği segments.ts'ten gelir)
export {
  detectEncoding,
  gsmLength,
  effectiveLength,
  calcSegments,
  normalizePhone,
  maskPhone,
  maskBody,
  parseRecipients,
  validateAndNormalizeList,
  isWithinSendingWindow,
  nextWindowStart,
  type Encoding,
} from "./sms/segments";
