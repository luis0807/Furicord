import mongoose from "mongoose";

// Conta sem senha: o "login" é um código secreto guardado no navegador da pessoa.
// Aqui fica só o hash dele — quem lesse o banco não conseguiria entrar como ninguém.
const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    // Nome em minúsculas: garante que "Ana" e "ana" sejam a mesma pessoa.
    nameKey: { type: String, required: true, unique: true },
    tokenHash: { type: String, required: true, unique: true },
    // Perfil visual já validado por lib/profile.js.
    profile: { type: mongoose.Schema.Types.Mixed, default: null },
    lastSeenAt: { type: Date, default: Date.now },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false },
);

export const User = mongoose.model("User", userSchema);

export const isDuplicateKey = (err) => err?.code === 11000;
