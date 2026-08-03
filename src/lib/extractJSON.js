// JSON extraction/repair for model responses.
//
// Moved out of App.jsx into its own module so it can be unit-tested in isolation
// (it's the most fragile code in the app) and reused by any headless runner.

// The prompts ask for "2 short paragraphs", which the model often delivers as
// a real line break inside a JSON string. That is invalid JSON and used to
// fail the whole analysis. Valid JSON never contains raw control characters
// inside a string, so escaping them is safe to apply unconditionally.
export function escapeControlCharsInStrings(s) {
  let out="",inStr=false,esc=false;
  for (const ch of s) {
    if (esc) { out+=ch; esc=false; continue; }
    if (ch==="\\") { out+=ch; esc=true; continue; }
    if (ch==='"') { inStr=!inStr; out+=ch; continue; }
    if (inStr) {
      if (ch==="\n") { out+="\\n"; continue; }
      if (ch==="\r") { out+="\\r"; continue; }
      if (ch==="\t") { out+="\\t"; continue; }
    }
    out+=ch;
  }
  return out;
}

export function extractJSON(raw) {
  let text = raw.replace(/```json\s*/gi,"").replace(/```\s*/g,"").trim();
  text = escapeControlCharsInStrings(text);
  try { return JSON.parse(text); } catch(_) {}
  const start = text.indexOf("{");
  if (start===-1) throw new Error("No JSON found in response");
  let depth=0,end=-1;
  for (let i=start;i<text.length;i++) {
    if (text[i]==="{") depth++;
    else if (text[i]==="}") { depth--; if (depth===0) { end=i; break; } }
  }
  if (end!==-1) { try { return JSON.parse(text.slice(start,end+1)); } catch(_) {} }
  let frag=(end!==-1?text.slice(start,end+1):text.slice(start)).replace(/,\s*$/,"");
  let braces=0,brackets=0,inStr=false,esc=false;
  for (const ch of frag) {
    if (esc) { esc=false; continue; }
    if (ch==="\\"&&inStr) { esc=true; continue; }
    if (ch==='"') { inStr=!inStr; continue; }
    if (inStr) continue;
    if (ch==="{") braces++; else if (ch==="}") braces--;
    else if (ch==="[") brackets++; else if (ch==="]") brackets--;
  }
  if (inStr) frag+='"';
  frag+="]".repeat(Math.max(0,brackets))+"}".repeat(Math.max(0,braces));
  try { return JSON.parse(frag); } catch {
    throw new Error("Could not parse agent response — please try again.");
  }
}
