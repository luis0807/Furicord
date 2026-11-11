import mongoose from "mongoose";

// Cópia dos metadados da imagem: assim o histórico não precisa consultar a
// coleção de uploads (que guarda os bytes) só para desenhar a lista.
const attachmentSchema = new mongoose.Schema(
  {
    upload: { type: mongoose.Schema.Types.ObjectId, required: true },
    name: String,
    contentType: String,
    size: Number,
    width: Number,
    height: Number,
  },
  { _id: false },
);

const messageSchema = new mongoose.Schema(
  {
    channelId: { type: String, required: true },
    author: { type: String, required: true },
    content: { type: String, default: "" },
    attachments: { type: [attachmentSchema], default: [] },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false },
);

// Histórico paginado de trás para frente: "as 50 mais novas antes do id X".
messageSchema.index({ channelId: 1, _id: -1 });

export const Message = mongoose.model("Message", messageSchema);

export function serializeMessage(doc) {
  return {
    id: String(doc._id),
    channelId: doc.channelId,
    author: doc.author,
    content: doc.content,
    attachments: (doc.attachments || []).map((attachment) => ({
      id: String(attachment.upload),
      name: attachment.name,
      contentType: attachment.contentType,
      size: attachment.size,
      width: attachment.width ?? null,
      height: attachment.height ?? null,
    })),
    createdAt: doc.createdAt,
  };
}
