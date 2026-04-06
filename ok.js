const api = "";

// Set up PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';

const fileInputEl = document.getElementById("fileInput");
const outputEl = document.getElementById("output");
const analyzeBtnEl = document.getElementById("analyzeBtn");
const langToggleEl = document.getElementById("langToggle");

let uploadedText = "";
let uploadedFileName = "";
let isFileProcessing = false;

// Cached results for instant switching
let cachedEn = "";
let cachedHi = "";

// ─────────────────────────────────────────────
//  LANGUAGE TOGGLE  (instant switch, no re-fetch)
// ─────────────────────────────────────────────

langToggleEl.addEventListener("change", () => {
  const wantHindi = langToggleEl.checked;

  if (!cachedEn && !cachedHi) return; // nothing analysed yet

  if (wantHindi && cachedHi) {
    outputEl.innerHTML = cachedHi;
  } else if (!wantHindi && cachedEn) {
    outputEl.innerHTML = cachedEn;
  } else {
    outputEl.innerText = "Still generating… please wait.";
  }
});

// ─────────────────────────────────────────────
//  FILE READERS
// ─────────────────────────────────────────────

function readTextFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve((e.target?.result || "").toString());
    reader.onerror = () => reject(new Error("Could not read this file."));
    reader.readAsText(file);
  });
}

async function extractTextFromPdf(file) {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let text = "";

    // Extract text from every page
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const pageText = content.items.map(item => item.str).join(" ");
      text += pageText + "\n";
    }
    return text;
  } catch (error) {
    throw new Error("Failed to extract text from PDF: " + error.message);
  }
}

// ─────────────────────────────────────────────
//  DOCUMENT TYPE DETECTION  (keyword-based)
// ─────────────────────────────────────────────

const DOC_TYPES = [
  { id: "sale_deed", label: "Sale Deed", keywords: ["sale deed", "विक्रय पत्र", "विक्रय विलेख", "sells and transfers", "purchaser", "vendor"] },
  { id: "gift_deed", label: "Gift Deed", keywords: ["gift deed", "दान पत्र", "donor", "donee", "gifted", "voluntary transfer", "without consideration"] },
  { id: "lease_agreement", label: "Lease / Rent Agreement", keywords: ["lease agreement", "rent agreement", "किराया नामा", "किरायेदार", "landlord", "tenant", "monthly rent", "lessor", "lessee"] },
  { id: "mortgage_deed", label: "Mortgage Deed", keywords: ["mortgage deed", "बंधक पत्र", "mortgagor", "mortgagee", "hypothecation", "charge on property", "loan amount"] },
  { id: "partition_deed", label: "Partition / Release Deed", keywords: ["partition deed", "release deed", "relinquishment", "विभाजन पत्र", "त्याग पत्र", "co-sharer", "joint property"] },
  { id: "partnership_deed", label: "Partnership Deed", keywords: ["partnership deed", "साझेदारी", "partners", "profit sharing", "capital contribution", "firm name"] },
  { id: "moa_aoa", label: "MOA / AOA", keywords: ["memorandum of association", "articles of association", "moa", "aoa", "subscribers", "objects clause", "share capital"] },
  { id: "nda", label: "Non-Disclosure Agreement (NDA)", keywords: ["non-disclosure", "nda", "confidential information", "गोपनीयता", "proprietary information", "trade secret"] },
  { id: "employment_contract", label: "Employment Contract", keywords: ["employment contract", "employment agreement", "नियुक्ति पत्र", "employer", "employee", "salary", "designation", "termination clause"] },
  { id: "will", label: "Will / Testament", keywords: ["will", "testament", "वसीयत", "testator", "beneficiary", "bequest", "executor", "codicil"] },
  { id: "succession_cert", label: "Succession Certificate", keywords: ["succession certificate", "उत्तराधिकार प्रमाण पत्र", "legal heir", "deceased", "court order", "movable assets"] },
  { id: "marriage_cert", label: "Marriage Certificate / Family Settlement", keywords: ["marriage certificate", "विवाह प्रमाण पत्र", "family settlement", "spouse", "husband", "wife"] },
  { id: "affidavit", label: "Affidavit", keywords: ["affidavit", "शपथ पत्र", "sworn", "deponent", "solemnly affirm", "notary", "magistrate"] },
  { id: "poa", label: "Power of Attorney (POA)", keywords: ["power of attorney", "poa", "मुख्तारनामा", "principal", "attorney", "authorize", "act on behalf"] },
  { id: "legal_notice", label: "Legal Notice", keywords: ["legal notice", "कानूनी नोटिस", "notice before action", "demand", "grievance", "legal action"] },
  { id: "plaint_petition", label: "Plaint / Petition / Written Statement", keywords: ["plaint", "petition", "written statement", "याचिका", "वाद पत्र", "plaintiff", "defendant", "suit for", "respondent"] },
  { id: "birth_death_cert", label: "Birth / Death Certificate", keywords: ["birth certificate", "death certificate", "जन्म प्रमाण पत्र", "मृत्यु प्रमाण पत्र", "date of birth", "registrar", "municipal"] },
  { id: "judgment_decree", label: "Judgment / Order / Decree", keywords: ["judgment", "decree", "court order", "न्यायालय आदेश", "honourable court", "plaintiff", "defendant", "pronounced", "civil suit"] },
  { id: "gazette", label: "Gazette / Government Notification", keywords: ["gazette", "notification", "rajpatra", "राजपत्र", "government of india", "ministry of", "official gazette"] },
  { id: "general_contract", label: "Contract / Agreement", keywords: ["agreement", "contract", "parties", "whereas", "terms and conditions", "obligations"] },
];

function detectDocType(text) {
  const lower = text.toLowerCase();
  let best = null, bestScore = 0;
  for (const doc of DOC_TYPES) {
    let score = 0;
    for (const kw of doc.keywords) if (lower.includes(kw.toLowerCase())) score++;
    if (score > bestScore) { bestScore = score; best = doc; }
  }
  return best || DOC_TYPES[DOC_TYPES.length - 1];
}

// ─────────────────────────────────────────────
//  PROMPT BUILDER
// ─────────────────────────────────────────────

function buildPrompt(docTypeId, docText) {

  const sections = {
    sale_deed: `1. 🏠 What is this document?\n2. 👥 Parties (Seller & Buyer)\n3. 🏡 Property Details\n4. 💰 Sale Price & Payment\n5. 📅 Possession Date\n6. 📜 Title & Encumbrances\n7. ⚠️ Obligations of Both Parties\n8. 🔴 Risk Points & Red Flags\n9. ✅ Key Takeaway`,
    gift_deed: `1. 🎁 What is this document?\n2. 👥 Donor & Donee\n3. 🏡 What is Being Gifted?\n4. ❤️ Is the Gift Voluntary?\n5. 📅 Ownership Transfer Date\n6. 📜 Acceptance Clause\n7. 🔴 Risk Points\n8. ✅ Key Takeaway`,
    lease_agreement: `1. 🏘️ What is this document?\n2. 👥 Landlord & Tenant\n3. 🏠 Property Details\n4. 📅 Tenancy Period\n5. 💰 Rent & Security Deposit\n6. 🔧 Maintenance & Utilities\n7. 🚫 Restrictions & Rules\n8. 📤 Termination & Notice Period\n9. ⚠️ Tenant & Landlord Rights\n10. 🔴 Risk Points\n11. ✅ Key Takeaway`,
    mortgage_deed: `1. 🏦 What is this document?\n2. 👥 Borrower & Lender\n3. 💰 Loan Details (amount, rate, tenure)\n4. 🏡 Mortgaged Property\n5. 📋 Type of Mortgage\n6. ⚙️ Borrower's Obligations\n7. ⚠️ Default & Consequences\n8. 🔓 Redemption Clause\n9. 🔴 Risk Points\n10. ✅ Key Takeaway`,
    partition_deed: `1. ⚖️ What is this document?\n2. 👥 All Co-owners\n3. 🏡 Property Being Divided\n4. 📐 How is it Divided?\n5. 📅 Effective Date\n6. 📜 Legal Title After Partition\n7. 🔴 Risk Points\n8. ✅ Key Takeaway`,
    partnership_deed: `1. 🤝 What is this document?\n2. 🏢 Firm Name & Business\n3. 👥 All Partners & Roles\n4. 💰 Capital Contribution\n5. 📊 Profit & Loss Sharing\n6. 🛠️ Management & Decision-making\n7. 💼 Salary / Remuneration\n8. 🚪 Admission, Retirement & Death\n9. 🔚 Dissolution Clauses\n10. 🔴 Risk Points\n11. ✅ Key Takeaway`,
    moa_aoa: `1. 🏛️ What is this document?\n2. 📛 Name Clause\n3. 📍 Registered Office\n4. 🎯 Objects Clause\n5. 💰 Capital Clause\n6. 👤 Liability Clause\n7. 📜 AOA Highlights\n8. 🔴 Risk Points\n9. ✅ Key Takeaway`,
    nda: `1. 🔒 What is this document?\n2. 👥 Disclosing & Receiving Party\n3. 📦 What Information is Protected?\n4. ⏳ Duration\n5. 🚫 What is NOT Confidential?\n6. ⚖️ Permitted Disclosures\n7. 💼 Obligations of Receiving Party\n8. 🔴 Consequences of Breach\n9. 🔴 Risk Points\n10. ✅ Key Takeaway`,
    employment_contract: `1. 💼 What is this document?\n2. 👤 Employee Details\n3. 🏢 Employer Details\n4. 📅 Joining Date & Probation\n5. 💰 Salary & CTC Breakdown\n6. ⏰ Working Hours & Leave\n7. 📋 Roles & Responsibilities\n8. 🔒 Confidentiality Obligations\n9. 🚫 Non-Compete / Non-Solicitation\n10. 🚪 Termination Clauses\n11. ⚖️ Dispute Resolution\n12. 🔴 Risk Points\n13. ✅ Key Takeaway`,
    will: `1. 📜 What is this document?\n2. 👤 The Testator\n3. 📋 Assets Listed\n4. 🎯 Beneficiaries & Their Shares\n5. 👔 Executor\n6. 🛡️ Guardian (if minors)\n7. 📝 Conditions on Inheritance\n8. ✍️ Witnesses\n9. 🔴 Risk Points\n10. ✅ Key Takeaway`,
    succession_cert: `1. 📄 What is this document?\n2. 🏛️ Issuing Court\n3. 👤 Deceased Person\n4. 👨‍👩‍👧 Petitioner / Legal Heir\n5. 💰 Assets Covered\n6. 🔑 Authority Granted\n7. ⚖️ Court Conditions\n8. 🔴 Risk Points\n9. ✅ Key Takeaway`,
    marriage_cert: `1. 💍 What is this document?\n2. 👥 Parties\n3. 📅 Date & Place\n4. 🏛️ Applicable Law\n5. 🏡 Assets (Family Settlement)\n6. 📐 Distribution (Family Settlement)\n7. 📜 Registration\n8. 🔴 Risk Points\n9. ✅ Key Takeaway`,
    affidavit: `1. 📋 What is this document?\n2. 👤 The Deponent\n3. 🎯 Purpose / Subject Matter\n4. 📝 Key Statements Made\n5. ✍️ Attestation\n6. 📅 Date & Place\n7. ⚖️ Legal Effect\n8. 🔴 Risk Points\n9. ✅ Key Takeaway`,
    poa: `1. 📜 What is this document?\n2. 👥 Principal & Agent\n3. 🔑 Type (General / Special POA)\n4. 🏢 Powers Granted\n5. 🚫 Limitations\n6. ⏳ Duration & Revocability\n7. 📍 Is it Registered?\n8. ⚠️ Agent's Responsibilities\n9. 🔴 Risk Points\n10. ✅ Key Takeaway`,
    legal_notice: `1. 📢 What is this document?\n2. 👤 Who Sent It?\n3. 📬 Who Received It?\n4. 📋 What is the Complaint?\n5. 💰 What is Being Demanded?\n6. ⏳ Time Limit Given\n7. ⚠️ Consequences of Non-Compliance\n8. ⚖️ Applicable Law\n9. 🔴 What Should the Recipient Do?\n10. ✅ Key Takeaway`,
    plaint_petition: `1. 🏛️ What is this document?\n2. 🏛️ Court & Case Details\n3. 👥 Plaintiff & Defendant\n4. 📋 Background of the Case\n5. ⚖️ Legal Grounds\n6. 🙏 Relief Sought\n7. 📎 Key Evidence\n8. 📅 Key Dates\n9. 🔴 Potential Issues\n10. ✅ Key Takeaway`,
    birth_death_cert: `1. 📄 What is this document?\n2. 🏛️ Issuing Authority\n3. 👤 Person Named\n4. 📋 Registration Details\n5. 🎯 Legal Uses\n6. 🔴 Risk Points\n7. ✅ Key Takeaway`,
    judgment_decree: `1. ⚖️ What is this document?\n2. 🏛️ Court & Case Details\n3. 👥 Parties\n4. 📋 Background\n5. ⚖️ Court's Findings\n6. 📜 Final Order / Decree\n7. 💰 Costs / Damages\n8. 🚪 Appeal Rights\n9. 🔴 Compliance Required\n10. ✅ Key Takeaway`,
    gazette: `1. 📰 What is this document?\n2. 🏛️ Issuing Authority\n3. 📅 Date of Publication\n4. 🎯 Subject / Topic\n5. ⚙️ Key Provisions\n6. 👥 Who is Affected?\n7. 📅 Effective Date\n8. ⚠️ Obligations & Compliance\n9. 🔴 Risk Points\n10. ✅ Key Takeaway`,
    general_contract: `1. 📄 What is this document?\n2. 👥 Parties Involved\n3. 📋 Key Terms & Conditions\n4. ⏳ Duration & Timeline\n5. 💰 Financial Obligations\n6. ⚖️ Rights & Obligations\n7. 🚪 Termination Clauses\n8. ⚠️ Penalty & Default Clauses\n9. 🔏 Confidentiality & IP\n10. 🔴 Risk Points & Red Flags\n11. ✅ Key Takeaway`,
  };

  const sectionList = sections[docTypeId] || sections["general_contract"];

  const contracts = ["sale_deed", "gift_deed", "lease_agreement", "mortgage_deed", "partition_deed", "partnership_deed", "nda", "employment_contract", "general_contract"];
  const estate = ["will", "succession_cert", "poa"];
  const litigation = ["legal_notice", "plaint_petition", "judgment_decree", "affidavit"];
  const certificates = ["marriage_cert", "birth_death_cert", "gazette"];

  let expertRole = "Indian Corporate Lawyer";
  let criticalInstructions = "";

  if (contracts.includes(docTypeId)) {
    expertRole = "Indian Contract and Property Lawyer";
    criticalInstructions = `- DO NOT just summarize. Look deeper for HIDDEN CLAUSES, TRAPS, vague language, and unbalanced rights.
- Identify missing statutory protections and potential loopholes.
- Point out exactly what could go wrong for the less powerful party in the real world.
- If a clause favors one party unfairly, explain the real-world consequence.`;
  } else if (estate.includes(docTypeId)) {
    expertRole = "Indian Estate Planning and Family Lawyer";
    criticalInstructions = `- Verify the clarity of inheritance, asset distribution, or powers granted.
- For Wills and POAs, highlight risks of future disputes, vague asset descriptions, or overly broad powers that could be misused.
- Note any missing formalities (like witness requirements or registration) if apparent.
- Explain the practical rights and limitations of the person holding this document.`;
  } else if (litigation.includes(docTypeId)) {
    expertRole = "Indian Litigation Lawyer";
    criticalInstructions = `- Explain the specific legal threat, demand, or court order in plain language.
- Highlight crucial DEADLINES, timelines, and exactly what action the recipient MUST take to avoid penalties, arrest, or losing the case.
- Identify the severity of the claims or the court's strictures.
- Warn about the exact consequences of non-compliance.`;
  } else if (certificates.includes(docTypeId)) {
    expertRole = "Indian Administrative Law Expert";
    criticalInstructions = `- Explain the legal validity and purpose of this official record.
- Highlight what bureaucratic rights this document grants (e.g., claiming insurance, property transfer, school admission).
- Warn about typical issues like naming mismatches, missing official seals, or spelling errors that usually cause trouble in India.`;
  } else {
    expertRole = "Indian Corporate Lawyer";
    criticalInstructions = `- Analyze the core rules, powers, and restrictions in the document.
- Highlight any restrictive clauses, unusual internal rules, or limits on authority.
- Identify any terms that severely restrict business freedom or shareholder rights.`;
  }

  return `You are a highly experienced ${expertRole}. Your job is to analyze the legal document below and explain it so that an ordinary person can understand it. 

CRITICAL INSTRUCTIONS:
${criticalInstructions}
- Use bold text for key terms and bullet points for readability.

IMPORTANT OUTPUT FORMAT:
You MUST provide the entire explanation in English first.
Then, you MUST output the exact text "|||SPLIT|||" on a new line.
Then, you MUST provide the exact same explanation translated fully into Hindi (Devanagari script).

Please structure your deep-dive analysis covering these exact sections clearly:
${sectionList}

Document:
${docText}`;
}

// ─────────────────────────────────────────────
//  GROQ API CALL
// ─────────────────────────────────────────────

async function callGroq(promptText) {
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${api}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile", // Powerful and fast general-use model from Meta
      messages: [{ role: "user", content: promptText }]
    })
  });

  const data = await response.json();
  if (!response.ok) throw new Error(data?.error?.message || "Groq Request failed.");
  return data.choices?.[0]?.message?.content || "No response";
}

// ─────────────────────────────────────────────
//  FILE CHANGE HANDLER
// ─────────────────────────────────────────────

fileInputEl.addEventListener("change", async function (e) {
  const file = e.target.files[0];
  if (!file) return;

  uploadedText = "";
  uploadedFileName = file.name;
  isFileProcessing = true;
  analyzeBtnEl.disabled = true;
  outputEl.innerText = "Reading uploaded file...";

  try {
    const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");

    if (isPdf) {
      uploadedText = await extractTextFromPdf(file);
      if (!uploadedText.trim()) {
        outputEl.innerText = "Could not extract text from this PDF. It might be an image/scanned document.";
        isFileProcessing = false;
        return;
      }
    } else {
      uploadedText = (await readTextFile(file)).trim();
      if (!uploadedText) {
        outputEl.innerText = "This file is empty. Please upload a document with text.";
        isFileProcessing = false;
        return;
      }
    }

    isFileProcessing = false;
    analyzeBtnEl.disabled = false;
    outputEl.innerText = `File loaded: ${uploadedFileName}. Click Analyze.`;
  } catch (error) {
    isFileProcessing = false;
    outputEl.innerText = error.message || "Could not read this file.";
  }
});

// ─────────────────────────────────────────────
//  ANALYZE
// ─────────────────────────────────────────────

async function analyze() {
  if (isFileProcessing) {
    outputEl.innerText = "Still processing the file. Please wait a moment.";
    return;
  }

  const text = uploadedText.trim();
  if (!text) {
    outputEl.innerText = "Please upload a legal document first.";
    return;
  }

  outputEl.innerText = "Analyzing… (This is powered by Groq and Meta LLaMA)";
  analyzeBtnEl.disabled = true;

  try {
    const docType = detectDocType(text);
    const prompt = buildPrompt(docType.id, text);
    const resultText = await callGroq(prompt);

    // Split the single output into English and Hindi parts
    const parts = resultText.split("|||SPLIT|||");
    cachedEn = formatText(parts[0] || "");
    cachedHi = formatText(parts[1] || parts[0] || "");

    // Show whichever language is currently selected
    outputEl.innerHTML = langToggleEl.checked ? cachedHi : cachedEn;
  } catch (error) {
    console.error("Error:", error);
    outputEl.innerText = "Error: " + error.message;
  } finally {
    analyzeBtnEl.disabled = false;
  }
}

// ─────────────────────────────────────────────
//  FORMAT MARKDOWN → HTML
// ─────────────────────────────────────────────

function formatText(text) {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  return escaped
    .replace(/^###\s+(.+)$/gm, "<h3>$1</h3>")
    .replace(/^##\s+(.+)$/gm, "<h2>$1</h2>")
    .replace(/^#\s+(.+)$/gm, "<h1>$1</h1>")
    .replace(/\*\*(.*?)\*\*/g, "<b>$1</b>")
    .replace(/\*(.*?)\*/g, "<i>$1</i>")
    .replace(/\n/g, "<br>");
}