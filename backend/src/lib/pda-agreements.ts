import { createHash } from "node:crypto";

export const PDA_AGREEMENT_VERSION = "2026.08";

export type PdaAgreementKey =
  | "agent_agreement"
  | "inventory_agreement"
  | "cod_agreement"
  | "loss_damage_form"
  | "confidentiality_agreement"
  | "termination_agreement";

export type PdaAgreementSection = {
  heading: string;
  paragraphs: string[];
  bullets?: string[];
};

export type PdaAgreementTemplate = {
  key: PdaAgreementKey;
  title: string;
  shortTitle: string;
  purpose: string;
  summary: string[];
  sections: PdaAgreementSection[];
};

export type RenderedPdaAgreement = PdaAgreementTemplate & {
  version: string;
  companyName: string;
  applicantName: string;
  reference: string;
  issuedOn: string;
  opening: string;
  declaration: string;
  governingLaw: string;
  contentHash: string;
};

const templates: PdaAgreementTemplate[] = [
  {
    key: "agent_agreement",
    title: "Personal Delivery Agent Agreement",
    shortTitle: "Delivery Agent Agreement",
    purpose: "Sets the professional standards, authority and operating rules for carrying out deliveries on behalf of the Company.",
    summary: [
      "Carry out only authorised assignments and follow the approved delivery process.",
      "Treat customers professionally and never collect an unapproved fee.",
      "Keep complete, truthful records for every order, payment and handover.",
      "Report safety, customer, stock or cash incidents immediately."
    ],
    sections: [
      {
        heading: "1. Appointment and scope",
        paragraphs: [
          "The Company may assign the Agent to receive, hold, transport and deliver approved products, collect authorised cash-on-delivery payments, obtain delivery evidence and complete related customer-service steps. The Agent may act only within an assignment and written operating instruction issued by the Company.",
          "The Agent has no authority to change a product price, promise a refund, waive a debt, bind the Company to a contract, appoint a substitute, or make a representation outside an approved script or instruction unless the Company gives written permission."
        ]
      },
      {
        heading: "2. Professional conduct",
        paragraphs: [
          "The Agent shall act honestly, lawfully, safely and respectfully; protect customers and Company property; use accurate identity and contact details; and avoid harassment, threats, discrimination, intoxication, fraud or any conduct likely to damage a customer, the Company or its reputation."
        ],
        bullets: [
          "Confirm the customer, product, quantity, approved price and delivery result accurately.",
          "Do not demand tips, add unofficial charges, divert an order or privately sell Company stock.",
          "Do not share an assignment, customer address or access credential with an unauthorised person."
        ]
      },
      {
        heading: "3. Records, availability and reporting",
        paragraphs: [
          "The Agent shall keep the application and assigned-work records current, respond within the required operating window, preserve receipts and proof, and record failed, rescheduled and completed deliveries truthfully. Falsifying a call, location, payment, delivery, stock count or customer response is a material breach.",
          "Accidents, threats, suspected fraud, loss, damage, customer complaints and inability to complete an assignment must be reported through the designated channel without avoidable delay."
        ]
      },
      {
        heading: "4. Fees and relationship",
        paragraphs: [
          "Only fees and incentives shown in the approved Company schedule or separately confirmed in writing are payable. The Agent may not deduct a fee from customer money unless the Company has expressly authorised that deduction in the relevant reconciliation record.",
          "This document records an operational service arrangement. It does not remove any right or obligation that applicable law makes mandatory, and the legal character of the relationship is determined by the facts, applicable law and any separate written terms."
        ]
      }
    ]
  },
  {
    key: "inventory_agreement",
    title: "Inventory Custody Agreement",
    shortTitle: "Stock Custody Agreement",
    purpose: "Records the Agent's duty to safeguard, count, account for and return every unit of Company inventory placed in their custody.",
    summary: [
      "Company stock remains Company property at all times.",
      "Count and acknowledge every handover before accepting custody.",
      "Do not sell, transfer, pledge, substitute or use stock outside an authorised order.",
      "Return and reconcile all stock on demand, suspension or termination."
    ],
    sections: [
      {
        heading: "1. Ownership and custody",
        paragraphs: [
          "All products, packaging, documents, devices and other materials issued to the Agent remain the exclusive property of the Company unless a completed authorised sale transfers a product to a customer. Custody does not give the Agent ownership, a lien or any right to use the property as security.",
          "The Agent becomes accountable for the quantity and condition acknowledged in the handover record. The Agent must count and inspect the items at receipt and record any discrepancy before confirming the handover."
        ]
      },
      {
        heading: "2. Safekeeping and permitted use",
        paragraphs: [
          "The Agent shall store inventory in a clean, dry and secure place, protect it from theft, weather, contamination, unauthorised access and avoidable damage, and transport it with reasonable care. Stock may be released only against an authorised assignment and the release must be recorded immediately."
        ],
        bullets: [
          "No private sale, loan, pledge, swap, relabelling or unauthorised transfer.",
          "No mixing of Company stock with personal goods where identity or quantity may be lost.",
          "No alteration of a stock record to conceal a shortage, return or damaged unit."
        ]
      },
      {
        heading: "3. Counts, audits and discrepancies",
        paragraphs: [
          "The Agent shall cooperate with scheduled and spot counts, provide access to the stock and supporting records, and promptly explain any difference. A system figure is evidence to be checked against handover, delivery, return and incident records; it is not by itself a final finding of misconduct.",
          "Where a discrepancy exists, the Company may pause further stock assignments while it investigates. The Agent will receive a reasonable opportunity to provide receipts, messages, photographs, witnesses or other relevant evidence before a final decision is recorded."
        ]
      },
      {
        heading: "4. Return obligation",
        paragraphs: [
          "The Agent shall return all requested stock and Company property, in the recorded condition subject to ordinary authorised handling, at the place and time communicated by the Company. Returns must be counted by both sides and evidenced by a signed or electronic receipt."
        ]
      }
    ]
  },
  {
    key: "cod_agreement",
    title: "COD Collection & Remittance Agreement",
    shortTitle: "Cash Collection Agreement",
    purpose: "Controls how customer cash and transfer payments are collected, protected, recorded and remitted to the Company.",
    summary: [
      "Collect only the amount authorised for the assigned order.",
      "Keep Company money separate from personal money and do not borrow from it.",
      "Record every collection and remit it by the stated deadline.",
      "Report shortages, disputed transfers or suspected fraud immediately."
    ],
    sections: [
      {
        heading: "1. Limited authority to collect",
        paragraphs: [
          "The Agent may collect money only for an order assigned by the Company and only in the amount and payment method shown in the active order record. The Agent must confirm the payment and provide or record the required acknowledgement before marking the order paid or delivered."
        ]
      },
      {
        heading: "2. Company funds",
        paragraphs: [
          "Every cash-on-delivery amount collected for the Company is held for the Company and must be kept identifiable and available for remittance. The Agent shall not spend, lend, invest, pledge, conceal, commingle or use Company funds for a personal purpose.",
          "The Agent may not set off an alleged fee, debt or expense against collected money unless an authorised Company reconciliation expressly records the deduction."
        ]
      },
      {
        heading: "3. Recording and remittance",
        paragraphs: [
          "The Agent shall record the amount collected, payment method, order, time and required proof accurately, and remit the full amount by the deadline and channel shown in the remittance instruction or current written policy. A transfer is not complete until the Company can identify and verify it.",
          "Receipts, teller evidence, transfer references and customer payment evidence must be retained until the Company closes the reconciliation. Duplicate, altered or unrelated proof is a material breach."
        ]
      },
      {
        heading: "4. Shortage or disputed payment",
        paragraphs: [
          "The Agent shall report a cash shortage, counterfeit note, failed transfer, chargeback, theft or payment dispute immediately. The Company may suspend new COD exposure while it reconciles the affected records. Any responsibility or recovery will follow the evidence, this Agreement and applicable law."
        ]
      }
    ]
  },
  {
    key: "loss_damage_form",
    title: "Loss & Damage Responsibility Form",
    shortTitle: "Loss & Damage Responsibility",
    purpose: "Explains incident reporting, evidence review and responsibility where Company stock, cash or property is lost or damaged.",
    summary: [
      "Take reasonable precautions to prevent avoidable loss or damage.",
      "Report an incident immediately and preserve all available evidence.",
      "Cooperate with a fair reconciliation and investigation.",
      "Responsibility is determined from evidence, not assumed automatically."
    ],
    sections: [
      {
        heading: "1. Standard of care",
        paragraphs: [
          "The Agent shall take reasonable care of Company stock, cash, records, devices and other property in their custody, follow storage and transport instructions, and avoid conduct that exposes property to an obvious and preventable risk."
        ]
      },
      {
        heading: "2. Immediate incident duties",
        paragraphs: [
          "On discovering loss, theft, damage, shortage, tampering or destruction, the Agent shall promptly secure what remains, protect people from danger, notify the Company through the designated channel and provide a truthful initial account. Where appropriate, the Agent shall also cooperate with a police, insurer, carrier or other lawful report requested by the Company."
        ],
        bullets: [
          "Preserve photographs, video, messages, receipts, location records and witness details.",
          "Do not repair, discard, replace or alter affected property or records without instruction, except where urgently required for safety.",
          "Do not admit liability on behalf of the Company or make a private settlement with a customer."
        ]
      },
      {
        heading: "3. Assessment and right to respond",
        paragraphs: [
          "The Company will compare the incident report with handover, stock, delivery, payment and return records. Before a final adverse finding, the Agent will be informed of the material discrepancy and given a reasonable opportunity to respond and provide relevant evidence.",
          "The Agent is responsible only to the extent that loss or damage is established under the evidence, agreed duties and applicable law. Ordinary wear, a verified system error or an event not caused or worsened by the Agent will not be treated as automatic misconduct."
        ]
      },
      {
        heading: "4. Recovery and discipline",
        paragraphs: [
          "Where responsibility is established, the Company may seek return, repair, replacement, repayment or another proportionate remedy permitted by law. No deduction, set-off or recovery will be made in a manner prohibited by applicable law. Fraud, concealment or deliberate falsification may result in suspension, termination and referral to the appropriate authority."
        ]
      }
    ]
  },
  {
    key: "confidentiality_agreement",
    title: "Data & Customer Confidentiality Agreement",
    shortTitle: "Customer Data Agreement",
    purpose: "Protects customer personal data, Company information and access credentials used during delivery work.",
    summary: [
      "Use customer information only to complete the authorised assignment.",
      "Do not copy, market to, sell or disclose customer data.",
      "Secure phones, records and account credentials against unauthorised access.",
      "Report a suspected privacy or security incident immediately."
    ],
    sections: [
      {
        heading: "1. Confidential information",
        paragraphs: [
          "Confidential Information includes customer names, phone numbers, addresses, order history, payment information, messages and location details, together with Company prices, stock, routes, credentials, systems, reports, business methods and any non-public information received through the assignment."
        ]
      },
      {
        heading: "2. Purpose limitation and confidentiality",
        paragraphs: [
          "The Agent shall access and use only the minimum information reasonably required to complete an authorised assignment and shall follow the Company's documented instructions. Customer information must not be used for private marketing, personal contact, harassment, resale, profiling, an unrelated delivery or any other unauthorised purpose.",
          "The Agent shall not disclose Confidential Information to family, friends, another agent, a competing business or any unauthorised person. A disclosure required by law must, where legally permitted, be reported to the Company before it is made."
        ]
      },
      {
        heading: "3. Security and incident reporting",
        paragraphs: [
          "The Agent shall protect devices with a passcode, keep credentials private, avoid storing unnecessary screenshots or paper copies, and prevent customer details from being visible to unauthorised persons. A lost device, exposed message, suspicious login, mistaken disclosure or other suspected data incident must be reported immediately.",
          "These duties support the Company's obligations under the Nigeria Data Protection Act 2023, including fair, lawful and accountable processing and appropriate security for personal data."
        ]
      },
      {
        heading: "4. Return, deletion and survival",
        paragraphs: [
          "When an assignment ends or the Company requests it, the Agent shall return or securely delete customer and Company information, subject only to a lawful preservation instruction. Confidentiality, restricted-use and incident-cooperation duties continue after suspension or termination."
        ]
      }
    ]
  },
  {
    key: "termination_agreement",
    title: "Termination & Stock Recovery Agreement",
    shortTitle: "Exit & Stock Recovery Agreement",
    purpose: "Sets the close-out process for suspension, resignation or termination, including recovery of stock, cash, data and Company property.",
    summary: [
      "Stop accepting or carrying out work when access is suspended or ended.",
      "Return every unit of stock, all Company money and all Company property.",
      "Complete a joint reconciliation and obtain a return receipt.",
      "Delete customer data and surrender Company access credentials."
    ],
    sections: [
      {
        heading: "1. Suspension and end of assignment",
        paragraphs: [
          "The Company may suspend access or assignments while investigating a safety, cash, stock, customer, identity or compliance concern. Either party may end the operational arrangement in accordance with applicable law and any separate written notice requirement. Ending the arrangement does not cancel duties or amounts that arose before the end date."
        ]
      },
      {
        heading: "2. Immediate close-out duties",
        paragraphs: [
          "Once suspension or termination is communicated, the Agent shall stop representing that they act for the Company, stop accepting new assignments and follow the Company's directions for any customer or order already in progress.",
          "The Agent shall return all stock, cash, transfer evidence, documents, identification materials, devices, packaging and other Company property at the stated return appointment and shall not withhold Company property as security for a disputed fee or claim."
        ]
      },
      {
        heading: "3. Final reconciliation",
        paragraphs: [
          "The parties shall count returned stock and reconcile assigned orders, COD collections, remittances, approved fees, damage reports and outstanding property. The Agent must receive or retain a receipt for each physical and monetary handover. Any disputed item should be identified in the reconciliation rather than hidden or silently written off.",
          "The Agent shall reasonably cooperate with a post-exit audit or investigation relating to assignments performed during the engagement."
        ]
      },
      {
        heading: "4. Access, data and continuing obligations",
        paragraphs: [
          "The Agent shall surrender or disable Company access as directed and securely delete customer and Company data that is not subject to a lawful preservation instruction. Confidentiality, data protection, accounting, repayment and investigation-cooperation obligations survive to the extent necessary to give them effect."
        ]
      }
    ]
  }
];

export const PDA_AGREEMENT_TEMPLATES = Object.freeze(templates);
export const PDA_AGREEMENT_KEYS = new Set<PdaAgreementKey>(templates.map((item) => item.key));

export function isPdaAgreementKey(value: string): value is PdaAgreementKey {
  return PDA_AGREEMENT_KEYS.has(value as PdaAgreementKey);
}

export function normalizeSignerName(value: string): string {
  return value.trim().toLocaleLowerCase("en-NG").replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

export function signerNameMatches(typedName: string, applicantName: string): boolean {
  return normalizeSignerName(typedName) === normalizeSignerName(applicantName);
}

export function renderPdaAgreement(input: {
  key: PdaAgreementKey;
  companyName: string;
  applicantName: string;
  reference: string;
  issuedOn: string;
  version?: string;
}): RenderedPdaAgreement {
  const template = templates.find((item) => item.key === input.key);
  if (!template) throw new Error("Unknown Personal Delivery Agent agreement.");
  const version = input.version || PDA_AGREEMENT_VERSION;
  const base = {
    ...template,
    version,
    companyName: input.companyName.trim() || "Protohub",
    applicantName: input.applicantName.trim(),
    reference: input.reference.trim(),
    issuedOn: input.issuedOn,
    opening: `This ${template.title} is issued by ${input.companyName.trim() || "Protohub"} (the “Company”) to ${input.applicantName.trim()} (the “Agent”) under application ${input.reference.trim()}. The Company and the Agent agree to the terms below.`,
    declaration: `I, ${input.applicantName.trim()}, confirm that I have read and understood this ${template.title}; the name I type is my electronic signature; I intend this acceptance to record my agreement; and the information I provide is true to the best of my knowledge.`,
    governingLaw: "This Agreement is governed by the laws of the Federal Republic of Nigeria. The parties should first try to resolve a dispute through documented internal review before using any lawful external remedy. If a provision is invalid or unenforceable, the remaining provisions continue. No term waives a right or duty that applicable law does not permit the parties to waive. A material change requires a new version and fresh acceptance."
  };
  const contentHash = createHash("sha256").update(JSON.stringify(base)).digest("hex");
  return { ...base, contentHash };
}

export function agreementTemplateRows() {
  return templates.map((item) => ({ key: item.key, label: item.title }));
}
