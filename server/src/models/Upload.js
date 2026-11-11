import mongoose from "mongoose";

// As imagens ficam no próprio MongoDB para não depender de outro serviço.
// O disco do Render free é apagado a cada deploy, então salvar em arquivo não serve.
// Atenção ao limite do Atlas free (512 MB): se encher, migre para Cloudinary/S3.
const uploadSchema = new mongoose.Schema(
  {
    data: { type: Buffer, required: true },
    contentType: { type: String, required: true },
    name: { type: String, required: true },
    size: { type: Number, required: true },
    width: Number,
    height: Number,
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false },
);

export const Upload = mongoose.model("Upload", uploadSchema);

export function serializeUpload(doc) {
  return {
    id: String(doc._id),
    name: doc.name,
    contentType: doc.contentType,
    size: doc.size,
    width: doc.width ?? null,
    height: doc.height ?? null,
  };
}
