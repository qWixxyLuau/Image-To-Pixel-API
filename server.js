const express = require("express");
const sharp = require("sharp");

const app = express();
const PORT = 3000;

const MAX_SIZE = 256;                 // максимальная сторона результата
const MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024; // лимит скачивания 20 МБ
const FETCH_TIMEOUT_MS = 15000;

app.use((req, res, next) => {
	res.header("Access-Control-Allow-Origin", "*");
	next();
});

app.get("/pixels", async (req, res) => {
	try {
		const imageUrl = req.query.url;

		console.log("Запрос:");
		console.log("URL картинки:", imageUrl);

		if (!imageUrl || typeof imageUrl !== "string" || !/^https:\/\//i.test(imageUrl)) {
			return res.status(400).json({
				error: "Нужен параметр ?url=https://...",
				received: imageUrl ?? null
			});
		}

		const response = await fetch(imageUrl, {
			redirect: "follow",
			signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
			headers: {
				"User-Agent": "RobloxImagePixelReader/1.0",
				"Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8"
			}
		});

		console.log("Статус скачивания:", response.status, response.statusText);

		if (!response.ok) {
			return res.status(400).json({
				error: "Не удалось скачать изображение",
				status: response.status,
				statusText: response.statusText,
				url: imageUrl
			});
		}

		const contentType = response.headers.get("content-type") || "";
		console.log("Content-Type:", contentType);

		if (!contentType.startsWith("image/")) {
			return res.status(400).json({
				error: "По ссылке не изображение",
				contentType
			});
		}

		const declaredLength = Number(response.headers.get("content-length") || 0);
		if (declaredLength > MAX_DOWNLOAD_BYTES) {
			return res.status(413).json({
				error: "Изображение слишком большое",
				bytes: declaredLength
			});
		}

		const imageBuffer = Buffer.from(await response.arrayBuffer());

		if (imageBuffer.length > MAX_DOWNLOAD_BYTES) {
			return res.status(413).json({
				error: "Изображение слишком большое",
				bytes: imageBuffer.length
			});
		}

		const { data, info } = await sharp(imageBuffer, { animated: false })
			.rotate() // учитывает EXIF-ориентацию
			.resize(MAX_SIZE, MAX_SIZE, {
				fit: "inside",
				withoutEnlargement: true
			})
			.ensureAlpha()
			.raw()
			.toBuffer({ resolveWithObject: true });

		console.log(`Результат: ${info.width}x${info.height}, каналов: ${info.channels}`);

		// ?format=packed — компактный вариант: каждый пиксель одним числом 0xRRGGBBAA
		if (req.query.format === "packed") {
			const packed = new Array(info.width * info.height);
			for (let i = 0, p = 0; i < data.length; i += 4, p++) {
				packed[p] = ((data[i] << 24) | (data[i + 1] << 16) | (data[i + 2] << 8) | data[i + 3]) >>> 0;
			}

			return res.json({
				width: info.width,
				height: info.height,
				format: "packed-rgba",
				pixels: packed
			});
		}

		res.json({
			width: info.width,
			height: info.height,
			channels: info.channels, // всегда 4 (RGBA)
			pixels: Array.from(data)
		});
	} catch (error) {
		console.error("Ошибка:", error);

		const isTimeout = error?.name === "TimeoutError" || error?.name === "AbortError";

		res.status(isTimeout ? 504 : 500).json({
			error: isTimeout ? "Таймаут скачивания изображения" : "Ошибка обработки изображения",
			details: String(error)
		});
	}
});

app.listen(PORT, () => {
	console.log(`Сервер запущен: http://localhost:${PORT}`);
});