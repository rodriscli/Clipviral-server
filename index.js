const https = require(“https”);
const http = require(“http”);

const PORT = process.env.PORT || 3000;

function fetchUrl(urlStr, headers = {}) {
return new Promise((resolve, reject) => {
const options = {
headers: {
“User-Agent”: “Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36”,
“Accept-Language”: “en-US,en;q=0.9,es;q=0.8”,
“Accept”: “text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8”,
…headers,
},
};
const lib = urlStr.startsWith(“https”) ? https : http;
const req = lib.get(urlStr, options, (res) => {
let data = “”;
res.on(“data”, (chunk) => (data += chunk));
res.on(“end”, () => resolve({ status: res.statusCode, body: data }));
});
req.on(“error”, reject);
req.setTimeout(15000, () => { req.destroy(); reject(new Error(“TIMEOUT”)); });
});
}

async function getTranscript(videoId) {
const pageRes = await fetchUrl(`https://www.youtube.com/watch?v=${videoId}`);
if (pageRes.status !== 200) throw new Error(“VIDEO_NOT_FOUND”);
const html = pageRes.body;
if (html.includes(“Our systems have detected unusual traffic”)) throw new Error(“BOT_DETECTED”);

const match = html.match(/“captionTracks”:\s*([[\s\S]*?])/);
if (!match) throw new Error(“NO_CAPTIONS”);

let tracks;
try {
tracks = JSON.parse(match[1].replace(/\u0026/g, “&”).replace(/\”/g, ‘”’));
} catch (e) { throw new Error(“PARSE_ERROR”); }

if (!tracks || tracks.length === 0) throw new Error(“NO_TRACKS”);

const track =
tracks.find((t) => t.languageCode && t.languageCode.startsWith(“es”)) ||
tracks.find((t) => t.languageCode && t.languageCode.startsWith(“en”)) ||
tracks.find((t) => t.kind !== “asr”) ||
tracks[0];

if (!track || !track.baseUrl) throw new Error(“NO_TRACK_URL”);

const capRes = await fetchUrl(track.baseUrl + “&fmt=json3”);
if (capRes.status !== 200) throw new Error(“CAPTION_FETCH_FAILED”);

let capData;
try { capData = JSON.parse(capRes.body); } catch (e) { throw new Error(“CAPTION_PARSE_ERROR”); }

const events = capData.events || [];
const lines = events
.filter((e) => e.segs && e.tStartMs !== undefined)
.map((e) => {
const text = e.segs.map((s) => (s.utf8 || “”).replace(/\n/g, “ “)).join(””).trim();
if (!text) return null;
const secs = Math.floor(e.tStartMs / 1000);
const m = String(Math.floor(secs / 60)).padStart(2, “0”);
const s = String(secs % 60).padStart(2, “0”);
return `[${m}:${s}] ${text}`;
})
.filter(Boolean);

if (lines.length < 5) throw new Error(“TOO_SHORT”);
return lines.join(”\n”);
}

const server = http.createServer(async (req, res) => {
res.setHeader(“Access-Control-Allow-Origin”, “*”);
res.setHeader(“Access-Control-Allow-Methods”, “GET, OPTIONS”);
res.setHeader(“Access-Control-Allow-Headers”, “Content-Type”);

if (req.method === “OPTIONS”) { res.writeHead(200); res.end(); return; }

let url;
try { url = new URL(req.url, “http://localhost”); }
catch (e) { res.writeHead(400, { “Content-Type”: “application/json” }); res.end(JSON.stringify({ error: “Invalid URL” })); return; }

if (url.pathname === “/transcript”) {
const videoId = url.searchParams.get(“id”);
if (!videoId) { res.writeHead(400, { “Content-Type”: “application/json” }); res.end(JSON.stringify({ error: “Missing video id” })); return; }
try {
const transcript = await getTranscript(videoId);
res.writeHead(200, { “Content-Type”: “application/json” });
res.end(JSON.stringify({ transcript, lines: transcript.split(”\n”).length }));
} catch (e) {
res.writeHead(500, { “Content-Type”: “application/json” });
res.end(JSON.stringify({ error: e.message }));
}
return;
}

res.writeHead(200, { “Content-Type”: “application/json” });
res.end(JSON.stringify({ status: “ok”, message: “ClipViral API running” }));
});

server.listen(PORT, () => console.log(`ClipViral server running on port ${PORT}`));
server.on(“error”, (err) => console.error(“Server error:”, err));
