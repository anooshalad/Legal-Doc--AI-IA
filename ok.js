

const api = "";

const fileInputEl = document.getElementById("fileInput");
const outputEl = document.getElementById("output");
const analyzeBtnEl = document.getElementById("analyzeBtn");
let uploadedText = "";
let uploadedPdfBase64 = "";
let uploadedFileName = "";
let isFileProcessing = false;


function readTextFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = function(event) {
      resolve((event.target?.result || "").toString());
    };
    reader.onerror = function() {
      reject(new Error("Could not read this file."));
    };
    reader.readAsText(file);
  });
}


function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = function(event) {
      const result = (event.target?.result || "").toString();
      const base64 = result.includes(",") ? result.split(",")[1] : "";
      resolve(base64);
    };
    reader.onerror = function() {
      reject(new Error("Could not read this PDF file."));
    };
    reader.readAsDataURL(file);
  });
}


fileInputEl.addEventListener("change", async function(e) {
  const file = e.target.files[0];
  if (!file) return;

  uploadedText = "";
  uploadedPdfBase64 = "";
  uploadedFileName = file.name;
  isFileProcessing = true;
  analyzeBtnEl.disabled = true;
  outputEl.innerText = "Reading uploaded file...";

  try {
    const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");

    if (isPdf) {
      uploadedPdfBase64 = await readFileAsBase64(file);

      if (!uploadedPdfBase64) {
        outputEl.innerText = "Could not read this PDF. Please try another file.";
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
    console.error("File read error:", error);
    outputEl.innerText = "Could not extract readable text from this file: " + error.message;
  }
});


async function analyze() {
    if (isFileProcessing) {
      outputEl.innerText = "Still processing the file. Please wait a moment.";
      return;
    }

    const text = uploadedText.trim();
    const hasPdf = Boolean(uploadedPdfBase64);

    if (!text && !hasPdf) {
      outputEl.innerText = "Please upload a legal document first.";
      return;
    }

    outputEl.innerText = "Analyzing...";

    const finalPromptText = `You are an expert legal assistant. Determine the type of the uploaded document.

First, check if the document is a valid legal document. If it is NOT a legal document at all, respond EXACTLY with the phrase 'INVALID_DOCUMENT' and provide nothing else.

If it IS a legal document, output the analysis structured based on its detected type:
- If MOU: Provide 1) Purpose of the MOU 2) Roles and responsibilities of each party 3) Key terms and conditions 4) Potential loopholes or risks.
- If Marriage: Provide 1) Details of the parties involved 2) Key clauses (like property rights, alimony if applicable) 3) Legal validity conditions mentioned 4) Any unusual or risky clauses.
- If Business Contract: Provide 1) Core obligations and deliverables 2) Payment terms 3) Termination clauses and penalties 4) Key risk factors and liabilities.
- If NDA: Provide 1) Definition of confidential information 2) Exclusions from confidentiality 3) Term and duration 4) Penalties for breach.
- For any other Legal Document: Provide 1) A plain-language summary 2) Key obligations and deadlines 3) Potential risk points.

Format your response clearly. Start by explicitly stating the detected document type.` + (hasPdf ? "" : `\n\nDocument:\n${text}`);

    try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${api}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          contents: [
            {
              parts: hasPdf
                ? [
                    {
                      text: finalPromptText
                    },
                    {
                      inline_data: {
                        mime_type: "application/pdf",
                        data: uploadedPdfBase64
                      }
                    }
                  ]
                : [
                    {
                      text: finalPromptText
                    }
                  ]
            }
          ]
        })
      }
    );

    const data = await response.json();
    if (!response.ok) {
      const apiMessage = data?.error?.message || "Request failed.";
      throw new Error(apiMessage);
    }

    const result = data.candidates?.[0]?.content?.parts?.[0]?.text || "No response";

    if (result.trim() === "INVALID_DOCUMENT" || result.includes("INVALID_DOCUMENT")) {
      outputEl.innerHTML = '<div style="color: #dc2626; padding: 10px; background: #fef2f2; border: 1px solid #f87171; border-radius: 8px;"><b>Error:</b> The uploaded file does not appear to be a valid legal document. Please upload a legal document.</div>';
      return;
    }

    outputEl.innerHTML = formatText(result);
} catch (error) {
    console.error("Error:", error);
    outputEl.innerText = "Error: " + error.message;

}

}

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