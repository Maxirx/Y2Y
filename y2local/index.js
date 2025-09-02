import express from "express";
import { spawn } from "child_process";
import ffmpegPath from "ffmpeg-static";

const app = express();

/**
 * GET /info?url=...
 * Devuelve toda la info cruda del video.
 */
app.get("/info", async (req, res) => {
    const videoURL = req.query.url;
    if (!videoURL) return res.status(400).json({ error: "Falta ?url=" });

    try {
        const child = spawn("yt-dlp", [
            "-J",                  // dump JSON
            "--no-warnings",
            "--no-check-certificates",
            videoURL,
        ]);

        let data = "";
        child.stdout.on("data", (chunk) => (data += chunk));
        child.stderr.on("data", (chunk) => process.stderr.write(chunk));

        child.on("close", (code) => {
            if (code !== 0) return res.status(500).json({ error: "No se pudo obtener info" });

            try {
                const info = JSON.parse(data);
                res.json(info);
            } catch (err) {
                res.status(500).json({ error: "Error parseando JSON" });
            }
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Error iniciando yt-dlp" });
    }
});

/**
 * GET /options?url=...
 * Devuelve opciones limpias: progresivo y audio-only.
 */
app.get("/options", async (req, res) => {
    const videoURL = req.query.url;
    if (!videoURL) return res.status(400).json({ error: "Falta ?url=" });

    try {
        const child = spawn("yt-dlp", [
            "-J",
            "--no-warnings",
            "--no-check-certificates",
            videoURL,
        ]);

        let data = "";
        child.stdout.on("data", (chunk) => (data += chunk));
        child.stderr.on("data", (chunk) => process.stderr.write(chunk));

        child.on("close", (code) => {
            if (code !== 0) return res.status(500).json({ error: "No se pudo obtener info" });

            try {
                const info = JSON.parse(data);
                const options = [];

                (info.formats || []).forEach((f) => {
                    if (f.vcodec !== "none" && f.acodec !== "none") {
                        options.push({
                            type: "progressive",
                            label: f.qualityLabel,
                            ext: f.ext,
                            format_id: f.format_id,
                        });
                    } else if (f.vcodec === "none" && f.acodec !== "none") {
                        options.push({
                            type: "audio-only",
                            bitrate: f.abr || null,
                            ext: f.ext,
                            format_id: f.format_id,
                        });
                    }
                });

                // Ordenamos progresivo por resolución descendente
                const progressive = options
                    .filter((o) => o.type === "progressive")
                    .sort((a, b) => parseInt(b.label) - parseInt(a.label));
                const audioOnly = options
                    .filter((o) => o.type === "audio-only")
                    .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));

                res.json({
                    title: info.title,
                    duration: info.duration,
                    uploader: info.uploader,
                    options: { progressive, audioOnly },
                });
            } catch (err) {
                res.status(500).json({ error: "Error parseando JSON" });
            }
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Error iniciando yt-dlp" });
    }
});

/**
 * GET /download-friendly?url=...&type=...&format_id=...
 * Descarga el video/audio según opción seleccionada.
 */
app.get("/download-friendly", async (req, res) => {
    const { url: videoURL, type, format_id } = req.query;
    if (!videoURL || !type || !format_id)
        return res.status(400).json({ error: "Faltan url, type o format_id" });

    try {
        const safeName = type === "audio-only" ? "audio." : "video.";
        const extension = type === "audio-only" ? "m4a" : "mp4";

        const args = [
            "-f",
            format_id,
            "--no-warnings",
            "--no-check-certificates",
            "--ffmpeg-location",
            ffmpegPath,
            "--merge-output-format",
            "mp4",
            "-o",
            "-", // salida a stdout
            videoURL,
        ];

        const child = spawn("yt-dlp", args, { stdio: ["ignore", "pipe", "pipe"] });

        res.setHeader("Content-Type", type === "audio-only" ? "audio/m4a" : "video/mp4");
        res.setHeader("Content-Disposition", `attachment; filename="${safeName}${extension}"`);

        child.stderr.on("data", (chunk) => process.stderr.write(chunk));
        child.stdout.pipe(res);

        child.on("close", (code) => {
            if (code !== 0 && !res.headersSent) res.status(500).end("Fallo en la descarga");
            else res.end();
        });
    } catch (err) {
        console.error(err);
        if (!res.headersSent) res.status(500).json({ error: "Error descargando" });
        else res.end();
    }
});

app.get("/best", async (req, res) => {
    const videoURL = req.query.url;
    if (!videoURL) return res.status(400).json({ error: "Falta ?url=" });

    try {
        const child = spawn("yt-dlp", ["-J", "--no-warnings", "--no-check-certificates", videoURL]);

        let data = "";
        child.stdout.on("data", (chunk) => (data += chunk));
        child.stderr.on("data", (chunk) => process.stderr.write(chunk));

        child.on("close", (code) => {
            if (code !== 0) return res.status(500).json({ error: "No se pudo obtener info" });

            try {
                const info = JSON.parse(data);
                const formats = info.formats || [];

                // Mejor video: vcodec != none, acodec = none, mayor resolución
                const videoFormats = formats.filter(f => f.vcodec !== "none" && f.acodec === "none");
                const bestVideo = videoFormats.sort((a, b) => (b.height || 0) - (a.height || 0))[0];

                // Mejor audio: vcodec = none, acodec != none, mayor bitrate
                const audioFormats = formats.filter(f => f.vcodec === "none" && f.acodec !== "none");
                const bestAudio = audioFormats.sort((a, b) => (b.abr || 0) - (a.abr || 0))[0];

                res.json({
                    title: info.title,
                    bestVideo: bestVideo ? { format_id: bestVideo.format_id, quality: bestVideo.qualityLabel, ext: bestVideo.ext } : null,
                    bestAudio: bestAudio ? { format_id: bestAudio.format_id, bitrate: bestAudio.abr, ext: bestAudio.ext } : null
                });

            } catch (err) {
                res.status(500).json({ error: "Error parseando JSON" });
            }
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Error ejecutando yt-dlp" });
    }
});

app.get("/download-best", async (req, res) => {
    const videoURL = req.query.url;
    if (!videoURL) return res.status(400).json({ error: "Falta ?url=" });

    try {
        // Obtenemos info JSON
        const childInfo = spawn("yt-dlp", ["-J", "--no-warnings", "--no-check-certificates", videoURL]);
        let data = "";
        childInfo.stdout.on("data", chunk => data += chunk);
        childInfo.stderr.on("data", chunk => process.stderr.write(chunk));

        childInfo.on("close", (code) => {
            if (code !== 0) return res.status(500).json({ error: "No se pudo obtener info" });

            try {
                const info = JSON.parse(data);
                const formats = info.formats || [];

                // Mejor video
                const videoFormats = formats.filter(f => f.vcodec !== "none" && f.acodec === "none");
                const bestVideo = videoFormats.sort((a, b) => (b.height || 0) - (a.height || 0))[0];

                // Mejor audio
                const audioFormats = formats.filter(f => f.vcodec === "none" && f.acodec !== "none");
                const bestAudio = audioFormats.sort((a, b) => (b.abr || 0) - (a.abr || 0))[0];

                if (!bestVideo || !bestAudio) return res.status(500).json({ error: "No se encontró audio o video" });

                // Descarga y fusiona
                const args = [
                    "-f",
                    `${bestVideo.format_id}+${bestAudio.format_id}`,
                    "--no-warnings",
                    "--no-check-certificates",
                    "--ffmpeg-location",
                    ffmpegPath,
                    "--merge-output-format",
                    "mp4",
                    "-o",
                    "-",  // salida stdout
                    videoURL
                ];

                const child = spawn("yt-dlp", args, { stdio: ["ignore", "pipe", "pipe"] });
                res.setHeader("Content-Type", "video/mp4");
                res.setHeader("Content-Disposition", `attachment; filename="video_best.mp4"`);

                child.stderr.on("data", chunk => process.stderr.write(chunk));
                child.stdout.pipe(res);

                child.on("close", code => {
                    if (code !== 0 && !res.headersSent) res.status(500).end("Fallo en la descarga");
                    else res.end();
                });

            } catch (err) {
                res.status(500).json({ error: "Error parseando JSON" });
            }
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Error ejecutando yt-dlp" });
    }
});


const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor en http://localhost:${PORT}`));
