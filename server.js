const express = require("express");
const fs = require("fs");
const path = require("path");
const mm = require("music-metadata");
const sharp = require("sharp"); // optional, for resizing cover images

const app = express();
const musicRoot = "/music";
const coverCache = path.join(__dirname, "public/covers");

// Ensure covers folder exists
if (!fs.existsSync(coverCache)) fs.mkdirSync(coverCache, { recursive: true });

// serve static frontend
app.use(express.static(path.join(__dirname, "public")));
app.use("/covers", express.static(coverCache));

// helper: generate cover file if embedded, otherwise fallback
async function getCover(filePath, fileName) {
  const coverFile = path.join(coverCache, fileName + ".jpg");
  if (fs.existsSync(coverFile)) return `/covers/${fileName}.jpg`;

  try {
    const metadata = await mm.parseFile(filePath, { duration: false });
    if (metadata.common.picture && metadata.common.picture.length > 0) {
      const pic = metadata.common.picture[0];
      await sharp(pic.data).jpeg().toFile(coverFile); // convert to jpg
      return `/covers/${fileName}.jpg`;
    }
  } catch (err) {
    console.error("Cover generation error:", err);
  }

  return "/default-cover.png"; // fallback
}

// List available years
app.get("/api/years", (req, res) => {
  try {
    const years = fs.readdirSync(musicRoot)
      .filter(f => fs.lstatSync(path.join(musicRoot, f)).isDirectory());
    res.json(years);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// List seasons
app.get("/api/seasons/:year", (req, res) => {
  try {
    const yearPath = path.join(musicRoot, req.params.year);
    const seasons = fs.readdirSync(yearPath)
      .filter(f => fs.lstatSync(path.join(yearPath, f)).isDirectory());
    res.json(seasons);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// List files with cover URLs
app.get("/api/files/:year/:season", async (req, res) => {
  try {
    const dir = path.join(musicRoot, req.params.year, req.params.season);
    const files = fs.readdirSync(dir)
      .filter(f => /\.(mp3|flac|ogg|wav)$/i.test(f));

    files.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

    const metadataPromises = files.map(async f => {
      const filePath = path.join(dir, f);
      const fileNameSafe = f.replace(/\.[^/.]+$/, "").replace(/\s+/g, "_");
      let artist = "";
      let title = "";
      const ext = path.extname(f).substring(1);

      try {
        const metadata = await mm.parseFile(filePath, { duration: false });
        artist = metadata.common.artist || "";
        title = metadata.common.title || "";
      } catch { }

      // fallback to filename
      if (!title) {
        const nameWithoutExt = f.replace(/\.[^/.]+$/, "");
        const match = nameWithoutExt.match(/^\s*(.+?)\s*-\s*(.+)$/);
        if (match) {
          artist = artist || match[1].trim();
          title = match[2].trim();
        } else {
          title = nameWithoutExt;
        }
      }

      const cover = await getCover(filePath, fileNameSafe);

      return {
        artist,
        title,
        ext,
        cover,
        url: `/stream/${req.params.year}/${req.params.season}/${encodeURIComponent(f)}`
      };
    });

    const results = await Promise.all(metadataPromises);
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Streaming endpoint (unchanged)
app.get("/stream/:year/:season/:file", (req, res) => {
  const filePath = path.join(musicRoot, req.params.year, req.params.season, req.params.file);
  try {
    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const range = req.headers.range;

    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunkSize = end - start + 1;
      const file = fs.createReadStream(filePath, { start, end });
      res.writeHead(206, {
        "Content-Range": `bytes ${start}-${end}/${fileSize}`,
        "Accept-Ranges": "bytes",
        "Content-Length": chunkSize,
        "Content-Type": "audio/mpeg"
      });
      file.pipe(res);
    } else {
      res.writeHead(200, {
        "Content-Length": fileSize,
        "Content-Type": "audio/mpeg"
      });
      fs.createReadStream(filePath).pipe(res);
    }
  } catch {
    res.status(404).json({ error: "File not found" });
  }
});

app.listen(3000, () => console.log("Server running at http://localhost:3000"));
