import multer from "multer";
import { MAX_UPLOAD_BYTES } from "../config.js";

export function notFound(req, res) {
  res.status(404).json({ message: "Rota não encontrada" });
}

// eslint-disable-next-line no-unused-vars -- o Express só reconhece o handler de erro com 4 parâmetros
export function errorHandler(err, req, res, next) {
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      const mb = MAX_UPLOAD_BYTES / 1024 / 1024;
      return res.status(413).json({ message: `Imagem grande demais (máx. ${mb} MB)` });
    }
    return res.status(400).json({ message: "Upload inválido" });
  }

  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ message: status >= 500 ? "Erro interno do servidor" : err.message });
}
