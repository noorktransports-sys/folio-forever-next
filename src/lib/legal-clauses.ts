// src/lib/legal-clauses.ts
//
// Customer-facing legal clauses recorded with every order (albums and
// magazines). Bump LEGAL_VERSION whenever the wording changes.

export const LEGAL_VERSION = 'v2-2026-09-26'

/** Business identity used in customer-facing legal text. Update when the LLC is registered. */
export const BUSINESS_NAME = 'Folio Forever'
export const BUSINESS_EMAIL = 'orders@folioforever.com'
export const BUSINESS_STATE = 'Florida'
export const BUSINESS_SITE = 'folioforever.com'

export const CLAUSE_PROOF_APPROVAL = `2.3  PROOF APPROVAL — FINAL RESPONSIBILITY OF CUSTOMER

You will receive a digital proof of every spread before printing. By approving the proof, you confirm that:

  (a) you have reviewed every spread carefully and the design reflects what you want printed;
  (b) the order of photos, crops, layout, and any visible text are correct;
  (c) you understand that once you approve the proof, your order enters production and CANNOT be cancelled, modified, refunded, or recalled — except for a print defect or shipping damage caused by Folio Forever or its carrier and reported within 14 days of delivery, as described in our Refund & Cancellation Policy (folioforever.com/refunds);
  (d) any error you fail to identify in the proof — including but not limited to misplaced photos, color shifts within normal tolerance, spelling, cropping, or sequence — is your responsibility, not Folio Forever's;
  (e) reprints requested due to customer-side errors will be billed at full price.

This approval is the single most important decision in the order. Please take your time.

These clauses are part of our Terms of Service (folioforever.com/terms).`

export const CLAUSE_CONTENT_RIGHTS = `2.4  CONTENT OWNERSHIP & COPYRIGHT — INDEMNIFICATION

By uploading photos to Folio Forever, you represent and warrant that:

  (a) you own the photos, OR you have explicit written or verbal permission from the photographer / rights-holder to use them in a printed album for personal use;
  (b) the photos do not infringe upon any copyright, trademark, publicity right, privacy right, or other intellectual-property right of any third party;
  (c) you will defend, indemnify, and hold harmless Folio Forever, its agents, and its production partners against any claim, demand, or liability (including reasonable attorney's fees) arising from a breach of (a) or (b).

Folio Forever does not verify ownership and is not liable for content uploaded by the customer.`

export const CLAUSE_CONTENT_POLICY = `2.2  CONTENT QUALITY & POLICY

You agree not to upload content that is illegal, sexually explicit, hateful, defamatory, or that depicts minors in any inappropriate way. Folio Forever reserves the right to refuse to print any content that violates this policy at our sole discretion, and to refund the order minus any work already performed.

You are responsible for the quality of the source files you upload. Low-resolution photos (under 1500 px on the shortest edge) may print soft or pixelated. We will not stop the order for resolution reasons unless you ask us to — but you accept the print result.`
