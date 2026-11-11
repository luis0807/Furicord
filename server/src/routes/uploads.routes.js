import { Router } from "express";
import multer from "multer";
import { MAX_UPLOAD_BYTES } from "../config.js";
import { Upload, serializeUpload } from "../models/Upload.js";
import { HttpError, isObjectId } from "../lib/http.js";
import { createRateLimiter } from "../lib/rateLimit.js";
import { cleanFileName, sniffImageType, toDimension } from "../lib/images.js";

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 5 },
});

// Sem login, qualquer um pode enviar arquivo: isso evita que alguém encha o banco num loop.
const allowUpload = createRateLimiter({ windowMs: 60_000, max: 20 });

function rateLimit(req, res, next) {
  if (!allowUpload(req.ip)) {
    return next(new HttpError(429, "Muitos envios seguidos. Espere um minuto."));
  }
  next();
}

// O arquivo é enviado antes da mensagem; a mensagem depois só referencia o id.
router.post("/", rateLimit, upload.single("file"), async (req, res) => {
  if (!req.file) throw new HttpError(400, "Nenhuma imagem enviada");

  const contentType = sniffImageType(req.file.buffer);
  if (!contentType) throw new HttpError(415, "Só dá para enviar imagens PNG, JPEG, GIF ou WebP");

  const doc = await Upload.create({
    data: req.file.buffer,
    contentType,
    name: cleanFileName(req.file.originalname, contentType),
    size: req.file.size,
    width: toDimension(req.body?.width),
    height: toDimension(req.body?.height),
  });

  res.status(201).json(serializeUpload(doc));
});

router.get("/:id", async (req, res) => {
  const doc = isObjectId(req.params.id) ? await Upload.findById(req.params.id) : null;
  if (!doc) throw new HttpError(404, "Imagem não encontrada");

  res.set({
    "Content-Type": doc.contentType,
    // O conteúdo de um id nunca muda, então o navegador pode guardar para sempre.
    "Cache-Control": "public, max-age=31536000, immutable",
    "X-Content-Type-Options": "nosniff",
    "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(doc.name)}`,
  });
  res.send(doc.data);
});

export default router;
