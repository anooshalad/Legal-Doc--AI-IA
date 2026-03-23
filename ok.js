

const api = "AIzaSyC3ggBX-Z9DF7BfNf4Zaw4pfiavulJNT88";

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
                      text: "Analyze the uploaded legal PDF and provide: 1) A plain-language summary 2) Key obligations and deadlines 3) Potential risk points"
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
                      text: `Analyze this legal document and provide:
                    1) A plain-language summary
                    2) Key obligations and deadlines
                    3) Potential risk points

Document:
${text}`
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

    const result = data.candidates?.[0]?.content?.parts?.[0]?.text ||
      "No response";

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