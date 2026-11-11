import { Router } from "express";
import { TEXT_CHANNELS, VOICE_CHANNELS, findTextChannel } from "../channels.js";
import { Message, serializeMessage } from "../models/Message.js";
import { HttpError, isObjectId } from "../lib/http.js";

const router = Router();

router.get("/", (req, res) => {
  res.json({ text: TEXT_CHANNELS, voice: VOICE_CHANNELS });
});

// GET /api/channels/geral/messages?before=<id>&limit=50
// Devolve as mensagens em ordem cronológica e se ainda há mais antigas.
router.get("/:channelId/messages", async (req, res) => {
  const channel = findTextChannel(req.params.channelId);
  if (!channel) throw new HttpError(404, "Canal não encontrado");

  const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 50, 1), 100);
  const filter = { channelId: channel.id };
  if (req.query.before !== undefined) {
    if (!isObjectId(req.query.before)) throw new HttpError(400, "Cursor inválido");
    filter._id = { $lt: req.query.before };
  }

  const docs = await Message.find(filter).sort({ _id: -1 }).limit(limit).lean();
  res.json({ messages: docs.reverse().map(serializeMessage), hasMore: docs.length === limit });
});

export default router;
