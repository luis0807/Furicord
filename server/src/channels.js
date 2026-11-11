// Canais fixos: não existe criação de servidor nem de canal, então eles vivem aqui.
// Para adicionar ou renomear um canal, basta editar esta lista e reiniciar o servidor.
// Não mude o `id` de um canal de texto que já tem mensagens: é ele que liga o histórico.

export const TEXT_CHANNELS = [
  { id: "geral", name: "geral", topic: "Conversa sobre qualquer coisa" },
  { id: "memes", name: "memes", topic: "Só coisa boa" },
  { id: "jogos", name: "jogos", topic: "Bora jogar?" },
  { id: "links", name: "links", topic: "Coisas legais da internet" },
];

export const VOICE_CHANNELS = [
  { id: "sala", name: "Sala de voz" },
  { id: "jogatina", name: "Jogatina" },
];

export const findTextChannel = (id) => TEXT_CHANNELS.find((channel) => channel.id === id);
export const findVoiceChannel = (id) => VOICE_CHANNELS.find((channel) => channel.id === id);
